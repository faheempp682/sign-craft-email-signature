import { DEPLOYMENT_COLUMNS, deployAdmin, deployFailure, noStore } from "@/lib/deploy/route";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const a = await deployAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("deployments").select(DEPLOYMENT_COLUMNS).eq("org_id", orgId).order("created_at", { ascending: false }).limit(50);
  if (error) return deployFailure(error);
  return Response.json({ deployments: data ?? [] }, { headers: noStore });
}
