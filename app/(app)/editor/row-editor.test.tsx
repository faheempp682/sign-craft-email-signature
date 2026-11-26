// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RowBlock } from "@/lib/schema/document";
import { SignatureDocSchema } from "@/lib/schema/document";
import { TEMPLATE_META } from "@/lib/templates";
import type { EditState } from "@/lib/editor/doc-ops";
import { addRow, sinkIntoColumn } from "@/lib/editor/row-ops";
import { RowEditor } from "./row-editor";

afterEach(cleanup);

let latest: EditState;
const start = (): EditState => {
  const doc = SignatureDocSchema.parse(TEMPLATE_META.find((t) => t.id === "classic")!.doc);
  return addRow({ doc, ids: doc.blocks.map((_, i) => `id${i}`) }, "50-50");
};

function Harness({ onSelect }: { onSelect?: (p: readonly number[]) => void }) {
  const [state, setState] = useState<EditState>(start);
  latest = state;
  const i = state.doc.blocks.length - 1;
  return <RowEditor row={state.doc.blocks[i] as RowBlock} rowPath={[i]} locked={false} update={(fn) => setState((s) => fn(s))} onSelectNested={onSelect ?? (() => {})} movable={state.doc.blocks.slice(0, i).map((b, k) => ({ index: k, label: `Top ${k} ${b.type}` }))} onSink={(k, dest) => setState((s) => sinkIntoColumn(s, k, dest))} />;
}
const row = () => latest.doc.blocks[latest.doc.blocks.length - 1] as RowBlock;
const addTo = (col: number, label: string) => {
  const select = screen.getByLabelText(`Add element to column ${col}`) as HTMLSelectElement;
  const option = within(select).getByRole("option", { name: label }) as HTMLOptionElement;
  fireEvent.change(select, { target: { value: option.value } });
};

describe("RowEditor", () => {
  it("shows the six presets and re-splits the row when one is picked", () => {
    render(<Harness />);
    const group = screen.getByRole("group", { name: "Row layout" });
    expect(within(group).getAllByRole("button")).toHaveLength(6);
    fireEvent.click(within(group).getByRole("button", { name: "4 equal" }));
    expect(row().columns.map((c) => c.width)).toEqual([25, 25, 25, 25]);
    fireEvent.click(within(group).getByRole("button", { name: "1 column" }));
    expect(row().columns).toHaveLength(1);
  });

  it("adds, duplicates, moves and deletes blocks inside a column", () => {
    render(<Harness />);
    addTo(1, "Text");
    addTo(1, "Divider");
    expect(row().columns[0].blocks.map((b) => b.type)).toEqual(["text", "divider"]);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Text" }));
    expect(row().columns[0].blocks.map((b) => b.type)).toEqual(["text", "text", "divider"]);
    fireEvent.click(screen.getAllByRole("button", { name: "Move Divider up" })[0]);
    expect(row().columns[0].blocks.map((b) => b.type)).toEqual(["text", "divider", "text"]);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete Divider" })[0]);
    expect(row().columns[0].blocks.map((b) => b.type)).toEqual(["text", "text"]);
    expect(SignatureDocSchema.safeParse(latest.doc).success).toBe(true);
  });

  it("selecting a nested block reports its path", () => {
    let picked: readonly number[] = [];
    render(<Harness onSelect={(p) => (picked = p)} />);
    addTo(2, "Button / CTA");
    fireEvent.click(screen.getByRole("button", { name: "Edit Button / CTA" }));
    expect(picked).toEqual([latest.doc.blocks.length - 1, 1, 0]);
  });

  it("edits row and column settings", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/Gap between columns/), { target: { value: "20" } });
    expect(row().gap).toBe(20);
    fireEvent.click(screen.getByRole("checkbox", { name: /Stack columns on phones/ }));
    expect(row().stack).toBe(false);
    const col1 = screen.getByRole("region", { name: "Column 1" });
    fireEvent.click(within(col1).getByRole("button", { name: "Center" }));
    expect(row().columns[0].align).toBe("center");
    fireEvent.change(within(col1).getByLabelText(/^Width/), { target: { value: "40" } });
    expect(row().columns[0].width).toBe(40);
    fireEvent.change(within(col1).getByLabelText(/^Padding top/), { target: { value: "8" } });
    expect(row().columns[0].paddingTop).toBe(8);
    expect(SignatureDocSchema.safeParse(latest.doc).success).toBe(true);
  });

  it("pulls an existing top-level block into a column", () => {
    render(<Harness />);
    const before = latest.doc.blocks.length;
    const select = screen.getByLabelText("Add element to column 2") as HTMLSelectElement;
    const opt = within(select).getByRole("option", { name: /^Top 0/ }) as HTMLOptionElement;
    fireEvent.change(select, { target: { value: opt.value } });
    expect(latest.doc.blocks).toHaveLength(before - 1);
    expect(row().columns[1].blocks).toHaveLength(1);
    expect(SignatureDocSchema.safeParse(latest.doc).success).toBe(true);
  });
});
