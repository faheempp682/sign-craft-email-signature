import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPreset } from "@/lib/presets";

const world = vi.hoisted(() => ({
  user: { id: "u1", email: "a@b.c", email_confirmed_at: "x" } as null | { id: string; email: string; email_confirmed_at: string },
  featureOn: true,
  render: vi.fn(),
  enabled: true,
}));

vi.mock("@/lib/supabase/server", () => {
  const client = {
    rpc: async (fn: string) => (fn === "feature_enabled" ? { data: world.featureOn, error: null } : { data: "member", error: null }),
  };
  return { createClient: async () => client, getUser: async () => world.user };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));
vi.mock("@/lib/render/engine", () => ({
  renderEnabled: () => world.enabled,
  engineStatus: async () => ({ enabled: world.enabled, engines: { chromium: { available: true }, webkit: { available: false, reason: "not installed" }, firefox: { available: true } } }),
  renderMany: (...a: unknown[]) => world.render(...a),
}));

import { GET, POST } from "./route";
import { QueueFull } from "@/lib/render/limits";

const doc = getPreset("classic")!.doc;
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://app.test/api/render", { method: "POST", headers: { "content-type": "application/json", host: "app.test", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

beforeEach(() => {
  world.user = { id: `u${Math.random()}`, email: "a@b.c", email_confirmed_at: "x" }; // fresh user: the rate limiter is per user
  world.featureOn = true;
  world.enabled = true;
  world.render.mockReset();
  world.render.mockResolvedValue({ results: [{ target: "chromium", viewport: "desktop", engine: "chromium", kind: "real", label: "Chromium (Blink)", width: 10, height: 10, cached: false, png: PNG }], skipped: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/api/render access and validation", () => {
  it("401 when signed out, 403 when the feature is off", async () => {
    world.user = null;
    expect((await POST(req({ doc }))).status).toBe(401);
    expect((await GET()).status).toBe(401);
    world.user = { id: "u9", email: "a@b.c", email_confirmed_at: "x" };
    world.featureOn = false;
    expect((await POST(req({ doc }))).status).toBe(403);
    expect(world.render).not.toHaveBeenCalled();
  });
  it("refuses a cross-site origin", async () => {
    expect((await POST(req({ doc }, { origin: "https://evil.test" }))).status).toBe(403);
    expect(world.render).not.toHaveBeenCalled();
  });
  it("says clearly that it is switched off, with 503", async () => {
    world.enabled = false;
    const r = await POST(req({ doc }));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("render_disabled");
    expect(world.render).not.toHaveBeenCalled();
  });
  it("rejects bad bodies: invalid JSON, wrong doc, unknown target, http image", async () => {
    expect((await POST(req("{nope"))).status).toBe(400);
    expect((await POST(req({ doc: { version: 2 } }))).status).toBe(400);
    expect((await POST(req({ doc, targets: ["ie6"] }))).status).toBe(400);
    const bad = { ...doc, blocks: [{ type: "avatar", src: "http://10.0.0.1/x.png", alt: "", shape: "circle", size: 80 }] };
    expect((await POST(req({ doc: bad }))).status).toBe(400);
    expect(world.render).not.toHaveBeenCalled();
  });
  it("rejects an oversized body", async () => {
    expect((await POST(req({ doc, pad: "x".repeat(250_000) }))).status).toBe(413);
  });
  it("never takes HTML from the caller: the server renders the validated document", async () => {
    await POST(req({ doc, html: "<script>alert(1)</script>" }));
    const html = world.render.mock.calls[0][0] as string;
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("<table");
  });
});

describe("/api/render success and limits", () => {
  it("returns base64 PNGs labelled real engine or simulation", async () => {
    const r = await POST(req({ doc, targets: ["chromium"], viewports: ["desktop"] }));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.results[0]).toMatchObject({ target: "chromium", badge: "Real engine", mime: "image/png" });
    expect(Buffer.from(j.results[0].png, "base64").equals(PNG)).toBe(true);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("labels simulations Simulation", async () => {
    world.render.mockResolvedValue({ results: [{ target: "outlook-word-sim", viewport: "desktop", engine: "chromium", kind: "simulation", label: "x", width: 1, height: 1, cached: false, png: PNG }], skipped: [] });
    expect((await (await POST(req({ doc }))).json()).results[0].badge).toBe("Simulation");
  });
  it("rate limits per user with Retry-After", async () => {
    const uid = world.user!.id;
    let last: Response | undefined;
    for (let i = 0; i < 8; i++) {
      world.user = { id: uid, email: "a@b.c", email_confirmed_at: "x" };
      last = await POST(req({ doc }));
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get("retry-after")).toBeTruthy();
    world.user = { id: "someone-else", email: "a@b.c", email_confirmed_at: "x" };
    expect((await POST(req({ doc }))).status).toBe(200);
  });
  it("503 busy when the queue is full, 500 without leaking details on failure", async () => {
    world.render.mockRejectedValueOnce(new QueueFull("full"));
    expect((await POST(req({ doc }))).status).toBe(503);
    world.user = { id: "another", email: "a@b.c", email_confirmed_at: "x" };
    world.render.mockRejectedValueOnce(new Error("secret path"));
    const r = await POST(req({ doc }));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret");
  });
  it("GET reports which engines exist", async () => {
    const j = await (await GET()).json();
    expect(j.enabled).toBe(true);
    expect(j.engines.webkit.available).toBe(false);
    expect(j.targets.find((t: { id: string }) => t.id === "outlook-word-sim").kind).toBe("simulation");
  });
});
