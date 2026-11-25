import { deny } from "@/lib/authz/guard";
import { listActableOrgs, readActiveOrgCookie, resolveActiveOrg } from "@/lib/org/active";
import { noStore, orgRequest } from "@/lib/org/route";
import { loadPlans } from "@/lib/plans";

export const runtime = "nodejs";

/** The plan presets and the organizations the caller may assign them to (their own, and clients of their agency). Admin only. */
export async function GET(req: Request) {
  const a = await orgRequest(req, null, { role: "admin" });
  if (!a.ok) return a.response;
  const { supabase, user } = a.ctx.ctx;
  const plans = await loadPlans(supabase);
  if (!plans) return deny(503, "plans_unavailable", "Plans are not set up yet. Apply supabase/migrations/0015_agency_and_plans.sql, then try again.");
  const orgs = (await listActableOrgs(supabase)).filter((o) => o.role === "admin");
  const active = await resolveActiveOrg(supabase, user.id, { admin: true, cookie: await readActiveOrgCookie() });
  return Response.json({ plans, orgs, active, charged: false }, { headers: noStore });
}
