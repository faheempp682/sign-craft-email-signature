import { describe, expect, it } from "vitest";
import { absoluteUrl, getBrand, normaliseDomain } from "@/lib/brand";
import { SITE_PATHS, robotsRules, sitemapEntries } from "./crawl";
import { NICHES, getNiche } from "./niches";
import { SITE_PUBLIC, isPublicPath } from "@/lib/public-routes";
import { getPreset } from "@/lib/presets";
import { faqLd, jsonLdString, organizationLd, pageMetadata, softwareApplicationLd } from "./seo";

const ON = { PUBLIC_SITE_ENABLED: "true", BRAND_DOMAIN: "example.com" };

describe("brand", () => {
  it("defaults the product name but takes everything else from the environment", () => {
    const d = getBrand({});
    expect(d.name).toBe("SignCraft");
    expect(d.domain).toBeNull();
    expect(d.siteUrl).toBeNull();
    expect(d.companyIsPlaceholder).toBe(true);
    const b = getBrand({ BRAND_NAME: "Acme Sign", BRAND_DOMAIN: "https://Sign.Acme.com/", BRAND_COMPANY: "Acme Ltd", BRAND_CONTACT_EMAIL: "hi@acme.com", BRAND_TAGLINE: "Tag" });
    expect(b).toMatchObject({ name: "Acme Sign", domain: "sign.acme.com", siteUrl: "https://sign.acme.com", company: "Acme Ltd", companyIsPlaceholder: false, contactEmail: "hi@acme.com", tagline: "Tag" });
  });
  it("rejects malformed domains and emails instead of putting them in pages", () => {
    expect(normaliseDomain("evil.com/path?x=1")).toBeNull();
    expect(normaliseDomain('a b"><script>')).toBeNull();
    expect(getBrand({ BRAND_CONTACT_EMAIL: "not an email" }).contactEmail).toBeNull();
    expect(absoluteUrl("/privacy", getBrand({}))).toBeNull();
    expect(absoluteUrl("/privacy", getBrand({ BRAND_DOMAIN: "a.com" }))).toBe("https://a.com/privacy");
  });
});

describe("sitemap and robots", () => {
  it("are empty / closed when the public site is off", () => {
    for (const env of [{}, { PUBLIC_SITE_ENABLED: "false", BRAND_DOMAIN: "example.com" }, { PUBLIC_SITE_ENABLED: "1", BRAND_DOMAIN: "example.com" }]) {
      expect(sitemapEntries(env)).toEqual([]);
      expect(robotsRules(env)).toEqual({ rules: { userAgent: "*", disallow: ["/"] } });
    }
  });
  it("list every public page with absolute URLs when on", () => {
    const urls = sitemapEntries(ON).map((e) => e.url);
    expect(urls).toContain("https://example.com");
    expect(urls).toContain("https://example.com/signature-generator");
    for (const n of NICHES) expect(urls).toContain(`https://example.com/for/${n.slug}`);
    expect(urls).toContain("https://example.com/privacy");
    expect(urls.length).toBe(SITE_PATHS.length);
    expect(sitemapEntries({ PUBLIC_SITE_ENABLED: "true" })).toEqual([]); // no domain: do not guess one
  });
  it("only ever lists paths the public-route policy allows", () => {
    for (const p of SITE_PATHS) expect(isPublicPath(p, true), p).toBe(true);
    expect(SITE_PUBLIC.length).toBeGreaterThan(0);
  });
  it("robots keeps private areas out and points at the sitemap when on", () => {
    const r = robotsRules(ON);
    expect(r.rules.disallow).toEqual(expect.arrayContaining(["/api/", "/admin", "/create", "/login"]));
    expect(r.rules.allow).toEqual(["/"]);
    expect(r.sitemap).toBe("https://example.com/sitemap.xml");
  });
});

describe("niche pages", () => {
  it("are four distinct pages, each with a real preset and its own copy", () => {
    expect(NICHES.map((n) => n.slug).sort()).toEqual(["agencies", "freelancers", "real-estate", "recruiters"]);
    expect(getNiche("nope")).toBeUndefined();
    expect(new Set(NICHES.map((n) => n.presetId)).size).toBe(NICHES.length);
    for (const n of NICHES) {
      expect(getPreset(n.presetId), n.slug).toBeTruthy();
      expect(n.pains.length, n.slug).toBeGreaterThanOrEqual(3);
      expect(n.faq.length, n.slug).toBeGreaterThanOrEqual(4);
      expect(n.metaDescription.length, n.slug).toBeLessThanOrEqual(170);
    }
    // No sentence is reused across niches: the pages are not one template with the nouns swapped.
    const sentences = NICHES.flatMap((n) => JSON.stringify([n.lead, n.pains, n.include, n.mistakes, n.faq]).split(/(?<=[.?!])\s+/)).map((s) => s.toLowerCase().trim());
    const dup = sentences.filter((s, i) => s.length > 40 && sentences.indexOf(s) !== i);
    expect(dup).toEqual([]);
    expect(new Set(NICHES.map((n) => n.h1)).size).toBe(NICHES.length);
  });
  it("never hardcode a product name or domain", () => {
    expect(JSON.stringify(NICHES)).not.toMatch(/signcraft/i);
  });
});

describe("seo", () => {
  const brand = getBrand({ BRAND_NAME: "Acme Sign", BRAND_DOMAIN: "acme.com", BRAND_CONTACT_EMAIL: "hi@acme.com" });
  it("sets canonical, open graph and the brand in the title", () => {
    const m = pageMetadata({ path: "/for/recruiters", title: "Email signature for recruiters", description: "d", brand });
    expect(m.title).toEqual({ absolute: "Email signature for recruiters | Acme Sign" });
    expect(m.alternates?.canonical).toBe("/for/recruiters");
    expect(m.openGraph).toMatchObject({ siteName: "Acme Sign", url: "/for/recruiters" });
    expect(String(m.metadataBase)).toBe("https://acme.com/");
  });
  it("emits no canonical when no domain is configured", () => {
    expect(pageMetadata({ path: "/", title: "T", description: "d", brand: getBrand({}) }).alternates).toBeUndefined();
  });
  it("builds JSON-LD without ratings, reviews or invented prices", () => {
    const all = JSON.stringify([organizationLd(brand), softwareApplicationLd({ description: "x", brand }), softwareApplicationLd({ description: "x", free: true, brand }), faqLd([{ q: "Q?", a: "A." }])]);
    expect(all).not.toMatch(/aggregateRating|ratingValue|reviewCount|"review"|ratingCount/);
    expect(softwareApplicationLd({ description: "x", brand })).not.toHaveProperty("offers");
    expect(softwareApplicationLd({ description: "x", free: true, brand }).offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "USD" });
    expect(faqLd([{ q: "Q?", a: "A." }]).mainEntity[0]).toMatchObject({ "@type": "Question", name: "Q?", acceptedAnswer: { text: "A." } });
  });
  it("escapes markup so copy cannot close the script tag", () => {
    const s = jsonLdString({ a: "</script><script>alert(1)</script>" });
    expect(s).not.toContain("<");
    expect(JSON.parse(s).a).toBe("</script><script>alert(1)</script>");
  });
});
