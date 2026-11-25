import sharp, { type Metadata } from "sharp";
import type { ImageInfo } from "./image";
import { LIMITS, formatBytes, type AssetInfo, type UploadPurpose } from "./rules";

export type OptimizeResult = {
  data: Uint8Array;
  info: AssetInfo;
  /** Plain-language list of everything that was changed, shown to the user. Empty when the file was kept as is. */
  notes: string[];
};

export class ImageProcessError extends Error {
  constructor(
    public code: "unreadable" | "too_many_frames" | "too_many_pixels",
    message: string,
  ) {
    super(message);
  }
}

const open = (input: Uint8Array, animated: boolean) => sharp(input, { animated, limitInputPixels: LIMITS.maxPixels, failOn: "error" });

/**
 * Shrinks an uploaded image for email, keeping its format. Rules:
 *  - Never converts between formats, and never flattens an animated GIF (frames, timing and looping are kept).
 *  - Resizes only when the longest side exceeds the limit for how the image is used (avatar / banner).
 *  - Recompresses only when the file is over its size guideline, and says so when it lowers quality.
 *  - Never returns a larger file than it was given, unless a resize made it necessary.
 *  - JPEGs always get camera metadata (including GPS location) removed and their rotation applied.
 * Anything still over a guideline afterwards is reported by `assetWarnings`, not hidden.
 */
export async function optimizeImage(input: Uint8Array, sniffed: ImageInfo, purpose: UploadPurpose): Promise<OptimizeResult> {
  // Fail fast on the size the header declares, before any decoding work.
  if (sniffed.width * sniffed.height > LIMITS.maxPixels) throw new ImageProcessError("too_many_pixels", "That image has too many pixels. Resize it to under about 7000×7000 and try again.");

  let meta: Metadata;
  try {
    meta = await open(input, true).metadata(); // animated:true makes height/pageHeight describe a single frame
  } catch (e) {
    if (e instanceof Error && /pixel limit/i.test(e.message)) throw new ImageProcessError("too_many_pixels", "That image has too many pixels. Resize it to under about 7000×7000 and try again.");
    throw new ImageProcessError("unreadable", "That file could not be read as an image. It may be damaged.");
  }

  const frames = meta.pages ?? 1;
  const animated = sniffed.type === "image/gif" && frames > 1;
  const frameW = meta.width ?? sniffed.width;
  const frameH = meta.pageHeight ?? meta.height ?? sniffed.height;

  if (frames > LIMITS.maxFrames) throw new ImageProcessError("too_many_frames", `That animation has ${frames} frames. The limit is ${LIMITS.maxFrames}. Shorten it and try again.`);
  if (frameW * frameH * frames > LIMITS.maxPixels) throw new ImageProcessError("too_many_pixels", "That image has too many pixels. Resize it to under about 7000×7000 and try again.");

  // The header can look fine while the pixel data is damaged, and files that need no changes are never decoded below.
  // Decode once up front so a broken file is rejected instead of being stored as-is.
  try {
    await open(input, animated).resize(1, 1, { fit: "fill" }).toBuffer();
  } catch {
    throw new ImageProcessError("unreadable", "That file could not be read as an image. It may be damaged.");
  }

  const maxSide = LIMITS.maxSide[purpose];
  const scale = Math.min(1, maxSide / Math.max(frameW, frameH));
  const resized = scale < 1;
  const target = resized ? { width: Math.max(1, Math.round(frameW * scale)), height: Math.max(1, Math.round(frameH * scale)) } : null;

  const notes: string[] = [];
  if (resized) notes.push(`Resized from ${frameW}×${frameH} to ${target!.width}×${target!.height} px (longest side limit for this image is ${maxSide} px).`);

  /** A fresh pipeline each time: sharp pipelines are single-use. */
  const pipeline = () => {
    let p = open(input, animated);
    if (sniffed.type === "image/jpeg") p = p.rotate(); // apply EXIF orientation before the metadata is dropped
    return target ? p.resize(target.width, target.height, { fit: "fill" }) : p;
  };

  const keepOriginal = (extra?: string): OptimizeResult => ({
    data: input,
    info: { type: sniffed.type, bytes: input.length, width: frameW, height: frameH, animated },
    notes: extra ? [extra] : [],
  });

  let out: Uint8Array;

  if (sniffed.type === "image/gif") {
    const limit = animated ? LIMITS.gifWarnBytes : LIMITS.staticWarnBytes;
    if (!resized && input.length <= limit) return keepOriginal();

    // Try the full palette first; drop colours only while the file is still over its size guideline.
    let best: Uint8Array | null = null;
    let usedColours = 256;
    for (const colours of [256, 128, 64, 32]) {
      const buf = await pipeline().gif({ effort: 5, colours }).toBuffer();
      if (!best || buf.length < best.length) {
        best = buf;
        usedColours = colours;
      }
      if (buf.length <= limit) break;
    }
    out = best!;
    if (usedColours < 256) notes.push(`Reduced the palette to ${usedColours} colours to shrink the file.`);
  } else if (sniffed.type === "image/png") {
    if (!resized && input.length <= LIMITS.staticWarnBytes) return keepOriginal();
    out = await pipeline().png({ compressionLevel: 9, effort: 4 }).toBuffer();
    if (out.length > LIMITS.staticWarnBytes) {
      const palette = await pipeline().png({ compressionLevel: 9, effort: 4, palette: true, quality: 85 }).toBuffer();
      if (palette.length < out.length) {
        out = palette;
        notes.push("Reduced to a 256-colour palette to shrink the file. Gradients may look slightly less smooth.");
      }
    }
  } else {
    // JPEG: always re-encoded, so location and camera data are removed.
    let quality = 85;
    out = await pipeline().jpeg({ quality, mozjpeg: true }).toBuffer();
    while (out.length > LIMITS.staticWarnBytes && quality > 65) {
      quality -= 10;
      out = await pipeline().jpeg({ quality, mozjpeg: true }).toBuffer();
    }
    if (quality < 85) notes.push(`Recompressed at quality ${quality} to shrink the file.`);
    if (meta.exif) notes.push("Removed camera metadata (including any GPS location) and applied the photo's rotation.");
  }

  // Never make the file bigger unless a resize forced it, and keep JPEG's privacy stripping regardless.
  if (!resized && out.length >= input.length && sniffed.type !== "image/jpeg") return keepOriginal();

  // Guard: whatever came out must still be animated if it went in animated. Otherwise keep the original untouched.
  let outMeta: Metadata;
  try {
    outMeta = await open(out, true).metadata();
  } catch {
    return keepOriginal("Optimization failed, so the original file was kept.");
  }
  const outFrames = outMeta.pages ?? 1;
  if (animated && outFrames !== frames) {
    return keepOriginal("Optimizing would have changed the animation, so the original file was kept.");
  }
  if (animated) notes.push(`Kept all ${frames} frames of the animation.`);

  if (out.length < input.length) notes.push(`File size ${formatBytes(input.length)} → ${formatBytes(out.length)}.`);

  return {
    data: out,
    info: {
      type: sniffed.type,
      bytes: out.length,
      width: outMeta.width ?? frameW,
      height: outMeta.pageHeight ?? outMeta.height ?? frameH,
      animated: outFrames > 1,
      originalBytes: input.length,
    },
    notes,
  };
}
