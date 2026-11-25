import { notFound } from "next/navigation";
import { currentRole } from "@/lib/authz/guard";
import { atLeast } from "@/lib/authz/roles";
import { SUMMARY_COLUMNS, toSummary } from "@/lib/polish/route";
import { createClient, getUser } from "@/lib/supabase/server";
import { RequestList } from "../parts";

export const metadata = { title: "Polish queue · SignCraft" };
export const dynamic = "force-dynamic";

/** The designer queue. Designers and admins only; everyone else gets a 404. */
export default async function QueuePage() {
  const role = await currentRole();
  if (!role || !atLeast(role, "designer")) notFound();
  const supabase = await createClient();
  const user = supabase ? await getUser() : null;
  if (!supabase || !user) notFound();

  const [held, waiting] = await Promise.all([
    supabase.from("polish_requests").select(SUMMARY_COLUMNS).eq("designer_id", user.id).in("status", ["in_progress", "delivered"]).order("updated_at", { ascending: false }).limit(100),
    supabase.from("polish_requests").select(SUMMARY_COLUMNS).eq("status", "requested").order("created_at", { ascending: true }).limit(100),
  ]);
  const failed = held.error ?? waiting.error;
  if (failed) {
    console.error("[polish] could not load the queue:", failed.code);
    return <p className="card p-6 text-sm">Could not load the queue. Has <code>supabase/migrations/0008_designer_polish.sql</code> been applied?</p>;
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="held-h">
        <h2 id="held-h" className="mb-3 text-lg font-semibold">Working on</h2>
        <RequestList items={(held.data ?? []).flatMap((r) => toSummary(r) ?? [])} empty="You are not holding any request. Claim one below." />
      </section>
      <section aria-labelledby="queue-h">
        <h2 id="queue-h" className="mb-1 text-lg font-semibold">Waiting for a designer</h2>
        <p className="mb-3 text-sm text-muted">Oldest first. Open one to look at it, then claim it to work on it. Only one designer can hold a request.</p>
        <RequestList items={(waiting.data ?? []).flatMap((r) => toSummary(r) ?? [])} empty="The queue is empty." />
      </section>
    </div>
  );
}
