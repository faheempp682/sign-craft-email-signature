// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_KEY } from "@/lib/editor/draft";
import type { PolishDetail } from "@/lib/polish/route";
import { getPreset } from "@/lib/presets";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/polish" }));

import { PolishDeliverBanner } from "./deliver-banner";
import { RequestDetail } from "./request-detail";

const ID = "6f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const ORIGINAL = getPreset("classic")!.doc;
const POLISHED = getPreset("minimal")!.doc;

const base: PolishDetail = {
  id: ID, signatureName: "Sales", origin: "ai", note: "make the banner stand out", status: "requested", round: 1,
  createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z", deliveredAt: null,
  isRequester: true, isHolder: false, canClaim: false,
  originalDoc: ORIGINAL, deliveredDoc: null, workDoc: null, changeNote: null, declineReason: null, hasSource: true, acceptedMode: null,
  comments: [], events: [{ id: "e1", action: "requested", by: "requester", detail: null, createdAt: "2026-11-01T10:00:00Z" }],
};
const delivered: PolishDetail = { ...base, status: "delivered", deliveredDoc: POLISHED, changeNote: "Bigger banner, tighter spacing" };
const holding: PolishDetail = { ...base, status: "in_progress", isRequester: false, isHolder: true, workDoc: ORIGINAL };

let detail: PolishDetail;
let sent: { url: string; body: Record<string, unknown> }[];
let post: { status: number; body: unknown };

beforeEach(() => {
  detail = delivered;
  sent = [];
  post = { status: 200, body: { id: ID, status: "accepted", round: 1 } };
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method !== "POST") return new Response(JSON.stringify(detail), { status: 200 });
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(post.body), { status: post.status });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = async (openEditor = vi.fn()) => {
  render(<RequestDetail id={ID} openEditor={openEditor} />);
  await screen.findByRole("heading", { name: "Sales" });
  return openEditor;
};

describe("request detail: what is shown", () => {
  it("shows the original and the polished version side by side with the change note", async () => {
    await mount();
    expect(screen.getByTitle("Original signature")).toBeTruthy();
    expect(screen.getByTitle("Polished signature")).toBeTruthy();
    expect(screen.getByText("Bigger banner, tighter spacing")).toBeTruthy();
    expect(screen.getByText("make the banner stand out")).toBeTruthy();
    expect(screen.getByText("AI draft")).toBeTruthy();
    expect(screen.getByText("Ready to review")).toBeTruthy();
  });

  it("renders the polished signature with the real renderer (the preview srcdoc is the exporter's HTML)", async () => {
    await mount();
    const { renderToEmailHtml } = await import("@/lib/renderer/email-html");
    expect((screen.getByTitle("Polished signature") as HTMLIFrameElement).getAttribute("srcdoc")).toContain(renderToEmailHtml(POLISHED));
    expect((screen.getByTitle("Original signature") as HTMLIFrameElement).getAttribute("sandbox")).toBe("allow-same-origin");
  });

  it("explains a missing request instead of failing silently", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "nope" }), { status: 404 })));
    render(<RequestDetail id={ID} />);
    expect((await screen.findByRole("alert")).textContent).toContain("does not exist, or you do not have access");
  });

  it("does not offer comments, claim or review controls to people who may not use them", async () => {
    detail = { ...base, isRequester: false, isHolder: false, canClaim: false, status: "requested" };
    await mount();
    expect(screen.queryByRole("button", { name: "Claim request" })).toBeNull();
    expect(screen.queryByText("Comments")).toBeNull();
    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
  });
});

