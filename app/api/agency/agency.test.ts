import { beforeEach, describe, expect, it, vi } from "vitest";

type Q = { table: string; op?: string; args?: unknown[]; filters: unknown[][] };
type Ans = { data: unknown; error: unknown };
const A1 = "11111111-1111-4111-8111-111111111111";
const C1 = "22222222-2222-4222-8222-222222222222";
const O1 = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  user: { id: "u-1", email: "boss@example.com", email_confirmed_at: "x" } as null | { id: string; email: string; email_confirmed_at: string },
  role: "admin",
  features: { agency_mode: true } as Record<string, boolean>,
  cookie: undefined as string | undefined,
  queries: [] as Q[],
  rpcs: [] as { fn: string; args: unknown }[],
  /** Database answers for table queries and for rpc calls. */
  answer: (() => ({ data: null, error: null })) as (q: Q) => Ans,
  rpc: (() => ({ data: null, error: null })) as (fn: string, args: Record<string, unknown>) => Ans,
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
            if (!q.op) {
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
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      state.rpcs.push({ fn, args });
      if (fn === "current_app_role") return { data: state.role, error: null };
      if (fn === "feature_enabled") return { data: state.features[String(args.p_feature)] ?? false, error: null };
      return state.rpc(fn, args);
    },
  };
  return { createClient: async () => client, getUser: async () => state.user };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "sc_active_org" && state.cookie ? { value: state.cookie } : undefined) }) }));

import { GET as getBranding, PUT as putBranding } from "./branding/route";
import { GET as getClients, POST as postClients } from "./clients/route";
import { GET as getOrgs } from "./orgs/route";
import { POST as postSwitch } from "./switch/route";
import { GET as getPlans } from "../plans/route";
import { PUT as putAssign } from "../plans/assign/route";

