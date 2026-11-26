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
  facebook: string;
  youtube: string;
  github: string;
  /** The template's footer / disclaimer line ("Services offered: ..."). Empty drops the sample line. */
  note: string;
  /** The template's call-to-action button. Both needed; empty drops the sample button. */
  buttonLabel: string;
  buttonUrl: string;
};

export const EMPTY_DETAILS: Details = { name: "", title: "", company: "", phone: "", email: "", website: "", address: "", linkedin: "", twitter: "", instagram: "", facebook: "", youtube: "", github: "", note: "", buttonLabel: "", buttonUrl: "" };

const SOCIAL_FIELDS: { field: "linkedin" | "twitter" | "instagram" | "facebook" | "youtube" | "github"; network: Network; base: string }[] = [
  { field: "linkedin", network: "linkedin", base: "https://www.linkedin.com/in/" },
  { field: "twitter", network: "twitter", base: "https://x.com/" },
  { field: "instagram", network: "instagram", base: "https://www.instagram.com/" },
  { field: "facebook", network: "facebook", base: "https://www.facebook.com/" },
  { field: "youtube", network: "youtube", base: "https://www.youtube.com/@" },
  { field: "github", network: "github", base: "https://github.com/" },
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
  if (d.buttonLabel.trim() && !toHttps(d.buttonUrl)) e.buttonUrl = "Enter the web address the button opens.";
  return e;
}

const clean = (s: string) => s.trim() || undefined;

/**
 * Promotional and free-text blocks hold the template author's sample copy and links (another person's listing, a review page
 * for someone else's company, a legal notice). None of it is the customer's, so these blocks are dropped; they can add their
 * own from "Add element" in the editor.
 */
const SAMPLE_COPY: ReadonlySet<Block["type"]> = new Set(["banner", "button", "text", "disclaimer"]);

/** A footer line or button they filled in is theirs and stays; the rest of the sample copy goes. */
const keep = (b: Block, d: Details) =>
  !SAMPLE_COPY.has(b.type) || THEIR_BANNERS.has(b) || (b.type === "disclaimer" && !!d.note.trim()) || (b.type === "button" && !!d.buttonLabel.trim() && !!toHttps(d.buttonUrl));

const fillBlocks = (blocks: Block[], d: Details): Block[] => blocks.filter((b) => keep(b, d)).map((b) => fillBlock(b, d));

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
    case "disclaimer":
      return d.note.trim() ? { ...b, text: d.note.trim().slice(0, 1500) } : b;
    case "button":
      return d.buttonLabel.trim() && toHttps(d.buttonUrl) ? { ...b, label: d.buttonLabel.trim().slice(0, 40), href: toHttps(d.buttonUrl) } : b;
    case "row":
      return { ...b, columns: b.columns.map((c) => ({ ...c, blocks: fillBlocks(c.blocks, d) })) };
    default:
      return b;
  }
}

export type ImageSlot = { index: number; /** "avatar0", "avatar1", "banner0"...: position among images of the same kind, so a photo carries over to the next template's photo slot even when its banners differ. */ key: string; kind: "avatar" | "banner"; shape: string; /** Width / height of the crop window. */ aspect: number; src: string };

/** The photo, logo and banner slots in a template, in document order (rows included). */
export function imageSlots(doc: SignatureDoc): ImageSlot[] {
  const out: ImageSlot[] = [];
  const seen = { avatar: 0, banner: 0 };
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.type === "row") b.columns.forEach((c) => walk(c.blocks));
      else if (b.type === "avatar") out.push({ index: out.length, key: `avatar${seen.avatar++}`, kind: "avatar", shape: b.shape, aspect: b.height ? b.size / b.height : 1, src: b.src });
      else if (b.type === "banner") out.push({ index: out.length, key: `banner${seen.banner++}`, kind: "banner", shape: "square", aspect: b.width / b.height, src: b.src });
    }
  };
  walk(doc.blocks);
  return out;
}

/** Banners the person supplied an image for. A template's own sample banner is dropped; one of theirs is kept. */
const THEIR_BANNERS = new WeakSet<object>();