describe("requester: accept", () => {
  it("saves the polished version as a new signature, with the name you choose", async () => {
    await mount();
    expect((screen.getByLabelText("Name of the new signature") as HTMLInputElement).value).toBe("Sales (polished)");
    fireEvent.change(screen.getByLabelText("Name of the new signature"), { target: { value: "Sales v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept and save as new" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: `/api/polish/${ID}/accept`, body: { mode: "new", name: "Sales v2" } });
  });

  it("never replaces the original until the confirmation box is ticked", async () => {
    await mount();
    fireEvent.click(screen.getByLabelText("Replace the original signature"));
    const button = screen.getByRole("button", { name: "Accept and replace original" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(sent).toHaveLength(0);
    fireEvent.click(screen.getByLabelText(/I understand the original signature will be overwritten/));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toEqual({ mode: "replace", confirmReplace: true });
  });

  it("only offers a new signature when the original was deleted", async () => {
    detail = { ...delivered, hasSource: false };
    await mount();
    expect((screen.getByLabelText("Replace the original signature") as HTMLInputElement).disabled).toBe(true);
  });

  it("shows the server's message when accepting fails", async () => {
    post = { status: 409, body: { message: "That is not possible at this stage of the request." } };
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Accept and save as new" }));
    expect((await screen.findByRole("alert")).textContent).toContain("not possible at this stage");
  });
});

describe("requester: decline", () => {
  it("needs a reason before anything is sent", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Decline and reopen" }));
    expect(screen.getByText("Tell the designer what is not right.")).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it("sends the reason and reopens by default, or closes when unticked", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("What is not right?"), { target: { value: "  banner still too small " } });
    fireEvent.click(screen.getByRole("button", { name: "Decline and reopen" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: `/api/polish/${ID}/decline`, body: { reason: "banner still too small", reopen: true } });

    fireEvent.click(screen.getByLabelText("Send it back to the designers for another try"));
    fireEvent.click(await screen.findByRole("button", { name: "Decline and close" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].body).toEqual({ reason: "banner still too small", reopen: false });
  });
});

describe("requester: cancel and comment", () => {
  it("asks before cancelling", async () => {
    detail = { ...base };
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Cancel this request" }));
    expect(sent).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe(`/api/polish/${ID}/cancel`);
  });

  it("sends a comment and shows the thread, and closed requests take no more comments", async () => {
    detail = { ...delivered, comments: [{ id: "c1", role: "designer", mine: false, body: "Moved the logo up", createdAt: "2026-11-02T10:00:00Z" }] };
    await mount();
    expect(screen.getByText("Moved the logo up")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Message to the designer"), { target: { value: " thanks " } });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: `/api/polish/${ID}/comments`, body: { body: "thanks" } });
    cleanup();
    detail = { ...delivered, status: "accepted" };
    await mount();
    expect(screen.queryByLabelText("Message to the designer")).toBeNull();
  });
});

describe("designer: claim, work and deliver", () => {
  it("claims a queued request", async () => {
    detail = { ...base, isRequester: false, canClaim: true };
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Claim request" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe(`/api/polish/${ID}/claim`);
  });

  it("says so when someone else got there first", async () => {
    detail = { ...base, isRequester: false, canClaim: true };
    post = { status: 409, body: { message: "Someone else already took this request." } };
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Claim request" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Someone else already took this request.");
  });

  it("stores the copy as the editor draft and opens the editor on it", async () => {
    detail = holding;
    const openEditor = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Open copy in the editor" }));
    const stored = JSON.parse(window.localStorage.getItem(DRAFT_KEY)!);
    expect(stored.doc).toEqual(JSON.parse(JSON.stringify(ORIGINAL)));
    expect(openEditor).toHaveBeenCalledWith(`/editor?polish=${ID}`);
  });

  it("does not overwrite a different editor draft until the designer agrees", async () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: 1, doc: POLISHED }));
    detail = holding;
    const openEditor = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Open copy in the editor" }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem(DRAFT_KEY)!).doc.template_id).toBe(POLISHED.template_id);
    fireEvent.click(screen.getByRole("button", { name: "Keep my draft" }));
    expect(openEditor).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open copy in the editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace and open" }));
    expect(JSON.parse(window.localStorage.getItem(DRAFT_KEY)!).doc.template_id).toBe(ORIGINAL.template_id);
    expect(openEditor).toHaveBeenCalledWith(`/editor?polish=${ID}`);
  });

  it("delivers the editor draft with a change note, after previewing it", async () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: 1, doc: POLISHED }));
    detail = holding;
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Deliver my editor draft…" }));
    expect(screen.getByTitle("Draft to deliver")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Deliver to requester" }));
    expect(screen.getByText("Write a short note on what you changed.")).toBeTruthy();
    expect(sent).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("What did you change?"), { target: { value: "Bigger banner" } });
    fireEvent.click(screen.getByRole("button", { name: "Deliver to requester" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe(`/api/polish/${ID}/deliver`);
    expect(sent[0].body).toEqual({ doc: JSON.parse(JSON.stringify(POLISHED)), changeNote: "Bigger banner" });
  });

  it("refuses to deliver when there is no editor draft or it has errors", async () => {
    detail = holding;
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Deliver my editor draft…" }));
    expect((await screen.findByRole("alert")).textContent).toContain("no draft in the editor");
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: 1, doc: { ...POLISHED, blocks: [{ type: "identity", name: "" }] } }));
    fireEvent.click(screen.getByRole("button", { name: "Deliver my editor draft…" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("has errors"));
    expect(screen.queryByTitle("Draft to deliver")).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("asks before giving a request back to the queue", async () => {
    detail = holding;
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Give it back to the queue" }));
    expect(sent).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Give it back" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe(`/api/polish/${ID}/release`);
  });
});

describe("editor banner for the designer", () => {
  const mountBanner = async (doc: typeof POLISHED | null = POLISHED) => {
    const onDelivered = vi.fn();
    render(<PolishDeliverBanner requestId={ID} doc={doc} onDelivered={onDelivered} />);
    return onDelivered;
  };

  it("shows only a notice, and no form, to someone who is not the holder", async () => {
    detail = { ...base, isRequester: false, isHolder: false };
    await mountBanner();
    expect((await screen.findByRole("alert")).textContent).toContain("not the designer holding this request");
    expect(screen.queryByRole("button", { name: "Deliver to requester" })).toBeNull();
  });

  it("delivers the editor's document with the change note", async () => {
    detail = holding;
    const onDelivered = await mountBanner();
    await screen.findByText(/Requester.s note: make the banner stand out/);
    fireEvent.click(screen.getByRole("button", { name: "Deliver to requester" }));
    expect(screen.getByText("Write a short note on what you changed.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What did you change?"), { target: { value: "Bigger banner" } });
    fireEvent.click(screen.getByRole("button", { name: "Deliver to requester" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: `/api/polish/${ID}/deliver`, body: { doc: JSON.parse(JSON.stringify(POLISHED)), changeNote: "Bigger banner" } });
    expect(onDelivered).toHaveBeenCalled();
    expect((await screen.findByRole("status")).textContent).toContain("Delivered to the requester");
  });

  it("does not send a document that fails validation, and cannot deliver before the editor is ready", async () => {
    detail = holding;
    await mountBanner({ ...POLISHED, theme: { ...POLISHED.theme, primary: "red" } });
    await screen.findByText(/Requester.s note/);
    fireEvent.change(screen.getByLabelText("What did you change?"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Deliver to requester" }));
    expect((await screen.findByRole("alert")).textContent).toContain("has errors");
    expect(sent).toHaveLength(0);
    cleanup();
    await mountBanner(null);
    await screen.findByText(/Requester.s note/);
    expect((screen.getByRole("button", { name: "Deliver to requester" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
