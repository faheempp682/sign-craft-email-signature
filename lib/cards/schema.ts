import { z } from "zod";
import { SOCIAL_NETWORKS } from "@/lib/schema/document";
import { httpsHref } from "./links";

/** Mirrors supabase/migrations/0007_digital_cards.sql; the database enforces the same rules again. */

export const MAX_CARDS_PER_USER = 5;
export const MAX_SOCIALS = 10;

export const RESERVED_SLUGS = [
  "admin", "api", "app", "auth", "login", "logout", "signup", "signin", "c", "b", "r", "card", "cards", "new", "edit", "settings", "static",
  "public", "assets", "www", "mail", "help", "support", "about", "terms", "privacy", "sitemap", "robots", "signatures", "editor", "create",
  "preview", "guides", "billing", "null", "undefined", "vcard", "qr",
] as const;

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** null when the slug is acceptable, otherwise a message for the person typing it. */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3 || slug.length > 40) return "Use 3 to 40 characters.";
  if (!/^[a-z0-9-]+$/.test(slug)) return "Use lowercase letters, digits and hyphens only.";
  if (!SLUG_RE.test(slug)) return "Start and end with a letter or digit.";
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) return "That address is reserved. Pick another.";
  return null;
}

/** A tidy slug from a name, for suggestions. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .refine((v) => !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v), "Contains characters that are not allowed.")
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const optionalHttps = optionalText(500).refine((v) => v === null || httpsHref(v) !== null, "Must be a full https:// address.");

export const SocialLinkSchema = z.object({ network: z.enum(SOCIAL_NETWORKS), url: z.string().trim().max(500).refine((v) => httpsHref(v) !== null, "Must be a full https:// address.") });

export const CardInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .superRefine((s, ctx) => {
      const problem = slugProblem(s);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  display_name: z.string().trim().min(1, "Enter a name.").max(100, "Keep the name under 100 characters."),
  title: optionalText(100),
  company: optionalText(100),
  bio: optionalText(300),
  photo_url: optionalHttps,
  phone: optionalText(30).refine((v) => v === null || /^[0-9+()./ -]{3,30}$/.test(v), "Use digits, spaces and + ( ) - . only."),
  email: optionalText(200).refine((v) => v === null || /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/.test(v), "Enter a valid email address."),
  website: optionalHttps,
  address: optionalText(200),
  social_links: z.array(SocialLinkSchema).max(MAX_SOCIALS, `At most ${MAX_SOCIALS} social links.`).default([]),
  booking_url: optionalHttps,
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #RRGGBB colour.").default("#111111"),
  published: z.boolean().default(false),
  indexable: z.boolean().default(false),
});

export type CardInput = z.infer<typeof CardInputSchema>;

/** What the owner screens work with: the input plus identity fields the owner may see. */
export type OwnedCard = CardInput & { id: string; created_at: string; updated_at: string };

/** Exactly what an anonymous visitor can receive for a published card. */
export type PublicCard = Pick<
  CardInput,
  "slug" | "display_name" | "title" | "company" | "bio" | "photo_url" | "phone" | "email" | "website" | "address" | "social_links" | "booking_url" | "accent_color" | "indexable"
>;

/** The columns selected for the owner list and public fetch. */
export const OWNER_COLUMNS =
  "id, slug, display_name, title, company, bio, photo_url, phone, email, website, address, social_links, booking_url, accent_color, published, indexable, created_at, updated_at";
