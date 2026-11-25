import type { SupabaseClient } from "@supabase/supabase-js";
import { summarize, type CampaignInfo, type CampaignTotals, type StatRow } from "./stats";

export type Loaded = { rows: StatRow[]; campaigns: CampaignInfo[]; totals: CampaignTotals[] };

/** Stats for an organization and date range through the caller's own client, so row-level security still applies. */
export async function loadStats(supabase: SupabaseClient, orgId: string, from: string, to: string): Promise<{ ok: true; data: Loaded } | { ok: false; error: { code?: string; message: string } }> {
  const [stats, camps] = await Promise.all([
    supabase.rpc("campaign_stats", { p_org: orgId, p_from: from, p_to: to }),
    supabase.from("banner_campaigns").select("id, name, campaign_variants(id, label)").eq("org_id", orgId).order("created_at", { ascending: false }).limit(200),
  ]);
  if (stats.error) return { ok: false, error: stats.error };
  if (camps.error) return { ok: false, error: camps.error };
  const rows: StatRow[] = ((stats.data ?? []) as Record<string, unknown>[]).map((r) => ({
    campaign_id: String(r.campaign_id),
    variant_id: r.variant_id ? String(r.variant_id) : null,
    day: String(r.day).slice(0, 10),
    clicks: Number(r.clicks),
    unique_clicks: Number(r.unique_clicks),
    image_loads: Number(r.image_loads),
  }));
  const campaigns: CampaignInfo[] = ((camps.data ?? []) as { id: string; name: string; campaign_variants: { id: string; label: string }[] }[]).map((c) => ({ id: c.id, name: c.name, variants: c.campaign_variants ?? [] }));
  return { ok: true, data: { rows, campaigns, totals: summarize(rows, campaigns, from, to) } };
}
