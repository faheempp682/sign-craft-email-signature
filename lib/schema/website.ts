/**
 * Strict check for a website the user typed ("example.com", "www.example.com/page", "https://example.com").
 * Rejects whitespace, credentials ("www.@example.com" parses as user "www"), single-label hosts and malformed domains.
 * Returns the https URL it would link to, or null.
 */
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i;

export function normalizeWebsite(raw: string): string | null {
  const s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return null;
  const rest = s.replace(/^https?:\/\//i, "");
  // Anything before the first "/", "?" or "#" is the authority; an "@" there is credentials, never part of a real site.
  const authority = rest.split(/[/?#]/, 1)[0];
  if (!authority || authority.includes("@")) return null;
  let u: URL;
  try {
    u = new URL(`https://${rest}`);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  const host = u.hostname.replace(/\.$/, "");
  const labels = host.split(".");
  if (host.length > 253 || labels.length < 2) return null;
  if (!labels.every((l) => LABEL.test(l)) || !TLD.test(labels[labels.length - 1])) return null;
  return u.toString();
}

export const isValidWebsite = (raw: string): boolean => normalizeWebsite(raw) !== null;
