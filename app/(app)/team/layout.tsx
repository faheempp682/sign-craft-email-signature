import { currentRole, featureEnabled } from "@/lib/authz/guard";
import { createClient } from "@/lib/supabase/server";
import { TeamNav, type TeamNavItem } from "./team-nav";

export const dynamic = "force-dynamic";

/**
 * Admins get a section bar across the team pages (people, deploy, sync, health), showing only what their feature flags
 * allow. Everyone else, notably members on /team/mine, sees no extra navigation. This is navigation only: every page and
 * API still checks the role and the feature itself.
 */
export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  if ((await currentRole()) !== "admin") return <>{children}</>;
  const supabase = await createClient();
  if (!supabase) return <>{children}</>;
  const [team, directory, crm, health] = await Promise.all(
    (["team_deploy", "directory_sync", "crm_sync", "health_monitor"] as const).map((f) => featureEnabled(supabase, f)),
  );
  const items: TeamNavItem[] = [];
  if (team === true) items.push({ href: "/team", label: "People" }, { href: "/team/deploy", label: "Deploy" });
  if (directory === true || crm === true) items.push({ href: "/team/sync", label: "Directory and CRM sync" });
  if (health === true) items.push({ href: "/team/health", label: "Signature health" });
  items.push({ href: "/team/mine", label: "My signature" });
  return (
    <>
      <TeamNav items={items} />
      {children}
    </>
  );
}
