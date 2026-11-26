import { describe, expect, it } from "vitest";
import { SignatureDocSchema, type Block, type RowBlock } from "@/lib/schema/document";
import { TEMPLATE_META } from "@/lib/templates";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import type { EditState } from "./doc-ops";
import {
  ROW_PRESETS, addRow, applyPreset, createRow, duplicateNested, getBlock, insertNested, liftToTop, moveNested, patchNested,
  patchNestedColumn, patchRow, removeNested, setRowPreset, sinkIntoColumn,
} from "./row-ops";

const base = (): EditState => {
  const doc = SignatureDocSchema.parse(TEMPLATE_META.find((t) => t.id === "classic")!.doc);
  return { doc, ids: doc.blocks.map((_, i) => `id${i}`) };
};
const text = (t: string): Block => ({ type: "text", text: t, variant: "body" });
const rowAt = (s: EditState, i: number) => s.doc.blocks[i] as RowBlock;
const texts = (s: EditState, i: number, col: number) => rowAt(s, i).columns[col].blocks.map((b) => (b.type === "text" ? b.text : b.type));
const valid = (s: EditState) => expect(SignatureDocSchema.safeParse(s.doc).success).toBe(true);

/** A state whose last block is a 2-column row holding a/b in column 0 and c in column 1. */
const withRow = (): { s: EditState; i: number } => {
  let s = addRow(base(), "50-50");
  const i = s.ids.length - 1;
  s = insertNested(s, [i, 0], text("a"));
  s = insertNested(s, [i, 0], text("b"));
  s = insertNested(s, [i, 1], text("c"));
  return { s, i };
};

describe("row presets", () => {
  it("offers the six layouts, each summing to 100% within schema limits", () => {
    expect(ROW_PRESETS.map((p) => p.id)).toEqual(["1", "50-50", "33-66", "66-33", "3", "4"]);
    for (const p of ROW_PRESETS) {
      expect(p.widths.reduce((a, b) => a + b, 0)).toBe(100);
      expect(createRow(p.id).columns).toHaveLength(p.widths.length);
    }
  });
  it("addRow creates a schema-valid row with a fresh top-level id", () => {
    const s0 = base();
    const s = addRow(s0, "3", undefined, "newid");
    expect(s.ids).toEqual([...s0.ids, "newid"]);
    expect(rowAt(s, s.ids.length - 1).columns.map((c) => c.width)).toEqual([33, 33, 34]);
    valid(s);
  });
  it("changing preset keeps blocks; fewer columns fold the extras into the last one", () => {
    const { s, i } = withRow();
    const one = setRowPreset(s, [i], "1");
    expect(texts(one, i, 0)).toEqual(["a", "b", "c"]);
    const four = applyPreset(rowAt(one, i), "4");
    expect(four.columns).toHaveLength(4);
    expect(four.columns[0].blocks).toHaveLength(3);
    valid(one);
  });
});

