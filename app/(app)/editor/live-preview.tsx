"use client";

import { useEffect, useRef, useState } from "react";
import type { SignatureDoc } from "@/lib/schema/document";
import { mapBlockElements } from "@/lib/editor/preview-map";

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
  selectedId,
  onPick,
}: {
  snapshot: Snapshot;
  dark: boolean;
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

  // Re-inject whenever the document, background or selection changes.
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!doc || loads === 0) return;
    doc.body.style.background = dark ? "#1f2937" : "#ffffff";
    doc.body.innerHTML = snapshot.html;
    const map = mapBlockElements(doc.body, snapshot.parsed, snapshot.ids);
    blockMap.current = map;
    for (const [el, id] of map) {
      el.setAttribute("data-block", id);
      if (id === selectedId) el.setAttribute("data-selected", "");
    }
  }, [snapshot, dark, selectedId, loads]);

  return (
    // allow-same-origin lets the editor read the DOM for click mapping. Scripts stay disabled, so injected markup can never run code.
    <iframe
      ref={frame}
      title="Signature preview"
      srcDoc={SHELL}
      sandbox="allow-same-origin"
      onLoad={() => setLoads((n) => n + 1)}
      className="h-[460px] w-full bg-white"
    />
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
