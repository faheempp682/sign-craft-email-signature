import { redirect } from "next/navigation";
import { loadMine } from "@/lib/team/mine";
import { createClient, getUser } from "@/lib/supabase/server";
import { MineForm } from "./mine-form";

export const metadata = { title: "My signature · SignCraft" };
export const dynamic = "force-dynamic";

/** The employee's brand-locked signature: only the fields the organization allows, with a live preview. */
export default async function MyBrandSignaturePage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!supabase) return <p className="card p-6 text-sm">Sign-in is not set up yet.</p>;
  if (!user) redirect("/login?next=/team/mine");
  const mine = await loadMine(supabase, user.id);

  return (
    <>
      <header className="mb-8">
        <p className="eyebrow mb-2">Team</p>
        <h1 className="text-3xl font-semibold tracking-tight">My signature</h1>
        <p className="mt-3 max-w-2xl text-muted">Your organization designed this signature. You can change the few details it allows; everything else is set for you.</p>
      </header>
      {mine.state === "no_person" && (
        <p className="card p-6 text-sm">You are not in your organization&apos;s directory yet. Ask an admin to add your email address ({user.email}) and come back.</p>
      )}
      {mine.state === "no_template" && <p className="card p-6 text-sm">Your organization has not set up a brand signature for you yet. Check back soon.</p>}
      {mine.state === "ok" && <MineForm mine={mine} />}
    </>
  );
}
