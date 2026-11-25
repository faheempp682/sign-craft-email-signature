/**
 * Product identity. The final name, domain and company are still an open decision of the owner, so nothing in page
 * copy may hardcode them: pages read everything from here, and this reads everything from the environment.
 *
 * Server-only values (plain `process.env`). Client components receive what they need as props.
 *
 *   BRAND_NAME             product name                       default "SignCraft"
 *   BRAND_TAGLINE          one-line description               default below
 *   BRAND_DOMAIN           public host, no scheme             e.g. "example.com" (unset = no canonical/sitemap URLs)
 *   BRAND_COMPANY          legal entity that runs the service default "the operator of this service"
 *   BRAND_CONTACT_EMAIL    privacy and support address        unset = pages say the contact is not yet published
 *   BRAND_ADDRESS          postal address for legal pages     optional
 *   BRAND_JURISDICTION     governing law for the terms        optional (e.g. "England and Wales")
 */

export type Brand = {
  name: string;
  tagline: string;
  domain: string | null;
  company: string;
  companyIsPlaceholder: boolean;
  contactEmail: string | null;
  address: string | null;
  jurisdiction: string | null;
  /** https origin without a trailing slash, or null when no domain is configured. */
  siteUrl: string | null;
};

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined, max = 200): string | null => {
  const t = (v ?? "").trim().slice(0, max);
  return t ? t : null;
};

/** A bare host such as "example.com" or "app.example.co.uk:8443". Anything else (paths, schemes, spaces) is rejected. */
export function normaliseDomain(raw: string | undefined): string | null {
  const t = clean(raw, 253);
  if (!t) return null;
  const host = t.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i.test(host) ? host.toLowerCase() : null;
}

export function getBrand(env: Env = process.env): Brand {
  const domain = normaliseDomain(env.BRAND_DOMAIN);
  const company = clean(env.BRAND_COMPANY);
  const email = clean(env.BRAND_CONTACT_EMAIL, 254);
  const name = clean(env.BRAND_NAME, 60) ?? "SignCraft";
  return {
    name,
    tagline: clean(env.BRAND_TAGLINE, 140) ?? "Professional email signatures, built to Outlook-safe rules.",
    domain,
    company: company ?? "the operator of this service",
    companyIsPlaceholder: !company,
    contactEmail: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    address: clean(env.BRAND_ADDRESS),
    jurisdiction: clean(env.BRAND_JURISDICTION),
    siteUrl: domain ? `https://${domain}` : null,
  };
}

/** Absolute URL for a path, or null when no domain is configured. */
export function absoluteUrl(path: string, brand: Brand = getBrand()): string | null {
  return brand.siteUrl ? `${brand.siteUrl}${path === "/" ? "" : path}` : null;
}
