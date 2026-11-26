import { z } from "zod";
import { requireUser } from "@/lib/authz/guard";
import { SignatureDocSchema } from "@/lib/schema/document";
import { getSignatureLimit } from "@/lib/signature-limit";

export const runtime = "nodejs";


const SaveSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give the signature a name.").max(80, "Keep the name under 80 characters."),
  doc: SignatureDocSchema,
  /** Optional: tag the signature with an organization you belong to, so its admins can read it. null removes the tag. */
  org_id: z.string().uuid().nullable().optional(),
});

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Create (no id) or update (id) a signature. The document is fully validated again on the server. */
export async function POST(req: Request) {
  const g = await requireUser({ notConfigured: "Saving is not set up yet. Add the Supabase variables to .env.local.", unauthorized: "Sign in to save signatures." });
  if (!g.ok) return g.response;
  const { supabase } = g.ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Request body must be JSON." }, 400);
  }
  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad_request", message: parsed.error.issues[0]?.message ?? "Invalid signature." }, 400);
  const { id, name, doc, org_id } = parsed.data;
  const row: { name: string; template_id: string; doc_json: typeof doc; org_id?: string | null } = { name, template_id: doc.template_id, doc_json: doc };
  if (org_id !== undefined) row.org_id = org_id; // the database refuses an organization the caller is not in

  if (id) {
    const { data, error } = await supabase.from("signatures").update(row).eq("id", id).select("id, name, updated_at").maybeSingle();
    if (error) return json({ error: "db", message: "Could not save. Please try again." }, 500);
    if (!data) return json({ error: "not_found", message: "That signature no longer exists." }, 404);
    return json(data);
  }

  // Own rows only: org admins can also read tagged signatures of others. The count and the limit are independent, so fetch them together.
  const [{ count }, limit] = await Promise.all([
    supabase.from("signatures").select("id", { count: "exact", head: true }).eq("owner_id", g.ctx.user.id),
    getSignatureLimit(supabase),
  ]);
  if ((count ?? 0) >= limit) return json({ error: "quota", limit, message: `You have reached the limit of ${limit} saved signatures. Delete one to save another.` }, 429);

  const { data, error } = await supabase.from("signatures").insert(row).select("id, name, updated_at").single();
  if (error) return json({ error: "db", message: "Could not save. Please try again." }, 500);
  return json(data, 201);
}