const call = (handler: (r: Request) => Promise<Response>, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  handler(new Request("http://app.test/api/x", { method, headers: { "content-type": "application/json", host: "app.test", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }));
const writes = () => state.queries.filter((q) => q.op && q.op !== "select");

const myOrgs = [
  { id: A1, name: "Agency", parent_id: null, plan_id: "agency", role: "admin", via_agency: false },
  { id: C1, name: "Client", parent_id: A1, plan_id: null, role: "admin", via_agency: true },
];
const mem = (q: Q, admin = [A1]) => (q.table === "memberships" ? { data: admin.map((org_id) => ({ org_id })), error: null } : null);

beforeEach(() => {
  state.user = { id: "u-1", email: "boss@example.com", email_confirmed_at: "x" };
  state.role = "admin";
  state.features = { agency_mode: true };
  state.cookie = undefined;
  state.queries = [];
  state.rpcs = [];
  state.answer = (q) => mem(q) ?? { data: null, error: null };
  state.rpc = (fn) => (fn === "my_orgs" ? { data: myOrgs, error: null } : { data: null, error: null });
});

describe("POST /api/agency/switch", () => {
  it("rejects a cross-site request and anonymous callers before touching anything", async () => {
    expect((await call(postSwitch, "POST", { org_id: C1 }, { origin: "http://evil.test" })).status).toBe(403);
    state.user = null;
    expect((await call(postSwitch, "POST", { org_id: C1 })).status).toBe(401);
    expect(state.rpcs).toEqual([]);
  });

  it("validates the body", async () => {
    expect((await call(postSwitch, "POST", { org_id: "nope" })).status).toBe(400);
    expect((await call(postSwitch, "POST", {})).status).toBe(400);
    expect((await call(postSwitch, "POST", "{bad json")).status).toBe(400);
  });

  it("sets an httpOnly, SameSite cookie for an organization the database says they may act in", async () => {
    const res = await call(postSwitch, "POST", { org_id: C1 });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`sc_active_org=${C1}`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Path=/");
  });

  it("refuses an organization they cannot act in, and sets no cookie", async () => {
    const res = await call(postSwitch, "POST", { org_id: O1 });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("leaves the client context with org_id null (cookie cleared)", async () => {
    const res = await call(postSwitch, "POST", { org_id: null });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/sc_active_org=;/);
    expect(cookie).toMatch(/Max-Age=0|Expires=/i);
  });
});

describe("GET /api/agency/orgs", () => {
  it("returns the organizations and the active one for any signed-in person", async () => {
    state.role = "member";
    state.cookie = C1;
    state.rpc = (fn, args) => (fn === "my_orgs" ? { data: myOrgs, error: null } : fn === "is_org_member" && args.p_org === C1 ? { data: true, error: null } : { data: null, error: null });
    state.answer = (q) => (q.table === "memberships" ? { data: [{ org_id: A1 }], error: null } : { data: null, error: null });
    const res = await call(getOrgs, "GET");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.active).toBe(C1);
    expect(body.orgs).toHaveLength(2);
  });

  it("ignores a cookie the database does not approve", async () => {
    state.cookie = O1;
    const body = await (await call(getOrgs, "GET")).json();
    expect(body.active).toBe(A1);
  });

  it("is 401 when signed out", async () => {
    state.user = null;
    expect((await call(getOrgs, "GET")).status).toBe(401);
  });
});

describe("/api/agency/clients", () => {
  it("is closed to a signed-in admin when agency mode is off for them", async () => {
    state.features = { agency_mode: false };
    expect((await call(getClients, "GET")).status).toBe(403);
    expect((await call(postClients, "POST", { name: "X" })).status).toBe(403);
    expect(state.rpcs.some((r) => r.fn === "create_client_organization")).toBe(false);
  });

  it("is closed to non-admins even when the feature is on", async () => {
    state.role = "designer";
    expect((await call(getClients, "GET")).status).toBe(403);
  });

  it("lists the agency's clients with counts as numbers", async () => {
    state.rpc = (fn) =>
      fn === "my_orgs"
        ? { data: myOrgs, error: null }
        : fn === "agency_clients"
          ? { data: [{ id: C1, name: "Client", plan_id: "free", created_at: "2026-01-01T00:00:00Z", member_count: "3", people_count: "12" }], error: null }
          : { data: null, error: null };
    const res = await call(getClients, "GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agency: A1, clients: [{ id: C1, name: "Client", plan_id: "free", created_at: "2026-01-01T00:00:00Z", members: 3, people: 12 }] });
    expect(state.rpcs.find((r) => r.fn === "agency_clients")?.args).toEqual({ p_parent: A1 });
  });

  it("403 when they administer no agency organization", async () => {
    state.rpc = (fn) => (fn === "my_orgs" ? { data: [{ ...myOrgs[0], role: "member" }], error: null } : { data: null, error: null });
    expect((await call(getClients, "GET")).status).toBe(403);
  });

  it("creates a client under the caller's agency, never under an organization named in the body", async () => {
    state.rpc = (fn) => (fn === "my_orgs" ? { data: myOrgs, error: null } : fn === "create_client_organization" ? { data: C1, error: null } : { data: null, error: null });
    const res = await call(postClients, "POST", { name: "  New client ", plan_id: "free", parent: O1, p_parent: O1 });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: C1 });
    expect(state.rpcs.find((r) => r.fn === "create_client_organization")?.args).toEqual({ p_parent: A1, p_name: "New client", p_plan: "free" });
  });

  it("validates the name and the plan id, and maps database refusals", async () => {
    expect((await call(postClients, "POST", { name: "   " })).status).toBe(400);
    expect((await call(postClients, "POST", { name: "x".repeat(81) })).status).toBe(400);
    expect((await call(postClients, "POST", { name: "ok", plan_id: "DROP TABLE" })).status).toBe(400);
    expect((await call(postClients, "POST", { name: "ok" }, { origin: "http://evil.test" })).status).toBe(403);
    state.rpc = (fn) => (fn === "my_orgs" ? { data: myOrgs, error: null } : { data: null, error: { code: "42501", message: "x" } });
    expect((await call(postClients, "POST", { name: "ok" })).status).toBe(403);
    state.rpc = (fn) => (fn === "my_orgs" ? { data: myOrgs, error: null } : { data: null, error: { code: "23503", message: "x" } });
    expect((await call(postClients, "POST", { name: "ok", plan_id: "nonexistent" })).status).toBe(400);
  });
});

describe("/api/agency/branding", () => {
  const good = { brand_name: "Acme", logo_url: "https://cdn.acme.com/l.png", logo_width: 120, logo_height: 40, accent: "#0B5FFF", show_powered_by: true };
  const stored = { brand_name: "Acme", logo_url: "https://cdn.acme.com/l.png", logo_width: 120, logo_height: 40, accent: "#0B5FFF", show_powered_by: true };

  it("saves for the active organization and returns the resolved branding", async () => {
    state.answer = (q) => mem(q) ?? { data: stored, error: null };
    const res = await call(putBranding, "PUT", good);
    expect(res.status).toBe(200);
    expect((await res.json()).branding).toEqual({ name: "Acme", logo: { url: good.logo_url, width: 120, height: 40 }, accent: "#0B5FFF", poweredBy: true });
    const w = writes()[0];
    expect(w.op).toBe("upsert");
    expect((w.args?.[0] as Record<string, unknown>).org_id).toBe(A1);
  });

  it("can act for a client when the database approves it", async () => {
    state.rpc = (fn) => (fn === "is_org_admin" ? { data: true, error: null } : { data: null, error: null });
    state.answer = (q) => mem(q) ?? { data: stored, error: null };
    expect((await call(putBranding, "PUT", { ...good, org_id: C1 })).status).toBe(200);
    expect((writes()[0].args?.[0] as Record<string, unknown>).org_id).toBe(C1);
  });

  it("refuses an organization they do not administer, without writing", async () => {
    const res = await call(putBranding, "PUT", { ...good, org_id: O1 });
    expect(res.status).toBe(403);
    expect(writes()).toEqual([]);
  });

  it.each([
    ["an http logo", { logo_url: "http://cdn.acme.com/l.png" }],
    ["a javascript: logo", { logo_url: "javascript:alert(1)" }],
    ["a logo without a size", { logo_width: null, logo_height: null }],
    ["a size without a logo", { logo_url: null }],
    ["an oversized logo", { logo_width: 4000 }],
    ["a pale accent", { accent: "#FFFF00" }],
    ["a named colour", { accent: "red" }],
    ["a long name", { brand_name: "x".repeat(61) }],
  ])("rejects %s with 400 and writes nothing", async (_n, patch) => {
    const res = await call(putBranding, "PUT", { ...good, ...patch });
    expect(res.status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it("hiding 'Powered by SignCraft' needs agency mode", async () => {
    state.features = { agency_mode: false };
    state.answer = (q) => mem(q) ?? { data: stored, error: null };
    expect((await call(putBranding, "PUT", { ...good, show_powered_by: false })).status).toBe(403);
    expect((await call(putBranding, "PUT", good)).status).toBe(200);
    state.features = { agency_mode: true };
    state.answer = (q) => mem(q) ?? { data: { ...stored, show_powered_by: false }, error: null };
    const res = await call(putBranding, "PUT", { ...good, show_powered_by: false });
    expect(res.status).toBe(200);
    expect((await res.json()).branding.poweredBy).toBe(false);
  });

  it("requires same origin and admin", async () => {
    expect((await call(putBranding, "PUT", good, { origin: "http://evil.test" })).status).toBe(403);
    state.role = "member";
    expect((await call(putBranding, "PUT", good)).status).toBe(403);
    expect(writes()).toEqual([]);
  });

  it("GET gives any member the active organization's branding, default when none is stored", async () => {
    state.role = "member";
    state.answer = (q) => (q.table === "memberships" ? { data: [{ org_id: A1 }], error: null } : { data: null, error: null });
    const body = await (await call(getBranding, "GET")).json();
    expect(body.branding).toEqual({ name: "SignCraft", logo: null, accent: null, poweredBy: true });
    expect((await call(async () => getBranding(new Request("http://app.test/api/x?org_id=bad")), "GET")).status).toBe(400);
  });
});

describe("/api/plans", () => {
  it("GET: admin only; returns presets and the organizations they can be assigned to, and says nothing is charged", async () => {
    state.answer = (q) =>
      q.table === "plans" ? { data: [{ id: "free", name: "Free", description: "d", sort_order: 10 }], error: null }
      : q.table === "plan_features" ? { data: [{ plan: "free", feature: "ai_autofill", enabled: true }], error: null }
      : q.table === "plan_ai_limits" ? { data: [{ plan: "free", role: "member", feature: "ai_autofill", per_minute: 2, per_day: 5 }], error: null }
      : mem(q) ?? { data: null, error: null };
    const body = await (await call(getPlans, "GET")).json();
    expect(body.charged).toBe(false);
    expect(body.plans[0]).toMatchObject({ id: "free", features: { ai_autofill: true }, limits: [{ role: "member", feature: "ai_autofill", perMinute: 2, perDay: 5 }] });
    expect(body.orgs.map((o: { id: string }) => o.id)).toEqual([A1, C1]);
    state.role = "member";
    expect((await call(getPlans, "GET")).status).toBe(403);
  });

  it("GET: 503 when the migration has not been applied", async () => {
    state.answer = (q) => (q.table === "plans" ? { data: null, error: { message: "relation does not exist" } } : { data: [], error: null });
    expect((await call(getPlans, "GET")).status).toBe(503);
  });

  it("assign: updates only after the organization check; 403 for an organization they do not administer", async () => {
    state.answer = (q) => mem(q) ?? { data: [{ id: A1, plan_id: "pro" }], error: null };
    const ok = await call(putAssign, "PUT", { org_id: A1, plan_id: "pro" });
    expect(ok.status).toBe(200);
    expect(writes()[0]).toMatchObject({ table: "organizations", op: "update", args: [{ plan_id: "pro" }] });
    state.queries = [];
    expect((await call(putAssign, "PUT", { org_id: O1, plan_id: "pro" })).status).toBe(403);
    expect(writes()).toEqual([]);
  });

  it("assign: a client's agency admin may assign through the database check; the database refusing is a 403", async () => {
    state.rpc = (fn) => (fn === "is_org_admin" ? { data: true, error: null } : { data: null, error: null });
    state.answer = (q) => mem(q) ?? { data: [{ id: C1, plan_id: "free" }], error: null };
    expect((await call(putAssign, "PUT", { org_id: C1, plan_id: "free" })).status).toBe(200);
    state.answer = (q) => mem(q) ?? { data: null, error: { code: "42501", message: "no" } };
    expect((await call(putAssign, "PUT", { org_id: C1, plan_id: "agency" })).status).toBe(403);
  });

  it("assign: null removes the plan; validates input, origin and role; unknown plan is a 400", async () => {
    state.answer = (q) => mem(q) ?? { data: [{ id: A1, plan_id: null }], error: null };
    expect((await call(putAssign, "PUT", { org_id: A1, plan_id: null })).status).toBe(200);
    expect((await call(putAssign, "PUT", { org_id: "x", plan_id: "pro" })).status).toBe(400);
    expect((await call(putAssign, "PUT", { org_id: A1, plan_id: "PRO; --" })).status).toBe(400);
    expect((await call(putAssign, "PUT", { org_id: A1 })).status).toBe(400);
    expect((await call(putAssign, "PUT", { org_id: A1, plan_id: "pro" }, { origin: "http://evil.test" })).status).toBe(403);
    state.answer = (q) => mem(q) ?? { data: null, error: { code: "23503", message: "fk" } };
    expect((await call(putAssign, "PUT", { org_id: A1, plan_id: "gold" })).status).toBe(400);
    state.role = "designer";
    expect((await call(putAssign, "PUT", { org_id: A1, plan_id: "pro" })).status).toBe(403);
  });
});
