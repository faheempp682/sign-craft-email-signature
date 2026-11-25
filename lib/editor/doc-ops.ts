import type { Block, BlockStyle, SignatureDoc } from "@/lib/schema/document";
import { createBlock, type BlockType } from "./blocks";

/** The editor's working state: the document (source of truth) plus a stable id per block (kept beside it, never saved). */
export type EditState = { doc: SignatureDoc; ids: string[] };

export const MAX_BLOCKS = 30;
let counter = 0;
export const newBlockId = () => `b${Date.now().toString(36)}${(counter++).toString(36)}`;

const withBlocks = (s: EditState, blocks: Block[], ids: string[]): EditState => ({ doc: { ...s.doc, blocks }, ids });
const isLocked = (s: EditState, i: number) => !!s.doc.blocks[i]?.locked;

export function patchBlock(s: EditState, i: number, patch: Record<string, unknown>): EditState {
  const b = s.doc.blocks[i];
  if (!b || (b.locked && !("locked" in patch))) return s;
  const next = { ...b, ...patch } as Record<string, unknown>;
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  return withBlocks(s, s.doc.blocks.map((x, j) => (j === i ? (next as Block) : x)), s.ids);
}

/** Merge into a block's style. `undefined` clears a property; a style with nothing left is removed entirely. */
export function patchStyle(s: EditState, i: number, patch: Partial<Record<keyof BlockStyle, unknown>>): EditState {
  const b = s.doc.blocks[i];
  if (!b || b.locked) return s;
  const style = { ...(b.style ?? {}), ...patch } as Record<string, unknown>;
  for (const k of Object.keys(style)) if (style[k] === undefined) delete style[k];
  return patchBlock(s, i, { style: Object.keys(style).length ? style : undefined });
}

export function insertBlock(s: EditState, type: BlockType | Block, at?: number, id = newBlockId()): EditState {
  if (s.ids.length >= MAX_BLOCKS) return s;
  const block = typeof type === "string" ? createBlock(type) : type;
  const index = at === undefined ? s.ids.length : Math.max(0, Math.min(at, s.ids.length));
  const blocks = [...s.doc.blocks];
  const ids = [...s.ids];
  blocks.splice(index, 0, block);
  ids.splice(index, 0, id);
  return withBlocks(s, blocks, ids);
}

export function duplicateBlock(s: EditState, i: number, id = newBlockId()): EditState {
  const b = s.doc.blocks[i];
  if (!b) return s;
  const copy = structuredClone(b) as Block;
  delete copy.locked;
  if (copy.layer) copy.layer = `${copy.layer} copy`.slice(0, 40);
  return insertBlock(s, copy, i + 1, id);
}

export function removeBlocks(s: EditState, indexes: number[]): EditState {
  const drop = new Set(indexes.filter((i) => !isLocked(s, i)));
  if (!drop.size) return s;
  return withBlocks(s, s.doc.blocks.filter((_, i) => !drop.has(i)), s.ids.filter((_, i) => !drop.has(i)));
}

export function moveBlock(s: EditState, from: number, to: number): EditState {
  if (from === to || from < 0 || to < 0 || from >= s.ids.length || to >= s.ids.length || isLocked(s, from)) return s;
  const blocks = [...s.doc.blocks];
  const ids = [...s.ids];
  blocks.splice(to, 0, blocks.splice(from, 1)[0]);
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  return withBlocks(s, blocks, ids);
}

export const renameLayer = (s: EditState, i: number, name: string) => patchBlock(s, i, { layer: name.trim().slice(0, 40) || undefined });
export const toggleHidden = (s: EditState, i: number) => patchBlock(s, i, { hidden: s.doc.blocks[i]?.hidden ? undefined : true });
export const toggleLocked = (s: EditState, i: number) => patchBlock(s, i, { locked: s.doc.blocks[i]?.locked ? undefined : true });

/** Clipboard payload for copy/paste: plain block JSON, so it is validated again on paste. */
export const copyBlocks = (s: EditState, indexes: number[]): Block[] =>
  [...indexes].sort((a, b) => a - b).map((i) => structuredClone(s.doc.blocks[i])).filter(Boolean);

export function pasteBlocks(s: EditState, blocks: Block[], after: number): EditState {
  let next = s;
  blocks.forEach((b, k) => {
    const copy = structuredClone(b) as Block;
    delete copy.locked;
    next = insertBlock(next, copy, after + 1 + k);
  });
  return next;
}
