import { campaignAdmin, dbFailure, noStore } from "@/lib/campaigns/route";
import { CampaignCreate } from "@/lib/campaigns/schemas";

export const runtime = "nodejs";

const COLUMNS = "id, org_id, name, status, starts_at, ends_at, href, fallback_src, fallback_alt, created_at, campaign_variants(id, label, image_url, alt_text, width, height, weight)";

/** The organization's campaigns with their variants. Admin + campaigns flag. */
export async function GET(req: Request) {
  const a = await campaignAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("banner_campaigns").select(COLUMNS).eq("org_id", orgId).order("created_at", { ascending: false }).limit(200);
  if (error) return dbFailure(error);
  return Response.json({ campaigns: data ?? [] }, { headers: noStore });
}

/** Create a campaign (starts as a draft unless a status is given). */
export async function POST(req: Request) {
  const a = await campaignAdmin(req, CampaignCreate);
  if (!a.ok) return a.response;
  const { supabase, user, orgId } = a.ctx.ctx;
  const { org_id: _ignored, ...fields } = a.ctx.data;
  void _ignored;
  const { data, error } = await supabase.from("banner_campaigns").insert({ ...fields, org_id: orgId, created_by: user.id }).select("id").single();
  if (error) return dbFailure(error);
  return Response.json({ id: data.id }, { status: 201, headers: noStore });
}
