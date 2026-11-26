"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Block, Column, RowBlock } from "@/lib/schema/document";
import { MAX_COLUMN_BLOCKS } from "@/lib/schema/document";
import { BLOCK_LABEL, ELEMENT_PRESETS } from "@/lib/editor/blocks";
import type { EditState } from "@/lib/editor/doc-ops";
import {
  ROW_PRESETS, createRow, duplicateNested, insertNested, moveNested, patchNested, patchNestedColumn, removeNested, setRowPreset,
  type BlockPath, type ColumnPath,
} from "@/lib/editor/row-ops";
import { PALETTE_MIME } from "@/lib/editor/palette-drag";
import { Color, Num } from "./design-inspector";
import { Select } from "@/components/ui/select";

type Update = (fn: (s: EditState) => EditState, key?: string) => void;

const lab = "text-xs font-medium text-muted";
const seg = (on: boolean) =>
  `grid h-9 min-w-9 place-items-center rounded-lg border px-2 text-sm font-medium transition-colors ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-surface-2 hover:text-ink"}`;
const mini = "grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30";

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

/** A tiny picture of a preset: one bar per column, sized by its width. */
function PresetGlyph({ widths }: { widths: number[] }) {
  return (
    <span className="flex h-4 w-full gap-0.5" aria-hidden="true">
      {widths.map((w, i) => (
        <span key={i} className="rounded-sm bg-current opacity-60" style={{ width: `${w}%` }} />
      ))}
    </span>
  );
}

/** Row layout picker used both for "Add row" and for changing an existing row's layout. */
export function PresetPicker({ current, onPick, label = "Row layout", onDragState }: { current?: number[]; onPick: (presetId: string) => void; label?: string; /** Makes each layout draggable onto the canvas; called with true on drag start, false on end. */ onDragState?: (on: boolean) => void }) {
  const same = (w: number[]) => current && current.length === w.length && current.every((v, i) => v === w[i]);
  return (
    <div role="group" aria-label={label} className="grid grid-cols-3 gap-2">
      {ROW_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={!!same(p.widths)}
          title={onDragState ? `${p.label} (click to add, or drag onto the canvas)` : p.label}
          aria-label={p.label}
          draggable={!!onDragState}
          onDragStart={(e) => { if (!onDragState) return; e.dataTransfer.setData(PALETTE_MIME, `row:${p.id}`); e.dataTransfer.effectAllowed = "copy"; onDragState(true); }}
          onDragEnd={() => onDragState?.(false)}
          onClick={() => onPick(p.id)} className={`flex flex-col items-stretch gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-medium ${same(p.widths) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-accent hover:text-ink"}`}>
          <PresetGlyph widths={p.widths} />
          {p.label}
        </button>
      ))}
    </div>
  );
}

const key = (path: readonly number[]) => path.join(".");

function Item({ id, path, colPath, index, block, locked, last, onSelect, onDuplicate, onDelete, onNudge }: {
  id: string; path: BlockPath; colPath: ColumnPath; index: number; block: Block; locked: boolean; last: boolean;
  onSelect: () => void; onDuplicate: () => void; onDelete: () => void; onNudge: (dir: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: locked, data: { path, colPath, index } });
  const name = block.layer || BLOCK_LABEL[block.type];
  return (
    <li
      ref={setNodeRef}
      data-nested-block={key(path)}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined, position: "relative" }}
      className={`flex items-center gap-0.5 rounded-lg border border-line bg-card pr-1 ${isDragging ? "shadow-lg" : ""} ${block.hidden ? "opacity-50" : ""}`}
    >
      <button ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={locked} aria-label={`Drag ${name}`} className={`${mini} cursor-grab touch-none`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" /></svg>
      </button>
      <button type="button" className="min-w-0 flex-1 py-1 text-left" onClick={onSelect} aria-label={`Edit ${name}`}>
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block truncate text-[11px] text-muted">{summary(block) || BLOCK_LABEL[block.type]}</span>
      </button>
      <button type="button" className={mini} disabled={locked || index === 0} aria-label={`Move ${name} up`} onClick={() => onNudge(-1)}>↑</button>
      <button type="button" className={mini} disabled={locked || last} aria-label={`Move ${name} down`} onClick={() => onNudge(1)}>↓</button>
      <button type="button" className={mini} disabled={locked} aria-label={`Duplicate ${name}`} onClick={onDuplicate}>⧉</button>
      <button type="button" className={mini} disabled={locked} aria-label={`Delete ${name}`} onClick={onDelete}>✕</button>
    </li>
  );
}

