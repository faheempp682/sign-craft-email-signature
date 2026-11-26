"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { Block } from "@/lib/schema/document";
import { CLIENTS, type ClientId } from "@/lib/preview-clients";
import { pickFieldKey } from "@/lib/editor/preview-map";
import { PALETTE_MIME, type PaletteDrop } from "@/lib/editor/palette-drag";
import { LivePreview, type BlockRect, type Layout, type PickHint, type Snapshot } from "./live-preview";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;
export type CanvasBg = "dots" | "white" | "checker" | "gray";

const FRAME_PAD = 48; // workspace padding around the signature, in canvas pixels
const SNAP = 4; // px within which alignment guides appear

/** The field a double-click edits in place. */
function inlineKey(b: Block, hint: PickHint | null): string | undefined {
  switch (b.type) {
    case "identity": return hint ? pickFieldKey(b, hint.text, hint.offset) : "name";
    case "text": return "text";
    case "button": return "label";
    case "disclaimer": return "text";
    case "contact": return (hint ? pickFieldKey(b, hint.text, hint.offset) : undefined) ?? (["phone", "email", "website", "address"] as const).find((k) => b[k]);
    default: return undefined;
  }
}

type Drag =
  | { kind: "move"; id: string; from: number; startY: number; moved: boolean; to: number }
  | { kind: "resize"; id: string; handle: "se" | "e" | "s"; startX: number; startY: number; w0: number; h0: number };

