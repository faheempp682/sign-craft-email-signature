import { beforeEach, describe, expect, it, vi } from "vitest";

type Q = { table: string; op?: string; args?: unknown[]; filters: unknown[][] };

const state = vi.hoisted(() => ({
  user: { id: "admin-1", email: "boss@example.com", email_confirmed_at: "x" } as null | { id: string; email: string; email_confirmed_at: string },
  role: "admin" as string,
  queries: [] as { table: string; op?: string; args?: unknown[]; filters: unknown[][] }[],
  /** Decides what the database answers for each query. */
  answer: (() => ({ data: null, error: null })) as (q: { table: string; op?: string; args?: unknown[]; filters: unknown[][] }) => { data: unknown; error: unknown },
}));

/** A recording stand-in for the Supabase query builder: every chain is logged, and awaiting it returns state.answer(query). */
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
    rpc: async (fn: string) => (fn === "current_app_role" ? { data: state.role, error: null } : { data: null, error: null }),
  };
  return { createClient: async () => client, getUser: async () => state.user };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));

import { sameOrigin } from "@/lib/admin/route";
import { PATCH as patchFlag } from "./flags/route";
import { DELETE as deleteOverride, PUT as putOverride } from "./overrides/route";
import { PUT as putLimit } from "./limits/route";
import { PUT as putMember } from "./members/route";

const UUID = "6f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const call = (handler: (r: Request) => Promise<Response>, method: string, body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request("http://app.test/api/admin/x", { method, headers: { "content-type": "application/json", host: "app.test", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const writes = () => state.queries.filter((q) => q.op && q.op !== "select");

