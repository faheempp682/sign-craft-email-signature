/**
 * Pure logic for the free signature generator. Runs entirely in the browser: no network, no accounts, no uploads, no AI.
 * Takes a template from the shared library plus the person's details and produces a validated SignatureDoc, which the
 * real renderer turns into email HTML.
 */
import { SignatureDocSchema, SOCIAL_NETWORKS, type Block, type SignatureDoc } from "@/lib/schema/document";
import { PRESETS, type Preset } from "@/lib/presets";

export const GENERATOR_NETWORKS = ["linkedin", "twitter", "instagram", "facebook", "youtube", "github"] as const satisfies readonly (typeof SOCIAL_NETWORKS)[number][];
export type GeneratorNetwork = (typeof GENERATOR_NETWORKS)[number];

export type GeneratorInput = {
  templateId: string;
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  /** Optional https link to a photo the person already hosts. Nothing is uploaded. */
  photoUrl: string;
  accent: string;
  socials: Record<GeneratorNetwork, string>;
};

export type FieldErrors = Partial<Record<keyof Omit<GeneratorInput, "socials"> | `social_${GeneratorNetwork}`, string>>;

export const EMPTY_SOCIALS: Record<GeneratorNetwork, string> = { linkedin: "", twitter: "", instagram: "", facebook: "", youtube: "", github: "" };

/** Templates offered by the free generator: the curated "Essentials" collection, which is safe for anyone. */
export const GENERATOR_TEMPLATES: Preset[] = PRESETS.filter((p) => p.collection === "Essentials");

export function defaultInput(templateId = GENERATOR_TEMPLATES[0]?.id ?? "classic"): GeneratorInput {
  const p = PRESETS.find((x) => x.id === templateId) ?? PRESETS[0];
  return { templateId: p.id, name: "", title: "", company: "", phone: "", email: "", website: "", photoUrl: "", accent: p.doc.theme.primary, socials: { ...EMPTY_SOCIALS } };
}

/** "linkedin.com/in/me" becomes "https://linkedin.com/in/me". Plain http is left alone so validation can reject it. */
export function withHttps(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  return `https://${t.replace(/^\/+/, "")}`;
}

const trimmed = (s: string) => s.trim();
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

function validateUrl(raw: string): string | undefined {
  const url = withHttps(raw);
  if (!url) return undefined;
  if (!/^https:\/\//i.test(url)) return "Use a link that starts with https://";
  try {
    const u = new URL(url);
    if (!u.hostname.includes(".")) return "That does not look like a web address.";
  } catch {
    return "That does not look like a web address.";
  }
  if (url.length > 200) return "That link is too long.";
  return undefined;
}

export function validateInput(input: GeneratorInput): FieldErrors {
  const e: FieldErrors = {};
  if (!trimmed(input.name)) e.name = "Enter your name.";
  else if (trimmed(input.name).length > 100) e.name = "Keep your name under 100 characters.";
  if (trimmed(input.title).length > 100) e.title = "Keep this under 100 characters.";
  if (trimmed(input.company).length > 100) e.company = "Keep this under 100 characters.";
  if (trimmed(input.phone).length > 40) e.phone = "Keep this under 40 characters.";
  if (trimmed(input.email) && !EMAIL.test(trimmed(input.email))) e.email = "Enter an email like name@company.com.";
  const w = validateUrl(input.website);
  if (w) e.website = w;
  const ph = validateUrl(input.photoUrl);
  if (ph) e.photoUrl = ph;
  if (!/^#[0-9a-fA-F]{6}$/.test(input.accent)) e.accent = "Pick a colour.";
  for (const n of GENERATOR_NETWORKS) {
    const err = validateUrl(input.socials[n]);
    if (err) e[`social_${n}`] = err;
  }
  return e;
}

export type BuildResult = { ok: true; doc: SignatureDoc } | { ok: false; errors: FieldErrors };

/**
 * Build the document. Field errors come first; the shared document schema then has the final say, so the generator can
 * never output something the rest of the product would reject.
 */
export function buildDoc(input: GeneratorInput): BuildResult {
  const errors = validateInput(input);
  if (Object.keys(errors).length) return { ok: false, errors };

  const preset = PRESETS.find((p) => p.id === input.templateId);
  if (!preset) return { ok: false, errors: { templateId: "Choose a template." } };

  const website = trimmed(input.website);
  const links = GENERATOR_NETWORKS.filter((n) => trimmed(input.socials[n])).map((network) => ({ network, url: withHttps(input.socials[network]) }));
  const photo = withHttps(input.photoUrl);
  const phone = trimmed(input.phone);
  const email = trimmed(input.email);

  const blocks: Block[] = [];
  let sawContact = false;
  let sawSocial = false;
  for (const b of preset.doc.blocks) {
    switch (b.type) {
      case "avatar":
        // Sample photos are placeholders hosted by someone else: never ship them in a download.
        if (photo) blocks.push({ ...b, src: photo, alt: trimmed(input.name) });
        break;
      case "banner":
        break; // needs an uploaded image; that is an account feature
      case "identity":
        blocks.push({ type: "identity", name: trimmed(input.name), ...(trimmed(input.title) && { title: trimmed(input.title) }), ...(trimmed(input.company) && { company: trimmed(input.company) }) });
        break;
      case "contact":
        sawContact = true;
        if (phone || email || website) blocks.push({ type: "contact", ...(phone && { phone }), ...(email && { email }), ...(website && { website }) });
        break;
      case "social":
        sawSocial = true;
        if (links.length) blocks.push({ ...b, links });
        break;
      default:
        blocks.push(b);
    }
  }
  if (!sawContact && (phone || email || website)) blocks.push({ type: "contact", ...(phone && { phone }), ...(email && { email }), ...(website && { website }) });
  if (!sawSocial && links.length) blocks.push({ type: "social", links });

  const parsed = SignatureDocSchema.safeParse({ ...preset.doc, theme: { ...preset.doc.theme, primary: input.accent }, blocks });
  if (!parsed.success) {
    // Map schema complaints back to the most likely field so the person is not left with a generic failure.
    const errs: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      if (path.includes("email")) errs.email = "Enter an email like name@company.com.";
      else if (path.includes("name")) errs.name = "Check your name.";
      else if (path.includes("src")) errs.photoUrl = "Use an https:// link to an image.";
      else errs.name = errs.name ?? "Something in the details is not valid.";
    }
    return { ok: false, errors: errs };
  }
  return { ok: true, doc: parsed.data };
}
