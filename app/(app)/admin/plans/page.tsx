import { listActableOrgs } from "@/lib/org/active";
import { loadPlans } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { PlansAdmin } from "./plans-admin";

export const metadata = { title: "Plans · Admin · SignCraft" };
export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const supabase = await createClient();
  if (!supabase) return null;
  const plans = await loadPlans(supabase);
  if (!plans) return <p className="card p-6 text-sm">Could not load the plans. Has <code>supabase/migrations/0015_agency_and_plans.sql</code> been applied?</p>;
  const orgs = (await listActableOrgs(supabase)).filter((o) => o.role === "admin");
  return <PlansAdmin plans={plans} orgs={orgs.map((o) => ({ id: o.id, name: o.name, planId: o.planId, client: o.viaAgency }))} />;
}
