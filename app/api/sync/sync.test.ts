import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

type Q = { table: string; op?: string; args?: unknown[]; filters: unknown[][] };

const state = vi.hoisted(() => ({
  user: { id: "admin-1", email: "boss@example.com", email_confirmed_at: "x" } as null | { id: string; email: string; email_confirmed_at: string },
  role: "admin",
  features: { directory_sync: true, crm_sync: true } as Record<string, boolean>,
  queries: [] as { table: string; op?: string; args?: unknown[]; filters: unknown[][] }[],
  rpcs: [] as { fn: string; args: Record<string, unknown> | undefined; client: string }[],
  answer: (() => ({ data: null, error: null })) as (q: { table: string; op?: string; args?: unknown[]; filters: unknown[][] }) => { data: unknown; error: unknown },
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

import { GET as getPreview } from "./previews/[id]/route";
import { POST as applyRoute } from "./previews/[id]/apply/route";
import { GET as getSettings, PUT as putSettings } from "./settings/route";
import { GET as getSource, PUT as putSource } from "./sources/[source]/route";
import { GET as getStatus } from "./status/route";
import { POST as cron } from "./run/route";
import { POST as postPreview } from "./preview/route";
import { POST as postTest } from "./test/route";
import { GET as getRuns } from "./runs/route";
import { cronAuthorized } from "@/lib/sync/route";

const ID = "11111111-2222-3333-4444-555555555555";
const ORIGIN = "http://localhost:3200";
const req = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${url}`, { method, headers: { "content-type": "application/json", host: "localhost:3200", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (o: object) => ({ params: Promise.resolve(o) }) as never;
const body = async (r: Response) => (await r.json()) as Record<string, unknown>;

const MENV = { MS_TENANT_ID: "11111111-2222-3333-4444-555555555555", MS_CLIENT_ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", MS_CLIENT_SECRET: "super-secret-ms" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

function answerWith(extra: (q: Q) => { data: unknown; error: unknown } | undefined = () => undefined) {
  state.answer = (q) => {
    const e = extra(q);
    if (e) return e;
    if (q.table === "memberships") return { data: [{ org_id: "org-1" }], error: null };
    return { data: q.op === "select" ? [] : null, error: null };
  };
}

beforeEach(() => {
  state.user = { id: "admin-1", email: "boss@example.com", email_confirmed_at: "x" };
  state.role = "admin";
  state.features = { directory_sync: true, crm_sync: true };
  state.queries = [];
  state.rpcs = [];
  state.admin = true;
  state.rpcAnswer = () => ({ data: null, error: null });
  answerWith();
  for (const k of ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "SYNC_CRON_SECRET", "HUBSPOT_ACCESS_TOKEN", "KIMP_CRM_SECRET", "GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_DIRECTORY_ADMIN_EMAIL"]) vi.stubEnv(k, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("authorization on every route", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["GET status", () => getStatus(req("GET", "/api/sync/status"))],
    ["GET settings", () => getSettings(req("GET", "/api/sync/settings"))],
    ["PUT settings", () => putSettings(req("PUT", "/api/sync/settings", { safety_cap_percent: 20, schedule_note: "" }))],
    ["GET source", () => getSource(req("GET", "/api/sync/sources/google"), ctx({ source: "google" }))],
    ["PUT source", () => putSource(req("PUT", "/api/sync/sources/google", { enabled: false, auto_apply: false, allow_blank_overwrite: false, field_policy: {} }), ctx({ source: "google" }))],
    ["POST preview", () => postPreview(req("POST", "/api/sync/preview", { source: "google" }))],
    ["GET preview", () => getPreview(req("GET", `/api/sync/previews/${ID}`), ctx({ id: ID }))],
    ["POST apply", () => applyRoute(req("POST", `/api/sync/previews/${ID}/apply`, { confirm: true }), ctx({ id: ID }))],
    ["GET runs", () => getRuns(req("GET", "/api/sync/runs"))],
    ["POST test", () => postTest(req("POST", "/api/sync/test", { source: "generic", email: "a@b.co" }))],
  ];

  it.each(calls)("%s: signed out is 401", async (_n, f) => {
    state.user = null;
    expect((await f()).status).toBe(401);
  });
  it.each(calls)("%s: a member is 403 and nothing runs", async (_n, f) => {
    state.role = "member";
    expect((await f()).status).toBe(403);
    expect(state.rpcs.filter((r) => /sync_preview|log_sync/.test(r.fn))).toEqual([]);
  });
  it.each(calls.filter(([n]) => !n.startsWith("GET")))("%s: another origin is 403", async (n, f) => {
    void f;
    const r = await (async () => {
      // rebuild the call with a foreign Origin header
      const method = n.split(" ")[0];
      const path = n.includes("source") ? "/api/sync/sources/google" : n.includes("settings") ? "/api/sync/settings" : n.includes("apply") ? `/api/sync/previews/${ID}/apply` : n.includes("test") ? "/api/sync/test" : "/api/sync/preview";
      const handler = n.includes("source") ? putSource : n.includes("settings") ? putSettings : n.includes("apply") ? applyRoute : n.includes("test") ? postTest : postPreview;
      return (handler as (r: Request, c: never) => Promise<Response>)(req(method, path, { source: "google", confirm: true }, { origin: "https://evil.example.com" }), ctx({ source: "google", id: ID }));
    })();
    expect(r.status).toBe(403);
    expect((await body(r)).error).toBe("bad_origin");
  });

  it("directory source needs directory_sync, CRM source needs crm_sync", async () => {
    state.features = { directory_sync: false, crm_sync: true };
    expect((await postPreview(req("POST", "/api/sync/preview", { source: "google" }))).status).toBe(403);
    expect((await getSource(req("GET", "/api/sync/sources/microsoft"), ctx({ source: "microsoft" }))).status).toBe(403);
    expect((await getSource(req("GET", "/api/sync/sources/hubspot"), ctx({ source: "hubspot" }))).status).toBe(200);
    state.features = { directory_sync: true, crm_sync: false };
    expect((await postPreview(req("POST", "/api/sync/preview", { source: "hubspot" }))).status).toBe(403);
    expect((await postTest(req("POST", "/api/sync/test", { source: "generic", email: "a@b.co" }))).status).toBe(403);
    state.features = { directory_sync: false, crm_sync: false };
    expect((await getStatus(req("GET", "/api/sync/status"))).status).toBe(403);
    expect((await getRuns(req("GET", "/api/sync/runs"))).status).toBe(403);
  });
});

describe("status", () => {
  it("names the missing variables and never prints a value", async () => {
    vi.stubEnv("MS_CLIENT_SECRET", "super-secret-ms");
    vi.stubEnv("HUBSPOT_ACCESS_TOKEN", "pat-secret-token");
    const r = await getStatus(req("GET", "/api/sync/status"));
    const text = JSON.stringify(await r.json());
    expect(text).not.toContain("super-secret-ms");
    expect(text).not.toContain("pat-secret-token");
    const j = JSON.parse(text) as { sources: { source: string; configured: boolean; missing: string[] }[]; cron_configured: boolean };
    expect(j.sources.find((s) => s.source === "google")?.missing).toEqual(["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_DIRECTORY_ADMIN_EMAIL"]);
    expect(j.sources.find((s) => s.source === "microsoft")?.missing).toEqual(["MS_TENANT_ID", "MS_CLIENT_ID"]);
    expect(j.sources.find((s) => s.source === "hubspot")).toMatchObject({ configured: true, missing: [] });
    expect(j.sources.find((s) => s.source === "generic")?.missing).toEqual(["KIMP_CRM_SECRET"]);
    expect(j.cron_configured).toBe(false);
  });

  it("only lists the sources the features allow", async () => {
    state.features = { directory_sync: true, crm_sync: false };
    const j = (await (await getStatus(req("GET", "/api/sync/status"))).json()) as { sources: { source: string }[] };
    expect(j.sources.map((s) => s.source)).toEqual(["google", "microsoft"]);
  });
});

describe("settings", () => {
  it("validates the cap and the note, and writes for the caller's organization", async () => {
    expect((await putSettings(req("PUT", "/api/sync/settings", { safety_cap_percent: 0, schedule_note: "" }))).status).toBe(400);
    expect((await putSettings(req("PUT", "/api/sync/settings", { safety_cap_percent: 101, schedule_note: "" }))).status).toBe(400);
    expect((await putSettings(req("PUT", "/api/sync/settings", { safety_cap_percent: 1.5, schedule_note: "" }))).status).toBe(400);
    expect((await putSettings(req("PUT", "/api/sync/settings", { safety_cap_percent: 20, schedule_note: "x".repeat(201) }))).status).toBe(400);
    expect((await putSettings(req("PUT", "/api/sync/settings", { safety_cap_percent: 35, schedule_note: "nightly" }))).status).toBe(200);
    const w = state.queries.find((q) => q.table === "sync_settings" && q.op === "upsert");
    expect(w?.args?.[0]).toMatchObject({ org_id: "org-1", safety_cap_percent: 35, updated_by: "admin-1" });
  });
});

describe("source settings", () => {
  const base = { enabled: true, auto_apply: false, allow_blank_overwrite: false, field_policy: {}, config: {} };
  const put = (source: string, b: object) => putSource(req("PUT", `/api/sync/sources/${source}`, { ...base, ...b }), ctx({ source }));

  it("rejects an unknown source", async () => {
    expect((await getSource(req("GET", "/api/sync/sources/evil"), ctx({ source: "evil" }))).status).toBe(404);
  });
  it("auto-apply needs the source switched on; a policy may only name fields the source fills", async () => {
    expect((await put("google", { enabled: false, auto_apply: true })).status).toBe(400);
    expect((await put("google", { field_policy: { custom_thing: "source" } })).status).toBe(400);
    expect((await put("google", { field_policy: { title: "bogus" } })).status).toBe(400);
    expect((await put("google", { field_policy: { title: "directory", phone: "source" } })).status).toBe(200);
  });
  it("a CRM source cannot be switched on without a valid mapping, and refuses extra keys such as a secret", async () => {
    expect((await put("hubspot", { enabled: true })).status).toBe(400);
    const good = { mapping: [{ from: "phone", to: "phone" }] };
    expect((await put("hubspot", { config: { ...good, token: "pat-x" } })).status).toBe(400);
    expect((await put("hubspot", { config: good, field_policy: { title: "source" } })).status).toBe(400); // title is not mapped
    expect((await put("hubspot", { config: good, field_policy: { phone: "source" } })).status).toBe(200);
    const w = state.queries.filter((q) => q.table === "sync_sources" && q.op === "upsert").at(-1);
    expect(w?.args?.[0]).toMatchObject({ org_id: "org-1", source: "hubspot", config: good, updated_by: "admin-1" });
  });
  it("the generic adapter's address is validated (https, public form only)", async () => {
    const cfg = (base_url: string) => ({ base_url, auth_header: "X-Api-Key", auth_prefix: "", path_template: "/p?e={email}", mapping: [{ from: "$.phone", to: "phone" }] });
    expect((await put("generic", { config: cfg("http://crm.example.com") })).status).toBe(400);
    // a literal IP passes the shape check; the connection guard (safe-fetch) refuses it when it is used, see crm.test.ts
    expect((await put("generic", { config: cfg("https://crm.example.com/api") })).status).toBe(200);
  });
  it("GET never returns a secret", async () => {
    vi.stubEnv("KIMP_CRM_SECRET", "kimp-super-secret");
    const t = await (await getSource(req("GET", "/api/sync/sources/generic"), ctx({ source: "generic" }))).text();
    expect(t).not.toContain("kimp-super-secret");
    expect(JSON.parse(t)).toMatchObject({ configured: true, missing: [] });
  });
});

describe("preview", () => {
  const person = (i: number, o: object = {}) => ({ id: `p${i}`, email: `u${i}@acme.com`, full_name: `User ${i}`, first_name: "", last_name: "", title: "", department: "", phone: "", mobile: "", location: "", custom: {}, source: "microsoft", external_id: `m${i}`, status: "active", ...o });
  const graph = (users: object[]) => vi.fn(async (url: string | URL) => (String(url).includes("login.") ? json({ access_token: "t" }) : json({ value: users })));
  const mu = (i: number, o: object = {}) => ({ id: `m${i}`, displayName: `User ${i}`, mail: `u${i}@acme.com`, jobTitle: "PM", accountEnabled: true, userType: "Member", ...o });

  it("computes the diff, stores it through save_sync_preview, and writes nothing to the people table", async () => {
    for (const [k, v] of Object.entries(MENV)) vi.stubEnv(k, v);
    vi.stubGlobal("fetch", graph([mu(1), mu(2), mu(3)]));
    answerWith((q) => (q.table === "people" ? { data: [person(1), person(2, { title: "PM" }), person(4)], error: null } : undefined));
    state.rpcAnswer = (fn) => (fn === "save_sync_preview" ? { data: ID, error: null } : { data: null, error: null });
    const r = await postPreview(req("POST", "/api/sync/preview", { source: "microsoft" }));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { preview_id: string; stats: Record<string, number>; refusal: string | null };
    expect(j.preview_id).toBe(ID);
    expect(j.stats).toMatchObject({ creates: 1, updates: 1, unchanged: 1, deactivates: 1, fetched: 3 });
    expect(j.refusal).toMatch(/safety cap/); // 1 of 3 managed people is 33 percent
    const save = state.rpcs.find((x) => x.fn === "save_sync_preview");
    expect(save?.client).toBe("user");
    expect(save?.args).toMatchObject({ p_org: "org-1", p_source: "microsoft", p_fetched: 3 });
    expect(state.queries.filter((q) => q.table === "people" && q.op && q.op !== "select")).toEqual([]);
    expect(JSON.stringify(j)).not.toContain("super-secret-ms");
  });

  it("a source that is not configured answers 409 naming what is missing, and logs a failure", async () => {
    const r = await postPreview(req("POST", "/api/sync/preview", { source: "microsoft" }));
    expect(r.status).toBe(409);
    expect((await body(r)).message).toMatch(/MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET/);
    expect(state.rpcs.some((x) => x.fn === "log_sync_event")).toBe(true);
  });

  it("an upstream failure is a 502 with our own message, never the upstream text", async () => {
    for (const [k, v] of Object.entries(MENV)) vi.stubEnv(k, v);
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => (String(u).includes("login.") ? json({ error: "invalid_client", error_description: "AADSTS7000215 SECRET-DETAILS" }, 401) : json({}))));
    const r = await postPreview(req("POST", "/api/sync/preview", { source: "microsoft" }));
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain("SECRET-DETAILS");
  });

  it("rejects an unknown source and a missing body", async () => {
    expect((await postPreview(req("POST", "/api/sync/preview", { source: "dropbox" }))).status).toBe(400);
    expect((await postPreview(req("POST", "/api/sync/preview", {}))).status).toBe(400);
  });
});

describe("reading a preview", () => {
  const plan = {
    creates: [{ email: "new@acme.com", full_name: "New", title: "T", first_name: "", last_name: "", department: "", phone: "", mobile: "", location: "", external_id: "x" }],
    updates: [{ person_id: "p1", email: "a@acme.com", name: "Ada", set: { title: "CTO" }, custom_set: {}, custom_remove: [], changes: [{ field: "title", from: "", to: "CTO" }] }, { person_id: "p2", email: "b@acme.com", name: "Bob", set: {}, custom_set: {}, custom_remove: [], changes: [{ field: "phone", from: "", to: "1" }] }],
    deactivates: [{ person_id: "p3", email: "c@acme.com", name: "Cy" }],
    unchanged: 0, warnings: [],
  };
  const row = { id: ID, org_id: "org-1", source: "google", status: "pending", trigger: "manual", created_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-02T00:00:00Z", fetched_count: 5, stats: { fetched: 5, creates: 1, updates: 2, deactivates: 1, unchanged: 0, skipped: 0, erasures: 0, base: 10 }, errors: [], plan };
  beforeEach(() => answerWith((q) => (q.table === "sync_previews" ? { data: row, error: null } : undefined)));
  const get = async (qs = "") => (await (await getPreview(req("GET", `/api/sync/previews/${ID}${qs}`), ctx({ id: ID }))).json()) as { total: number; entries: { kind: string; email: string }[]; refusal: string | null };

  it("filters by kind, search text and field; pages on the server", async () => {
    expect((await get()).total).toBe(4);
    expect((await get("?kind=update")).entries.map((e) => e.email)).toEqual(["a@acme.com", "b@acme.com"]);
    expect((await get("?q=BOB")).entries.map((e) => e.email)).toEqual(["b@acme.com"]);
    expect((await get("?field=title")).entries.map((e) => e.email).sort()).toEqual(["a@acme.com", "new@acme.com"]);
    const page = await get("?limit=1&offset=3");
    expect(page.entries.map((e) => e.kind)).toEqual(["deactivate"]);
    expect(page.total).toBe(4);
  });
  it("shows the refusal for a deactivation share over the cap", async () => {
    expect((await get()).refusal).toBeNull();
    answerWith((q) => (q.table === "sync_previews" ? { data: { ...row, stats: { ...row.stats, deactivates: 5 } }, error: null } : undefined));
    expect((await get()).refusal).toMatch(/5 of 10/);
  });
  it("another organization's preview, a bad id and a missing row are 404 / 400", async () => {
    answerWith((q) => (q.table === "sync_previews" ? { data: { ...row, org_id: "org-2" }, error: null } : undefined));
    expect((await getPreview(req("GET", `/api/sync/previews/${ID}`), ctx({ id: ID }))).status).toBe(404);
    expect((await getPreview(req("GET", "/api/sync/previews/not-a-uuid"), ctx({ id: "not-a-uuid" }))).status).toBe(400);
  });
});

describe("apply", () => {
  const row = { org_id: "org-1", source: "google", stats: { fetched: 5 } };
  beforeEach(() => answerWith((q) => (q.table === "sync_previews" ? { data: row, error: null } : undefined)));
  const apply = (b: unknown = { confirm: true }) => applyRoute(req("POST", `/api/sync/previews/${ID}/apply`, b), ctx({ id: ID }));

  it("requires an explicit confirmation", async () => {
    expect((await apply({})).status).toBe(400);
    expect((await apply({ confirm: false })).status).toBe(400);
    expect(state.rpcs.some((r) => r.fn === "apply_sync_preview")).toBe(false);
  });
  it("applies through the database function as the signed-in admin", async () => {
    state.rpcAnswer = (fn) => (fn === "apply_sync_preview" ? { data: { applied_created: 1 }, error: null } : { data: null, error: null });
    const r = await apply();
    expect(r.status).toBe(200);
    expect((await r.json()) as object).toMatchObject({ applied: true, stats: { applied_created: 1 } });
    expect(state.rpcs.find((x) => x.fn === "apply_sync_preview")).toMatchObject({ client: "user", args: { p_preview: ID } });
  });
  it("maps the database's refusals to 409 with the reason, and records a blocked run", async () => {
    state.rpcAnswer = (fn) => (fn === "apply_sync_preview" ? { data: null, error: { code: "SY002", message: "Refused by the safety cap: ..." } } : { data: null, error: null });
    const r = await apply();
    expect(r.status).toBe(409);
    expect((await body(r)).message).toMatch(/safety cap/);
    expect(state.rpcs.find((x) => x.fn === "log_sync_event")?.args).toMatchObject({ p_status: "blocked", p_preview: ID });
  });
  it("a stale preview is 409 'stale'; a non-admin database answer is 403", async () => {
    state.rpcAnswer = () => ({ data: null, error: { code: "SY004", message: "old" } });
    expect((await body(await apply())).error).toBe("stale");
    state.rpcAnswer = () => ({ data: null, error: { code: "SY007", message: "x" } });
    expect((await apply()).status).toBe(403);
  });
  it("another organization's preview is 404", async () => {
    answerWith((q) => (q.table === "sync_previews" ? { data: { ...row, org_id: "org-2" }, error: null } : undefined));
    expect((await apply()).status).toBe(404);
  });
});

describe("test button", () => {
  it("never reaches a private address and never reveals the secret", async () => {
    vi.stubEnv("KIMP_CRM_SECRET", "kimp-super-secret");
    const config = { base_url: "https://localhost", auth_header: "X-Api-Key", auth_prefix: "", path_template: "/p?e={email}", mapping: [{ from: "$.phone", to: "phone" }] };
    const r = await postTest(req("POST", "/api/sync/test", { source: "generic", email: "a@b.co", config }));
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).not.toContain("kimp-super-secret");
  });
  it("without the secret in the environment it says which variable is missing", async () => {
    const config = { base_url: "https://crm.example.com", auth_header: "X-Api-Key", auth_prefix: "", path_template: "/p?e={email}", mapping: [{ from: "$.phone", to: "phone" }] };
    const r = await postTest(req("POST", "/api/sync/test", { source: "generic", email: "a@b.co", config }));
    expect(r.status).toBe(409);
    expect((await body(r)).message).toMatch(/KIMP_CRM_SECRET/);
  });
  it("HubSpot: shows what would be mapped for one email", async () => {
    vi.stubEnv("HUBSPOT_ACCESS_TOKEN", "pat-secret");
    vi.stubGlobal("fetch", vi.fn(async () => json({ results: [{ properties: { email: "a@b.co", phone: "+1 5" } }] })));
    const r = await postTest(req("POST", "/api/sync/test", { source: "hubspot", email: "A@B.co", config: { mapping: [{ from: "phone", to: "phone" }] } }));
    expect(await r.json()).toMatchObject({ found: true, rows: [{ from: "phone", to: "phone", value: "+1 5", found: true }] });
  });
  it("rejects an invalid mapping with the reason", async () => {
    const r = await postTest(req("POST", "/api/sync/test", { source: "hubspot", email: "a@b.co", config: { mapping: [{ from: "Phone Number", to: "phone" }] } }));
    expect(r.status).toBe(400);
  });
});

describe("unattended run (cron)", () => {
  const SECRET = "s".repeat(40);
  const call = (headers: Record<string, string> = {}, b?: unknown) => cron(new Request(`${ORIGIN}/api/sync/run`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: b === undefined ? undefined : JSON.stringify(b) }));

  it("is off without a long enough secret, and refuses missing or wrong ones", async () => {
    expect((await call({ authorization: `Bearer ${SECRET}` })).status).toBe(503);
    vi.stubEnv("SYNC_CRON_SECRET", "short");
    expect((await call({ authorization: "Bearer short" })).status).toBe(503);
    vi.stubEnv("SYNC_CRON_SECRET", SECRET);
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ authorization: SECRET })).status).toBe(401);
    expect((await call({ authorization: `Bearer ${SECRET}x` })).status).toBe(401);
    expect(state.queries).toEqual([]);
  });

  it("cronAuthorized compares in constant time (hashes of equal length) and handles any length of guess", () => {
    const env = { SYNC_CRON_SECRET: SECRET };
    const r = (v: string) => cronAuthorized(new Request("http://x", { headers: { authorization: v } }), env);
    expect(r(`Bearer ${SECRET}`)).toBe("ok");
    expect(r(`Bearer ${"s".repeat(39)}`)).toBe("denied");
    expect(r(`Bearer ${"s".repeat(4000)}`)).toBe("denied");
    expect(r("Basic abc")).toBe("denied");
  });

  it("needs the service role key", async () => {
    vi.stubEnv("SYNC_CRON_SECRET", SECRET);
    state.admin = false;
    expect((await call({ authorization: `Bearer ${SECRET}` })).status).toBe(503);
  });

  describe("with a valid secret", () => {
    const auth = { authorization: `Bearer ${SECRET}` };
    const user = (i: number) => ({ id: `m${i}`, displayName: `User ${i}`, mail: `u${i}@acme.com`, accountEnabled: true, userType: "Member" });
    const person = (i: number) => ({ id: `p${i}`, email: `u${i}@acme.com`, full_name: `User ${i}`, first_name: "", last_name: "", title: "", department: "", phone: "", mobile: "", location: "", custom: {}, source: "microsoft", external_id: `m${i}`, status: "active" });
    const setup = (o: { autoApply: boolean; fetched: number; people: number; applyError?: { code: string; message: string } }) => {
      vi.stubEnv("SYNC_CRON_SECRET", SECRET);
      for (const [k, v] of Object.entries(MENV)) vi.stubEnv(k, v);
      vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => (String(u).includes("login.") ? json({ access_token: "t" }) : json({ value: Array.from({ length: o.fetched }, (_, i) => user(i)).map((x) => ({ ...x, jobTitle: "New title" })) }))));
      answerWith((q) => {
        if (q.table === "sync_sources" && q.filters.some((f) => f[0] === "eq" && f[1] === "enabled")) return { data: [{ org_id: "org-1", source: "microsoft" }], error: null };
        if (q.table === "sync_sources") return { data: { enabled: true, auto_apply: o.autoApply, allow_blank_overwrite: false, field_policy: {}, config: {} }, error: null };
        if (q.table === "people") return { data: Array.from({ length: o.people }, (_, i) => person(i)), error: null };
        return undefined;
      });
      state.rpcAnswer = (fn) => {
        if (fn === "sync_feature_on") return { data: true, error: null };
        if (fn === "save_sync_preview_service") return { data: ID, error: null };
        if (fn === "apply_sync_preview_service") return o.applyError ? { data: null, error: o.applyError } : { data: { applied_updated: o.fetched }, error: null };
        return { data: null, error: null };
      };
    };
    const results = async (b?: unknown) => ((await (await call(auth, b)).json()) as { results: { status: string; reason?: string }[] }).results;

    it("auto-apply on and the cap passes: applies with the service functions", async () => {
      setup({ autoApply: true, fetched: 10, people: 10 });
      expect((await results())[0].status).toBe("applied");
      expect(state.rpcs.map((r) => `${r.client}:${r.fn}`)).toEqual(expect.arrayContaining(["service:sync_feature_on", "service:save_sync_preview_service", "service:apply_sync_preview_service"]));
      expect(state.rpcs.some((r) => r.client === "user")).toBe(false);
    });
    it("auto-apply off: leaves a pending preview and does NOT apply", async () => {
      setup({ autoApply: false, fetched: 10, people: 10 });
      const r = await results();
      expect(r[0]).toMatchObject({ status: "pending" });
      expect(state.rpcs.some((x) => x.fn === "apply_sync_preview_service")).toBe(false);
    });
    it("auto-apply on but the cap fails (3 of 10 would be deactivated): does NOT apply, logs 'blocked'", async () => {
      setup({ autoApply: true, fetched: 7, people: 10 });
      const r = await results();
      expect(r[0].status).toBe("blocked");
      expect(r[0].reason).toMatch(/safety cap/);
      expect(state.rpcs.some((x) => x.fn === "apply_sync_preview_service")).toBe(false);
      expect(state.rpcs.find((x) => x.fn === "log_sync_event_service")?.args).toMatchObject({ p_status: "blocked" });
    });
    it("the source returning no users is blocked, not applied", async () => {
      setup({ autoApply: true, fetched: 0, people: 10 });
      const r = await results();
      expect(r[0].status).toBe("blocked");
      expect(state.rpcs.some((x) => x.fn === "apply_sync_preview_service")).toBe(false);
    });
    it("if the database refuses at apply time (race), the run is blocked and logged, never thrown", async () => {
      setup({ autoApply: true, fetched: 10, people: 10, applyError: { code: "SY002", message: "Refused by the safety cap" } });
      expect((await results())[0].status).toBe("blocked");
    });
    it("a feature switched off for the organization is skipped", async () => {
      setup({ autoApply: true, fetched: 10, people: 10 });
      const before = state.rpcAnswer;
      state.rpcAnswer = (fn, a) => (fn === "sync_feature_on" ? { data: false, error: null } : before(fn, a));
      expect((await results())[0].status).toBe("skipped");
      expect(state.rpcs.some((x) => x.fn === "save_sync_preview_service")).toBe(false);
    });
    it("validates the body and the source filter", async () => {
      setup({ autoApply: true, fetched: 10, people: 10 });
      expect((await call(auth, { org_id: "not-a-uuid" })).status).toBe(400);
      expect((await call(auth, { source: "dropbox" })).status).toBe(400);
      expect((await call(auth, { extra: 1 })).status).toBe(400);
    });
    it("the answer holds no names or emails", async () => {
      setup({ autoApply: true, fetched: 10, people: 10 });
      const t = await (await call(auth)).text();
      expect(t).not.toMatch(/@acme\.com|User \d/);
    });
  });
});
