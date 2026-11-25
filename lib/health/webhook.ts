import https from "node:https";
import net from "node:net";
import { isPublicAddress } from "@/lib/ai/net-guard";
import { checkUrl } from "@/lib/render/safe-image";
import { defaultResolve, type Resolver } from "@/lib/sync/safe-fetch";

/**
 * The optional alert webhook (Slack-compatible: a JSON body `{ "text": "..." }`). There is no email service, so this and the
 * in-app list are the only alerts.
 *
 * The address is typed by an admin, so it gets the same defence as lib/sync/safe-fetch.ts (reused: its address check, its
 * resolver, and the URL rules of lib/render/safe-image.ts): https only, normal port, no credentials, no internal names, EVERY
 * resolved address must be public, and the connection is pinned to the address that was checked. NO redirects are followed
 * (a webhook that redirects is refused). 8 second limit; the answer body is ignored beyond its status.
 * A failure to deliver is returned, never thrown: it must never fail the check.
 *
 * The message holds only counts and a link back to the screen unless the admin opted in to names.
 */

export type PostRequest = { url: URL; address: string; body: string; timeoutMs: number };
export type PostTransport = (r: PostRequest) => Promise<{ status: number } | { error: string }>;

export const nodePost: PostTransport = (r) =>
  new Promise((done) => {
    const host = r.url.hostname.replace(/^\[|\]$/g, "");
    const req = https.request(
      {
        host: r.url.hostname,
        servername: net.isIP(host) ? undefined : host,
        path: r.url.pathname + r.url.search,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(r.body), "user-agent": "SignCraft-health/1" },
        timeout: r.timeoutMs,
        lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => {
          const family = net.isIPv6(r.address) ? 6 : 4;
          if (o && o.all) cb(null, [{ address: r.address, family }]);
          else cb(null, r.address, family);
        }) as unknown as https.RequestOptions["lookup"],
      } as https.RequestOptions,
      (res) => {
        res.resume();
        done({ status: res.statusCode ?? 0 });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      done({ error: "timeout" });
    });
    req.on("error", () => done({ error: "network error" }));
    req.end(r.body);
  });

export type Delivery = { ok: true } | { ok: false; reason: string };

export async function sendWebhook(raw: string, text: string, o: { resolve?: Resolver; transport?: PostTransport; timeoutMs?: number } = {}): Promise<Delivery> {
  try {
    const u = checkUrl(raw);
    if (!u) return { ok: false, reason: "The webhook address is not allowed (https only, the normal port, no credentials, no internal names)." };
    const host = u.hostname.replace(/^\[|\]$/g, "");
    let addrs: string[];
    try {
      addrs = net.isIP(host) ? [host] : await (o.resolve ?? defaultResolve)(host);
    } catch {
      addrs = [];
    }
    if (!addrs.length) return { ok: false, reason: "The webhook host name could not be resolved." };
    if (!addrs.every(isPublicAddress)) return { ok: false, reason: "The webhook host resolves to a private or internal address. Only public internet addresses are allowed." };
    const r = await (o.transport ?? nodePost)({ url: u, address: addrs[0], body: JSON.stringify({ text }), timeoutMs: o.timeoutMs ?? 8000 });
    if ("error" in r) return { ok: false, reason: r.error === "timeout" ? "The webhook took longer than 8 seconds." : "Could not connect to the webhook." };
    if (r.status >= 200 && r.status < 300) return { ok: true };
    if (r.status >= 300 && r.status < 400) return { ok: false, reason: "The webhook redirected, which is not followed." };
    return { ok: false, reason: `The webhook answered ${r.status}.` };
  } catch {
    return { ok: false, reason: "The webhook could not be called." };
  }
}

export type Notice = { edited: number; removed: number; link: string; names?: string[] };

/** One message per run, however many people. Counts and a link only; names only when `names` is given (the admin opted in). */
export function buildMessage(n: Notice): string {
  const total = n.edited + n.removed;
  const parts = [n.edited ? `${n.edited} edited` : "", n.removed ? `${n.removed} removed` : ""].filter(Boolean).join(", ");
  let t = `SignCraft signature health: ${total} new ${total === 1 ? "finding" : "findings"} (${parts}). Review: ${n.link}`;
  if (n.names?.length) {
    const shown = n.names.slice(0, 20).map((s) => s.replace(/[\r\n]+/g, " ").slice(0, 120).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    t += `\n${shown.join("\n")}${n.names.length > shown.length ? `\n…and ${n.names.length - shown.length} more` : ""}`;
  }
  return t;
}
