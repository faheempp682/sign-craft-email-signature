import { notFound } from "next/navigation";
import { currentRole, featureEnabled } from "@/lib/authz/guard";
import { createClient } from "@/lib/supabase/server";
import { SyncDashboard } from "./sync-dashboard";

export const metadata = { title: "Directory and CRM sync · SignCraft" };
export const dynamic = "force-dynamic";

/** Sync screen: admins only, and only where directory_sync or crm_sync is on. Everyone else gets a 404. */
export default async function SyncPage() {
  if ((await currentRole()) !== "admin") notFound();
  const supabase = await createClient();
  if (!supabase) notFound();
  const [d, c] = [await featureEnabled(supabase, "directory_sync"), await featureEnabled(supabase, "crm_sync")];
  if (d !== true && c !== true) notFound();
  return (
    <>
      <header className="mb-8">
        <p className="eyebrow mb-2">Team</p>
        <h1 className="text-3xl font-semibold tracking-tight">Directory and CRM sync</h1>
        <p className="mt-3 max-w-2xl text-muted">Keep your people directory up to date from Google Workspace, Microsoft 365 and your CRM. Every run starts as a preview: nothing changes until you confirm.</p>
      </header>
      <SyncDashboard />
    </>
  );
}
