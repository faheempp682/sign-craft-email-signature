// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/admin/features" }));

import { FeaturesAdmin, type FlagRow, type OverrideRow } from "./features/features-admin";
import { LimitsAdmin, type LimitRow } from "./limits/limits-admin";
import { UsersAdmin, type Person } from "./users/users-admin";

type Sent = { url: string; method: string; body: Record<string, unknown> };
let sent: Sent[];
let reply: { ok: boolean; status?: number; body?: unknown } | "network-error";

beforeEach(() => {
  sent = [];
  reply = { ok: true, body: {} };
  refresh.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, method: init.method ?? "GET", body: JSON.parse(String(init.body)) });
      if (reply === "network-error") throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.ok ? 200 : (reply.status ?? 400) });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROLES = ["member", "designer", "admin"] as const;

/* ------------------------------------------------------------------ features */

const flags: FlagRow[] = [
  { feature: "animated_gif", label: "Animated GIF signatures", description: "Animated GIF signatures (enabled per customer)", defaultEnabled: false, minRole: "member" },
  { feature: "analytics", label: "Analytics", description: "Banner click analytics", defaultEnabled: true, minRole: "admin" },
];
const overrides: OverrideRow[] = [{ subjectType: "user", subjectId: "11111111-1111-4111-8111-111111111111", who: "client@acme.com", feature: "animated_gif", enabled: true }];
const orgs = [{ id: "22222222-2222-4222-8222-222222222222", name: "Kimp" }];
const renderFeatures = (o = overrides) => render(<FeaturesAdmin flags={flags} overrides={o} orgs={orgs} roles={[...ROLES]} />);

