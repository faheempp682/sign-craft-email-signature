export type UploadResult = { url: string; width: number; height: number };

/** Sends an image to /api/upload (which stores it on the CDN). Throws an Error with a user-readable message. */
export async function uploadImage(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.set("file", file);
  let res: Response;
  try {
    res = await fetch("/api/upload", { method: "POST", body: form });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => null)) as (Partial<UploadResult> & { message?: string }) | null;
  if (!res.ok || !data?.url) throw new Error(data?.message ?? "The upload failed. Please try again.");
  return { url: data.url, width: data.width ?? 0, height: data.height ?? 0 };
}

/** Banner size to apply after an upload: keep the aspect ratio, cap the width at 600px (the usual email width). */
export function fitBanner(width: number, height: number, maxWidth = 600): { width: number; height: number } | null {
  if (width <= 0 || height <= 0) return null;
  const w = Math.min(width, maxWidth);
  return { width: w, height: Math.max(1, Math.round((height * w) / width)) };
}
