import { BottomNav, Panel, Rail, Topbar } from "@/components/nav";
import { currentRole, featureEnabled } from "@/lib/authz/guard";
import { atLeast } from "@/lib/authz/roles";
import { createClient } from "@/lib/supabase/server";
import type { NavExtra } from "@/components/nav";
import { getUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  const role = user ? await currentRole() : null;
  const isAdmin = role === "admin";
  // Links appear only for features this person can actually use (the pages and APIs enforce it again).
  const extras: NavExtra[] = [];
  const supabase = user ? await createClient() : null;
  if (supabase) {
    const [cards, polish, team] = await Promise.all([featureEnabled(supabase, "digital_card"), featureEnabled(supabase, "designer_polish"), isAdmin ? featureEnabled(supabase, "team_deploy") : Promise.resolve(false)]);
    // Admins manage the team; everyone else edits their own brand-locked signature.
    extras.push(isAdmin && team === true ? { href: "/team", label: "Team", icon: "team" } : { href: "/team/mine", label: "My team signature", icon: "team" });
    if (cards === true) extras.push({ href: "/cards", label: "Digital card", icon: "cards" });
    if ((role && atLeast(role, "designer")) || polish === true) extras.push({ href: "/polish", label: "Polish", icon: "polish" });
  }
  return (
    <div className="min-h-screen bg-background">
      <Rail email={user?.email} isAdmin={isAdmin} extras={extras} />
      <Panel isAdmin={isAdmin} extras={extras} />
      {/* No `w-full` here: with the sidebar's left margin it made <main> wider than the viewport. */}
      <div className="md:ml-14 lg:ml-[17.5rem]">
        <Topbar email={user?.email} isAdmin={isAdmin} extras={extras} />
        <main className="px-4 pb-24 pt-8 md:px-10 md:pb-12 md:pt-10">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
