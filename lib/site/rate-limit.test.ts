import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter, tooManyRequests } from "./rate-limit";

const clock = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
};
const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe("createRateLimiter", () => {
  it("allows up to the limit, then blocks with a retry time", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000 }, c.now);
    expect([1, 2, 3].map(() => rl.check("a").allowed)).toEqual([true, true, true]);
    const blocked = rl.check("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it("counts remaining requests down", () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 1000 }, clock().now);
    expect(rl.check("a").remaining).toBe(2);
    expect(rl.check("a").remaining).toBe(1);
  });

  it("is a sliding window, not a fixed bucket: old hits expire one by one", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 2, windowMs: 10_000 }, c.now);
    rl.check("a"); // t=0
    c.advance(6000);
    rl.check("a"); // t=6s
    expect(rl.check("a").allowed).toBe(false);
    c.advance(4001); // t=10.001s: the first hit has left, the second has not
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
  });

  it("reports when the oldest hit leaves the window", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 10_000 }, c.now);
    rl.check("a");
    c.advance(3500);
    expect(rl.check("a").retryAfterSeconds).toBe(7);
  });

  it("does not count blocked attempts against the caller", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 10_000 }, c.now);
    rl.check("a");
    for (let i = 0; i < 50; i++) rl.check("a");
    c.advance(10_001);
    expect(rl.check("a").allowed).toBe(true);
  });

  it("keeps keys independent", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 }, clock().now);
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("b").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
  });

  it("bounds memory: never tracks more than maxKeys clients", () => {
    const rl = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 100 }, clock().now);
    for (let i = 0; i < 1000; i++) rl.check(`ip-${i}`);
    expect(rl.size()).toBeLessThanOrEqual(100);
  });

  it("frees expired keys before evicting live ones", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 }, c.now);
    rl.check("live");
    rl.check("old");
    c.advance(900);
    rl.check("live2"); // full; nothing expired yet, so the oldest key is evicted
    expect(rl.size()).toBe(2);
    c.advance(200); // "old" and "live" expired, live2 not
    rl.check("fresh");
    expect(rl.check("live2").allowed).toBe(false); // still tracked, still limited
  });

  it("rejects nonsense configuration", () => {
    expect(() => createRateLimiter({ limit: 0, windowMs: 1000 })).toThrow();
    expect(() => createRateLimiter({ limit: 1, windowMs: 0 })).toThrow();
  });
});

describe("clientIp", () => {
  it("ignores forwarding headers unless proxies are trusted (a client can forge them)", () => {
    expect(clientIp(headers({ "x-forwarded-for": "6.6.6.6" }), {})).toBe("unknown");
    expect(clientIp(headers({ "x-forwarded-for": "6.6.6.6" }), { TRUST_PROXY_HEADERS: "false" })).toBe("unknown");
  });

  it("takes the entry our own proxy appended (rightmost), not what the client put on the left", () => {
    const env = { TRUST_PROXY_HEADERS: "true" };
    expect(clientIp(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), env)).toBe("203.0.113.9");
  });

  it("honours extra trusted hops", () => {
    const env = { TRUST_PROXY_HEADERS: "true", TRUSTED_PROXY_HOPS: "2" };
    expect(clientIp(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.1" }), env)).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip, and to unknown for non-IP garbage", () => {
    const env = { TRUST_PROXY_HEADERS: "true" };
    expect(clientIp(headers({ "x-real-ip": "198.51.100.4" }), env)).toBe("198.51.100.4");
    expect(clientIp(headers({ "x-forwarded-for": "not-an-ip" }), env)).toBe("unknown");
    expect(clientIp(headers({}), env)).toBe("unknown");
  });

  it("understands IPv6", () => {
    expect(clientIp(headers({ "x-forwarded-for": "2001:db8::1" }), { TRUST_PROXY_HEADERS: "true" })).toBe("2001:db8::1");
  });
});

describe("tooManyRequests", () => {
  it("returns a 429 with Retry-After and no caching", async () => {
    const r = tooManyRequests({ allowed: false, limit: 5, remaining: 0, retryAfterSeconds: 12 });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("12");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await r.json()).error).toBe("rate_limited");
  });
});
