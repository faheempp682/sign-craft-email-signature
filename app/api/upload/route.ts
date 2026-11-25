import { randomUUID } from "node:crypto";
import { deny, featureEnabled, requireUser } from "@/lib/authz/guard";
import { LIMITS, UPLOAD_PURPOSES, type UploadPurpose } from "@/lib/storage/rules";
import { UploadError, processUpload } from "@/lib/storage/process";
import { getBunnyConfig, uploadToBunny } from "@/lib/storage/bunny";
import { pickFacts } from "@/lib/editor/upload";
import { userFolder } from "@/lib/storage/folder";

export const runtime = "nodejs";

const MAX_ASSETS_PER_USER = 200; // PROJECT.md section 17: per-user quota against image-hosting abuse

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const cfg = getBunnyConfig();
  if (!cfg) {
    return json({ error: "not_configured", message: "Image upload is not set up yet. Add the BUNNY_* variables to .env.local and restart the dev server." }, 503);
  }

  const g = await requireUser({ unauthorized: "Sign in to upload images." });
  if (!g.ok) return g.response;
  const { supabase, user } = g.ctx;

  // Cheap early rejection before buffering the body.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > LIMITS.uploadMaxBytes + 64 * 1024) {
    return json({ error: "too_large", message: "That image is too large to upload." }, 413);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "bad_request", message: "Send the image as multipart form data in a field named \"file\"." }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "bad_request", message: "No image was attached." }, 400);

  const rawPurpose = String(form.get("purpose") ?? "image");
  const purpose: UploadPurpose = (UPLOAD_PURPOSES as string[]).includes(rawPurpose) ? (rawPurpose as UploadPurpose) : "image";

  let processed;
  try {
    processed = await processUpload(new Uint8Array(await file.arrayBuffer()), purpose);
  } catch (e) {
    if (e instanceof UploadError) return json({ error: e.code, message: e.message }, e.status);
    throw e;
  }

  // Animated GIFs are enabled per account (PROJECT.md section 10), so the flag is checked once we know the file is animated.
  if (processed.info.animated) {
    const on = await featureEnabled(supabase, "animated_gif");
    if (on === null) return deny(503, "authz_unavailable", "Access control is not set up yet. Apply supabase/migrations/0003_access_control.sql, then try again.");
    if (!on) return deny(403, "feature_disabled", "Animated GIFs are not enabled for your account. Ask an admin to turn them on, or upload a still image.");
  }

  const { count } = await supabase.from("assets").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_ASSETS_PER_USER) return json({ error: "quota", message: `You have reached the limit of ${MAX_ASSETS_PER_USER} uploaded images.` }, 429);

  const { data, ext, info, notes, warnings } = processed;
  const path = `${userFolder(user)}/${randomUUID()}.${ext}`;
  let url: string;
  try {
    url = await uploadToBunny(cfg, path, data);
  } catch (e) {
    console.error("[upload] bunny failed:", e instanceof Error ? e.message : e);
    return json({ error: "upstream", message: "The image host rejected the upload. Check the Bunny zone name, access key and region." }, 502);
  }

  const row = {
    url,
    path,
    type: info.type,
    size: info.bytes,
    width: info.width,
    height: info.height,
    animated: info.animated,
    original_size: info.originalBytes ?? null,
  };
  // The measured facts (GIF frames, first frame, dark artwork...) are kept so the checker can use them on later visits.
  // If the database does not have the `facts` column yet (migration 0013 not applied), record the row without them:
  // the row also counts toward the image quota, so it must never be lost over this.
  let { error } = await supabase.from("assets").insert({ ...row, facts: pickFacts(info) });
  if (error && /facts/i.test(error.message)) ({ error } = await supabase.from("assets").insert(row));
  if (error) console.error("[upload] asset row failed:", error.message); // the image is live either way; the row is bookkeeping

  return json({ url, ...info, notes, warnings });
}

/** The signed-in user's uploaded images, newest first, for the editor's "Your images" picker. */
export async function GET() {
  const g = await requireUser({ unauthorized: "Sign in to see your images." });
  if (!g.ok) return g.response;
  const { data, error } = await g.ctx.supabase
    .from("assets")
    .select("url, type, size, width, height, animated, original_size")
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) return json({ error: "db", message: "Could not load your images." }, 500);
  return json({ images: data ?? [] });
}
