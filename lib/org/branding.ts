import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { contrast } from "@/lib/linter/contrast";

/** White-label branding for the app chrome of one organization. Stored in organization_branding (migration 0015). */

export type Branding = {
  name: string;
  logo: { url: string; width: number; height: number } | null;
  /** #RRGGBB that has at least 4.5:1 contrast on white, or null for the app's own colours. */
  accent: string | null;
  poweredBy: boolean;
};

export const DEFAULT_BRAND_NAME = "SignCraft";
export const DEFAULT_BRANDING: Branding = { name: DEFAULT_BRAND_NAME, logo: null, accent: null, poweredBy: true };

export type BrandingRow = {
  brand_name: string | null;
  logo_url: string | null;
  logo_width: number | null;
  logo_height: number | null;
  accent: string | null;
  show_powered_by: boolean;
};

export const BRANDING_COLUMNS = "brand_name, logo_url, logo_width, logo_height, accent, show_powered_by";

/** An https URL with no whitespace, quotes or angle brackets, at most 500 characters. Same rule as the database check. */
export function isSafeLogoUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 500 || !/^https:\/\/[^\s<>"]+$/.test(v)) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** #RRGGBB that reaches 4.5:1 against white (WCAG AA text). Same rule as contrast_ok_on_white() in the database. */
export function accentPassesOnWhite(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) && contrast(v, "#ffffff") >= 4.5;
}

/** Turn a stored row (or nothing) into what the header shows. Anything that fails validation falls back to the default. */
export function resolveBranding(row: BrandingRow | null | undefined): Branding {
  if (!row) return DEFAULT_BRANDING;
  const name = row.brand_name?.trim();
  const logo =
    isSafeLogoUrl(row.logo_url) && Number.isInteger(row.logo_width) && Number.isInteger(row.logo_height) && row.logo_width! > 0 && row.logo_height! > 0
      ? { url: row.logo_url, width: row.logo_width!, height: row.logo_height! }
      : null;
  return {
    name: name ? name.slice(0, 60) : DEFAULT_BRAND_NAME,
    logo,
    accent: accentPassesOnWhite(row.accent) ? row.accent.toUpperCase() : null,
    poweredBy: row.show_powered_by !== false,
  };
}

/** The branding of one organization as the caller's session can read it (members read their own organization's row). */
export async function loadBranding(supabase: Pick<SupabaseClient, "from">, orgId: string | null | undefined): Promise<Branding> {
  if (!orgId) return DEFAULT_BRANDING;
  try {
    const { data, error } = await supabase.from("organization_branding").select(BRANDING_COLUMNS).eq("org_id", orgId).maybeSingle();
    if (error) return DEFAULT_BRANDING;
    return resolveBranding(data as BrandingRow | null);
  } catch {
    return DEFAULT_BRANDING;
  }
}

/** Body of PUT /api/agency/branding. Every field is replaced, so a missing one means "clear it". */
export const BrandingInput = z
  .object({
    org_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid organization.").optional(),
    brand_name: z.string().trim().max(60, "The brand name is at most 60 characters.").nullish().transform((v) => v || null),
    logo_url: z.string().trim().max(500, "The logo link is too long.").nullish().transform((v) => v || null),
    logo_width: z.number().int().min(16, "The logo width is 16 to 400 pixels.").max(400, "The logo width is 16 to 400 pixels.").nullish().transform((v) => v ?? null),
    logo_height: z.number().int().min(16, "The logo height is 16 to 200 pixels.").max(200, "The logo height is 16 to 200 pixels.").nullish().transform((v) => v ?? null),
    accent: z.string().trim().nullish().transform((v) => v || null),
    show_powered_by: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.logo_url && !isSafeLogoUrl(v.logo_url)) ctx.addIssue({ code: "custom", path: ["logo_url"], message: "Enter a full https:// link to the logo." });
    if (v.logo_url && (v.logo_width === null || v.logo_height === null)) ctx.addIssue({ code: "custom", path: ["logo_width"], message: "Give the logo a width and a height." });
    if (!v.logo_url && (v.logo_width !== null || v.logo_height !== null)) ctx.addIssue({ code: "custom", path: ["logo_url"], message: "Add the logo link, or clear the size." });
    if (v.accent && !accentPassesOnWhite(v.accent)) {
      const hex = /^#[0-9a-fA-F]{6}$/.test(v.accent);
      ctx.addIssue({ code: "custom", path: ["accent"], message: hex ? "That colour is too light: it needs at least 4.5:1 contrast on white." : "Enter a colour like #0B5FFF." });
    }
  });
export type BrandingInputT = z.infer<typeof BrandingInput>;
