import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Q = { table: string; op?: string; args?: unknown[]; filters: unknown[][] };

const state = vi.hoisted(() => ({
  user: { id: "admin-1", email: "boss@example.com", email_confirmed_at: "x" } as null | { id: string; email: string; email_confirmed_at: string },
  role: "admin",
  features: { team_deploy: true } as Record<string, boolean>,
  queries: [] as { table: string; op?: string; args?: unknown[]; filters: unknown[][] }[],
  rpcs: [] as { fn: string; args: Record<string, unknown> | undefined }[],
  answer: (() => ({ data: null, error: null })) as (q: { table: string; op?: string; args?: unknown[]; filters: unknown[][] }) => { data: unknown; error: unknown; count?: number },
  rpcAnswer: (() => ({ data: null, error: null })) as (fn: string, args?: Record<string, unknown>) => { data: unknown; error: unknown },
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

vi.mock("@/lib/supabase/server", () => {
  const client = {
    from: (table: string) => builder(table),
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      state.rpcs.push({ fn, args });
      if (fn === "current_app_role") return { data: state.role, error: null };
      if (fn === "feature_enabled") return { data: state.features[String(args?.p_feature)] ?? false, error: null };
      return state.rpcAnswer(fn, args);
    },
  };
  return { createClient: async () => client, getUser: async () => state.user };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));

import { clearDelegatedTokens } from "@/lib/google-dwd/token";
import { POST as cancel } from "./deployments/[id]/cancel/route";
import { POST as retry } from "./deployments/[id]/retry/route";
import { POST as rollback } from "./deployments/[id]/rollback/route";
import { POST as run } from "./deployments/[id]/run/route";
import { GET as getDeployment } from "./deployments/[id]/route";
import { GET as listDeployments } from "./deployments/route";
import { POST as exchangeScript } from "./exchange/script/route";
import { GET as exchangeHelper } from "./exchange/helper/route";
import { POST as confirmDeploy } from "./gmail/deploy/route";
import { POST as planDeploy } from "./gmail/plan/route";
import { DELETE as deleteRule, PATCH as patchRule } from "./rules/[id]/route";
import { GET as listRules, POST as createRule } from "./rules/route";
import { POST as testRule } from "./rules/test/route";
import { GET as getStatus } from "./status/route";

const ORG = "6f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const ID = "8f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const TPL = "9f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const params = (id = ID) => ({ params: Promise.resolve({ id }) });
const req = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://app.test${url}`, { method, headers: { "content-type": "application/json", host: "app.test", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const writes = () => state.queries.filter((q) => q.op && q.op !== "select");
const memberships = (q: Q) => (q.table === "memberships" ? { data: [{ org_id: ORG }], error: null } : null);
const dbRpcs = () => state.rpcs.filter((r) => !["current_app_role", "feature_enabled"].includes(r.fn));

/* -------- a fake Workspace: token endpoint + Gmail signatures -------- */

const SA_JSON = JSON.stringify({ client_email: "sc@proj.iam.gserviceaccount.com", client_id: "123456789012345678901", private_key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) });
const gmail = { sigs: {} as Record<string, string>, calls: [] as { method: string; email: string }[], missing: new Set<string>(), tokenError: "" };

function stubGoogle() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
        if (gmail.tokenError) return new Response(JSON.stringify({ error: gmail.tokenError }), { status: 400 });
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      const email = decodeURIComponent(String(url).split("/sendAs/")[1]);
      gmail.calls.push({ method: init?.method ?? "GET", email });
      if (gmail.missing.has(email)) return new Response(JSON.stringify({ error: { message: "nf" } }), { status: 404 });
      if (init?.method === "PATCH") {
        gmail.sigs[email] = JSON.parse(String(init.body)).signature;
        return new Response("{}", { status: 200 });
      }
      return new Response(JSON.stringify({ sendAsEmail: email, isPrimary: true, signature: gmail.sigs[email] ?? "" }), { status: 200 });
    }),
  );
}

