import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { cache } from "react";
import { fetchPublicCard, siteOrigin } from "@/lib/cards/public";
import { cardUrl } from "@/lib/cards/signature-link";
import { CardView } from "../card-view";

/**
 * Public digital card (no sign-in). Server rendered. A missing card and an unpublished card both give the same 404,
 * so nothing is revealed about private cards. The page is `noindex` unless the owner switched "Allow search engines" on.
 */
export const dynamic = "force-dynamic";

const load = cache(fetchPublicCard);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const card = await load(slug);
  if (!card) return { title: "Not found", robots: { index: false, follow: false } };
  const subtitle = [card.title, card.company].filter(Boolean).join(", ");
  return {
    title: `${card.display_name}${subtitle ? `, ${subtitle}` : ""}`,
    description: card.bio ? card.bio.slice(0, 160) : `Contact details for ${card.display_name}.`,
    robots: card.indexable ? { index: true, follow: true } : { index: false, follow: false, noarchive: true, nosnippet: true },
    referrer: "no-referrer",
  };
}

export default async function PublicCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const card = await load(slug);
  if (!card) notFound();

  const h = await headers();
  const address = cardUrl(card.slug, siteOrigin(h)) ?? `/c/${card.slug}`;
  const svg = await QRCode.toString(address, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  const qrSrc = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

  return (
    <main className="min-h-screen bg-bg px-4 py-6 sm:py-12">
      <CardView card={card} vcardHref={`/c/${card.slug}/vcard`} qrSrc={qrSrc} cardAddress={address} />
    </main>
  );
}
