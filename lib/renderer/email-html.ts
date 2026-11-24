import type { Block, SignatureDoc, Theme } from "@/lib/schema/document";
import { GAP, TABLE_ATTRS, esc, fontStack, renderBlock, safeHttpsUrl, type Ctx } from "./shared";
import { isCardTemplate, renderCardBlock, renderCardTemplate } from "./cards";

export { esc, safeHttpsUrl, renderBlock };

/** Block HTML exactly as the active template renders it (used by click-to-edit to map preview cells back to blocks). */
export function renderBlockForDoc(b: Block, doc: SignatureDoc): string {
  return isCardTemplate(doc.template_id) ? renderCardBlock(b, doc) : renderBlock(b, { theme: doc.theme });
}

/* ---------- table helpers ---------- */

function stackRows(htmls: string[], gap: number): string {
  const rows = htmls
    .filter(Boolean)
    .map((h, i) => `<tr><td style="padding-top:${i === 0 ? 0 : gap}px;">${h}</td></tr>`)
    .join("");
  return `<table ${TABLE_ATTRS}>${rows}</table>`;
}

function wrap(inner: string, theme: Theme): string {
  return `<table ${TABLE_ATTRS} style="font-family:${fontStack(theme)};color:${theme.text};"><tr><td>${inner}</td></tr></table>`;
}

/* ---------- templates (layouts) ---------- */

function renderAll(blocks: Block[], ctx: Ctx): string[] {
  return blocks.map((b) => renderBlock(b, ctx));
}

function layoutClassic(doc: SignatureDoc): string {
  const ctx = { theme: doc.theme };
  const gap = GAP[doc.theme.spacing];
  return wrap(stackRows(renderAll(doc.blocks, ctx), gap), doc.theme);
}

function layoutModernSplit(doc: SignatureDoc): string {
  const ctx = { theme: doc.theme };
  const gap = GAP[doc.theme.spacing];
  const avatar = doc.blocks.find((b) => b.type === "avatar");
  const rest = doc.blocks.filter((b) => b !== avatar);
  // Identity/contact/social sit beside the avatar; the remaining blocks span the full width underneath.
  const sideTypes = new Set(["identity", "contact", "social"]);
  const side = rest.filter((b) => sideTypes.has(b.type));
  const below = rest.filter((b) => !sideTypes.has(b.type));

  const right = stackRows(renderAll(side, ctx), gap);
  const top = avatar
    ? `<table ${TABLE_ATTRS}><tr><td valign="top" style="padding-right:16px;">${renderBlock(avatar, ctx)}</td><td valign="top" style="border-left:2px solid ${doc.theme.primary};padding-left:16px;">${right}</td></tr></table>`
    : right;
  return wrap(stackRows([top, ...renderAll(below, ctx)], gap), doc.theme);
}

function layoutMinimal(doc: SignatureDoc): string {
  const ctx = { theme: doc.theme };
  const gap = GAP[doc.theme.spacing];
  // Minimal drops the avatar and divider entirely.
  const blocks = doc.blocks.filter((b) => b.type !== "avatar" && b.type !== "divider");
  return wrap(stackRows(renderAll(blocks, ctx), gap), doc.theme);
}

/** Deterministic JSON -> Outlook-safe table HTML. Validate `doc` with SignatureDocSchema before calling. */
export function renderToEmailHtml(doc: SignatureDoc): string {
  switch (doc.template_id) {
    case "classic":
      return layoutClassic(doc);
    case "modern-split":
      return layoutModernSplit(doc);
    case "minimal":
      return layoutMinimal(doc);
    default:
      return renderCardTemplate(doc);
  }
}
