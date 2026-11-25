import { notFound } from "next/navigation";
import { featureEnabled } from "@/lib/authz/guard";
import { adminOrg } from "@/lib/campaigns/route";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/supabase/server";
import { CampaignsAdmin, type CampaignRow } from "./campaigns-admin";

export const metadata = { title: "Campaigns · Admin · SignCraft" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!supabase || !user) return null;
  if ((await featureEnabled(supabase, "campaigns")) !== true) notFound();

  const orgId = await adminOrg(supabase, user.id);
  if (!orgId) return <p className="card p-6 text-sm">You are not an admin of any organization.</p>;

  const { data, error } = await supabase
    .from("banner_campaigns")
    .select("id, name, status, starts_at, ends_at, href, fallback_src, fallback_alt, campaign_variants(id, label, image_url, alt_text, width, height, weight)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[admin/campaigns] load failed:", error.message);
    return <p className="card p-6 text-sm">Could not load campaigns. Has <code>supabase/migrations/0006_campaigns.sql</code> been applied?</p>;
  }

  const rows: CampaignRow[] = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    href: c.href,
    fallbackSrc: c.fallback_src,
    fallbackAlt: c.fallback_alt,
    variants: ((c.campaign_variants ?? []) as { id: string; label: string; image_url: string; alt_text: string; width: number; height: number; weight: number }[]).map((v) => ({ id: v.id, label: v.label, imageUrl: v.image_url, altText: v.alt_text, width: v.width, height: v.height, weight: v.weight })),
  }));

  return <CampaignsAdmin campaigns={rows} trackingReady={!!process.env.CAMPAIGN_TOKEN_SECRET && process.env.CAMPAIGN_TOKEN_SECRET.length >= 32} />;
}
