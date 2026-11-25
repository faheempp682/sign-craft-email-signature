import { deny } from "@/lib/authz/guard";
import { loadStats } from "@/lib/campaigns/load";
import { campaignAdmin, dbFailure, noStore } from "@/lib/campaigns/route";
import { StatsQuery } from "@/lib/campaigns/schemas";
import { toCsv } from "@/lib/campaigns/stats";

export const runtime = "nodejs";

/**
 * Click and image-load numbers per campaign, variant and day for a date range. Admin + analytics flag.
 * ?from=2026-01-01&to=2026-01-31[&org_id=...][&format=csv]
 */
export async function GET(req: Request) {
  const q = StatsQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return deny(400, "bad_request", q.error.issues[0]?.message ?? "Invalid request.");
  const a = await campaignAdmin(req, null, "analytics", q.data.org_id);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;

  const r = await loadStats(supabase, orgId, q.data.from, q.data.to);
  if (!r.ok) return dbFailure(r.error);
  const { rows, campaigns, totals } = r.data;

  if (q.data.format === "csv") {
    return new Response(toCsv(totals, rows, campaigns), {
      headers: { ...noStore, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="campaign-clicks-${q.data.from}-to-${q.data.to}.csv"`, "X-Content-Type-Options": "nosniff" },
    });
  }
  return Response.json({ totals, from: q.data.from, to: q.data.to }, { headers: noStore });
}
