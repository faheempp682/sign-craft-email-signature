import { describe, expect, it } from "vitest";
import { TtlCache, createWindowLimiter } from "./ttl-cache";

describe("TtlCache", () => {
  it("returns stored values until they expire", () => {
    let t = 0;
    const c = new TtlCache<string>(10, 1000, () => t);
    c.set("a", "A");
    expect(c.get("a")).toBe("A");
    t = 999;
    expect(c.get("a")).toBe("A");
    t = 1000;
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it("evicts the oldest entry when full", () => {
    const c = new TtlCache<number>(2, 1000, () => 0);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });

  it("refreshes an overwritten key instead of duplicating it", () => {
    const c = new TtlCache<number>(2, 1000, () => 0);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 9);
    c.set("c", 3); // evicts b, the oldest after a was refreshed
    expect(c.get("a")).toBe(9);
    expect(c.get("b")).toBeUndefined();
  });
});

describe("createWindowLimiter", () => {
  it("allows up to max calls per window, then limits, then recovers", () => {
    let t = 0;
    const limited = createWindowLimiter(1000, 3, () => t);
    expect([limited("u"), limited("u"), limited("u")]).toEqual([false, false, false]);
    expect(limited("u")).toBe(true);
    t = 1001;
    expect(limited("u")).toBe(false);
  });

  it("limits each key separately", () => {
    const limited = createWindowLimiter(1000, 1, () => 0);
    expect(limited("a")).toBe(false);
    expect(limited("b")).toBe(false);
    expect(limited("a")).toBe(true);
  });

  it("does not count rejected calls against the window", () => {
    let t = 0;
    const limited = createWindowLimiter(1000, 2, () => t);
    limited("u");
    t = 500;
    limited("u");
    for (let i = 0; i < 20; i++) limited("u"); // hammering while limited
    t = 1001; // the first call has aged out, so exactly one slot is free
    expect(limited("u")).toBe(false);
    expect(limited("u")).toBe(true);
  });
});
