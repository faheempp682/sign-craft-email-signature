import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "admin-1", email: "boss@example.com", email_confirmed_at: "x" } as null | { id: string; email: string; email_confirmed_at: string },
  role: "admin",
  features: { team_deploy: true } as Record<string, boolean>,
  rpcs: [] as { fn: string; args: Record<string, unknown> | undefined }[],
  rpcAnswer: (() => ({ data: { created: 2, already_approved: 1, no_template: 3 }, error: null })) as (fn: string, args?: Record<string, unknown>) => { data: unknown; error: unknown },
}));

const ORG = "6f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const PID = "8f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";

vi.mock("@/lib/supabase/server", () => {
  const q: unknown = new Proxy({}, { get: (_t, prop: string) => (prop === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve({ data: [{ org_id: ORG }], error: null }).then(ok) : () => q) });
  const client = {
    from: () => q,
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

import { POST } from "./defaults/route";

const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://app.test/api/team/defaults", { method: "POST", headers: { "content-type": "application/json", host: "app.test", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const approvals = () => state.rpcs.filter((r) => r.fn === "approve_directory_defaults");

beforeEach(() => {
  state.user = { id: "admin-1", email: "boss@example.com", email_confirmed_at: "x" };
  state.role = "admin";
  state.features = { team_deploy: true };
  state.rpcs = [];
  state.rpcAnswer = () => ({ data: { created: 2, already_approved: 1, no_template: 3 }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/team/defaults: who may call it", () => {
  it("401 signed out, 403 for members and designers, 403 with team_deploy off, 403 from another site", async () => {
    state.user = null;
    expect((await call({ confirm: true })).status).toBe(401);
    state.user = { id: "u", email: "u@x.com", email_confirmed_at: "x" };
    for (const role of ["member", "designer"]) {
      state.role = role;
      expect((await call({ confirm: true })).status).toBe(403);
    }
    state.role = "admin";
    state.features = { team_deploy: false };
    expect((await call({ confirm: true })).status).toBe(403);
    state.features = { team_deploy: true };
    expect(await (await call({ confirm: true }, { origin: "https://evil.example" })).json()).toMatchObject({ error: "bad_origin" });
    expect(approvals()).toHaveLength(0);
  });
});

describe("POST /api/team/defaults: what it does", () => {
  it("approves for the whole organization when no people are named", async () => {
    const res = await call({ confirm: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 2, already_approved: 1, no_template: 3 });
    expect(approvals()).toEqual([{ fn: "approve_directory_defaults", args: { p_org: ORG, p_person_ids: null } }]);
  });

  it("can be limited to named people", async () => {
    await call({ confirm: true, person_ids: [PID] });
    expect(approvals()[0].args).toEqual({ p_org: ORG, p_person_ids: [PID] });
  });

  it("does nothing without an explicit confirmation", async () => {
    for (const body of [{}, { confirm: false }, { confirm: "true" }, { confirm: 1 }, { person_ids: [PID] }]) {
      const res = await call(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(approvals()).toHaveLength(0);
  });

  it("rejects bad person ids and oversized lists before touching the database", async () => {
    for (const person_ids of [["not-a-uuid"], [], Array.from({ length: 1001 }, () => PID)]) {
      expect((await call({ confirm: true, person_ids })).status, JSON.stringify(person_ids).slice(0, 40)).toBe(400);
    }
    expect((await call("{broken")).status).toBe(400);
    expect(approvals()).toHaveLength(0);
  });

  it("reports a database refusal without leaking details, and a malformed answer as a server error", async () => {
    state.rpcAnswer = () => ({ data: null, error: { code: "TM006", message: "You do not have permission to do that." } });
    expect((await call({ confirm: true })).status).toBeGreaterThanOrEqual(400);
    state.rpcAnswer = () => ({ data: { unexpected: true }, error: null });
    const res = await call({ confirm: true });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("unexpected");
  });
});
