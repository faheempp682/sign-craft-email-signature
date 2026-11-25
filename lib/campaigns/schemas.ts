import { z } from "zod";
import { safeTarget } from "./token";

const httpsUrl = z.string().trim().max(1000, "That link is too long.").refine((v) => safeTarget(v) !== null, "Enter a full https:// link.");
const when = z.string().datetime({ offset: true, error: "Enter a valid date and time." }).nullable();
const uuid = z.string().uuid("Invalid id.");

const base = {
  name: z.string().trim().min(1, "Give the campaign a name.").max(120),
  href: httpsUrl,
  fallback_src: httpsUrl,
  fallback_alt: z.string().trim().max(160).default(""),
  starts_at: when.default(null),
  ends_at: when.default(null),
  status: z.enum(["draft", "active", "paused", "ended"]).default("draft"),
};

const ordered = (v: { starts_at?: string | null; ends_at?: string | null }) => !v.starts_at || !v.ends_at || Date.parse(v.ends_at) > Date.parse(v.starts_at);
const orderMsg = { message: "The end must be after the start.", path: ["ends_at"] };

export const CampaignCreate = z.object({ ...base, org_id: uuid.optional() }).refine(ordered, orderMsg);

export const CampaignPatch = z
  .object({
    name: base.name.optional(),
    href: httpsUrl.optional(),
    fallback_src: httpsUrl.optional(),
    fallback_alt: z.string().trim().max(160).optional(),
    starts_at: when.optional(),
    ends_at: when.optional(),
    status: z.enum(["draft", "active", "paused", "ended"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." })
  .refine(ordered, orderMsg);

export const VariantInput = z.object({
  id: uuid.optional(),
  label: z.string().trim().max(60).default(""),
  image_url: httpsUrl,
  alt_text: z.string().trim().max(160).default(""),
  width: z.number().int().min(100).max(600).default(400),
  height: z.number().int().min(20).max(300).default(100),
  weight: z.number({ error: "Weight must be a whole number." }).int().min(0).max(1000),
});

export const VariantsPut = z
  .object({ variants: z.array(VariantInput).max(8, "Use at most 8 variants.") })
  .refine((v) => v.variants.length === 0 || v.variants.some((x) => x.weight > 0), { message: "At least one variant needs a weight above 0.", path: ["variants"] });

export const LinkRequest = z.object({ signature_id: uuid.optional() });

export const RenderRequest = z.object({ doc: z.unknown(), signature_id: uuid });

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use dates like 2026-01-31.").refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date.");
export const StatsQuery = z
  .object({ from: day, to: day, org_id: uuid.optional(), format: z.enum(["json", "csv"]).default("json") })
  .refine((v) => v.to >= v.from, { message: "The end date must not be before the start date.", path: ["to"] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 366, { message: "Choose a range of one year or less.", path: ["to"] });

export const DISCLAIMER_CATEGORIES = ["confidentiality", "data_protection", "financial", "medical", "legal", "other"] as const;
export const DisclaimerInput = z.object({
  title: z.string().trim().min(1, "Give it a title.").max(120),
  category: z.enum(DISCLAIMER_CATEGORIES, { error: "Pick a category." }),
  jurisdiction: z.string().trim().max(60).default(""),
  body: z.string().trim().min(1, "Enter the text.").max(1500, "Keep it to 1,500 characters or fewer."),
  needs_review: z.boolean().default(true),
  org_id: uuid.optional(),
});
// No defaults here: a patch must only change what it names.
export const DisclaimerPatch = z
  .object({
    title: DisclaimerInput.shape.title.optional(),
    category: DisclaimerInput.shape.category.optional(),
    jurisdiction: z.string().trim().max(60).optional(),
    body: DisclaimerInput.shape.body.optional(),
    needs_review: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });
