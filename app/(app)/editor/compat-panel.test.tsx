// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignatureDocSchema, type SignatureDoc } from "@/lib/schema/document";
import { applyAllFixes, lintDoc } from "@/lib/linter";
import { CompatPanel } from "./compat-panel";

afterEach(cleanup);

const doc = (): SignatureDoc =>
  SignatureDocSchema.parse({
    version: 1,
    template_id: "classic",
    theme: { primary: "#1E3A8A", text: "#111827" },
    blocks: [
      { type: "identity", name: "Jane Doe" },
      { type: "avatar", src: "https://cdn.acme.com/me.png", alt: "image", shape: "circle", size: 40 },
      { type: "contact", email: "jane@acme.com" },
    ],
  });

const setup = (d = doc(), withDoc = true) => {
  const issues = lintDoc(d);
  const onFix = vi.fn();
  const onFixAll = vi.fn();
  const onSelect = vi.fn();
  render(<CompatPanel issues={issues} onFix={onFix} onFixAll={onFixAll} onSelect={onSelect} doc={withDoc ? d : undefined} />);
  return { issues, onFix, onFixAll, onSelect };
};

describe("CompatPanel categories", () => {
  it("shows a score per category and groups issues under their category", () => {
    setup();
    expect(screen.getByTestId("score-compat").textContent).toContain("100");
    expect(Number(within(screen.getByTestId("score-accessibility")).getByText(/^\d+$/).textContent)).toBeLessThan(100);
    expect(Number(within(screen.getByTestId("score-dark")).getByText(/^\d+$/).textContent)).toBeLessThan(100);
    expect(within(screen.getByTestId("section-accessibility")).getByText(/says nothing useful/)).toBeTruthy();
    expect(within(screen.getByTestId("section-dark")).getByText(/almost black/)).toBeTruthy();
    expect(screen.queryByTestId("section-gif")).toBeNull(); // no GIF, no GIF section
  });

  it("applies a fix through onFix with the issue that was clicked", () => {
    const { onFix } = setup();
    const section = screen.getByTestId("section-accessibility");
    fireEvent.click(within(section).getAllByRole("button", { name: /Show at 48 px/ })[0]);
    expect(onFix).toHaveBeenCalledTimes(1);
    expect(onFix.mock.calls[0][0].id).toBe("avatar-small:1");
  });

  it("counts only everyday fixes in Fix all, not the dark-mode trade-offs", () => {
    const d = doc();
    const issues = lintDoc(d);
    const everyday = issues.filter((i) => i.fix && !i.optIn).length;
    const withOptIn = issues.filter((i) => i.fix).length;
    expect(withOptIn).toBeGreaterThan(everyday);
    setup(d);
    expect(screen.getByRole("button", { name: `Fix all (${everyday})` })).toBeTruthy();
  });

  it("dark-mode section lists contrast with words, the dark variant changes, and the honest caveat", () => {
    setup();
    const dark = screen.getByTestId("dark-check");
    expect(within(dark).getAllByText(/Fail/).length).toBeGreaterThan(0);
    expect(within(dark).getAllByText(/Pass/).length).toBeGreaterThan(0);
    expect(within(dark).getByText(/colours? would change/)).toBeTruthy();
    expect(within(dark).getByText(/does not replace sending a test/)).toBeTruthy();
  });

  it("works without a document (older callers): no dark check table, issues still render", () => {
    setup(doc(), false);
    expect(screen.queryByTestId("dark-check")).toBeNull();
    expect(screen.getByTestId("section-dark")).toBeTruthy();
  });

  it("shows the GIF section only when there are GIF findings", () => {
    const d = doc();
    const src = (d.blocks[1] as { src: string }).src;
    const issues = lintDoc(d, { [src]: { type: "image/gif", bytes: 50 * 1024, width: 200, height: 200, animated: true, firstFrame: "blank" } });
    render(<CompatPanel issues={issues} onFix={() => {}} onFixAll={() => {}} onSelect={() => {}} />);
    expect(within(screen.getByTestId("section-gif")).getByText(/mostly empty/i)).toBeTruthy();
  });

  it("everyday fixes applied together leave the accessibility score at 100", () => {
    const fixed = applyAllFixes(doc());
    expect(lintDoc(fixed).filter((i) => i.category === "accessibility")).toEqual([]);
  });
});
