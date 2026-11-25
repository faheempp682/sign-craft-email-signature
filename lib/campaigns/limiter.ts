export type Limiter = { allow: (key: string, now?: number) => boolean };

/**
 * A small fixed-window limiter kept in memory. It is per server instance (serverless instances do not share it), so it
 * is a brake on floods and scripts, not an exact quota. Memory is bounded: at `maxKeys` expired entries are dropped,
 * and if that is not enough the oldest entries go.
 */
export function createLimiter({ max, windowMs, maxKeys = 5000 }: { max: number; windowMs: number; maxKeys?: number }): Limiter {
  const hits = new Map<string, { start: number; n: number }>();
  return {
    allow(key, now = Date.now()) {
      const cur = hits.get(key);
      if (cur && now - cur.start < windowMs) {
        cur.n += 1;
        return cur.n <= max;
      }
      if (hits.size >= maxKeys) {
        for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
        while (hits.size >= maxKeys) hits.delete(hits.keys().next().value as string);
      }
      hits.delete(key);
      hits.set(key, { start: now, n: 1 });
      return true;
    },
  };
}

/** The caller's address as far as the proxy tells us. Used only as an in-memory limiter key and to build a daily-salted hash. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (xff || req.headers.get("x-real-ip")?.trim() || "unknown").slice(0, 64);
}

export type DeviceClass = "desktop" | "mobile" | "tablet" | "other";

/** Coarse device class from the User-Agent. The User-Agent itself is never stored. */
export function deviceClass(ua: string | null): DeviceClass {
  const s = (ua ?? "").slice(0, 400).toLowerCase();
  if (!s) return "other";
  if (/ipad|tablet|kindle|silk|playbook/.test(s) || (/android/.test(s) && !/mobile/.test(s))) return "tablet";
  if (/iphone|ipod|mobi|android/.test(s)) return "mobile";
  if (/windows|macintosh|mac os x|x11|linux|cros/.test(s)) return "desktop";
  return "other";
}
