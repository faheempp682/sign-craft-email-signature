import { BottomNav, Footer, Sidebar, Topbar } from "@/components/nav";
import { OrgSwitcher } from "@/components/org-switcher";
import { currentRole, featureEnabled, isPlatformAdmin } from "@/lib/authz/guard";
import type { Feature } from "@/lib/authz/roles";
import { buildMenu, type MenuInput } from "@/lib/nav/menu";
import { createClient, getUser } from "@/lib/supabase/server";

const NAV_FEATURES: Feature[] = ["digital_card", "designer_polish", "team_deploy", "directory_sync", "crm_sync", "health_monitor", "agency_mode"];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  const role = user ? await currentRole() : null;
  const isAdmin = role === "admin";
  const supabase = user ? await createClient() : null;

  // Links appear only for what this person can actually use (the pages and APIs enforce it again).
  const flags: MenuInput["flags"] = {};
  let attention = 0;
  let platform = false;
  if (supabase) {
    const values = await Promise.all(NAV_FEATURES.map((f) => featureEnabled(supabase, f)));
    NAV_FEATURES.forEach((f, i) => (flags[f] = values[i]));
    if (isAdmin) {
      platform = await isPlatformAdmin();
      if (flags.team_deploy === true && flags.health_monitor === true) {
        // Open signature-health findings (someone edited or removed a deployed signature). Admin-only rows under row-level security.
        const { count } = await supabase.from("health_findings").select("id", { count: "exact", head: true }).eq("status", "open");
        attention = count ?? 0;
      }
    }
  }
  const groups = buildMenu({ role, platform, flags, attention });

  return (
    <div className="app-frame min-h-screen bg-background md:min-h-0 md:fixed md:inset-0 md:overflow-hidden">
      <Sidebar email={user?.email} role={role} groups={groups} canInvite={platform} switcher={isAdmin ? <OrgSwitcher /> : undefined} />
      {/* No `w-full` here: with the sidebar's left margin it made <main> wider than the viewport. */}
      <div className="flex min-h-screen flex-col md:min-h-0 bg-background md:my-4 md:ml-[4.75rem] md:mr-4 md:h-[calc(100%-2rem)] md:overflow-hidden md:rounded-[28px] md:shadow-xl lg:ml-[4.75rem] lg:exp:ml-60">
        <Topbar email={user?.email} groups={groups} />
        {/* On desktop only this region scrolls; the frame, sidebar and top bar stay put. */}
        <div className="flex min-h-0 flex-1 flex-col md:overflow-y-auto">
          <main className="flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-12 md:pt-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
          <Footer />
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
