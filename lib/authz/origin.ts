/**
 * A browser sends an Origin header on cross-site writes. If it is present and is not this site, refuse: a page on
 * another domain must not be able to make someone's browser change settings. (Requests with no Origin, such as
 * curl, still need the person's session cookie, so they are no easier to forge.)
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
