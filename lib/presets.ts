import { SignatureDocSchema, type Block, type SignatureDoc, type TemplateId } from "@/lib/schema/document";
import { TEMPLATE_META } from "@/lib/templates";
import { LAYOUT_NAMES, NAME_NAMES, genSpec } from "@/lib/renderer/studio";

/**
 * The library = the 21 hand-built layouts + 100 "studio" designs.
 * Each studio design is a different composition (layout, name style, contact style, social style, photo treatment,
 * frame, decoration), not a recolour. Every entry is a normal SignatureDoc.
 */

export const CATEGORIES = ["Corporate", "Creative", "Real estate", "Elegant", "Minimal"] as const;
export type Category = (typeof CATEGORIES)[number];

export const COLLECTIONS = ["Essentials", "Studio", "Classic"] as const;
export type Collection = (typeof COLLECTIONS)[number];
export const DEFAULT_COLLECTION: Collection = "Essentials";

export type Preset = { id: string; name: string; category: Category; collection: Collection; engine: TemplateId; doc: SignatureDoc };

const CATEGORY: Record<TemplateId, Category> = {
  classic: "Minimal",
  "modern-split": "Corporate",
  minimal: "Minimal",
  "editorial-arch": "Creative",
  "bold-letter": "Creative",
  "circle-accent": "Creative",
  "green-sidebar": "Real estate",
  "maroon-frame": "Elegant",
  spectrum: "Creative",
  geometric: "Creative",
  "noir-agent": "Real estate",
  "orange-logo": "Real estate",
  ticket: "Creative",
  "listing-banner": "Real estate",
  "soft-card": "Elegant",
  "consultant-blue": "Corporate",
  "executive-navy": "Corporate",
  "minimal-line": "Minimal",
  "dark-luxe": "Elegant",
  "pastel-pill": "Creative",
  "split-color": "Corporate",
  "talent-card": "Corporate",
  "mountain-logo": "Corporate",
  "script-contact": "Minimal",
  "ringed-sales": "Corporate",
  studio: "Corporate",
};

type Pal = { name: string; bg: string; text: string; muted: string; primary: string; accent2: string };
const PALETTES: Pal[] = [
  { name: "Navy & gold", bg: "#FFFFFF", text: "#1B2433", muted: "#5B6577", primary: "#12284C", accent2: "#C9A24B" },
  { name: "Emerald", bg: "#FFFFFF", text: "#12302D", muted: "#4B635F", primary: "#0F766E", accent2: "#FDE68A" },
  { name: "Burgundy", bg: "#FFFFFF", text: "#2B1620", muted: "#6B4B57", primary: "#7A1F3D", accent2: "#F2C6A0" },
  { name: "Indigo", bg: "#FFFFFF", text: "#1E1B4B", muted: "#5B5A86", primary: "#3730A3", accent2: "#FBBF24" },
  { name: "Slate", bg: "#FFFFFF", text: "#0F172A", muted: "#64748B", primary: "#334155", accent2: "#38BDF8" },
  { name: "Orange ink", bg: "#FFFFFF", text: "#171717", muted: "#6B7280", primary: "#C2410C", accent2: "#111111" },
  { name: "Plum", bg: "#FFFFFF", text: "#2E1065", muted: "#6D5A86", primary: "#6B21A8", accent2: "#F9A8D4" },
  { name: "Ocean", bg: "#FFFFFF", text: "#0C2D48", muted: "#4B6B85", primary: "#0369A1", accent2: "#FDBA74" },
  { name: "Cream", bg: "#F6F1E7", text: "#2A1B13", muted: "#7A6355", primary: "#7A3B1E", accent2: "#D9A441" },
  { name: "Blush", bg: "#FBEFEF", text: "#3B1220", muted: "#8A5370", primary: "#9D2B4A", accent2: "#F4B6C2" },
  { name: "Mint", bg: "#EAF5F0", text: "#10302A", muted: "#4B6B62", primary: "#146C55", accent2: "#F2C94C" },
  { name: "Sky", bg: "#EAF2FB", text: "#0F2742", muted: "#51698A", primary: "#1E4E9A", accent2: "#F59E0B" },
  { name: "Lavender", bg: "#F1EDFB", text: "#241A4A", muted: "#6A5F99", primary: "#5B3CC4", accent2: "#F0A6CA" },
  { name: "Sand", bg: "#F3EBDD", text: "#2B2819", muted: "#7B7358", primary: "#3F3A2C", accent2: "#C77D2E" },
  { name: "Sage", bg: "#EDF0E6", text: "#1D2A18", muted: "#5F6F57", primary: "#46613A", accent2: "#D8B45A" },
  { name: "Paper", bg: "#F2F3F5", text: "#111827", muted: "#6B7280", primary: "#111827", accent2: "#EF4444" },
  { name: "Black & gold", bg: "#111111", text: "#F5F0E6", muted: "#B8B0A0", primary: "#C9A24B", accent2: "#F5F0E6" },
  { name: "Midnight", bg: "#0B1B33", text: "#E8EEF9", muted: "#9FB3D1", primary: "#7DD3FC", accent2: "#FDE68A" },
  { name: "Wine", bg: "#4A1D2C", text: "#F2E6DA", muted: "#D9C7BC", primary: "#F2C6A0", accent2: "#F2E6DA" },
  { name: "Pine", bg: "#12261C", text: "#EAF3EC", muted: "#9DBBA4", primary: "#A7D7B0", accent2: "#E9C46A" },
  { name: "Graphite", bg: "#1C1F24", text: "#F3F4F6", muted: "#A3A9B3", primary: "#F59E0B", accent2: "#F3F4F6" },
  { name: "Aubergine", bg: "#2A1238", text: "#F3E8FF", muted: "#C4A8D8", primary: "#E9B8FF", accent2: "#FDE68A" },
];

