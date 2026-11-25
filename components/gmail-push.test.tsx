// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPreset } from "@/lib/presets";
import { GmailPush } from "./gmail-push";

type Reply = { status?: number; body: unknown };
type Handler = (init: RequestInit | undefined) => Reply | Promise<Reply>;
let routes: Record<string, Handler>;
let calls: { key: string; body: unknown }[];

const docA = getPreset("classic")!.doc;
const docB = getPreset("minimal")!.doc;

const ADDRESSES = [
  { email: "jane@kimp.xyz", displayName: "Jane Doe", isPrimary: true, isDefault: true, hasSignature: true, canEdit: true },
  { email: "sales@kimp.xyz", displayName: "Sales", isPrimary: false, isDefault: false, hasSignature: false, canEdit: true },
  { email: "pending@kimp.xyz", displayName: "", isPrimary: false, isDefault: false, hasSignature: false, canEdit: false },
];
const PREVIEW = {
  address: { email: "jane@kimp.xyz", displayName: "Jane Doe", isPrimary: true },
  newHtml: "<p>NEW SIGNATURE</p>",
  newHash: "a".repeat(32),
  newLength: 1234,
  limit: 10000,
  tooLong: false,
  current: { html: "<p>OLD SIGNATURE</p>", hash: "b".repeat(32), hasSignature: true },
};

beforeEach(() => {
  calls = [];
  routes = {
    "GET /api/google/status": () => ({ body: { configured: true, connected: true, email: "jane@kimp.xyz", domain: "kimp.xyz" } }),
    "GET /api/google/sendas": () => ({ body: { addresses: ADDRESSES } }),
    "POST /api/google/preview": () => ({ body: PREVIEW }),
    "POST /api/google/push": () => ({ body: { ok: true, email: "jane@kimp.xyz", logged: true } }),
    "POST /api/google/disconnect": () => ({ body: { ok: true, revoked: "revoked" } }),
  };
  window.history.replaceState(null, "", "/editor");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const h = routes[key];
      if (!h) throw new Error(`unexpected request ${key}`);
      const r = await h(init);
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pushes = () => calls.filter((c) => c.key === "POST /api/google/push");
const mount = (doc: typeof docA | null = docA) => render(<GmailPush doc={doc} returnTo="/editor" />);
const toReview = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Choose address" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review before sending" }));
  await screen.findByRole("group", { name: "Review before replacing" });
};
const replaceButton = () => screen.getByRole("button", { name: /^Replace signature on/ }) as HTMLButtonElement;
const agree = () => fireEvent.click(screen.getByRole("checkbox"));

