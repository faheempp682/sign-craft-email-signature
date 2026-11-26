"use client";

import { useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Block } from "@/lib/schema/document";
import { BLOCK_LABEL, ELEMENT_PRESETS } from "@/lib/editor/blocks";
import { PALETTE_MIME } from "@/lib/editor/palette-drag";
import { PresetPicker } from "./row-editor";

const btn = "grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30";

/** Line icons for the "Add element" tiles (24px grid, stroked). */
const ELEMENT_ICON_PATHS: Record<string, string> = {
  text: "M4 7V5h16v2M12 5v14M9 19h6",
  heading: "M6 4v16M18 4v16M6 12h12",
  logo: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM3 16l5-5 4 4 3-3 6 6M9 8h.01",
  profile: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  contact: "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM9 8.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM5.5 16.5a3.5 3.5 0 0 1 7 0M14.5 10h4M14.5 14h4",
  phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z",
  email: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM22 7l-8.97 5.7a2 2 0 0 1-2.06 0L2 7",
  website: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10Z",
  social: "M18 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM18 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
  divider: "M3 12h18M7 7h.01M12 7h.01M17 7h.01M7 17h.01M12 17h.01M17 17h.01",
  banner: "M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2ZM2 15l5-4 4 3 4-3 7 5",
  button: "M7 8h10a4 4 0 0 1 0 8H7a4 4 0 0 1 0-8ZM9 12h6",
  icontext: "M6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 10h9M12 14h6",
  spacing: "M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4",
  disclaimer: "M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5l8-3ZM9 12l2 2 4-4",
};

function ElementIcon({ id }: { id: string }) {
  const d = ELEMENT_ICON_PATHS[id];
  if (!d) return null;
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-muted transition-colors group-hover:text-accent">
      <path d={d} />
    </svg>
  );
}

function summary(b: Block): string {
  switch (b.type) {
    case "identity": return b.name;
    case "text": return b.text;
    case "button": return b.label;
    case "disclaimer": return b.text;
    case "contact": return [b.phone, b.email, b.website, b.address].filter(Boolean).join(" · ");
    case "avatar": return b.alt || `${b.size}px ${b.shape}`;
    case "banner": return `${b.width}×${b.height}`;
    case "social": return `${b.links.length} link${b.links.length === 1 ? "" : "s"}`;
    case "spacer": return `${b.height}px`;
    case "icontext": return b.text;
    case "row": return `${b.columns.length} column${b.columns.length === 1 ? "" : "s"}`;
    default: return "";
  }
}

