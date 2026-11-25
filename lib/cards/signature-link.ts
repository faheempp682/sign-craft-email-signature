import { SLUG_RE } from "./schema";

/**
 * The address of a digital card, for "add my card link to my signature".
 *
 *   cardUrl("ada-lovelace", "https://sign.example.com")  ->  "https://sign.example.com/c/ada-lovelace"
 *
 * Returns null for an invalid slug or a base that is not an https (or localhost http) origin, so the integrator never
 * puts a bad link into a signature. Pass the app's public origin (NEXT_PUBLIC_SITE_URL, or window.location.origin).
 */
export function cardUrl(slug: string, origin: string): string | null {
  const s = slug.trim().toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  try {
    const u = new URL(origin);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
    return `${u.origin}/c/${s}`;
  } catch {
    return null;
  }
}

/** A ready-made link block for a signature: text and href (the editor decides how to render it). */
export function signatureCardLink(slug: string, origin: string, label = "View my digital card") {
  const href = cardUrl(slug, origin);
  return href ? { href, label } : null;
}
