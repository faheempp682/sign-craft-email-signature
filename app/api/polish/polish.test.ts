import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPreset } from "@/lib/presets";

type Q = { table: string; op?: string; args?: unknown[]; filters: unknown[][] };

const state = vi.hoisted(() => ({
  user: { id: "user-1", email: "a@example.com", email_confirmed_at: "x" } as null | { id: string; email: string; email_confirmed_at: string },
  role: "member" as string,
  feature: true as boolean | null,
  queries: [] as { table: string; op?: string; args?: unknown[]; filters: unknown[][] }[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  answer: (() => ({ data: null, error: null })) as (q: { table: string; op?: string; args?: unknown[]; filters: unknown[][] }) => { data: unknown; error: unknown },
  rpcAnswer: (() => ({ data: { id: "x", status: "requested", round: 1 }, error: null })) as (fn: string, args: Record<string, unknown>) => { data: unknown; error: { code?: string; message: string } | null },
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
      if (fn === "current_app_role") return { data: state.role, error: null };
      if (fn === "feature_enabled") return state.feature === null ? { data: null, error: { message: "boom" } } : { data: state.feature, error: null };
      state.rpcs.push({ fn, args });
      return state.rpcAnswer(fn, args);
    },
  };
  return { createClient: async () => client, getUser: async () => state.user };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));

import { GET as list, POST as create } from "./route";
import { GET as detail } from "./[id]/route";
import { POST as claim } from "./[id]/claim/route";
import { POST as release } from "./[id]/release/route";
import { POST as deliver } from "./[id]/deliver/route";
import { POST as comment } from "./[id]/comments/route";
import { POST as accept } from "./[id]/accept/route";
import { POST as decline } from "./[id]/decline/route";
import { POST as cancel } from "./[id]/cancel/route";
import { GET as status } from "./status/route";

