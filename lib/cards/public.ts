import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { SLUG_RE, type PublicCard } from "./schema";

/**
 * The only way the public pages read a card: the get_public_card() database function, called as the anonymous role
 * without cookies. It returns nothing for unpublished or missing cards, so both look identical to a visitor.
 */
export async function fetchPublicCard(slug: string): Promise<PublicCard | null> {
  const s = slug.toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  const env = getSupabaseEnv();
  if (!env) return null;
  const supabase = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await supabase.rpc("get_public_card", { p_slug: s });
  if (error) {
    console.error("[cards] public lookup failed:", error.code);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  // Copy only the known public fields, so nothing unexpected could ever be rendered or serialised.
  return {
    slug: String(row.slug),
    display_name: String(row.display_name),
    title: row.title ?? null,
    company: row.company ?? null,
    bio: row.bio ?? null,
    photo_url: row.photo_url ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    website: row.website ?? null,
    address: row.address ?? null,
    social_links: Array.isArray(row.social_links) ? row.social_links : [],
    booking_url: row.booking_url ?? null,
    accent_color: row.accent_color ?? "#111111",
    indexable: row.indexable === true,
  };
}

/** Public base URL: NEXT_PUBLIC_SITE_URL when set (recommended in production), otherwise the request's own origin. */
export function siteOrigin(headers: Pick<Headers, "get">): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\/[^\s/]+$/.test(configured)) return configured;
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000").split(",")[0].trim().replace(/[^a-zA-Z0-9.:-]/g, "");
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = headers.get("x-forwarded-proto")?.split(",")[0].trim();
  return `${proto === "http" || (local && proto !== "https") ? "http" : "https"}://${host}`;
}
