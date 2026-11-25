import { campaignAdmin, dbFailure, noStore, notFound, UUID_RE } from "@/lib/campaigns/route";
import { DisclaimerPatch } from "@/lib/campaigns/schemas";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Edit one of the organization's own templates. Global starting points cannot be changed here (row-level security refuses). */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const a = await campaignAdmin(req, DisclaimerPatch, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("legal_disclaimers").update(a.ctx.data).eq("id", id).eq("org_id", orgId).select("id");
  if (error) return dbFailure(error);
  if (!data?.length) return notFound();
  return Response.json({ id }, { headers: noStore });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const a = await campaignAdmin(req, null, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("legal_disclaimers").delete().eq("id", id).eq("org_id", orgId).select("id");
  if (error) return dbFailure(error);
  if (!data?.length) return notFound();
  return Response.json({ id }, { headers: noStore });
}
