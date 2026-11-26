import type { Block, Column, RowBlock } from "@/lib/schema/document";
import { MAX_COLUMN_BLOCKS, MAX_ROW_DEPTH, MAX_TOTAL_NODES, measureBlocks } from "@/lib/schema/document";
import { createBlock, type BlockType } from "./blocks";
import { MAX_BLOCKS, newBlockId, type EditState } from "./doc-ops";

/**
 * Nested editing for rows & columns. Purely additive: top-level operations in doc-ops.ts are untouched.
 *
 * Addressing is by PATH, so the editor state (doc + one id per top-level block) does not change shape:
 *   BlockPath  [i]                  top-level block i
 *              [i, col, k]          block k in column `col` of the row at top-level i
 *              [i, col, k, col2, k2] ... deeper rows
 *   ColumnPath [i, col]             column `col` of the row at top-level i  (even length)
 * A BlockPath always has odd length, a ColumnPath always even length.
 */
export type BlockPath = readonly number[];
export type ColumnPath = readonly number[];

export type RowPreset = { id: string; label: string; widths: number[] };

/** The six row layouts offered by "Add row". Widths are whole percents summing to 100 (schema allows 5-100). */
export const ROW_PRESETS: readonly RowPreset[] = [
  { id: "1", label: "1 column", widths: [100] },
  { id: "50-50", label: "50 / 50", widths: [50, 50] },
  { id: "33-66", label: "33 / 66", widths: [33, 67] },
  { id: "66-33", label: "66 / 33", widths: [67, 33] },
  { id: "3", label: "3 equal", widths: [33, 33, 34] },
  { id: "4", label: "4 equal", widths: [25, 25, 25, 25] },
];

export function createRow(presetId: string): RowBlock {
  const p = ROW_PRESETS.find((x) => x.id === presetId) ?? ROW_PRESETS[1];
  return {
    type: "row",
    columns: p.widths.map((width) => ({ width, blocks: [] })),
    gap: p.widths.length > 1 ? 12 : 0,
    stack: true,
    layer: "Row",
  };
}

/** Re-split a row into another preset, keeping existing blocks (extra columns fold into the last one). */
export function applyPreset(row: RowBlock, presetId: string): RowBlock {
  const p = ROW_PRESETS.find((x) => x.id === presetId);
  if (!p) return row;
  const columns: Column[] = p.widths.map((width, i) => ({ ...(row.columns[i] ?? {}), width, blocks: [...(row.columns[i]?.blocks ?? [])] }));
  const last = columns.length - 1;
  for (const extra of row.columns.slice(columns.length)) columns[last].blocks.push(...extra.blocks);
  return { ...row, columns, gap: p.widths.length > 1 ? (row.gap ?? 12) : 0 };
}

/* ---------- path plumbing ---------- */

const isRow = (b: Block | undefined): b is RowBlock => b?.type === "row";

export function getBlock(blocks: readonly Block[], path: BlockPath): Block | undefined {
  let b: Block | undefined = blocks[path[0]];
  for (let d = 1; d < path.length; d += 2) {
    if (!isRow(b)) return undefined;
    b = b.columns[path[d]]?.blocks[path[d + 1]];
  }
  return b;
}

/** Replace the column at `colPath` (immutably). Returns the original array when the path does not resolve. */
function mapColumn(blocks: Block[], colPath: ColumnPath, fn: (c: Column) => Column): Block[] {
  const [i, col, ...rest] = colPath;
  const row = blocks[i];
  if (!isRow(row) || !row.columns[col]) return blocks;
  const target = row.columns[col];
  const nextCol = rest.length ? { ...target, blocks: mapColumn(target.blocks, rest, fn) } : fn(target);
  if (nextCol === target || (rest.length && nextCol.blocks === target.blocks)) return blocks;
  return blocks.map((b, j) => (j === i ? ({ ...row, columns: row.columns.map((c, k) => (k === col ? nextCol : c)) } as RowBlock) : b));
}

const parentOf = (path: BlockPath): ColumnPath => path.slice(0, -1);
const indexIn = (path: BlockPath): number => path[path.length - 1];

function withinLimits(blocks: Block[]): boolean {
  const m = measureBlocks(blocks);
  return m.depth <= MAX_ROW_DEPTH && m.nodes <= MAX_TOTAL_NODES;
}

/* ---------- pure operations on a block tree (return the same array when nothing could change) ---------- */

export function patchAt(blocks: Block[], path: BlockPath, patch: Record<string, unknown>): Block[] {
  if (path.length === 1) {
    const b = blocks[path[0]];
    if (!b) return blocks;
    return blocks.map((x, j) => (j === path[0] ? clean({ ...b, ...patch }) : x));
  }
  const k = indexIn(path);
  return mapColumn(blocks, parentOf(path), (c) => {
    const b = c.blocks[k];
    return b ? { ...c, blocks: c.blocks.map((x, j) => (j === k ? clean({ ...b, ...patch }) : x)) } : c;
  });
}

