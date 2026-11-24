import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: "bad_request", message: "Invalid signature id." }, 400);

  const supabase = await createClient();
  if (!supabase) return json({ error: "not_configured", message: "Saving is not set up yet." }, 503);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "unauthorized", message: "Sign in first." }, 401);

  // RLS restricts this to the caller's own rows, so deleting someone else's id simply matches nothing.
  const { data, error } = await supabase.from("signatures").delete().eq("id", id).select("id");
  if (error) return json({ error: "db", message: "Could not delete. Please try again." }, 500);
  if (!data?.length) return json({ error: "not_found", message: "That signature no longer exists." }, 404);
  return json({ ok: true });
}
