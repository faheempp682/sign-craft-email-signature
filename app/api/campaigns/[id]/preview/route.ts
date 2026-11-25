import { campaignAdmin, dbFailure, noStore, notFound, UUID_RE } from "@/lib/campaigns/route";
import { LinkRequest } from "@/lib/campaigns/schemas";
import { isRunning, pickVariant } from "@/lib/campaigns/variant";

export const runtime = "nodejs";

/** Which variant a given signature would be shown right now (and whether the campaign is running at all). Admin + campaigns flag. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const a = await campaignAdmin(req, LinkRequest);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const sig = a.ctx.data.signature_id;
  if (!sig) return Response.json({ message: "Enter a signature id." }, { status: 400, headers: noStore });

  const { data, error } = await supabase.from("banner_campaigns").select("id, status, starts_at, ends_at, fallback_src, campaign_variants(id, label, image_url, weight)").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (error) return dbFailure(error);
  if (!data) return notFound();

  const variants = (data.campaign_variants ?? []) as { id: string; label: string; image_url: string; weight: number }[];
  const running = isRunning(data, new Date());
  const v = running ? pickVariant(variants, id, sig) : null;
  return Response.json({ running, variant: v ? { id: v.id, label: v.label, image_url: v.image_url } : null, fallback_src: data.fallback_src }, { headers: noStore });
}
