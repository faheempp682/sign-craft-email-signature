import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { isPublicAddress } from "@/lib/ai/net-guard";
import { checkUrl } from "@/lib/render/safe-image";

/**
 * A GET for a URL an ADMIN typed in (the generic CRM adapter). The same defence as lib/render/safe-image.ts, for JSON:
 *  - https only, default port, no credentials in the URL, no localhost-style names (checkUrl)
 *  - the host name is resolved here, EVERY address must be public (isPublicAddress), and the connection is pinned to the
 *    address we checked, so a DNS answer that changes between "check" and "connect" cannot redirect us
 *  - a redirect is followed only to the SAME host (the secret header is sent on every hop, so a different host is refused),
 *    at most 2 times, and every hop is checked from the start
 *  - 8 second limit, 1 MB limit, JSON answers only
 * The default transport is node's https; tests inject a fake transport and resolver (so they never touch the network).
 */

export type TransportRequest = { url: URL; address: string; headers: Record<string, string>; timeoutMs: number; maxBytes: number };
export type TransportResult = { status: number; headers: Record<string, string>; body: Buffer } | { error: string };
export type Transport = (r: TransportRequest) => Promise<TransportResult>;
export type Resolver = (host: string) => Promise<string[]>;

export type SafeResult = { ok: true; status: number; json: unknown } | { ok: false; reason: string };

export const defaultResolve: Resolver = async (host) => (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export const nodeTransport: Transport = (r) =>
  new Promise((done) => {
    const host = r.url.hostname.replace(/^\[|\]$/g, "");
    const req = https.request(
      {
        host: r.url.hostname,
        servername: net.isIP(host) ? undefined : host,
        path: r.url.pathname + r.url.search,
        method: "GET",
        headers: { ...r.headers, accept: "application/json", "user-agent": "SignCraft-sync/1" },
        timeout: r.timeoutMs,
        // connect to the address we validated, not whatever DNS says now
        lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => {
          const family = net.isIPv6(r.address) ? 6 : 4;
          if (o && o.all) cb(null, [{ address: r.address, family }]);
          else cb(null, r.address, family);
        }) as unknown as https.RequestOptions["lookup"],
      } as https.RequestOptions,
      (res) => {
        const status = res.statusCode ?? 0;
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
        if (status >= 300 && status < 400) {
          res.resume();
          return done({ status, headers, body: Buffer.alloc(0) });
        }
        const chunks: Buffer[] = [];
        let n = 0;
        res.on("data", (c: Buffer) => {
          n += c.length;
          if (n > r.maxBytes) {
            req.destroy();
            done({ error: "too large" });
          } else chunks.push(c);
        });
        res.on("end", () => done({ status, headers, body: Buffer.concat(chunks) }));
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

export async function safeGetJson(
  raw: string,
  o: { headers?: Record<string, string>; resolve?: Resolver; transport?: Transport; timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {},
): Promise<SafeResult> {
  const resolve = o.resolve ?? defaultResolve;
  const transport = o.transport ?? nodeTransport;
  const maxRedirects = o.maxRedirects ?? 2;
  let u = checkUrl(raw);
  const firstHost = u?.hostname.toLowerCase();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!u) return { ok: false, reason: "That address is not allowed (https only, the normal port, no credentials, no internal names)." };
    if (u.hostname.toLowerCase() !== firstHost) return { ok: false, reason: "The server redirected to a different host. Redirects to another host are refused so the secret is never sent there." };
    const host = u.hostname.replace(/^\[|\]$/g, "");
    let addrs: string[];
    try {
      addrs = net.isIP(host) ? [host] : await resolve(host);
    } catch {
      addrs = [];
    }
    if (!addrs.length) return { ok: false, reason: "The host name could not be resolved." };
    if (!addrs.every(isPublicAddress)) return { ok: false, reason: "The host resolves to a private or internal address. Only public internet addresses are allowed." };
    const r = await transport({ url: u, address: addrs[0], headers: o.headers ?? {}, timeoutMs: o.timeoutMs ?? 8000, maxBytes: o.maxBytes ?? 1024 * 1024 });
    if ("error" in r) return { ok: false, reason: r.error === "too large" ? "The answer is larger than 1 MB." : r.error === "timeout" ? "The server took longer than 8 seconds." : "Could not connect to the server." };
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.location;
      if (!loc) return { ok: false, reason: "The server redirected without a location." };
      try {
        u = checkUrl(new URL(loc, u).toString());
      } catch {
        u = null;
      }
      continue;
    }
    if (r.status < 200 || r.status >= 300) return { ok: false, reason: `The server answered ${r.status}.` };
    if (!/json/i.test(r.headers["content-type"] ?? "")) return { ok: false, reason: "The server did not answer with JSON." };
    try {
      return { ok: true, status: r.status, json: JSON.parse(r.body.toString("utf8")) };
    } catch {
      return { ok: false, reason: "The answer is not valid JSON." };
    }
  }
  return { ok: false, reason: "Too many redirects." };
}
