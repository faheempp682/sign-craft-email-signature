/** Metadata and JSON-LD builders for the marketing site. No ratings, reviews or prices are ever produced here. */
import type { Metadata } from "next";
import { absoluteUrl, getBrand, type Brand } from "@/lib/brand";

export type FaqItem = { q: string; a: string };

export function pageMetadata(opts: { path: string; title: string; description: string; brand?: Brand; noindex?: boolean }): Metadata {
  const brand = opts.brand ?? getBrand();
  const title = opts.title.includes(brand.name) ? opts.title : `${opts.title} | ${brand.name}`;
  const url = absoluteUrl(opts.path, brand);
  return {
    title: { absolute: title },
    description: opts.description,
    ...(brand.siteUrl ? { metadataBase: new URL(brand.siteUrl) } : {}),
    // Canonical is relative to metadataBase; without a configured domain we emit none rather than guess one.
    ...(url ? { alternates: { canonical: opts.path } } : {}),
    openGraph: { title, description: opts.description, siteName: brand.name, type: "website", ...(url ? { url: opts.path } : {}) },
    twitter: { card: "summary", title, description: opts.description },
    ...(opts.noindex ? { robots: { index: false, follow: false } } : {}),
  };
}

export function organizationLd(brand: Brand = getBrand()) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand.name,
    ...(brand.siteUrl ? { url: brand.siteUrl } : {}),
    ...(brand.contactEmail ? { email: brand.contactEmail } : {}),
    ...(!brand.companyIsPlaceholder ? { legalName: brand.company } : {}),
  };
}

export function softwareApplicationLd(opts: { description: string; free?: boolean; brand?: Brand; path?: string }) {
  const brand = opts.brand ?? getBrand();
  const url = absoluteUrl(opts.path ?? "/", brand);
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: brand.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any (web browser)",
    description: opts.description,
    ...(url ? { url } : {}),
    // Only the free generator states a price, and it is true. No aggregateRating or review is ever emitted.
    ...(opts.free ? { offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } } : {}),
  };
}

export function faqLd(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })),
  };
}

/** JSON for a <script type="application/ld+json"> tag. `<` is escaped so copy can never close the tag. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028").replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");
}
