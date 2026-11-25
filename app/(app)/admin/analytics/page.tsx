import { notFound } from "next/navigation";
import { featureEnabled } from "@/lib/authz/guard";
import { loadStats } from "@/lib/campaigns/load";
import { adminOrg } from "@/lib/campaigns/route";
import { StatsQuery } from "@/lib/campaigns/schemas";
import { createClient, getUser } from "@/lib/supabase/server";
import { AnalyticsView } from "./analytics-view";

export const metadata = { title: "Analytics · Admin · SignCraft" };
export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient();
  const user = await getUser();
  if (!supabase || !user) return null;
  if ((await featureEnabled(supabase, "analytics")) !== true) notFound();

  const orgId = await adminOrg(supabase, user.id);
  if (!orgId) return <p className="card p-6 text-sm">You are not an admin of any organization.</p>;

  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const today = new Date();
  const fallback = { from: iso(new Date(today.getTime() - 29 * 86_400_000)), to: iso(today) };
  const parsed = StatsQuery.safeParse({ from: pick("from") ?? fallback.from, to: pick("to") ?? fallback.to });
  const range = parsed.success ? { from: parsed.data.from, to: parsed.data.to } : fallback;

  const r = await loadStats(supabase, orgId, range.from, range.to);
  if (!r.ok) {
    console.error("[admin/analytics] load failed:", r.error.code, r.error.message);
    return <p className="card p-6 text-sm">Could not load analytics. Has <code>supabase/migrations/0006_campaigns.sql</code> been applied?</p>;
  }
  return <AnalyticsView totals={r.data.totals} from={range.from} to={range.to} rangeError={parsed.success ? "" : (parsed.error.issues[0]?.message ?? "Invalid dates.")} />;
}
