/**
 * One source of truth for image limits. The server uses it to decide what to optimize, and the compatibility
 * checker uses it to explain what is still wrong. Pure and client-safe: no image library is imported here.
 */

export const KB = 1024;

export const LIMITS = {
  /** Largest file accepted at all. Bigger images are optimized down, so this is higher than the final-size targets. */
  uploadMaxBytes: 5 * 1024 * KB,
  /** PROJECT.md section 12: animated GIFs should stay under 200-300 KB. */
  gifWarnBytes: 300 * KB,
  gifErrorBytes: 1024 * KB,
  staticWarnBytes: 200 * KB,
  /** Hard cap on animation length, to bound server work. */
  maxFrames: 300,
  /** Decoded-pixel cap (per image or per animation), so a small file cannot expand into gigabytes of RAM. */
  maxPixels: 50_000_000,
  /** Smaller than this in either direction looks blurry once it is scaled up in an email. */
  minDimension: 40,
  /** Longest side kept after optimization, in pixels: roughly 2x the size at which each kind is displayed. */
  maxSide: { avatar: 400, banner: 1200, image: 1200 },
} as const;

export type UploadPurpose = keyof typeof LIMITS.maxSide;
export const UPLOAD_PURPOSES = Object.keys(LIMITS.maxSide) as UploadPurpose[];

export type AssetInfo = {
  type: "image/png" | "image/jpeg" | "image/gif";
  /** Size of the stored (optimized) file. */
  bytes: number;
  width: number;
  height: number;
  animated: boolean;
  /** Size of the file as uploaded, when it was optimized. */
  originalBytes?: number;
};

export type AssetWarning = { code: string; severity: "error" | "warning" | "info"; message: string };

export const formatBytes = (n: number): string => (n >= 1024 * KB ? `${(n / (1024 * KB)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / KB))} KB`);

/** What is still wrong with an image that is already stored. Optimization happens first, so these are the leftovers. */
export function assetWarnings(a: AssetInfo): AssetWarning[] {
  const out: AssetWarning[] = [];

  if (a.animated) {
    if (a.bytes > LIMITS.gifErrorBytes) {
      out.push({ code: "gif-size", severity: "error", message: `This animated GIF is ${formatBytes(a.bytes)}. Over 1 MB, most email clients will stall or skip it. Shorten the animation, use fewer colours, or make it smaller.` });
    } else if (a.bytes > LIMITS.gifWarnBytes) {
      out.push({ code: "gif-size", severity: "warning", message: `This animated GIF is ${formatBytes(a.bytes)}, over the ${formatBytes(LIMITS.gifWarnBytes)} guideline. It will load slowly. Shorten the animation, use fewer colours, or make it smaller.` });
    }
    out.push({ code: "gif-outlook", severity: "info", message: "Outlook on Windows shows only the first frame of an animated GIF. Make sure that frame works on its own." });
  } else if (a.bytes > LIMITS.staticWarnBytes) {
    out.push({ code: "image-size", severity: "warning", message: `This image is ${formatBytes(a.bytes)}, over the ${formatBytes(LIMITS.staticWarnBytes)} guideline. Heavy images slow the message and are more likely to be blocked.` });
  }

  if (a.width < LIMITS.minDimension || a.height < LIMITS.minDimension) {
    out.push({ code: "image-tiny", severity: "info", message: `This image is only ${a.width}×${a.height} px, so it will look blurry when shown at normal size.` });
  }
  return out;
}

/** True when the image's shape differs from the shape it is displayed in by more than `tolerance` (a fraction). */
export function aspectMismatch(naturalW: number, naturalH: number, shownW: number, shownH: number, tolerance = 0.05): boolean {
  if (naturalW <= 0 || naturalH <= 0 || shownW <= 0 || shownH <= 0) return false;
  const natural = naturalW / naturalH;
  const shown = shownW / shownH;
  return Math.abs(shown - natural) / natural > tolerance;
}
