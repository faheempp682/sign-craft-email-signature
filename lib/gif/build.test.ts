import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/storage/rules";
import { fakePngHeader, jpeg, meta, noisyPng, png, solid } from "@/lib/storage/test-fixtures";
import { buildGif } from "./build";
import { GIF_LIMITS, GifOptionsSchema, sizeLevel } from "./limits";

const opts = (n: number, over: Partial<{ delays: number[]; loop: number; width: number; height: number }> = {}) => ({
  delays: Array.from({ length: n }, () => 500),
  loop: 0,
  width: 200,
  height: 100,
  ...over,
});

const colourFrame = (w: number, h: number, rgb: [number, number, number]) => solid(w, h, rgb).png().toBuffer();

/** Reads the colour of the pixel at (x, y) of one frame of a (possibly animated) GIF. */
async function pixel(gif: Uint8Array, frame: number, x: number, y: number) {
  const { data, info } = await sharp(gif, { animated: true }).raw().toBuffer({ resolveWithObject: true });
  const frameH = info.pageHeight ?? info.height;
  const i = ((frame * frameH + y) * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

describe("buildGif", () => {
  it("builds a real animated GIF with one frame per input, the requested size, delays and loop", async () => {
    const frames = [await colourFrame(200, 100, [255, 0, 0]), await colourFrame(200, 100, [0, 255, 0]), await colourFrame(200, 100, [0, 0, 255])];
    const out = await buildGif(frames, opts(3, { delays: [200, 800, 1500], loop: 3 }));
    const m = await meta(out.data);
    expect(m.format).toBe("gif");
    expect(m.pages).toBe(3);
    expect([m.width, m.height]).toEqual([200, 100]);
    expect(m.delay).toEqual([200, 800, 1500]);
    expect(m.loop).toBe(3);
    expect(out.frames).toBe(3);
    expect(out.bytes).toBe(out.data.length);
  });

  it("keeps frames in the order given", async () => {
    const out = await buildGif([await colourFrame(100, 100, [255, 0, 0]), await colourFrame(100, 100, [0, 0, 255])], opts(2, { width: 100, height: 100 }));
    const first = await pixel(out.data, 0, 50, 50);
    const second = await pixel(out.data, 1, 50, 50);
    expect(first[0]).toBeGreaterThan(200); // red first
    expect(second[2]).toBeGreaterThan(200); // blue second
  });

  it("letterboxes a differently shaped frame onto white instead of stretching or cropping it", async () => {
    // A tall green frame in a 200x100 canvas: bars left and right must be white, the middle green.
    const tall = await colourFrame(50, 100, [0, 200, 0]);
    const out = await buildGif([tall, tall], opts(2));
    const left = await pixel(out.data, 0, 5, 50);
    const mid = await pixel(out.data, 0, 100, 50);
    expect(left.every((v) => v > 240)).toBe(true);
    expect(mid[1]).toBeGreaterThan(150);
    expect(mid[0]).toBeLessThan(60);
  });

  it("flattens transparency onto white so the first frame is complete on its own", async () => {
    const transparent = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await buildGif([transparent, transparent], opts(2, { width: 100, height: 100 }));
    expect((await pixel(out.data, 0, 10, 10)).every((v) => v > 240)).toBe(true);
  });

  it("accepts a mix of PNG and JPEG, and uses only the first frame of a GIF input", async () => {
    const gifIn = await sharp(await colourFrame(100, 100, [10, 10, 200])).gif().toBuffer();
    const out = await buildGif([await png(120, 60), await jpeg(300, 200), gifIn], opts(3));
    expect((await meta(out.data)).pages).toBe(3);
  });

  it("drops colours only when the file is over the 300 KB guideline", async () => {
    const small = await buildGif([await colourFrame(100, 50, [1, 2, 3]), await colourFrame(100, 50, [9, 9, 9])], opts(2, { width: 100, height: 50 }));
    expect(small.colours).toBe(256);
    const big = await buildGif([await noisyPng(600, 300), await noisyPng(600, 300), await noisyPng(600, 300)], opts(3, { width: 600, height: 300 }));
    expect(big.colours).toBeLessThan(256);
  }, 30_000);

  it("refuses an output over the hard cap", async () => {
    const limits = GIF_LIMITS as { maxOutputBytes: number };
    const before = limits.maxOutputBytes;
    limits.maxOutputBytes = 500; // the runtime object is a plain mutable object; `as const` is type-only
    try {
      const f = await noisyPng(200, 100);
      await expect(buildGif([f, f], opts(2))).rejects.toMatchObject({ code: "output_too_large", status: 422 });
    } finally {
      limits.maxOutputBytes = before;
    }
  });

  it("rejects the wrong number of frames or delays", async () => {
    const f = await png(100, 100);
    await expect(buildGif([f], opts(1))).rejects.toMatchObject({ code: "bad_frame" });
    await expect(buildGif(Array(7).fill(f), opts(7))).rejects.toMatchObject({ code: "bad_frame" });
    await expect(buildGif([f, f], opts(2, { delays: [500] }))).rejects.toMatchObject({ code: "bad_frame" });
  });

  it("rejects non-images, damaged images and pixel bombs", async () => {
    const f = await png(100, 100);
    await expect(buildGif([f, new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")], opts(2))).rejects.toMatchObject({ code: "bad_frame" });
    await expect(buildGif([f, fakePngHeader(9000, 9000)], opts(2))).rejects.toMatchObject({ code: "too_many_pixels" });
    const damaged = new Uint8Array(f.subarray(0, 40)); // valid header, truncated data
    await expect(buildGif([f, damaged], opts(2))).rejects.toMatchObject({ code: "unreadable" });
  });
});

describe("GifOptionsSchema", () => {
  const ok = { delays: [500, 500], loop: 0, width: 400, height: 100 };
  it("accepts good options", () => expect(GifOptionsSchema.safeParse(ok).success).toBe(true));
  it("rejects out-of-range values and unknown keys", () => {
    for (const bad of [
      { ...ok, delays: [50, 500] },
      { ...ok, delays: [500, 99_999] },
      { ...ok, delays: [500] },
      { ...ok, delays: Array(7).fill(500) },
      { ...ok, delays: [500.5, 500] },
      { ...ok, loop: -1 },
      { ...ok, loop: 11 },
      { ...ok, width: 99 },
      { ...ok, width: 601 },
      { ...ok, height: 19 },
      { ...ok, height: 301 },
      { ...ok, extra: 1 },
    ]) {
      expect(GifOptionsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("sizeLevel", () => {
  it("uses the guideline numbers from the storage rules", () => {
    expect(sizeLevel(LIMITS.gifWarnBytes, LIMITS.gifWarnBytes, LIMITS.gifErrorBytes)).toBe("ok");
    expect(sizeLevel(LIMITS.gifWarnBytes + 1, LIMITS.gifWarnBytes, LIMITS.gifErrorBytes)).toBe("warning");
    expect(sizeLevel(LIMITS.gifErrorBytes + 1, LIMITS.gifWarnBytes, LIMITS.gifErrorBytes)).toBe("error");
  });
});
