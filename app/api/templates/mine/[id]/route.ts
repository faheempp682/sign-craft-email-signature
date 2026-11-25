import { z } from "zod";
import { requireUser } from "@/lib/authz/guard";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const AUTH = { notConfigured: "Saving templates is not set up yet.", unauthorized: "Sign in to manage your templates." };
const Rename = z.object({ name: z.string().trim().min(1, "Give the template a name.").max(80, "Keep the name under 80 characters.") });

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: "bad_request", message: "Invalid template id." }, 400);
  const g = await requireUser(AUTH);
  if (!g.ok) return g.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Request body must be JSON." }, 400);
  }
  const parsed = Rename.safeParse(body);
  if (!parsed.success) return json({ error: "bad_request", message: parsed.error.issues[0]?.message ?? "Invalid name." }, 400);

  const { data, error } = await g.ctx.supabase.from("user_templates").update({ name: parsed.data.name }).eq("id", id).select("id, name").maybeSingle();
  if (error) return json({ error: "db", message: "Could not rename. Please try again." }, 500);
  if (!data) return json({ error: "not_found", message: "That template no longer exists." }, 404);
  return json(data);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: "bad_request", message: "Invalid template id." }, 400);
  const g = await requireUser(AUTH);
  if (!g.ok) return g.response;
  // Row-level security limits this to the caller's own rows, so someone else's id simply matches nothing.
  const { data, error } = await g.ctx.supabase.from("user_templates").delete().eq("id", id).select("id");
  if (error) return json({ error: "db", message: "Could not delete. Please try again." }, 500);
  if (!data?.length) return json({ error: "not_found", message: "That template no longer exists." }, 404);
  return json({ ok: true });
}
