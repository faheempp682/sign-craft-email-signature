import { deny, requireUser } from "@/lib/authz/guard";
import { campaignAdmin, dbFailure, noStore } from "@/lib/campaigns/route";
import { DisclaimerInput } from "@/lib/campaigns/schemas";

export const runtime = "nodejs";

/** Disclaimer templates the signed-in person may use: the global starting points and their organization's own. */
export async function GET() {
  const g = await requireUser();
  if (!g.ok) return g.response;
  const { data, error } = await g.ctx.supabase.from("legal_disclaimers").select("id, org_id, title, category, jurisdiction, body, needs_review").order("title").limit(500);
  if (error) {
    console.error("[disclaimers] list failed:", error.code);
    return deny(500, "db", "Could not load the templates.");
  }
  return Response.json({ disclaimers: data ?? [] }, { headers: noStore });
}

/** Add one of the organization's own templates. Admin only. (No feature flag: disclaimers are a core part of a signature.) */
export async function POST(req: Request) {
  const a = await campaignAdmin(req, DisclaimerInput, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { org_id: _ignored, ...fields } = a.ctx.data;
  void _ignored;
  const { data, error } = await supabase.from("legal_disclaimers").insert({ ...fields, org_id: orgId }).select("id").single();
  if (error) return dbFailure(error);
  return Response.json({ id: data.id }, { status: 201, headers: noStore });
}
