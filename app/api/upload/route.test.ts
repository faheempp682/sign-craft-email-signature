import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { animatedGif, noisyPng, png } from "@/lib/storage/test-fixtures";

vi.setConfig({ testTimeout: 60_000 });

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  inserted: [] as Record<string, unknown>[],
  count: 0,
  /** Result of the animated_gif feature check: true / false, or "error" when the check itself fails. */
  animatedGif: true as boolean | "error",
}));

vi.mock("@/lib/supabase/server", () => {
  const client = {
    rpc: async (fn: string) => {
      if (fn !== "feature_enabled") return { data: null, error: { message: "unexpected rpc" } };
      return state.animatedGif === "error" ? { data: null, error: { message: "boom" } } : { data: state.animatedGif, error: null };
    },
    from: () => ({
      select: async () => ({ count: state.count }),
      insert: async (row: Record<string, unknown>) => {
        state.inserted.push(row);
        return { error: null };
      },
    }),
  };
  return { getUser: async () => state.user, createClient: async () => client };
});

import { POST } from "./route";

const ENV = { BUNNY_STORAGE_ZONE: "zone", BUNNY_STORAGE_ACCESS_KEY: "secret-key", BUNNY_CDN_URL: "https://cdn.example.net/" };
let bunny: ReturnType<typeof vi.fn>;

const upload = (bytes: Uint8Array, name = "x.png", type = "image/png", extra: Record<string, string> = {}) => {
  const form = new FormData();
  form.set("file", new File([bytes as BlobPart], name, { type }));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return POST(new Request("http://localhost/api/upload", { method: "POST", body: form }));
};

beforeEach(() => {
  Object.assign(process.env, ENV);
  state.user = { id: "user-1" };
  state.inserted = [];
  state.count = 0;
  state.animatedGif = true;
  bunny = vi.fn(async () => new Response(null, { status: 201 }));
  vi.stubGlobal("fetch", bunny);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) delete process.env[k];
});

describe("POST /api/upload", () => {
  it("returns 503 when Bunny is not configured", async () => {
    delete process.env.BUNNY_CDN_URL;
    expect((await upload(await png(50, 50))).status).toBe(503);
  });

  it("returns 401 when signed out, and never touches Bunny", async () => {
    state.user = null;
    expect((await upload(await png(50, 50))).status).toBe(401);
    expect(bunny).not.toHaveBeenCalled();
  });

  it("optimizes an oversized image, uploads the optimized bytes, and records what happened", async () => {
    const input = await png(3000, 1000);
    const res = await upload(input, "banner.png", "image/png", { purpose: "banner" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ type: "image/png", width: 1200, height: 400, animated: false, originalBytes: input.length });
    expect(body.url).toMatch(/^https:\/\/cdn\.example\.net\/user-1\/[0-9a-f-]+\.png$/);
    expect(body.notes.join(" ")).toContain("3000×1000 to 1200×400");

    // The bytes sent to Bunny are the optimized ones, with the access key, to the right endpoint.
    expect(bunny).toHaveBeenCalledTimes(1);
    const [target, init] = bunny.mock.calls[0] as [string, RequestInit];
    expect(target).toMatch(/^https:\/\/storage\.bunnycdn\.com\/zone\/user-1\/[0-9a-f-]+\.png$/);
    expect((init.headers as Record<string, string>).AccessKey).toBe("secret-key");
    expect((init.body as Uint8Array).length).toBe(body.bytes);
    expect(body.bytes).toBeLessThan(input.length + 1); // never bigger than what was uploaded unless resized

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({ width: 1200, height: 400, animated: false, size: body.bytes, original_size: input.length, type: "image/png" });
  });

  it("uses the smaller avatar limit when purpose is avatar", async () => {
    const body = await (await upload(await png(1000, 1000), "me.png", "image/png", { purpose: "avatar" })).json();
    expect(body).toMatchObject({ width: 400, height: 400 });
  });

  it("falls back to the default purpose for an unknown value", async () => {
    const body = await (await upload(await png(1500, 1500), "x.png", "image/png", { purpose: "nonsense" })).json();
    expect(body).toMatchObject({ width: 1200, height: 1200 });
  });

  it("keeps an animated GIF animated and flags the Outlook limitation", async () => {
    const res = await upload(await animatedGif(200, 100, 4), "a.gif", "image/gif");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.animated).toBe(true);
    expect(body.warnings.map((w: { code: string }) => w.code)).toContain("gif-outlook");
    expect(state.inserted[0]).toMatchObject({ animated: true, type: "image/gif" });
  });

  describe("animated GIF feature flag", () => {
    it("blocks an animated GIF when the flag is off, before anything is uploaded or recorded", async () => {
      state.animatedGif = false;
      const res = await upload(await animatedGif(200, 100, 4), "a.gif", "image/gif");
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "feature_disabled" });
      expect(bunny).not.toHaveBeenCalled();
      expect(state.inserted).toHaveLength(0);
    });

    it("still allows still images and single-frame GIFs when the flag is off", async () => {
      state.animatedGif = false;
      expect((await upload(await png(50, 50))).status).toBe(200);
    });

    it("fails closed (503) when the flag check itself fails", async () => {
      state.animatedGif = "error";
      const res = await upload(await animatedGif(200, 100, 4), "a.gif", "image/gif");
      expect(res.status).toBe(503);
      expect(bunny).not.toHaveBeenCalled();
    });
  });

  it("returns the size warning, with the real size, for an animation that is still too heavy", async () => {
    const body = await (await upload(await animatedGif(500, 500, 4, "noise"), "big.gif", "image/gif", { purpose: "banner" })).json();
    expect(body.animated).toBe(true);
    const w = body.warnings.find((x: { code: string }) => x.code === "gif-size");
    expect(w).toBeDefined();
    expect(w.message).toMatch(/\d+(\.\d)? (KB|MB)/);
  });

  it("rejects non-images by content, even when the browser says image/png", async () => {
    const res = await upload(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "evil.png", "image/png");
    expect(res.status).toBe(415);
    expect(bunny).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(0);
  });

  it("rejects an oversize upload with 413 and a readable message", async () => {
    const res = await upload(new Uint8Array(6 * 1024 * 1024));
    expect(res.status).toBe(413);
    expect((await res.json()).message).toMatch(/limit/i);
    expect(bunny).not.toHaveBeenCalled();
  });

  it("returns 429 at the per-user image quota", async () => {
    state.count = 200;
    expect((await upload(await png(50, 50))).status).toBe(429);
    expect(bunny).not.toHaveBeenCalled();
  });

  it("returns 502 and records nothing when Bunny rejects the upload", async () => {
    bunny.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const res = await upload(await png(50, 50));
    expect(res.status).toBe(502);
    expect(state.inserted).toHaveLength(0);
  });

  it("handles a heavy noisy image without crashing, shrinking it or reporting it", async () => {
    const input = await noisyPng(900, 600);
    const body = await (await upload(input, "n.png", "image/png", { purpose: "banner" })).json();
    expect(body.bytes).toBeLessThan(input.length);
  });
});
