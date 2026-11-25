// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
);
const getUser = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/supabase/server", () => ({ getUser }));

import Home from "../page";
import { SignatureGenerator } from "./signature-generator/generator";

const fetchSpy = vi.fn();
const writeClipboard = vi.fn(async () => undefined);

beforeEach(() => {
  fetchSpy.mockReset();
  redirect.mockClear();
  getUser.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("ClipboardItem", class { constructor(public items: unknown) {} });
  Object.defineProperty(navigator, "clipboard", { value: { write: writeClipboard }, configurable: true });
  writeClipboard.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const frameDoc = () => (document.querySelector("iframe") as HTMLIFrameElement).srcdoc;

describe("free generator", () => {
  it("previews with the real renderer as you type, and escapes it", () => {
    render(<SignatureGenerator />);
    expect(frameDoc()).toContain("<table");
    type(/full name/i, "Jane <b>Doe</b>");
    type("Job title", "Recruiter");
    expect(frameDoc().toLowerCase()).toContain("jane");
    expect(frameDoc()).not.toContain("<b>Doe</b>");
    expect(frameDoc()).toContain("Recruiter");
  });

  it("sandboxes the preview: no scripts, no popups, no forms", () => {
    render(<SignatureGenerator />);
    const sandbox = document.querySelector("iframe")!.getAttribute("sandbox")!;
    expect(sandbox).toBe("allow-same-origin");
  });

  it("copies rich text only when the details are valid, and never calls the network", async () => {
    render(<SignatureGenerator />);
    fireEvent.click(screen.getByRole("button", { name: /copy signature/i }));
    expect(writeClipboard).not.toHaveBeenCalled();
    expect(await screen.findByText(/enter your name/i)).toBeTruthy();

    type(/full name/i, "Jane Doe");
    type("Email", "jane@acme.com");
    fireEvent.click(screen.getByRole("button", { name: /copy signature/i }));
    await waitFor(() => expect(writeClipboard).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/^Copied/)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows format errors under the field and refuses to copy", async () => {
    render(<SignatureGenerator />);
    type(/full name/i, "Jane");
    type("Email", "nope");
    type("Website", "http://insecure.example");
    expect(screen.getByText(/name@company\.com/i)).toBeTruthy();
    expect(screen.getByText(/starts with https/i)).toBeTruthy();
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /copy signature/i }));
    expect(writeClipboard).not.toHaveBeenCalled();
    expect(await screen.findByText(/fix the highlighted fields/i)).toBeTruthy();
    // The preview keeps working with the bad field left out.
    expect(frameDoc()).not.toContain("http://insecure.example");
  });

  it("tells the person when the browser blocks copying", async () => {
    writeClipboard.mockRejectedValueOnce(new Error("denied"));
    render(<SignatureGenerator />);
    type(/full name/i, "Jane");
    fireEvent.click(screen.getByRole("button", { name: /copy signature/i }));
    expect(await screen.findByText(/blocked copying/i)).toBeTruthy();
  });

  it("downloads an .htm file named after the person, without a network call", async () => {
    const created: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b: Blob) => (created.push(b), "blob:x"), revokeObjectURL: () => undefined }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<SignatureGenerator />);
    type(/full name/i, "Jane Doe");
    fireEvent.click(screen.getByRole("button", { name: /download \.htm/i }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(await created[0].text()).toContain("<table");
    expect(fetchSpy).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it("nudges toward an account and labels every input", () => {
    render(<SignatureGenerator />);
    expect(screen.getByRole("link", { name: /sign in or create an account/i }).getAttribute("href")).toBe("/login");
    const fields = document.querySelectorAll("input, select");
    expect(fields.length).toBeGreaterThan(10);
    for (const el of fields) expect(document.querySelector(`label[for="${el.id}"]`), el.id).toBeTruthy();
  });
});

describe("home page routing", () => {
  it("redirects to /create when the public site is off (today's behaviour)", async () => {
    vi.stubEnv("PUBLIC_SITE_ENABLED", "false");
    await expect(Home()).rejects.toThrow("REDIRECT:/create");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("redirects signed-in people to /create even when the site is on", async () => {
    vi.stubEnv("PUBLIC_SITE_ENABLED", "true");
    getUser.mockResolvedValue({ id: "u1" });
    await expect(Home()).rejects.toThrow("REDIRECT:/create");
  });

  it("shows the marketing home to signed-out visitors when the site is on", async () => {
    vi.stubEnv("PUBLIC_SITE_ENABLED", "true");
    getUser.mockResolvedValue(null);
    render(await Home());
    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/signature/i);
    expect(screen.getAllByRole("link", { name: /free signature|free generator/i }).length).toBeGreaterThan(0);
  });
});
