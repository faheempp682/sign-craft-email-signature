import { beforeEach, describe, expect, it, vi } from "vitest";

type Q = { table: string; op?: string; args?: unknown[]; filters: unknown[][] };
const state = vi.hoisted(() => ({
  user: { id: "user-1", email: "me@example.com" } as null | { id: string; email: string },
  featureOn: true as boolean | null,
  queries: [] as Q[],
  answer: (() => ({ data: null, error: null })) as (q: Q) => { data: unknown; error: unknown },
  rpc: [] as { fn: string; args: unknown }[],
  rpcAnswer: { data: true, error: null } as { data: unknown; error: unknown },
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
          if (["select", "insert", "update", "delete"].includes(prop)) {
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
    from: (t: string) => builder(t),
    rpc: async (fn: string, args: unknown) => {
      state.rpc.push({ fn, args });
      if (fn === "feature_enabled") return { data: state.featureOn, error: state.featureOn === null ? { message: "boom" } : null };
      if (fn === "current_app_role") return { data: "member", error: null };
      return state.rpcAnswer;
    },
  };
  return { createClient: async () => client, getUser: async () => state.user };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));

import { PATCH, PUT, DELETE } from "./[id]/route";
import { GET as slugGet } from "./slug/route";
import { GET as list, POST } from "./route";

const UUID = "6f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const GOOD = { slug: "ada-lovelace", display_name: "Ada", social_links: [{ network: "github", url: "https://github.com/ada" }] };
const call = (h: (r: Request, c: never) => Promise<Response>, method: string, body?: unknown, headers: Record<string, string> = {}, url = "http://app.test/api/cards", id = UUID) =>
  h(new Request(url, { method, headers: { "content-type": "application/json", host: "app.test", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ id }) } as never);
const writes = () => state.queries.filter((q) => q.op && q.op !== "select");

beforeEach(() => {
  state.user = { id: "user-1", email: "me@example.com" };
  state.featureOn = true;
  state.queries = [];
  state.rpc = [];
  state.rpcAnswer = { data: true, error: null };
  state.answer = () => ({ data: { id: UUID }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const ROUTES = [
  ["POST /cards", POST, "POST", GOOD],
  ["PUT /cards/[id]", PUT, "PUT", GOOD],
  ["PATCH /cards/[id]", PATCH, "PATCH", { published: true }],
  ["DELETE /cards/[id]", DELETE, "DELETE", undefined],
] as const;

describe.each(ROUTES)("%s: access control", (_n, handler, method, body) => {
  it("is 401 when signed out", async () => {
    state.user = null;
    expect((await call(handler as never, method, body)).status).toBe(401);
    expect(writes()).toHaveLength(0);
  });
  it("is 403 when the digital_card feature is off for the caller", async () => {
    state.featureOn = false;
    const res = await call(handler as never, method, body);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("feature_disabled");
    expect(writes()).toHaveLength(0);
  });
  it("fails closed (503) when the feature check itself fails", async () => {
    state.featureOn = null;
    expect((await call(handler as never, method, body)).status).toBe(503);
    expect(writes()).toHaveLength(0);
  });
  it("refuses a request from another site", async () => {
    const res = await call(handler as never, method, body, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("bad_origin");
    expect(writes()).toHaveLength(0);
  });
});

describe("reads", () => {
  it("GET /cards is 401 signed out and 403 with the feature off", async () => {
    state.user = null;
    expect((await list()).status).toBe(401);
    state.user = { id: "u", email: "e" };
    state.featureOn = false;
    expect((await list()).status).toBe(403);
  });
  it("GET /cards lists only the caller's cards", async () => {
    state.answer = () => ({ data: [{ id: UUID }], error: null });
    const res = await list();
    expect(res.status).toBe(200);
    expect(state.queries[0].filters).toContainEqual(["eq", "owner_id", "user-1"]);
    expect((await res.json()).limit).toBe(5);
  });
  it("slug check needs the feature, validates locally, and asks the database", async () => {
    const get = (qs: string) => slugGet(new Request(`http://app.test/api/cards/slug?${qs}`));
    state.featureOn = false;
    expect((await get("slug=ada")).status).toBe(403);
    state.featureOn = true;
    expect(await (await get("slug=admin")).json()).toMatchObject({ available: false, problem: expect.stringMatching(/reserved/) });
    expect(state.rpc.some((r) => r.fn === "digital_card_slug_available")).toBe(false);
    expect(await (await get("slug=ada-lovelace")).json()).toEqual({ available: true, problem: null });
    state.rpcAnswer = { data: false, error: null };
    expect(await (await get(`slug=ada-lovelace&except=${UUID}`)).json()).toMatchObject({ available: false });
    expect((await get("slug=ada-lovelace&except=not-a-uuid")).status).toBe(400);
  });
});

describe("POST /cards", () => {
  it("creates a private, noindex card owned by the caller, ignoring any owner_id in the body", async () => {
    const res = await call(POST, "POST", { ...GOOD, owner_id: "someone-else", org_id: "x" });
    expect(res.status).toBe(201);
    const w = writes()[0];
    expect(w.op).toBe("insert");
    const row = (w.args as Record<string, unknown>[])[0];
    expect(row).toMatchObject({ owner_id: "user-1", slug: "ada-lovelace", published: false, indexable: false });
    expect(row.org_id).toBeUndefined();
  });
  it.each([
    ["a non-https website", { ...GOOD, website: "http://x.com" }],
    ["a javascript: social link", { ...GOOD, social_links: [{ network: "github", url: "javascript:alert(1)" }] }],
    ["a reserved slug", { ...GOOD, slug: "admin" }],
    ["a bio over 300 characters", { ...GOOD, bio: "x".repeat(301) }],
    ["a missing name", { slug: "ada" }],
    ["malformed JSON", "{nope"],
  ])("rejects %s with 400 and writes nothing", async (_n, body) => {
    expect((await call(POST, "POST", body)).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
  it("maps database failures to honest answers", async () => {
    state.answer = () => ({ data: null, error: { code: "23505", message: "dup" } });
    expect((await call(POST, "POST", GOOD)).status).toBe(409);
    state.answer = () => ({ data: null, error: { code: "P0001", message: "You can have at most 5 digital cards." } });
    const limit = await call(POST, "POST", GOOD);
    expect(limit.status).toBe(409);
    expect((await limit.json()).message).toMatch(/at most 5/);
    state.answer = () => ({ data: null, error: { code: "XX000", message: "secret internal detail" } });
    const bad = await call(POST, "POST", GOOD);
    expect(bad.status).toBe(500);
    expect(JSON.stringify(await bad.json())).not.toMatch(/secret/);
  });
});

describe("/cards/[id]", () => {
  it("is scoped to the caller's own card on update, toggle and delete", async () => {
    await call(PUT, "PUT", GOOD);
    await call(PATCH, "PATCH", { published: true });
    await call(DELETE, "DELETE");
    for (const w of writes()) {
      expect(w.filters).toContainEqual(["eq", "id", UUID]);
      expect(w.filters).toContainEqual(["eq", "owner_id", "user-1"]);
    }
    expect(writes()).toHaveLength(3);
  });
  it("PATCH only sends what it was given", async () => {
    await call(PATCH, "PATCH", { published: true });
    expect((writes()[0].args as unknown[])[0]).toEqual({ published: true });
  });
  it("rejects an empty or unknown PATCH, and a non-uuid id", async () => {
    expect((await call(PATCH, "PATCH", {})).status).toBe(400);
    expect((await call(PATCH, "PATCH", { owner_id: "x" })).status).toBe(400);
    expect((await call(PATCH, "PATCH", { published: true }, {}, undefined, "not-a-uuid")).status).toBe(404);
    expect((await call(DELETE, "DELETE", undefined, {}, undefined, "../x")).status).toBe(404);
  });
  it("answers 404 when the card is not the caller's (or is gone)", async () => {
    state.answer = () => ({ data: null, error: null });
    expect((await call(PUT, "PUT", GOOD)).status).toBe(404);
    state.answer = () => ({ data: [], error: null });
    expect((await call(DELETE, "DELETE")).status).toBe(404);
  });
});
