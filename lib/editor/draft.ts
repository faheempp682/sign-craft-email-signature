import { MAX_COLUMNS, MAX_COLUMN_BLOCKS, MAX_ROW_DEPTH, TEMPLATE_IDS, ThemeSchema, type SignatureDoc } from "@/lib/schema/document";
import { BLOCK_TYPES } from "./blocks";

/** Bump the suffix if the stored shape ever changes incompatibly. */
export const DRAFT_KEY = "signcraft:draft:v1";

export type Draft = { savedAt: number; doc: SignatureDoc };
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage can throw (private mode, blocked site data), so every access is guarded. */
export function getStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * A draft may be saved mid-edit with invalid field values (so a refresh restores exactly what the user typed),
 * so this checks structure only. Full validation still gates rendering and export.
 */
export function isDraftDoc(x: unknown): x is SignatureDoc {
  if (!x || typeof x !== "object") return false;
  const d = x as Record<string, unknown>;
  if (d.version !== 1) return false;
  if (typeof d.template_id !== "string" || !(TEMPLATE_IDS as readonly string[]).includes(d.template_id)) return false;
  if (!ThemeSchema.safeParse(d.theme).success) return false;
  if (!Array.isArray(d.blocks) || d.blocks.length > 30) return false;
  return d.blocks.every((b) => isDraftBlock(b, 1));
}

/** One block by structure. Rows are checked down through their columns (up to the schema's nesting limit). */
function isDraftBlock(b: unknown, depth: number): boolean {
  if (!b || typeof b !== "object") return false;
  const type = (b as { type?: string }).type ?? "";
  if (type === "row") {
    const columns = (b as { columns?: unknown }).columns;
    if (depth > MAX_ROW_DEPTH || !Array.isArray(columns) || columns.length === 0 || columns.length > MAX_COLUMNS) return false;
    return columns.every((c) => {
      const blocks = c && typeof c === "object" ? (c as { blocks?: unknown }).blocks : undefined;
      return Array.isArray(blocks) && blocks.length <= MAX_COLUMN_BLOCKS && blocks.every((x) => isDraftBlock(x, depth + 1));
    });
  }
  return (BLOCK_TYPES as readonly string[]).includes(type);
}

export function saveDraft(storage: StorageLike, doc: SignatureDoc, now = Date.now()): boolean {
  try {
    const draft: Draft = { savedAt: now, doc };
    storage.setItem(DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(storage: StorageLike): Draft | null {
  try {
    const raw = storage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { savedAt, doc } = parsed as { savedAt?: unknown; doc?: unknown };
    if (typeof savedAt !== "number" || !isDraftDoc(doc)) return null;
    return { savedAt, doc };
  } catch {
    return null;
  }
}

export function clearDraft(storage: StorageLike): void {
  try {
    storage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing useful to do */
  }
}
