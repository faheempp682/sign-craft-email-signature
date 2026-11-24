/** Only allow same-site relative redirects, so `?next=` can never bounce a user to another domain. */
export function safeNext(next: unknown, fallback = "/create"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
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
