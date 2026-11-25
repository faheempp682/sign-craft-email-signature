import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configured: true,
  user: { id: "u1", email: "u@example.com" } as null | { id: string; email: string },
  inserted: [] as unknown[],
  deleted: [] as string[],
  count: 0,
  countFilter: null as null | string[],
  updated: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => {
  const client = {
    from: () => ({
      select: (_cols?: string, opts?: { head?: boolean }) => (opts?.head ? { eq: (c: string, v: string) => { state.countFilter = [c, v]; return Promise.resolve({ count: state.count }); } } : { single: async () => ({ data: { id: "new", name: "n", updated_at: "now" }, error: null }) }),
      insert: (row: unknown) => {
        state.inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "new", name: "n", updated_at: "now" }, error: null }) }) };
      },
      update: (row: unknown) => {
        state.updated.push(row);
        return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "x", name: "n", updated_at: "now" }, error: null }) }) }) };
      },
      delete: () => ({
        eq: (_c: string, id: string) => {
          state.deleted.push(id);
          return { select: async () => ({ data: [{ id }], error: null }) };
        },
      }),
    }),
  };
  return { createClient: async () => (state.configured ? client : null), getUser: async () => state.user };
});

import { DELETE } from "./[id]/route";
import { POST } from "./route";

const ID = "6f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const doc = () => import("@/lib/presets").then((m) => m.PRESETS[0].doc);
const save = async () =>
  POST(new Request("http://localhost/api/signatures", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Mine", doc: await doc() }) }));
const remove = (id = ID) => DELETE(new Request("http://localhost/api/signatures/x", { method: "DELETE" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  state.configured = true;
  state.user = { id: "u1", email: "u@example.com" };
  state.inserted = [];
  state.deleted = [];
  state.count = 0;
  state.countFilter = null;
  state.updated = [];
});

describe("/api/signatures", () => {
  it("POST: 401 when signed out, and nothing is written", async () => {
    state.user = null;
    const res = await save();
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe("Sign in to save signatures.");
    expect(state.inserted).toHaveLength(0);
  });

  it("POST: 503 when Supabase is not configured", async () => {
    state.configured = false;
    expect((await save()).status).toBe(503);
  });

  it("POST: saves for a signed-in user", async () => {
    expect((await save()).status).toBe(201);
    expect(state.inserted).toHaveLength(1);
  });

  it("POST: 429 at the per-user quota", async () => {
    state.count = 100;
    expect((await save()).status).toBe(429);
    expect(state.inserted).toHaveLength(0);
  });

  it("POST: the quota counts only the caller's own signatures (org admins can also read tagged ones)", async () => {
    await save();
    expect(state.countFilter).toEqual(["owner_id", "u1"]);
  });

  const saveWith = async (extra: Record<string, unknown>) =>
    POST(new Request("http://localhost/api/signatures", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Mine", doc: await doc(), ...extra }) }));

  it("POST: org_id is optional, validated, and only sent to the database when given", async () => {
    await save();
    expect(state.inserted[0]).not.toHaveProperty("org_id");
    expect((await saveWith({ org_id: "not-a-uuid" })).status).toBe(400);
    expect((await saveWith({ org_id: ID })).status).toBe(201);
    expect(state.inserted[1]).toMatchObject({ org_id: ID });
  });

  it("POST: updating without org_id leaves the tag alone, null clears it", async () => {
    await saveWith({ id: ID });
    expect(state.updated[0]).not.toHaveProperty("org_id");
    await saveWith({ id: ID, org_id: null });
    expect(state.updated[1]).toMatchObject({ org_id: null });
  });

  it("DELETE: 401 when signed out, 400 for a bad id, and deletes for a signed-in user", async () => {
    state.user = null;
    expect((await remove()).status).toBe(401);
    state.user = { id: "u1", email: "u@example.com" };
    expect((await remove("not-a-uuid")).status).toBe(400);
    expect((await remove()).status).toBe(200);
    expect(state.deleted).toEqual([ID]);
  });

  it("DELETE: 503 when Supabase is not configured", async () => {
    state.configured = false;
    expect((await remove()).status).toBe(503);
  });
});
