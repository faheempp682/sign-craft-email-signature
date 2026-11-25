export type StatRow = { campaign_id: string; variant_id: string | null; day: string; clicks: number; unique_clicks: number; image_loads: number };
export type CampaignInfo = { id: string; name: string; variants: { id: string; label: string }[] };

export type VariantTotals = { variantId: string | null; label: string; clicks: number; uniqueClicks: number; imageLoads: number; ctr: number | null };
export type CampaignTotals = {
  campaignId: string;
  name: string;
  clicks: number;
  uniqueClicks: number;
  imageLoads: number;
  ctr: number | null;
  variants: VariantTotals[];
  days: { day: string; clicks: number; imageLoads: number }[];
};

/** Clicks per image load. Image loads are inflated by mail-app prefetching, so this is a rough guide, not a true CTR. */
const ratio = (clicks: number, loads: number) => (loads > 0 ? clicks / loads : null);

/** Totals per campaign, per variant, and per day (days with no data are filled in so charts have no gaps). */
export function summarize(rows: StatRow[], campaigns: CampaignInfo[], from: string, to: string): CampaignTotals[] {
  const dayList = daysBetween(from, to);
  return campaigns.map((c) => {
    const mine = rows.filter((r) => r.campaign_id === c.id);
    const labels = new Map<string | null, string>([[null, "Fallback banner"], ...c.variants.map((v, i) => [v.id, v.label || `Variant ${String.fromCharCode(65 + i)}`] as const)]);
    const byVariant = new Map<string | null, VariantTotals>();
    for (const v of [...c.variants.map((x) => x.id), ...(mine.some((r) => r.variant_id === null) ? [null] : [])]) {
      byVariant.set(v, { variantId: v, label: labels.get(v) ?? "Removed variant", clicks: 0, uniqueClicks: 0, imageLoads: 0, ctr: null });
    }
    for (const r of mine) {
      const t = byVariant.get(r.variant_id) ?? { variantId: r.variant_id, label: labels.get(r.variant_id) ?? "Removed variant", clicks: 0, uniqueClicks: 0, imageLoads: 0, ctr: null };
      t.clicks += r.clicks;
      t.uniqueClicks += r.unique_clicks;
      t.imageLoads += r.image_loads;
      byVariant.set(r.variant_id, t);
    }
    const variants = [...byVariant.values()].map((t) => ({ ...t, ctr: ratio(t.clicks, t.imageLoads) }));
    const days = dayList.map((day) => {
      const d = mine.filter((r) => r.day === day);
      return { day, clicks: d.reduce((n, r) => n + r.clicks, 0), imageLoads: d.reduce((n, r) => n + r.image_loads, 0) };
    });
    const clicks = variants.reduce((n, v) => n + v.clicks, 0);
    const imageLoads = variants.reduce((n, v) => n + v.imageLoads, 0);
    return { campaignId: c.id, name: c.name, clicks, uniqueClicks: variants.reduce((n, v) => n + v.uniqueClicks, 0), imageLoads, ctr: ratio(clicks, imageLoads), variants, days };
  });
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to) && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** A spreadsheet cell that cannot run as a formula (leading = + - @ tab or CR) and is quoted when needed. */
export function csvCell(v: string | number | null): string {
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(totals: CampaignTotals[], rows: StatRow[], campaigns: CampaignInfo[]): string {
  const info = new Map(campaigns.map((c) => [c.id, c]));
  const head = ["date", "campaign", "variant", "clicks", "unique_clicks_that_day", "image_loads_not_impressions"];
  const lines = rows.map((r) => {
    const c = info.get(r.campaign_id);
    const label = r.variant_id === null ? "Fallback banner" : (totals.find((t) => t.campaignId === r.campaign_id)?.variants.find((v) => v.variantId === r.variant_id)?.label ?? "Removed variant");
    return [r.day, c?.name ?? "Deleted campaign", label, r.clicks, r.unique_clicks, r.image_loads].map(csvCell).join(",");
  });
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
