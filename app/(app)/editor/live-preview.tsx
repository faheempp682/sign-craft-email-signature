"use client";

import { useEffect, useRef, useState } from "react";
import type { SignatureDoc } from "@/lib/schema/document";
import { mapBlockElements } from "@/lib/editor/preview-map";
import { CLIENTS, clientHtml, type ClientId } from "@/lib/preview-clients";
import { ClientBadge } from "@/app/(app)/preview/render-ui";

export type Snapshot = { html: string; parsed: SignatureDoc; ids: string[] };
export type PickHint = { text: string; offset: number; shift?: boolean };
/** Where each block sits inside the preview document (iframe pixels), used by the design canvas for handles and guides. */
export type BlockRect = { x: number; y: number; w: number; h: number };
export type Layout = { rects: Record<string, BlockRect>; width: number; height: number };

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
  selectedIds,
  onDoubleClick,
  onLayout,
  onContextMenu,
  height = 460,
  bare = false,
}: {
  snapshot: Snapshot;
  dark: boolean;
  client: ClientId;
  selectedId: string | null;
  onPick: (id: string, hint: PickHint | null) => void;
  /** Design canvas: every selected block is outlined (selectedId alone keeps the form editor's behaviour). */
  selectedIds?: string[];
  onDoubleClick?: (id: string, hint: PickHint | null) => void;
  onLayout?: (layout: Layout) => void;
  /** Right-click: the block under the pointer (or null) and the position in preview-document pixels. */
  onContextMenu?: (id: string | null, x: number, y: number) => void;
  height?: number;
  /** Render just the iframe (no client badge or padded frame): the design canvas draws its own workspace. */
  bare?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loads, setLoads] = useState(0); // bumps whenever the iframe document (re)loads
  const blockMap = useRef<Map<Element, string>>(new Map());
  const pick = useRef(onPick);
  const dbl = useRef(onDoubleClick);
  const layoutCb = useRef(onLayout);
  const ctxCb = useRef(onContextMenu);
  useEffect(() => {
    pick.current = onPick;
    dbl.current = onDoubleClick;
    layoutCb.current = onLayout;
    ctxCb.current = onContextMenu;
  }, [onPick, onDoubleClick, onLayout, onContextMenu]);

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
          const hint = hintAt(doc, e, target);
          pick.current(id, hint ? { ...hint, shift: e.shiftKey || e.metaKey || e.ctrlKey } : { text: "", offset: 0, shift: e.shiftKey || e.metaKey || e.ctrlKey });
          return;
        }
        el = el.parentElement;
      }
    };
    const onDbl = (e: MouseEvent) => {
      e.preventDefault();
      const target = e.target as Element | null;
      let el: Element | null = target;
      while (el && el !== doc.body) {
        const id = blockMap.current.get(el);
        if (id) {
          dbl.current?.(id, hintAt(doc, e, target));
          return;
        }
        el = el.parentElement;
      }
    };
    const onCtx = (e: MouseEvent) => {
      if (!ctxCb.current) return;
      e.preventDefault();
      let el: Element | null = e.target as Element | null;
      let id: string | null = null;
      while (el && el !== doc.body) {
        id = blockMap.current.get(el) ?? null;
        if (id) break;
        el = el.parentElement;
      }
      ctxCb.current(id, e.clientX, e.clientY);
    };
    // Focus lives inside the iframe after a click, so its key events never reach the page. Re-dispatch them on the
    // window so editor shortcuts (undo, delete, duplicate, Escape, space-to-pan) work wherever the focus is.
    const forward = (e: KeyboardEvent) => {
      const copy = new KeyboardEvent(e.type, { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, repeat: e.repeat, bubbles: true, cancelable: true });
      Object.defineProperty(copy, "target", { value: doc.body });
      window.dispatchEvent(copy);
      if (copy.defaultPrevented) e.preventDefault();
    };
    doc.addEventListener("click", onClick);
    doc.addEventListener("dblclick", onDbl);
    doc.addEventListener("contextmenu", onCtx);
    doc.addEventListener("keydown", forward);
    doc.addEventListener("keyup", forward);
    return () => {
      doc.removeEventListener("click", onClick);
      doc.removeEventListener("dblclick", onDbl);
      doc.removeEventListener("contextmenu", onCtx);
      doc.removeEventListener("keydown", forward);
      doc.removeEventListener("keyup", forward);
    };
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
    const chosen = new Set(selectedIds ?? (selectedId ? [selectedId] : []));
    const measure = () => {
      const rects: Record<string, BlockRect> = {};
      for (const [el, id] of map) {
        const r = el.getBoundingClientRect();
        const prev = rects[id];
        const x = Math.min(prev ? prev.x : r.left, r.left);
        const y = Math.min(prev ? prev.y : r.top, r.top);
        const right = Math.max(prev ? prev.x + prev.w : r.right, r.right);
        const bottom = Math.max(prev ? prev.y + prev.h : r.bottom, r.bottom);
        rects[id] = { x, y, w: right - x, h: bottom - y };
      }
      // Content height, not documentElement.scrollHeight: that is never smaller than the iframe itself, so the
      // frame (sized from this value) could only ever grow after an edit and never shrink back.
      const cs = doc.defaultView?.getComputedStyle(doc.body);
      const margins = (parseFloat(cs?.marginTop ?? "0") || 0) + (parseFloat(cs?.marginBottom ?? "0") || 0);
      const contentH = doc.body.getBoundingClientRect().height + margins;
      layoutCb.current?.({ rects, width: doc.documentElement.scrollWidth, height: contentH });
    };
    for (const [el, id] of map) {
      el.setAttribute("data-block", id);
      if (chosen.has(id)) el.setAttribute("data-selected", "");
    }
    // The canvas frame is sized from this measurement, so never show the iframe's own scrollbars.
    if (bare) doc.documentElement.style.overflow = "hidden";
    measure();
    // Images (logos, banners) load after injection and change the layout: measure again once they settle.
    const imgs = Array.from(doc.images).filter((i) => !i.complete);
    const again = () => { fit(); measure(); };
    imgs.forEach((i) => { i.addEventListener("load", again); i.addEventListener("error", again); });
    return () => imgs.forEach((i) => { i.removeEventListener("load", again); i.removeEventListener("error", again); });
  }, [snapshot, dark, client, selectedId, selectedIds, loads]);

  const frameEl = (
    <iframe
      ref={frame}
      title="Signature preview"
      srcDoc={SHELL}
      sandbox="allow-same-origin"
      onLoad={() => setLoads((n) => n + 1)}
      style={{ width: CLIENTS[client].width ?? "100%", height }}
      className={bare ? "block max-w-full bg-white" : "mx-auto block max-w-full border-line bg-white sm:rounded-lg sm:border"}
    />
  );
  if (bare) return frameEl;
  return (
    // allow-same-origin lets the editor read the DOM for click mapping. Scripts stay disabled, so injected markup can never run code.
    <div>
    <ClientBadge client={client} />
    <div className="bg-surface-2 p-0 sm:p-4">
    {frameEl}
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
