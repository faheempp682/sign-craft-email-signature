import { noStore, teamAdmin, teamFailure } from "@/lib/team/route";

export const runtime = "nodejs";

const COLUMNS =
  "id, person_id, version_no, status, values_json, template_snapshot, created_at, reviewed_at, review_note, people(id, email, full_name, title, department, phone, mobile, location, custom)";

/** The approval queue (?status=pending, the default) or the decided history (?status=approved|rejected|all). */
export async function GET(req: Request) {
  const a = await teamAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const status = new URL(req.url).searchParams.get("status") ?? "pending";
  let q = supabase.from("signature_versions").select(COLUMNS).eq("org_id", orgId).order("created_at", { ascending: status === "pending" }).limit(100);
  if (["pending", "approved", "rejected"].includes(status)) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return teamFailure(error);
  return Response.json({ versions: data ?? [] }, { headers: noStore });
}
