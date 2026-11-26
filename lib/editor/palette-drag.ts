/** Drag payload for the left "Add element" palette: `el:<ELEMENT_PRESETS id>` or `row:<ROW_PRESETS id>`. */
export const PALETTE_MIME = "application/x-signcraft-element";

export type PaletteDrop = {
  /** Top-level block under the pointer (null = empty canvas, which adds at the bottom). */
  id: string | null;
  /** When the pointer is over a block (or empty column placeholder) inside a row: [col, index, ...] from that row. */
  nested?: number[];
  /** Pointer in the lower half of the target, so the new block goes after it. */
  after: boolean;
};

export function parsePayload(raw: string): { kind: "el" | "row"; id: string } | null {
  const i = raw.indexOf(":");
  const kind = raw.slice(0, i);
  return i > 0 && (kind === "el" || kind === "row") ? { kind, id: raw.slice(i + 1) } : null;
}
