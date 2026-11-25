import type { AssetInfo, AssetWarning, UploadPurpose } from "@/lib/storage/rules";

export type UploadResult = AssetInfo & { url: string; notes: string[]; warnings: AssetWarning[] };

/** Sends an image to /api/upload (which optimizes it and stores it on the CDN). Throws an Error with a user-readable message. */
export async function uploadImage(file: File, purpose: UploadPurpose = "image"): Promise<UploadResult> {
  const form = new FormData();
  form.set("file", file);
  form.set("purpose", purpose);
  let res: Response;
  try {
    res = await fetch("/api/upload", { method: "POST", body: form });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => null)) as (Partial<UploadResult> & { message?: string }) | null;
  if (!res.ok || !data?.url || !data.type) throw new Error(data?.message ?? "The upload failed. Please try again.");
  return {
    url: data.url,
    type: data.type,
    bytes: data.bytes ?? 0,
    width: data.width ?? 0,
    height: data.height ?? 0,
    animated: !!data.animated,
    originalBytes: data.originalBytes,
    notes: data.notes ?? [],
    warnings: data.warnings ?? [],
  };
}

/** The part of an upload result the compatibility checker needs. */
export const toAssetInfo = (r: UploadResult): AssetInfo => ({ type: r.type, bytes: r.bytes, width: r.width, height: r.height, animated: r.animated, originalBytes: r.originalBytes });

/** The banner size range the document schema accepts (BannerBlock). A size outside it would make the whole document invalid. */
const BANNER = { minW: 100, maxW: 600, minH: 20, maxH: 300 } as const;

/**
 * Banner size to apply after an upload: the largest size that keeps the image's aspect ratio and stays inside the
 * schema's 100-600 x 20-300 range (600 is also the usual email width). Extreme shapes that cannot satisfy both are
 * clamped into range, and the compatibility checker then reports them as stretched.
 */
export function fitBanner(width: number, height: number): { width: number; height: number } | null {
  if (width <= 0 || height <= 0) return null;
  let w = Math.min(width, BANNER.maxW);
  let h = Math.round((height * w) / width);
  if (h > BANNER.maxH) {
    h = BANNER.maxH;
    w = Math.round((width * h) / height);
  }
  w = Math.min(BANNER.maxW, Math.max(BANNER.minW, w));
  h = Math.min(BANNER.maxH, Math.max(BANNER.minH, h));
  return { width: w, height: h };
}