beforeEach(() => {
  state.user = { id: "admin-1", email: "boss@example.com", email_confirmed_at: "x" };
  state.role = "admin";
  state.queries = [];
  state.answer = () => ({ data: null, error: null });
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_EMAIL;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Every admin route must refuse the same callers in the same way, whatever it does. */
const ROUTES = [
  ["PATCH /flags", patchFlag, "PATCH", { feature: "animated_gif", default_enabled: true }],
  ["PUT /overrides", putOverride, "PUT", { subject_type: "user", email: "a@example.com", feature: "animated_gif", enabled: true }],
  ["DELETE /overrides", deleteOverride, "DELETE", { subject_type: "user", subject_id: UUID, feature: "animated_gif" }],
  ["PUT /limits", putLimit, "PUT", { role: "member", feature: "ai_design", per_minute: 5, per_day: 20 }],
  ["PUT /members", putMember, "PUT", { email: "a@example.com", role: "designer" }],
] as const;

describe.each(ROUTES)("%s: access control", (_n, handler, method, body) => {
  it("is 401 when signed out", async () => {
    state.user = null;
    expect((await call(handler, method, body)).status).toBe(401);
    expect(writes()).toHaveLength(0);
  });

  it.each(["member", "designer"])("is 403 for a %s, and writes nothing", async (role) => {
    state.role = role;
    const res = await call(handler, method, body);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden" });
    expect(writes()).toHaveLength(0);
  });

  it("refuses a request that comes from another site, even from an admin", async () => {
    const res = await call(handler, method, body, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "bad_origin" });
    expect(writes()).toHaveLength(0);
  });

  it("accepts the app's own origin", async () => {
    state.answer = (q) => ({ data: q.table === "profiles" || q.table === "organizations" ? { id: UUID, email: "a@example.com" } : [{ feature: "x" }], error: null });
    const res = await call(handler, method, body, { origin: "http://app.test" });
    expect(res.status).toBe(200);
  });

  it("is 400 for a body that is not JSON", async () => {
    expect((await call(handler, method, "{nope")).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
});

describe("sameOrigin", () => {
  const req = (headers: Record<string, string>) => new Request("http://app.test/x", { headers });
  it("allows requests with no Origin header", () => expect(sameOrigin(req({ host: "app.test" }))).toBe(true));
  it("allows the same host", () => expect(sameOrigin(req({ origin: "https://app.test", host: "app.test" }))).toBe(true));
  it("refuses another host", () => expect(sameOrigin(req({ origin: "https://evil.test", host: "app.test" }))).toBe(false));
  it("refuses a lookalike that only starts with the host", () => expect(sameOrigin(req({ origin: "https://app.test.evil.com", host: "app.test" }))).toBe(false));
  it("honours x-forwarded-host behind a proxy", () => expect(sameOrigin(req({ origin: "https://app.example.com", host: "internal:3000", "x-forwarded-host": "app.example.com" }))).toBe(true));
  it("refuses an unparseable Origin", () => expect(sameOrigin(req({ origin: "null", host: "app.test" }))).toBe(false));
});

describe("PATCH /api/admin/flags", () => {
  it("updates only the fields that were sent", async () => {
    state.answer = () => ({ data: { feature: "animated_gif", default_enabled: true, min_role: "member" }, error: null });
    const res = await call(patchFlag, "PATCH", { feature: "animated_gif", default_enabled: true });
    expect(res.status).toBe(200);
    expect(writes()[0]).toMatchObject({ table: "feature_flags", op: "update", args: [{ default_enabled: true }], filters: expect.arrayContaining([["eq", "feature", "animated_gif"]]) });
    expect((writes()[0].args?.[0] as object) && Object.keys(writes()[0].args![0] as object)).toEqual(["default_enabled"]);
  });

  it("can change the minimum role", async () => {
    state.answer = () => ({ data: { feature: "analytics" }, error: null });
    await call(patchFlag, "PATCH", { feature: "analytics", min_role: "designer" });
    expect(writes()[0].args).toEqual([{ min_role: "designer" }]);
  });

  it.each([
    [{ feature: "animated_gif" }, "nothing to change"],
    [{ feature: "does_not_exist", default_enabled: true }, "unknown feature"],
    [{ feature: "constructor", default_enabled: true }, "a prototype property name"],
    [{ feature: "animated_gif", min_role: "root" }, "unknown role"],
    [{ feature: "animated_gif", default_enabled: "yes" }, "a non-boolean"],
  ])("rejects %j (%s)", async (...[body]) => {
    expect((await call(patchFlag, "PATCH", body)).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  it("is 404 when the feature row does not exist", async () => {
    state.answer = () => ({ data: null, error: null });
    expect((await call(patchFlag, "PATCH", { feature: "analytics", default_enabled: false })).status).toBe(404);
  });
});

describe("PUT /api/admin/overrides", () => {
  it("looks the user up by email and writes the override for their id", async () => {
    state.answer = (q) => (q.table === "profiles" ? { data: { id: UUID, email: "client@example.com" }, error: null } : { data: null, error: null });
    const res = await call(putOverride, "PUT", { subject_type: "user", email: "  Client@Example.com ", feature: "animated_gif", enabled: true });
    expect(res.status).toBe(200);
    const lookup = state.queries.find((q) => q.table === "profiles")!;
    expect(lookup.filters).toContainEqual(["ilike", "email", "client@example.com"]);
    const w = writes()[0];
    expect(w).toMatchObject({ table: "feature_overrides", op: "upsert" });
    expect(w.args?.[0]).toMatchObject({ subject_type: "user", subject_id: UUID, feature: "animated_gif", enabled: true });
    expect(w.args?.[1]).toEqual({ onConflict: "subject_type,subject_id,feature" });
  });

  it("escapes wildcard characters so one email cannot match another account", async () => {
    state.answer = () => ({ data: null, error: null });
    await call(putOverride, "PUT", { subject_type: "user", email: "a_b@example.com", feature: "ai_design", enabled: false });
    expect(state.queries.find((q) => q.table === "profiles")!.filters).toContainEqual(["ilike", "email", "a\\_b@example.com"]);
  });

  it("is 404 for an email with no account, and writes nothing", async () => {
    state.answer = () => ({ data: null, error: null });
    const res = await call(putOverride, "PUT", { subject_type: "user", email: "nobody@example.com", feature: "ai_design", enabled: false });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "user_not_found" });
    expect(writes()).toHaveLength(0);
  });

  it("can target an organization, and checks it exists first", async () => {
    state.answer = (q) => (q.table === "organizations" ? { data: { id: UUID }, error: null } : { data: null, error: null });
    expect((await call(putOverride, "PUT", { subject_type: "org", org_id: UUID, feature: "animated_gif", enabled: true })).status).toBe(200);
    expect(writes()[0].args?.[0]).toMatchObject({ subject_type: "org", subject_id: UUID });

    state.queries = [];
    state.answer = () => ({ data: null, error: null });
    expect((await call(putOverride, "PUT", { subject_type: "org", org_id: UUID, feature: "animated_gif", enabled: true })).status).toBe(404);
    expect(writes()).toHaveLength(0);
  });

  it.each([
    [{ subject_type: "user", email: "not-an-email", feature: "ai_design", enabled: true }],
    [{ subject_type: "user", email: "a@example.com", feature: "nope", enabled: true }],
    [{ subject_type: "org", org_id: "not-a-uuid", feature: "ai_design", enabled: true }],
    [{ subject_type: "team", email: "a@example.com", feature: "ai_design", enabled: true }],
    [{ subject_type: "user", email: "a@example.com", feature: "ai_design" }],
  ])("rejects %j", async (body) => {
    expect((await call(putOverride, "PUT", body)).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
});

describe("DELETE /api/admin/overrides", () => {
  it("removes exactly the targeted override", async () => {
    state.answer = () => ({ data: [{ feature: "animated_gif" }], error: null });
    const res = await call(deleteOverride, "DELETE", { subject_type: "org", subject_id: UUID, feature: "animated_gif" });
    expect(res.status).toBe(200);
    expect(writes()[0]).toMatchObject({ table: "feature_overrides", op: "delete" });
    expect(writes()[0].filters).toEqual(expect.arrayContaining([["eq", "subject_type", "org"], ["eq", "subject_id", UUID], ["eq", "feature", "animated_gif"]]));
  });

  it("is 404 when there was nothing to remove", async () => {
    state.answer = () => ({ data: [], error: null });
    expect((await call(deleteOverride, "DELETE", { subject_type: "user", subject_id: UUID, feature: "animated_gif" })).status).toBe(404);
  });
});

describe("PUT /api/admin/limits", () => {
  it("saves the limits for a role and feature, upserting on the pair", async () => {
    const res = await call(putLimit, "PUT", { role: "designer", feature: "ai_vision", per_minute: 6, per_day: 40 });
    expect(res.status).toBe(200);
    expect(writes()[0]).toMatchObject({ table: "ai_limits", op: "upsert", args: [{ role: "designer", feature: "ai_vision", per_minute: 6, per_day: 40 }, { onConflict: "role,feature" }] });
  });

  it("accepts null for no limit, and zero to block", async () => {
    expect((await call(putLimit, "PUT", { role: "admin", feature: "ai_design", per_minute: null, per_day: null })).status).toBe(200);
    expect((await call(putLimit, "PUT", { role: "member", feature: "ai_design", per_minute: 0, per_day: 0 })).status).toBe(200);
  });

  it.each([
    [{ role: "member", feature: "ai_design", per_minute: -1, per_day: 5 }, "negative"],
    [{ role: "member", feature: "ai_design", per_minute: 1.5, per_day: 5 }, "fractional"],
    [{ role: "member", feature: "ai_design", per_minute: "5", per_day: 5 }, "a string"],
    [{ role: "member", feature: "ai_design", per_minute: 5 }, "missing per_day"],
    [{ role: "member", feature: "ai_design", per_minute: 5, per_day: 2_000_000 }, "absurdly high"],
    [{ role: "member", feature: "animated_gif", per_minute: 5, per_day: 5 }, "a non-AI feature"],
    [{ role: "owner", feature: "ai_design", per_minute: 5, per_day: 5 }, "an unknown role"],
  ])("rejects %j (%s)", async (...[body]) => {
    expect((await call(putLimit, "PUT", body)).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
});

describe("PUT /api/admin/members", () => {
  const found = (q: Q) => (q.table === "profiles" ? { data: { id: UUID, email: "pat@example.com" }, error: null } : q.table === "organizations" ? { data: { id: "org-1" }, error: null } : { data: null, error: null });

  it("sets the role in the default organization", async () => {
    state.answer = found;
    const res = await call(putMember, "PUT", { email: "Pat@Example.com", role: "designer" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "pat@example.com", role: "designer" });
    expect(state.queries.find((q) => q.table === "organizations")!.filters).toContainEqual(["eq", "is_default", true]);
    expect(writes()[0]).toMatchObject({ table: "memberships", op: "upsert", args: [{ org_id: "org-1", user_id: UUID, role: "designer" }, { onConflict: "org_id,user_id" }] });
  });

  it("is 404 when the person has not signed in yet", async () => {
    state.answer = () => ({ data: null, error: null });
    expect((await call(putMember, "PUT", { email: "ghost@example.com", role: "member" })).status).toBe(404);
    expect(writes()).toHaveLength(0);
  });

  it("is 409 when the database refuses to remove the last admin", async () => {
    state.answer = (q) => (q.op === "upsert" ? { data: null, error: { code: "P0001", message: "There must be at least one admin." } } : found(q));
    const res = await call(putMember, "PUT", { email: "pat@example.com", role: "member" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "last_admin" });
  });

  it("will not demote someone listed in ADMIN_EMAILS, because that would not stick", async () => {
    process.env.ADMIN_EMAILS = "pat@example.com";
    state.answer = found;
    const res = await call(putMember, "PUT", { email: "pat@example.com", role: "member" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "bootstrap_admin" });
    expect(writes()).toHaveLength(0);
    // promoting them is fine
    expect((await call(putMember, "PUT", { email: "pat@example.com", role: "admin" })).status).toBe(200);
  });

  it("maps an unexpected database error to 500 without leaking details", async () => {
    state.answer = (q) => (q.op === "upsert" ? { data: null, error: { code: "XX000", message: "secret internals" } } : found(q));
    const res = await call(putMember, "PUT", { email: "pat@example.com", role: "member" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret internals");
  });

  it.each([[{ email: "pat", role: "member" }], [{ email: "pat@example.com", role: "superuser" }], [{ role: "member" }]])("rejects %j", async (body) => {
    expect((await call(putMember, "PUT", body)).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
});