const DOC = {
  version: 1,
  template_id: "classic",
  theme: { primary: "#1E3A8A", text: "#111827", muted: "#6B7280", bg: "#FFFFFF", accent2: "#F4C542", font: "Arial", spacing: "normal" },
  blocks: [{ type: "identity", name: "Template Name", title: "T" }],
};
const snapshot = { name: "T", doc: DOC, lock: { editable: [] }, field_map: { "0.name": "full_name" } };
const person = (i: number, o: Record<string, unknown> = {}) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, email: `p${i}@acme.com`, full_name: `Person ${i}`, first_name: "", last_name: "", title: "", department: "Sales", phone: "", mobile: "", location: "", custom: {}, status: "active", ...o });
const version = (i: number, o: Record<string, unknown> = {}) => ({ id: `10000000-0000-4000-8000-00000000000${i}`, person_id: person(i).id, version_no: 1, template_id: TPL, template_snapshot: snapshot, values_json: {}, ...o });

function workspace(people: unknown[], versions: unknown[], extra: (q: Q) => { data: unknown; error: unknown } | null = () => null) {
  state.answer = (q) => {
    const m = memberships(q) ?? extra(q);
    if (m) return m;
    if (q.table === "people") return { data: people, error: null };
    if (q.table === "signature_versions") return { data: versions, error: null };
    if (q.table === "signature_rules") return { data: [], error: null };
    if (q.table === "brand_templates") return { data: [{ id: TPL, name: "T", departments: [], is_active: true, created_at: "2026-01-01T00:00:00Z" }], error: null };
    return { data: [{ id: ID }], error: null };
  };
}

