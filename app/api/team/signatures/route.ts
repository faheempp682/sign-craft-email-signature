import { noStore, teamAdmin, teamFailure } from "@/lib/team/route";

export const runtime = "nodejs";

/** Saved signatures an admin may start a brand template from: their own, plus those employees tagged with the organization. */
export async function GET(req: Request) {
  const a = await teamAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, user, orgId } = a.ctx.ctx;
  const { data, error } = await supabase
    .from("signatures")
    .select("id, name, template_id, owner_id, org_id, updated_at")
    .or(`owner_id.eq.${user.id},org_id.eq.${orgId}`)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) return teamFailure(error);
  return Response.json({ signatures: (data ?? []).map((s: { owner_id: string }) => ({ ...s, mine: s.owner_id === user.id, owner_id: undefined })) }, { headers: noStore });
}
