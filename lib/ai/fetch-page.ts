import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import { isPublicAddress } from "./net-guard";

export type FetchErrorCode = "invalid_url" | "blocked" | "unsupported" | "timeout" | "http_error" | "network" | "too_many_redirects";

export class FetchError extends Error {
  constructor(
    public readonly code: FetchErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export type FetchOptions = {
  /** Stop reading after this many (decompressed) bytes. The page is used as far as it was read. */
  maxBytes?: number;
  /** Total time allowed for one request, including DNS, TLS and reading. */
  timeoutMs?: number;
  maxRedirects?: number;
  /** Decides which resolved IP addresses may be connected to. Default: public internet only. Tests override this. */
  isAllowedAddress?: (ip: string) => boolean;
  /** Only ports 80 and 443 (the URL's default) are allowed unless this is set. Tests override this. */
  allowAnyPort?: boolean;
};

export type FetchedPage = { url: string; html: string; truncated: boolean };

const BLOCKED_NAME = /(^|\.)(localhost|local|internal|lan|home\.arpa|intranet|corp)$/i;
const REDIRECT = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = "SignCraftBot/1.0 (+one-off fetch requested by a user to fill in their email signature)";

/**
 * Validates a user-supplied address before any network traffic. Returns a normalised URL, or throws FetchError.
 * IP-literal hosts are checked here (they never reach DNS); named hosts are checked again at connect time.
 */
export function checkUrl(raw: string, opts: Pick<FetchOptions, "allowAnyPort" | "isAllowedAddress"> = {}): URL {
  const isAllowed = opts.isAllowedAddress ?? isPublicAddress;
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new FetchError("invalid_url", "That does not look like a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchError("invalid_url", "Only http and https addresses are supported.");
  if (url.username || url.password) throw new FetchError("invalid_url", "Remove the username and password from the address.");

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new FetchError("invalid_url", "That does not look like a web address.");
  if (BLOCKED_NAME.test(host) || !host.includes(".") && !isIP(host)) {
    throw new FetchError("blocked", "That address points to a private or internal location, which is not allowed.");
  }
  if (isIP(host) && !isAllowed(host)) throw new FetchError("blocked", "That address points to a private or internal location, which is not allowed.");
  if (url.port !== "" && !opts.allowAnyPort) throw new FetchError("blocked", "Only standard web addresses (no custom port) are allowed.");

  url.hash = "";
  return url;
}

/** DNS resolution that refuses to hand back any address the guard rejects, closing the DNS-rebinding gap. */
function guardedLookup(isAllowed: (ip: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = addresses as dns.LookupAddress[];
      if (list.length === 0 || list.some((a) => !isAllowed(a.address))) {
        return callback(new FetchError("blocked", "That address points to a private or internal location, which is not allowed.") as unknown as NodeJS.ErrnoException, "", 0);
      }
      if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

function networkError(e: unknown): FetchError {
  if (e instanceof FetchError) return e;
  const cause = (e as { cause?: unknown })?.cause;
  if (cause instanceof FetchError) return cause;
  const agg = (e as { errors?: unknown[] })?.errors?.find((x) => x instanceof FetchError);
  if (agg instanceof FetchError) return agg;
  const code = String((e as { code?: string })?.code ?? "");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new FetchError("network", "Could not find that website. Check the address.");
  if (/CERT|TLS|SSL|ERR_TLS/i.test(code)) return new FetchError("network", "That site's security certificate is not valid, so it was not read.");
  return new FetchError("network", "Could not reach that site.");
}

function decode(buf: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

type Hop = { kind: "redirect"; location: string } | { kind: "page"; html: string; truncated: boolean };

function requestOnce(url: URL, o: Required<Omit<FetchOptions, "allowAnyPort">>): Promise<Hop> {
  return new Promise<Hop>((resolve, reject) => {
    let settled = false;
    const finish = <T>(fn: (v: T) => void) => (v: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(v);
    };
    const ok = finish(resolve);
    const fail = finish(reject);

    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain;q=0.8", "Accept-Encoding": "gzip, deflate, br", "Accept-Language": "en" },
        lookup: guardedLookup(o.isAllowedAddress),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (REDIRECT.has(status)) {
          res.resume();
          const location = res.headers.location;
          return location ? ok({ kind: "redirect", location }) : fail(new FetchError("http_error", "The site sent an invalid redirect.", status));
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return fail(new FetchError("http_error", `The site refused or could not serve that page (error ${status}).`, status));
        }

        const type = String(res.headers["content-type"] ?? "").toLowerCase();
        if (!/^(text\/html|application\/xhtml\+xml|text\/plain)/.test(type)) {
          res.resume();
          return fail(new FetchError("unsupported", "That address is not a web page. Only HTML pages and plain text can be read."));
        }

        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase().trim();
        let stream: Readable = res;
        if (encoding === "gzip" || encoding === "x-gzip") stream = res.pipe(zlib.createGunzip());
        else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
        else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
        else if (encoding && encoding !== "identity") {
          res.resume();
          return fail(new FetchError("unsupported", "The site used a compression format that is not supported."));
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const done = () => ok({ kind: "page", html: decode(Buffer.concat(chunks), type), truncated });

        stream.on("data", (chunk: Buffer) => {
          if (settled) return;
          const room = o.maxBytes - size;
          if (chunk.length >= room) {
            // Enough: keep what fits and stop reading. Counting decompressed bytes also defeats compression bombs.
            chunks.push(chunk.subarray(0, room));
            size += room;
            truncated = true;
            done();
            res.destroy();
            stream.destroy();
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        stream.on("end", done);
        stream.on("error", (e) => (chunks.length ? done() : fail(networkError(e))));
        res.on("error", (e) => (chunks.length ? done() : fail(networkError(e))));
      },
    );

    const timer = setTimeout(() => {
      fail(new FetchError("timeout", "The site took too long to respond."));
      req.destroy();
    }, o.timeoutMs);

    req.on("error", (e) => fail(networkError(e)));
    req.end();
  });
}

/**
 * Fetches one public web page for autofill. Safety rules, in order:
 *  1. The address is validated (scheme, credentials, private names, IP literals, port) before any traffic.
 *  2. DNS answers are checked at connect time, so a hostname that resolves to a private address is refused.
 *  3. Every redirect is re-validated from scratch, up to a small limit.
 *  4. Only HTML / plain text is accepted, with a hard cap on bytes read (after decompression) and on total time.
 *  5. TLS certificates are always verified.
 */
export async function fetchPage(raw: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const o: Required<Omit<FetchOptions, "allowAnyPort">> = {
    maxBytes: options.maxBytes ?? 1_500_000,
    timeoutMs: options.timeoutMs ?? 8000,
    maxRedirects: options.maxRedirects ?? 3,
    isAllowedAddress: options.isAllowedAddress ?? isPublicAddress,
  };
  const check = { allowAnyPort: options.allowAnyPort, isAllowedAddress: o.isAllowedAddress };

  let url = checkUrl(raw, check);
  for (let hop = 0; hop <= o.maxRedirects; hop++) {
    const result = await requestOnce(url, o);
    if (result.kind === "page") return { url: url.toString(), html: result.html, truncated: result.truncated };
    let next: URL;
    try {
      next = new URL(result.location, url);
    } catch {
      throw new FetchError("http_error", "The site sent an invalid redirect.");
    }
    url = checkUrl(next.toString(), check);
  }
  throw new FetchError("too_many_redirects", "The address redirected too many times.");
}
