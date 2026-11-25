import { httpsHref, mailHref, telHref } from "./links";
import type { PublicCard } from "./schema";

/**
 * vCard 3.0 (RFC 2426) for "Save contact".
 *
 *  - TEXT values escape backslash, semicolon, comma and newlines; other control characters are dropped, so a field
 *    value can never end a line or start a new property (no CRLF injection).
 *  - Lines are folded at 75 octets on UTF-8 character boundaries; the file uses CRLF line endings.
 *  - URI values (URL, PHOTO) are only emitted when they pass the https sanitiser.
 */

const CRLF = "\r\n";

/** Escape a TEXT value. Newlines become the two characters \n; everything else below 0x20 is removed. */
export function escapeText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") // keep only \n and \r, handled next
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n|\u2028|\u2029/g, "\\n");
}

/** Fold one logical line to physical lines of at most 75 octets (continuations start with one space). */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      parts.push(cur);
      cur = "";
      curBytes = 0;
      limit = 74; // the leading space of the continuation line counts too
    }
    cur += ch;
    curBytes += b;
  }
  if (cur) parts.push(cur);
  return parts.join(CRLF + " ");
}

/** "Ada King Lovelace" -> family "Lovelace", given "Ada King". One word -> given only. */
export function splitName(full: string): { family: string; given: string } {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { family: "", given: words[0] ?? "" };
  return { family: words[words.length - 1], given: words.slice(0, -1).join(" ") };
}

export function buildVCard(card: PublicCard, cardUrl: string): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];
  const { family, given } = splitName(card.display_name);
  lines.push(`N:${escapeText(family)};${escapeText(given)};;;`);
  lines.push(`FN:${escapeText(card.display_name)}`);
  if (card.company) lines.push(`ORG:${escapeText(card.company)}`);
  if (card.title) lines.push(`TITLE:${escapeText(card.title)}`);

  const tel = telHref(card.phone);
  if (tel) lines.push(`TEL;TYPE=WORK,VOICE:${tel.slice(4)}`);
  const mail = mailHref(card.email);
  if (mail) lines.push(`EMAIL;TYPE=INTERNET,WORK:${escapeText(mail.slice(7))}`);

  const site = httpsHref(card.website);
  if (site) lines.push(`URL;TYPE=WORK:${site}`);
  const self = httpsHref(cardUrl);
  if (self) lines.push(`URL;TYPE=OTHER:${self}`);
  const booking = httpsHref(card.booking_url);
  if (booking) lines.push(`URL;TYPE=BOOKING:${booking}`);

  if (card.address) lines.push(`ADR;TYPE=WORK:;;${escapeText(card.address)};;;;`);
  if (card.bio) lines.push(`NOTE:${escapeText(card.bio)}`);
  const photo = httpsHref(card.photo_url);
  if (photo) lines.push(`PHOTO;VALUE=uri:${photo}`);
  for (const s of card.social_links) {
    const href = httpsHref(s.url);
    if (href) lines.push(`X-SOCIALPROFILE;TYPE=${s.network}:${href}`);
  }
  lines.push("END:VCARD");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** A filename that is safe in a Content-Disposition header: ASCII letters, digits and hyphens only. */
export function vcardFilename(slug: string): string {
  const base = slug.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || "contact";
  return `${base}.vcf`;
}
