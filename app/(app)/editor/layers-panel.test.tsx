// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignatureDocSchema } from "@/lib/schema/document";
import { TEMPLATE_META } from "@/lib/templates";
import { LayersPanel, type NestedLayers } from "./layers-panel";

afterEach(cleanup);

const line = (icon: string, text: string) => ({ type: "icontext", icon, text, size: 16 });
const doc = SignatureDocSchema.parse({
  ...TEMPLATE_META.find((t) => t.id === "classic")!.doc,
  blocks: [
    { type: "row", columns: [{ blocks: [{ type: "avatar", src: "https://placehold.co/160x160.png", size: 96 }] }, { blocks: [{ type: "identity", name: "Tuider Es Jossen", title: "Team leader" }, { type: "social", links: [{ network: "instagram", url: "https://www.instagram.com/" }] }] }, { blocks: [line("mail", "email@example.com"), line("clock", "Mon-Fri 9-5"), { ...line("phone", "+123456789"), hidden: true }] }] },
    { type: "divider" },
  ],
});
const ids = ["row1", "div1"];

function setup(nested?: Partial<NestedLayers>) {
  const calls: NestedLayers = { selected: null, onSelect: vi.fn(), onRename: vi.fn(), onHide: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn(), ...nested };
  const onSelect = vi.fn();
  render(
    <LayersPanel blocks={doc.blocks} ids={ids} selected={[]} atLimit={false} onSelect={onSelect} onReorder={() => {}} onRename={() => {}} onHide={() => {}} onLock={() => {}} onDuplicate={() => {}} onDelete={() => {}} onAdd={() => {}} nested={nested === undefined ? undefined : calls} />,
  );
  return { calls, onSelect };
}

describe("layers panel: what is inside a row (AI designs)", () => {
  it("shows only the row, as before, when no nested handlers are given", () => {
    setup();
    expect(screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-layer"))).toHaveLength(2);
    expect(screen.queryByText("Column 1")).toBeNull();
    expect(screen.queryByText("Email")).toBeNull();
  });

  it("lists every column and the element in it, named by what it is", () => {
    setup({});
    for (const t of ["Column 1", "Column 2", "Column 3", "Photo / logo", "Name & title", "Social links", "Email", "Opening hours", "Phone"]) expect(screen.getAllByText(t).length, t).toBeGreaterThan(0);
    expect(screen.getByText("Tuider Es Jossen")).toBeTruthy();
    expect(screen.getByText("email@example.com")).toBeTruthy();
    // the nested items are not top-level layers: they carry no data-layer
    expect(screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-layer"))).toHaveLength(2);
  });

  it("selecting an item reports its row and the path from it, and marks the selected one", () => {
    const { calls } = setup({ selected: { id: "row1", rest: [2, 1] } });
    fireEvent.click(screen.getByText("email@example.com"));
    expect(calls.onSelect).toHaveBeenCalledWith(0, [2, 0]);
    const current = screen.getAllByRole("listitem").filter((li) => li.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(within(current[0]).getByText("Opening hours")).toBeTruthy();
  });

  it("hide, duplicate and delete act on that element's path; a hidden one shows as hidden", () => {
    const { calls } = setup({});
    fireEvent.click(screen.getByLabelText("Hide Email in row"));
    expect(calls.onHide).toHaveBeenCalledWith([0, 2, 0]);
    fireEvent.click(screen.getByLabelText("Duplicate Opening hours in row"));
    expect(calls.onDuplicate).toHaveBeenCalledWith([0, 2, 1]);
    fireEvent.click(screen.getByLabelText("Delete Email from row"));
    expect(calls.onDelete).toHaveBeenCalledWith([0, 2, 0]);
    expect(screen.getByLabelText("Show Phone in row").getAttribute("aria-pressed")).toBe("true");
  });

  it("renames on double-click", () => {
    const { calls } = setup({});
    fireEvent.doubleClick(screen.getByText("Opening hours"));
    const input = screen.getByLabelText("Layer name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Hours" } });
    fireEvent.blur(input);
    expect(calls.onRename).toHaveBeenCalledWith([0, 2, 1], "Hours");
  });

  it("the row can be folded shut and opened again", () => {
    setup({});
    fireEvent.click(screen.getByRole("button", { name: /^Collapse/ }));
    expect(screen.queryByText("Column 1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Expand/ }));
    expect(screen.getByText("Column 1")).toBeTruthy();
  });
});
