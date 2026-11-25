import sharp from "sharp";
import { sniffImage } from "@/lib/storage/image";
import { LIMITS } from "@/lib/storage/rules";
import { GIF_LIMITS, type GifOptions } from "./limits";

export class GifError extends Error {
  constructor(
    public code: "bad_frame" | "too_many_pixels" | "unreadable" | "output_too_large",
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

export type BuiltGif = { data: Buffer; bytes: number; colours: number; frames: number };

const WHITE = { r: 255, g: 255, b: 255 };

/** Turns one uploaded still into a width x height PNG: upright, letterboxed onto white (never stretched or cropped). */
async function normaliseFrame(bytes: Uint8Array, index: number, width: number, height: number): Promise<Buffer> {
  const sniffed = sniffImage(bytes);
  if (!sniffed) throw new GifError("bad_frame", `Frame ${index + 1} is not a PNG, JPEG or GIF image.`);
  if (sniffed.width * sniffed.height > GIF_LIMITS.maxFramePixels) throw new GifError("too_many_pixels", `Frame ${index + 1} has too many pixels. Use an image under about 3500×3500.`);
  try {
    return await sharp(bytes, { limitInputPixels: GIF_LIMITS.maxFramePixels, failOn: "error" }) // animated: false, so a GIF contributes its first frame only
      .rotate() // apply EXIF orientation (JPEG)
      .resize(width, height, { fit: "contain", background: WHITE })
      .flatten({ background: WHITE }) // transparency becomes white, so every frame is complete on its own
      .png()
      .toBuffer();
  } catch {
    throw new GifError("unreadable", `Frame ${index + 1} could not be read as an image. It may be damaged.`);
  }
}

/**
 * Assembles an animated GIF from 2 to 6 still images. All frames end up the same size (letterboxed on white).
 * Starts with the full 256-colour palette and only drops colours (down to 16) while the file is over the 300 KB guideline.
 * Refuses (output_too_large) when even the smallest result is over GIF_LIMITS.maxOutputBytes.
 */
export async function buildGif(frames: Uint8Array[], opts: GifOptions): Promise<BuiltGif> {
  if (frames.length < GIF_LIMITS.minFrames || frames.length > GIF_LIMITS.maxFrames) throw new GifError("bad_frame", `Use between ${GIF_LIMITS.minFrames} and ${GIF_LIMITS.maxFrames} frames.`, 400);
  if (opts.delays.length !== frames.length) throw new GifError("bad_frame", "There must be one delay per frame.", 400);

  const pngs: Buffer[] = [];
  for (let i = 0; i < frames.length; i++) pngs.push(await normaliseFrame(frames[i], i, opts.width, opts.height));

  let best: Buffer | null = null;
  let colours = 256;
  for (const c of [256, 128, 64, 32, 16]) {
    const buf = await sharp(pngs, { join: { animated: true } })
      .gif({ delay: opts.delays, loop: opts.loop, colours: c, effort: 5 })
      .toBuffer();
    if (!best || buf.length < best.length) {
      best = buf;
      colours = c;
    }
    if (buf.length <= LIMITS.gifWarnBytes) break;
  }
  if (!best || best.length > GIF_LIMITS.maxOutputBytes) throw new GifError("output_too_large", "The animation is too large even with fewer colours. Use fewer or simpler frames, or a smaller size.");
  return { data: best, bytes: best.length, colours, frames: frames.length };
}