describe("nested ops", () => {
  it("inserts into a column and getBlock addresses it by path", () => {
    const { s, i } = withRow();
    expect(texts(s, i, 0)).toEqual(["a", "b"]);
    expect(getBlock(s.doc.blocks, [i, 1, 0])).toMatchObject({ text: "c" });
    expect(getBlock(s.doc.blocks, [i, 5, 0])).toBeUndefined();
    valid(s);
  });
  it("inserts at an index and any existing leaf block type works", () => {
    const { s, i } = withRow();
    const t = insertNested(insertNested(s, [i, 0], "button", 1), [i, 0], "social", 0);
    expect(texts(t, i, 0)).toEqual(["social", "a", "button", "b"]);
    valid(t);
  });
  it("edits a nested block and a column, leaving other blocks untouched", () => {
    const { s, i } = withRow();
    const e = patchNested(s, [i, 0, 1], { text: "B2" });
    expect(texts(e, i, 0)).toEqual(["a", "B2"]);
    expect(e.doc.blocks.slice(0, i)).toEqual(s.doc.blocks.slice(0, i));
    const c = patchNestedColumn(e, [i, 1], { bg: "#EEEEEE", valign: "middle", paddingTop: 8 });
    expect(rowAt(c, i).columns[1]).toMatchObject({ bg: "#EEEEEE", valign: "middle", paddingTop: 8 });
    expect(rowAt(patchNestedColumn(c, [i, 1], { bg: undefined }), i).columns[1].bg).toBeUndefined();
    const r = patchRow(c, [i], { gap: 20, stack: false });
    expect(rowAt(r, i)).toMatchObject({ gap: 20, stack: false });
    valid(r);
  });
  it("duplicates right after the original and removes only that block", () => {
    const { s, i } = withRow();
    const d = duplicateNested(s, [i, 0, 0]);
    expect(texts(d, i, 0)).toEqual(["a", "a", "b"]);
    const r = removeNested(d, [i, 0, 0]);
    expect(texts(r, i, 0)).toEqual(["a", "b"]);
    expect(removeNested(s, [i]).doc).toBe(s.doc); // top-level removal stays in doc-ops
    valid(r);
  });
  it("reorders inside a column and moves between columns", () => {
    const { s, i } = withRow();
    expect(texts(moveNested(s, [i, 0, 0], [i, 0], 1), i, 0)).toEqual(["b", "a"]);
    const m = moveNested(s, [i, 0, 0], [i, 1], 0);
    expect(texts(m, i, 0)).toEqual(["b"]);
    expect(texts(m, i, 1)).toEqual(["a", "c"]);
    valid(m);
  });
  it("lifts a block to the top level and sinks a top-level block into a column", () => {
    const { s, i } = withRow();
    const n = s.ids.length;
    const l = liftToTop(s, [i, 0, 0], 0, "lifted");
    expect(l.ids).toHaveLength(n + 1);
    expect(l.ids[0]).toBe("lifted");
    expect(l.doc.blocks[0]).toMatchObject({ text: "a" });
    const row = l.ids.length - 1;
    expect(texts(l, row, 0)).toEqual(["b"]);
    const k = sinkIntoColumn(l, 0, [row, 1]);
    expect(k.ids).toHaveLength(n);
    expect(texts(k, row - 1, 1)).toEqual(["c", "a"]);
    valid(l);
    valid(k);
  });
  it("nests a row in a column but refuses to go deeper than the limit or into itself", () => {
    const { s, i } = withRow();
    const n1 = insertNested(s, [i, 0], createRow("50-50"));
    expect(getBlock(n1.doc.blocks, [i, 0, 2])?.type).toBe("row");
    const n2 = insertNested(n1, [i, 0, 2, 0], createRow("50-50"));
    expect(getBlock(n2.doc.blocks, [i, 0, 2, 0, 0])?.type).toBe("row");
    valid(n2);
    const n3 = insertNested(n2, [i, 0, 2, 0, 0, 0], createRow("50-50")); // depth 4 > MAX_ROW_DEPTH
    expect(n3).toBe(n2);
    expect(moveNested(n1, [i, 0, 2], [i, 0, 2, 0], 0)).toBe(n1); // into its own child
  });
  it("respects locked rows and the 12-blocks-per-column cap", () => {
    const { s, i } = withRow();
    const locked = { doc: { ...s.doc, blocks: s.doc.blocks.map((b, j) => (j === i ? { ...b, locked: true } : b)) }, ids: s.ids } as EditState;
    expect(insertNested(locked, [i, 0], text("x"))).toBe(locked);
    expect(patchNested(locked, [i, 0, 0], { text: "x" })).toBe(locked);
    let full = s;
    for (let k = 0; k < 20; k++) full = insertNested(full, [i, 1], text(`t${k}`));
    expect(rowAt(full, i).columns[1].blocks).toHaveLength(12);
  });
});

describe("existing signatures are unchanged", () => {
  it("rendering a document without rows is identical to before (no row code is involved)", () => {
    const s = base();
    const before = renderToEmailHtml(s.doc);
    // Adding then deleting a row at the top level leaves the output byte-identical.
    const round = addRow(s, "50-50");
    const back = { doc: { ...round.doc, blocks: round.doc.blocks.slice(0, -1) }, ids: round.ids.slice(0, -1) };
    expect(renderToEmailHtml(back.doc)).toBe(before);
    // An empty row exports nothing.
    expect(renderToEmailHtml(round.doc)).toBe(before);
  });
});

describe("empty row preview", () => {
  it("shows a placeholder only in the editor preview; export stays empty and untouched documents are returned as-is", async () => {
    const { withEmptyColumnPlaceholders } = await import("./row-ops");
    const s0 = base();
    expect(withEmptyColumnPlaceholders(s0.doc)).toBe(s0.doc);
    const s = addRow(s0, "50-50");
    const exported = renderToEmailHtml(s.doc);
    const preview = renderToEmailHtml(withEmptyColumnPlaceholders(s.doc));
    expect(exported).toBe(renderToEmailHtml(s0.doc)); // export: empty row outputs nothing
    expect(preview).not.toBe(exported);
    expect(preview.match(/Empty column/g)).toHaveLength(2);
    expect(rowAt(s, s.ids.length - 1).columns[0].blocks).toHaveLength(0); // the real document is not modified
  });
});
