// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewTab } from "./overview-tab";
import { ReviewTab } from "./review-tab";
import { RulesTab } from "./rules-tab";
import { SettingsTab } from "./settings-tab";
import type { StatusData } from "./sync-types";

type Sent = { url: string; method: string; body: Record<string, unknown> | null };
let sent: Sent[];
let answers: Record<string, { status?: number; body: unknown }>;

beforeEach(() => {
  sent = [];
  answers = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      sent.push({ url, method: init?.method ?? "GET", body });
      const a = answers[`${init?.method ?? "GET"} ${url.split("?")[0]}`] ?? { body: {} };
      return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stats = { fetched: 10, creates: 1, updates: 1, deactivates: 0, unchanged: 8, skipped: 0, erasures: 0, base: 10 };
const status = (o: Partial<StatusData["sources"][number]>[] = []): StatusData => ({
  safety_cap_percent: 20,
  cron_configured: false,
  sources: [
    { source: "google", label: "Google Workspace", kind: "directory", configured: false, missing: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_DIRECTORY_ADMIN_EMAIL"], enabled: false, auto_apply: false, pending: null, last_run: null, ...o[0] },
    { source: "hubspot", label: "HubSpot", kind: "crm", configured: true, missing: [], enabled: false, auto_apply: false, pending: null, last_run: null, ...o[1] },
  ],
});

describe("sources overview", () => {
  it("says exactly which variables are missing, offers no preview until configured", () => {
    render(<OverviewTab status={status()} onReview={() => {}} onChanged={() => {}} />);
    const google = screen.getByRole("heading", { name: "Google Workspace" }).closest("li") as HTMLElement;
    expect(within(google).getByText("GOOGLE_SERVICE_ACCOUNT_JSON")).toBeTruthy();
    expect(within(google).getByText("GOOGLE_DIRECTORY_ADMIN_EMAIL")).toBeTruthy();
    expect((within(google).getByRole("button", { name: "Run a preview" }) as HTMLButtonElement).disabled).toBe(true);
    const hub = screen.getByRole("heading", { name: "HubSpot" }).closest("li") as HTMLElement;
    expect((within(hub).getByRole("button", { name: "Run a preview" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a preview opens the review; a server error is shown", async () => {
    const onReview = vi.fn();
    answers["POST /api/sync/preview"] = { body: { preview_id: "pv-1" } };
    render(<OverviewTab status={status()} onReview={onReview} onChanged={() => {}} />);
    const hub = screen.getByRole("heading", { name: "HubSpot" }).closest("li") as HTMLElement;
    fireEvent.click(within(hub).getByRole("button", { name: "Run a preview" }));
    await waitFor(() => expect(onReview).toHaveBeenCalledWith("pv-1"));
    expect(sent[0].body).toEqual({ source: "hubspot" });
    answers["POST /api/sync/preview"] = { status: 409, body: { message: "HubSpot is not set up." } };
    fireEvent.click(within(hub).getByRole("button", { name: "Run a preview" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/HubSpot is not set up/);
  });
});

describe("review", () => {
  const preview = (o: object = {}, refusal: string | null = null, st = "pending") => ({
    preview: { id: "pv-1", source: "google", status: st, trigger: "manual", created_at: "2026-01-01T10:00:00Z", expires_at: "2026-01-02T10:00:00Z", fetched_count: 10, stats, warnings: [], ...o },
    refusal,
    total: 2,
    entries: [
      { kind: "create", email: "new@acme.com", name: "New Person", changes: [{ field: "title", from: "", to: "Engineer" }] },
      { kind: "update", email: "ada@acme.com", name: "Ada", changes: [{ field: "phone", from: "111", to: "222" }] },
    ],
  });
  const open = (p: object) => {
    answers["GET /api/sync/previews/pv-1"] = { body: p };
    return render(<ReviewTab status={status()} previewId="pv-1" onPick={() => {}} onChanged={() => {}} />);
  };

  it("shows the diff with old and new values, and applies only after a second confirmation", async () => {
    open(preview());
    expect((await screen.findAllByText("New Person")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("111").length).toBeGreaterThan(0);
    expect(screen.getAllByText("222").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Apply these changes" }));
    expect(sent.some((s) => s.method === "POST")).toBe(false); // nothing sent yet
    answers["POST /api/sync/previews/pv-1/apply"] = { body: { applied: true, stats: { applied_created: 1, applied_updated: 1, applied_deactivated: 0 } } };
    fireEvent.click(screen.getByRole("button", { name: "Yes, apply" }));
    await waitFor(() => expect(sent.find((s) => s.method === "POST")?.body).toEqual({ confirm: true }));
    expect((await screen.findByText(/Applied: 1 created, 1 updated, 0 deactivated/)).textContent).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply these changes" })).toBeNull();
  });

  it("cancel does nothing", async () => {
    open(preview());
    await screen.findAllByText("New Person");
    fireEvent.click(screen.getByRole("button", { name: "Apply these changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Apply these changes" })).toBeTruthy();
    expect(sent.some((s) => s.method === "POST")).toBe(false);
  });

  it("a refused run shows the reason and cannot be applied", async () => {
    open(preview({ stats: { ...stats, deactivates: 5 } }, "Refused by the safety cap: this would deactivate 5 of 10 people (50 percent)."));
    expect((await screen.findByRole("alert")).textContent).toMatch(/safety cap.*5 of 10/);
    expect((screen.getByRole("button", { name: "Apply these changes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("an old or replaced preview has no apply button", async () => {
    open(preview({}, null, "superseded"));
    await screen.findAllByText("New Person");
    expect(screen.queryByRole("button", { name: "Apply these changes" })).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/replaced by a newer one/);
  });

  it("filters are sent to the server", async () => {
    open(preview());
    await screen.findAllByText("New Person");
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "update" } });
    await waitFor(() => expect(sent.at(-1)?.url).toContain("kind=update"));
    fireEvent.change(screen.getByLabelText("Search name or email"), { target: { value: "ada" } });
    await waitFor(() => expect(sent.at(-1)?.url).toContain("q=ada"));
  });

  it("with no pending preview it says so", () => {
    render(<ReviewTab status={status()} previewId={null} onPick={() => {}} onChanged={() => {}} />);
    expect(screen.getByText(/No preview to review/)).toBeTruthy();
  });
});

describe("rules and mapping", () => {
  const hubSettings = (extra: object = {}) => ({ source: "hubspot", label: "HubSpot", enabled: false, auto_apply: false, allow_blank_overwrite: false, field_policy: { title: "source" }, config: { mapping: [{ from: "jobtitle", to: "title" }, { from: "phone", to: "phone" }] }, configured: true, missing: [], ...extra });

  it("states in words which CRM field overwrites and which only fills", async () => {
    answers["GET /api/sync/sources/hubspot"] = { body: hubSettings() };
    render(<RulesTab status={{ ...status(), sources: [status().sources[1]] }} onChanged={() => {}} />);
    expect((await screen.findByTestId("sentence-0")).textContent).toMatch(/jobtitle\s+overwrites the people field Job title, replacing what is in the directory/);
    expect(screen.getByTestId("sentence-1").textContent).toMatch(/phone\s+fills the people field Phone, only when it is empty/);
    fireEvent.change(screen.getByLabelText("If both have a value", { selector: "#m-pol-1" }), { target: { value: "source" } });
    expect(screen.getByTestId("sentence-1").textContent).toMatch(/overwrites the people field Phone/);
  });

  it("saves the mapping and the per-field policy; rejects a bad custom name before sending", async () => {
    answers["GET /api/sync/sources/hubspot"] = { body: hubSettings() };
    render(<RulesTab status={{ ...status(), sources: [status().sources[1]] }} onChanged={() => {}} />);
    await screen.findByTestId("sentence-0");
    fireEvent.click(screen.getByRole("button", { name: "Add a mapping" }));
    fireEvent.change(document.getElementById("m-from-2") as HTMLInputElement, { target: { value: "booking_link" } });
    fireEvent.change(document.getElementById("m-to-2") as HTMLSelectElement, { target: { value: "__custom" } });
    fireEvent.change(document.getElementById("m-key-2") as HTMLInputElement, { target: { value: "Bad Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findAllByRole("alert"))[0].textContent).toMatch(/lower-case letters/);
    expect(sent.some((s) => s.method === "PUT")).toBe(false);
    fireEvent.change(document.getElementById("m-key-2") as HTMLInputElement, { target: { value: "booking_link" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent.some((s) => s.method === "PUT")).toBe(true));
    const put = sent.find((s) => s.method === "PUT")!;
    expect(put.url).toBe("/api/sync/sources/hubspot");
    expect(put.body).toMatchObject({
      field_policy: { title: "source", phone: "directory", "custom.booking_link": "directory" },
      config: { mapping: [{ from: "jobtitle", to: "title" }, { from: "phone", to: "phone" }, { from: "booking_link", to: "custom.booking_link" }] },
    });
  });

  it("the test button sends the unsaved mapping and lists the mapped values", async () => {
    answers["GET /api/sync/sources/hubspot"] = { body: hubSettings() };
    answers["POST /api/sync/test"] = { body: { found: true, rows: [{ from: "jobtitle", to: "title", found: true, value: "CTO", note: "" }, { from: "phone", to: "phone", found: true, value: "", note: "HubSpot has an empty value here." }], paths: [] } };
    render(<RulesTab status={{ ...status(), sources: [status().sources[1]] }} onChanged={() => {}} />);
    await screen.findByTestId("sentence-0");
    fireEvent.change(screen.getByLabelText("Email to look up"), { target: { value: "ada@acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect((await screen.findByText("CTO")).textContent).toBe("CTO");
    expect(screen.getByText("HubSpot has an empty value here.")).toBeTruthy();
    expect(sent.find((s) => s.url === "/api/sync/test")?.body).toMatchObject({ source: "hubspot", email: "ada@acme.com", config: { mapping: [{ from: "jobtitle", to: "title" }, { from: "phone", to: "phone" }] } });
  });

  it("directory sources show a who-wins choice for every directory field and never a secret field", async () => {
    answers["GET /api/sync/sources/google"] = { body: { source: "google", label: "Google Workspace", enabled: false, auto_apply: false, allow_blank_overwrite: false, field_policy: { title: "directory" }, config: {}, configured: false, missing: [] } };
    render(<RulesTab status={{ ...status(), sources: [status().sources[0]] }} onChanged={() => {}} />);
    expect(await screen.findByLabelText("Job title")).toBeTruthy();
    expect((screen.getByLabelText("Job title") as HTMLSelectElement).value).toBe("directory");
    expect((screen.getByLabelText("Phone") as HTMLSelectElement).value).toBe("source");
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("the generic adapter explains where the secret lives and has no secret input", async () => {
    answers["GET /api/sync/sources/generic"] = { body: { source: "generic", label: "Kimp CRM (generic REST)", enabled: false, auto_apply: false, allow_blank_overwrite: false, field_policy: {}, config: {}, configured: false, missing: ["KIMP_CRM_SECRET"] } };
    const s = status();
    render(<RulesTab status={{ ...s, sources: [{ ...s.sources[1], source: "generic", label: "Kimp CRM (generic REST)" }] }} onChanged={() => {}} />);
    expect((await screen.findByText(/never stored in the browser/)).textContent).toMatch(/KIMP_CRM_SECRET/);
    expect(screen.queryByLabelText(/^(api )?(secret|key|token)/i)).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});

describe("settings", () => {
  it("validates the cap before sending and saves it", async () => {
    answers["GET /api/sync/settings"] = { body: { safety_cap_percent: 20, schedule_note: "" } };
    render(<SettingsTab status={status()} onChanged={() => {}} />);
    const cap = screen.getByLabelText("Largest share allowed (percent)");
    fireEvent.change(cap, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByText(/whole number from 1 to 100/)).textContent).toBeTruthy();
    expect(sent.some((s) => s.method === "PUT")).toBe(false);
    fireEvent.change(cap, { target: { value: "35" } });
    fireEvent.change(screen.getByLabelText(/Note for your team/), { target: { value: "Nightly" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent.find((s) => s.method === "PUT")?.body).toEqual({ safety_cap_percent: 35, schedule_note: "Nightly" }));
  });
  it("says whether the unattended endpoint is on, without showing the secret", () => {
    render(<SettingsTab status={{ ...status(), cron_configured: true }} onChanged={() => {}} />);
    expect(screen.getByRole("status").textContent).toMatch(/endpoint is on/);
  });
});
