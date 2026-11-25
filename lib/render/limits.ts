import { createHash } from "node:crypto";

/**
 * Small in-process helpers for the render service: a content-hash cache, a per-user rate limit and a concurrency gate.
 * They live in memory of ONE server process, which is exactly how the render service is meant to run (a long-lived Node
 * server, not serverless). See docs/rendered-previews.md.
 */

export const hashOf = (...parts: string[]) => createHash("sha256").update(parts.join("\u0000")).digest("hex");

/** LRU with a byte budget and an age limit. */
export class ByteCache<V extends { bytes: number }> {
  private map = new Map<string, { v: V; at: number }>();
  private total = 0;
  constructor(private maxBytes: number, private ttlMs: number, private now: () => number = Date.now) {}
  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) {
      this.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e); // most recent last
    return e.v;
  }
  set(key: string, v: V) {
    this.delete(key);
    if (v.bytes > this.maxBytes) return;
    this.map.set(key, { v, at: this.now() });
    this.total += v.bytes;
    for (const [k, e] of this.map) {
      if (this.total <= this.maxBytes) break;
      this.map.delete(k);
      this.total -= e.v.bytes;
    }
  }
  private delete(key: string) {
    const e = this.map.get(key);
    if (e) {
      this.total -= e.v.bytes;
      this.map.delete(key);
    }
  }
  get size() {
    return this.map.size;
  }
}

/** Sliding window: `limit` calls per `windowMs` per key. Returns the seconds to wait, or 0 when allowed. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number, private now: () => number = Date.now) {}
  take(key: string): number {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0] + this.windowMs - t) / 1000));
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((x) => t - x < this.windowMs)) this.hits.delete(k);
    return 0;
  }
}

/** At most `max` jobs run at once; at most `maxQueue` wait. Beyond that, `run` rejects with QueueFull. */
export class QueueFull extends Error {}
export class Gate {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private max: number, private maxQueue: number) {}
  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.waiting.length >= this.maxQueue) throw new QueueFull("render queue is full");
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else this.active++;
    try {
      return await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next(); // hand the slot straight to the next waiter
      else this.active--;
    }
  }
  get stats() {
    return { active: this.active, waiting: this.waiting.length };
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`${what} timed out`)), ms)))]).finally(() => clearTimeout(t));
}