/** The largest size with the image's shape that the schema allows for a banner (100-600 x 20-300). */
function fitBannerSize(w: number, h: number): { width: number; height: number } {
  let width = Math.min(w, 600);
  let height = Math.round((h * width) / w);
  if (height > 300) {
    height = 300;
    width = Math.round((w * height) / h);
  }
  return { width: Math.min(600, Math.max(100, width)), height: Math.min(300, Math.max(20, height)) };
}

export type SlotImage = { url: string; fit?: "cover" | "contain"; /** Natural size, when known: lets a banner take the image's own shape. */ width?: number; height?: number };

/**
 * Puts the person's images into the template's slots (by slot key). Call this on the template BEFORE `applyDetails`, so a
 * banner they supplied survives while the template's sample banner is dropped. Slots without an image keep the sample.
 * A photo gets a `fit` (default "cover") so a picture of a different shape fills the frame instead of being squashed.
 */
export function applyImages(doc: SignatureDoc, images: Record<string, SlotImage>): SignatureDoc {
  if (!Object.keys(images).length) return doc;
  const seen = { avatar: 0, banner: 0 };
  const go = (blocks: Block[]): Block[] =>
    blocks.map((b) => {
      if (b.type === "row") return { ...b, columns: b.columns.map((c) => ({ ...c, blocks: go(c.blocks) })) };
      if (b.type !== "avatar" && b.type !== "banner") return b;
      const img = images[`${b.type}${seen[b.type]++}`];
      if (!img) return b;
      if (b.type === "avatar") return { ...b, src: img.url, fit: img.fit ?? "cover" };
      const size = img.width && img.height ? fitBannerSize(img.width, img.height) : {};
      const out = { ...b, src: img.url, href: undefined, track: undefined, campaign_id: undefined, ...size };
      THEIR_BANNERS.add(out);
      return out;
    });
  return { ...doc, blocks: go(doc.blocks) };
}

/** The template's own sample values for the details fields (first one found), so the form can show them as placeholders. */
export function sampleDetails(doc: SignatureDoc): Partial<Details> {
  const out: Partial<Details> = {};
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.type === "row") b.columns.forEach((c) => walk(c.blocks));
      else if (b.type === "identity") {
        out.name ??= b.name;
        out.title ??= b.title;
        out.company ??= b.company;
      } else if (b.type === "disclaimer") {
        out.note ??= b.text;
      } else if (b.type === "button") {
        out.buttonLabel ??= b.label;
      } else if (b.type === "contact") {
        out.phone ??= b.phone;
        out.email ??= b.email;
        out.website ??= b.website;
        out.address ??= b.address;
      }
    }
  };
  walk(doc.blocks);
  return out;
}

/**
 * For the live preview only: what the person has typed replaces the template's sample, field by field. A field left empty (or
 * not valid yet, mid-typing) keeps the sample, so the card always looks like a finished signature. Sample banners and text
 * stay too; the saved design uses `applyDetails`, which drops them.
 */
export function applyDetailsPreview(doc: SignatureDoc, d: Details): SignatureDoc {
  const sample = sampleDetails(doc);
  const bad = validateDetails({ ...d, name: d.name.trim() || "x" });
  const typed = (k: keyof Details) => !!d[k].trim() && !bad[k];
  const m = { ...EMPTY_DETAILS };
  for (const k of Object.keys(m) as (keyof Details)[]) m[k] = typed(k) ? d[k] : (sample[k] ?? "");
  if (!m.name.trim()) m.name = "Your name";
  const anySocial = SOCIAL_FIELDS.some((s) => typed(s.field));
  const go = (blocks: Block[]): Block[] =>
    blocks.map((b) => {
      if (b.type === "row") return { ...b, columns: b.columns.map((c) => ({ ...c, blocks: go(c.blocks) })) };
      if (b.type === "social" && !anySocial) return b; // nothing typed: the template's sample links stay
      if (b.type === "disclaimer") return typed("note") ? fillBlock(b, m) : b;
      if (b.type === "button") return typed("buttonLabel") && typed("buttonUrl") ? fillBlock(b, m) : b;
      if (SAMPLE_COPY.has(b.type)) return b;
      return fillBlock(b, m);
    });
  return { ...doc, blocks: go(doc.blocks) };
}

