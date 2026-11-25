import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ card: null as null | Record<string, unknown> }));
vi.mock("@/lib/cards/public", async (orig) => ({ ...(await orig<typeof import("@/lib/cards/public")>()), fetchPublicCard: vi.fn(async (slug: string) => (state.card && state.card.slug === slug ? state.card : null)) }));

import { resetRateLimits } from "@/lib/cards/rate-limit";
import { GET as qr } from "./[slug]/qr/route";
import { GET as vcard } from "./[slug]/vcard/route";

const CARD = { slug: "ada-lovelace", display_name: "Ada Lovelace", title: null, company: null, bio: null, photo_url: null, phone: "+1 555 0100", email: "ada@example.com", website: null, address: null, social_links: [], booking_url: null, accent_color: "#111111", indexable: false };
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const req = (path: string, ip = "9.9.9.9") => new Request(`https://sign.example.com${path}`, { headers: { host: "sign.example.com", "x-forwarded-for": ip } });

beforeEach(() => {
  state.card = { ...CARD };
  resetRateLimits();
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("GET /c/[slug]/vcard", () => {
  it("serves a vCard with the right headers and a safe filename", async () => {
    const res = await vcard(req("/c/ada-lovelace/vcard"), ctx("ada-lovelace"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/vcard; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ada-lovelace.vcf"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toMatch(/max-age=60/);
    const body = await res.text();
    expect(body.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(body).toContain("URL;TYPE=OTHER:https://sign.example.com/c/ada-lovelace");
  });

  it("answers 404 for a missing or unpublished card, identically", async () => {
    state.card = null;
    const a = await vcard(req("/c/nope/vcard"), ctx("nope"));
    expect(a.status).toBe(404);
    expect(await a.text()).toBe("Not found");
  });

  it("rate limits a caller, per address", async () => {
    for (let i = 0; i < 30; i++) expect((await vcard(req("/x"), ctx("ada-lovelace"))).status).toBe(200);
    const blocked = await vcard(req("/x"), ctx("ada-lovelace"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await vcard(req("/x", "8.8.8.8"), ctx("ada-lovelace"))).status).toBe(200);
  });
});

describe("GET /c/[slug]/qr", () => {
  it("returns an SVG of the card address by default", async () => {
    const res = await qr(req("/c/ada-lovelace/qr"), ctx("ada-lovelace"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await res.text()).toMatch(/^<\?xml|^<svg/);
  });

  it("returns a PNG when asked, and clamps the size", async () => {
    const res = await qr(req("/c/ada-lovelace/qr?format=png&size=99999&download=1"), ctx("ada-lovelace"));
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ada-lovelace-qr.png"');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const width = new DataView(buf.buffer).getUint32(16);
    expect(width).toBeLessThanOrEqual(1024);
  });

  it("404s for a card that is not published", async () => {
    state.card = null;
    expect((await qr(req("/c/x/qr"), ctx("x"))).status).toBe(404);
  });

  it("is rate limited", async () => {
    for (let i = 0; i < 60; i++) await qr(req("/x"), ctx("ada-lovelace"));
    expect((await qr(req("/x"), ctx("ada-lovelace"))).status).toBe(429);
  });
});

describe("QR content", () => {
  it("the PNG really encodes the card address (modules read back from the pixels match the library's matrix)", async () => {
    // @ts-expect-error pngjs ships no types (test-only use)
    const { PNG } = (await import("pngjs")) as unknown as { PNG: { sync: { read: (b: Buffer) => { width: number; data: Uint8Array } } } };
    const QRCode = (await import("qrcode")).default;
    process.env.NEXT_PUBLIC_SITE_URL = "https://cards.example.org";
    const res = await qr(req("/c/ada-lovelace/qr?format=png&size=600"), ctx("ada-lovelace"));
    const img = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    const m = QRCode.create("https://cards.example.org/c/ada-lovelace", { errorCorrectionLevel: "M" }).modules;
    const n = m.size;
    const cell = img.width / (n + 4);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const px = Math.round((x + 2 + 0.5) * cell);
        const py = Math.round((y + 2 + 0.5) * cell);
        const dark = img.data[(py * img.width + px) * 4] < 128;
        expect(dark).toBe(Boolean(m.get(y, x)));
      }
  });

  it("encodes a different address when the card address differs (so the test above can fail)", async () => {
    const QRCode = (await import("qrcode")).default;
    const a = QRCode.create("https://cards.example.org/c/ada-lovelace", { errorCorrectionLevel: "M" }).modules.data.join();
    const b = QRCode.create("https://cards.example.org/c/ada-lovelace2", { errorCorrectionLevel: "M" }).modules.data.join();
    expect(a).not.toBe(b);
  });
});
