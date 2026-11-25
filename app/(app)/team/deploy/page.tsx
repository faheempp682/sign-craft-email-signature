import { notFound } from "next/navigation";
import { currentRole, featureEnabled } from "@/lib/authz/guard";
import { createClient } from "@/lib/supabase/server";
import { DeployDashboard } from "./deploy-dashboard";

export const metadata = { title: "Deploy · SignCraft" };
export const dynamic = "force-dynamic";

/** Deploy and rules: admins only, and only where the team_deploy feature is on. Everyone else gets a 404. */
export default async function DeployPage() {
  if ((await currentRole()) !== "admin") notFound();
  const supabase = await createClient();
  if (!supabase || (await featureEnabled(supabase, "team_deploy")) !== true) notFound();
  return (
    <>
      <header className="mb-8">
        <p className="eyebrow mb-2">Team</p>
        <h1 className="text-3xl font-semibold tracking-tight">Deploy signatures</h1>
        <p className="mt-3 max-w-2xl text-muted">Put each person&apos;s approved signature into Gmail, generate a script for Microsoft 365, and choose which template applies in which situation.</p>
      </header>
      <DeployDashboard />
    </>
  );
}