function clean(b: Record<string, unknown>): Block {
  for (const key of Object.keys(b)) if (b[key] === undefined) delete b[key];
  return b as Block;
}

/** Merge into a column's settings (width, valign, align, bg, padding). `undefined` clears a property. */
export function patchColumn(blocks: Block[], colPath: ColumnPath, patch: Partial<Omit<Column, "blocks">>): Block[] {
  return mapColumn(blocks, colPath, (c) => {
    const next = { ...c, ...patch } as Record<string, unknown>;
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    return next as unknown as Column;
  });
}

export function insertAt(blocks: Block[], colPath: ColumnPath, block: Block, at?: number): Block[] {
  const out = mapColumn(blocks, colPath, (c) => {
    if (c.blocks.length >= MAX_COLUMN_BLOCKS) return c;
    const i = at === undefined ? c.blocks.length : Math.max(0, Math.min(at, c.blocks.length));
    const list = [...c.blocks];
    list.splice(i, 0, block);
    return { ...c, blocks: list };
  });
  return out !== blocks && withinLimits(out) ? out : blocks;
}

export function removeAt(blocks: Block[], path: BlockPath): Block[] {
  if (path.length === 1) return blocks.filter((_, j) => j !== path[0]);
  const k = indexIn(path);
  return mapColumn(blocks, parentOf(path), (c) => (c.blocks[k] ? { ...c, blocks: c.blocks.filter((_, j) => j !== k) } : c));
}

export function duplicateAt(blocks: Block[], path: BlockPath): Block[] {
  const b = getBlock(blocks, path);
  if (!b || path.length < 3) return blocks;
  const copy = structuredClone(b) as Block;
  delete copy.locked;
  if (copy.layer) copy.layer = `${copy.layer} copy`.slice(0, 40);
  return insertAt(blocks, parentOf(path), copy, indexIn(path) + 1);
}

/** Reorder inside one column. `to` is the final index. */
export function reorderAt(blocks: Block[], path: BlockPath, to: number): Block[] {
  const from = indexIn(path);
  return mapColumn(blocks, parentOf(path), (c) => {
    if (from === to || from < 0 || to < 0 || from >= c.blocks.length || to >= c.blocks.length) return c;
    const list = [...c.blocks];
    list.splice(to, 0, list.splice(from, 1)[0]);
    return { ...c, blocks: list };
  });
}

const startsWith = (a: readonly number[], prefix: readonly number[]) => prefix.length <= a.length && prefix.every((v, i) => a[i] === v);
const sameList = (a: ColumnPath, b: ColumnPath) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Move a block that lives in a column (path length >= 3) to another column (or the same one) at index `to`.
 * Refused when the destination is inside the block being moved.
 */
export function moveToColumn(blocks: Block[], path: BlockPath, dest: ColumnPath, to: number): Block[] {
  const b = getBlock(blocks, path);
  if (!b || startsWith(dest, path)) return blocks;
  if (sameList(parentOf(path), dest)) {
    const col = getBlock(blocks, [...dest.slice(0, -1)]) as RowBlock | undefined;
    const len = col?.columns[dest[dest.length - 1]]?.blocks.length ?? 0;
    return reorderAt(blocks, path, Math.max(0, Math.min(to, len - 1)));
  }
  const inserted = insertAt(blocks, dest, structuredClone(b) as Block, to);
  if (inserted === blocks) return blocks;
  return removeAt(inserted, path);
}

/* ---------- EditState wrappers (top-level ids stay beside the document and never change shape) ---------- */

const topLocked = (s: EditState, path: BlockPath) => !!s.doc.blocks[path[0]]?.locked;
const withDoc = (s: EditState, blocks: Block[], ids = s.ids): EditState => (blocks === s.doc.blocks ? s : { doc: { ...s.doc, blocks }, ids });

export const patchNested = (s: EditState, path: BlockPath, patch: Record<string, unknown>) => (topLocked(s, path) ? s : withDoc(s, patchAt(s.doc.blocks, path, patch)));
export const patchNestedColumn = (s: EditState, colPath: ColumnPath, patch: Partial<Omit<Column, "blocks">>) => (topLocked(s, colPath) ? s : withDoc(s, patchColumn(s.doc.blocks, colPath, patch)));
/** Merge into a nested block's style (any depth). `undefined` clears a property; an empty style is removed. */
export function patchNestedStyle(s: EditState, path: BlockPath, patch: Record<string, unknown>): EditState {
  const b = getBlock(s.doc.blocks, path);
  if (!b || topLocked(s, path)) return s;
  const style = { ...(b.style ?? {}), ...patch } as Record<string, unknown>;
  for (const k of Object.keys(style)) if (style[k] === undefined) delete style[k];
  return withDoc(s, patchAt(s.doc.blocks, path, { style: Object.keys(style).length ? style : undefined }));
}
export const patchRow = (s: EditState, rowPath: BlockPath, patch: Record<string, unknown>) => patchNested(s, rowPath, patch);

