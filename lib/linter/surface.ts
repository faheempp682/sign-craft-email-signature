import type { SignatureDoc } from "@/lib/schema/document";

export const WHITE = "#FFFFFF";

/** Templates that ignore theme.bg (see ThemeSchema); everything else draws a card in that colour. */
export const PLAIN_TEMPLATES = new Set<string>(["classic", "modern-split", "minimal"]);

export const isPlainTemplate = (doc: Pick<SignatureDoc, "template_id">) => PLAIN_TEMPLATES.has(doc.template_id);

/** The colour the signature's text actually sits on in light mode: the page (white) for plain templates, else the card. */
export const lightSurface = (doc: Pick<SignatureDoc, "template_id" | "theme">) => (isPlainTemplate(doc) ? WHITE : doc.theme.bg.toUpperCase());
