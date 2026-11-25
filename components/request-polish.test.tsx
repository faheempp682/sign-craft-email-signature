// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestPolish } from "./request-polish";

const SIG = "7a1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const NEW_ID = "6f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
type Reply = { status?: number; body: unknown };
let statusReply: Reply;
let createReply: Reply;
let calls: { key: string; body?: unknown }[];

beforeEach(() => {
  calls = [];
  statusReply = { body: { enabled: true, openRequestId: null } };
  createReply = { status: 201, body: { id: NEW_ID, status: "requested", round: 1 } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`;
      calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = key.startsWith("GET /api/polish/status") ? statusReply : createReply;
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = async () => fireEvent.click(await screen.findByRole("button", { name: "Request polish" }));

describe("Request polish button", () => {
  it.each([401, 403, 503])("renders nothing when the status check says %i (signed out, feature off, not set up)", async (status) => {
    statusReply = { status, body: { error: "x" } };
    const { container } = render(<RequestPolish signatureId={SIG} origin="ai" />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });

  it("sends the signature id, the trimmed note and the origin", async () => {
    const onRequested = vi.fn();
    render(<RequestPolish signatureId={SIG} origin="ai" onRequested={onRequested} />);
    await open();
    fireEvent.change(screen.getByLabelText("What should the designer improve?"), { target: { value: "  make the banner stand out " } });
    fireEvent.click(screen.getByRole("button", { name: "Send to a designer" }));
    expect(await screen.findByRole("link", { name: "View request" })).toHaveProperty("href", expect.stringContaining(`/polish/${NEW_ID}`));
    expect(calls.find((c) => c.key === "POST /api/polish")?.body).toEqual({ signatureId: SIG, note: "make the banner stand out", origin: "ai" });
    expect(onRequested).toHaveBeenCalledWith(NEW_ID);
  });

  it("asks for a note before sending anything", async () => {
    render(<RequestPolish signatureId={SIG} origin="manual" />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Send to a designer" }));
    expect(screen.getByText("Tell the designer what to improve.")).toBeTruthy();
    expect(screen.getByLabelText("What should the designer improve?").getAttribute("aria-invalid")).toBe("true");
    expect(calls.some((c) => c.key === "POST /api/polish")).toBe(false);
  });

  it("shows the server's message when sending fails, and keeps the note", async () => {
    createReply = { status: 409, body: { error: "already_open", message: "This signature already has an open polish request." } };
    render(<RequestPolish signatureId={SIG} origin="manual" />);
    await open();
    fireEvent.change(screen.getByLabelText("What should the designer improve?"), { target: { value: "tidy up" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to a designer" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This signature already has an open polish request.");
    expect((screen.getByLabelText("What should the designer improve?") as HTMLTextAreaElement).value).toBe("tidy up");
  });

  it("links to the open request instead of offering a second one", async () => {
    statusReply = { body: { enabled: true, openRequestId: NEW_ID } };
    render(<RequestPolish signatureId={SIG} origin="manual" />);
    const link = await screen.findByRole("link", { name: "View request" });
    expect(link.getAttribute("href")).toBe(`/polish/${NEW_ID}`);
    expect(screen.queryByRole("button", { name: "Request polish" })).toBeNull();
  });

  it("tells you to save first when there is no saved signature, and sends nothing", async () => {
    render(<RequestPolish signatureId={null} origin="ai" />);
    await open();
    expect(screen.getByText("Save this signature first, then you can send it to a designer.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send to a designer" })).toBeNull();
  });
});