beforeEach(() => {
  state.user = { id: "admin-1", email: "boss@example.com", email_confirmed_at: "x" };
  state.role = "admin";
  state.features = { team_deploy: true };
  state.queries = [];
  state.rpcs = [];
  state.answer = (q) => memberships(q) ?? { data: [{ id: ID }], error: null };
  state.rpcAnswer = () => ({ data: null, error: null });
  gmail.sigs = {};
  gmail.calls = [];
  gmail.missing = new Set();
  gmail.tokenError = "";
  clearDelegatedTokens();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", SA_JSON);
  stubGoogle();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const rule = { name: "Sales", template_id: TPL };
const ADMIN_ROUTES: [string, () => Promise<Response>, boolean][] = [
  ["GET /status", () => getStatus(req("/api/deploy/status", "GET")), false],
  ["POST /gmail/plan", () => planDeploy(req("/api/deploy/gmail/plan", "POST", {})), true],
  ["POST /gmail/deploy", () => confirmDeploy(req("/api/deploy/gmail/deploy", "POST", { fingerprint: "a".repeat(64), set: 0, replace: 0, confirmed: true })), true],
  ["GET /deployments", () => listDeployments(req("/api/deploy/deployments", "GET")), false],
  ["GET /deployments/:id", () => getDeployment(req("/x", "GET"), params()), false],
  ["POST /deployments/:id/run", () => run(req("/x", "POST"), params()), true],
  ["POST /deployments/:id/retry", () => retry(req("/x", "POST"), params()), true],
  ["POST /deployments/:id/cancel", () => cancel(req("/x", "POST"), params()), true],
  ["POST /deployments/:id/rollback", () => rollback(req("/x", "POST", { expected: 1, confirmed: true }), params()), true],
  ["POST /exchange/script", () => exchangeScript(req("/api/deploy/exchange/script", "POST", {})), true],
  ["GET /exchange/helper", () => exchangeHelper(req("/api/deploy/exchange/helper", "GET")), false],
  ["GET /rules", () => listRules(req("/api/deploy/rules", "GET")), false],
  ["POST /rules", () => createRule(req("/api/deploy/rules", "POST", rule)), true],
  ["PATCH /rules/:id", () => patchRule(req("/x", "PATCH", { name: "N" }), params()), true],
  ["DELETE /rules/:id", () => deleteRule(req("/x", "DELETE"), params()), true],
  ["POST /rules/test", () => testRule(req("/api/deploy/rules/test", "POST", { person_id: ID, kind: "new", audience: "external" })), true],
];

describe("authorization on every route", () => {
  it.each(ADMIN_ROUTES)("%s: 401 signed out, 403 for a member or designer, 403 with the flag off, nothing written", async (_n, call) => {
    state.user = null;
    expect((await call()).status).toBe(401);
    state.user = { id: "u", email: "u@x.com", email_confirmed_at: "x" };
    for (const role of ["member", "designer"]) {
      state.role = role;
      expect((await call()).status).toBe(403);
    }
    state.role = "admin";
    state.features = { team_deploy: false };
    expect((await call()).status).toBe(403);
    expect(writes()).toHaveLength(0);
    expect(dbRpcs()).toHaveLength(0);
    expect(gmail.calls).toHaveLength(0);
  });

  it.each(ADMIN_ROUTES.filter((r) => r[2]))("%s: refuses a cross-site write before doing anything", async (n) => {
    const o = { origin: "https://evil.example" };
    const calls: Record<string, () => Promise<Response>> = {
      "POST /gmail/plan": () => planDeploy(req("/p", "POST", {}, o)),
      "POST /gmail/deploy": () => confirmDeploy(req("/p", "POST", { fingerprint: "a".repeat(64), set: 0, replace: 0, confirmed: true }, o)),
      "POST /deployments/:id/run": () => run(req("/x", "POST", undefined, o), params()),
      "POST /deployments/:id/retry": () => retry(req("/x", "POST", undefined, o), params()),
      "POST /deployments/:id/cancel": () => cancel(req("/x", "POST", undefined, o), params()),
      "POST /deployments/:id/rollback": () => rollback(req("/x", "POST", { expected: 1, confirmed: true }, o), params()),
      "POST /exchange/script": () => exchangeScript(req("/x", "POST", {}, o)),
      "POST /rules": () => createRule(req("/x", "POST", rule, o)),
      "PATCH /rules/:id": () => patchRule(req("/x", "PATCH", { name: "N" }, o), params()),
      "DELETE /rules/:id": () => deleteRule(req("/x", "DELETE", undefined, o), params()),
      "POST /rules/test": () => testRule(req("/x", "POST", { person_id: ID, kind: "new", audience: "external" }, o)),
    };
    expect((await calls[n]()).status).toBe(403);
    expect(writes()).toHaveLength(0);
    expect(dbRpcs()).toHaveLength(0);
    expect(gmail.calls).toHaveLength(0);
  });

  it("rejects malformed ids with 400", async () => {
    for (const call of [getDeployment(req("/x", "GET"), params("nope")), run(req("/x", "POST"), params("nope")), retry(req("/x", "POST"), params("nope")), cancel(req("/x", "POST"), params("nope")), rollback(req("/x", "POST", { expected: 1, confirmed: true }), params("nope")), patchRule(req("/x", "PATCH", { name: "N" }), params("nope")), deleteRule(req("/x", "DELETE"), params("nope"))])
      expect((await call).status).toBe(400);
  });
});

describe("status and the not-set-up path", () => {
  it("reports what an admin must do, and shows the client ID and scope but never the key", async () => {
    const body = await (await getStatus(req("/s", "GET"))).json();
    expect(body).toMatchObject({ configured: true, serviceAccountEmail: "sc@proj.iam.gserviceaccount.com", clientId: "123456789012345678901", scope: "https://www.googleapis.com/auth/gmail.settings.basic" });
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE KEY/);
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "");
    const off = await (await getStatus(req("/s", "GET"))).json();
    expect(off.configured).toBe(false);
    expect(off.steps.join(" ")).toMatch(/GOOGLE_SERVICE_ACCOUNT_JSON/);
    expect(off.steps.join(" ")).toMatch(/domain-wide delegation/i);
  });

  it("plan, confirm and run answer 503 with the steps when the server has no service account", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "");
    for (const call of [() => planDeploy(req("/p", "POST", {})), () => confirmDeploy(req("/p", "POST", { fingerprint: "a".repeat(64), set: 1, replace: 0, confirmed: true })), () => run(req("/x", "POST"), params())]) {
      const res = await call();
      expect(res.status).toBe(503);
      expect((await res.json()).steps.length).toBeGreaterThan(2);
    }
    expect(dbRpcs()).toHaveLength(0);
  });
});