export function DesignCanvas({
  snapshot, ids, blocks, selected, client, dark, zoom, bg, onPick, onZoom, onResize, onMove, onInlineEdit, onContext, editRequest, onPaletteDrop, paletteDragging = false,
}: {
  /** Right-click: block id (or null for empty canvas) and the position in page pixels. */
  onContext: (id: string | null, pageX: number, pageY: number) => void;
  /** Ask the canvas to start in-place text editing for a block (used by the context menu and mobile bar). */
  editRequest?: { id: string; n: number } | null;
  /** An element from the "Add element" palette was dropped on the canvas (target describes where). */
  onPaletteDrop?: (payload: string, target: PaletteDrop) => void;
  /** True while a palette element is mid-drag: the selection overlay lets drops through to the preview underneath. */
  paletteDragging?: boolean;
  snapshot: Snapshot; ids: string[]; blocks: Block[]; selected: string[]; client: ClientId; dark: boolean; zoom: number; bg: CanvasBg;
  onPick: (id: string | null, shift: boolean, hint: PickHint | null) => void;
  onZoom: (z: number) => void;
  onResize: (id: string, patch: Record<string, unknown>) => void;
  onMove: (from: number, to: number) => void;
  onInlineEdit: (id: string, key: string, value: string) => void;
}) {
  const [layout, setLayout] = useState<Layout>({ rects: {}, width: 0, height: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [edit, setEdit] = useState<{ id: string; key: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const panning = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const spaceDown = useRef(false);

  const onLayout = useCallback((l: Layout) => setLayout((prev) => (prev.height === l.height && prev.width === l.width && JSON.stringify(prev.rects) === JSON.stringify(l.rects) ? prev : l)), []);

  const width = CLIENTS[client].width ?? 640;
  const height = Math.max(160, Math.ceil(layout.height) + 4);
  const rectOf = (id: string): BlockRect | undefined => layout.rects[id];
  const indexOf = (id: string) => ids.indexOf(id);

  /* ---------- zoom (ctrl/cmd + wheel) and pan (space/middle drag) ---------- */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      onZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)).toFixed(2))));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    const kd = (e: KeyboardEvent) => { if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) { spaceDown.current = true; } };
    const ku = (e: KeyboardEvent) => { if (e.code === "Space") spaceDown.current = false; };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => { el.removeEventListener("wheel", wheel); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, [zoom, onZoom]);

  const startPan = (e: RPointerEvent) => {
    if (e.button !== 1 && !(spaceDown.current && e.button === 0)) return false;
    const el = scroller.current!;
    panning.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    return true;
  };
  const movePan = (e: RPointerEvent) => {
    const p = panning.current;
    if (!p) return false;
    scroller.current!.scrollLeft = p.sl - (e.clientX - p.x);
    scroller.current!.scrollTop = p.st - (e.clientY - p.y);
    return true;
  };

  /* ---------- pointer coordinates in signature pixels ---------- */
  const toCanvas = (clientX: number, clientY: number) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom };
  };

  /** Insert position among rendered blocks for a pointer y, returned as a document index. */
  const targetIndex = (draggedId: string, y: number) => {
    const others = ids.filter((id) => id !== draggedId && layout.rects[id]);
    const before = others.find((id) => { const r = layout.rects[id]; return y < r.y + r.h / 2; });
    const from = indexOf(draggedId);
    if (!before) return ids.length - 1;
    const bi = indexOf(before);
    return bi > from ? bi - 1 : bi;
  };

  const onBodyDown = (e: RPointerEvent, id: string) => {
    if (startPan(e)) return;
    if (e.button !== 0) return;
    const b = blocks[indexOf(id)];
    if (!b || b.locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: "move", id, from: indexOf(id), startY: e.clientY, moved: false, to: indexOf(id) });
  };
  const onHandleDown = (e: RPointerEvent, id: string, handle: "se" | "e" | "s") => {
    e.stopPropagation();
    const b = blocks[indexOf(id)];
    if (!b || b.locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const w0 = b.type === "avatar" ? b.size : b.type === "banner" ? b.width : 0;
    const h0 = b.type === "avatar" ? b.size : b.type === "banner" ? b.height : 0;
    setDrag({ kind: "resize", id, handle, startX: e.clientX, startY: e.clientY, w0, h0 });
  };
  const onMovePointer = (e: RPointerEvent) => {
    if (movePan(e) || !drag) return;
    if (drag.kind === "move") {
      const moved = drag.moved || Math.abs(e.clientY - drag.startY) > 4;
      if (!moved) return;
      setDrag({ ...drag, moved, to: targetIndex(drag.id, toCanvas(e.clientX, e.clientY).y) });
    } else {
      const b = blocks[indexOf(drag.id)];
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      if (b?.type === "avatar") {
        const d = drag.handle === "s" ? dy : drag.handle === "e" ? dx : Math.max(dx, dy);
        onResize(drag.id, { size: Math.round(Math.min(200, Math.max(32, drag.w0 + d))) });
      } else if (b?.type === "banner") {
        const ratio = drag.w0 / drag.h0;
        const free = e.shiftKey;
        let w = drag.handle === "s" ? drag.w0 : drag.w0 + dx;
        let h = drag.handle === "e" ? drag.h0 : drag.h0 + dy;
        if (!free && drag.handle === "se") h = w / ratio;
        if (!free && drag.handle === "e") h = w / ratio;
        if (!free && drag.handle === "s") w = h * ratio;
        w = Math.min(600, Math.max(100, w));
        h = Math.min(300, Math.max(20, h));
        onResize(drag.id, { width: Math.round(w), height: Math.round(h) });
      }
    }
  };
  const onUp = () => {
    panning.current = null;
    if (drag?.kind === "move" && drag.moved && drag.to !== drag.from) onMove(drag.from, drag.to);
    setDrag(null);
  };

  /* ---------- inline text editing ---------- */
  const beginEdit = (id: string, hint: PickHint | null) => {
    const b = blocks[indexOf(id)];
    if (!b || b.locked) return;
    const key = inlineKey(b, hint);
    if (key) setEdit({ id, key });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (editRequest) beginEdit(editRequest.id, null); }, [editRequest?.n]);
  const editBlock = edit ? blocks[indexOf(edit.id)] : undefined;
  const editRect = edit ? rectOf(edit.id) : undefined;
  const editValue = editBlock ? String((editBlock as Record<string, unknown>)[edit!.key] ?? "") : "";
  const commitEdit = (value: string) => {
    if (edit && editBlock && value !== editValue) {
      const required = (edit.key === "name" && editBlock.type === "identity") || (edit.key === "label" && editBlock.type === "button");
      if (!(required && !value.trim())) onInlineEdit(edit.id, edit.key, value);
    }
    setEdit(null);
  };

  /* ---------- guides and spacing ---------- */
  const single = selected.length === 1 ? selected[0] : null;
  const sel = single ? rectOf(single) : undefined;
  const sorted = ids.filter((id) => layout.rects[id]).sort((a, b) => layout.rects[a].y - layout.rects[b].y);
  const si = single ? sorted.indexOf(single) : -1;
  const gapAbove = sel && si > 0 ? Math.round(sel.y - (layout.rects[sorted[si - 1]].y + layout.rects[sorted[si - 1]].h)) : null;
  const gapBelow = sel && si >= 0 && si < sorted.length - 1 ? Math.round(layout.rects[sorted[si + 1]].y - (sel.y + sel.h)) : null;
  const guides: number[] = [];
  if (single && sel) {
    for (const id of sorted) {
      if (id === single) continue;
      const r = layout.rects[id];
      for (const x of [r.x, r.x + r.w]) {
        if ([sel.x, sel.x + sel.w].some((sx) => Math.abs(sx - x) <= SNAP / 4 + 0.5) && !guides.includes(Math.round(x))) guides.push(Math.round(x));
      }
    }
  }
  let insertY: number | null = null;
  if (drag?.kind === "move" && drag.moved) {
    const others = ids.filter((id) => id !== drag.id && layout.rects[id]);
    const bi = others.findIndex((id) => indexOf(id) >= (drag.to > drag.from ? drag.to + 1 : drag.to));
    insertY = bi < 0 ? (others.length ? layout.rects[others[others.length - 1]].y + layout.rects[others[others.length - 1]].h : 0) : layout.rects[others[bi]].y;
  }

  const surround =
    bg === "checker"
      ? { backgroundColor: "#ffffff", backgroundImage: "linear-gradient(45deg,#e5e7eb 25%,transparent 25%,transparent 75%,#e5e7eb 75%),linear-gradient(45deg,#e5e7eb 25%,transparent 25%,transparent 75%,#e5e7eb 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0,8px 8px" }
      : bg === "dots"
        ? { backgroundColor: "#f4f5f7", backgroundImage: "radial-gradient(#cbd0d8 1.2px, transparent 1.2px)", backgroundSize: "22px 22px" }
        : { backgroundColor: bg === "white" ? "#ffffff" : "#eef0f3" };

  return (
    <div
      ref={scroller}
      data-testid="design-canvas"
      className="relative h-full overflow-auto"
      style={surround}
      onPointerDown={(e) => { if (startPan(e)) return; }}
      onContextMenu={(e) => { if ((e.target as HTMLElement).dataset.canvasBg !== undefined || e.target === e.currentTarget) { e.preventDefault(); onContext(null, e.clientX, e.clientY); } }}
      onClick={(e) => { if ((e.target as HTMLElement).dataset.canvasBg !== undefined || e.target === e.currentTarget) onPick(null, false, null); }}
      onDragOver={(e) => { if (onPaletteDrop && e.dataTransfer.types.includes(PALETTE_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDrop={(e) => {
        const payload = e.dataTransfer.getData(PALETTE_MIME);
        if (!onPaletteDrop || !payload) return;
        e.preventDefault();
        onPaletteDrop(payload, { id: null, after: true }); // dropped beside the signature: add at the bottom
      }}
      onPointerMove={onMovePointer}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div data-canvas-bg="" className="flex justify-center" style={{ width: "max-content", minWidth: "100%", height: (height + FRAME_PAD * 2) * zoom + 96, paddingTop: FRAME_PAD * zoom, paddingBottom: 96 }}>
        <div style={{ width: width * zoom, height: height * zoom, flex: "none" }}>
        <div ref={stage} style={{ width, height, transform: `scale(${zoom})`, transformOrigin: "0 0", position: "relative", boxShadow: "0 0 0 1px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08)" }}>
          <LivePreview
            bare
            snapshot={snapshot}
            dark={dark}
            client={client}
            selectedId={null}
            selectedIds={selected}
            height={height}
            onLayout={onLayout}
            onContextMenu={(id, x, y) => { const r = stage.current!.getBoundingClientRect(); onContext(id, r.left + x * zoom, r.top + y * zoom); }}
            onPick={(id, hint) => onPick(id, !!hint?.shift, hint)}
            onPaletteDrop={onPaletteDrop}
            onDoubleClick={(id, hint) => { onPick(id, false, hint); beginEdit(id, hint); }}
          />
          <div className="absolute inset-0" style={{ pointerEvents: "none" }} aria-hidden="true">
            {drag && guides.map((x) => <div key={`g${x}`} className="absolute top-0 bottom-0 border-l border-dashed border-pink-500" style={{ left: x }} data-testid="guide" />)}
            {insertY !== null && <div className="absolute left-0 right-0 h-0.5 bg-accent" style={{ top: insertY - 1 }} data-testid="insert-line" />}
            {selected.map((id) => {
              const r = rectOf(id);
              const b = blocks[indexOf(id)];
              if (!r || !b) return null;
              const resizable = single === id && !b.locked && (b.type === "avatar" || b.type === "banner");
              const moving = drag?.kind === "move" && drag.moved && drag.id === id;
              return (
                <div
                  key={id}
                  data-testid="selection"
                  data-selection={id}
                  className="absolute"
                  style={{ left: r.x - 1, top: r.y - 1, width: r.w + 2, height: r.h + 2, outline: `2px solid ${b.locked ? "#9ca3af" : "#4f46e5"}`, pointerEvents: b.locked || paletteDragging ? "none" : "auto", cursor: moving ? "grabbing" : "grab", opacity: moving ? 0.6 : 1, touchAction: "none" }}
                  onPointerDown={(e) => onBodyDown(e, id)}
                  onDoubleClick={() => beginEdit(id, null)}
                  onContextMenu={(e) => { e.preventDefault(); onContext(id, e.clientX, e.clientY); }}
                >
                  {resizable && (["se", "e", "s"] as const).map((h) => (
                    <span
                      key={h}
                      role="slider"
                      aria-label={`Resize ${h === "se" ? "corner" : h === "e" ? "width" : "height"}`}
                      aria-valuenow={h === "s" ? Math.round(r.h) : Math.round(r.w)}
                      data-handle={h}
                      onPointerDown={(e) => onHandleDown(e, id, h)}
                      className="absolute h-3 w-3 rounded-sm border-2 border-accent bg-white"
                      style={{ pointerEvents: "auto", touchAction: "none", cursor: h === "se" ? "nwse-resize" : h === "e" ? "ew-resize" : "ns-resize", ...(h === "se" ? { right: -7, bottom: -7 } : h === "e" ? { right: -7, top: "50%", marginTop: -6 } : { bottom: -7, left: "50%", marginLeft: -6 }) }}
                    />
                  ))}
                </div>
              );
            })}
            {sel && !drag && (
              <>
                {gapAbove !== null && gapAbove > 0 && <SpaceTag x={sel.x + sel.w / 2} y={sel.y - gapAbove / 2} v={gapAbove} />}
                {gapBelow !== null && gapBelow > 0 && <SpaceTag x={sel.x + sel.w / 2} y={sel.y + sel.h + gapBelow / 2} v={gapBelow} />}
                <div className="absolute rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ left: sel.x, top: Math.max(0, sel.y - 22) }} data-testid="size-tag">
                  {Math.round(sel.w)} × {Math.round(sel.h)}
                </div>
              </>
            )}
          </div>
          {edit && editRect && (
            <textarea
              autoFocus
              aria-label={`Edit ${edit.key}`}
              data-testid="inline-editor"
              defaultValue={editValue}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commitEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEdit(null);
                else if (e.key === "Enter" && !(e.shiftKey || (edit.key === "text" && editBlock?.type !== "button"))) { e.preventDefault(); e.currentTarget.blur(); }
              }}
              className="absolute z-10 resize-none rounded border-2 border-accent bg-white p-1 text-sm text-black shadow-lg"
              style={{ left: editRect.x - 2, top: editRect.y - 2, width: Math.max(editRect.w + 4, 140), height: Math.max(editRect.h + 4, 32) }}
            />
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

function SpaceTag({ x, y, v }: { x: number; y: number; v: number }) {
  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-pink-500 px-1 text-[10px] font-medium text-white" style={{ left: x, top: y }} data-testid="gap-tag">
      {v}
    </div>
  );
}
