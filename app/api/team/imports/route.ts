import { noStore, teamAdmin, teamFailure } from "@/lib/team/route";

export const runtime = "nodejs";

/** The organization's import history, newest first. */
export async function GET(req: Request) {
  const a = await teamAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("people_imports").select("id, filename, source, total_rows, created, updated, skipped, created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(20);
  if (error) return teamFailure(error);
  return Response.json({ imports: data ?? [] }, { headers: noStore });
}
