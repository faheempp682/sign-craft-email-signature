import { httpsHref, inkOn, mailHref, safeColor, telHref } from "@/lib/cards/links";
import type { PublicCard } from "@/lib/cards/schema";

/**
 * Exactly what a visitor sees at /c/<slug>. Used by the public page and, unchanged, by the owner's live preview, so
 * the preview can never drift from the real page. Pure markup: no hooks, no data fetching, nothing server-only.
 * Every link is rebuilt through the sanitisers in lib/cards/links.ts; a value that fails is simply left out.
 */

export const NETWORK_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  twitter: "X (Twitter)",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  github: "GitHub",
  tiktok: "TikTok",
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0]?.toUpperCase() ?? "")
    .join("");

const rowClass = "flex min-h-14 items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2";

function Row({ href, label, value, external }: { href: string; label: string; value: string; external?: boolean }) {
  return (
    <a href={href} className={rowClass} {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}>
      <span className="min-w-0">
        <span className="block text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
        <span className="block break-words text-base font-medium">{value}</span>
      </span>
    </a>
  );
}

export function CardView({ card, vcardHref, qrSrc, cardAddress }: { card: PublicCard; vcardHref: string; qrSrc: string | null; cardAddress: string }) {
  const accent = safeColor(card.accent_color);
  const ink = inkOn(accent);
  const photo = httpsHref(card.photo_url);
  const tel = telHref(card.phone);
  const mail = mailHref(card.email);
  const site = httpsHref(card.website);
  const booking = httpsHref(card.booking_url);
  const socials = card.social_links.flatMap((s) => {
    const href = httpsHref(s.url);
    return href ? [{ network: s.network, href }] : [];
  });
  const subtitle = [card.title, card.company].filter(Boolean).join(" · ");

  return (
    <article className="mx-auto w-full max-w-md overflow-hidden rounded-3xl border border-line bg-surface shadow-sm" aria-label={`Digital card for ${card.display_name}`}>
      <div className="h-28" style={{ backgroundColor: accent }} aria-hidden="true" />
      <div className="-mt-14 flex flex-col items-center px-5 text-center">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" width={112} height={112} referrerPolicy="no-referrer" className="size-28 rounded-full border-4 border-surface bg-surface-2 object-cover" />
        ) : (
          <div className="grid size-28 place-items-center rounded-full border-4 border-surface text-3xl font-semibold ring-1 ring-line" style={{ backgroundColor: accent, color: ink }} aria-hidden="true">
            {initials(card.display_name)}
          </div>
        )}
        <h1 className="mt-4 break-words text-2xl font-semibold tracking-tight">{card.display_name}</h1>
        {subtitle ? <p className="mt-1 break-words text-base text-muted">{subtitle}</p> : null}
        {card.bio ? <p className="mt-3 max-w-sm whitespace-pre-line break-words text-base leading-relaxed">{card.bio}</p> : null}
      </div>

      <div className="mt-6 grid gap-3 px-5">
        <a href={vcardHref} download className="btn min-h-12 text-base font-semibold ring-1 ring-line" style={{ backgroundColor: accent, borderColor: accent, color: ink }}>
          Save contact
        </a>
        {booking ? (
          <a href={booking} target="_blank" rel="noopener noreferrer nofollow" className="btn min-h-12 text-base font-semibold">
            Book a meeting
          </a>
        ) : null}
      </div>

      {tel || mail || site || card.address ? (
        <div className="mt-6 divide-y divide-line border-y border-line">
          {tel ? <Row href={tel} label="Call" value={card.phone ?? ""} /> : null}
          {mail ? <Row href={mail} label="Email" value={card.email ?? ""} /> : null}
          {site ? <Row href={site} label="Website" value={site.replace(/^https:\/\//, "").replace(/\/$/, "")} external /> : null}
          {card.address ? (
            <div className="px-5 py-3">
              <span className="block text-xs font-medium uppercase tracking-wider text-muted">Address</span>
              <span className="block whitespace-pre-line break-words text-base font-medium">{card.address}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {socials.length ? (
        <ul className="flex flex-wrap justify-center gap-2 px-5 pt-6" aria-label="Social profiles">
          {socials.map((s) => (
            <li key={`${s.network}:${s.href}`}>
              <a href={s.href} target="_blank" rel="noopener noreferrer nofollow" className="btn">
                {NETWORK_LABEL[s.network] ?? s.network}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="mt-6 flex flex-col items-center gap-2 border-t border-line px-5 py-6 text-center" aria-label="QR code">
        {qrSrc ? (
          // The QR code is always dark on white, whatever the theme, so phones can read it.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrSrc} alt={`QR code that opens ${cardAddress}`} width={168} height={168} className="size-42 rounded-xl bg-white p-2" />
        ) : (
          <div className="grid size-42 place-items-center rounded-xl bg-white text-xs text-neutral-600">QR code</div>
        )}
        <p className="text-sm text-muted">Scan to open this card</p>
        <p className="break-all text-xs text-muted">{cardAddress}</p>
      </section>
    </article>
  );
}