const ID = "6f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const SIG = "7a1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const DOC = getPreset("minimal")!.doc;
const post = (handler: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>, body: unknown, headers: Record<string, string> = {}, id = ID) =>
  handler(new Request("http://app.test/api/polish/x", { method: "POST", headers: { "content-type": "application/json", host: "app.test", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const get = (handler: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>, url = "http://app.test/api/polish", id = ID) =>
  handler(new Request(url, { headers: { host: "app.test" } }), { params: Promise.resolve({ id }) });
const writesCalled = () => state.rpcs.filter((r) => r.fn.startsWith("polish_"));

beforeEach(() => {
  state.user = { id: "user-1", email: "a@example.com", email_confirmed_at: "x" };
  state.role = "member";
  state.feature = true;
  state.queries = [];
  state.rpcs = [];
  state.answer = () => ({ data: null, error: null });
  state.rpcAnswer = () => ({ data: { id: ID, status: "requested", round: 1 }, error: null });
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_EMAIL;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const WRITES = [
  ["create", (b?: unknown, h?: Record<string, string>) => post(create as never, b, h), { signatureId: SIG, note: "make it pop", origin: "ai" }, "feature"],
  ["claim", (b?: unknown, h?: Record<string, string>) => post(claim, b, h), {}, "designer"],
  ["release", (b?: unknown, h?: Record<string, string>) => post(release, b, h), {}, "designer"],
  ["deliver", (b?: unknown, h?: Record<string, string>) => post(deliver, b, h), { doc: DOC, changeNote: "bigger banner" }, "designer"],
  ["comments", (b?: unknown, h?: Record<string, string>) => post(comment, b, h), { body: "hello" }, "member"],
  ["accept", (b?: unknown, h?: Record<string, string>) => post(accept, b, h), { mode: "new" }, "member"],
  ["decline", (b?: unknown, h?: Record<string, string>) => post(decline, b, h), { reason: "no", reopen: true }, "member"],
  ["cancel", (b?: unknown, h?: Record<string, string>) => post(cancel, b, h), {}, "member"],
] as const;

describe.each(WRITES)("POST %s: access control", (_name, run, body, who) => {
  it("is 401 when signed out", async () => {
    state.user = null;
    expect((await run(body)).status).toBe(401);
    expect(writesCalled()).toHaveLength(0);
  });

  it("is refused when it comes from another site", async () => {
    const res = await run(body, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("bad_origin");
    expect(writesCalled()).toHaveLength(0);
  });

  it("rejects a body that is not JSON", async () => {
    if (_name === "claim" || _name === "release" || _name === "cancel") return; // these take no body
    state.role = "admin";
    expect((await run("{nope")).status).toBe(400);
    expect(writesCalled()).toHaveLength(0);
  });

  it("rejects an id that is not a UUID", async () => {
    if (_name === "create") return; // creating a request has no id in the path
    state.role = "admin";
    const handler = { claim, release, deliver, comments: comment, accept, decline, cancel }[_name];
    expect((await post(handler, body, {}, "not-a-uuid")).status).toBe(400);
    expect(writesCalled()).toHaveLength(0);
  });

  if (who === "designer") {
    it("is 403 for a member and 200 for a designer and an admin", async () => {
      expect((await run(body)).status).toBe(403);
      expect(writesCalled()).toHaveLength(0);
      for (const role of ["designer", "admin"]) {
        state.role = role;
        expect((await run(body)).status).toBeLessThan(300);
      }
    });
  }

  if (who === "feature") {
    it("is 403 when the feature is off, and 503 when the check itself fails", async () => {
      state.feature = false;
      const off = await run(body);
      expect(off.status).toBe(403);
      expect((await off.json()).error).toBe("feature_disabled");
      state.feature = null;
      expect((await run(body)).status).toBe(503);
      expect(writesCalled()).toHaveLength(0);
    });
  }
});

describe("what each route sends to the database", () => {
  it("create passes the signature id, note and origin, and answers 201", async () => {
    const res = await post(create as never, { signatureId: SIG, note: "  make it pop  ", origin: "manual" });
    expect(res.status).toBe(201);
    expect(writesCalled()).toEqual([{ fn: "polish_create", args: { p_signature_id: SIG, p_note: "make it pop", p_origin: "manual" } }]);
  });

  it("create rejects a missing note, a bad origin and an oversized note without calling the database", async () => {
    for (const bad of [{ signatureId: SIG, note: "  ", origin: "ai" }, { signatureId: SIG, note: "x", origin: "robot" }, { signatureId: SIG, note: "x".repeat(1001), origin: "ai" }, { note: "x", origin: "ai" }, { signatureId: "nope", note: "x", origin: "ai" }]) {
      expect((await post(create as never, bad)).status).toBe(400);
    }
    expect(writesCalled()).toHaveLength(0);
  });

  it("deliver validates the document with the real schema first", async () => {
    state.role = "designer";
    const broken = { ...DOC, theme: { ...DOC.theme, primary: "red" } };
    expect((await post(deliver, { doc: broken, changeNote: "x" })).status).toBe(400);
    expect((await post(deliver, { doc: DOC, changeNote: "   " })).status).toBe(400);
    expect((await post(deliver, { doc: { ...DOC, blocks: [{ type: "banner", src: "http://insecure.example/a.png" }] }, changeNote: "x" })).status).toBe(400);
    expect(writesCalled()).toHaveLength(0);
    expect((await post(deliver, { doc: DOC, changeNote: "Bigger banner" })).status).toBe(200);
    expect(writesCalled()).toEqual([{ fn: "polish_deliver", args: { p_id: ID, p_doc: DOC, p_change_note: "Bigger banner" } }]);
  });

  it("accept refuses to replace the original unless confirmation is explicit", async () => {
    expect((await post(accept, { mode: "replace" })).status).toBe(400);
    expect((await post(accept, { mode: "replace", confirmReplace: false })).status).toBe(400);
    expect((await post(accept, { mode: "nonsense" })).status).toBe(400);
    expect(writesCalled()).toHaveLength(0);
    await post(accept, { mode: "replace", confirmReplace: true });
    await post(accept, { mode: "new", name: "Sales polished" });
    expect(writesCalled().map((c) => c.args)).toEqual([
      { p_id: ID, p_mode: "replace", p_name: null, p_confirm_replace: true },
      { p_id: ID, p_mode: "new", p_name: "Sales polished", p_confirm_replace: false },
    ]);
  });

  it("decline needs a reason and says whether to reopen", async () => {
    expect((await post(decline, { reason: "", reopen: true })).status).toBe(400);
    expect((await post(decline, { reason: "no" })).status).toBe(400);
    await post(decline, { reason: "banner too small", reopen: false });
    expect(writesCalled()).toEqual([{ fn: "polish_decline", args: { p_id: ID, p_reason: "banner too small", p_reopen: false } }]);
  });

  it("comments are trimmed, limited, and answered 201", async () => {
    expect((await post(comment, { body: "x".repeat(2001) })).status).toBe(400);
    expect((await post(comment, { body: "  hi  " })).status).toBe(201);
    expect(writesCalled()[0].args).toEqual({ p_id: ID, p_body: "hi" });
  });

  it("the caller can never choose who they are: no actor id is ever sent", async () => {
    await post(create as never, { signatureId: SIG, note: "x", origin: "ai", requesterId: "someone-else", requester_id: "someone-else" });
    state.role = "designer";
    await post(claim, { designerId: "someone-else" });
    for (const c of writesCalled()) expect(JSON.stringify(c.args)).not.toContain("someone-else");
  });
});

describe("what the database says no to", () => {
  it.each([
    ["not_available", 409],
    ["not_found", 404],
    ["invalid_state", 409],
    ["confirm_required", 400],
    ["already_open", 409],
    ["too_many_open", 429],
    ["forbidden", 403],
  ])("%s becomes HTTP %i", async (message, code) => {
    state.role = "designer";
    state.rpcAnswer = () => ({ data: null, error: { code: "P0001", message } });
    const res = await post(claim, {});
    expect(res.status).toBe(code);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("an unknown database error is a generic 500 that leaks no detail", async () => {
    state.role = "designer";
    state.rpcAnswer = () => ({ data: null, error: { code: "XX000", message: "relation secret_table exploded" } });
    const res = await post(claim, {});
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret_table");
  });

  it("says the migration is missing when the function does not exist", async () => {
    state.rpcAnswer = () => ({ data: null, error: { code: "PGRST202", message: "no function" } });
    expect((await post(cancel, {})).status).toBe(503);
  });
});

describe("GET /api/polish (lists)", () => {
  it("lists the caller's own requests without any documents", async () => {
    state.answer = () => ({ data: [{ id: ID, signature_name: "Sales", origin: "ai", note: "pop", status: "requested", round: 1, created_at: "t", updated_at: "t", delivered_at: null, resolved_at: null }], error: null });
    const res = await get(list, "http://app.test/api/polish?scope=mine");
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
    const q = state.queries[0];
    expect(q.table).toBe("polish_requests");
    expect(q.filters).toContainEqual(["eq", "requester_id", "user-1"]);
    expect(String(q.args?.[0])).not.toMatch(/doc|\*/);
  });

  it("keeps the queue and held lists for designers", async () => {
    for (const scope of ["queue", "held"]) {
      expect((await get(list, `http://app.test/api/polish?scope=${scope}`)).status).toBe(403);
    }
    expect(state.queries).toHaveLength(0);
    state.role = "designer";
    expect((await get(list, "http://app.test/api/polish?scope=queue")).status).toBe(200);
    expect(state.queries[0].filters).toContainEqual(["eq", "status", "requested"]);
    expect((await get(list, "http://app.test/api/polish?scope=held")).status).toBe(200);
    expect(state.queries[1].filters).toContainEqual(["eq", "designer_id", "user-1"]);
  });

  it("is 401 when signed out and 400 for an unknown scope", async () => {
    expect((await get(list, "http://app.test/api/polish?scope=everyone")).status).toBe(400);
    state.user = null;
    expect((await get(list)).status).toBe(401);
  });
});

describe("GET /api/polish/[id]", () => {
  const row = {
    id: ID, requester_id: "user-1", designer_id: null, signature_name: "Sales", origin: "ai", note: "pop", status: "delivered", round: 1, created_at: "t", updated_at: "t", delivered_at: "t",
    original_doc: getPreset("classic")!.doc, delivered_doc: DOC, change_note: "bigger banner", decline_reason: null, source_signature_id: SIG, accepted_mode: null,
  };

  it("is a 404 when row-level security hides it (a stranger's id looks like any missing id)", async () => {
    state.answer = () => ({ data: null, error: null });
    const res = await get(detail);
    expect(res.status).toBe(404);
  });

  it("returns documents that pass the schema, comments, history and the viewer's role", async () => {
    state.answer = (q) =>
      q.table === "polish_requests"
        ? { data: row, error: null }
        : q.table === "polish_comments"
          ? { data: [{ id: "c1", author_id: "user-1", author_role: "requester", body: "hi", created_at: "t" }], error: null }
          : { data: [{ id: "e1", actor_id: "user-1", action: "requested", detail: null, created_at: "t" }], error: null };
    const body = await (await get(detail)).json();
    expect(body).toMatchObject({ isRequester: true, isHolder: false, canClaim: false, status: "delivered", changeNote: "bigger banner", hasSource: true, workDoc: null });
    expect(body.deliveredDoc.template_id).toBe(DOC.template_id);
    expect(body.comments).toEqual([{ id: "c1", role: "requester", mine: true, body: "hi", createdAt: "t" }]);
    expect(body.events[0]).toMatchObject({ action: "requested", by: "requester" });
  });

  it("drops a stored document that no longer passes the schema instead of rendering it", async () => {
    state.answer = (q) => (q.table === "polish_requests" ? { data: { ...row, delivered_doc: { version: 1, template_id: "classic", theme: {}, blocks: [] } }, error: null } : { data: [], error: null });
    expect((await (await get(detail)).json()).deliveredDoc).toBeNull();
  });

  it("gives the work copy only to the designer holding an in-progress request", async () => {
    state.role = "designer";
    const held = { ...row, requester_id: "someone", designer_id: "user-1", status: "in_progress", delivered_doc: null };
    state.answer = (q) => (q.table === "polish_requests" ? { data: held, error: null } : { data: [], error: null });
    const body = await (await get(detail)).json();
    expect(body).toMatchObject({ isHolder: true, isRequester: false });
    expect(body.workDoc.template_id).toBe("classic");
    state.answer = (q) => (q.table === "polish_requests" ? { data: { ...held, designer_id: "user-2", status: "requested" }, error: null } : { data: [], error: null });
    const queued = await (await get(detail)).json();
    expect(queued).toMatchObject({ isHolder: false, canClaim: true, workDoc: null });
  });
});

describe("GET /api/polish/status", () => {
  it("is 403 when the feature is off and 401 when signed out", async () => {
    state.feature = false;
    expect((await get(status as never)).status).toBe(403);
    state.user = null;
    expect((await get(status as never)).status).toBe(401);
  });

  it("reports an open request for the signature", async () => {
    state.answer = () => ({ data: { id: ID }, error: null });
    const res = await get(status as never, `http://app.test/api/polish/status?signatureId=${SIG}`);
    expect(await res.json()).toEqual({ enabled: true, openRequestId: ID });
    expect(state.queries[0].filters).toContainEqual(["eq", "requester_id", "user-1"]);
  });
});