/** The template with the person's own details dropped in. Layout and colours are the template's; its sample photo is a placeholder the editor asks them to replace. */
export function applyDetails(doc: SignatureDoc, d: Details): SignatureDoc {
  return { ...doc, blocks: fillBlocks(doc.blocks, d) };
}

/** Reads the form fields back out of a design, e.g. the editor's version of it, so the simple form shows what is really in the signature. */
export function extractDetails(doc: SignatureDoc): Partial<Details> {
  const out: Partial<Details> = {};
  // Only real values go in: a missing one must not leave a key set to undefined, which would blank out the form's empty-string default.
  const set = (k: keyof Details, v: string | undefined) => {
    if (typeof v === "string" && v.trim() && out[k] === undefined) out[k] = v;
  };
  const links = (list: { network: string; url: string }[]) => {
    for (const l of list) {
      const f = SOCIAL_FIELDS.find((x) => x.network === l.network);
      if (f) set(f.field, l.url);
    }
  };
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.type === "row") b.columns.forEach((c) => walk(c.blocks));
      else if (b.type === "identity") {
        set("name", b.name);
        set("title", b.title);
        set("company", b.company);
      } else if (b.type === "contact") {
        set("phone", b.phone);
        set("email", b.email);
        set("website", b.website);
        set("address", b.address);
        if (b.social) links(b.social);
      } else if (b.type === "social") links(b.links);
      else if (b.type === "disclaimer") set("note", b.text);
      else if (b.type === "button") {
        set("buttonLabel", b.label);
        set("buttonUrl", b.href);
      }
    }
  };
  walk(doc.blocks);
  return out;
}

/**
 * Writes the form's values into a design that has already been customised (in the editor), changing only those fields and
 * keeping every block, style and extra the person added. A value that is not valid yet (mid-typing) leaves the field as it was.
 */
export function patchDetails(doc: SignatureDoc, d: Details): SignatureDoc {
  const email = (cur: string | undefined) => (!d.email.trim() ? undefined : EMAIL.test(d.email.trim()) ? d.email.trim() : cur);
  const website = (cur: string | undefined) => (!d.website.trim() ? undefined : toHttps(d.website) ? d.website.trim() : cur);
  const patchLinks = <T extends { network: string; url: string }>(list: T[]): T[] => {
    const byNet = new Map<string, T>(list.map((l) => [l.network, l]));
    for (const s of SOCIAL_FIELDS) {
      const raw = d[s.field].trim();
      if (!raw) byNet.delete(s.network);
      else {
        const url = socialUrl(raw, s.base);
        if (url) byNet.set(s.network, { ...(byNet.get(s.network) ?? { network: s.network }), url } as T);
      }
    }
    return [...byNet.values()];
  };
  const go = (blocks: Block[]): Block[] =>
    blocks.map((b): Block => {
      switch (b.type) {
        case "row":
          return { ...b, columns: b.columns.map((c) => ({ ...c, blocks: go(c.blocks) })) };
        case "identity":
          return { ...b, name: d.name.trim().slice(0, 100) || b.name, title: clean(d.title), company: clean(d.company) };
        case "avatar":
          return d.name.trim() ? { ...b, alt: d.name.trim().slice(0, 120) } : b;
        case "contact":
          return { ...b, phone: clean(d.phone), email: email(b.email), website: website(b.website), address: clean(d.address), ...(b.social ? { social: patchLinks(b.social) } : {}) };
        case "social": {
          const links = patchLinks(b.links);
          return { ...b, links, hidden: links.length ? undefined : b.hidden };
        }
        case "disclaimer":
          return d.note.trim() ? { ...b, text: d.note.trim().slice(0, 1500) } : b;
        case "button":
          return d.buttonLabel.trim() && toHttps(d.buttonUrl) ? { ...b, label: d.buttonLabel.trim().slice(0, 40), href: toHttps(d.buttonUrl) } : b;
        default:
          return b;
      }
    });
  return { ...doc, blocks: go(doc.blocks) };
}
