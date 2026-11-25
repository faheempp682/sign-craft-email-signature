import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { sniffImage } from "./image";
import { ImageProcessError, optimizeImage } from "./optimize";
import { LIMITS, assetWarnings, formatBytes } from "./rules";
import { animatedGif, fakePngHeader, jpeg, meta, noisyJpeg, noisyPng, png, solid, staticGif } from "./test-fixtures";

// Encoding incompressible noise is deliberately the slow worst case.
vi.setConfig({ testTimeout: 60_000 });

const run = async (buf: Uint8Array, purpose: "avatar" | "banner" | "image" = "image") => {
  const sniffed = sniffImage(buf);
  if (!sniffed) throw new Error("fixture is not a supported image");
  return optimizeImage(buf, sniffed, purpose);
};

describe("dimensions", () => {
  it("leaves an image alone when it is small enough", async () => {
    const input = await png(300, 200);
    const r = await run(input, "banner");
    expect(r.data).toBe(input); // same bytes, nothing re-encoded
    expect(r.notes).toEqual([]);
    expect(r.info).toMatchObject({ width: 300, height: 200, bytes: input.length, animated: false });
  });

  it("downsizes an oversized banner to 1200 px on the longest side, keeping the aspect ratio", async () => {
    const r = await run(await png(3000, 1000), "banner");
    expect(await meta(r.data)).toMatchObject({ width: 1200, height: 400 });
    expect(r.info).toMatchObject({ width: 1200, height: 400 });
    expect(r.notes.join(" ")).toContain("3000×1000 to 1200×400");
  });

  it("uses a smaller limit for avatars (400 px)", async () => {
    const r = await run(await png(1000, 1000), "avatar");
    expect(r.info).toMatchObject({ width: LIMITS.maxSide.avatar, height: LIMITS.maxSide.avatar });
  });

  it("limits the longest side whether it is the width or the height", async () => {
    const r = await run(await png(500, 2000), "avatar");
    expect(r.info).toMatchObject({ width: 100, height: 400 });
  });

  it("never enlarges a small image", async () => {
    const r = await run(await png(100, 100), "avatar");
    expect(r.info).toMatchObject({ width: 100, height: 100 });
  });
});

describe("file size", () => {
  it("shrinks a heavy PNG below its original size and says what it did", async () => {
    const input = await noisyPng(1000, 700); // noise: several MB
    expect(input.length).toBeGreaterThan(LIMITS.staticWarnBytes);
    const r = await run(input, "banner");
    expect(r.data.length).toBeLessThan(input.length);
    expect(r.info.bytes).toBe(r.data.length);
    expect(r.info.originalBytes).toBe(input.length);
    expect(r.notes.join(" ")).toMatch(/File size .* → /);
  });

  it("never returns a larger file than it was given when no resize is needed", async () => {
    const input = await png(200, 200); // a tiny, already optimal solid PNG
    const r = await run(input, "banner");
    expect(r.data.length).toBeLessThanOrEqual(input.length);
  });

  it("reports what is still too heavy afterwards instead of hiding it", async () => {
    const r = await run(await noisyPng(1200, 800), "banner"); // incompressible: cannot get under 200 KB
    if (r.info.bytes > LIMITS.staticWarnBytes) expect(assetWarnings(r.info).map((w) => w.code)).toContain("image-size");
  });

  it("recompresses a heavy JPEG at lower quality and discloses it", async () => {
    const input = await noisyJpeg(1200, 800);
    expect(input.length).toBeGreaterThan(LIMITS.staticWarnBytes);
    const r = await run(input, "banner");
    expect(r.data.length).toBeLessThan(input.length);
    expect(r.notes.join(" ")).toMatch(/Recompressed at quality/);
  });
});

describe("format is preserved", () => {
  it.each([
    ["PNG", () => noisyPng(1600, 900), "image/png", "png"],
    ["JPEG", () => noisyJpeg(1600, 900), "image/jpeg", "jpeg"],
    ["static GIF", () => staticGif(1600, 900), "image/gif", "gif"],
  ])("%s stays %s after optimizing", async (_name, make, mime, fmt) => {
    const r = await run(await make(), "banner");
    expect(r.info.type).toBe(mime);
    expect(sniffImage(r.data)?.type).toBe(mime);
    expect((await meta(r.data)).format).toBe(fmt);
  });
});

