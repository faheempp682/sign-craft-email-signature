import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Q = { table: string; op?: string; args?: unknown[]; filters: unknown[][] };

const state = vi.hoisted(() => ({
  user: { id: "admin-1", email: "boss@example.com", email_confirmed_at: "x" } as null | { id: string; email: string; email_confirmed_at: string },
  role: "admin",
  features: { health_monitor: true } as Record<string, boolean>,
  queries: [] as Q[],
  rpcs: [] as { fn: string; args: Record<string, unknown> | undefined; client: string }[],
  answer: (() => ({ data: null, error: null })) as (q: Q) => { data: unknown; error: unknown },
  rpcAnswer: (() => ({ data: null, error: null })) as (fn: string, args?: Record<string, unknown>) => { data: unknown; error: unknown },
  admin: true,
}));

function builder(table: string) {
  const q: Q = { table, filters: [] };
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") {
          state.queries.push(q);
          return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(state.answer(q)).then(ok, bad);
        }
        return (...args: unknown[]) => {
          if (["select", "insert", "update", "upsert", "delete"].includes(prop)) {
            if (!q.op || (q.op === "select" && prop !== "select")) {
              q.op = prop;
              q.args = args;
            }
          } else q.filters.push([prop, ...args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

const makeClient = (name: string) => ({
  from: (table: string) => builder(table),
  rpc: async (fn: string, args?: Record<string, unknown>) => {
    state.rpcs.push({ fn, args, client: name });
    if (fn === "current_app_role") return { data: state.role, error: null };
    if (fn === "feature_enabled") return { data: state.features[String(args?.p_feature)] ?? false, error: null };
    return state.rpcAnswer(fn, args);
  },
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => makeClient("user"), getUser: async () => state.user }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => (state.admin ? makeClient("service") : null) }));

import { GET as getFindings } from "./findings/route";
import { POST as ack } from "./findings/[id]/acknowledge/route";
import { PUT as putSettings } from "./settings/route";
import { GET as getStatus } from "./status/route";
import { GET as getSummary } from "./summary/route";
import { POST as check } from "./check/route";
import { POST as cron } from "./run/route";

const ID = "11111111-2222-3333-4444-555555555555";
const ORIGIN = "http://localhost:3200";
const req = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${url}`, { method, headers: { "content-type": "application/json", host: "localhost:3200", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (o: object) => ({ params: Promise.resolve(o) }) as never;
const body = async (r: Response) => (await r.json()) as Record<string, unknown>;

const SA = (() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  return JSON.stringify({ client_email: "sa@proj.iam.gserviceaccount.com", private_key: privateKey, client_id: "123456789012345678901" });
})();

function answerWith(extra: (q: Q) => { data: unknown; error: unknown } | undefined = () => undefined) {
  state.answer = (q) => extra(q) ?? (q.table === "memberships" ? { data: [{ org_id: "org-1" }], error: null } : { data: q.op === "select" ? [] : null, error: null });
}

beforeEach(() => {
  state.user = { id: "admin-1", email: "boss@example.com", email_confirmed_at: "x" };
  state.role = "admin";
  state.features = { health_monitor: true };
  state.queries = [];
  state.rpcs = [];
  state.admin = true;
  state.rpcAnswer = () => ({ data: null, error: null });
  answerWith();
  for (const k of ["HEALTH_CRON_SECRET", "SYNC_CRON_SECRET", "GOOGLE_SERVICE_ACCOUNT_JSON"]) vi.stubEnv(k, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("authorization on every admin route", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["GET status", () => getStatus(req("GET", "/api/health/status"))],
    ["GET findings", () => getFindings(req("GET", "/api/health/findings"))],
    ["PUT settings", () => putSettings(req("PUT", "/api/health/settings", { enabled: true, include_names: false, max_people: 10 }))],
    ["POST ack", () => ack(req("POST", `/api/health/findings/${ID}/acknowledge`, { note: "ok" }), ctx({ id: ID }))],
    ["POST check", () => check(req("POST", "/api/health/check"))],
  ];
  for (const [name, fn] of calls) {
    it(`${name}: 401 signed out, 403 for a member, 403 with the feature off, nothing queried`, async () => {
      state.user = null;
      expect((await fn()).status).toBe(401);
      state.user = { id: "u", email: "u@example.com", email_confirmed_at: "x" };
      state.role = "member";
      expect((await fn()).status).toBe(403);
      state.role = "admin";
      state.features = { health_monitor: false };
      expect((await fn()).status).toBe(403);
      expect(state.queries.filter((q) => q.table.startsWith("health_"))).toEqual([]);
      expect(state.rpcs.filter((r) => r.fn.startsWith("health_"))).toEqual([]);
    });
  }
  it("writes refuse a foreign origin", async () => {
    const r = await putSettings(req("PUT", "/api/health/settings", { enabled: true, include_names: false, max_people: 10 }, { origin: "https://evil.example.com" }));
    expect(r.status).toBe(403);
    expect(state.rpcs.some((x) => x.fn === "health_save_settings")).toBe(false);
  });
});

describe("summary (the badge)", () => {
  it("is 0 for signed-out people, when the feature is off, and the count otherwise", async () => {
    state.user = null;
    expect((await getSummary()).status).toBe(401);
    state.user = { id: "u", email: "u@example.com", email_confirmed_at: "x" };
    state.features = { health_monitor: false };
    expect(await body(await getSummary())).toEqual({ open: 0 });
    expect(state.queries.filter((q) => q.table === "health_findings")).toEqual([]);
    state.features = { health_monitor: true };
    const answer = state.answer;
    state.answer = (q) => (q.table === "health_findings" ? ({ data: null, error: null, count: 7 } as never) : answer(q));
    // the count arrives on the awaited result
    expect(await body(await getSummary())).toEqual({ open: 7 });
    const q = state.queries.find((x) => x.table === "health_findings")!;
    expect(q.filters).toContainEqual(["eq", "status", "open"]);
  });
  it("a database error shows 0, not an error badge", async () => {
    state.answer = () => ({ data: null, error: { message: "x" } });
    expect(await body(await getSummary())).toEqual({ open: 0 });
  });
});

describe("settings, acknowledge, findings, status", () => {
  it("settings: strict body, webhook kept when not sent, removed when empty", async () => {
    expect((await putSettings(req("PUT", "/api/health/settings", { enabled: true, include_names: false, max_people: 5000 }))).status).toBe(400);
    expect((await putSettings(req("PUT", "/api/health/settings", { enabled: true, include_names: false, max_people: 10, extra: 1 }))).status).toBe(400);
    answerWith((q) => (q.table === "health_settings" ? { data: { webhook_url: "https://hooks.example.com/keep" }, error: null } : undefined));
    expect((await putSettings(req("PUT", "/api/health/settings", { enabled: true, include_names: false, max_people: 10 }))).status).toBe(200);
    expect(state.rpcs.find((r) => r.fn === "health_save_settings")!.args).toMatchObject({ p_webhook_url: "https://hooks.example.com/keep", p_org: "org-1" });
    state.rpcs = [];
    await putSettings(req("PUT", "/api/health/settings", { enabled: false, include_names: true, max_people: 10, webhook_url: "" }));
    expect(state.rpcs.find((r) => r.fn === "health_save_settings")!.args).toMatchObject({ p_webhook_url: null, p_include_names: true, p_enabled: false });
  });
  it("settings: the database refusing the address is a 400 with our message", async () => {
    state.rpcAnswer = () => ({ data: null, error: { code: "HM003", message: "The webhook address must be a full https address." } });
    const r = await putSettings(req("PUT", "/api/health/settings", { enabled: true, include_names: false, max_people: 10, webhook_url: "http://x.example.com" }));
    expect(r.status).toBe(400);
    expect((await body(r)).message).toMatch(/https/);
  });
  it("acknowledge: needs a note and a real id; conflicts map to 409; permission errors to 403", async () => {
    expect((await ack(req("POST", "/api/health/findings/nope/acknowledge", { note: "x" }), ctx({ id: "nope" }))).status).toBe(404);
    expect((await ack(req("POST", `/api/health/findings/${ID}/acknowledge`, { note: "  " }), ctx({ id: ID }))).status).toBe(400);
    expect((await ack(req("POST", `/api/health/findings/${ID}/acknowledge`, { note: "ok" }), ctx({ id: ID }))).status).toBe(200);
    expect(state.rpcs.find((r) => r.fn === "health_acknowledge")!.args).toEqual({ p_finding: ID, p_note: "ok" });
    state.rpcAnswer = () => ({ data: null, error: { code: "HM004", message: "Only an open finding can be acknowledged." } });
    expect((await ack(req("POST", `/api/health/findings/${ID}/acknowledge`, { note: "ok" }), ctx({ id: ID }))).status).toBe(409);
    state.rpcAnswer = () => ({ data: null, error: { code: "HM006", message: "internal detail" } });
    const r = await ack(req("POST", `/api/health/findings/${ID}/acknowledge`, { note: "ok" }), ctx({ id: ID }));
    expect(r.status).toBe(403);
    expect(JSON.stringify(await body(r))).not.toContain("internal detail");
  });
  it("findings: always scoped to the caller's organization; filters only from the allowed values", async () => {
    await getFindings(req("GET", "/api/health/findings?status=open&kind=edited&page=2"));
    const q = state.queries.find((x) => x.table === "health_findings")!;
    expect(q.filters).toEqual(expect.arrayContaining([["eq", "org_id", "org-1"], ["eq", "status", "open"], ["eq", "kind", "edited"]]));
    state.queries = [];
    await getFindings(req("GET", "/api/health/findings?status=drop%20table&kind=x"));
    const q2 = state.queries.find((x) => x.table === "health_findings")!;
    expect(q2.filters.some((f) => f[1] === "status" || f[1] === "kind")).toBe(false);
  });
  it("status: names of missing variables, a masked webhook and no secrets", async () => {
    vi.stubEnv("HEALTH_CRON_SECRET", "x".repeat(40));
    answerWith((q) => (q.table === "health_settings" ? { data: { enabled: true, webhook_url: "https://hooks.slack.com/services/T0/B0/TOPSECRET", webhook_include_names: false, max_people: 200 }, error: null } : undefined));
    const text = await (await getStatus(req("GET", "/api/health/status"))).text();
    expect(text).not.toContain("TOPSECRET");
    expect(text).not.toContain("x".repeat(40));
    const j = JSON.parse(text) as { setup: { missing: string[]; unattended_missing: string[] }; settings: { webhook_masked: string; max_people: number } };
    expect(j.setup.missing).toEqual(["GOOGLE_SERVICE_ACCOUNT_JSON"]);
    expect(j.setup.unattended_missing).toEqual(["SUPABASE_SERVICE_ROLE_KEY"]);
    expect(j.settings).toMatchObject({ webhook_masked: "https://hooks.slack.com/…", max_people: 200 });
  });
  it("check now: 503 with the exact message when the service account is not set", async () => {
    const r = await check(req("POST", "/api/health/check"));
    expect(r.status).toBe(503);
    expect((await body(r)).message).toMatch(/GOOGLE_SERVICE_ACCOUNT_JSON/);
    expect(state.rpcs.some((x) => x.fn === "health_start_run")).toBe(false);
  });
  it("check now: starts through the user entry points (never the service ones), and nothing is written to Gmail", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", SA);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    state.rpcAnswer = (fn) => (fn === "health_start_run" ? { data: { id: ID, cursor: null, checked: 0, status: "running" }, error: null } : { data: [], error: null });
    const r = await check(req("POST", "/api/health/check"));
    expect(r.status).toBe(200);
    expect(await body(r)).toMatchObject({ run_id: ID, done: true, checked: 0, alert: "none" });
    const names = state.rpcs.map((x) => `${x.client}:${x.fn}`).filter((x) => x.includes("health_"));
    expect(names).toEqual(expect.arrayContaining(["user:health_start_run", "user:health_candidates", "user:health_finish"]));
    expect(names.some((n) => n.includes("_service"))).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("unattended run (cron)", () => {
  const SECRET = "h".repeat(40);
  const call = (headers: Record<string, string> = {}) => cron(new Request(`${ORIGIN}/api/health/run`, { method: "POST", headers }));
  const auth = { authorization: `Bearer ${SECRET}` };

  it("is off (503) without a secret of at least 32 characters, and refuses missing or wrong ones (401)", async () => {
    expect((await call(auth)).status).toBe(503);
    vi.stubEnv("HEALTH_CRON_SECRET", "short");
    expect((await call({ authorization: "Bearer short" })).status).toBe(503);
    vi.stubEnv("HEALTH_CRON_SECRET", "h".repeat(31));
    expect((await call({ authorization: `Bearer ${"h".repeat(31)}` })).status).toBe(503);
    vi.stubEnv("HEALTH_CRON_SECRET", SECRET);
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ authorization: SECRET })).status).toBe(401);
    expect((await call({ authorization: `Bearer ${SECRET}x` })).status).toBe(401);
    expect(state.queries).toEqual([]);
    expect(state.rpcs).toEqual([]);
  });
  it("the sync secret does not open it", async () => {
    vi.stubEnv("SYNC_CRON_SECRET", SECRET);
    expect((await call(auth)).status).toBe(503);
  });
  it("needs the service role key and the Gmail service account", async () => {
    vi.stubEnv("HEALTH_CRON_SECRET", SECRET);
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", SA);
    state.admin = false;
    expect((await call(auth)).status).toBe(503);
    state.admin = true;
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "");
    expect((await call(auth)).status).toBe(503);
  });
  it("needs no browser session; visits enabled organizations with the service entry points only; the answer has no names or emails", async () => {
    vi.stubEnv("HEALTH_CRON_SECRET", SECRET);
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", SA);
    state.user = null; // no session at all
    state.rpcAnswer = (fn) => {
      if (fn === "health_enabled_orgs_service") return { data: ["org-a", "org-b"], error: null };
      if (fn === "health_start_run_service") return { data: { id: ID, cursor: null, checked: 0, status: "running" }, error: null };
      return { data: [], error: null };
    };
    const r = await call(auth);
    expect(r.status).toBe(200);
    const text = await r.text();
    const j = JSON.parse(text) as { ran: number; results: { status: string; run_id: string }[] };
    expect(j.ran).toBe(2);
    expect(j.results.map((x) => x.status)).toEqual(["completed", "completed"]);
    expect(text).not.toMatch(/@|org-a|Ada/);
    expect(state.rpcs.every((x) => x.client === "service")).toBe(true);
    expect(state.rpcs.filter((x) => x.fn.startsWith("health_")).every((x) => x.fn.endsWith("_service"))).toBe(true);
  });
  it("one organization failing does not stop the others, and the error text is not echoed", async () => {
    vi.stubEnv("HEALTH_CRON_SECRET", SECRET);
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", SA);
    state.rpcAnswer = (fn, args) => {
      if (fn === "health_enabled_orgs_service") return { data: ["org-a", "org-b"], error: null };
      if (fn === "health_start_run_service") return args?.p_org === "org-a" ? { data: null, error: { code: "XX000", message: "secret db detail" } } : { data: { id: ID, cursor: null, checked: 0, status: "running" }, error: null };
      return { data: [], error: null };
    };
    const r = await call(auth);
    const text = await r.text();
    expect(JSON.parse(text).results.map((x: { status: string }) => x.status)).toEqual(["error", "completed"]);
    expect(text).not.toContain("secret db detail");
  });
});
