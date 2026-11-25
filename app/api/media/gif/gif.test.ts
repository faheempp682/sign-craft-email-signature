import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakePngHeader, meta, png } from "@/lib/storage/test-fixtures";

const world = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; email_confirmed_at: string },
  featureOn: true,
  featureError: false,
}));

vi.mock("@/lib/supabase/server", () => {
  const client = {
    rpc: async (fn: string) =>
      fn === "feature_enabled" ? (world.featureError ? { data: null, error: { message: "boom" } } : { data: world.featureOn, error: null }) : { data: "member", error: null },
  };
  return { createClient: async () => client, getUser: async () => world.user };
});

import { POST } from "./route";

const URL_ = "http://localhost:3000/api/media/gif";
const GOOD = { delays: [300, 600], loop: 0, width: 200, height: 100 };

async function frame(rgb: [number, number, number]) {
  return sharp({ create: { width: 200, height: 100, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer();
}

type Build = { frames?: (Uint8Array | string)[]; options?: unknown; headers?: Record<string, string>; rawOptions?: string };
async function call(b: Build = {}) {
  const fd = new FormData();
  const frames = b.frames ?? [await frame([255, 0, 0]), await frame([0, 0, 255])];
  for (const f of frames) fd.append("frames", typeof f === "string" ? f : new File([new Uint8Array(f)], "f.png", { type: "image/png" }));
  fd.set("options", b.rawOptions ?? JSON.stringify(b.options ?? GOOD));
  return POST(new Request(URL_, { method: "POST", body: fd, headers: { host: "localhost:3000", ...b.headers } }));
}

beforeEach(() => {
  world.user = { id: "u1", email: "jane@kimp.xyz", email_confirmed_at: "2026-01-01" };
  world.featureOn = true;
  world.featureError = false;
});

describe("POST /api/media/gif", () => {
  it("returns animated GIF bytes for good input", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const buf = new Uint8Array(await res.arrayBuffer());
    const m = await meta(buf);
    expect(m.pages).toBe(2);
    expect(m.delay).toEqual([300, 600]);
    expect([m.width, m.height]).toEqual([200, 100]);
  });

  it("requires sign-in", async () => {
    world.user = null;
    expect((await call()).status).toBe(401);
  });

  it("is blocked when the animated_gif feature is off for the person", async () => {
    world.featureOn = false;
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("feature_disabled");
  });

  it("fails closed when the feature check itself fails", async () => {
    world.featureError = true;
    expect((await call()).status).toBe(503);
  });

  it("refuses a request from another site", async () => {
    const res = await call({ headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("bad_origin");
  });

  it("checks the sign-in and flag before doing any work, even for a bad origin-less body", async () => {
    world.featureOn = false;
    expect((await call({ rawOptions: "not json" })).status).toBe(403);
  });

  it("rejects too few or too many frames", async () => {
    const f = await frame([1, 2, 3]);
    expect((await call({ frames: [f] })).status).toBe(400);
    expect((await call({ frames: Array(7).fill(f), options: { ...GOOD, delays: Array(7).fill(500) } })).status).toBe(400);
  });

  it("rejects a non-file frame field", async () => {
    const f = await frame([1, 2, 3]);
    expect((await call({ frames: [f, "just text"] })).status).toBe(400);
  });

  it("rejects an oversized frame", async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set((await frame([1, 2, 3])).subarray(0, 100));
    const res = await call({ frames: [await frame([1, 2, 3]), big] });
    expect(res.status).toBe(413);
  });

  it("rejects an oversized declared body before reading it", async () => {
    const res = await call({ headers: { "content-length": String(100 * 1024 * 1024) } });
    expect(res.status).toBe(413);
  });

  it("rejects bad options", async () => {
    expect((await call({ rawOptions: "{" })).status).toBe(400);
    expect((await call({ options: { ...GOOD, delays: [300] } })).status).toBe(400); // wrong number of delays
    expect((await call({ options: { ...GOOD, delays: [10, 600] } })).status).toBe(400); // below the minimum delay
    expect((await call({ options: { ...GOOD, width: 5000 } })).status).toBe(400);
    expect((await call({ options: { ...GOOD, loop: 99 } })).status).toBe(400);
  });

  it("rejects a file that is not an image, and a pixel bomb", async () => {
    const f = await frame([1, 2, 3]);
    const notImg = await call({ frames: [f, new TextEncoder().encode("<svg onload=alert(1)>")] });
    expect(notImg.status).toBe(422);
    expect((await notImg.json()).error).toBe("bad_frame");
    const bomb = await call({ frames: [f, fakePngHeader(9000, 9000)] });
    expect(bomb.status).toBe(422);
    expect((await bomb.json()).error).toBe("too_many_pixels");
  });

  it("does not echo file content or paths in errors", async () => {
    const res = await call({ frames: [await png(50, 50), new TextEncoder().encode("SECRET-CONTENT")] });
    expect(JSON.stringify(await res.json())).not.toContain("SECRET-CONTENT");
  });
});
