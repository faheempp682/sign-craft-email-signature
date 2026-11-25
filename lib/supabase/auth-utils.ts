/**
 * Only allow same-site relative redirects, so `?next=` can never bounce a user to another domain.
 * Whitespace and control characters are refused outright: browsers delete tabs and line breaks anywhere in a URL, so
 * "/<TAB>/evil.com" would otherwise reach them as "//evil.com". Real paths are percent-encoded and never contain them.
 */
export function safeNext(next: unknown, fallback = "/create"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\s\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}

/**
 * Sign-up is invite-only (migration 0017): the database refuses an address with no invitation, and Supabase Auth reports that
 * as "Database error saving new user". Anything else is shown as Supabase wrote it.
 */
export function signUpError(message: string): string {
  if (/database error saving new user/i.test(message)) return "Sign-up is by invitation only. Ask an admin to invite this email address, then try again.";
  return message;
}

/**
 * Optional sign-up allowlist, e.g. ALLOWED_EMAIL_DOMAINS="kimp.xyz,example.com".
 * Empty or unset means anyone may sign up (Supabase's own signup toggle still applies).
 */
export function isEmailAllowed(email: string, allowlist = process.env.ALLOWED_EMAIL_DOMAINS ?? ""): boolean {
  const domains = allowlist.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (domains.length === 0) return true;
  const domain = email.trim().toLowerCase().split("@")[1];
  return !!domain && domains.includes(domain);
}
