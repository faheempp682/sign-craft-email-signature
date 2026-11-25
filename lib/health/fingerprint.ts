import { sha256, signatureHash } from "@/lib/deploy/plan";

/**
 * Comparing signatures without false alarms.
 *
 * CERTAIN: two strings with the same `signatureHash` are the same HTML apart from whitespace.
 * HEURISTIC (UNVERIFIED against real Gmail): Gmail may rewrite the HTML it stores (attribute order, quoting, wrapper elements,
 * style normalisation). So the monitor also compares the TEXT a person would read: tags stripped, entities decoded, whitespace
 * collapsed. Equal text with different HTML is reported as "reformatted" and treated as fine. Consequences, stated plainly:
 *   - a change that only affects markup (a link target, an image address, a colour, a font) is NOT noticed: it cannot be told
 *     apart from reformatting, so it is counted as "reformatted". Only a change to the words (or removal) is reported;
 *   - what Gmail really does has not been observed; "edited" is reliable for changed words, "reformatted" is a guess.
 */

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", ndash: "–", mdash: "—", hellip: "…",
  middot: "·", bull: "•", euro: "€", pound: "£", yen: "¥", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", deg: "°", times: "×",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return " ";
      return String.fromCodePoint(code);
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const BLOCK = /<\/?(?:br|p|div|tr|td|th|table|tbody|thead|li|ul|ol|h[1-6]|hr|blockquote|center|font|span)\b[^>]*>/gi;

/** The readable text of a signature: no tags, entities decoded, one space between words. */
export function normalizeText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(style|script|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
      // block-level and layout tags separate words; inline formatting must not split a word in two
      .replace(BLOCK, (t) => (/^<\/?(?:font|span)\b/i.test(t) ? "" : " "))
      .replace(/<[^>]*>/g, ""),
  )
    .normalize("NFKC")
    .replace(/[​‌‍⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const textFingerprint = (html: string) => sha256(normalizeText(html));

/** Nothing a person would see: no text and no image. (An image-only signature is not empty.) */
export function isEmptySignature(html: string): boolean {
  return normalizeText(html) === "" && !/<img\b/i.test(html);
}

export { signatureHash };
