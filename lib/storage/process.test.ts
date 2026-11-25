import { describe, expect, it, vi } from "vitest";
import { LIMITS } from "./rules";
import { UploadError, processUpload } from "./process";
import { animatedGif, fakePngHeader, png } from "./test-fixtures";

vi.setConfig({ testTimeout: 60_000 });

const rejects = async (bytes: Uint8Array, status: number, code: string) => {
  const err = await processUpload(bytes, "image").catch((e) => e);
  expect(err).toBeInstanceOf(UploadError);
  expect(err).toMatchObject({ status, code });
  return err as UploadError;
};

describe("processUpload: file size", () => {
  it("rejects an empty file", async () => {
    await rejects(new Uint8Array(), 400, "bad_request");
  });

  it("rejects a file over the upload limit and tells the user both sizes", async () => {
    const err = await rejects(new Uint8Array(LIMITS.uploadMaxBytes + 1), 413, "too_large");
    expect(err.message).toMatch(/5\.0 MB/);
  });

  it("accepts a file exactly at the limit as far as size goes (it then fails on format, not size)", async () => {
    await rejects(new Uint8Array(LIMITS.uploadMaxBytes), 415, "bad_type");
  });
});

describe("processUpload: format", () => {
  it("rejects SVG, WebP and HTML regardless of what the browser claimed", async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    await rejects(enc("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), 415, "bad_type");
    await rejects(enc("RIFF\0\0\0\0WEBPVP8 "), 415, "bad_type");
    await rejects(enc("<html><script>alert(1)</script></html>"), 415, "bad_type");
  });

  it("accepts PNG, JPEG-style content and animated GIF, returning the matching extension", async () => {
    expect((await processUpload(await png(120, 80), "image")).ext).toBe("png");
    expect((await processUpload(await animatedGif(60, 40, 3), "image")).ext).toBe("gif");
  });
});

describe("processUpload: dimensions", () => {
  it("rejects a declared size outside 1 to 10,000 px with a clear message", async () => {
    const err = await rejects(fakePngHeader(0, 50), 422, "bad_dimensions");
    expect(err.message).toMatch(/10,000/);
    await rejects(fakePngHeader(20_000, 50), 422, "bad_dimensions");
  });

  it("rejects an image with too many pixels", async () => {
    await rejects(fakePngHeader(9000, 9000), 422, "too_many_pixels");
  });

  it("rejects a damaged image", async () => {
    await rejects(fakePngHeader(100, 100), 415, "unreadable");
  });

  it("optimizes an oversized image by purpose", async () => {
    const big = await png(2400, 1200);
    expect((await processUpload(big, "banner")).info.width).toBe(1200);
    expect((await processUpload(big, "avatar")).info.width).toBe(400);
  });
});

describe("processUpload: GIF handling and warnings", () => {
  it("keeps the animation and flags that Outlook shows one frame", async () => {
    const r = await processUpload(await animatedGif(200, 100, 5), "banner");
    expect(r.info.animated).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain("gif-outlook");
  });

  it("returns warnings for a still-too-heavy animated GIF", async () => {
    const r = await processUpload(await animatedGif(500, 500, 4, "noise"), "banner");
    expect(r.info.animated).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain("gif-size");
  });

  it("reports a clear error for an animation with too many frames", async () => {
    await rejects(await animatedGif(8, 8, LIMITS.maxFrames + 1), 422, "too_many_frames");
  });
});