function ColumnDrop({ colPath, empty, children }: { colPath: ColumnPath; empty: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${key(colPath)}`, data: { colPath, empty } });
  return (
    <div ref={setNodeRef} className={`rounded-lg ${isOver && empty ? "bg-accent-soft" : ""}`}>
      {children}
    </div>
  );
}

/**
 * Edits one row (top-level or nested): layout preset, gap, stacking, per-column settings and the blocks inside each
 * column (reorder, move between columns by drag or arrows, duplicate, delete, add). All edits go through row-ops.
 */
export function RowEditor({ row, rowPath, locked, update, onSelectNested, movable = [], onSink, activeColumn, onActivateColumn }: {
  row: RowBlock; rowPath: BlockPath; locked: boolean; update: Update; onSelectNested: (path: BlockPath) => void;
  /** Top-level blocks that can be pulled into a column (the row itself and locked blocks are left out by the caller). */
  movable?: { index: number; label: string }[];
  onSink?: (topIndex: number, dest: ColumnPath) => void;
  /** The column that "Add element" currently adds into (shown with a ring), and how to make another column the target. */
  activeColumn?: ColumnPath | null;
  onActivateColumn?: (colPath: ColumnPath) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const tag = key(rowPath);
  const widths = row.columns.map((c) => c.width);
  const sized = row.columns.reduce((n, c) => n + (c.width ?? 0), 0);
  const layoutWidths = row.columns.map((c) => c.width ?? 0);

  const colPathOf = (col: number): ColumnPath => [...rowPath, col];

  const onDragEnd = (e: DragEndEvent) => {
    const from = e.active.data.current as { path: BlockPath } | undefined;
    const over = e.over?.data.current as { colPath: ColumnPath; empty?: boolean; index?: number } | undefined;
    if (!from || !over || !e.over || e.active.id === e.over.id) return;
    const dest = over.colPath;
    const to = over.empty ? Number.MAX_SAFE_INTEGER : over.index ?? 0;
    update((s) => moveNested(s, from.path, dest, to));
  };

  const add = (col: number, presetId: string) => {
    if (presetId.startsWith("move:")) return onSink?.(Number(presetId.slice(5)), colPathOf(col));
    if (presetId.startsWith("row:")) return update((s) => insertNested(s, colPathOf(col), createRow(presetId.slice(4))));
    const preset = ELEMENT_PRESETS.find((p) => p.id === presetId);
    if (preset) update((s) => insertNested(s, colPathOf(col), preset.make()));
  };

  const setCol = (col: number, patch: Partial<Omit<Column, "blocks">>) => update((s) => patchNestedColumn(s, colPathOf(col), patch), `col:${tag}:${col}:${Object.keys(patch).join(",")}`);

  return (
    <fieldset disabled={locked} className="min-w-0 space-y-4" data-testid="row-editor">
      <div className="space-y-2">
        <span className={lab}>Layout</span>
        <PresetPicker current={layoutWidths.every(Boolean) ? layoutWidths : undefined} onPick={(id) => update((s) => setRowPreset(s, rowPath, id))} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Num label="Gap between columns" value={row.gap} max={48} onChange={(v) => update((s) => patchNested(s, rowPath, { gap: v }), `rowgap:${tag}`)} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={row.stack !== false} onChange={(e) => update((s) => patchNested(s, rowPath, { stack: e.target.checked ? undefined : false }))} />
        <span>
          Stack columns on phones
          <span className="block text-[11px] text-muted">Outlook desktop and clients that ignore media queries keep columns side by side.</span>
        </span>
      </label>
      {widths.some((w) => w !== undefined) && sized > 100 && <p className="text-[11px] text-amber-700 dark:text-amber-400" role="status">Column widths add up to {sized}%. Keep them at 100% or less.</p>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        {row.columns.map((c, ci) => {
          const colPath = colPathOf(ci);
          const full = c.blocks.length >= MAX_COLUMN_BLOCKS;
          const ids = c.blocks.map((_, k) => `${key(colPath)}:${k}`);
          return (
            <section
              key={ci}
              aria-label={`Column ${ci + 1}`}
              data-column={key(colPath)}
              data-active={activeColumn && key(activeColumn) === key(colPath) ? "true" : undefined}
              onClickCapture={() => onActivateColumn?.(colPath)}
              onFocusCapture={() => onActivateColumn?.(colPath)}
              className={`space-y-3 rounded-xl border p-3 ${activeColumn && key(activeColumn) === key(colPath) ? "border-accent ring-2 ring-accent" : "border-line"}`}
            >
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Column {ci + 1}
                {activeColumn && key(activeColumn) === key(colPath) && <span className="ml-2 normal-case text-accent">adding here</span>}
              </h4>
              <ColumnDrop colPath={colPath} empty={!c.blocks.length}>
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                  <ul className="space-y-1" aria-label={`Blocks in column ${ci + 1}`}>
                    {c.blocks.map((b, k) => (
                      <Item
                        key={ids[k]}
                        id={ids[k]}
                        path={[...colPath, k]}
                        colPath={colPath}
                        index={k}
                        block={b}
                        locked={!!b.locked}
                        last={k === c.blocks.length - 1}
                        onSelect={() => onSelectNested([...colPath, k])}
                        onDuplicate={() => update((s) => duplicateNested(s, [...colPath, k]))}
                        onDelete={() => update((s) => removeNested(s, [...colPath, k]))}
                        onNudge={(dir) => update((s) => moveNested(s, [...colPath, k], colPath, k + dir))}
                      />
                    ))}
                  </ul>
                </SortableContext>
                {!c.blocks.length && <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-muted">Empty column. Add an element below or drag one here. Empty rows are not exported.</p>}
              </ColumnDrop>
              <label className="flex flex-col gap-1">
                <span className="sr-only">Add element to column {ci + 1}</span>
                <Select className="field h-9 px-2 text-sm" value="" disabled={full} aria-label={`Add element to column ${ci + 1}`} onChange={(e) => { if (e.target.value) add(ci, e.target.value); e.target.value = ""; }}>
                  <option value="">{full ? `Column is full (${MAX_COLUMN_BLOCKS})` : "+ Add element…"}</option>
                  <optgroup label="Elements">
                    {ELEMENT_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </optgroup>
                  {onSink && movable.length > 0 && (
                    <optgroup label="Move existing block here">
                      {movable.map((m) => (
                        <option key={m.index} value={`move:${m.index}`}>{m.label}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Nested row">
                    {ROW_PRESETS.map((p) => (
                      <option key={p.id} value={`row:${p.id}`}>Row · {p.label}</option>
                    ))}
                  </optgroup>
                </Select>
              </label>

              <details className="group">
                <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">Column settings</summary>
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Num label="Width" suffix="%" min={5} max={100} value={c.width} onChange={(v) => setCol(ci, { width: v })} />
                    <label className="flex flex-col gap-1">
                      <span className={lab}>Vertical align</span>
                      <Select className="field h-9 px-2 text-sm" value={c.valign ?? "top"} onChange={(e) => setCol(ci, { valign: e.target.value === "top" ? undefined : (e.target.value as Column["valign"]) })}>
                        <option value="top">Top</option>
                        <option value="middle">Middle</option>
                        <option value="bottom">Bottom</option>
                      </Select>
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-1" role="group" aria-label={`Column ${ci + 1} text alignment`}>
                    {(["left", "center", "right"] as const).map((a) => (
                      <button key={a} type="button" aria-pressed={c.align === a} className={seg(c.align === a)} onClick={() => setCol(ci, { align: c.align === a ? undefined : a })}>
                        {a[0].toUpperCase() + a.slice(1)}
                      </button>
                    ))}
                  </div>
                  <Color label="Background" value={c.bg} fallback="#FFFFFF" onChange={(v) => setCol(ci, { bg: v })} />
                  <div className="grid grid-cols-2 gap-3">
                    <Num label="Padding top" max={60} value={c.paddingTop} onChange={(v) => setCol(ci, { paddingTop: v })} />
                    <Num label="Padding right" max={60} value={c.paddingRight} onChange={(v) => setCol(ci, { paddingRight: v })} />
                    <Num label="Padding bottom" max={60} value={c.paddingBottom} onChange={(v) => setCol(ci, { paddingBottom: v })} />
                    <Num label="Padding left" max={60} value={c.paddingLeft} onChange={(v) => setCol(ci, { paddingLeft: v })} />
                  </div>
                </div>
              </details>
            </section>
          );
        })}
      </DndContext>
    </fieldset>
  );
}
