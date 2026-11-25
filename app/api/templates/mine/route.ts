import { z } from "zod";
import { requireUser } from "@/lib/authz/guard";
import { SignatureDocSchema } from "@/lib/schema/document";

export const runtime = "nodejs";

/** Enough to be useful, small enough that the picker stays fast and nobody fills the table. */
const MAX_MY_TEMPLATES = 50;

const SaveSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name.").max(80, "Keep the name under 80 characters."),
  doc: SignatureDocSchema,
  source: z.enum(["ai-chat", "editor"]).default("ai-chat"),
});

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const AUTH = { notConfigured: "Saving templates is not set up yet. Add the Supabase variables to .env.local.", unauthorized: "Sign in to see your templates." };

/** The caller's own templates, newest first (row-level security enforces "own"). */
export async function GET() {
  const g = await requireUser(AUTH);
  if (!g.ok) return g.response;
  const { data, error } = await g.ctx.supabase.from("user_templates").select("id, name, doc_json, created_at").order("created_at", { ascending: false }).limit(MAX_MY_TEMPLATES);
  if (error) return json({ error: "db", message: "Could not load your templates." }, 500);
  // A stored design that no longer matches the schema is skipped rather than breaking the whole list.
  const templates = (data ?? []).flatMap((r) => {
    const doc = SignatureDocSchema.safeParse(r.doc_json);
    return doc.success ? [{ id: r.id as string, name: r.name as string, doc: doc.data, created_at: r.created_at as string }] : [];
  });
  return json({ templates });
}

/** Saves a design as a template. The document is fully validated again here. */
export async function POST(req: Request) {
  const g = await requireUser(AUTH);
  if (!g.ok) return g.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Request body must be JSON." }, 400);
  }
  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad_request", message: parsed.error.issues[0]?.message ?? "Invalid template." }, 400);

  const { supabase, user } = g.ctx;
  const { count } = await supabase.from("user_templates").select("id", { count: "exact", head: true }).eq("owner_id", user.id);
  if ((count ?? 0) >= MAX_MY_TEMPLATES) return json({ error: "limit", message: `You can keep up to ${MAX_MY_TEMPLATES} templates. Delete one you no longer use, then save again.` }, 409);

  const { data, error } = await supabase
    .from("user_templates")
    .insert({ name: parsed.data.name, doc_json: parsed.data.doc, source: parsed.data.source })
    .select("id, name, created_at")
    .single();
  if (error) return json({ error: "db", message: "Could not save the template. Please try again." }, 500);
  return json(data, 201);
}
