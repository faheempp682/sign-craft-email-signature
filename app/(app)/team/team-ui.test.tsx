// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { PRESETS } from "@/lib/presets";
import { fieldKey } from "@/lib/team/template";
import type { Mine } from "@/lib/team/mine";
import { ApprovalsTab } from "./approvals-tab";
import { ImportTab } from "./import-tab";
import { MineForm } from "./mine/mine-form";

type Sent = { url: string; method: string; body: Record<string, unknown> | null };
let sent: Sent[];
let answers: Record<string, { status?: number; body: unknown }>;

beforeEach(() => {
  sent = [];
  answers = {};
  refresh.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      sent.push({ url, method: init?.method ?? "GET", body });
      const key = `${init?.method ?? "GET"} ${url.split("?")[0]}${body?.mode ? `#${body.mode}` : ""}`;
      const a = answers[key] ?? { body: {} };
      return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------- import */

const MESSY = "E-mail;Name;Dept\r\nann@x.com;Ann;Sales\r\nnot-an-email;Bob;Ops\r\n";
const file = (text: string, name = "people.csv") => new File([text], name, { type: "text/csv" });
const preview = { fatal: null, headers: ["E-mail", "Name", "Dept"], delimiter: ";", sample: [["ann@x.com", "Ann", "Sales"]], mapping: { 0: "email", 1: "full_name", 2: "department" }, totalRows: 2 };
const dryWithErrors = {
  fatal: null, totalRows: 2, validCount: 1, creates: 1, updates: 0, rowsWithErrors: 1, moreErrors: 0,
  errors: [{ row: 3, field: "email", message: "Enter a valid email address." }],
  preview: [{ row: 2, action: "create", person: { email: "ann@x.com", full_name: "Ann", title: "", department: "Sales" } }],
};

async function upload(text = MESSY) {
  render(<ImportTab onDone={() => {}} />);
  fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file(text)] } });
  await screen.findByText("Match the columns");
}

