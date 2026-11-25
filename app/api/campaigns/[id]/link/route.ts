import { campaignAdmin, dbFailure, noStore, notFound, UUID_RE } from "@/lib/campaigns/route";
import { LinkRequest } from "@/lib/campaigns/schemas";
import { readSecret, signToken } from "@/lib/campaigns/token";
import { deny } from "@/lib/authz/guard";

export const runtime = "nodejs";

const GENERIC_SIGNATURE = "00000000-0000-4000-8000-000000000000";

/** The signed click link and image link for a campaign, for a given signature (or a generic one). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const a = await campaignAdmin(req, LinkRequest);
  if (!a.ok) return a.response;
  const secret = readSecret();
  if (!secret) return deny(503, "not_configured", "Set CAMPAIGN_TOKEN_SECRET (at least 32 characters) on the server to create tracked links.");

  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("banner_campaigns").select("id, href, fallback_src").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (error) return dbFailure(error);
  if (!data) return notFound();

  const base = (process.env.CAMPAIGN_BASE_URL?.trim() || new URL(req.url).origin).replace(/\/+$/, "");
  const s = a.ctx.data.signature_id ?? GENERIC_SIGNATURE;
  return Response.json(
    {
      click_url: `${base}/r/${signToken({ t: "r", c: id, s, h: data.href }, secret)}`,
      image_url: `${base}/b/${signToken({ t: "b", c: id, s, f: data.fallback_src }, secret)}`,
      public_base: base,
      warning: /localhost|127\.0\.0\.1/.test(base) ? "These links point at a local address, so recipients cannot open them. Set CAMPAIGN_BASE_URL to your public address." : null,
    },
    { headers: noStore },
  );
}
