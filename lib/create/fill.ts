import type { Block, SignatureDoc } from "@/lib/schema/document";
import { SOCIAL_NETWORKS } from "@/lib/schema/document";

export type Network = (typeof SOCIAL_NETWORKS)[number];

/** What the "tell us about you" step collects. Every field except the name is optional. */
export type Details = {
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  linkedin: string;
  twitter: string;
  instagram: string;
};

export const EMPTY_DETAILS: Details = { name: "", title: "", company: "", phone: "", email: "", website: "", address: "", linkedin: "", twitter: "", instagram: "" };

const SOCIAL_FIELDS: { field: "linkedin" | "twitter" | "instagram"; network: Network; base: string }[] = [
  { field: "linkedin", network: "linkedin", base: "https://www.linkedin.com/in/" },
  { field: "twitter", network: "twitter", base: "https://x.com/" },
  { field: "instagram", network: "instagram", base: "https://www.instagram.com/" },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "acme.com" -> "https://acme.com"; "http://x" -> "https://x". Returns "" when it cannot be a web address. */
export function toHttps(input: string): string {
  const t = input.trim();
  if (!t) return "";
  const url = /^https?:\/\//i.test(t) ? t.replace(/^http:\/\//i, "https://") : `https://${t.replace(/^\/+/, "")}`;
  try {
    const u = new URL(url);
    return u.hostname.includes(".") ? u.toString() : "";
  } catch {
    return "";
  }
}

/** A social field accepts a full link or just the handle ("@jane" / "jane"). */
export function socialUrl(input: string, base: string): string {
  const t = input.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t) || /^(www\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(t)) return toHttps(t);
  const handle = t.replace(/^@/, "").replace(/[^\w.\-]/g, "");
  return handle ? `${base}${handle}` : "";
}

/** Field-by-field problems, keyed by field. Empty object = good to go. */
export function validateDetails(d: Details): Partial<Record<keyof Details, string>> {
  const e: Partial<Record<keyof Details, string>> = {};
  if (!d.name.trim()) e.name = "Enter your name.";
  if (d.email.trim() && !EMAIL.test(d.email.trim())) e.email = "That email address does not look right.";
  if (d.website.trim() && !toHttps(d.website)) e.website = "Enter a web address like example.com.";
  for (const s of SOCIAL_FIELDS) if (d[s.field].trim() && !socialUrl(d[s.field], s.base)) e[s.field] = "Enter a link or a username.";
  return e;
}

const clean = (s: string) => s.trim() || undefined;

/**
 * Promotional and free-text blocks hold the template author's sample copy and links (another person's listing, a review page
 * for someone else's company, a legal notice). None of it is the customer's, so these blocks are dropped; they can add their
 * own from "Add element" in the editor.
 */
const SAMPLE_COPY: ReadonlySet<Block["type"]> = new Set(["banner", "button", "text", "disclaimer"]);

const fillBlocks = (blocks: Block[], d: Details): Block[] => blocks.filter((b) => !SAMPLE_COPY.has(b.type)).map((b) => fillBlock(b, d));

function fillBlock(b: Block, d: Details): Block {
  switch (b.type) {
    case "identity":
      return { ...b, name: d.name.trim().slice(0, 100), title: clean(d.title), company: clean(d.company) };
    case "avatar":
      return { ...b, alt: d.name.trim().slice(0, 120) }; // the sample photo's alt text names the sample person
    case "contact":
      return { ...b, phone: clean(d.phone), email: clean(d.email), website: clean(d.website), address: clean(d.address) };
    case "social": {
      const links = SOCIAL_FIELDS.flatMap((s) => {
        const url = socialUrl(d[s.field], s.base);
        return url ? [{ network: s.network, url }] : [];
      });
      // Nothing entered: hide the block rather than ship the template's sample links.
      return links.length ? { ...b, links, hidden: undefined } : { ...b, links: [], hidden: true };
    }
    case "row":
      return { ...b, columns: b.columns.map((c) => ({ ...c, blocks: fillBlocks(c.blocks, d) })) };
    default:
      return b;
  }
}

/** The template with the person's own details dropped in. Layout and colours are the template's; its sample photo is a placeholder the editor asks them to replace. */
export function applyDetails(doc: SignatureDoc, d: Details): SignatureDoc {
  return { ...doc, blocks: fillBlocks(doc.blocks, d) };
}