describe("CSV import screen", () => {
  beforeEach(() => {
    answers["GET /api/team/imports"] = { body: { imports: [{ id: "i1", filename: "old.csv", source: "csv", total_rows: 5, created: 4, updated: 1, skipped: 0, created_at: "2026-01-02T10:00:00Z" }] } };
    answers["POST /api/team/import#preview"] = { body: preview };
    answers["POST /api/team/import#dry-run"] = { body: dryWithErrors };
    answers["POST /api/team/import#commit"] = { body: { import_id: "i2", created: 1, updated: 0, skipped: 1 } };
  });

  it("shows the suggested mapping with a labelled select per column and the detected delimiter", async () => {
    await upload();
    expect(screen.getByText(/separated by semicolons/)).toBeTruthy();
    expect((screen.getByLabelText("Use column E-mail as") as HTMLSelectElement).value).toBe("email");
    expect((screen.getByLabelText("Use column Name as") as HTMLSelectElement).value).toBe("full_name");
    expect(screen.getByText("old.csv")).toBeTruthy(); // history
  });

  it("sends the file text to the server for preview, never a parsed result", async () => {
    await upload();
    const p = sent.find((s) => s.body?.mode === "preview")!;
    expect(p.body!.csv).toBe(MESSY);
  });

  it("lets the admin change a mapping, which is sent with the dry run", async () => {
    await upload();
    fireEvent.change(screen.getByLabelText("Use column Dept as"), { target: { value: "title" } });
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    await screen.findByText("Check result");
    const d = sent.find((s) => s.body?.mode === "dry-run")!;
    expect(d.body!.mapping).toEqual({ "0": "email", "1": "full_name", "2": "title" });
  });

  it("reports row-level errors and blocks the import until the admin chooses to skip them", async () => {
    await upload();
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    await screen.findByText("Check result");
    const table = screen.getByRole("table");
    expect(within(table).getByText("3")).toBeTruthy();
    expect(within(table).getByText("Enter a valid email address.")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Import 1 person" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/skip the 1 with errors/));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await screen.findByText(/Import finished: 1 added, 0 updated, 1 skipped/);
    const c = sent.find((s) => s.body?.mode === "commit")!;
    expect(c.body).toMatchObject({ skip_invalid: true, filename: "people.csv" });
  });

  it("refuses a file over 2 MB without sending it", async () => {
    render(<ImportTab onDone={() => {}} />);
    const big = new File(["x"], "big.csv");
    Object.defineProperty(big, "size", { value: 2 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [big] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/larger than 2 MB/);
    expect(sent.some((s) => s.url === "/api/team/import")).toBe(false);
  });

  it("shows the server's message when the file cannot be read", async () => {
    answers["POST /api/team/import#preview"] = { body: { ...preview, fatal: "The file has more than 5000 people. Split it into smaller files." } };
    render(<ImportTab onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file(MESSY)] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/5000/);
    expect(screen.queryByText("Match the columns")).toBeNull();
  });
});

/* --------------------------------------------------------------------- mine */

const doc = PRESETS[0].doc;
const idIdx = doc.blocks.findIndex((b) => b.type === "identity");
const person = { id: "p1", email: "ann@x.com", full_name: "Ann Lee", title: "Engineer", department: "Eng", phone: "+44 1", mobile: "", location: "", first_name: "", last_name: "", custom: {} };
const mine = (over: Partial<Extract<Mine, { state: "ok" }>> = {}): Extract<Mine, { state: "ok" }> => ({
  state: "ok",
  orgId: "o1",
  person,
  template: { id: "t1", name: "Company signature", spec: { doc, lock: { editable: [fieldKey(idIdx, "title")] }, field_map: { [fieldKey(idIdx, "name")]: "full_name", [fieldKey(idIdx, "title")]: "title" } } },
  requireApproval: false,
  approved: null,
  pending: null,
  history: [],
  ...over,
});

describe("My signature form", () => {
  it("offers only the unlocked fields, prefilled from the directory", () => {
    render(<MineForm mine={mine()} />);
    const title = screen.getByLabelText("Job title") as HTMLInputElement;
    expect(title.value).toBe("Engineer");
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByLabelText("Company")).toBeNull();
    expect(screen.getByText(/Set by your organization/).textContent).toMatch(/Company/);
  });

  it("sends only the fields that changed, and shows the preview", async () => {
    answers["POST /api/team/mine"] = { status: 201, body: { id: "v1", status: "approved" } };
    render(<MineForm mine={mine()} />);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // nothing changed yet
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Chief Wizard" } });
    expect(save.disabled).toBe(false);
    expect(screen.getByTitle("Preview of your signature").getAttribute("srcdoc")).toContain("Chief Wizard");
    fireEvent.click(save);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent.find((s) => s.url === "/api/team/mine")!.body).toEqual({ values: { [fieldKey(idIdx, "title")]: "Chief Wizard" } });
  });

  it("says the change will be checked when approval is required, and locks the form while one is pending", () => {
    const { unmount } = render(<MineForm mine={mine({ requireApproval: true })} />);
    expect(screen.getByRole("button", { name: "Send for approval" })).toBeTruthy();
    unmount();
    const pending = { id: "v", version_no: 2, status: "pending" as const, values_json: { [fieldKey(idIdx, "title")]: "Waiting" }, created_at: "2026-01-02T10:00:00Z", reviewed_at: null, review_note: "" };
    render(<MineForm mine={mine({ requireApproval: true, pending, history: [pending] })} />);
    expect(screen.getByRole("status").textContent).toMatch(/waiting for review/);
    expect((screen.getByLabelText("Job title") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Send for approval" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows why the last change was rejected", () => {
    const rejected = { id: "v", version_no: 1, status: "rejected" as const, values_json: {}, created_at: "2026-01-02T10:00:00Z", reviewed_at: "2026-01-03T10:00:00Z", review_note: "Use the full title" };
    render(<MineForm mine={mine({ history: [rejected] })} />);
    expect(screen.getByRole("alert").textContent).toMatch(/Use the full title/);
  });

  it("shows the server's refusal", async () => {
    answers["POST /api/team/mine"] = { status: 400, body: { message: "Job title can be at most 100 characters." } };
    render(<MineForm mine={mine()} />);
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/at most 100/);
    expect(refresh).not.toHaveBeenCalled();
  });
});

/* ----------------------------------------------------------------- approvals */

const snapshot = { name: "T", doc, lock: { editable: [fieldKey(idIdx, "title")] }, field_map: { [fieldKey(idIdx, "name")]: "full_name" } };
const pendingVersion = { id: "v1", version_no: 1, status: "pending", values_json: { [fieldKey(idIdx, "title")]: "Chief Wizard" }, template_snapshot: snapshot, created_at: "2026-01-02T10:00:00Z", reviewed_at: null, review_note: "", people: { ...person } };

describe("Approvals queue", () => {
  beforeEach(() => {
    answers["GET /api/team/approvals"] = { body: { versions: [pendingVersion] } };
    answers["POST /api/team/approvals/v1"] = { body: { ok: true } };
  });

  it("shows what changed and a preview, and approves", async () => {
    render(<ApprovalsTab />);
    const card = await screen.findByRole("article", { name: "Change by Ann Lee" });
    expect(within(card).getByText("Chief Wizard")).toBeTruthy();
    expect(within(card).getByTitle("Signature of Ann Lee").getAttribute("srcdoc")).toContain("Chief Wizard");
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(sent.some((s) => s.url === "/api/team/approvals/v1")).toBe(true));
    expect(sent.find((s) => s.url === "/api/team/approvals/v1")!.body).toEqual({ decision: "approve", note: "" });
  });

  it("will not reject without a reason, then sends it", async () => {
    render(<ApprovalsTab />);
    const card = await screen.findByRole("article", { name: "Change by Ann Lee" });
    fireEvent.click(within(card).getByRole("button", { name: "Reject" }));
    fireEvent.click(within(card).getByRole("button", { name: "Confirm rejection" }));
    expect(within(card).getByText("Tell them why, so they can fix it.")).toBeTruthy();
    expect(sent.some((s) => s.url === "/api/team/approvals/v1")).toBe(false);
    fireEvent.change(within(card).getByLabelText(/Reason/), { target: { value: "Wrong title" } });
    fireEvent.click(within(card).getByRole("button", { name: "Confirm rejection" }));
    await waitFor(() => expect(sent.some((s) => s.url === "/api/team/approvals/v1")).toBe(true));
    expect(sent.find((s) => s.url === "/api/team/approvals/v1")!.body).toEqual({ decision: "reject", note: "Wrong title" });
  });

  it("shows the database's refusal (already reviewed elsewhere)", async () => {
    answers["POST /api/team/approvals/v1"] = { status: 409, body: { message: "That submission has already been reviewed." } };
    render(<ApprovalsTab />);
    const card = await screen.findByRole("article", { name: "Change by Ann Lee" });
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    expect((await within(card).findByRole("alert")).textContent).toMatch(/already been reviewed/);
  });
});
