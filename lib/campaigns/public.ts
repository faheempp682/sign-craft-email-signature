import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, createLimiter, deviceClass, type Limiter } from "./limiter";
import { safeTarget, readSecret, verifyToken, visitorHash } from "./token";
import { isRunning, pickVariant } from "./variant";

/**
 * The two anonymous endpoints, /b/<token> (banner image) and /r/<token> (click). Everything here is hostile input:
 * tokens are verified before anything else happens, the only redirect targets are values that were signed into the
 * token or stored by an admin, and every refusal looks the same so nobody can learn whether a campaign exists.
 */

export type PublicCampaign = {
  id: string;
  org_id: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  href: string;
  fallback_src: string;
  variants: { id: string; image_url: string; weight: number }[];
};

export interface CampaignStore {
  getCampaign(id: string): Promise<PublicCampaign | null>;
  recordImageLoad(campaignId: string, variantId: string | null): Promise<void>;
  recordClick(campaignId: string, variantId: string | null, device: string, visitor: string): Promise<void>;
}

export type PublicDeps = { secret: string | null; store: CampaignStore | null; now: () => Date; limiter: Limiter };

const BASE_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

/** The one answer for everything we refuse: bad token, wrong kind, nothing to show. Carries no information. */
const refuse = () => new Response(null, { status: 404, headers: { ...BASE_HEADERS, "Cache-Control": "no-store" } });
const redirect = (to: string, cache: string) => new Response(null, { status: 302, headers: { ...BASE_HEADERS, Location: to, "Cache-Control": cache } });

/** Banner image. 302 to the chosen variant (or the signed fallback). Never a campaign-specific error. */
export async function handleBanner(req: Request, token: string, deps: PublicDeps): Promise<Response> {
  const p = verifyToken(token, deps.secret, "b");
  if (!p) return refuse();
  const fallback = safeTarget(p.f);
  const cache = "public, max-age=300, s-maxage=300";
  const allowed = deps.limiter.allow(`b:${clientIp(req)}`);
  if (!allowed || !deps.store || !p.c) return fallback ? redirect(fallback, cache) : refuse();

  let camp: PublicCampaign | null = null;
  try {
    camp = await deps.store.getCampaign(p.c);
  } catch (e) {
    console.error("[campaigns] banner lookup failed:", (e as Error).message);
  }
  const variant = camp && isRunning(camp, deps.now()) ? pickVariant(camp.variants, camp.id, p.s) : null;
  const target = safeTarget(variant?.image_url) ?? fallback;
  if (!target) return refuse();

  if (camp && req.method !== "HEAD") {
    try {
      await deps.store!.recordImageLoad(camp.id, variant?.id ?? null);
    } catch (e) {
      console.error("[campaigns] image load not counted:", (e as Error).message);
    }
  }
  return redirect(target, cache);
}

/** Click. Logs it (GET only, never HEAD) and 302s to the stored or signed https target. */
export async function handleClick(req: Request, token: string, deps: PublicDeps): Promise<Response> {
  const p = verifyToken(token, deps.secret, "r");
  if (!p) return refuse();
  const signedTarget = safeTarget(p.h);
  const noStore = "no-store";
  const ip = clientIp(req);
  if (!deps.limiter.allow(`r:${ip}`)) {
    // Still send the person where the link goes when we can do so without touching the database; never log.
    return signedTarget ? redirect(signedTarget, noStore) : new Response(null, { status: 429, headers: { ...BASE_HEADERS, "Retry-After": "30", "Cache-Control": noStore } });
  }

  let camp: PublicCampaign | null = null;
  if (p.c && deps.store) {
    try {
      camp = await deps.store.getCampaign(p.c);
    } catch (e) {
      console.error("[campaigns] click lookup failed:", (e as Error).message);
    }
  }
  const target = safeTarget(camp?.href) ?? signedTarget;
  if (!target) return refuse();

  if (camp && deps.store && deps.secret && req.method === "GET") {
    const now = deps.now();
    const variant = isRunning(camp, now) ? pickVariant(camp.variants, camp.id, p.s) : null;
    const hash = visitorHash(deps.secret, now.toISOString().slice(0, 10), ip, req.headers.get("user-agent") ?? "");
    try {
      await deps.store.recordClick(camp.id, variant?.id ?? null, deviceClass(req.headers.get("user-agent")), hash);
    } catch (e) {
      console.error("[campaigns] click not recorded:", (e as Error).message);
    }
  }
  return redirect(target, noStore);
}

/* ---------------------------------------------------------------- real wiring */

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: PublicCampaign | null }>();

/** Reads and counts through the service-role client (the browser-facing roles cannot touch the event tables at all). */
export function supabaseStore(): CampaignStore | null {
  const admin = createAdminClient();
  if (!admin) return null;
  return {
    async getCampaign(id) {
      const hit = cache.get(id);
      if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
      const { data, error } = await admin
        .from("banner_campaigns")
        .select("id, org_id, status, starts_at, ends_at, href, fallback_src, campaign_variants(id, image_url, weight)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const value: PublicCampaign | null = data
        ? { id: data.id, org_id: data.org_id, status: data.status, starts_at: data.starts_at, ends_at: data.ends_at, href: data.href, fallback_src: data.fallback_src, variants: (data.campaign_variants ?? []) as PublicCampaign["variants"] }
        : null;
      if (cache.size > 500) cache.clear();
      cache.set(id, { at: Date.now(), value });
      return value;
    },
    async recordImageLoad(campaignId, variantId) {
      const { error } = await admin.rpc("record_image_load", { p_campaign: campaignId, p_variant: variantId });
      if (error) throw new Error(error.message);
    },
    async recordClick(campaignId, variantId, device, visitor) {
      const { error } = await admin.rpc("record_click", { p_campaign: campaignId, p_variant: variantId, p_device: device, p_visitor: visitor });
      if (error) throw new Error(error.message);
    },
  };
}

const limiter = createLimiter({ max: 120, windowMs: 60_000 });

export function defaultDeps(): PublicDeps {
  return { secret: readSecret(), store: supabaseStore(), now: () => new Date(), limiter };
}
