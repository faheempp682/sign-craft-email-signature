import { deny, requireUser } from "@/lib/authz/guard";
import { sameOrigin } from "@/lib/authz/origin";
import { noStore } from "@/lib/campaigns/route";
import { RenderRequest } from "@/lib/campaigns/schemas";
import { trackingOptions } from "@/lib/campaigns/tracking";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { SignatureDocSchema } from "@/lib/schema/document";

export const runtime = "nodejs";

/**
 * The signature's HTML with tracked banners signed. The browser cannot do this itself (the signing secret is server
 * only). The caller must own the signature, so tokens are only ever minted for the caller's own signature ids.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return deny(403, "bad_origin", "This request did not come from the app.");
  const g = await requireUser();
  if (!g.ok) return g.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return deny(400, "bad_request", "Request body must be JSON.");
  }
  const parsed = RenderRequest.safeParse(body);
  if (!parsed.success) return deny(400, "bad_request", parsed.error.issues[0]?.message ?? "Invalid request.");
  const doc = SignatureDocSchema.safeParse(parsed.data.doc);
  if (!doc.success) return deny(400, "bad_request", "That signature is not valid.");

  const owned = await g.ctx.supabase.from("signatures").select("id").eq("id", parsed.data.signature_id).eq("owner_id", g.ctx.user.id).maybeSingle();
  if (owned.error || !owned.data) return deny(404, "not_found", "That signature does not exist.");

  // A token may only name a campaign the caller can see (their own organization's), never someone else's.
  const wanted = [...new Set(doc.data.blocks.flatMap((b) => (b.type === "banner" && b.track && b.campaign_id ? [b.campaign_id] : [])))];
  if (wanted.length) {
    const seen = await g.ctx.supabase.from("banner_campaigns").select("id").in("id", wanted);
    if (seen.error || (seen.data?.length ?? 0) !== wanted.length) return deny(400, "bad_request", "A banner uses a campaign that does not exist.");
  }

  const tracking =trackingOptions(parsed.data.signature_id, new URL(req.url).origin);
  const html = renderToEmailHtml(doc.data, { tracking });
  return Response.json({ html, tracked: !!tracking }, { headers: noStore });
}
