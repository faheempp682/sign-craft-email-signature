// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESETS } from "@/lib/presets";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { CreateForm } from "./create-form";

type Call = { url: string; init: RequestInit };
let calls: Call[];
let reply: { ok: boolean; status?: number; body: unknown };
let hold: Promise<void> | null;

const goodDoc = PRESETS[0].doc;
const shot = (name = "sig.png", type = "image/png", size = 1000) => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};
const fileInput = () => screen.getByLabelText("Upload a screenshot of a signature") as HTMLInputElement;
const formOf = (c: Call) => c.init.body as FormData;

beforeEach(() => {
  calls = [];
  hold = null;
  reply = { ok: true, body: { doc: goodDoc, reply: "ok" } };
  push.mockClear();
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (hold) await hold;
      return new Response(JSON.stringify(reply.body), { status: reply.ok ? 200 : (reply.status ?? 400) });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Create: from a screenshot", () => {
  it("sends the picture to the vision route and opens the result in the editor", async () => {
    render(<CreateForm />);
    fireEvent.change(fileInput(), { target: { files: [shot()] } });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/editor?from=ai"));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/ai/vision");
    expect(calls[0].init.method).toBe("POST");
    expect((formOf(calls[0]).get("file") as File).name).toBe("sig.png");
    expect(formOf(calls[0]).has("note")).toBe(false);
    expect(window.localStorage.length).toBeGreaterThan(0); // the draft was handed over
  });

  it("sends whatever is typed in the box as a note, trimmed to 500 characters", async () => {
    render(<CreateForm />);
    fireEvent.change(screen.getByLabelText("Describe your signature"), { target: { value: `  make it navy ${"x".repeat(600)}` } });
    fireEvent.change(fileInput(), { target: { files: [shot()] } });
    await waitFor(() => expect(calls).toHaveLength(1));
    const note = formOf(calls[0]).get("note") as string;
    expect(note.startsWith("make it navy")).toBe(true);
    expect(note.length).toBe(500);
  });

  it("refuses the wrong type or an oversize file without sending anything", async () => {
    render(<CreateForm />);
    fireEvent.change(fileInput(), { target: { files: [shot("a.svg", "image/svg+xml")] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/PNG, JPG or GIF/);
    fireEvent.change(fileInput(), { target: { files: [shot("big.png", "image/png", 5 * 1024 * 1024 + 1)] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/over 5 MB/));
    expect(calls).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the server's message and stays on the page when it fails", async () => {
    reply = { ok: false, status: 429, body: { message: "You have reached today's limit for screenshot to signature." } };
    render(<CreateForm />);
    fireEvent.change(fileInput(), { target: { files: [shot()] } });
    expect((await screen.findByRole("alert")).textContent).toContain("today's limit");
    expect(push).not.toHaveBeenCalled();
  });

  it("says it is reading the screenshot, and blocks a second upload meanwhile", async () => {
    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    render(<CreateForm />);
    fireEvent.change(fileInput(), { target: { files: [shot()] } });
    expect((await screen.findByRole("status")).textContent).toMatch(/Reading your screenshot/);
    expect((screen.getByRole("button", { name: /From a screenshot/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(fileInput(), { target: { files: [shot("second.png")] } });
    release();
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(calls).toHaveLength(1);
  });

  it("accepts a picture pasted from the clipboard, but leaves ordinary text pastes alone", () => {
    render(<CreateForm />);
    const box = screen.getByLabelText("Describe your signature");
    const text = fireEvent.paste(box, { clipboardData: { files: [], getData: () => "hello" } });
    expect(text).toBe(true); // not cancelled
    expect(calls).toHaveLength(0);
    const image = fireEvent.paste(box, { clipboardData: { files: [shot("pasted.png")] } });
    expect(image).toBe(false); // cancelled, so the browser does not also paste something into the box
    expect(calls).toHaveLength(1);
  });

  it("accepts a dropped file", async () => {
    render(<CreateForm />);
    const card = screen.getByLabelText("Describe your signature").closest("[data-dropzone]")!;
    fireEvent.drop(card, { dataTransfer: { files: [shot("dropped.png")], types: ["Files"] } });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect((formOf(calls[0]).get("file") as File).name).toBe("dropped.png");
  });
});

describe("Create: from a text prompt (unchanged)", () => {
  it("still posts JSON to the design route and opens the editor", async () => {
    render(<CreateForm />);
    fireEvent.change(screen.getByLabelText("Describe your signature"), { target: { value: "A calm navy signature" } });
    fireEvent.click(screen.getByRole("button", { name: "Create signature" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/editor?from=ai"));
    expect(calls[0].url).toBe("/api/ai/design");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ prompt: "A calm navy signature" });
  });
});
