import { isBareProfile } from "@/lib/linter";
import type { Block, SignatureDoc } from "@/lib/schema/document";
import type { Facts } from "./autofill";
import type { Network } from "./social";

export type FieldKey = "name" | "title" | "company" | "email" | "phone" | "website" | "address" | `social:${Network}`;

export type Proposal = {
  key: FieldKey;
  label: string;
  /** What the signature has now, if anything. */
  current?: string;
  proposed: string;
  /** "fill" writes into an empty or starter-text field. "replace" would overwrite something the user already has. */
  mode: "fill" | "replace";
  /** Pre-ticked in the review step. Only safe fills are, so nothing the user typed is overwritten by accident. */
  recommended: boolean;
};

const MAX_BLOCKS = 30;
const NETWORK_LABEL: Record<Network, string> = { linkedin: "LinkedIn", twitter: "X / Twitter", facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", github: "GitHub", tiktok: "TikTok" };
const FIELD_LABEL = { name: "Name", title: "Job title", company: "Company", email: "Email", phone: "Phone", website: "Website", address: "Address" } as const;
const ORDER = ["name", "title", "company", "email", "phone", "website", "address"] as const;

/** Starter text the editor and the AI designer put in new signatures. Replacing it is always safe. */
const PLACEHOLDER: Partial<Record<(typeof ORDER)[number], RegExp>> = {
  name: /^your name$/i,
  title: /^your title$/i,
  company: /^your company$/i,
  email: /^you@example\.(com|org)$/i,
  phone: /^\+?1?[\s.-]?\(?555\)?[\s.-]?0{3}[\s.-]?0{4}$/,
  website: /^(www\.)?(yourcompany|example)\.(com|org)$/i,
};

const isPlaceholder = (key: (typeof ORDER)[number], value: string) => !!PLACEHOLDER[key]?.test(value.trim());

type Identity = Extract<Block, { type: "identity" }>;
type Contact = Extract<Block, { type: "contact" }>;
type Social = Extract<Block, { type: "social" }>;

function currentValue(doc: SignatureDoc, key: (typeof ORDER)[number]): string | undefined {
  if (key === "name" || key === "title" || key === "company") {
    const b = doc.blocks.find((x): x is Identity => x.type === "identity");
    return b?.[key] || undefined;
  }
  const b = doc.blocks.find((x): x is Contact => x.type === "contact");
  return b?.[key] || undefined;
}

/** What autofill would change, for the review step. Facts that already match the signature are left out. */
export function planAutofill(doc: SignatureDoc, facts: Facts): Proposal[] {
  const out: Proposal[] = [];
  for (const key of ORDER) {
    const proposed = facts[key];
    if (!proposed) continue;
    const current = currentValue(doc, key);
    if (current && current.trim().toLowerCase() === proposed.trim().toLowerCase()) continue;
    const fill = !current || isPlaceholder(key, current);
    out.push({ key, label: FIELD_LABEL[key], current, proposed, mode: fill ? "fill" : "replace", recommended: fill });
  }

  const social = doc.blocks.find((x): x is Social => x.type === "social");
  for (const link of facts.social) {
    const current = social?.links.find((l) => l.network === link.network)?.url;
    if (current && current.replace(/\/+$/, "").toLowerCase() === link.url.toLowerCase()) continue;
    const fill = !current || isBareProfile(current);
    out.push({ key: `social:${link.network}`, label: NETWORK_LABEL[link.network], current, proposed: link.url, mode: fill ? "fill" : "replace", recommended: fill });
  }
  return out;
}

export type ApplyResult = {
  doc: SignatureDoc;
  /** For each block in the new document, its index in the old one, or null if autofill created it. Lets the editor keep block ids stable. */
  order: (number | null)[];
};

/** Writes the selected facts into the signature, creating Name / Contact / Social blocks only if they are missing. Never touches images or the theme. */
export function applyAutofill(doc: SignatureDoc, facts: Facts, selected: ReadonlySet<FieldKey>): ApplyResult {
  const items: { block: Block; from: number | null }[] = doc.blocks.map((block, from) => ({ block, from }));
  const find = (type: Block["type"]) => items.findIndex((x) => x.block.type === type);
  const canAdd = () => items.length < MAX_BLOCKS;
  const pick = <K extends (typeof ORDER)[number]>(k: K) => (selected.has(k) ? facts[k] : undefined);

  /* identity */
  const idFields = { name: pick("name"), title: pick("title"), company: pick("company") };
  if (idFields.name || idFields.title || idFields.company) {
    let i = find("identity");
    if (i < 0 && canAdd()) {
      const avatar = find("avatar");
      i = avatar >= 0 ? avatar + 1 : 0;
      items.splice(i, 0, { block: { type: "identity", name: "Your Name" }, from: null });
    }
    if (i >= 0) {
      const b = items[i].block as Identity;
      items[i] = { ...items[i], block: { ...b, ...(idFields.name && { name: idFields.name }), ...(idFields.title && { title: idFields.title }), ...(idFields.company && { company: idFields.company }) } };
    }
  }

  /* contact */
  const contactFields = { phone: pick("phone"), email: pick("email"), website: pick("website"), address: pick("address") };
  if (Object.values(contactFields).some(Boolean)) {
    let i = find("contact");
    if (i < 0 && canAdd()) {
      const id = find("identity");
      i = id >= 0 ? id + 1 : items.length;
      items.splice(i, 0, { block: { type: "contact" }, from: null });
    }
    if (i >= 0) {
      const b = items[i].block as Contact;
      items[i] = { ...items[i], block: { ...b, ...Object.fromEntries(Object.entries(contactFields).filter(([, v]) => v)) } };
    }
  }

  /* social */
  const links = facts.social.filter((l) => selected.has(`social:${l.network}`));
  if (links.length > 0) {
    let i = find("social");
    if (i < 0 && canAdd()) {
      i = Math.max(find("contact"), find("identity")) + 1;
      items.splice(i, 0, { block: { type: "social", links: [] }, from: null });
    }
    if (i >= 0) {
      const b = items[i].block as Social;
      const incoming = new Set(links.map((l) => l.network));
      // Same-network links are replaced; other networks (and their order) are kept. The block holds at most 8.
      const kept = b.links.filter((l) => !incoming.has(l.network));
      const merged = [...kept, ...links].slice(0, 8);
      items[i] = { ...items[i], block: { ...b, links: merged } };
    }
  }

  return { doc: { ...doc, blocks: items.map((x) => x.block) }, order: items.map((x) => x.from) };
}
