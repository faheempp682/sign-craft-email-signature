/** What search engines may see. Pure functions so app/sitemap.ts and app/robots.ts stay trivial and testable. */
import { getBrand, type Brand } from "@/lib/brand";
import { publicSiteEnabled } from "@/lib/public-routes";
import { NICHES } from "./niches";

type Env = Record<string, string | undefined>;

/** Indexable public pages. Only these appear in the sitemap. */
export const SITE_PATHS = ["/", "/signature-generator", ...NICHES.map((n) => `/for/${n.slug}`), "/privacy", "/terms"] as const;

/** Private areas of the app. Disallowed even when the site is on, so crawlers never waste time on login walls. */
export const PRIVATE_PREFIXES = ["/api/", "/admin", "/create", "/editor", "/signatures", "/preview", "/guides", "/login", "/auth", "/c/", "/b/", "/r/"];

export type SitemapEntry = { url: string; lastModified?: Date; changeFrequency: "monthly"; priority: number };

/** Empty when the site is off, and also when no BRAND_DOMAIN is set (sitemap URLs must be absolute; we will not guess). */
export function sitemapEntries(env: Env = process.env, brand: Brand = getBrand(env), now: Date = new Date()): SitemapEntry[] {
  if (!publicSiteEnabled(env) || !brand.siteUrl) return [];
  return SITE_PATHS.map((p) => ({ url: `${brand.siteUrl}${p === "/" ? "" : p}`, lastModified: now, changeFrequency: "monthly" as const, priority: p === "/" ? 1 : p === "/signature-generator" ? 0.9 : 0.7 }));
}

export type RobotsRules = { rules: { userAgent: string; allow?: string[]; disallow: string[] }; sitemap?: string };

export function robotsRules(env: Env = process.env, brand: Brand = getBrand(env)): RobotsRules {
  if (!publicSiteEnabled(env)) return { rules: { userAgent: "*", disallow: ["/"] } };
  return { rules: { userAgent: "*", allow: ["/"], disallow: PRIVATE_PREFIXES }, ...(brand.siteUrl ? { sitemap: `${brand.siteUrl}/sitemap.xml` } : {}) };
}