describe("what is shown before connecting", () => {
  it("shows nothing when signed out, switched off, or accounts are unavailable", async () => {
    for (const status of [401, 403, 503]) {
      routes["GET /api/google/status"] = () => ({ status, body: { error: "x" } });
      const { container, unmount } = mount();
      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      await new Promise((r) => setTimeout(r, 0));
      expect(container.textContent).toBe("");
      unmount();
      calls = [];
    }
  });

  it("explains when the server is not set up, with no Connect button", async () => {
    routes["GET /api/google/status"] = () => ({ body: { configured: false, connected: false } });
    mount();
    expect(await screen.findByText(/not set up on this server/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Connect/ })).toBeNull();
  });

  it("offers Connect as a normal link (a full-page redirect to Google), and says what it can and cannot do", async () => {
    routes["GET /api/google/status"] = () => ({ body: { configured: true, connected: false } });
    mount();
    const link = (await screen.findByRole("link", { name: "Connect Google account" })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/google/connect?next=%2Feditor");
    expect(screen.getByText(/cannot read your email/)).toBeTruthy();
  });

  it("shows the outcome of coming back from Google, then tidies the address bar", async () => {
    window.history.replaceState(null, "", "/editor?gmail=wrong_account&keep=1");
    routes["GET /api/google/status"] = () => ({ body: { configured: true, connected: false } });
    mount();
    expect(await screen.findByText(/not in your company's Workspace/)).toBeTruthy();
    expect(window.location.search).toBe("?keep=1");
  });

  it("an unknown outcome code falls back to a generic message", async () => {
    window.history.replaceState(null, "", "/editor?gmail=<script>");
    mount();
    expect(await screen.findByText(/Something went wrong connecting/)).toBeTruthy();
  });
});

describe("connected: choosing the address", () => {
  it("shows who is connected and a Disconnect button", async () => {
    mount();
    expect(await screen.findByText("jane@kimp.xyz")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  it("lists every send-as address, preselects the first editable one, and blocks unverified aliases", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Choose address" }));
    const radios = (await screen.findAllByRole("radio")) as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(["jane@kimp.xyz", "sales@kimp.xyz", "pending@kimp.xyz"]);
    expect(radios.map((r) => r.checked)).toEqual([true, false, false]);
    expect(radios[2].disabled).toBe(true);
    expect(screen.getByText(/Has a signature \(it would be replaced\)/)).toBeTruthy();
    expect(screen.getByText(/Not verified in Gmail yet/)).toBeTruthy();
  });

  it("cannot proceed while the signature is invalid", async () => {
    mount(null);
    expect(((await screen.findByRole("button", { name: "Choose address" })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Fix the highlighted fields first/)).toBeTruthy();
  });
});

describe("review and approval", () => {
  it("shows the chosen address, the new signature and the current one before anything can change", async () => {
    mount();
    await toReview();
    expect(calls.find((c) => c.key === "POST /api/google/preview")!.body).toEqual({ doc: docA, email: "jane@kimp.xyz" });
    const review = screen.getByRole("group", { name: "Review before replacing" });
    expect(within(review).getByText("jane@kimp.xyz")).toBeTruthy();
    expect(within(review).getByText("Current signature (will be replaced)")).toBeTruthy();
    const frames = within(review).getAllByTitle(/signature$/i) as HTMLIFrameElement[];
    expect(frames).toHaveLength(2);
    expect(frames[0].getAttribute("srcdoc")).toContain("NEW SIGNATURE");
    expect(frames[1].getAttribute("srcdoc")).toContain("OLD SIGNATURE");
    expect(within(review).getByText(/1,234 of 10,000 characters/)).toBeTruthy();
    expect(pushes()).toHaveLength(0);
  });

  it("previews the address that was selected, not a default", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Choose address" }));
    fireEvent.click(await screen.findByRole("radio", { name: /sales@kimp.xyz/ }));
    fireEvent.click(screen.getByRole("button", { name: "Review before sending" }));
    await screen.findByRole("group", { name: "Review before replacing" });
    expect((calls.find((c) => c.key === "POST /api/google/preview")!.body as { email: string }).email).toBe("sales@kimp.xyz");
  });

  it("renders both signatures in sandboxed frames, so nothing in them can run", async () => {
    mount();
    await toReview();
    for (const f of screen.getAllByTitle(/signature$/i)) expect(f.getAttribute("sandbox")).toBe("");
  });

  it("will not replace until the person ticks the box, and clicking the disabled button does nothing", async () => {
    mount();
    await toReview();
    expect(replaceButton().disabled).toBe(true);
    fireEvent.click(replaceButton());
    expect(pushes()).toHaveLength(0);
    agree();
    expect(replaceButton().disabled).toBe(false);
  });

  it("sends the confirmation and the exact fingerprints of what was reviewed", async () => {
    mount();
    await toReview();
    agree();
    fireEvent.click(replaceButton());
    expect(await screen.findByText("Signature updated for jane@kimp.xyz")).toBeTruthy();
    expect(pushes()).toHaveLength(1);
    expect(pushes()[0].body).toEqual({ doc: docA, email: "jane@kimp.xyz", confirm: true, newHash: PREVIEW.newHash, currentHash: PREVIEW.current.hash });
    expect(screen.queryByRole("group", { name: "Review before replacing" })).toBeNull();
  });

  it("the button names the address it will change", async () => {
    mount();
    await toReview();
    expect(replaceButton().textContent).toBe("Replace signature on jane@kimp.xyz");
  });

  it("when there is no existing signature it says so, and still needs approval", async () => {
    routes["POST /api/google/preview"] = () => ({ body: { ...PREVIEW, current: { html: "", hash: "c".repeat(32), hasSignature: false } } });
    mount();
    await toReview();
    expect(screen.getByText(/No signature is set on this address/)).toBeTruthy();
    expect(screen.getByText(/I want to set it on jane@kimp.xyz/)).toBeTruthy();
    expect(replaceButton().disabled).toBe(true);
  });

  it("blocks a signature that is too long, with the reason", async () => {
    routes["POST /api/google/preview"] = () => ({ body: { ...PREVIEW, tooLong: true, newLength: 12000 } });
    mount();
    await toReview();
    expect(screen.getByText(/Too long/)).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(replaceButton().disabled).toBe(true);
  });

  it("Cancel discards the review and sends nothing", async () => {
    mount();
    await toReview();
    agree();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Review before replacing" })).toBeNull();
    expect(pushes()).toHaveLength(0);
  });

  it("if the signature is edited after previewing, the stale preview is cleared and must be reviewed again", async () => {
    const { rerender } = mount(docA);
    await toReview();
    agree();
    rerender(<GmailPush doc={docB} returnTo="/editor" />);
    await waitFor(() => expect(screen.queryByRole("group", { name: "Review before replacing" })).toBeNull());
    expect(screen.getByText(/signature changed, so the preview was cleared/)).toBeTruthy();
    expect(pushes()).toHaveLength(0);
  });

  it("changing the chosen address discards the earlier review", async () => {
    mount();
    await toReview();
    fireEvent.click(screen.getByRole("radio", { name: /sales@kimp.xyz/ }));
    expect(screen.queryByRole("group", { name: "Review before replacing" })).toBeNull();
  });
});

describe("when something goes wrong", () => {
  it("shows the server's reason and clears the review if the existing signature changed", async () => {
    routes["POST /api/google/push"] = () => ({ status: 409, body: { error: "changed", message: "The signature on jane@kimp.xyz changed after you looked at it. Nothing was changed." } });
    mount();
    await toReview();
    agree();
    fireEvent.click(replaceButton());
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("changed after you looked at it");
    expect(screen.queryByRole("group", { name: "Review before replacing" })).toBeNull(); // must review again; cannot just click twice
    expect(pushes()).toHaveLength(1);
    expect(screen.queryByText(/Signature updated/)).toBeNull();
  });

  it("if Google access has been revoked, goes back to Connect instead of failing repeatedly", async () => {
    routes["GET /api/google/sendas"] = () => ({ status: 401, body: { error: "reconnect_required", message: "Google access was removed or expired. Connect your Google account again." } });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Choose address" }));
    expect(await screen.findByRole("link", { name: "Connect Google account" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Connect your Google account again");
  });

  it("reports Gmail being unavailable and offers another try", async () => {
    routes["GET /api/google/sendas"] = () => ({ status: 502, body: { error: "upstream", message: "Gmail had a problem. Please try again in a moment." } });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Choose address" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Gmail had a problem");
    expect(screen.getByRole("button", { name: "Choose address" })).toBeTruthy();
  });

  it("explains a network failure", async () => {
    mount();
    await screen.findByText("jane@kimp.xyz");
    routes["GET /api/google/sendas"] = () => {
      throw new TypeError("Failed to fetch");
    };
    fireEvent.click(screen.getByRole("button", { name: "Choose address" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not reach the server/);
  });
});

describe("disconnect", () => {
  it("disconnects, confirms Google access was cancelled, and returns to Connect", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText(/Google access was cancelled and the saved connection was deleted/)).toBeTruthy();
    expect(calls.some((c) => c.key === "POST /api/google/disconnect")).toBe(true);
    expect(screen.getByRole("link", { name: "Connect Google account" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });

  it("is honest when Google did not confirm the revocation", async () => {
    routes["POST /api/google/disconnect"] = () => ({ body: { ok: true, revoked: "failed" } });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText(/did not confirm the revocation/)).toBeTruthy();
    expect(screen.getByText(/myaccount.google.com\/permissions/)).toBeTruthy();
  });

  it("stays connected and says so if disconnecting failed", async () => {
    routes["POST /api/google/disconnect"] = () => ({ status: 500, body: { error: "db", message: "Could not remove the saved connection. Please try again." } });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not remove");
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });
});
