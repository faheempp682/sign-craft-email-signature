/** Test-only helpers that build real image files with sharp. Never imported by app code. */
import { randomBytes } from "node:crypto";
import sharp from "sharp";

export const solid = (w: number, h: number, rgb: [number, number, number] = [30, 90, 200]) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } });

/** Random-noise raw RGB: incompressible, so it produces genuinely large files. */
export const noise = (w: number, h: number) => sharp(randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } });

export const png = (w: number, h: number) => solid(w, h).png().toBuffer();
export const noisyPng = (w: number, h: number) => noise(w, h).png().toBuffer();
export const jpeg = (w: number, h: number) => solid(w, h).jpeg().toBuffer();
export const noisyJpeg = (w: number, h: number) => noise(w, h).jpeg({ quality: 95 }).toBuffer();
export const staticGif = (w: number, h: number) => solid(w, h).gif().toBuffer();

/** Animated GIF with `frames` frames, each a different solid colour (tiny) or random noise (large). */
export async function animatedGif(w: number, h: number, frames: number, kind: "solid" | "noise" = "solid"): Promise<Buffer> {
  const frame = (i: number) => (kind === "noise" ? noise(w, h).png().toBuffer() : solid(w, h, [(i * 70) % 256, (i * 130) % 256, (i * 200) % 256]).png().toBuffer());
  const list = await Promise.all(Array.from({ length: frames }, (_, i) => frame(i)));
  return sharp(list, { join: { animated: true } }).gif().toBuffer();
}

export async function meta(buf: Uint8Array) {
  const m = await sharp(buf, { animated: true }).metadata();
  return { format: m.format, width: m.width!, height: m.pageHeight ?? m.height!, pages: m.pages ?? 1, loop: m.loop, delay: m.delay, exif: m.exif };
}

/** A header-only PNG that claims huge dimensions without containing the pixels. */
export const fakePngHeader = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
