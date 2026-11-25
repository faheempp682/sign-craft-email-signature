"use client";

import { useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Block } from "@/lib/schema/document";
import { BLOCK_LABEL, ELEMENT_PRESETS } from "@/lib/editor/blocks";

const btn = "grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30";

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

export function LayersPanel({ blocks, ids, selected, atLimit, onSelect, onReorder, onRename, onHide, onLock, onDuplicate, onDelete, onAdd }: {
  blocks: Block[]; ids: string[]; selected: string[]; atLimit: boolean;
  onSelect: (id: string, shift: boolean) => void; onReorder: (from: number, to: number) => void; onRename: (i: number, name: string) => void;
  onHide: (i: number) => void; onLock: (i: number) => void; onDuplicate: (i: number) => void; onDelete: (i: number) => void; onAdd: (presetId: string) => void;
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
          {ELEMENT_PRESETS.map((p) => (
            <button key={p.id} type="button" disabled={atLimit} onClick={() => onAdd(p.id)} className="rounded-lg border border-line px-2 py-3 text-sm font-medium transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-40">
              {p.label}
            </button>
          ))}
          {atLimit && <p className="col-span-2 text-xs text-muted">A signature can hold 30 elements.</p>}
        </div>
      )}
    </div>
  );
}
