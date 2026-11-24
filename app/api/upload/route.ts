import { randomUUID } from "node:crypto";
import { getUser, createClient } from "@/lib/supabase/server";
import { MAX_UPLOAD_BYTES, sniffImage } from "@/lib/storage/image";
import { getBunnyConfig, uploadToBunny } from "@/lib/storage/bunny";

export const runtime = "nodejs";

const MAX_ASSETS_PER_USER = 200; // PROJECT.md section 17: per-user quota against image-hosting abuse

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const cfg = getBunnyConfig();
  if (!cfg) {
    return json({ error: "not_configured", message: "Image upload is not set up yet. Add the BUNNY_* variables to .env.local and restart the dev server." }, 503);
  }

  const user = await getUser();
  const supabase = await createClient();
  if (!user || !supabase) return json({ error: "unauthorized", message: "Sign in to upload images." }, 401);

  // Cheap early rejection before buffering the body.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return json({ error: "too_large", message: "That image is too large. The limit is 2 MB." }, 413);

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return json({ error: "bad_request", message: "Send the image as multipart form data in a field named \"file\"." }, 400);
  }
  if (!(file instanceof File)) return json({ error: "bad_request", message: "No image was attached." }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: "too_large", message: "That image is too large. The limit is 2 MB." }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = sniffImage(bytes);
  if (!info) return json({ error: "bad_type", message: "Only PNG, JPG and GIF images work in email signatures." }, 415);

  const { count } = await supabase.from("assets").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_ASSETS_PER_USER) return json({ error: "quota", message: `You have reached the limit of ${MAX_ASSETS_PER_USER} uploaded images.` }, 429);

  const path = `${user.id}/${randomUUID()}.${info.ext}`;
  let url: string;
  try {
    url = await uploadToBunny(cfg, path, bytes);
  } catch (e) {
    console.error("[upload] bunny failed:", e instanceof Error ? e.message : e);
    return json({ error: "upstream", message: "The image host rejected the upload. Check the Bunny zone name, access key and region." }, 502);
  }

  const { error } = await supabase.from("assets").insert({ url, path, type: info.type, size: bytes.length, width: info.width, height: info.height });
  if (error) console.error("[upload] asset row failed:", error.message); // the image is live either way; the row is bookkeeping

  return json({ url, width: info.width, height: info.height, type: info.type, size: bytes.length });
}
