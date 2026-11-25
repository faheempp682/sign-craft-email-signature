import type { Block, SignatureDoc } from "@/lib/schema/document";
import { renderBlockForDoc } from "@/lib/renderer/email-html";
import { FIELDS } from "./blocks";

/**
 * Click-to-edit support WITHOUT touching the exporter: the preview DOM is matched against what the unchanged
 * `renderBlockForDoc` produces for each block (both normalised by the same browser parser).
 *
 * A block's HTML is either the whole content of a <td> (that cell is mapped) or, when a layout stacks several blocks in
 * one cell, a contiguous run of that cell's children (each element of the run is mapped). Identical blocks are paired
 * in document order. Returns element -> block id.
 */
export function mapBlockElements(root: ParentNode, doc: SignatureDoc, ids: string[]): Map<Element, string> {
  const owner = (root as Node).ownerDocument ?? document;
  const normalise = (html: string) => {
    const t = owner.createElement("template");
    t.innerHTML = html;
    return t.innerHTML;
  };
  const ser = (n: Node): string => {
    if (n.nodeType === 1) return (n as Element).outerHTML;
    if (n.nodeType === 3) {
      const d = owner.createElement("div");
      d.appendChild(n.cloneNode());
      return d.innerHTML;
    }
    return "";
  };
  const all = Array.from(root.querySelectorAll("*"));
  const used = new Map<string, number>();
  const out = new Map<Element, string>();
  doc.blocks.forEach((block, i) => {
    const html = renderBlockForDoc(block, doc);
    if (!html || !ids[i]) return; // empty blocks (e.g. a contact block with no fields) render nothing
    const key = normalise(html);
    const want = used.get(key) ?? 0;
    used.set(key, want + 1);

    // Minimal containers: elements whose content includes the block, with no child element that already does.
    let seen = 0;
    for (const el of all) {
      const inner = el.innerHTML;
      if (!inner.includes(key)) continue;
      if (Array.from(el.children).some((c) => c.innerHTML.includes(key))) continue;
      // Offsets of each child node inside el.innerHTML.
      const nodes = Array.from(el.childNodes);
      const starts: number[] = [];
      let acc = 0;
      for (const n of nodes) {
        starts.push(acc);
        acc += ser(n).length;
      }
      for (let at = inner.indexOf(key); at >= 0; at = inner.indexOf(key, at + key.length)) {
        if (seen++ !== want) continue;
        if (inner.length === key.length) {
          out.set(el, ids[i]); // the block is the entire cell
          return;
        }
        const first = starts.indexOf(at);
        if (first < 0) return; // run does not start on a node boundary
        for (let k = first; k < nodes.length && starts[k] < at + key.length; k++) {
          const n = nodes[k];
          if (n.nodeType === 1) out.set(n as Element, ids[i]);
        }
        return;
      }
    }
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
