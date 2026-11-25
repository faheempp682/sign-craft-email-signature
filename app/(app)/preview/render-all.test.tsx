// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPreset } from "@/lib/presets";
import { CLIENTS, CLIENT_IDS } from "@/lib/preview-clients";
import { RenderAll } from "./render-all";
import { ClientBadge } from "./render-ui";

const doc = getPreset("classic")!.doc;
const PNG_B64 = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
let posts: unknown[];

function stub(get: { status?: number; body: unknown }, post?: { status?: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const r = init?.method === "POST" ? (posts.push(JSON.parse(String(init.body))), post!) : get;
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
    }),
  );
}
beforeEach(() => {
  posts = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RenderAll", () => {
  it("is disabled and explains why when the service is off", async () => {
    stub({ body: { enabled: false, message: "Real-engine previews are switched off on this server." } });
    render(<RenderAll doc={doc} dark={false} filename="classic" />);
    expect(await screen.findByText(/switched off on this server/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Render in all engines" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows the message when the feature is not enabled for the account", async () => {
    stub({ status: 403, body: { message: "Rendered previews is not enabled for your account." } });
    render(<RenderAll doc={doc} dark={false} filename="classic" />);
    expect(await screen.findByText(/not enabled for your account/)).toBeTruthy();
  });
  it("renders a grid with Real engine and Simulation badges and download links", async () => {
    const result = (target: string, kind: string, label: string) => ({ target, viewport: "desktop", kind, badge: "", label, width: 10, height: 10, cached: false, png: PNG_B64 });
    stub(
      { body: { enabled: true, message: null } },
      { body: { dark: true, results: [result("webkit", "real", "WebKit"), result("outlook-word-sim", "simulation", "Outlook for Windows (simulation)")], skipped: [{ target: "firefox", reason: "The firefox browser is not installed." }] } },
    );
    render(<RenderAll doc={doc} dark={true} filename="classic" />);
    const btn = await screen.findByRole("button", { name: "Render in all engines" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await screen.findByText("WebKit");
    expect(screen.getByText("Real engine")).toBeTruthy();
    expect(screen.getByText("Simulation")).toBeTruthy();
    expect(screen.getByText(/Skipped firefox: The firefox browser is not installed/)).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Download PNG" }) as HTMLAnchorElement[];
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("download")).toBe("classic-webkit-desktop-dark.png");
    expect(posts[0]).toMatchObject({ dark: true });
  });
  it("shows the server's error message when rendering fails", async () => {
    stub({ body: { enabled: true, message: null } }, { status: 429, body: { message: "Too many render requests. Try again in 20 seconds." } });
    render(<RenderAll doc={doc} dark={false} filename="classic" />);
    const btn = await screen.findByRole("button", { name: "Render in all engines" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Too many render requests/);
  });
});

describe("ClientBadge", () => {
  it("every client shows a badge that is Simulation or an approximation, never a claim of real Outlook", () => {
    for (const id of CLIENT_IDS) {
      const { container, unmount } = render(<ClientBadge client={id} />);
      const kind = container.querySelector("[data-kind]")!.getAttribute("data-kind");
      expect(kind).toBe(CLIENTS[id].fidelity);
      expect(container.textContent).not.toMatch(/real engine/i);
      unmount();
    }
  });
});