describe("Features screen", () => {
  it("shows every feature with its current state, as accessible switches", () => {
    renderFeatures();
    expect(screen.getByRole("switch", { name: "Animated GIF signatures: on by default" })).toHaveProperty("ariaChecked", "false");
    expect(screen.getByRole("switch", { name: "Analytics: on by default" })).toHaveProperty("ariaChecked", "true");
    expect((screen.getByLabelText("Analytics: available to") as HTMLSelectElement).value).toBe("admin");
  });

  it("flips a default with one request and refreshes the page", async () => {
    renderFeatures();
    fireEvent.click(screen.getByRole("switch", { name: "Animated GIF signatures: on by default" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent).toEqual([{ url: "/api/admin/flags", method: "PATCH", body: { feature: "animated_gif", default_enabled: true } }]);
    expect(await screen.findByText("Animated GIF signatures updated.")).toBeTruthy();
  });

  it("changes the minimum role", async () => {
    renderFeatures();
    fireEvent.change(screen.getByLabelText("Analytics: available to"), { target: { value: "designer" } });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toEqual({ feature: "analytics", min_role: "designer" });
  });

  it("shows the server's message and does not refresh when a change is refused", async () => {
    reply = { ok: false, status: 403, body: { message: "You do not have permission to do that." } };
    renderFeatures();
    fireEvent.click(screen.getByRole("switch", { name: "Analytics: on by default" }));
    expect(await screen.findByText("You do not have permission to do that.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("explains a network failure in plain words", async () => {
    reply = "network-error";
    renderFeatures();
    fireEvent.click(screen.getByRole("switch", { name: "Analytics: on by default" }));
    expect(await screen.findByText(/Could not reach the server/)).toBeTruthy();
  });

  it("adds an exception for a person, then clears the email", async () => {
    renderFeatures([]);
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "new@client.com" } });
    fireEvent.change(screen.getByLabelText("Feature"), { target: { value: "analytics" } });
    fireEvent.change(screen.getByLabelText("Set to"), { target: { value: "off" } });
    fireEvent.click(screen.getByRole("button", { name: "Add exception" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: "/api/admin/overrides", method: "PUT", body: { subject_type: "user", email: "new@client.com", feature: "analytics", enabled: false } });
    await waitFor(() => expect(email.value).toBe(""));
  });

  it("keeps what was typed when adding fails, so it can be corrected", async () => {
    reply = { ok: false, status: 404, body: { message: "No account with that email has signed in yet." } };
    renderFeatures([]);
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "ghost@client.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add exception" }));
    expect(await screen.findByText("No account with that email has signed in yet.")).toBeTruthy();
    expect(email.value).toBe("ghost@client.com");
  });

  it("adds an exception for an organization", async () => {
    renderFeatures([]);
    fireEvent.change(screen.getByLabelText("Applies to"), { target: { value: "org" } });
    fireEvent.click(screen.getByRole("button", { name: "Add exception" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toEqual({ subject_type: "org", org_id: orgs[0].id, feature: "animated_gif", enabled: true });
  });

  it("lists exceptions and removes the right one", async () => {
    renderFeatures();
    expect(screen.getByText("client@acme.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove exception: Animated GIF signatures for client@acme.com" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: "/api/admin/overrides", method: "DELETE", body: { subject_type: "user", subject_id: overrides[0].subjectId, feature: "animated_gif" } });
  });

  it("says so when there are no exceptions", () => {
    renderFeatures([]);
    expect(screen.getByText(/No exceptions yet/)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------- limits */

const limitRows: LimitRow[] = [
  { role: "member", feature: "ai_design", label: "AI design", perMinute: 10, perDay: 40, configured: true },
  { role: "designer", feature: "ai_design", label: "AI design", perMinute: null, perDay: null, configured: false },
  { role: "admin", feature: "ai_design", label: "AI design", perMinute: null, perDay: null, configured: true },
];
const sigInfo: { adminValue: number | null; fallback: number; tableMissing: boolean } = { adminValue: null, fallback: 5, tableMissing: false };
const renderLimits = (signatureLimit = sigInfo) => render(<LimitsAdmin rows={limitRows} usage={[]} truncated={false} signatureLimit={signatureLimit} />);
const memberForm = () => screen.getByLabelText("Per minute", { selector: "#m-member\\:ai_design" }).closest("form") as HTMLFormElement;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;

describe("AI limits screen", () => {
  it("shows current limits, and marks a role that falls back to Member", () => {
    renderLimits();
    expect(field("m-member:ai_design").value).toBe("10");
    expect(field("d-member:ai_design").value).toBe("40");
    expect(field("m-admin:ai_design").value).toBe("");
    expect(within(screen.getByText("Designer").closest("p")!).getByText("uses Member")).toBeTruthy();
  });

  it("keeps Save disabled until something changes", () => {
    renderLimits();
    const save = within(memberForm()).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(field("d-member:ai_design"), { target: { value: "50" } });
    expect(save.disabled).toBe(false);
  });

  it("saves numbers, with blank meaning no limit", async () => {
    renderLimits();
    fireEvent.change(field("m-member:ai_design"), { target: { value: "" } });
    fireEvent.change(field("d-member:ai_design"), { target: { value: " 75 " } });
    fireEvent.submit(memberForm());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: "/api/admin/limits", method: "PUT", body: { role: "member", feature: "ai_design", per_minute: null, per_day: 75 } });
    expect(refresh).toHaveBeenCalled();
  });

  it("sends zero as zero, which blocks the feature, not as no limit", async () => {
    renderLimits();
    fireEvent.change(field("d-member:ai_design"), { target: { value: "0" } });
    fireEvent.submit(memberForm());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body.per_day).toBe(0);
  });

  it.each(["abc", "5.5", "-1", "1e3", "12 000"])("refuses %j before sending anything", async (bad) => {
    renderLimits();
    fireEvent.change(field("d-member:ai_design"), { target: { value: bad } });
    fireEvent.submit(memberForm());
    expect(await screen.findByText(/whole numbers only/)).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it("shows the signature limit in use, and saves a new one", async () => {
    renderLimits();
    expect(screen.getByText(/Using 5/)).toBeTruthy();
    fireEvent.change(field("sig-limit"), { target: { value: "8" } });
    fireEvent.submit(field("sig-limit").closest("form")!);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: "/api/admin/signature-limit", method: "PUT", body: { limit: 8 } });
  });

  it("blank resets the signature limit to the environment value", async () => {
    renderLimits({ adminValue: 8, fallback: 5, tableMissing: false });
    expect(field("sig-limit").value).toBe("8");
    fireEvent.change(field("sig-limit"), { target: { value: "" } });
    fireEvent.submit(field("sig-limit").closest("form")!);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toEqual({ limit: null });
  });

  it.each(["0", "abc", "2.5", "1001"])("refuses the signature limit %j before sending", async (bad) => {
    renderLimits();
    fireEvent.change(field("sig-limit"), { target: { value: bad } });
    fireEvent.submit(field("sig-limit").closest("form")!);
    expect(await screen.findByText(/whole number from 1 to 1000/)).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it("shows recent usage and warns when the list was cut short", () => {
    render(<LimitsAdmin rows={limitRows} usage={[{ who: "jane@acme.com", feature: "ai_design", label: "AI design", calls: 12, tokensIn: 4500, tokensOut: 900 }]} truncated signatureLimit={sigInfo} />);
    expect(screen.getByText("jane@acme.com")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText(/most recent 5,000 calls/)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------- people */

const people: Person[] = [
  { email: "boss@kimp.xyz", joined: "2026-01-05T10:00:00Z", role: "admin", always: true },
  { email: "dee@kimp.xyz", joined: "2026-02-10T10:00:00Z", role: "member", always: false },
];

describe("People screen", () => {
  it("changes a role with one request", async () => {
    render(<UsersAdmin orgName="Kimp" people={people} />);
    fireEvent.change(screen.getByLabelText("Role for dee@kimp.xyz"), { target: { value: "designer" } });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: "/api/admin/members", method: "PUT", body: { email: "dee@kimp.xyz", role: "designer" } });
    expect(await screen.findByText("dee@kimp.xyz is now designer.")).toBeTruthy();
  });

  it("locks the role of someone listed in ADMIN_EMAILS and says why", () => {
    render(<UsersAdmin orgName="Kimp" people={people} />);
    expect((screen.getByLabelText("Role for boss@kimp.xyz") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(/always an admin/)).toBeTruthy();
    expect((screen.getByLabelText("Role for dee@kimp.xyz") as HTMLSelectElement).disabled).toBe(false);
  });

  it("shows the server's message when the last admin cannot be removed", async () => {
    reply = { ok: false, status: 409, body: { message: "There must be at least one admin." } };
    render(<UsersAdmin orgName="Kimp" people={[{ email: "solo@kimp.xyz", joined: "2026-01-05T10:00:00Z", role: "admin", always: false }]} />);
    fireEvent.change(screen.getByLabelText("Role for solo@kimp.xyz"), { target: { value: "member" } });
    expect(await screen.findByText("There must be at least one admin.")).toBeTruthy();
  });

  it("handles an empty list", () => {
    render(<UsersAdmin orgName="Kimp" people={[]} />);
    expect(screen.getByText("No one has signed in yet.")).toBeTruthy();
  });
});
