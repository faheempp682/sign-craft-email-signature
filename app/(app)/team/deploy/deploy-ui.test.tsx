// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeploymentView } from "./deployment-view";
import { ExchangeTab } from "./exchange-tab";
import { confirmLabel, GmailTab } from "./gmail-tab";
import { RulesTab } from "./rules-tab";

type Sent = { url: string; method: string; body: Record<string, unknown> | null };
let sent: Sent[];
let answers: Record<string, { status?: number; body: unknown } | (() => { status?: number; body: unknown })>;

beforeEach(() => {
  sent = [];
  answers = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const method = init?.method ?? "GET";
      sent.push({ url, method, body });
      const key = `${method} ${url.split("?")[0]}`;
      const a = answers[key] ?? { body: {} };
      const r = typeof a === "function" ? a() : a;
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STATUS_OK = { configured: true, serviceAccountEmail: "sc@p.iam.gserviceaccount.com", clientId: "1234567890", scope: "https://www.googleapis.com/auth/gmail.settings.basic", steps: ["a", "b", "c", "d"] };
const item = (i: number, action: "set" | "replace" | "skip", code = "") => ({ person_id: `p${i}`, email: `p${i}@acme.com`, name: `Person ${i}`, action, code, reason: action === "skip" ? `skipped because ${code}` : action === "set" ? "Will set." : "Replaces the signature they have now.", has_existing: action === "replace" });
const PLAN = {
  items: [item(1, "set"), item(2, "replace"), item(3, "replace"), item(4, "skip", "no_version"), item(5, "skip", "already_current")],
  counts: { total: 5, set: 1, replace: 2, skipped: 1, already_current: 1, actionable: 3 },
  fingerprint: "f".repeat(64),
  blockers: [],
  notHonoured: [{ id: "r1", name: "Replies", reasons: ['message kind "reply": not supported'] }],
  rulesApplied: true,
};

describe("Gmail tab", () => {
  it("shows exactly what to do when the server is not set up, and offers no way to plan", async () => {
    answers["GET /api/deploy/status"] = { body: { ...STATUS_OK, configured: false, steps: ["Create a service account.", "Set GOOGLE_SERVICE_ACCOUNT_JSON.", "Authorise the client ID.", "Pick the scope."] } };
    render(<GmailTab onStarted={() => {}} />);
    expect(await screen.findByText("Gmail deployment is not set up yet")).toBeTruthy();
    expect(screen.getByText("Set GOOGLE_SERVICE_ACCOUNT_JSON.")).toBeTruthy();
    expect(screen.getByText("https://www.googleapis.com/auth/gmail.settings.basic")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /make a plan/i })).toBeNull();
  });

  it("the confirm sentence names the people and the replaced signatures", () => {
    expect(confirmLabel({ set: 25, replace: 12, actionable: 37 })).toBe("Deploy to 37 people, replacing 12 existing signatures");
    expect(confirmLabel({ set: 1, replace: 0, actionable: 1 })).toBe("Deploy to 1 person");
    expect(confirmLabel({ set: 0, replace: 1, actionable: 1 })).toBe("Deploy to 1 person, replacing 1 existing signature");
  });

  it("planning writes nothing; confirming needs the tick, then sends the fingerprint and counts it showed", async () => {
    answers["GET /api/deploy/status"] = { body: STATUS_OK };
    answers["POST /api/deploy/gmail/plan"] = { body: PLAN };
    answers["POST /api/deploy/gmail/deploy"] = { status: 201, body: { id: "dep-1" } };
    const started = vi.fn();
    render(<GmailTab onStarted={started} />);
    fireEvent.click(await screen.findByRole("button", { name: "Make a plan" }));
    const confirm = await screen.findByRole("button", { name: "Deploy to 3 people, replacing 2 existing signatures" });
    expect(sent.filter((s) => s.method === "POST").map((s) => s.url)).toEqual(["/api/deploy/gmail/plan"]);
    expect(screen.getByText(/Gmail keeps one signature per address/)).toBeTruthy();
    expect(screen.getByText(/skipped because no_version/)).toBeTruthy();
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I have read the plan/));
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(started).toHaveBeenCalledWith("dep-1"));
    expect(sent.find((s) => s.url === "/api/deploy/gmail/deploy")!.body).toEqual({ fingerprint: PLAN.fingerprint, set: 1, replace: 2, confirmed: true });
  });

  describe("people with no approved signature", () => {
    const planWith = (noVersion: number) => ({
      ...PLAN,
      items: [item(1, "set"), ...Array.from({ length: noVersion }, (_, i) => item(10 + i, "skip", "no_version")), item(5, "skip", "already_current")],
    });

    it("offers to approve the template for exactly the people listed as having none, only after the tick", async () => {
      answers["GET /api/deploy/status"] = { body: STATUS_OK };
      answers["POST /api/deploy/gmail/plan"] = { body: planWith(2) };
      answers["POST /api/team/defaults"] = { body: { created: 2, already_approved: 0, no_template: 0 } };
      render(<GmailTab onStarted={() => {}} />);
      fireEvent.click(await screen.findByRole("button", { name: "Make a plan" }));
      const group = await screen.findByRole("group", { name: "People without an approved signature" });
      expect(within(group).getByText(/2 people have no approved signature/)).toBeTruthy();
      const button = within(group).getByRole("button", { name: "Approve template signatures" }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(sent.some((x) => x.url === "/api/team/defaults")).toBe(false); // nothing without the tick
      fireEvent.click(within(group).getByRole("checkbox"));
      fireEvent.click(button);
      await waitFor(() => expect(sent.some((x) => x.url === "/api/team/defaults")).toBe(true));
      expect(sent.find((x) => x.url === "/api/team/defaults")!.body).toEqual({ confirm: true, person_ids: ["p10", "p11"] });
      // and the plan is made again so it reflects the new approvals; nothing is deployed
      await waitFor(() => expect(sent.filter((x) => x.url === "/api/deploy/gmail/plan")).toHaveLength(2));
      expect(sent.some((x) => x.url === "/api/deploy/gmail/deploy")).toBe(false);
    });

    it("is not shown when everyone already has an approved signature", async () => {
      answers["GET /api/deploy/status"] = { body: STATUS_OK };
      answers["POST /api/deploy/gmail/plan"] = { body: planWith(0) };
      render(<GmailTab onStarted={() => {}} />);
      fireEvent.click(await screen.findByRole("button", { name: "Make a plan" }));
      await screen.findByText("Person 1");
      expect(screen.queryByRole("group", { name: "People without an approved signature" })).toBeNull();
    });
  });

  it("filters the plan by what happens to people", async () => {
    answers["GET /api/deploy/status"] = { body: STATUS_OK };
    answers["POST /api/deploy/gmail/plan"] = { body: PLAN };
    render(<GmailTab onStarted={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Make a plan" }));
    await screen.findByText("Person 1");
    fireEvent.click(screen.getByRole("button", { name: "Skipped" }));
    const list = screen.getByRole("list", { name: "People in the plan" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("Person 4")).toBeTruthy();
  });

  it("a stale plan is refused: the message shows and the old plan is gone", async () => {
    answers["GET /api/deploy/status"] = { body: STATUS_OK };
    answers["POST /api/deploy/gmail/plan"] = { body: PLAN };
    answers["POST /api/deploy/gmail/deploy"] = { status: 409, body: { error: "stale", message: "Something changed since you reviewed the plan. Nothing was written." } };
    render(<GmailTab onStarted={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Make a plan" }));
    fireEvent.click(await screen.findByLabelText(/I have read the plan/));
    fireEvent.click(screen.getByRole("button", { name: /Deploy to 3 people/ }));
    expect(await screen.findByText(/Nothing was written/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Deploy to 3 people/ })).toBeNull();
  });

  it("a blocker disables confirmation", async () => {
    answers["GET /api/deploy/status"] = { body: STATUS_OK };
    answers["POST /api/deploy/gmail/plan"] = { body: { ...PLAN, blockers: ["Google refused: this service account has not been given domain-wide delegation."] } };
    render(<GmailTab onStarted={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Make a plan" }));
    expect(await screen.findByText(/Deployment cannot start/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Deploy to 3 people/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(/I have read the plan/) as HTMLInputElement).disabled).toBe(true);
  });
});

/* ------------------------------------------------------------------ deployment view */

const dep = (o: Record<string, unknown> = {}) => ({ id: "dep-1", target: "gmail", kind: "deploy", rollback_of: null, status: "succeeded", note: "", total: 4, done: 3, failed: 1, skipped: 0, pending: 0, created_at: "2026-02-01T10:00:00Z", finished_at: "2026-02-01T10:05:00Z", cancelled_at: null, ...o });
const row = (i: number, o: Record<string, unknown> = {}) => ({ id: `i${i}`, email: `p${i}@acme.com`, person_name: `Person ${i}`, action: "replace", status: "done", error_code: "", error: "", attempts: 1, previous_known: true, previous_truncated: false, ...o });

describe("deployment view", () => {
  it("runs the queue until the deployment finishes, then loads the results", async () => {
    let status = "running";
    answers["GET /api/deploy/deployments/dep-1"] = () => ({ body: { deployment: dep({ status, pending: status === "running" ? 4 : 0, done: status === "running" ? 0 : 4, failed: 0, total: 4 }), items: [row(1)], total: 1 } });
    let runs = 0;
    answers["POST /api/deploy/deployments/dep-1/run"] = () => {
      runs++;
      if (runs === 2) status = "succeeded";
      return { body: { batch: { throttled: false, setupProblem: false }, deployment: dep({ status: runs === 2 ? "succeeded" : "running", pending: runs === 2 ? 0 : 2, done: runs === 2 ? 4 : 2, failed: 0 }), retryAfterMs: 0 } };
    };
    render(<DeploymentView id="dep-1" onOpen={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("Finished")).toBeTruthy());
    expect(runs).toBe(2);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("4");
  });

  it("stops and explains when Google has not authorised the service account", async () => {
    answers["GET /api/deploy/deployments/dep-1"] = { body: { deployment: dep({ status: "running", pending: 4, done: 0, failed: 0 }), items: [], total: 0 } };
    answers["POST /api/deploy/deployments/dep-1/run"] = { body: { batch: { throttled: false, setupProblem: true }, deployment: dep({ status: "running", pending: 3, done: 0, failed: 1 }), retryAfterMs: 0 } };
    render(<DeploymentView id="dep-1" onOpen={() => {}} onBack={() => {}} />);
    expect(await screen.findByText(/not authorised for this scope/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(sent.filter((s) => s.url.endsWith("/run"))).toHaveLength(1);
  });

  it("shows failures with their reason and retries only the failed", async () => {
    answers["GET /api/deploy/deployments/dep-1"] = { body: { deployment: dep({ status: "partial" }), items: [row(1), row(2, { status: "failed", error: "Gmail has no mailbox for this address." })], total: 2 } };
    answers["POST /api/deploy/deployments/dep-1/retry"] = { body: { requeued: 1 } };
    render(<DeploymentView id="dep-1" onOpen={() => {}} onBack={() => {}} />);
    expect(await screen.findByText("Gmail has no mailbox for this address.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry the 1 that failed" }));
    await waitFor(() => expect(sent.some((s) => s.url.endsWith("/retry"))).toBe(true));
  });

  it("rollback: counts only what has a complete saved copy, needs the tick, and sends the count it showed", async () => {
    answers["GET /api/deploy/deployments/dep-1"] = () => ({
      body: { deployment: dep({ failed: 0, done: 3, total: 3 }), items: [row(1), row(2), row(3, { previous_truncated: true })], total: 3 },
    });
    answers["POST /api/deploy/deployments/dep-1/rollback"] = { status: 201, body: { id: "rb-1" } };
    const open = vi.fn();
    render(<DeploymentView id="dep-1" onOpen={open} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Roll back…" }));
    expect(await screen.findByText(/1 cannot be restored because no complete copy was saved/)).toBeTruthy();
    const go = screen.getByRole("button", { name: "Restore 2 signatures" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Yes, restore these signatures."));
    fireEvent.click(go);
    await waitFor(() => expect(open).toHaveBeenCalledWith("rb-1"));
    expect(sent.find((s) => s.url.endsWith("/rollback"))!.body).toEqual({ expected: 2, confirmed: true });
  });

  it("a rollback deployment cannot itself be rolled back", async () => {
    answers["GET /api/deploy/deployments/dep-1"] = { body: { deployment: dep({ kind: "rollback", rollback_of: "dep-0", failed: 0 }), items: [row(1)], total: 1 } };
    render(<DeploymentView id="dep-1" onOpen={() => {}} onBack={() => {}} />);
    await screen.findByText("Rollback to Gmail");
    expect(screen.queryByRole("button", { name: "Roll back…" })).toBeNull();
  });
});

/* ----------------------------------------------------------------------- exchange */

describe("Exchange tab", () => {
  const OUT = {
    script: "# SignCraft script\nNew-TransportRule ...",
    removal_script: "# remove",
    rules: [{ index: 1, name: "SignCraft - 01 R", templateName: "Std", sentence: 'Default 1 "Std (default)": append "Std" when the sender is inside your organization (FromScope InOrganization).', unverified: ["reply detection uses the In-Reply-To header"], htmlLength: 2400 }],
    warnings: ["A warning"],
    omitted: [{ name: "Fwd", reason: "Exchange cannot express it." }],
    summary: ["Creates or updates 1 mail flow rule.", "Starts in Audit mode."],
    recorded: "x",
  };
  it("labels the script generated-not-run, offers copy and download, and shows the plain-language summary", async () => {
    answers["POST /api/deploy/exchange/script"] = { body: OUT };
    render(<ExchangeTab />);
    expect(screen.getAllByText(/Generated, not run by SignCraft/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Generate script" }));
    expect(await screen.findByText("Starts in Audit mode.")).toBeTruthy();
    expect(screen.getByText("Unverified")).toBeTruthy();
    expect(screen.getByText(/Exchange cannot express it/)).toBeTruthy();
    expect(screen.getByText(/New-TransportRule/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Download" })).toHaveLength(2);
    expect(sent.find((s) => s.url.endsWith("/script"))!.body).toMatchObject({ mode: "Audit", fallback: "Ignore", priority: "end" });
  });
  it("copies to the clipboard", async () => {
    answers["POST /api/deploy/exchange/script"] = { body: OUT };
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ExchangeTab />);
    fireEvent.click(screen.getByRole("button", { name: "Generate script" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Copy" }))[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(OUT.script));
  });
  it("shows the reason when it cannot generate (for example a size or image problem)", async () => {
    answers["POST /api/deploy/exchange/script"] = { status: 422, body: { error: "cannot_generate", message: 'The signature for template "Std" is 6,000 characters, over Exchange\'s 5,000 character limit for disclaimer text.' } };
    render(<ExchangeTab />);
    fireEvent.click(screen.getByRole("button", { name: "Generate script" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/over Exchange's 5,000 character limit/)).toBeTruthy();
    expect(screen.queryByText("What this will do")).toBeNull();
  });
  it("rejects a bad fixed priority without calling the server", async () => {
    render(<ExchangeTab />);
    fireEvent.change(screen.getByLabelText("Rule priority"), { target: { value: "number" } });
    fireEvent.change(screen.getByLabelText("Starting priority number"), { target: { value: "-3" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate script" }));
    expect(await screen.findByText(/whole number, 0 or more/)).toBeTruthy();
    expect(sent.filter((s) => s.method === "POST")).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- rules */

const T1 = "9f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const RULE = { id: "r1", name: "External replies", message_kind: "reply", audience: "external", departments: ["Sales"], priority: 100, template_id: T1, is_active: true, created_at: "2026-02-01T00:00:00Z" };
const RULES = { rules: [RULE], templates: [{ id: T1, name: "Short", departments: [], is_active: true }], departments: ["Sales", "Ops"] };

describe("Rules tab", () => {
  it("explains each rule in a sentence and says what each target can honour", async () => {
    answers["GET /api/deploy/rules"] = { body: RULES };
    render(<RulesTab />);
    expect(await screen.findByText('Use "Short" for replies to people outside the organization from people in Sales. Priority 100.')).toBeTruthy();
    expect(screen.getByText("not applied")).toBeTruthy(); // Gmail cannot follow a reply rule
    expect(screen.getByText("included, unverified")).toBeTruthy();
  });

  it("validates the form, shows a live sentence, and saves a clean body", async () => {
    answers["GET /api/deploy/rules"] = { body: RULES };
    answers["POST /api/deploy/rules"] = { status: 201, body: { rule: RULE } };
    render(<RulesTab />);
    fireEvent.click(await screen.findByRole("button", { name: "New rule" }));
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    expect(await screen.findByText("Give the rule a name.")).toBeTruthy();
    expect(sent.filter((s) => s.method === "POST")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ops internal" } });
    fireEvent.change(screen.getByLabelText("Sent to"), { target: { value: "internal" } });
    fireEvent.change(screen.getByLabelText(/From people in these departments/), { target: { value: "Ops; Support" } });
    fireEvent.change(screen.getByLabelText("Priority (higher wins)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    expect(await screen.findByText("Priority is a whole number from 0 to 1000.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Priority (higher wins)"), { target: { value: "70" } });
    expect(screen.getByText('Use "Short" for any message to people inside the organization from people in Ops or Support. Priority 70.')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(sent.some((s) => s.method === "POST" && s.url === "/api/deploy/rules")).toBe(true));
    expect(sent.find((s) => s.method === "POST" && s.url === "/api/deploy/rules")!.body).toEqual({ name: "Ops internal", template_id: T1, message_kind: "any", audience: "internal", departments: ["Ops", "Support"], priority: 70, is_active: true });
  });

  it("the test panel shows the winner and what Gmail and Exchange would really do", async () => {
    answers["GET /api/deploy/rules"] = { body: RULES };
    answers["GET /api/team/people"] = { body: { people: [{ id: "pp", full_name: "Ann Lee", email: "a@acme.com", department: "Sales" }] } };
    answers["POST /api/deploy/rules/test"] = {
      body: {
        winner: { rule_name: "External replies", template_name: "Short", implicit: false },
        gmail: { rule_name: "Standard", template_name: "Standard", implicit: true, same_as_winner: false },
        exchange: { rule_name: "External replies", template_name: "Short", implicit: false, same_as_winner: true, unverified: true },
      },
    };
    render(<RulesTab />);
    await screen.findByText("External replies");
    await waitFor(() => expect((screen.getByLabelText("Person") as HTMLSelectElement).value).toBe("pp"));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText(/Gmail cannot follow this rule/)).toBeTruthy();
    expect(screen.getByText(/new versus reply detection, which is unverified/)).toBeTruthy();
    expect(sent.find((s) => s.url === "/api/deploy/rules/test")!.body).toEqual({ person_id: "pp", kind: "reply", audience: "external" });
  });

  it("asks for a brand template first when there is none", async () => {
    answers["GET /api/deploy/rules"] = { body: { rules: [], templates: [], departments: [] } };
    render(<RulesTab />);
    expect(await screen.findByText(/Create a brand template first/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "New rule" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
