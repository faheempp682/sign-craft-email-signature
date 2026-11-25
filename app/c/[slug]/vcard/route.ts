import { cardUrl } from "@/lib/cards/signature-link";
import { fetchPublicCard, siteOrigin } from "@/lib/cards/public";
import { clientKey, hit } from "@/lib/cards/rate-limit";
import { buildVCard, vcardFilename } from "@/lib/cards/vcard";

/** Public. "Save contact": a vCard 3.0 file for a published card. Missing and unpublished cards both answer 404. */
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=30", "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limit = hit(`vcard:${clientKey(req)}`, 30, 60_000);
  if (!limit.allowed) {
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(limit.retryAfter), "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  }
  const { slug } = await params;
  const card = await fetchPublicCard(slug);
  if (!card) return notFound();

  const url = cardUrl(card.slug, siteOrigin(req.headers)) ?? `${siteOrigin(req.headers)}/c/${card.slug}`;
  return new Response(buildVCard(card, url), {
    status: 200,
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${vcardFilename(card.slug)}"`,
      // Short cache: a card that is unpublished or edited stops being served within a minute.
      "Cache-Control": "public, max-age=60, s-maxage=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
