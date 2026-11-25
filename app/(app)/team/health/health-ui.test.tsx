// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthDashboard } from "./health-dashboard";

type Sent = { url: string; method: string; body: Record<string, unknown> | null };
let sent: Sent[];
let answers: Record<string, { status?: number; body: unknown } | (() => { status?: number; body: unknown })>;

beforeEach(() => {
  sent = [];
  answers = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      sent.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const a = answers[`${method} ${url.split("?")[0]}`] ?? { body: {} };
      const r = typeof a === "function" ? a() : a;
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STATUS = {
  setup: { configured: true, missing: [], unattended_ready: true, unattended_missing: [] },
  settings: { enabled: true, has_webhook: true, webhook_masked: "https://hooks.slack.com/…", include_names: false, max_people: 1000 },
  runs: [{ id: "r1", trigger: "cron", status: "completed", checked: 10, ok: 8, edited: 1, removed: 1, unreachable: 0, reformatted: 2, new_findings: 2, resolved: 0, capped: false, note: "", started_at: "2026-11-25T10:00:00Z", finished_at: "2026-11-25T10:01:00Z" }],
  counts: { open: 2, acknowledged: 0, monitored: 10, ok: 8, unreachable: 0 },
};
const F = (i: number, kind = "edited") => ({ id: `f${i}`, person_id: `p${i}`, email: `p${i}@acme.com`, person_name: `Person ${i}`, kind, status: "open", detail: "The words differ.", opened_at: "2026-11-25T10:00:00Z", last_seen_at: "2026-11-25T10:00:00Z", resolved_at: null, resolved_reason: "", acknowledged_at: null, ack_note: "" });
const FINDINGS = { items: [F(1), F(2, "removed")], total: 2, page: 0, page_size: 50 };

function ready() {
  answers["GET /api/health/status"] = { body: STATUS };
  answers["GET /api/health/findings"] = { body: FINDINGS };
}

describe("health screen", () => {
  it("says what is missing by exact variable name and disables checking when not set up", async () => {
    answers["GET /api/health/status"] = { body: { ...STATUS, setup: { ...STATUS.setup, configured: false, missing: ["GOOGLE_SERVICE_ACCOUNT_JSON"] } } };
    answers["GET /api/health/findings"] = { body: { items: [], total: 0, page: 0, page_size: 50 } };
    render(<HealthDashboard />);
    expect(await screen.findByText("Not set up")).toBeTruthy();
    expect(screen.getByText("GOOGLE_SERVICE_ACCOUNT_JSON")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Run check now" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("states the limits, the Exchange gap and that it is unverified", async () => {
    ready();
    render(<HealthDashboard />);
    expect(await screen.findByText(/not yet verified against a real Google Workspace/i)).toBeTruthy();
    expect(screen.getByText(/Microsoft 365 \(Exchange\) is not monitored/)).toBeTruthy();
    expect(screen.getByText(/reformatting/i)).toBeTruthy();
  });

  it("Run check now keeps asking until the server says done", async () => {
    ready();
    let n = 0;
    answers["POST /api/health/check"] = () => ({ body: { run_id: "r", done: ++n >= 3, checked: n * 25, capped: false, failed: false, note: "", alert: "none" } });
    render(<HealthDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Run check now" }));
    await waitFor(() => expect(screen.getByText(/Checked 75 people\./)).toBeTruthy());
    expect(sent.filter((s) => s.url === "/api/health/check")).toHaveLength(3);
  });

  it("acknowledge needs a note and sends it", async () => {
    ready();
    render(<HealthDashboard />);
    await screen.findByText("Person 1");
    fireEvent.click(screen.getAllByRole("button", { name: "Acknowledge" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Save acknowledgement" }));
    expect(await screen.findByText("Add a short note saying why.")).toBeTruthy();
    expect(sent.some((s) => s.url.includes("acknowledge"))).toBe(false);
    fireEvent.change(screen.getByLabelText(/Why is this fine/), { target: { value: "Intended footer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save acknowledgement" }));
    await waitFor(() => expect(sent.find((s) => s.url === "/api/health/findings/f1/acknowledge")?.body).toEqual({ note: "Intended footer" }));
  });

  it("restore: plans first, writes nothing until the box is ticked and the exact button is pressed", async () => {
    ready();
    answers["POST /api/deploy/gmail/plan"] = { body: { items: [{ person_id: "p1", email: "p1@acme.com", name: "Person 1", action: "replace", code: "", reason: "Replaces the signature they have now." }], counts: { total: 1, set: 0, replace: 1, skipped: 0, already_current: 0, actionable: 1 }, fingerprint: "f".repeat(64), blockers: [] } };
    answers["POST /api/deploy/gmail/deploy"] = { status: 201, body: { id: "d1" } };
    answers["POST /api/deploy/deployments/d1/run"] = { body: { deployment: { id: "d1", status: "succeeded", done: 1, failed: 0, skipped: 0, pending: 0, total: 1 }, batch: {} } };
    render(<HealthDashboard />);
    await screen.findByText("Person 1");
    fireEvent.click(screen.getAllByRole("button", { name: "Restore the approved signature" })[0]);
    expect(sent.some((s) => s.url === "/api/deploy/gmail/deploy")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Make a plan" }));
    expect(sent.find((s) => s.url === "/api/deploy/gmail/plan")).toBeTruthy();
    const btn = (await screen.findByRole("button", { name: "Deploy to 1 person, replacing 1 existing signature" })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I have reviewed this plan/));
    fireEvent.click(btn);
    await waitFor(() => expect(sent.find((s) => s.url === "/api/deploy/gmail/deploy")?.body).toMatchObject({ confirmed: true, person_ids: ["p1"], replace: 1, set: 0 }));
    await screen.findByText(/Finished: 1 restored/);
  });

  it("settings: the saved webhook is shown masked, never filled in, and a bad address is refused before sending", async () => {
    ready();
    render(<HealthDashboard />);
    const input = (await screen.findByLabelText(/Alert webhook/)) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toContain("https://hooks.slack.com/…");
    fireEvent.change(input, { target: { value: "http://insecure.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText(/starting with https/)).toBeTruthy();
    expect(sent.some((s) => s.method === "PUT")).toBe(false);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByLabelText("Include people's names in the alert (otherwise only counts)"));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(sent.find((s) => s.method === "PUT")?.body).toEqual({ enabled: true, include_names: true, max_people: 1000 }));
  });
});