function Row({ id, block, selected, onSelect, onRename, onHide, onLock, onDuplicate, onDelete }: {
  id: string; block: Block; selected: boolean;
  onSelect: (shift: boolean) => void; onRename: (name: string) => void; onHide: () => void; onLock: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !!block.locked });
  const [editing, setEditing] = useState(false);
  const name = block.layer || BLOCK_LABEL[block.type];
  return (
    <li
      ref={setNodeRef}
      data-layer={id}
      aria-current={selected ? "true" : undefined}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined, position: "relative" }}
      className={`group flex items-center gap-0.5 rounded-lg border pr-1 ${selected ? "border-accent bg-accent-soft" : "border-transparent hover:bg-surface-2"} ${block.hidden ? "opacity-50" : ""} ${isDragging ? "shadow-lg" : ""}`}
    >
      <button ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag to reorder ${name}`} disabled={!!block.locked} className={`${btn} cursor-grab touch-none`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" /></svg>
      </button>
      {editing ? (
        <input
          autoFocus
          aria-label="Layer name"
          className="field h-8 min-w-0 flex-1 px-2 text-sm"
          defaultValue={block.layer ?? ""}
          placeholder={BLOCK_LABEL[block.type]}
          maxLength={40}
          onBlur={(e) => { setEditing(false); onRename(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <button type="button" className="min-w-0 flex-1 py-1 text-left" onClick={(e) => onSelect(e.shiftKey || e.metaKey || e.ctrlKey)} onDoubleClick={() => setEditing(true)} title="Double-click to rename">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-[11px] text-muted">{summary(block) || BLOCK_LABEL[block.type]}</span>
        </button>
      )}
      <button type="button" className={btn} aria-label={`${block.hidden ? "Show" : "Hide"} ${name}`} aria-pressed={!!block.hidden} onClick={onHide}>
        {block.hidden ? "◌" : "◉"}
      </button>
      <button type="button" className={btn} aria-label={`${block.locked ? "Unlock" : "Lock"} ${name}`} aria-pressed={!!block.locked} onClick={onLock}>
        {block.locked ? "🔒" : "🔓"}
      </button>
      <button type="button" className={`${btn} hidden group-hover:grid group-focus-within:grid`} aria-label={`Duplicate ${name}`} onClick={onDuplicate}>⧉</button>
      <button type="button" className={`${btn} hidden group-hover:grid group-focus-within:grid`} aria-label={`Delete ${name}`} disabled={!!block.locked} onClick={onDelete}>✕</button>
    </li>
  );
}

export function LayersPanel({ blocks, ids, selected, atLimit, onSelect, onReorder, onRename, onHide, onLock, onDuplicate, onDelete, onAdd, onAddRow, addTarget, onClearTarget, onPaletteDrag }: {
  blocks: Block[]; ids: string[]; selected: string[]; atLimit: boolean;
  onSelect: (id: string, shift: boolean) => void; onReorder: (from: number, to: number) => void; onRename: (i: number, name: string) => void;
  onHide: (i: number) => void; onLock: (i: number) => void; onDuplicate: (i: number) => void; onDelete: (i: number) => void; onAdd: (presetId: string) => void; onAddRow?: (presetId: string) => void;
  /** Set while a row column is the active target, e.g. "Row 3, column 2". */
  addTarget?: string | null; onClearTarget?: () => void;
  /** Called with true while an element from "Add element" is being dragged toward the canvas. */
  onPaletteDrag?: (on: boolean) => void;
}) {
  const [tab, setTab] = useState<"layers" | "elements">("layers");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    onReorder(ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
  };
  return (
    <div className="flex min-h-0 flex-col">
      <div role="tablist" aria-label="Left panel" className="flex border-b border-line">
        {(["layers", "elements"] as const).map((t) => (
          <button key={t} role="tab" id={`left-tab-${t}`} aria-selected={tab === t} aria-controls={`left-pane-${t}`} onClick={() => setTab(t)} className={`flex-1 px-3 py-2.5 text-sm font-medium ${tab === t ? "border-b-2 border-accent text-accent" : "text-muted hover:text-ink"}`}>
            {t === "layers" ? "Layers" : "Add element"}
          </button>
        ))}
      </div>
      {tab === "layers" ? (
        <div id="left-pane-layers" role="tabpanel" aria-labelledby="left-tab-layers" className="min-h-0 flex-1 overflow-y-auto p-2">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ul className="space-y-0.5" aria-label="Signature layers, top to bottom">
                {blocks.map((b, i) => (
                  <Row
                    key={ids[i]}
                    id={ids[i]}
                    block={b}
                    selected={selected.includes(ids[i])}
                    onSelect={(shift) => onSelect(ids[i], shift)}
                    onRename={(n) => onRename(i, n)}
                    onHide={() => onHide(i)}
                    onLock={() => onLock(i)}
                    onDuplicate={() => onDuplicate(i)}
                    onDelete={() => onDelete(i)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          {!blocks.length && <p className="p-3 text-sm text-muted">No layers yet. Use Add element.</p>}
        </div>
      ) : (
        <div id="left-pane-elements" role="tabpanel" aria-labelledby="left-tab-elements" className="grid grid-cols-2 gap-2 overflow-y-auto p-3">
          {addTarget && (
            <div className="col-span-2 flex items-center justify-between gap-2 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent" role="status">
              <span>Adding into {addTarget}</span>
              <button type="button" className="font-medium underline underline-offset-2" onClick={onClearTarget}>Add to the bottom instead</button>
            </div>
          )}
          {onAddRow && (
            <div className="col-span-2 space-y-2 border-b border-line pb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Rows &amp; columns</p>
              {atLimit ? <p className="text-xs text-muted">A signature can hold 30 elements.</p> : <PresetPicker label="Add a row" onPick={onAddRow} onDragState={onPaletteDrag} />}
            </div>
          )}
          {ELEMENT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={atLimit}
              draggable={!atLimit && !!onPaletteDrag}
              title="Click to add, or drag onto the canvas"
              onDragStart={(e) => { e.dataTransfer.setData(PALETTE_MIME, `el:${p.id}`); e.dataTransfer.effectAllowed = "copy"; onPaletteDrag?.(true); }}
              onDragEnd={() => onPaletteDrag?.(false)}
              onClick={() => onAdd(p.id)} className="group relative flex cursor-grab flex-col items-center justify-center gap-2 rounded-lg border border-line px-2 py-3 text-sm font-medium transition-all hover:-translate-y-0.5 hover:border-accent hover:bg-accent-soft hover:text-accent hover:shadow-md active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              <span className="pointer-events-none absolute right-1.5 top-1.5 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" title="Drag onto the canvas">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" /></svg>
              </span>
              <ElementIcon id={p.id} />
              <span className="text-center leading-tight">{p.label}</span>
            </button>
          ))}
          {atLimit && <p className="col-span-2 text-xs text-muted">A signature can hold 30 elements.</p>}
        </div>
      )}
    </div>
  );
}
