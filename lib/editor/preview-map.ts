import type { Block, SignatureDoc } from "@/lib/schema/document";
import { renderBlockForDoc } from "@/lib/renderer/email-html";
import { FIELDS } from "./blocks";

/**
 * Click-to-edit support WITHOUT touching the exporter: the preview DOM is matched against what the unchanged
 * `renderBlock` produces for each block. Block output always sits alone inside a <td>, so we compare that
 * cell's innerHTML with the block's HTML (both normalised by the same browser parser).
 * Returns element -> block id. Identical blocks are paired in document order.
 */
export function mapBlockElements(root: ParentNode, doc: SignatureDoc, ids: string[]): Map<Element, string> {
  const normalise = (html: string) => {
    const t = document.createElement("template");
    t.innerHTML = html;
    return t.innerHTML;
  };
  const cellsByHtml = new Map<string, Element[]>();
  for (const td of Array.from(root.querySelectorAll("td"))) {
    const list = cellsByHtml.get(td.innerHTML) ?? [];
    list.push(td);
    cellsByHtml.set(td.innerHTML, list);
  }
  const used = new Map<string, number>();
  const out = new Map<Element, string>();
  doc.blocks.forEach((block, i) => {
    const html = renderBlockForDoc(block, doc);
    if (!html) return; // empty blocks (e.g. a contact block with no fields) render nothing
    const key = normalise(html);
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    const el = cellsByHtml.get(key)?.[n];
    if (el && ids[i]) out.set(el, ids[i]);
  });
  return out;
}

/**
 * Which form field does the clicked text belong to? `text`/`offset` come from the text node under the pointer,
 * so a "Title · Company" line resolves to the right half. Falls back to the block's first field.
 */
export function pickFieldKey(block: Block, text: string, offset = 0): string | undefined {
  if (block.type === "social" || block.type === "divider") return undefined;
  const specs = FIELDS[block.type];
  const hay = text.toLowerCase();
  if (!hay.trim()) return specs[0]?.key;

  const hits: { key: string; start: number; end: number }[] = [];
  for (const spec of specs) {
    const v = (block as Record<string, unknown>)[spec.key];
    if (typeof v !== "string" || !v || spec.kind === "select") continue;
    // The website label is shown without protocol / trailing slash.
    const shown = spec.key === "website" ? v.replace(/^https?:\/\//i, "").replace(/\/$/, "") : v;
    const at = hay.indexOf(shown.toLowerCase());
    if (at >= 0) hits.push({ key: spec.key, start: at, end: at + shown.length });
  }
  if (!hits.length) return specs[0]?.key;
  const under = hits.find((h) => offset >= h.start && offset <= h.end);
  return (under ?? [...hits].sort((a, b) => b.end - b.start - (a.end - a.start))[0]).key;
}