export function insertNested(s: EditState, colPath: ColumnPath, type: BlockType | Block, at?: number): EditState {
  if (topLocked(s, colPath)) return s;
  const block = typeof type === "string" ? createBlock(type) : type;
  return withDoc(s, insertAt(s.doc.blocks, colPath, block, at));
}

export const removeNested = (s: EditState, path: BlockPath) => (path.length < 3 || topLocked(s, path) ? s : withDoc(s, removeAt(s.doc.blocks, path)));
export const duplicateNested = (s: EditState, path: BlockPath) => (topLocked(s, path) ? s : withDoc(s, duplicateAt(s.doc.blocks, path)));
export const moveNested = (s: EditState, path: BlockPath, dest: ColumnPath, to: number) =>
  path.length < 3 || topLocked(s, path) || topLocked(s, dest) ? s : withDoc(s, moveToColumn(s.doc.blocks, path, dest, to));

/** Add a whole row from a preset at the top level (same cap as any other top-level block). */
export function addRow(s: EditState, presetId: string, at?: number, id = newBlockId()): EditState {
  if (s.ids.length >= MAX_BLOCKS) return s;
  const index = at === undefined ? s.ids.length : Math.max(0, Math.min(at, s.ids.length));
  const blocks = [...s.doc.blocks];
  const ids = [...s.ids];
  blocks.splice(index, 0, createRow(presetId));
  ids.splice(index, 0, id);
  return { doc: { ...s.doc, blocks }, ids };
}

/** Change a row's layout preset in place (blocks are kept). Works for top-level and nested rows. */
export function setRowPreset(s: EditState, rowPath: BlockPath, presetId: string): EditState {
  const row = getBlock(s.doc.blocks, rowPath);
  if (!isRow(row) || topLocked(s, rowPath)) return s;
  const next = applyPreset(row, presetId);
  return next === row ? s : withDoc(s, patchAt(s.doc.blocks, rowPath, next as unknown as Record<string, unknown>));
}

/** Pull a block out of a column and put it at the top level at `to` (gets a fresh stable id). */
export function liftToTop(s: EditState, path: BlockPath, to?: number, id = newBlockId()): EditState {
  const b = getBlock(s.doc.blocks, path);
  if (!b || path.length < 3 || topLocked(s, path) || s.ids.length >= MAX_BLOCKS) return s;
  const blocks = removeAt(s.doc.blocks, path);
  const ids = [...s.ids];
  const index = to === undefined ? blocks.length : Math.max(0, Math.min(to, blocks.length));
  const list = [...blocks];
  list.splice(index, 0, structuredClone(b) as Block);
  ids.splice(index, 0, id);
  return { doc: { ...s.doc, blocks: list }, ids };
}

/** Drop a top-level block into a column (the drag-from-canvas case). Rows can nest up to MAX_ROW_DEPTH. */
export function sinkIntoColumn(s: EditState, topIndex: number, dest: ColumnPath, to?: number): EditState {
  const b = s.doc.blocks[topIndex];
  if (!b || b.locked || topLocked(s, dest) || dest[0] === topIndex) return s;
  const inserted = insertAt(s.doc.blocks, dest, structuredClone(b) as Block, to);
  if (inserted === s.doc.blocks) return s;
  return { doc: { ...s.doc, blocks: inserted.filter((_, j) => j !== topIndex) }, ids: s.ids.filter((_, j) => j !== topIndex) };
}

/* ---------- editor preview only ---------- */

const PLACEHOLDER: Block = {
  type: "text",
  text: "Empty column. Add an element in the panel on the right.",
  variant: "body",
  layer: "Empty column",
  style: { color: "#6B7280", fontSize: 12, align: "center", bg: "#F3F4F6", borderColor: "#9CA3AF", borderWidth: 1, paddingTop: 14, paddingBottom: 14, paddingLeft: 10, paddingRight: 10 },
};

function fillEmpty(blocks: Block[]): Block[] {
  let changed = false;
  const out = blocks.map((b) => {
    if (b.type !== "row" || b.hidden) return b;
    const columns = b.columns.map((c) => {
      const next = c.blocks.length ? fillEmpty(c.blocks) : [PLACEHOLDER];
      if (next === c.blocks) return c;
      changed = true;
      return { ...c, blocks: next };
    });
    return columns.some((c, i) => c !== b.columns[i]) ? { ...b, columns } : b;
  });
  return changed ? out : blocks;
}

/**
 * For the editor canvas ONLY: an empty column exports nothing, which would make a freshly added row invisible, so the
 * preview shows a dashed placeholder instead. Never used for export, saving or linting. Returns `doc` itself when no
 * column is empty, so documents without empty rows preview byte-identically.
 */
export function withEmptyColumnPlaceholders<T extends { blocks: Block[] }>(doc: T): T {
  const blocks = fillEmpty(doc.blocks);
  return blocks === doc.blocks ? doc : { ...doc, blocks };
}
