import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { SignatureDocSchema } from "@/lib/schema/document";

export const runtime = "nodejs";

const MAX_SIGNATURES_PER_USER = 100;

const SaveSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give the signature a name.").max(80, "Keep the name under 80 characters."),
  doc: SignatureDocSchema,
});

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Create (no id) or update (id) a signature. The document is fully validated again on the server. */
export async function POST(req: Request) {
  const supabase = await createClient();
  if (!supabase) return json({ error: "not_configured", message: "Saving is not set up yet. Add the Supabase variables to .env.local." }, 503);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "unauthorized", message: "Sign in to save signatures." }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Request body must be JSON." }, 400);
  }
  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad_request", message: parsed.error.issues[0]?.message ?? "Invalid signature." }, 400);
  const { id, name, doc } = parsed.data;
  const row = { name, template_id: doc.template_id, doc_json: doc };

  if (id) {
    const { data, error } = await supabase.from("signatures").update(row).eq("id", id).select("id, name, updated_at").maybeSingle();
    if (error) return json({ error: "db", message: "Could not save. Please try again." }, 500);
    if (!data) return json({ error: "not_found", message: "That signature no longer exists." }, 404);
    return json(data);
  }

  const { count } = await supabase.from("signatures").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_SIGNATURES_PER_USER) return json({ error: "quota", message: `You have reached the limit of ${MAX_SIGNATURES_PER_USER} saved signatures.` }, 429);

  const { data, error } = await supabase.from("signatures").insert(row).select("id, name, updated_at").single();
  if (error) return json({ error: "db", message: "Could not save. Please try again." }, 500);
  return json(data, 201);
}
