/**
 * Which pages and endpoints can be opened without signing in. The middleware uses this; nothing else decides it.
 *
 * ALWAYS_PUBLIC are things that must work for people who are not users:
 *   /c   public digital card pages
 *   /b   banner images that email recipients' mail apps load from inside a signature
 *   /r   click redirects from a signature
 *   /api/public   endpoints meant for anonymous callers (each must rate-limit itself)
 *   /api/sync/run the scheduled directory/CRM sync. No session is involved: it checks a long shared secret itself
 *                 (SYNC_CRON_SECRET, constant-time) and is switched off when that is unset or too short.
 *                 Matched exactly: its siblings (/api/sync/runs, /preview, ...) are admin screens and stay private.
 *   /api/health/run the scheduled signature health check. Same arrangement: it checks HEALTH_CRON_SECRET itself
 *                 (constant-time, off when unset or under 32 characters); /api/health/status, /findings, etc. stay private.
 *
 * SITE_PUBLIC is the marketing site and free generator. It is ONLY public when PUBLIC_SITE_ENABLED=true, so an
 * internal-only deployment never exposes it by accident.
 */
export const ALWAYS_PUBLIC = ["/login", "/reset-password", "/auth", "/c", "/b", "/r", "/api/public", "/api/sync/run", "/api/health/run"];
export const SITE_PUBLIC = ["/", "/signature-generator", "/for", "/privacy", "/terms", "/sitemap.xml", "/robots.txt"];

const matches = (pathname: string, list: string[]) => list.some((p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)));

export const publicSiteEnabled = (env: Record<string, string | undefined> = process.env) => env.PUBLIC_SITE_ENABLED === "true";

export function isPublicPath(pathname: string, siteEnabled = publicSiteEnabled()): boolean {
  return matches(pathname, ALWAYS_PUBLIC) || (siteEnabled && matches(pathname, SITE_PUBLIC));
}