type Persona = { name: string; title: string; company: string; domain: string; address: string };
const PERSONAS: Persona[] = [
  { name: "Olivia Bennett", title: "Real Estate Advisor", company: "Harbor & Key Realty", domain: "harborkey.com", address: "214 Harbor Street, Boston, MA" },
  { name: "Marcus Chen", title: "Senior Software Engineer", company: "Northlight Labs", domain: "northlight.dev", address: "88 Market Street, San Francisco, CA" },
  { name: "Amara Okoye", title: "Brand Designer", company: "Studio Amara", domain: "studioamara.co", address: "12 Canal Road, Lagos" },
  { name: "Daniel Rossi", title: "Attorney at Law", company: "Rossi & Partners", domain: "rossipartners.law", address: "350 Park Avenue, New York, NY" },
  { name: "Priya Raman", title: "Family Physician", company: "Willow Health", domain: "willowhealth.org", address: "47 Willow Lane, Austin, TX" },
  { name: "Lucas Meyer", title: "Financial Advisor", company: "Meridian Wealth", domain: "meridianwealth.com", address: "9 Bank Street, Chicago, IL" },
  { name: "Hannah Fischer", title: "Marketing Director", company: "Brightpath", domain: "brightpath.io", address: "301 Congress Avenue, Denver, CO" },
  { name: "Tomás Herrera", title: "Principal Architect", company: "Herrera Atelier", domain: "herreraatelier.com", address: "60 Calle Mayor, Madrid" },
  { name: "Sara Lindqvist", title: "Talent Partner", company: "Talent Bridge", domain: "talentbridge.se", address: "5 Drottninggatan, Stockholm" },
  { name: "Kwame Mensah", title: "Photographer", company: "Mensah Visuals", domain: "mensahvisuals.com", address: "21 Oxford Street, Accra" },
  { name: "Emily Carter", title: "Executive Coach", company: "Carter Growth", domain: "cartergrowth.com", address: "78 Pine Street, Seattle, WA" },
  { name: "Noah Williams", title: "Sales Director", company: "Vertex Systems", domain: "vertexsystems.com", address: "1200 Main Street, Dallas, TX" },
];

