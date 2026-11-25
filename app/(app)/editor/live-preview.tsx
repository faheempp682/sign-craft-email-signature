"use client";

import { useEffect, useRef, useState } from "react";
import type { SignatureDoc } from "@/lib/schema/document";
import { mapBlockElements } from "@/lib/editor/preview-map";
import { CLIENTS, clientHtml, type ClientId } from "@/lib/preview-clients";
import { ClientBadge } from "@/app/(app)/preview/render-ui";

export type Snapshot = { html: string; parsed: SignatureDoc; ids: string[] };
export type PickHint = { text: string; offset: number };

// Static shell. The signature HTML itself is injected below, byte-for-byte what the exporter produced.
// The hover/selection outlines are applied to the preview DOM only and never reach the exported string.
const SHELL = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:24px}
[data-block]{cursor:pointer;border-radius:4px}
[data-block]:hover{outline:1px dashed #818cf8;outline-offset:-1px}
[data-selected]{outline:2px solid #4f46e5 !important;outline-offset:-2px}
</style></head><body></body></html>`;

export function LivePreview({
  snapshot,
  dark,
  client,
  selectedId,
  onPick,
}: {
  snapshot: Snapshot;
  dark: boolean;
  client: ClientId;
  selectedId: string | null;
  onPick: (id: string, hint: PickHint | null) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loads, setLoads] = useState(0); // bumps whenever the iframe document (re)loads
  const blockMap = useRef<Map<Element, string>>(new Map());
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  // Click delegation, attached once per iframe document.
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!doc || loads === 0) return;
    const onClick = (e: MouseEvent) => {
      // The preview is for editing, never navigating: stop mailto:/tel:/https: links from firing.
      e.preventDefault();
      const target = e.target as Element | null;
      let el: Element | null = target;
      while (el && el !== doc.body) {
        const id = blockMap.current.get(el);
        if (id) {
          pick.current(id, hintAt(doc, e, target));
          return;
        }
        el = el.parentElement;
      }
    };
    doc.addEventListener("click", onClick);
    return () => doc.removeEventListener("click", onClick);
  }, [loads]);

  // Signatures are 380-640px wide but the preview pane can be narrower (split editor, mobile). Scale the preview down
  // to fit instead of letting it scroll sideways. This only affects the preview DOM, never the exported HTML.
  const fit = () => {
    const f = frame.current;
    const doc = f?.contentDocument;
    if (!f || !doc?.body) return;
    doc.body.style.zoom = "";
    const need = doc.documentElement.scrollWidth;
    const have = f.clientWidth;
    if (need > have && have > 0) doc.body.style.zoom = String(have / need);
  };
  useEffect(() => {
    const f = frame.current;
    if (!f || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(f);
    return () => ro.disconnect();
  });

  // Re-inject whenever the document, background or selection changes.
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!doc || loads === 0) return;
    const c = CLIENTS[client];
    const t = dark ? c.dark : c.light;
    doc.body.style.cssText = `margin:${c.width ? 14 : 24}px;background:${t.bg};color:${t.ink};font-family:${c.font};font-size:${c.size};`;
    // Client simulations (Outlook Word rules, Gmail clean-up, dark mode) change styles only, never the table structure the click map relies on.
    doc.body.innerHTML = clientHtml(snapshot.html, client, dark);
    fit();
    const map = mapBlockElements(doc.body, snapshot.parsed, snapshot.ids);
    blockMap.current = map;
    for (const [el, id] of map) {
      el.setAttribute("data-block", id);
      if (id === selectedId) el.setAttribute("data-selected", "");
    }
  }, [snapshot, dark, client, selectedId, loads]);

  return (
    // allow-same-origin lets the editor read the DOM for click mapping. Scripts stay disabled, so injected markup can never run code.
    <div>
    <ClientBadge client={client} />
    <div className="bg-surface-2 p-0 sm:p-4">
    <iframe
      ref={frame}
      title="Signature preview"
      srcDoc={SHELL}
      sandbox="allow-same-origin"
      onLoad={() => setLoads((n) => n + 1)}
      style={{ width: CLIENTS[client].width ?? "100%" }}
      className="mx-auto block h-[460px] max-w-full border-line bg-white sm:rounded-lg sm:border"
    />
    </div>
    </div>
  );
}

/** Text node + offset under the pointer, so "Title · Company" resolves to the half that was clicked. */
function hintAt(doc: Document, e: MouseEvent, target: Element | null): PickHint | null {
  let node: Node | null = null;
  let offset = 0;
  const range = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
  if (range) {
    node = range.startContainer;
    offset = range.startOffset;
  } else {
    const pos = (doc as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }).caretPositionFromPoint?.(e.clientX, e.clientY);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }
  if (node && node.nodeType === 3 && target?.contains(node)) return { text: node.textContent ?? "", offset };
  return { text: target?.tagName === "IMG" ? "" : (target?.textContent ?? ""), offset: 0 };
}
