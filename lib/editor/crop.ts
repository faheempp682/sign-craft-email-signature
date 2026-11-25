/**
 * Pure math for the image cropper. No DOM, no canvas: everything here works on numbers so it can be unit tested.
 *
 * Model: the person sees a fixed-aspect window onto the image. `zoom` 1 shows the largest region of that aspect that
 * fits inside the image ("cover"); higher zoom shows a smaller region. `cx`/`cy` is the centre of the visible region
 * in source-image pixels. The visible region ("crop rectangle") is always kept fully inside the image, so the output
 * never contains empty edges.
 */

import { LIMITS, type UploadPurpose } from "@/lib/storage/rules";

export type Size = { w: number; h: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type CropState = { zoom: number; cx: number; cy: number };

export type CropShape = "circle" | "rounded" | "square" | "arch";

/** Highest zoom offered. Past this the crop is so small the result would be a blur. */
export const MAX_ZOOM = 8;
/** The crop region never gets smaller than this many source pixels on its short side. */
export const MIN_CROP_PX = 24;
/** Images larger than this (longest side) are scaled down before being drawn, so a 100-megapixel photo cannot freeze the tab. */
export const WORKING_MAX_SIDE = 4096;

const finite = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback);
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Size of the crop region at zoom 1: the biggest `aspect` (width / height) rectangle inside the image. */
export function baseCropSize(img: Size, aspect: number): Size {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const w = Math.min(img.w, img.h * a);
  return { w, h: w / a };
}

/** Largest allowed zoom for this image: capped at MAX_ZOOM and so the region never drops under MIN_CROP_PX. */
export function maxZoomFor(img: Size, aspect: number): number {
  const base = baseCropSize(img, aspect);
  const short = Math.min(base.w, base.h);
  return Math.max(1, Math.min(MAX_ZOOM, short / MIN_CROP_PX));
}

export function clampZoom(zoom: number, img: Size, aspect: number): number {
  return clamp(finite(zoom, 1), 1, maxZoomFor(img, aspect));
}

/** Crop region size at a given zoom. */
export function cropSizeAt(img: Size, aspect: number, zoom: number): Size {
  const base = baseCropSize(img, aspect);
  const z = clampZoom(zoom, img, aspect);
  return { w: base.w / z, h: base.h / z };
}

/** Normalises any state so the crop region lies fully inside the image. Safe to call with garbage (NaN, huge values). */
export function clampState(state: CropState, img: Size, aspect: number): CropState {
  const zoom = clampZoom(state.zoom, img, aspect);
  const size = cropSizeAt(img, aspect, zoom);
  const cx = clamp(finite(state.cx, img.w / 2), size.w / 2, img.w - size.w / 2);
  const cy = clamp(finite(state.cy, img.h / 2), size.h / 2, img.h - size.h / 2);
  return { zoom, cx, cy };
}

/** The starting state: whole image area that fits the aspect, centred. */
export const initialState = (img: Size, aspect: number): CropState => clampState({ zoom: 1, cx: img.w / 2, cy: img.h / 2 }, img, aspect);

/** The visible region in source pixels. */
export function cropRect(state: CropState, img: Size, aspect: number): Rect {
  const s = clampState(state, img, aspect);
  const size = cropSizeAt(img, aspect, s.zoom);
  return { x: s.cx - size.w / 2, y: s.cy - size.h / 2, w: size.w, h: size.h };
}

/**
 * Moves the image by a pointer drag of (dx, dy) screen pixels inside a viewport of `view` screen pixels.
 * Dragging right drags the picture right, so the visible region moves left.
 */
export function panBy(state: CropState, dx: number, dy: number, view: Size, img: Size, aspect: number): CropState {
  if (view.w <= 0 || view.h <= 0) return clampState(state, img, aspect);
  const size = cropSizeAt(img, aspect, state.zoom);
  return clampState({ ...state, cx: state.cx - (dx * size.w) / view.w, cy: state.cy - (dy * size.h) / view.h }, img, aspect);
}

/** Moves the visible region by a fraction of its own size (used by the arrow keys). Positive x = look further right. */
export function nudge(state: CropState, fx: number, fy: number, img: Size, aspect: number): CropState {
  const size = cropSizeAt(img, aspect, state.zoom);
  return clampState({ ...state, cx: state.cx + fx * size.w, cy: state.cy + fy * size.h }, img, aspect);
}

/**
 * Changes zoom while keeping the point under `focus` (0..1 across and down the viewport, default centre) still.
 */
export function zoomTo(state: CropState, zoom: number, img: Size, aspect: number, focus: { x: number; y: number } = { x: 0.5, y: 0.5 }): CropState {
  const before = cropRect(state, img, aspect);
  const z = clampZoom(zoom, img, aspect);
  const size = cropSizeAt(img, aspect, z);
  const fx = clamp(finite(focus.x, 0.5), 0, 1);
  const fy = clamp(finite(focus.y, 0.5), 0, 1);
  const px = before.x + fx * before.w;
  const py = before.y + fy * before.h;
  return clampState({ zoom: z, cx: px - fx * size.w + size.w / 2, cy: py - fy * size.h + size.h / 2 }, img, aspect);
}

/** Multiplies the zoom (wheel, pinch, plus / minus keys). */
export const zoomBy = (state: CropState, factor: number, img: Size, aspect: number, focus?: { x: number; y: number }) =>
  zoomTo(state, state.zoom * (Number.isFinite(factor) && factor > 0 ? factor : 1), img, aspect, focus);

/**
 * Pixel size of the output file. Never enlarges (a 100 px region stays 100 px), and never exceeds the longest side the
 * server keeps for this purpose (LIMITS.maxSide), so the server's own resize has nothing left to do.
 */
export function outputSize(rect: Size, purpose: UploadPurpose): Size {
  const max = LIMITS.maxSide[purpose];
  const longest = Math.max(rect.w, rect.h);
  const scale = longest > max ? max / longest : 1;
  return { w: Math.max(1, Math.round(rect.w * scale)), h: Math.max(1, Math.round(rect.h * scale)) };
}

/** Factor to shrink an image by before it is drawn in the cropper (1 = leave as is). */
export function workingScale(img: Size, maxSide = WORKING_MAX_SIDE): number {
  const longest = Math.max(img.w, img.h);
  return longest > maxSide ? maxSide / longest : 1;
}

/** CSS border-radius of the mask that previews a block's shape (matches lib/renderer/shared.ts). Banners and unknown shapes are square. */
export function maskRadius(shape: string | undefined): string {
  switch (shape) {
    case "circle":
      return "50%";
    case "rounded":
      return "15%";
    case "arch":
      return "50% 50% 0 0 / 50% 50% 0 0";
    default:
      return "0";
  }
}

/** Output format: PNG stays PNG (keeps transparency), everything else becomes JPEG. */
export function outputType(sourceType: string): { mime: "image/png" | "image/jpeg"; ext: "png" | "jpg"; quality?: number } {
  return sourceType === "image/png" ? { mime: "image/png", ext: "png" } : { mime: "image/jpeg", ext: "jpg", quality: 0.92 };
}

/** File name for the cropped result: keeps the original base name and swaps the extension. */
export function croppedName(original: string, ext: string): string {
  const base = original.replace(/\.[^./\\]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "image";
  return `${base}-cropped.${ext}`;
}

/** Animated formats are never cropped (the canvas would keep only one frame); everything else the editor accepts can be. */
export function canCrop(file: { type: string }): boolean {
  return file.type === "image/png" || file.type === "image/jpeg";
}
