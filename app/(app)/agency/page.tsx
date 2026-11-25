import { notFound } from "next/navigation";
import { currentRole, featureEnabled } from "@/lib/authz/guard";
import { listActableOrgs, pickAgencyOrg, readActiveOrgCookie, resolveActiveOrg } from "@/lib/org/active";
import { loadBranding } from "@/lib/org/branding";
import { BrandMark } from "@/lib/org/brand-mark";
import { createClient, getUser } from "@/lib/supabase/server";
import { AgencyClients, type Client } from "./agency-clients";
import { BrandingForm } from "./branding-form";

export const metadata = { title: "Agency · SignCraft" };
export const dynamic = "force-dynamic";

export default async function AgencyPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!supabase || !user) notFound();
  if ((await currentRole()) !== "admin") notFound();
  if ((await featureEnabled(supabase, "agency_mode")) !== true) {
    return <p className="card p-6 text-sm">Agency mode is not enabled for your account. Ask the person who runs SignCraft to switch it on.</p>;
  }
  const orgs = await listActableOrgs(supabase);
  const active = await resolveActiveOrg(supabase, user.id, { admin: false, cookie: await readActiveOrgCookie() });
  const agency = pickAgencyOrg(orgs, active);
  if (!agency) return <p className="card p-6 text-sm">You do not administer a top-level organization, so there are no clients to manage.</p>;

  const { data } = await supabase.rpc("agency_clients", { p_parent: agency });
  const clients: Client[] = ((data ?? []) as { id: string; name: string; plan_id: string | null; member_count: number | string; people_count: number | string }[]).map((c) => ({
    id: c.id,
    name: c.name,
    planId: c.plan_id,
    members: Number(c.member_count),
    people: Number(c.people_count),
  }));
  const branding = await loadBranding(supabase, active);
  const activeOrg = orgs.find((o) => o.id === active) ?? null;

  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow mb-2">Agency</p>
        <BrandMark branding={branding} className="mb-3" />
        <h1 className="text-3xl font-semibold tracking-tight">Client organizations</h1>
        <p className="mt-3 max-w-2xl text-muted">Create client organizations, switch into one to act for it, and set its plan and branding. Plans are presets that an admin assigns; nothing is charged.</p>
      </header>
      <AgencyClients clients={clients} activeId={active} agencyId={agency} activeIsClient={!!activeOrg?.parentId} />
      {active && <BrandingForm key={active} orgId={active} orgName={activeOrg?.name ?? ""} initial={branding} />}
    </div>
  );
}
