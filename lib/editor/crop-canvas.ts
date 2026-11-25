/** Browser-only canvas work for the cropper: decoding (with EXIF rotation), downscaling huge images, and drawing the result. */

import { sniffImage } from "@/lib/storage/image";
import { LIMITS } from "@/lib/storage/rules";
import { WORKING_MAX_SIDE, croppedName, outputType, workingScale, type Rect, type Size } from "./crop";

export type CropSource = {
  /** Something drawImage accepts, already rotated upright and no larger than WORKING_MAX_SIDE. */
  drawable: CanvasImageSource;
  width: number;
  height: number;
  /** MIME type of the file the person picked. */
  type: string;
  name: string;
  /** Releases the decoded pixels. */
  close: () => void;
};

export class CropLoadError extends Error {}

const MSG_UNREADABLE = "That file could not be opened as an image.";

async function decode(file: File): Promise<{ drawable: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image" applies the EXIF orientation, so phone photos are upright in the cropper.
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { drawable: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode(); // modern browsers also honour EXIF orientation for <img>
    return { drawable: img, w: img.naturalWidth, h: img.naturalHeight, close: () => undefined };
  } catch {
    throw new CropLoadError(MSG_UNREADABLE);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Opens a picked file for cropping. Throws CropLoadError with a readable message when that is not possible. */
export async function loadCropSource(file: File): Promise<CropSource> {
  // Refuse pixel bombs from the header, before anything is decoded (same cap the server applies).
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  const sniffed = sniffImage(head);
  if (!sniffed) throw new CropLoadError(MSG_UNREADABLE);
  if (sniffed.width * sniffed.height > LIMITS.maxPixels) throw new CropLoadError("That image has too many pixels. Resize it to under about 7000×7000 and try again.");

  const d = await decode(file);
  if (!(d.w > 0 && d.h > 0)) {
    d.close();
    throw new CropLoadError(MSG_UNREADABLE);
  }
  const scale = workingScale({ w: d.w, h: d.h }, WORKING_MAX_SIDE);
  if (scale >= 1) return { drawable: d.drawable, width: d.w, height: d.h, type: file.type, name: file.name, close: d.close };

  // Huge image: draw a smaller copy once, and let go of the full-size pixels.
  const w = Math.max(1, Math.round(d.w * scale));
  const h = Math.max(1, Math.round(d.h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    d.close();
    throw new CropLoadError("Your browser could not prepare the image.");
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(d.drawable, 0, 0, w, h);
  d.close();
  return { drawable: canvas, width: w, height: h, type: file.type, name: file.name, close: () => { canvas.width = 0; canvas.height = 0; } };
}

/** Draws the region `rect` of the source into a new File of size `out`. PNG keeps transparency; JPEG is flattened on white. */
export async function renderCrop(src: CropSource, rect: Rect, out: Size): Promise<File> {
  const t = outputType(src.type);
  const canvas = document.createElement("canvas");
  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new CropLoadError("Your browser could not prepare the image.");
  if (t.mime === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.w, out.h);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src.drawable, rect.x, rect.y, rect.w, rect.h, 0, 0, out.w, out.h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, t.mime, t.quality));
  if (!blob) throw new CropLoadError("The cropped image could not be created.");
  return new File([blob], croppedName(src.name, t.ext), { type: t.mime });
}
