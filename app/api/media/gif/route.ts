import { deny, requireFeature } from "@/lib/authz/guard";
import { sameOrigin } from "@/lib/authz/origin";
import { GifError, buildGif } from "@/lib/gif/build";
import { GIF_LIMITS, GifOptionsSchema } from "@/lib/gif/limits";

export const runtime = "nodejs";

/**
 * Builds an animated GIF from 2 to 6 still frames and returns the bytes. Nothing is stored here: the browser then
 * sends the GIF through /api/upload, which applies the same size rules and the animated_gif flag again.
 *
 * Multipart fields: `frames` (2 to 6 image files, in play order) and `options` (JSON: delays[], loop, width, height).
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return deny(403, "bad_origin", "This request did not come from the app.");

  const g = await requireFeature("animated_gif", { unauthorized: "Sign in to make an animated GIF." });
  if (!g.ok) return g.response;

  // Cheap rejection before the body is buffered (every frame is size-checked again after parsing).
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > GIF_LIMITS.maxBodyBytes) return deny(413, "too_large", "Those images are too large. Each frame must be under 2 MB.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return deny(400, "bad_request", "Send the frames as multipart form data.");
  }

  const files = form.getAll("frames");
  if (files.length < GIF_LIMITS.minFrames || files.length > GIF_LIMITS.maxFrames) {
    return deny(400, "bad_frames", `Use between ${GIF_LIMITS.minFrames} and ${GIF_LIMITS.maxFrames} frames.`);
  }
  const frames: File[] = [];
  for (const f of files) {
    if (!(f instanceof File)) return deny(400, "bad_frames", "Every frame must be an image file.");
    if (f.size === 0) return deny(400, "bad_frames", "One of the frames is empty.");
    if (f.size > GIF_LIMITS.maxFrameBytes) return deny(413, "too_large", "Each frame must be under 2 MB.");
    frames.push(f);
  }

  let rawOptions: unknown;
  try {
    rawOptions = JSON.parse(String(form.get("options") ?? ""));
  } catch {
    return deny(400, "bad_request", "The options are missing or not valid JSON.");
  }
  const options = GifOptionsSchema.safeParse(rawOptions);
  if (!options.success) return deny(400, "bad_request", options.error.issues[0]?.message ?? "Invalid options.");
  if (options.data.delays.length !== frames.length) return deny(400, "bad_request", "There must be one delay per frame.");

  try {
    const bytes = await Promise.all(frames.map(async (f) => new Uint8Array(await f.arrayBuffer())));
    const out = await buildGif(bytes, options.data);
    return new Response(new Uint8Array(out.data), {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Content-Length": String(out.bytes),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Gif-Colours": String(out.colours),
        "X-Gif-Frames": String(out.frames),
      },
    });
  } catch (e) {
    if (e instanceof GifError) return deny(e.status, e.code, e.message);
    console.error("[gif] build failed:", e instanceof Error ? e.name : "unknown");
    return deny(500, "build_failed", "The GIF could not be created. Try different images.");
  }
}