describe("JPEG privacy and orientation", () => {
  it("strips camera metadata and applies the rotation", async () => {
    // 300x200 stored with EXIF orientation 6 (rotate 90 degrees): it should come out 200x300 with no EXIF.
    const input = await solid(300, 200).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "secret-camera" } } }).toBuffer();
    expect((await meta(input)).exif).toBeDefined();
    const r = await run(input, "banner");
    const out = await meta(r.data);
    expect(out.exif).toBeUndefined();
    expect(r.info).toMatchObject({ width: 200, height: 300 });
    expect(r.notes.join(" ")).toMatch(/Removed camera metadata/);
  });
});

describe("animated GIFs keep their animation", () => {
  it("returns a small animation byte-for-byte unchanged", async () => {
    const input = await animatedGif(120, 80, 4);
    const r = await run(input, "banner");
    expect(r.data).toBe(input);
    expect(r.info.animated).toBe(true);
    expect((await meta(r.data)).pages).toBe(4);
  });

  it("keeps every frame when resizing an oversized animation", async () => {
    const input = await animatedGif(1600, 900, 3);
    const before = await meta(input);
    expect(before.pages).toBe(3);
    const r = await run(input, "banner");
    const after = await meta(r.data);
    expect(after.pages).toBe(3);
    expect(after).toMatchObject({ width: 1200, height: 675, format: "gif" });
    expect(r.info).toMatchObject({ animated: true, width: 1200, height: 675 });
    expect(r.notes.join(" ")).toContain("Kept all 3 frames");
  });

  it("keeps the loop setting and frame timing", async () => {
    const frames = await Promise.all([0, 1, 2].map((i) => solid(1500, 500, [i * 90, 50, 200]).png().toBuffer()));
    const input = await sharp(frames, { join: { animated: true } }).gif({ loop: 0, delay: [120, 240, 360] }).toBuffer();
    const before = await meta(input);
    expect(before.loop).toBe(0);
    const r = await run(input, "banner");
    const after = await meta(r.data);
    expect(after.pages).toBe(3);
    expect(after.loop).toBe(0);
    expect(after.delay).toEqual(before.delay);
  });

  it("never turns an animation into a still image, even when it cannot get it under the limit", async () => {
    const input = await animatedGif(500, 500, 4, "noise"); // incompressible noise frames: far over 300 KB
    expect(input.length).toBeGreaterThan(LIMITS.gifWarnBytes);
    const r = await run(input, "banner");
    expect((await meta(r.data)).pages).toBe(4);
    expect(r.info.animated).toBe(true);
    // Whatever is still too big is reported with its real size, not silently accepted.
    if (r.info.bytes > LIMITS.gifWarnBytes) {
      const w = assetWarnings(r.info).find((x) => x.code === "gif-size");
      expect(w).toBeDefined();
      expect(w!.message).toContain(formatBytes(r.info.bytes));
    }
  });

  it("discloses any quality it gives up to shrink an animation", async () => {
    const input = await animatedGif(500, 500, 4, "noise");
    const r = await run(input, "banner");
    if (r.info.bytes < input.length) expect(r.notes.join(" ")).toMatch(/palette|Resized|File size/);
  });
});

describe("rejects images it cannot safely process", () => {
  it("rejects a damaged file whose header looks fine", async () => {
    const bad = fakePngHeader(100, 100); // valid signature and size, no pixel data
    await expect(optimizeImage(bad, sniffImage(bad)!, "image")).rejects.toMatchObject({ code: "unreadable" });
  });

  it("rejects an image with too many pixels", async () => {
    const huge = fakePngHeader(9000, 9000); // 81 million pixels
    await expect(optimizeImage(huge, sniffImage(huge)!, "image")).rejects.toMatchObject({ code: "too_many_pixels" });
  });

  it("rejects an animation with too many frames", async () => {
    const long = await animatedGif(8, 8, LIMITS.maxFrames + 1);
    await expect(optimizeImage(long, sniffImage(long)!, "image")).rejects.toBeInstanceOf(ImageProcessError);
    await expect(optimizeImage(long, sniffImage(long)!, "image")).rejects.toMatchObject({ code: "too_many_frames" });
  });
});

describe("fixtures", () => {
  it("build readable plain JPEGs", async () => {
    expect((await meta(await jpeg(64, 64))).format).toBe("jpeg");
  });
});
