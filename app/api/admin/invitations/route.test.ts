import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { allowed: true, existingProfile: false, dbError: null as null | { code?: string; message: string }, calls: [] as unknown[][] };

vi.mock("@/lib/admin/route", async (orig) => {
  const real = await orig<typeof import("@/lib/admin/route")>();
  const table = (name: string) => {
    const q: Record<string, unknown> = {};
    const chain = (op: string, ...args: unknown[]) => {
      state.calls.push([name, op, ...args]);
      return q;
    };
    Object.assign(q, {
      select: (...a: unknown[]) => chain("select", ...a),
      ilike: (...a: unknown[]) => chain("ilike", ...a),
      maybeSingle: async () => ({ data: state.existingProfile ? { id: "u1" } : null, error: null }),
      upsert: async (...a: unknown[]) => (chain("upsert", ...a), { error: state.dbError }),
      delete: () => chain("delete"),
      eq: (...a: unknown[]) => chain("eq", ...a),
      is: async (...a: unknown[]) => (chain("is", ...a), { error: state.dbError }),
    });
    return q;
  };
  return {
    ...real,
    // Same checks as the real one (JSON body + schema), but the sign-in / role guard and the database are faked.
    adminRequest: async (req: Request, schema: import("zod").ZodType) => {
      if (!state.allowed) return { ok: false, response: Response.json({ error: "forbidden" }, { status: 403 }) };
      const parsed = schema.safeParse(await req.json());
      if (!parsed.success) return { ok: false, response: Response.json({ error: "bad_request", message: parsed.error.issues[0]?.message }, { status: 400 }) };
      return { ok: true, ctx: { ctx: { supabase: { from: table }, user: { id: "admin-1" }, role: "admin" }, data: parsed.data } };
    },
  };
});

import { DELETE, PUT } from "./route";

const call = (handler: (r: Request) => Promise<Response>, method: string, body: unknown) =>
  handler(new Request("http://localhost/api/admin/invitations", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const upserts = () => state.calls.filter((c) => c[1] === "upsert");

beforeEach(() => Object.assign(state, { allowed: true, existingProfile: false, dbError: null, calls: [] }));

describe("PUT /api/admin/invitations", () => {
  it("invites an address, lowercased and trimmed, with the chosen role", async () => {
    const res = await call(PUT, "PUT", { email: "  Jane@Example.COM ", role: "designer" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "jane@example.com", role: "designer" });
    expect(upserts()).toHaveLength(1);
    expect(upserts()[0][2]).toMatchObject({ email: "jane@example.com", role: "designer", invited_by: "admin-1", accepted_at: null });
  });

  it("refuses a bad address or an unknown role, and writes nothing", async () => {
    expect((await call(PUT, "PUT", { email: "not-an-email", role: "member" })).status).toBe(400);
    expect((await call(PUT, "PUT", { email: "a@b.com", role: "owner" })).status).toBe(400);
    expect(upserts()).toHaveLength(0);
  });

  it("does not invite someone who already has an account", async () => {
    state.existingProfile = true;
    const res = await call(PUT, "PUT", { email: "jane@example.com", role: "member" });
    expect(res.status).toBe(409);
    expect(upserts()).toHaveLength(0);
  });

  it("is 403 for someone who is not an admin, and writes nothing", async () => {
    state.allowed = false;
    expect((await call(PUT, "PUT", { email: "a@b.com", role: "member" })).status).toBe(403);
    expect(state.calls).toHaveLength(0);
  });

  it("answers 403 when row-level security refuses (an admin of another organization)", async () => {
    state.dbError = { code: "42501", message: "new row violates row-level security policy" };
    expect((await call(PUT, "PUT", { email: "a@b.com", role: "member" })).status).toBe(403);
  });
});

describe("DELETE /api/admin/invitations", () => {
  it("withdraws only an unused invitation", async () => {
    const res = await call(DELETE, "DELETE", { email: "Jane@Example.com" });
    expect(res.status).toBe(200);
    expect(state.calls).toContainEqual(["invitations", "eq", "email", "jane@example.com"]);
    expect(state.calls).toContainEqual(["invitations", "is", "accepted_at", null]);
  });
});
