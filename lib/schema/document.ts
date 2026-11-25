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

export const SOCIAL_DISPLAYS = ["icon", "icon-text", "text"] as const;

const AvatarBase = z.object({
  type: z.literal("avatar"),
  src: httpsUrl,
  alt: z.string().max(120).default(""),
  shape: z.enum(["circle", "square", "rounded", "arch"]).default("circle"),
  size: z.number().int().min(32).max(200).default(80),
  /** Only for tall photo layouts (e.g. Talent card). Absent = square. The cropper follows size : height. */
  height: z.number().int().min(32).max(400).optional(),
});

const IdentityBase = z.object({
  type: z.literal("identity"),
  name: z.string().min(1).max(100),
  title: z.string().max(100).optional(),
  company: z.string().max(100).optional(),
});

const ContactBase = z.object({
  type: z.literal("contact"),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional(),
  website: z.string().max(200).optional(),
  address: z.string().max(200).optional(),
});

const SocialBase = z.object({
  type: z.literal("social"),
  links: z
    .array(z.object({ network: z.enum(SOCIAL_NETWORKS), url: httpsUrl, /** The user's own icon image for this link; absent = the built-in network icon. */ icon: httpsUrl.optional() }))
    .max(8),
  /** How the links show: icon only, icon with the network name, or the name only. Absent = the template's own look. */
  display: z.enum(SOCIAL_DISPLAYS).optional(),
});

