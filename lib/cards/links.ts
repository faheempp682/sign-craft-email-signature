/**
 * Every link on a public card goes through one of these. Anything that is not clearly an https, mailto or tel link
 * becomes null and the page leaves the link out. Values are never trusted, even though the database also checks them.
 */

const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;

/** An https URL without credentials, control characters or whitespace; returns the normalised URL or null. */
export function httpsHref(value: string | null | undefined): string | null {
  if (!value || value.length > 500 || CONTROL.test(value) || /\s/.test(value)) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** tel: link from a phone number; keeps digits and a leading plus only. */
export function telHref(value: string | null | undefined): string | null {
  if (!value || value.length > 40 || CONTROL.test(value)) return null;
  const digits = value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return /^\+?\d{3,20}$/.test(digits) ? `tel:${digits}` : null;
}

/** mailto: link from an email address (no extra recipients, no headers). */
export function mailHref(value: string | null | undefined): string | null {
  if (!value || value.length > 200 || CONTROL.test(value) || /[\s<>,;?&%"']/.test(value)) return null;
  return /^[^@]+@[^@]+\.[^@]+$/.test(value) ? `mailto:${value}` : null;
}

/** Only #RRGGBB reaches a style attribute. */
export function safeColor(value: string | null | undefined, fallback = "#111111"): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

/** Black or white, whichever reads better on the colour (WCAG relative luminance). */
export function inkOn(hex: string): "#ffffff" | "#111111" {
  const c = safeColor(hex);
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return lum > 0.4 ? "#111111" : "#ffffff";
}
