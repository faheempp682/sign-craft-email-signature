import { describe, expect, it, vi } from "vitest";
import { sniffImage } from "./image";
import { getBunnyConfig, uploadToBunny } from "./bunny";
import { fitBanner } from "../editor/upload";
import { isEmailAllowed, safeNext } from "../supabase/auth-utils";

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const gif = (w: number, h: number) => {
  const b = new Uint8Array(16);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  new DataView(b.buffer).setUint16(6, w, true);
  new DataView(b.buffer).setUint16(8, h, true);
  return b;
};
// SOI, an APP0 segment to skip, then SOF0 with height 90 and width 120.
const jpg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x5a, 0x00, 0x78, 0x03, 0x01, 0x22, 0x00]);

describe("sniffImage", () => {
  it("reads PNG, GIF and JPEG sizes from the bytes", () => {
    expect(sniffImage(png(160, 80))).toMatchObject({ type: "image/png", ext: "png", width: 160, height: 80 });
    expect(sniffImage(gif(300, 100))).toMatchObject({ type: "image/gif", ext: "gif", width: 300, height: 100 });
    expect(sniffImage(jpg())).toMatchObject({ type: "image/jpeg", ext: "jpg", width: 120, height: 90 });
  });
  it("rejects SVG, WebP, HTML and empty input regardless of any claimed type", () => {
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("RIFF....WEBPVP8 "))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
  it("rejects zero or absurd dimensions", () => {
    expect(sniffImage(png(0, 10))).toBeNull();
    expect(sniffImage(png(50_000, 10))).toBeNull();
  });
});

describe("bunny", () => {
  it("needs zone, key and CDN url, and trims the trailing slash", () => {
    expect(getBunnyConfig({})).toBeNull();
    expect(getBunnyConfig({ BUNNY_STORAGE_ZONE: "z", BUNNY_STORAGE_ACCESS_KEY: "k" })).toBeNull();
    expect(getBunnyConfig({ BUNNY_STORAGE_ZONE: "z", BUNNY_STORAGE_ACCESS_KEY: "k", BUNNY_CDN_URL: "https://z.b-cdn.net/" })).toEqual({
      zone: "z", accessKey: "k", cdnUrl: "https://z.b-cdn.net", host: "storage.bunnycdn.com",
    });
  });
  it("PUTs to the storage API with the AccessKey header and returns the CDN url", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    const cfg = { zone: "z", accessKey: "secret", host: "ny.storage.bunnycdn.com", cdnUrl: "https://z.b-cdn.net" };
    const url = await uploadToBunny(cfg, "u1/a.png", new Uint8Array([1]), fetchMock as unknown as typeof fetch);
    expect(url).toBe("https://z.b-cdn.net/u1/a.png");
    const [target, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe("https://ny.storage.bunnycdn.com/z/u1/a.png");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).AccessKey).toBe("secret");
  });
  it("throws when Bunny rejects the upload", async () => {
    const cfg = { zone: "z", accessKey: "bad", host: "storage.bunnycdn.com", cdnUrl: "https://z.b-cdn.net" };
    await expect(uploadToBunny(cfg, "a.png", new Uint8Array([1]), (async () => new Response(null, { status: 401 })) as unknown as typeof fetch)).rejects.toThrow("401");
  });
});

describe("fitBanner", () => {
  it("keeps the aspect ratio and caps the width", () => {
    expect(fitBanner(1200, 300)).toEqual({ width: 600, height: 150 });
    expect(fitBanner(400, 100)).toEqual({ width: 400, height: 100 });
    expect(fitBanner(0, 0)).toBeNull();
  });
});

describe("auth utils", () => {
  it("only allows same-site relative redirects", () => {
    expect(safeNext("/editor?s=1")).toBe("/editor?s=1");
    expect(safeNext("//evil.com")).toBe("/create");
    expect(safeNext("https://evil.com")).toBe("/create");
    expect(safeNext("/\\evil.com")).toBe("/create");
    expect(safeNext(undefined)).toBe("/create");
  });
  it("applies the optional email-domain allowlist", () => {
    expect(isEmailAllowed("a@x.com", "")).toBe(true);
    expect(isEmailAllowed("a@kimp.xyz", "kimp.xyz, other.com")).toBe(true);
    expect(isEmailAllowed("a@gmail.com", "kimp.xyz")).toBe(false);
    expect(isEmailAllowed("nodomain", "kimp.xyz")).toBe(false);
  });
});