const BannerBase = z.object({
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

const DividerBase = z.object({
  type: z.literal("divider"),
});

const DisclaimerBase = z.object({
  type: z.literal("disclaimer"),
  text: z.string().max(1500),
});


/* ---------- per-block design (all optional; absent = exactly the template's own look) ---------- */

const px = (min: number, max: number) => z.number().int().min(min).max(max).optional();

export const GRADIENT_DIRECTIONS = ["to-right", "to-left", "to-bottom", "to-top"] as const;

/**
 * Email-safe visual style for one block. Everything here maps onto inline CSS that survives table layouts.
 * Gradients are a design-time property: the exporter emits a solid fallback (see lib/renderer/block-style.ts).
 */
export const BlockStyleSchema = z.object({
  fontFamily: z.enum(SAFE_FONTS).optional(),
  fontSize: px(8, 48),
  fontWeight: z.enum(["normal", "bold"]).optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  color: hexColor.optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  lineHeight: px(8, 80),
  letterSpacing: z.number().min(-2).max(10).optional(),
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
  bg: hexColor.optional(),
  gradient: z
    .object({
      from: hexColor,
      to: hexColor,
      direction: z.enum(GRADIENT_DIRECTIONS).default("to-right"),
      opacity: z.number().min(0).max(1).default(1),
    })
    .optional(),
  borderColor: hexColor.optional(),
  borderWidth: px(0, 8),
  borderRadius: px(0, 60),
  opacity: z.number().min(0.1).max(1).optional(),
  paddingTop: px(0, 60),
  paddingRight: px(0, 60),
  paddingBottom: px(0, 60),
  paddingLeft: px(0, 60),
  marginTop: px(0, 60),
  marginBottom: px(0, 60),
});

/** Editor bookkeeping + design shared by every block. Old documents without these fields stay valid. */
const Common = {
  style: BlockStyleSchema.optional(),
  /** Hidden blocks stay in the document but are not exported. */
  hidden: z.boolean().optional(),
  /** Layer name shown in the editor. */
  layer: z.string().max(40).optional(),
  locked: z.boolean().optional(),
};

export const TextBlock = z.object({
  type: z.literal("text"),
  text: z.string().max(600),
  variant: z.enum(["body", "heading"]).default("body"),
  ...Common,
});

export const ButtonBlock = z.object({
  type: z.literal("button"),
  label: z.string().min(1).max(40),
  href: httpsUrl,
  ...Common,
});

export const SpacerBlock = z.object({
  type: z.literal("spacer"),
  height: z.number().int().min(4).max(80).default(12),
  ...Common,
});

export const AvatarBlock = AvatarBase.extend(Common);
export const IdentityBlock = IdentityBase.extend(Common);
export const ContactBlock = ContactBase.extend(Common);
export const SocialBlock = SocialBase.extend(Common);
export const BannerBlock = BannerBase.extend(Common);
export const DividerBlock = DividerBase.extend(Common);
export const DisclaimerBlock = DisclaimerBase.extend(Common);

export const LeafBlockSchema = z.discriminatedUnion("type", [
  AvatarBlock,
  IdentityBlock,
  ContactBlock,
  SocialBlock,
  BannerBlock,
  DividerBlock,
  DisclaimerBlock,
  TextBlock,
  ButtonBlock,
  SpacerBlock,
]);

/* ---------- rows & columns (flow layout; rendered as nested tables) ---------- */

/** A row inside a column inside a row ... may go this deep (top-level row = depth 1). */
export const MAX_ROW_DEPTH = 3;
export const MAX_COLUMNS = 4;
export const MAX_COLUMN_BLOCKS = 12;
/** Every block, row and nested block in one document. Keeps the exported HTML (and Gmail's 102 KB clip) in check. */
export const MAX_TOTAL_NODES = 80;

export type LeafBlock = z.infer<typeof LeafBlockSchema>;

export type Column = {
  /** Percent of the row (5-100). Absent columns share what the sized ones leave, equally. */
  width?: number;
  valign?: "top" | "middle" | "bottom";
  align?: "left" | "center" | "right";
  bg?: string;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  blocks: Block[];
};

export type RowBlock = {
  type: "row";
  columns: Column[];
  /** Horizontal space between columns, px. */
  gap?: number;
  /** Stack the columns on narrow screens where the client supports it. Absent = stack. Outlook desktop never stacks. */
  stack?: boolean;
  style?: BlockStyle;
  hidden?: boolean;
  layer?: string;
  locked?: boolean;
};

export type Block = LeafBlock | RowBlock;

const ColumnSchema: z.ZodType<Column> = z.object({
  width: z.number().int().min(5).max(100).optional(),
  valign: z.enum(["top", "middle", "bottom"]).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  bg: hexColor.optional(),
  paddingTop: px(0, 60),
  paddingRight: px(0, 60),
  paddingBottom: px(0, 60),
  paddingLeft: px(0, 60),
  blocks: z.array(z.lazy(() => BlockSchema)).max(MAX_COLUMN_BLOCKS),
});

export const RowBlockSchema: z.ZodType<RowBlock> = z.object({
  type: z.literal("row"),
  columns: z.array(ColumnSchema).min(1).max(MAX_COLUMNS),
  gap: px(0, 48),
  stack: z.boolean().optional(),
  ...Common,
});

/** Any block, including rows (which hold more blocks). Existing documents contain only leaf blocks and still parse. */
export const BlockSchema: z.ZodType<Block> = z.lazy(() => z.union([LeafBlockSchema, RowBlockSchema]));

/** Deepest row nesting under `blocks` (0 = no rows) and the number of nodes (blocks + rows) in the tree. */
export function measureBlocks(blocks: readonly Block[]): { depth: number; nodes: number } {
  let depth = 0;
  let nodes = 0;
  for (const b of blocks) {
    nodes += 1;
    if (b.type !== "row") continue;
    let inner = 0;
    for (const c of b.columns) {
      const m = measureBlocks(c.blocks);
      inner = Math.max(inner, m.depth);
      nodes += m.nodes;
    }
    depth = Math.max(depth, 1 + inner);
  }
  return { depth, nodes };
}

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
  "talent-card",
  "mountain-logo",
  "script-contact",
  "ringed-sales",
  "studio",
] as const;

export const SignatureDocSchema = z.object({
  version: z.literal(1),
  template_id: z.enum(TEMPLATE_IDS),
  /** Only used by the "studio" engine: which composed design (s001-s999). */
  variant: z.string().regex(/^s\d{3}$/).optional(),
  theme: ThemeSchema,
  blocks: z.array(BlockSchema).max(30),
}).superRefine((doc, ctx) => {
  const { depth, nodes } = measureBlocks(doc.blocks);
  if (depth > MAX_ROW_DEPTH) ctx.addIssue({ code: "custom", path: ["blocks"], message: `Rows can be nested at most ${MAX_ROW_DEPTH} levels deep` });
  if (nodes > MAX_TOTAL_NODES) ctx.addIssue({ code: "custom", path: ["blocks"], message: `A signature can hold at most ${MAX_TOTAL_NODES} blocks in total` });
});

export type Theme = z.infer<typeof ThemeSchema>;
export type BlockStyle = z.infer<typeof BlockStyleSchema>;
export type SignatureDoc = z.infer<typeof SignatureDocSchema>;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
