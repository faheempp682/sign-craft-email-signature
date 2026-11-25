/** Small in-memory cache with a time limit and a size limit (oldest entry is evicted first). */
export class TtlCache<V> {
  private store = new Map<string, { value: V; expires: number }>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    this.store.delete(key);
    this.store.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.store.size > this.max) this.store.delete(this.store.keys().next().value as string);
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Sliding-window limiter: returns true when `key` has already made `max` calls within `windowMs`.
 * In memory only, so it resets on restart and is per server instance. A stopgap until usage is stored per user.
 */
export function createWindowLimiter(windowMs: number, max: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return function isLimited(key: string): boolean {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return true;
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (v.every((x) => t - x >= windowMs)) hits.delete(k);
    return false;
  };
}
