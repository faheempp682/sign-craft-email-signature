import Link from "next/link";
import { featureEnabled } from "@/lib/authz/guard";
import { SUMMARY_COLUMNS, toSummary } from "@/lib/polish/route";
import { createClient, getUser } from "@/lib/supabase/server";
import { RequestList } from "./parts";

export const metadata = { title: "Designer polish · SignCraft" };
export const dynamic = "force-dynamic";

/** My requests: the signed-in person's own, newest first. Row-level security already limits the rows; the filter makes the intent explicit. */
export default async function MyRequestsPage() {
  const supabase = await createClient();
  const user = supabase ? await getUser() : null;
  if (!supabase || !user) return <p className="card p-6 text-sm">Sign in to see your polish requests.</p>;

  const { data, error } = await supabase.from("polish_requests").select(SUMMARY_COLUMNS).eq("requester_id", user.id).order("created_at", { ascending: false }).limit(100);
  if (error) {
    console.error("[polish] could not load requests:", error.code);
    return <p className="card p-6 text-sm">Could not load your requests. Has <code>supabase/migrations/0008_designer_polish.sql</code> been applied?</p>;
  }
  const items = (data ?? []).flatMap((r) => toSummary(r) ?? []);
  const enabled = await featureEnabled(supabase, "designer_polish");

  return (
    <div className="space-y-6">
      {enabled === false && (
        <p className="card p-4 text-sm text-muted sm:p-6">
          Designer polish is not switched on for your account, so you cannot send new requests. Ask an admin to enable it for you or your organization.
        </p>
      )}
      <RequestList
        items={items}
        empty={
          <>
            You have not asked for polish yet. Save a signature, then press <strong className="text-ink">Request polish</strong> next to it.{" "}
            <Link href="/signatures" className="underline underline-offset-2">Go to your signatures</Link>.
          </>
        }
      />
    </div>
  );
}
