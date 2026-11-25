import { notFound } from "next/navigation";
import { currentRole, featureEnabled } from "@/lib/authz/guard";
import { createClient } from "@/lib/supabase/server";
import { HealthDashboard } from "./health-dashboard";

export const metadata = { title: "Signature health · SignCraft" };
export const dynamic = "force-dynamic";

/** Signature health: admins only, and only where the health_monitor feature is on. Everyone else gets a 404. */
export default async function HealthPage() {
  if ((await currentRole()) !== "admin") notFound();
  const supabase = await createClient();
  if (!supabase || (await featureEnabled(supabase, "health_monitor")) !== true) notFound();
  return (
    <>
      <header className="mb-8">
        <p className="eyebrow mb-2">Team</p>
        <h1 className="text-3xl font-semibold tracking-tight">Signature health</h1>
        <p className="mt-3 max-w-2xl text-muted">After SignCraft puts signatures into Gmail, people can edit or delete them. This checks the live Gmail signature of everyone SignCraft deployed to and tells you who changed theirs.</p>
      </header>
      <HealthDashboard />
    </>
  );
}
