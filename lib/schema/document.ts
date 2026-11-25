import { z } from "zod";

/** Only https image/link URLs are allowed (email clients block http/data/js). */
const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"), "Must be an https:// URL");

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a #RRGGBB color");

export const SAFE_FONTS = [
  "Arial",
  "Helvetica",
  "Georgia",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Times New Roman",
  "Courier New",
] as const;

export const ThemeSchema = z.object({
  primary: hexColor,
  text: hexColor,
  muted: hexColor.default("#6B7280"),
  /** Card background used by the designed templates (ignored by classic / modern-split / minimal). */
  bg: hexColor.default("#FFFFFF"),
  /** Secondary accent used by the designed templates. */
  accent2: hexColor.default("#F4C542"),
  font: z.enum(SAFE_FONTS).default("Arial"),
  spacing: z.enum(["compact", "normal", "airy"]).default("normal"),
});

export const SOCIAL_NETWORKS = [
  "linkedin",
  "twitter",
  "facebook",
  "instagram",
  "youtube",
  "github",
  "tiktok",
] as const;

export const AvatarBlock = z.object({
  type: z.literal("avatar"),
  src: httpsUrl,
  alt: z.string().max(120).default(""),
  shape: z.enum(["circle", "square", "rounded", "arch"]).default("circle"),
  size: z.number().int().min(32).max(200).default(80),
});

export const IdentityBlock = z.object({
  type: z.literal("identity"),
  name: z.string().min(1).max(100),
  title: z.string().max(100).optional(),
  company: z.string().max(100).optional(),
});

export const ContactBlock = z.object({
  type: z.literal("contact"),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional(),
  website: z.string().max(200).optional(),
  address: z.string().max(200).optional(),
});

export const SocialBlock = z.object({
  type: z.literal("social"),
  links: z
    .array(z.object({ network: z.enum(SOCIAL_NETWORKS), url: httpsUrl }))
    .max(8),
});

export const BannerBlock = z.object({
  type: z.literal("banner"),
  src: httpsUrl,
  alt: z.string().max(160).default(""),
  href: httpsUrl.optional(),
  width: z.number().int().min(100).max(600).default(400),
  height: z.number().int().min(20).max(300).default(100),
  /** Wrap the link in a signed click-tracking redirect (/r/<token>). Optional; absent or false renders exactly as before. */
  track: z.boolean().optional(),
  /** A banner campaign (banner_campaigns.id) whose schedule and A/B variants decide the image (/b/<token>). Needs `track` to count clicks. */
  campaign_id: z.string().uuid().optional(),
});

export const DividerBlock = z.object({
  type: z.literal("divider"),
});

export const DisclaimerBlock = z.object({
  type: z.literal("disclaimer"),
  text: z.string().max(1500),
});

export const BlockSchema = z.discriminatedUnion("type", [
  AvatarBlock,
  IdentityBlock,
  ContactBlock,
  SocialBlock,
  BannerBlock,
  DividerBlock,
  DisclaimerBlock,
]);

export const TEMPLATE_IDS = [
  "classic",
  "modern-split",
  "minimal",
  "editorial-arch",
  "bold-letter",
  "circle-accent",
  "green-sidebar",
  "maroon-frame",
  "spectrum",
  "geometric",
  "noir-agent",
  "orange-logo",
  "ticket",
  "listing-banner",
  "soft-card",
  "consultant-blue",
  "executive-navy",
  "minimal-line",
  "dark-luxe",
  "pastel-pill",
  "split-color",
  "studio",
] as const;

export const SignatureDocSchema = z.object({
  version: z.literal(1),
  template_id: z.enum(TEMPLATE_IDS),
  /** Only used by the "studio" engine: which composed design (s001-s999). */
  variant: z.string().regex(/^s\d{3}$/).optional(),
  theme: ThemeSchema,
  blocks: z.array(BlockSchema).max(30),
});

export type Theme = z.infer<typeof ThemeSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type SignatureDoc = z.infer<typeof SignatureDocSchema>;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