describe("plan (dry run) writes nothing", () => {
  it("lists who would be set, replaced, left alone or skipped, and never writes to Gmail or the database", async () => {
    gmail.sigs = { "p2@acme.com": "<p>their own</p>" };
    gmail.missing.add("p4@acme.com");
    workspace([person(1), person(2), person(3), person(4), person(5, { status: "inactive" })], [version(1), version(2), version(4), version(5)]);
    const res = await planDeploy(req("/p", "POST", {}));
    expect(res.status).toBe(200);
    const plan = await res.json();
    const by = Object.fromEntries(plan.items.map((i: { email: string }) => [i.email, i]));
    expect(by["p1@acme.com"]).toMatchObject({ action: "set", has_existing: false });
    expect(by["p2@acme.com"]).toMatchObject({ action: "replace", has_existing: true });
    expect(by["p3@acme.com"]).toMatchObject({ action: "skip", code: "no_version" });
    expect(by["p4@acme.com"]).toMatchObject({ action: "skip", code: "no_mailbox" });
    expect(by["p5@acme.com"]).toMatchObject({ action: "skip", code: "inactive" });
    expect(plan.counts).toMatchObject({ set: 1, replace: 1, actionable: 2, skipped: 3 });
    expect(plan.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // nothing sent to the browser that holds a signature body
    expect(JSON.stringify(plan)).not.toContain("their own");
    expect(writes()).toHaveLength(0);
    expect(dbRpcs()).toHaveLength(0);
    expect(gmail.calls.every((c) => c.method === "GET")).toBe(true);
    expect(Object.values(gmail.sigs)).toEqual(["<p>their own</p>"]);
    // scoped to the admin's organization
    expect(state.queries.find((q) => q.table === "people")!.filters).toContainEqual(["eq", "org_id", ORG]);
  });

  it("shows a blocker when the Workspace has not authorised the service account", async () => {
    gmail.tokenError = "unauthorized_client";
    workspace([person(1)], [version(1)]);
    const plan = await (await planDeploy(req("/p", "POST", {}))).json();
    expect(plan.blockers[0]).toMatch(/domain-wide delegation/i);
    expect(plan.items[0]).toMatchObject({ action: "skip", code: "cannot_act" });
  });

  it("refuses more than 1000 people and rejects bad input", async () => {
    expect((await planDeploy(req("/p", "POST", { person_ids: ["nope"] }))).status).toBe(400);
    expect((await planDeploy(req("/p", "POST", { department: "x".repeat(81) }))).status).toBe(400);
  });
});

describe("confirm", () => {
  async function plan() {
    gmail.sigs = { "p2@acme.com": "<p>old</p>" };
    workspace([person(1), person(2)], [version(1), version(2)]);
    return (await (await planDeploy(req("/p", "POST", {}))).json()) as { fingerprint: string; counts: { set: number; replace: number } };
  }
  const confirm = (body: unknown) => confirmDeploy(req("/c", "POST", body));

  it("needs the explicit confirmation flag and a well-formed fingerprint", async () => {
    const p = await plan();
    expect((await confirm({ fingerprint: p.fingerprint, set: 1, replace: 1 })).status).toBe(400);
    expect((await confirm({ fingerprint: p.fingerprint, set: 1, replace: 1, confirmed: false })).status).toBe(400);
    expect((await confirm({ fingerprint: "short", set: 1, replace: 1, confirmed: true })).status).toBe(400);
    expect(dbRpcs()).toHaveLength(0);
  });

  it("creates the deployment from a fresh plan with the matching fingerprint, and writes nothing to Gmail", async () => {
    const p = await plan();
    state.rpcAnswer = (fn) => (fn === "create_deployment" ? { data: ID, error: null } : { data: null, error: null });
    const res = await confirm({ fingerprint: p.fingerprint, set: 1, replace: 1, confirmed: true });
    expect(res.status).toBe(201);
    const call = dbRpcs().find((r) => r.fn === "create_deployment")!;
    expect(call.args).toMatchObject({ p_org: ORG, p_target: "gmail", p_fingerprint: p.fingerprint });
    const items = call.args!.p_items as { person_id: string; status: string; action: string }[];
    expect(items.map((i) => [i.action, i.status]).sort()).toEqual([["replace", "pending"], ["set", "pending"]]);
    // the payload names people by id only; no e-mail, name or signature travels
    expect(JSON.stringify(call.args)).not.toMatch(/p1@acme|Person 1|<p>old/);
    expect(gmail.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("refuses a stale plan: the Gmail signature, the counts or the fingerprint changed", async () => {
    const p = await plan();
    gmail.sigs["p1@acme.com"] = "<p>Person 1 just made their own</p>";
    let res = await confirm({ fingerprint: p.fingerprint, set: 1, replace: 1, confirmed: true });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale");
    gmail.sigs["p1@acme.com"] = "";
    res = await confirm({ fingerprint: p.fingerprint, set: 5, replace: 1, confirmed: true });
    expect(res.status).toBe(409);
    res = await confirm({ fingerprint: "f".repeat(64), set: 1, replace: 1, confirmed: true });
    expect(res.status).toBe(409);
    expect(dbRpcs().filter((r) => r.fn === "create_deployment")).toHaveLength(0);
  });

  it("refuses when the Workspace is not authorised, and when nothing is left to do", async () => {
    gmail.tokenError = "unauthorized_client";
    workspace([person(1)], [version(1)]);
    const blocked = await planDeploy(req("/p", "POST", {}));
    const bp = await blocked.json();
    expect((await confirm({ fingerprint: bp.fingerprint, set: 0, replace: 0, confirmed: true })).status).toBe(409);
    gmail.tokenError = "";
    clearDelegatedTokens();
    workspace([person(3)], []);
    const none = await (await planDeploy(req("/p", "POST", {}))).json();
    const r = await confirm({ fingerprint: none.fingerprint, set: 0, replace: 0, confirmed: true });
    expect(r.status).toBe(400);
    expect(dbRpcs().filter((x) => x.fn === "create_deployment")).toHaveLength(0);
  });

  it("maps a second running deployment to 409", async () => {
    const p = await plan();
    state.rpcAnswer = (fn) => (fn === "create_deployment" ? { data: null, error: { code: "23505", message: "dup" } } : { data: null, error: null });
    expect((await confirm({ fingerprint: p.fingerprint, set: 1, replace: 1, confirmed: true })).status).toBe(409);
  });
});

describe("run", () => {
  const claimed = (i: number, o: Record<string, unknown> = {}) => ({ id: `20000000-0000-4000-8000-00000000000${i}`, email: `p${i}@acme.com`, action: "set", expect_hash: "", new_hash: "", new_signature: null, previous_known: false, attempts: 1, person_id: person(i).id, ...o });

  it("backs up, writes and finishes only the claimed items, in that order, and reports progress", async () => {
    const { signatureHash } = await import("@/lib/deploy/plan");
    const { renderVersion } = await import("@/lib/team/render");
    const r = renderVersion(version(1), person(1) as never);
    if (!r.ok) throw new Error(r.error);
    gmail.sigs = { "p1@acme.com": "<p>old</p>", "stranger@x.com": "<p>never touched</p>" };
    workspace([person(1)], [version(1)], (q) => (q.table === "deployments" ? { data: { id: ID, status: "succeeded", total: 1, done: 1 }, error: null } : q.table === "people" && q.filters.some((f) => f[0] === "maybeSingle") ? { data: person(1), error: null } : null));
    let claimedOnce = false;
    state.rpcAnswer = (fn) => {
      if (fn === "claim_deployment_items") {
        if (claimedOnce) return { data: [], error: null };
        claimedOnce = true;
        return { data: [claimed(1, { expect_hash: signatureHash("<p>old</p>"), new_hash: signatureHash(r.html) })], error: null };
      }
      return { data: null, error: null };
    };
    const res = await run(req("/x", "POST"), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batch).toMatchObject({ processed: 1, done: 1, failed: 0 });
    expect(dbRpcs().map((x) => x.fn)).toEqual(["claim_deployment_items", "record_previous_signature", "finish_deployment_item", "claim_deployment_items"]);
    expect(dbRpcs()[1].args).toMatchObject({ p_signature: "<p>old</p>" });
    expect(dbRpcs()[2].args).toMatchObject({ p_status: "done" });
    expect(gmail.calls.filter((c) => c.method === "PATCH").map((c) => c.email)).toEqual(["p1@acme.com"]);
    expect(gmail.sigs["stranger@x.com"]).toBe("<p>never touched</p>");
    expect(gmail.sigs["p1@acme.com"]).toBe(r.html);
  });

  it("skips (and writes nothing) when the signature in Gmail changed after the plan", async () => {
    const { signatureHash } = await import("@/lib/deploy/plan");
    const { renderVersion } = await import("@/lib/team/render");
    const rendered = renderVersion(version(1), person(1) as never);
    if (!rendered.ok) throw new Error(rendered.error);
    gmail.sigs = { "p1@acme.com": "<p>edited since</p>" };
    workspace([person(1)], [version(1)], (q) => (q.table === "people" && q.filters.some((f) => f[0] === "maybeSingle") ? { data: person(1), error: null } : null));
    let once = false;
    state.rpcAnswer = (fn) => (fn === "claim_deployment_items" ? (once ? { data: [], error: null } : ((once = true), { data: [claimed(1, { expect_hash: signatureHash("<p>old</p>"), new_hash: signatureHash(rendered.html) })], error: null })) : { data: null, error: null });
    await run(req("/x", "POST"), params());
    expect(gmail.calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(dbRpcs().find((x) => x.fn === "finish_deployment_item")!.args).toMatchObject({ p_status: "skipped", p_error_code: "changed" });
    expect(dbRpcs().some((x) => x.fn === "record_previous_signature")).toBe(false);
  });

  it("answers 404 for another organization's deployment before claiming anything", async () => {
    workspace([], [], (q) => (q.table === "deployments" ? { data: null, error: null } : null));
    expect((await run(req("/x", "POST"), params())).status).toBe(404);
    expect(dbRpcs()).toHaveLength(0);
  });
});

describe("retry, cancel, rollback", () => {
  it("map the database's state errors", async () => {
    state.rpcAnswer = () => ({ data: null, error: { code: "DP004", message: "There is nothing to retry." } });
    expect((await retry(req("/x", "POST"), params())).status).toBe(409);
    expect((await cancel(req("/x", "POST"), params())).status).toBe(409);
    state.rpcAnswer = () => ({ data: null, error: { code: "DP005", message: "The number of signatures to restore is now 3, not 5." } });
    const res = await rollback(req("/x", "POST", { expected: 5, confirmed: true }), params());
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/now 3, not 5/);
  });

  it("rollback needs the confirmation and the count the admin saw, and passes both to the database", async () => {
    expect((await rollback(req("/x", "POST", { expected: 3 }), params())).status).toBe(400);
    expect((await rollback(req("/x", "POST", { confirmed: true }), params())).status).toBe(400);
    expect((await rollback(req("/x", "POST", { expected: 0, confirmed: true }), params())).status).toBe(400);
    expect(dbRpcs()).toHaveLength(0);
    state.rpcAnswer = () => ({ data: "30000000-0000-4000-8000-000000000001", error: null });
    const res = await rollback(req("/x", "POST", { expected: 3, confirmed: true }), params());
    expect(res.status).toBe(201);
    expect(dbRpcs()[0]).toEqual({ fn: "create_rollback", args: { p_dep: ID, p_expected: 3 } });
    expect(gmail.calls).toHaveLength(0);
  });

  it("retry and cancel check the deployment belongs to the admin's organization first", async () => {
    workspace([], [], (q) => (q.table === "deployments" ? { data: null, error: null } : null));
    expect((await retry(req("/x", "POST"), params())).status).toBe(404);
    expect((await cancel(req("/x", "POST"), params())).status).toBe(404);
    expect(dbRpcs()).toHaveLength(0);
  });
});

describe("deployment history", () => {
  it("never selects signature bodies and is scoped to the organization", async () => {
    workspace([], [], (q) => (q.table === "deployments" ? { data: { id: ID }, error: null } : q.table === "deployment_items" ? { data: [], error: null, count: 0 } : null));
    await getDeployment(req("/x?status=failed&page=2", "GET"), params());
    const items = state.queries.find((q) => q.table === "deployment_items")!;
    expect(String(items.args![0])).not.toMatch(/previous_signature|new_signature/);
    expect(items.filters).toContainEqual(["eq", "org_id", ORG]);
    expect(items.filters).toContainEqual(["eq", "status", "failed"]);
    expect(items.filters).toContainEqual(["range", 200, 299]);
    await listDeployments(req("/d", "GET"));
    expect(state.queries.find((q) => q.table === "deployments" && q.filters.some((f) => f[0] === "limit"))!.filters).toContainEqual(["eq", "org_id", ORG]);
  });
});

describe("rules", () => {
  it("creates a rule in the admin's own organization with defaults, ignoring a forged org_id", async () => {
    expect((await createRule(req("/r", "POST", { ...rule, org_id: "evil", created_by: "evil" }))).status).toBe(201);
    const row = writes()[0].args![0] as Record<string, unknown>;
    expect(row).toMatchObject({ org_id: ORG, created_by: "admin-1", message_kind: "any", audience: "any", priority: 100, departments: [] });
  });
  it("rejects bad rules", async () => {
    for (const bad of [{ ...rule, name: "" }, { ...rule, template_id: "nope" }, { ...rule, priority: 5000 }, { ...rule, message_kind: "bounce" }, { ...rule, departments: ["A,B"] }]) expect((await createRule(req("/r", "POST", bad))).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
  it("PATCH changes only what was sent and never resets other fields to defaults", async () => {
    expect((await patchRule(req("/x", "PATCH", { name: "Renamed" }), params())).status).toBe(200);
    expect(writes()[0].args![0]).toEqual({ name: "Renamed" });
    expect(writes()[0].filters).toContainEqual(["eq", "org_id", ORG]);
    expect((await patchRule(req("/x", "PATCH", {}), params())).status).toBe(400);
  });
  it("a template from another organization maps to a clean 400", async () => {
    state.answer = (q) => memberships(q) ?? { data: null, error: { code: "DP003", message: "That template does not belong to this organization." } };
    expect((await createRule(req("/r", "POST", rule))).status).toBe(400);
  });
  it("DELETE answers 404 when nothing matched", async () => {
    state.answer = (q) => memberships(q) ?? { data: [], error: null };
    expect((await deleteRule(req("/x", "DELETE"), params())).status).toBe(404);
  });

  it("test-it says what wins overall and what each target can really do", async () => {
    const T2 = "a1c2b9e0-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
    state.answer = (q) => {
      const m = memberships(q);
      if (m) return m;
      if (q.table === "people") return { data: { id: ID, full_name: "Ann", email: "a@acme.com", department: "Sales" }, error: null };
      if (q.table === "signature_rules")
        return { data: [{ id: "r1", name: "External replies", message_kind: "reply", audience: "external", departments: [], priority: 100, template_id: T2, is_active: true, created_at: "2026-02-01T00:00:00Z" }], error: null };
      if (q.table === "brand_templates")
        return { data: [{ id: TPL, name: "Standard", departments: [], is_active: true, created_at: "2026-01-01T00:00:00Z" }, { id: T2, name: "Short", departments: [], is_active: true, created_at: "2026-01-02T00:00:00Z" }], error: null };
      return { data: [], error: null };
    };
    const b = await (await testRule(req("/t", "POST", { person_id: ID, kind: "reply", audience: "external" }))).json();
    expect(b.winner).toMatchObject({ rule_name: "External replies", template_name: "Short" });
    // Gmail has one signature per address: the reply/external rule cannot be enforced, so the default is used
    expect(b.gmail).toMatchObject({ template_name: "Standard", same_as_winner: false });
    // Exchange can express it, but reply detection is unverified
    expect(b.exchange).toMatchObject({ template_name: "Short", same_as_winner: true, unverified: true });
    const n = await (await testRule(req("/t", "POST", { person_id: ID, kind: "new", audience: "internal" }))).json();
    expect(n.winner.template_name).toBe("Standard");
  });
  it("test-it answers 404 for an unknown person", async () => {
    state.answer = (q) => memberships(q) ?? { data: null, error: null };
    expect((await testRule(req("/t", "POST", { person_id: ID, kind: "new", audience: "internal" }))).status).toBe(404);
  });
});

describe("exchange script", () => {
  const T = { id: TPL, name: "Standard", doc_json: { ...DOC, blocks: [{ type: "identity", name: "N", title: "T" }] }, lock_json: { editable: [] }, field_map: { "0.name": "full_name", "0.title": "title" }, departments: [], is_active: true, created_at: "2026-01-01T00:00:00Z" };
  it("returns a script labelled generated-not-run, in Audit mode with a safe fallback, and sends nothing to Microsoft", async () => {
    state.answer = (q) => memberships(q) ?? (q.table === "brand_templates" ? { data: [T], error: null } : { data: [], error: null });
    const res = await exchangeScript(req("/e", "POST", {}));
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.generated_not_run).toBe(true);
    expect(b.script).toContain("Mode = 'Audit'");
    expect(b.script).toContain("FallbackAction = 'Ignore'");
    expect(b.script).toContain("%%DisplayName%%");
    expect(b.removal_script).toContain("Remove-TransportRule");
    expect(b.recorded).toBeNull();
    expect(gmail.calls).toHaveLength(0);
    expect(dbRpcs()).toHaveLength(0);
  });
  it("records the generation only when asked, and answers 422 with the reason when it cannot generate", async () => {
    state.answer = (q) => memberships(q) ?? (q.table === "brand_templates" ? { data: [T], error: null } : { data: [], error: null });
    state.rpcAnswer = (fn) => ({ data: fn === "record_script" ? ID : null, error: null });
    expect((await (await exchangeScript(req("/e", "POST", { record: true }))).json()).recorded).toBe(ID);
    state.answer = (q) => memberships(q) ?? { data: [], error: null };
    const none = await exchangeScript(req("/e", "POST", {}));
    expect(none.status).toBe(422);
    expect((await none.json()).message).toMatch(/brand template/);
  });
  it("validates the options", async () => {
    for (const bad of [{ mode: "Delete" }, { fallback: "Explode" }, { priority: -2 }, { duplicate_guard: "x".repeat(101) }]) expect((await exchangeScript(req("/e", "POST", bad))).status).toBe(400);
  });
  it("the helper returns static read-only text", async () => {
    const b = await (await exchangeHelper(req("/h", "GET"))).json();
    expect(b.script).toMatch(/READ ONLY/);
  });
});
