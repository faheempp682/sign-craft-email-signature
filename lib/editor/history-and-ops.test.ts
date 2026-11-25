import { describe, expect, it } from "vitest";
import { SignatureDocSchema } from "@/lib/schema/document";
import { TEMPLATE_META } from "@/lib/templates";
import { canRedo, canUndo, commit, createHistory, redo, undo } from "./history";
import { copyBlocks, duplicateBlock, insertBlock, moveBlock, pasteBlocks, patchStyle, removeBlocks, toggleHidden, toggleLocked, type EditState } from "./doc-ops";
import { renderToEmailHtml } from "@/lib/renderer/email-html";

const base = (): EditState => {
  const doc = SignatureDocSchema.parse(TEMPLATE_META.find((t) => t.id === "classic")!.doc);
  return { doc, ids: doc.blocks.map((_, i) => `id${i}`) };
};
const idx = (s: EditState, type: string) => s.doc.blocks.findIndex((b) => b.type === type);

describe("history", () => {
  it("undoes and redoes, and a new edit clears redo", () => {
    let h = createHistory(1);
    h = commit(h, 2, undefined, 0);
    h = commit(h, 3, undefined, 5000);
    expect(canUndo(h)).toBe(true);
    h = undo(undo(h));
    expect(h.present).toBe(1);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(2);
    h = commit(h, 9, undefined, 9000);
    expect(canRedo(h)).toBe(false);
    expect(undo(h).present).toBe(2);
  });
  it("coalesces rapid edits with the same key into one step", () => {
    let h = createHistory("a");
    h = commit(h, "b", "k", 0);
    h = commit(h, "c", "k", 100);
    h = commit(h, "d", "k", 200);
    expect(undo(h).present).toBe("a");
    h = commit(h, "e", "k", 5000);
    expect(undo(h).present).toBe("d");
  });
});

describe("doc ops", () => {
  it("styles a block, clears it again, and the document stays schema-valid", () => {
    let s = base();
    const i = idx(s, "identity");
    s = patchStyle(s, i, { color: "#FF0000", fontSize: 24 });
    expect(SignatureDocSchema.safeParse(s.doc).success).toBe(true);
    s = patchStyle(s, i, { color: undefined, fontSize: undefined });
    expect(s.doc.blocks[i].style).toBeUndefined();
  });
  it("duplicates, moves, removes and keeps ids aligned", () => {
    let s = base();
    const n = s.ids.length;
    s = duplicateBlock(s, 0, "dup");
    expect(s.doc.blocks).toHaveLength(n + 1);
    expect(s.ids[1]).toBe("dup");
    s = moveBlock(s, 1, 3);
    expect(s.ids[3]).toBe("dup");
    s = removeBlocks(s, [3]);
    expect(s.ids).not.toContain("dup");
    expect(s.ids).toHaveLength(n);
  });
  it("respects locks and the block limit", () => {
    let s = base();
    s = toggleLocked(s, 0);
    expect(removeBlocks(s, [0])).toBe(s);
    expect(patchStyle(s, 0, { color: "#000000" })).toBe(s);
    expect(moveBlock(s, 0, 1)).toBe(s);
    s = toggleLocked(s, 0);
    expect(s.doc.blocks[0].locked).toBeUndefined();
    let full = base();
    while (full.ids.length < 30) full = insertBlock(full, "text");
    expect(insertBlock(full, "text")).toBe(full);
  });
  it("copy/paste inserts valid unlocked copies after the target", () => {
    let s = toggleLocked(base(), 0);
    const clip = copyBlocks(s, [0]);
    s = pasteBlocks(s, clip, 0);
    expect(s.doc.blocks[1].type).toBe(s.doc.blocks[0].type);
    expect(s.doc.blocks[1].locked).toBeUndefined();
    expect(SignatureDocSchema.safeParse(s.doc).success).toBe(true);
  });
});

describe("block style export", () => {
  const html = (s: EditState) => renderToEmailHtml(SignatureDocSchema.parse(s.doc));
  it("hidden blocks are not exported", () => {
    const s = base();
    const i = idx(s, "identity");
    const name = (s.doc.blocks[i] as { name: string }).name.split(" ")[0];
    expect(html(s)).toContain(name);
    expect(html(toggleHidden(s, i))).not.toContain(name);
  });
  it("gradients export as a solid colour, never as CSS gradients, and stay email-safe", () => {
    let s = base();
    const i = idx(s, "identity");
    s = patchStyle(s, i, {
      gradient: { from: "#112233", to: "#445566", direction: "to-right", opacity: 1 },
      borderWidth: 2, borderColor: "#FF00FF", borderRadius: 8, paddingTop: 6, color: "#ABCDEF", fontSize: 26, underline: true, textTransform: "uppercase", marginBottom: 10,
    });
    const out = html(s);
    expect(out).toContain('bgcolor="#112233"');
    expect(out).toContain("color:#ABCDEF");
    expect(out).toContain("font-size:26px");
    for (const banned of [/gradient/i, /display:\s*flex/i, /display:\s*grid/i, /<svg/i, /<script/i, /data:image/i, /background-image/i]) expect(out).not.toMatch(banned);
  });
  it("new block types render email-safe tables", () => {
    let s = base();
    for (const t of ["text", "button", "spacer"] as const) s = insertBlock(s, t);
    const out = html(s);
    expect(out).toContain("Book a call");
    expect(out).not.toMatch(/display:\s*flex|<svg|<script/i);
  });
});
