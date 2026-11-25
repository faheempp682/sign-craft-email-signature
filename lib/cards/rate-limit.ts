/**
 * A small in-memory sliding-window limiter for the public card endpoints (vCard, QR).
 * It is per server instance, which is enough to blunt scripted abuse; it is not a substitute for an edge/CDN limit
 * on a multi-instance deployment (see docs/digital-card.md).
 */
type Bucket = number[];
const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

export type Limit = { allowed: boolean; retryAfter: number };

export function hit(key: string, max: number, windowMs: number, now = Date.now()): Limit {
  const cutoff = now - windowMs;
  const list = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (list.length >= max) {
    buckets.set(key, list);
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((list[0] + windowMs - now) / 1000)) };
  }
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > MAX_KEYS) {
    for (const [k, v] of buckets) if (v[v.length - 1] <= cutoff) buckets.delete(k);
    if (buckets.size > MAX_KEYS) buckets.clear(); // fail open on memory, never grow without bound
  }
  return { allowed: true, retryAfter: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}

/** The caller's address as seen by the platform proxy (first x-forwarded-for entry), or "unknown". */
export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}
