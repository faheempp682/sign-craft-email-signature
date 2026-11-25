import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";

/**
 * The render browsers never reach the network themselves. When a signature contains an image, the engine asks this module
 * to fetch it and hands the bytes to the browser. That keeps the server from being used to probe its own network (SSRF):
 *  - https only, default port only, no credentials in the URL
 *  - the host name is resolved here, every address must be public, and the connection is pinned to the address we checked
 *    (so a DNS answer that changes between "check" and "connect" cannot redirect us)
 *  - redirects are followed at most 3 times and every hop is checked the same way
 *  - 5 second limit, 4 MB limit, raster images only (png, jpeg, gif, webp) plus svg, which the browser only ever shows through <img>
 */

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5000;
const OK_TYPES = /^image\/(png|jpe?g|gif|webp|svg\+xml)\b/i;

/** True for loopback, private, link-local, CGNAT, multicast, reserved and unspecified addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateAddress(mapped[1]);
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return /^(fc|fd|fe[89ab]|ff)/.test(s) || s.startsWith("64:ff9b:") || s.startsWith("2001:db8");
  }
  return true; // not an IP at all: refuse
}

export type ImageResult = { ok: true; body: Buffer; contentType: string } | { ok: false; reason: string };

type Resolver = (host: string) => Promise<string[]>;
const defaultResolve: Resolver = async (host) => (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export function checkUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (u.port && u.port !== "443") return null;
  if (!u.hostname || u.hostname === "localhost" || u.hostname.endsWith(".localhost") || u.hostname.endsWith(".internal") || u.hostname.endsWith(".local")) return null;
  return u;
}

async function once(u: URL, resolve: Resolver): Promise<{ status: number; location?: string; type: string; body: Buffer } | { error: string }> {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [host] : await resolve(host).catch(() => [] as string[]);
  if (!addrs.length) return { error: "unresolvable host" };
  if (addrs.some(isPrivateAddress)) return { error: "private address" };
  const pinned = addrs[0];
  return new Promise((done) => {
    const req = https.request(
      {
        host: u.hostname,
        servername: net.isIP(host) ? undefined : host,
        path: u.pathname + u.search,
        method: "GET",
        headers: { accept: "image/*", "user-agent": "SignCraft-render/1" },
        timeout: TIMEOUT_MS,
        // Connect to the address we validated, not whatever DNS says now.
        lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => {
          const family = net.isIPv6(pinned) ? 6 : 4;
          // Node 20+ asks for every address when happy-eyeballs is on ({ all: true }); answer in the shape it asked for.
          if (o && o.all) cb(null, [{ address: pinned, family }]);
          else cb(null, pinned, family);
        }) as unknown as https.RequestOptions["lookup"],
      } as https.RequestOptions,
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          const location = String(res.headers.location ?? "");
          return location ? done({ status, location, type: "", body: Buffer.alloc(0) }) : done({ error: "redirect without location" });
        }
        const type = String(res.headers["content-type"] ?? "");
        if (status !== 200 || !OK_TYPES.test(type)) {
          res.resume();
          return done({ error: status !== 200 ? `status ${status}` : "not an image" });
        }
        const chunks: Buffer[] = [];
        let n = 0;
        res.on("data", (c: Buffer) => {
          n += c.length;
          if (n > MAX_BYTES) {
            req.destroy();
            done({ error: "too large" });
          } else chunks.push(c);
        });
        res.on("end", () => done({ status, type, body: Buffer.concat(chunks) }));
        res.on("error", () => done({ error: "network error" }));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      done({ error: "timeout" });
    });
    req.on("error", () => done({ error: "network error" }));
    req.end();
  });
}

export async function fetchImage(raw: string, resolve: Resolver = defaultResolve): Promise<ImageResult> {
  let u = checkUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!u) return { ok: false, reason: "blocked url" };
    const r = await once(u, resolve);
    if ("error" in r) return { ok: false, reason: r.error };
    if (r.location) {
      try {
        u = checkUrl(new URL(r.location, u).toString());
      } catch {
        u = null;
      }
      continue;
    }
    return { ok: true, body: r.body, contentType: r.type.split(";")[0].trim() };
  }
  return { ok: false, reason: "too many redirects" };
}