const NETS = ["linkedin", "instagram", "twitter", "facebook", "youtube", "github"] as const;
const URLS: Record<(typeof NETS)[number], string> = {
  linkedin: "https://linkedin.com/in/yourname",
  instagram: "https://instagram.com/yourname",
  twitter: "https://x.com/yourname",
  facebook: "https://facebook.com/yourname",
  youtube: "https://youtube.com/@yourname",
  github: "https://github.com/yourname",
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

function studioDoc(n: number): { doc: SignatureDoc; palette: string } {
  const i = n - 1;
  const p = PERSONAS[i % PERSONAS.length];
  const pal = PALETTES[(i * 7 + 3) % PALETTES.length];
  const first = slug(p.name.split(" ")[0]);
  const photoSize = [96, 104, 88, 112, 92, 100][i % 6];
  const nets = [0, 1, 2].slice(0, 2 + (i % 2)).map((k) => NETS[(i + k * 2) % NETS.length]);
  const blocks: Block[] = [
    { type: "avatar", src: "https://placehold.co/240x240.png", alt: p.name, shape: "circle", size: photoSize },
    { type: "identity", name: p.name, title: p.title, company: p.company },
    {
      type: "contact",
      phone: `+1 555 01${String(10 + (i % 80)).padStart(2, "0")} ${2000 + ((i * 37) % 7000)}`,
      email: `${first}@${p.domain}`,
      website: p.domain,
      ...(i % 3 === 0 ? { address: p.address } : {}),
    },
    { type: "social", links: nets.map((network) => ({ network, url: URLS[network] })) },
  ];
  const fonts = ["Arial", "Verdana", "Trebuchet MS", "Tahoma", "Helvetica", "Georgia"] as const;
  // The "no photo" treatment is a real photo-less design: drop the block so the editor doesn't offer a dead control.
  const noPhoto = genSpec(`s${String(n).padStart(3, "0")}`).photo === 7;
  const doc = SignatureDocSchema.parse({
    version: 1,
    template_id: "studio",
    variant: `s${String(n).padStart(3, "0")}`,
    theme: { primary: pal.primary, text: pal.text, muted: pal.muted, bg: pal.bg, accent2: pal.accent2, font: fonts[(i * 5) % fonts.length], spacing: "normal" },
    blocks: noPhoto ? blocks.filter((b) => b.type !== "avatar") : blocks,
  });
  return { doc, palette: pal.name };
}

function categoryFor(doc: SignatureDoc, n: number): Category {
  const s = genSpec(doc.variant ?? "s001");
  const dark = doc.theme.bg.toLowerCase() < "#555555";
  if (dark || s.name === 2 || s.name === 4) return "Elegant";
  if (s.name === 3 || s.name === 5 || s.name === 6 || s.name === 8) return "Creative";
  if (s.layout === 6 || s.layout === 7 || s.layout === 10) return "Corporate";
  if (s.layout === 3 || s.layout === 9 || s.contact === 3 || s.contact === 8) return "Minimal";
  return n % 2 ? "Real estate" : "Corporate";
}

/**
 * Curated collections (a hand-picked judgement from the visual QA pass, not a formula):
 *  - Essentials (40): the best-balanced, most professional designs, safe for anyone.
 *  - Studio (50): the most distinctive, expressive designs.
 *  - Classic (31): the remaining, more conventional designs.
 * Template ids never change; a template belongs to exactly one collection.
 */
const ESSENTIALS: readonly string[] = [
  "classic", "modern-split", "minimal", "green-sidebar", "maroon-frame", "executive-navy", "minimal-line", "dark-luxe",
  "pastel-pill", "split-color", "consultant-blue", "soft-card", "listing-banner", "noir-agent", "talent-card", "mountain-logo", "script-contact", "ringed-sales",
  ...[1, 3, 9, 11, 12, 16, 18, 19, 22, 28, 31, 38, 44, 53, 55, 60, 64, 66, 71, 75, 77, 84, 85, 94, 97, 99].map((n) => `studio-${String(n).padStart(3, "0")}`),
];
const STUDIO_HAND: readonly string[] = ["editorial-arch", "bold-letter", "circle-accent", "spectrum", "geometric", "ticket", "orange-logo"];
const STUDIO_TARGET = 50;

/** How expressive a studio design is: unusual name/photo treatments and bold layouts score higher. */
function expressiveness(doc: SignatureDoc): number {
  const sp = genSpec(doc.variant ?? "s001");
  const name = [0, 2, 3, 3, 1, 3, 2, 0, 3][sp.name];
  const layout = [0, 0, 1, 0, 0, 0, 2, 2, 1, 0, 2][sp.layout];
  const photo = [0, 0, 0, 2, 1, 0, 2, 0][sp.photo];
  return name + layout + photo;
}

function assignCollections(list: Omit<Preset, "collection">[]): Preset[] {
  const taken = new Map<string, Collection>();
  ESSENTIALS.forEach((id) => taken.set(id, "Essentials"));
  STUDIO_HAND.forEach((id) => taken.set(id, "Studio"));
  const rest = list.filter((p) => !taken.has(p.id)).sort((a, b) => expressiveness(b.doc) - expressiveness(a.doc) || a.id.localeCompare(b.id));
  rest.forEach((p, i) => taken.set(p.id, STUDIO_HAND.length + i < STUDIO_TARGET ? "Studio" : "Classic"));
  return list.map((p) => ({ ...p, collection: taken.get(p.id)! }));
}

function build(): Preset[] {
  const out: Omit<Preset, "collection">[] = TEMPLATE_META.filter((m) => m.id !== "studio").map((m) => ({ id: m.id, name: m.name, category: CATEGORY[m.id], engine: m.id, doc: m.doc }));
  const names = new Set(out.map((p) => p.name));
  for (let n = 1; n <= 100; n++) {
    const { doc, palette } = studioDoc(n);
    const s = genSpec(doc.variant!);
    // "Layout · Palette", made unique with the name style when two designs share both.
    let name = `${LAYOUT_NAMES[s.layout]} · ${palette}`;
    if (names.has(name)) name = `${name} (${NAME_NAMES[s.name]})`;
    if (names.has(name)) name = `${name} ${n}`;
    names.add(name);
    out.push({ id: `studio-${String(n).padStart(3, "0")}`, name, category: categoryFor(doc, n), engine: "studio", doc });
  }
  return assignCollections(out);
}

export const PRESETS: Preset[] = build();

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
