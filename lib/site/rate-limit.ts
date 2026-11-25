/**
 * Small in-memory sliding-window rate limiter for public (signed-out) endpoints.
 *
 *   const limiter = createRateLimiter(PUBLIC_LIMITS.write);
 *   const r = limiter.check(clientIp(req.headers));
 *   if (!r.allowed) return tooManyRequests(r);
 *
 * Honest limits of this design:
 *  - State lives in one server process. On serverless or several instances each instance counts on its own, so the
 *    real ceiling is `limit x instances`. That is fine for abuse damping; use a shared store for hard guarantees.
 *  - A restart resets the counters.
 *  - Memory is bounded: at most `maxKeys` clients are tracked; when full, expired keys go first, then the oldest.
 *
 * Proxies and client IPs: request headers are attacker-controlled unless a proxy you run overwrites them. So
 * `clientIp` ignores forwarding headers unless TRUST_PROXY_HEADERS=true, and then it reads X-Forwarded-For from the
 * RIGHT: with TRUSTED_PROXY_HOPS=1 (default) it takes the last entry, which is the one your own proxy appended, never
 * a value the client could have forged on the left. When headers are not trusted every caller shares the "unknown"
 * bucket, which fails safe (one noisy client can throttle others) rather than letting anyone dodge the limit.
 */
import { isIP } from "node:net";

export type RateLimitConfig = { limit: number; windowMs: number; maxKeys?: number };
export type RateLimitResult = { allowed: boolean; limit: number; remaining: number; retryAfterSeconds: number };

/** Named limits for public users. Documented in docs/public-site.md. */
export const PUBLIC_LIMITS = {
  /** Reading public pages and cheap lookups. */
  read: { limit: 60, windowMs: 60_000 },
  /** Anything that writes or sends something. */
  write: { limit: 10, windowMs: 60_000 },
  /** Anything that costs money or compute (none exist for signed-out users today; AI is never public). */
  expensive: { limit: 5, windowMs: 3_600_000 },
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimiter = {
  check(key: string): RateLimitResult;
  /** Number of keys currently tracked (for tests and monitoring). */
  size(): number;
  reset(): void;
};

export function createRateLimiter(config: RateLimitConfig, now: () => number = Date.now): RateLimiter {
  const { limit, windowMs } = config;
  const maxKeys = config.maxKeys ?? 10_000;
  if (!(limit >= 1) || !(windowMs >= 1)) throw new Error("rate limiter needs limit >= 1 and windowMs >= 1");
  // key -> timestamps of allowed requests, oldest first. Map iteration order is insertion order, which we use for eviction.
  const hits = new Map<string, number[]>();

  const prune = (stamps: number[], t: number) => {
    let i = 0;
    while (i < stamps.length && stamps[i] <= t - windowMs) i++;
    if (i) stamps.splice(0, i);
  };

  const makeRoom = (t: number) => {
    if (hits.size < maxKeys) return;
    for (const [k, stamps] of hits) {
      prune(stamps, t);
      if (stamps.length === 0) hits.delete(k);
    }
    // Still full of live clients: drop the least recently added one rather than grow without bound.
    while (hits.size >= maxKeys) {
      const oldest = hits.keys().next().value;
      if (oldest === undefined) break;
      hits.delete(oldest);
    }
  };

  return {
    check(key) {
      const t = now();
      let stamps = hits.get(key);
      if (stamps) prune(stamps, t);
      if (!stamps || stamps.length === 0) {
        hits.delete(key);
        makeRoom(t);
        stamps = [];
        hits.set(key, stamps);
      }
      if (stamps.length >= limit) {
        // Allowed again when the oldest counted request leaves the window.
        return { allowed: false, limit, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((stamps[0] + windowMs - t) / 1000)) };
      }
      stamps.push(t);
      return { allowed: true, limit, remaining: limit - stamps.length, retryAfterSeconds: 0 };
    },
    size: () => hits.size,
    reset: () => hits.clear(),
  };
}

type HeaderBag = { get(name: string): string | null };

/** Best-effort client address for rate limiting. See the note at the top of this file before relying on it. */
export function clientIp(headers: HeaderBag, env: Record<string, string | undefined> = process.env): string {
  if (env.TRUST_PROXY_HEADERS !== "true") return "unknown";
  const hops = Math.min(10, Math.max(1, Number.parseInt(env.TRUSTED_PROXY_HOPS ?? "1", 10) || 1));
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const candidate = forwarded.length >= hops ? forwarded[forwarded.length - hops] : headers.get("x-real-ip")?.trim();
  return candidate && isIP(candidate) ? candidate : "unknown";
}

/** A ready 429 response with Retry-After. */
export function tooManyRequests(r: RateLimitResult): Response {
  return new Response(JSON.stringify({ error: "rate_limited", message: "Too many requests. Please wait a moment and try again." }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(r.retryAfterSeconds), "cache-control": "no-store" },
  });
}
