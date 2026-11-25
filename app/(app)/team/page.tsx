import { notFound } from "next/navigation";
import { currentRole, featureEnabled } from "@/lib/authz/guard";
import { createClient } from "@/lib/supabase/server";
import { TeamDashboard } from "./team-dashboard";

export const metadata = { title: "Team · SignCraft" };
export const dynamic = "force-dynamic";

/** Team dashboard: admins only, and only where the team_deploy feature is on. Everyone else gets a 404. */
export default async function TeamPage() {
  if ((await currentRole()) !== "admin") notFound();
  const supabase = await createClient();
  if (!supabase || (await featureEnabled(supabase, "team_deploy")) !== true) notFound();
  return (
    <>
      <header className="mb-8">
        <p className="eyebrow mb-2">Team</p>
        <h1 className="text-3xl font-semibold tracking-tight">Your team&apos;s signatures</h1>
        <p className="mt-3 max-w-2xl text-muted">Keep a directory of your people, give them a brand-locked signature, and approve the changes they make.</p>
      </header>
      <TeamDashboard />
    </>
  );
}
