import { campaignAdmin, dbFailure, noStore, notFound, UUID_RE } from "@/lib/campaigns/route";
import { CampaignPatch } from "@/lib/campaigns/schemas";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Change a campaign: rename, reschedule, pause/resume, new destination. Row-level security confines this to the admin's own organization. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const a = await campaignAdmin(req, CampaignPatch);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("banner_campaigns").update(a.ctx.data).eq("id", id).eq("org_id", orgId).select("id");
  if (error) return dbFailure(error);
  if (!data?.length) return notFound();
  return Response.json({ id }, { headers: noStore });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const a = await campaignAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("banner_campaigns").delete().eq("id", id).eq("org_id", orgId).select("id");
  if (error) return dbFailure(error);
  if (!data?.length) return notFound();
  return Response.json({ id }, { headers: noStore });
}
