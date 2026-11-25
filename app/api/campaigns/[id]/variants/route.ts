import { campaignAdmin, dbFailure, noStore, notFound, UUID_RE } from "@/lib/campaigns/route";
import { VariantsPut } from "@/lib/campaigns/schemas";

export const runtime = "nodejs";

/**
 * Replace the campaign's A/B variants with the given list (at most 8). Ids that do not belong to this campaign are
 * treated as new variants, so a request can never move or overwrite another campaign's variant.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const a = await campaignAdmin(req, VariantsPut);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;

  const camp = await supabase.from("banner_campaigns").select("id").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (camp.error) return dbFailure(camp.error);
  if (!camp.data) return notFound();

  const existing = await supabase.from("campaign_variants").select("id").eq("campaign_id", id);
  if (existing.error) return dbFailure(existing.error);
  const mine = new Set((existing.data ?? []).map((r: { id: string }) => r.id));

  const keep = new Set<string>();
  const rows = a.ctx.data.variants.map((v) => {
    const own = v.id && mine.has(v.id) ? v.id : undefined;
    if (own) keep.add(own);
    return { ...(own ? { id: own } : {}), campaign_id: id, label: v.label, image_url: v.image_url, alt_text: v.alt_text, width: v.width, height: v.height, weight: v.weight };
  });

  const drop = [...mine].filter((x) => !keep.has(x));
  if (drop.length) {
    const del = await supabase.from("campaign_variants").delete().in("id", drop).eq("campaign_id", id);
    if (del.error) return dbFailure(del.error);
  }
  const withId = rows.filter((r) => "id" in r);
  const fresh = rows.filter((r) => !("id" in r));
  if (withId.length) {
    const up = await supabase.from("campaign_variants").upsert(withId, { onConflict: "id" });
    if (up.error) return dbFailure(up.error);
  }
  if (fresh.length) {
    const ins = await supabase.from("campaign_variants").insert(fresh);
    if (ins.error) return dbFailure(ins.error);
  }
  return Response.json({ ok: true }, { headers: noStore });
}
