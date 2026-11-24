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

export type Preset = { id: string; name: string; category: Category; engine: TemplateId; doc: SignatureDoc };

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

function studioDoc(n: number): SignatureDoc {
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
  return SignatureDocSchema.parse({
    version: 1,
    template_id: "studio",
    variant: `s${String(n).padStart(3, "0")}`,
    theme: { primary: pal.primary, text: pal.text, muted: pal.muted, bg: pal.bg, accent2: pal.accent2, font: fonts[(i * 5) % fonts.length], spacing: "normal" },
    blocks,
  });
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

function build(): Preset[] {
  const out: Preset[] = TEMPLATE_META.filter((m) => m.id !== "studio").map((m) => ({ id: m.id, name: m.name, category: CATEGORY[m.id], engine: m.id, doc: m.doc }));
  for (let n = 1; n <= 100; n++) {
    const doc = studioDoc(n);
    const s = genSpec(doc.variant!);
    out.push({
      id: `studio-${String(n).padStart(3, "0")}`,
      name: `${LAYOUT_NAMES[s.layout]} · ${NAME_NAMES[s.name]} ${String(n).padStart(3, "0")}`,
      category: categoryFor(doc, n),
      engine: "studio",
      doc,
    });
  }
  return out;
}

export const PRESETS: Preset[] = build();

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
