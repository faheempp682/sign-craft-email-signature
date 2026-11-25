// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisclaimerPicker } from "./disclaimer-picker";

const LIST = [
  { id: "1", org_id: null, title: "Confidentiality notice", category: "confidentiality", jurisdiction: "General", body: "This email is confidential.", needs_review: true },
  { id: "2", org_id: null, title: "GDPR notice", category: "data_protection", jurisdiction: "EU", body: "We process data under the GDPR.", needs_review: true },
];
let reply: { ok: boolean; body: unknown };
const open = () => fireEvent.click(screen.getByText("Insert a legal disclaimer"));
const toggle = () => {
  const d = document.querySelector("details")!;
  d.open = true;
  fireEvent(d, new Event("toggle"));
};

beforeEach(() => {
  reply = { ok: true, body: { disclaimers: LIST } };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(reply.body), { status: reply.ok ? 200 : 500 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DisclaimerPicker", () => {
  it("loads the templates only when opened, not on page load", async () => {
    render(<DisclaimerPicker hasDisclaimer={false} onInsert={() => {}} />);
    expect(fetch).not.toHaveBeenCalled();
    open();
    toggle();
    await screen.findByLabelText("Template");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows the chosen text and always the 'needs a lawyer' reminder before anything is inserted", async () => {
    const onInsert = vi.fn();
    render(<DisclaimerPicker hasDisclaimer={false} onInsert={onInsert} />);
    toggle();
    await screen.findByLabelText("Template");
    expect(screen.getByText("This email is confidential.")).toBeTruthy();
    expect(screen.getByText(/not legal advice/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Template"), { target: { value: "2" } });
    expect(screen.getByText("We process data under the GDPR.")).toBeTruthy();
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("inserts the chosen template's text", async () => {
    const onInsert = vi.fn();
    render(<DisclaimerPicker hasDisclaimer={false} onInsert={onInsert} />);
    toggle();
    await screen.findByLabelText("Template");
    fireEvent.change(screen.getByLabelText("Template"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to my signature" }));
    expect(onInsert).toHaveBeenCalledWith("We process data under the GDPR.");
    expect(await screen.findByText(/Added a disclaimer block/)).toBeTruthy();
  });

  it("says plainly that it will REPLACE an existing disclaimer", async () => {
    render(<DisclaimerPicker hasDisclaimer onInsert={() => {}} />);
    toggle();
    expect(await screen.findByRole("button", { name: "Replace the current disclaimer" })).toBeTruthy();
  });

  it("explains a load failure and an empty list", async () => {
    reply = { ok: false, body: { message: "Could not load the templates." } };
    const { unmount } = render(<DisclaimerPicker hasDisclaimer={false} onInsert={() => {}} />);
    toggle();
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load");
    unmount();
    reply = { ok: true, body: { disclaimers: [] } };
    render(<DisclaimerPicker hasDisclaimer={false} onInsert={() => {}} />);
    toggle();
    await waitFor(() => expect(screen.getByText(/No templates are available yet/)).toBeTruthy());
  });
});
