// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SignatureDocSchema } from "@/lib/schema/document";
import { TEMPLATE_META } from "@/lib/templates";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import type { EditState } from "./doc-ops";
import { addRow, createRow, insertNested } from "./row-ops";
import { mapBlockElements, mapNestedElements } from "./preview-map";

const text = (t: string) => ({ type: "text" as const, text: t, variant: "body" as const });

function setup() {
  const doc0 = SignatureDocSchema.parse(TEMPLATE_META.find((t) => t.id === "classic")!.doc);
  let s: EditState = addRow({ doc: doc0, ids: doc0.blocks.map((_, i) => `id${i}`) }, "50-50", undefined, "row1");
  const i = s.ids.length - 1;
  s = insertNested(s, [i, 0], text("alpha"));
  s = insertNested(s, [i, 0], text("beta"));
  s = insertNested(s, [i, 1], text("gamma"));
  s = insertNested(s, [i, 1], createRow("50-50"));
  s = insertNested(s, [i, 1, 1, 0], text("deep"));
  const parsed = SignatureDocSchema.parse(s.doc);
  const root = document.createElement("div");
  root.innerHTML = renderToEmailHtml(parsed);
  document.body.appendChild(root);
  const top = mapBlockElements(root, parsed, s.ids);
  return { root, parsed, s, top, i };
}

describe("mapNestedElements", () => {
  it("maps blocks inside columns (and rows in rows) to their path from the row", () => {
    const { root, parsed, s, top } = setup();
    const nested = mapNestedElements(root, parsed, s.ids, top);
    const paths = new Map([...nested].map(([el, p]) => [p.join("."), el.textContent]));
    expect(paths.get("0.0")).toContain("alpha");
    expect(paths.get("0.1")).toContain("beta");
    expect(paths.get("1.0")).toContain("gamma");
    expect(paths.get("1.1")).toBeDefined(); // the nested row
    expect(paths.get("1.1.0.0")).toContain("deep");
  });
  it("leaves documents without rows alone", () => {
    const doc = SignatureDocSchema.parse(TEMPLATE_META.find((t) => t.id === "classic")!.doc);
    const root = document.createElement("div");
    root.innerHTML = renderToEmailHtml(doc);
    const ids = doc.blocks.map((_, i) => `id${i}`);
    expect(mapNestedElements(root, doc, ids, mapBlockElements(root, doc, ids)).size).toBe(0);
  });
});
