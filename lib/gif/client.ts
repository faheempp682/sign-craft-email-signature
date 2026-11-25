import type { GifOptions } from "./limits";

/** Thrown when the person's account does not have animated GIFs switched on (the route answered 403 feature_disabled). */
export class GifDisabledError extends Error {}

export type GifResult = { blob: Blob; bytes: number; colours: number };

/** Sends the frames (in play order) to /api/media/gif and returns the finished GIF. Throws an Error with a readable message. */
export async function requestGif(frames: File[], options: GifOptions): Promise<GifResult> {
  const form = new FormData();
  for (const f of frames) form.append("frames", f);
  form.set("options", JSON.stringify(options));
  let res: Response;
  try {
    res = await fetch("/api/media/gif", { method: "POST", body: form });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    if (res.status === 403 && data?.error === "feature_disabled") {
      throw new GifDisabledError("Animated GIFs are not enabled for your account. Ask an admin to turn them on, or upload a still banner.");
    }
    throw new Error(data?.message ?? "The GIF could not be created. Please try again.");
  }
  const blob = await res.blob();
  return { blob, bytes: blob.size, colours: Number(res.headers.get("x-gif-colours")) || 256 };
}
