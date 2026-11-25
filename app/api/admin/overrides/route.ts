import { adminRequest, dbFailure, findProfile, noAccount } from "@/lib/admin/route";
import { OverrideRemove, OverrideSet } from "@/lib/admin/schemas";
import { deny } from "@/lib/authz/guard";

export const runtime = "nodejs";
const noStore = { headers: { "Cache-Control": "no-store" } };

/** Turn a feature on or off for one user or one organization. Replaces any existing override for that feature. */
export async function PUT(req: Request) {
  const a = await adminRequest(req, OverrideSet);
  if (!a.ok) return a.response;
  const { supabase } = a.ctx.ctx;
  const d = a.ctx.data;

  let subjectId: string;
  if (d.subject_type === "user") {
    const profile = await findProfile(supabase, d.email);
    if (!profile) return noAccount();
    subjectId = profile.id;
  } else {
    const { data: org } = await supabase.from("organizations").select("id").eq("id", d.org_id).maybeSingle();
    if (!org) return deny(404, "not_found", "That organization does not exist.");
    subjectId = org.id;
  }

  const row = { subject_type: d.subject_type, subject_id: subjectId, feature: d.feature, enabled: d.enabled, updated_at: new Date().toISOString() };
  const { error } = await supabase.from("feature_overrides").upsert(row, { onConflict: "subject_type,subject_id,feature" });
  if (error) return dbFailure(error);
  return Response.json(row, noStore);
}

/** Remove an override so the feature goes back to the role default. */
export async function DELETE(req: Request) {
  const a = await adminRequest(req, OverrideRemove);
  if (!a.ok) return a.response;
  const { subject_type, subject_id, feature } = a.ctx.data;
  const { data, error } = await a.ctx.ctx.supabase.from("feature_overrides").delete().eq("subject_type", subject_type).eq("subject_id", subject_id).eq("feature", feature).select("feature");
  if (error) return dbFailure(error);
  if (!data?.length) return deny(404, "not_found", "That override no longer exists.");
  return Response.json({ ok: true }, noStore);
}
