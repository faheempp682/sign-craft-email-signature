import { afterEach, describe, expect, it, vi } from "vitest";
import { getPreset } from "@/lib/presets";
import type { SignatureDoc } from "@/lib/schema/document";
import { exportHtml, hasTrackedBanner } from "./export-html";

const plain = getPreset("classic")!.doc;
const tracked: SignatureDoc = { ...plain, blocks: [...plain.blocks, { type: "banner", src: "https://cdn.example.com/b.png", alt: "Promo", href: "https://example.com/x", width: 400, height: 100, track: true }] };
const ID = "6f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";

afterEach(() => vi.unstubAllGlobals());

describe("hasTrackedBanner", () => {
  it("is true only for a banner with track: true", () => {
    expect(hasTrackedBanner(plain)).toBe(false);
    expect(hasTrackedBanner(tracked)).toBe(true);
    const off = { ...tracked, blocks: tracked.blocks.map((b) => (b.type === "banner" ? { ...b, track: false } : b)) } as SignatureDoc;
    expect(hasTrackedBanner(off)).toBe(false);
  });
});

describe("exportHtml", () => {
  it("returns the local HTML untouched, with no request, when nothing is tracked", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await exportHtml(plain, "<p>local</p>", null)).toEqual({ ok: true, html: "<p>local</p>" });
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses to export a tracked banner from an unsaved signature, and says why", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await exportHtml(tracked, "<p>local</p>", null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Save it first/);
    expect(f).not.toHaveBeenCalled();
  });

  it("asks the server for the signed HTML for a saved signature", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ html: "<p>tracked</p>", tracked: true })));
    vi.stubGlobal("fetch", f);
    expect(await exportHtml(tracked, "<p>local</p>", ID)).toEqual({ ok: true, html: "<p>tracked</p>" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/campaigns/render");
    expect(JSON.parse(String(init.body))).toMatchObject({ signature_id: ID });
  });

  it("never exports an untracked banner as if it were tracked (server not set up)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ html: "<p>plain</p>", tracked: false }))));
    const r = await exportHtml(tracked, "<p>local</p>", ID);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/not set up/);
  });

  it("explains server and network failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "That signature does not exist." }), { status: 404 })));
    const r1 = await exportHtml(tracked, "x", ID);
    expect(!r1.ok && r1.message).toBe("That signature does not exist.");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    const r2 = await exportHtml(tracked, "x", ID);
    expect(!r2.ok && r2.message).toMatch(/Could not reach the server/);
  });
});
