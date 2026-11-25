import { BottomNav, Panel, Rail, Topbar } from "@/components/nav";
import { currentRole } from "@/lib/authz/guard";
import { getUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  const isAdmin = user ? (await currentRole()) === "admin" : false;
  return (
    <div className="min-h-screen bg-background">
      <Rail email={user?.email} isAdmin={isAdmin} />
      <Panel isAdmin={isAdmin} />
      {/* No `w-full` here: with the sidebar's left margin it made <main> wider than the viewport. */}
      <div className="md:ml-14 lg:ml-[17.5rem]">
        <Topbar email={user?.email} isAdmin={isAdmin} />
        <main className="px-4 pb-24 pt-8 md:px-10 md:pb-12 md:pt-10">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
