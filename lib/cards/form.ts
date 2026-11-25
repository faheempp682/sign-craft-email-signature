import { CardInputSchema, type CardInput, type PublicCard } from "./schema";

/** The editor works with plain strings; this converts to and from the validated shape and reports errors per field. */

export type SocialRow = { network: CardInput["social_links"][number]["network"]; url: string };
export type CardForm = {
  slug: string;
  display_name: string;
  title: string;
  company: string;
  bio: string;
  photo_url: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  social_links: SocialRow[];
  booking_url: string;
  accent_color: string;
  published: boolean;
  indexable: boolean;
};

export const EMPTY_FORM: CardForm = {
  slug: "",
  display_name: "",
  title: "",
  company: "",
  bio: "",
  photo_url: "",
  phone: "",
  email: "",
  website: "",
  address: "",
  social_links: [],
  booking_url: "",
  accent_color: "#111111",
  published: false,
  indexable: false,
};

export function formFromCard(c: Partial<CardInput>): CardForm {
  return {
    slug: c.slug ?? "",
    display_name: c.display_name ?? "",
    title: c.title ?? "",
    company: c.company ?? "",
    bio: c.bio ?? "",
    photo_url: c.photo_url ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    website: c.website ?? "",
    address: c.address ?? "",
    social_links: (c.social_links ?? []).map((s) => ({ network: s.network, url: s.url })),
    booking_url: c.booking_url ?? "",
    accent_color: c.accent_color ?? "#111111",
    published: c.published ?? false,
    indexable: c.indexable ?? false,
  };
}

export type FormErrors = Partial<Record<keyof CardForm, string>> & { social_rows?: Record<number, string> };

/** Validated payload, or the message for each broken field. Blank social rows are dropped. */
export function parseForm(f: CardForm): { ok: true; data: CardInput } | { ok: false; errors: FormErrors } {
  const r = CardInputSchema.safeParse({ ...f, social_links: f.social_links.filter((s) => s.url.trim() !== "") });
  if (r.success) return { ok: true, data: r.data };
  const errors: FormErrors = {};
  for (const issue of r.error.issues) {
    const key = issue.path[0] as keyof CardForm;
    if (key === "social_links" && typeof issue.path[1] === "number") {
      (errors.social_rows ??= {})[issue.path[1]] = issue.message;
    } else if (!errors[key]) {
      (errors as Record<string, unknown>)[key] = issue.message;
    }
  }
  return { ok: false, errors };
}

/** What the live preview shows: the same shape the public page receives. Invalid fields simply do not appear, as on the real page. */
export function previewCard(f: CardForm): PublicCard {
  const clean = (v: string) => (v.trim() ? v.trim() : null);
  return {
    slug: f.slug.trim().toLowerCase() || "your-address",
    display_name: f.display_name.trim() || "Your name",
    title: clean(f.title),
    company: clean(f.company),
    bio: clean(f.bio),
    photo_url: clean(f.photo_url),
    phone: clean(f.phone),
    email: clean(f.email),
    website: clean(f.website),
    address: clean(f.address),
    social_links: f.social_links.filter((s) => s.url.trim() !== "").map((s) => ({ network: s.network, url: s.url.trim() })),
    booking_url: clean(f.booking_url),
    accent_color: /^#[0-9a-fA-F]{6}$/.test(f.accent_color) ? f.accent_color : "#111111",
    indexable: f.indexable,
  };
}
