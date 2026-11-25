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

import { PRESETS } from "@/lib/presets";
import { POST as review } from "./approvals/[id]/route";
import { GET as listApprovals } from "./approvals/route";
import { POST as importCsv } from "./import/route";
import { GET as getMine, POST as postMine } from "./mine/route";
import { GET as exportCsv } from "./people/export/route";
import { DELETE as deletePerson, PATCH as patchPerson } from "./people/[id]/route";
import { GET as listPeople, POST as createPerson } from "./people/route";
import { GET as getSettings, PUT as putSettings } from "./settings/route";
import { PATCH as patchTemplate } from "./templates/[id]/route";
import { GET as listTemplates, POST as createTemplate } from "./templates/route";

const ORG = "6f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const ID = "8f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const params = (id = ID) => ({ params: Promise.resolve({ id }) });
const req = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://app.test${url}`, { method, headers: { "content-type": "application/json", host: "app.test", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const writes = () => state.queries.filter((q) => q.op && q.op !== "select");
const memberships = (q: Q) => (q.table === "memberships" ? { data: [{ org_id: ORG }], error: null } : null);

beforeEach(() => {
  state.user = { id: "admin-1", email: "boss@example.com", email_confirmed_at: "x" };
  state.role = "admin";
  state.features = { team_deploy: true };
  state.queries = [];
  state.rpcs = [];
  state.answer = (q) => memberships(q) ?? { data: [{ id: ID }], error: null };
  state.rpcAnswer = () => ({ data: null, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const person = { email: "ann@example.com", full_name: "Ann Lee" };

const ADMIN_ROUTES: [string, () => Promise<Response>, boolean][] = [
  ["GET /people", () => listPeople(req("/api/team/people", "GET")), false],
  ["POST /people", () => createPerson(req("/api/team/people", "POST", { person })), true],
  ["PATCH /people/:id", () => patchPerson(req("/api/team/people/x", "PATCH", { person: { title: "CTO" } }), params()), true],
  ["DELETE /people/:id", () => deletePerson(req("/api/team/people/x", "DELETE"), params()), true],
  ["GET /people/export", () => exportCsv(req("/api/team/people/export", "GET")), false],
  ["POST /import", () => importCsv(req("/api/team/import", "POST", { mode: "preview", csv: "email,name\na@x.com,A" })), true],
  ["GET /templates", () => listTemplates(req("/api/team/templates", "GET")), false],
  ["POST /templates", () => createTemplate(req("/api/team/templates", "POST", { name: "T", from: { kind: "preset", id: PRESETS[0].id } })), true],
  ["PATCH /templates/:id", () => patchTemplate(req("/api/team/templates/x", "PATCH", { name: "N" }), params()), true],
  ["GET /approvals", () => listApprovals(req("/api/team/approvals", "GET")), false],
  ["POST /approvals/:id", () => review(req("/api/team/approvals/x", "POST", { decision: "approve" }), params()), true],
  ["GET /settings", () => getSettings(req("/api/team/settings", "GET")), false],
  ["PUT /settings", () => putSettings(req("/api/team/settings", "PUT", { require_approval: true })), true],
];

describe("admin routes: authorization", () => {
  it.each(ADMIN_ROUTES)("%s: 401 signed out, 403 for a member, 403 with the flag off, 403 from another site", async (_n, call, isWrite) => {
    state.user = null;
    expect((await call()).status).toBe(401);
    state.user = { id: "u", email: "u@x.com", email_confirmed_at: "x" };
    state.role = "member";
    expect((await call()).status).toBe(403);
    state.role = "designer";
    expect((await call()).status).toBe(403);
    state.role = "admin";
    state.features = { team_deploy: false };
    expect((await call()).status).toBe(403);
    expect(writes()).toHaveLength(0);
    expect(state.rpcs.filter((r) => ["import_people", "review_signature"].includes(r.fn))).toHaveLength(0);
    state.features = { team_deploy: true };
    expect((await call()).status).toBeLessThan(400);
    void isWrite;
  });

  it.each(ADMIN_ROUTES.filter((r) => r[2]))("%s: refuses a cross-site write", async (n) => {
    const origin = { origin: "https://evil.example" };
    const calls: Record<string, () => Promise<Response>> = {
      "POST /people": () => createPerson(req("/api/team/people", "POST", { person }, origin)),
      "PATCH /people/:id": () => patchPerson(req("/api/team/people/x", "PATCH", { person: { title: "x" } }, origin), params()),
      "DELETE /people/:id": () => deletePerson(req("/api/team/people/x", "DELETE", undefined, origin), params()),
      "POST /import": () => importCsv(req("/api/team/import", "POST", { mode: "preview", csv: "a" }, origin)),
      "POST /templates": () => createTemplate(req("/api/team/templates", "POST", { name: "T", from: { kind: "preset", id: "x" } }, origin)),
      "PATCH /templates/:id": () => patchTemplate(req("/api/team/templates/x", "PATCH", { name: "N" }, origin), params()),
      "POST /approvals/:id": () => review(req("/api/team/approvals/x", "POST", { decision: "approve" }, origin), params()),
      "PUT /settings": () => putSettings(req("/api/team/settings", "PUT", { require_approval: true }, origin)),
    };
    expect((await calls[n]()).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });
});

describe("people", () => {
  it("scopes every query to the admin's organization and escapes search text", async () => {
    await listPeople(req("/api/team/people?q=a%25b,c)&department=Sales&source=csv&status=active&limit=9999", "GET"));
    const q = state.queries.find((x) => x.table === "people")!;
    expect(q.filters).toContainEqual(["eq", "org_id", ORG]);
    expect(q.filters).toContainEqual(["range", 0, 199]);
    const or = q.filters.find((f) => f[0] === "or")![1] as string;
    expect(or).not.toMatch(/%b|,c|\)/);
    expect(q.filters).toContainEqual(["eq", "source", "csv"]);
  });

  it("creates a person from a validated, normalised record and forces source manual and the admin's organization", async () => {
    const res = await createPerson(req("/api/team/people", "POST", { person: { ...person, email: " ANN@Example.com ", org_id: "evil", source: "google" } }));
    expect(res.status).toBe(201);
    const row = writes()[0].args![0] as Record<string, unknown>;
    expect(row).toMatchObject({ email: "ann@example.com", org_id: ORG, source: "manual", full_name: "Ann Lee" });
  });

  it("rejects bad people: invalid email, missing name, too many custom fields", async () => {
    expect((await createPerson(req("/api/team/people", "POST", { person: { email: "nope", full_name: "A" } }))).status).toBe(400);
    expect((await createPerson(req("/api/team/people", "POST", { person: { email: "a@x.com" } }))).status).toBe(400);
    const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"]));
    expect((await createPerson(req("/api/team/people", "POST", { person: { ...person, custom: many } }))).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  it("PATCH changes only what was sent, within the organization, and refuses unknown fields", async () => {
    expect((await patchPerson(req("/x", "PATCH", { person: { title: "CTO" } }), params())).status).toBe(200);
    const q = writes()[0];
    expect(q.args![0]).toEqual({ title: "CTO" });
    expect(q.filters).toContainEqual(["eq", "org_id", ORG]);
    expect((await patchPerson(req("/x", "PATCH", { person: { org_id: "x" } }), params())).status).toBe(400);
    expect((await patchPerson(req("/x", "PATCH", { person: {} }), params())).status).toBe(400);
    expect((await patchPerson(req("/x", "PATCH", { person: { title: "x" } }), params("nope"))).status).toBe(400);
  });

  it("DELETE answers 404 when nothing matched (another organization's person)", async () => {
    state.answer = (q) => memberships(q) ?? { data: [], error: null };
    expect((await deletePerson(req("/x", "DELETE"), params())).status).toBe(404);
  });

  it("maps a duplicate e-mail to 409", async () => {
    state.answer = (q) => memberships(q) ?? { data: null, error: { code: "23505", message: "dup" } };
    expect((await createPerson(req("/api/team/people", "POST", { person }))).status).toBe(409);
  });
});

describe("export", () => {
  it("neutralises formulas and quotes properly", async () => {
    state.answer = (q) =>
      memberships(q) ?? { data: [{ email: "a@x.com", full_name: "=HYPERLINK(\"http://evil\")", title: "Lee, \"Ann\"", phone: "+1 555", custom: { badge: "@x" } }], error: null };
    const res = await exportCsv(req("/api/team/people/export", "GET"));
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
    const text = await res.text();
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain("'+1 555");
    expect(text).toContain("'@x");
    expect(text).toContain('"Lee, ""Ann"""');
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});

describe("import", () => {
  const csv = "email,name,title\r\nann@x.com,Ann,CTO\r\nbad,Bad,\r\nann@x.com,Dup,\r\nbob@x.com,Bob,Chef\r\n";
  const mapping = { 0: "email", 1: "full_name", 2: "title" };
  const call = (body: unknown) => importCsv(req("/api/team/import", "POST", body));

  it("preview suggests a mapping and writes nothing", async () => {
    const res = await call({ mode: "preview", csv });
    const body = await res.json();
    expect(body.headers).toEqual(["email", "name", "title"]);
    expect(body.mapping).toEqual({ 0: "email", 1: "full_name", 2: "title" });
    expect(writes()).toHaveLength(0);
    expect(state.rpcs.some((r) => r.fn === "import_people")).toBe(false);
  });

  it("dry-run reports row errors and never writes", async () => {
    state.answer = (q) => memberships(q) ?? { data: [{ email: "bob@x.com" }], error: null };
    const body = await (await call({ mode: "dry-run", csv, mapping })).json();
    expect(body.errors.map((e: { row: number }) => e.row)).toEqual([3, 4]);
    expect(body.creates).toBe(1);
    expect(body.updates).toBe(1);
    expect(state.rpcs.some((r) => r.fn === "import_people")).toBe(false);
  });

  it("commit refuses a file with errors unless the admin chose to skip them", async () => {
    const refused = await call({ mode: "commit", csv, mapping });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe("has_errors");
    expect(state.rpcs.some((r) => r.fn === "import_people")).toBe(false);
  });

  it("commit sends only the valid, re-validated rows, with the admin's organization", async () => {
    state.rpcAnswer = (fn) => (fn === "import_people" ? { data: { import_id: "i1", created: 2, updated: 0 }, error: null } : { data: null, error: null });
    const res = await call({ mode: "commit", csv, mapping, skip_invalid: true, filename: "team.csv" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 2, skipped: 2 });
    const rpc = state.rpcs.find((r) => r.fn === "import_people")!;
    expect(rpc.args).toMatchObject({ p_org: ORG, p_source: "csv", p_filename: "team.csv", p_skipped: 2 });
    expect((rpc.args!.p_rows as { email: string }[]).map((r) => r.email)).toEqual(["ann@x.com", "bob@x.com"]);
  });

  it("refuses a bad mapping, a missing mapping, an oversized body and nonsense modes", async () => {
    expect((await call({ mode: "dry-run", csv })).status).toBe(400);
    expect((await (await call({ mode: "dry-run", csv, mapping: { 0: "title" } })).json()).fatal).toMatch(/email/);
    expect((await call({ mode: "commit", csv, mapping: { 0: "title" } })).status).toBe(400);
    expect((await call({ mode: "explode", csv })).status).toBe(400);
    const big = "email,name\n" + "a@b.co,N\n".repeat(300_000);
    expect((await call({ mode: "preview", csv: big })).status).toBe(400);
    const huge = importCsv(new Request("http://app.test/api/team/import", { method: "POST", headers: { "content-type": "application/json", "content-length": String(10 * 1024 * 1024), host: "app.test" }, body: "{}" }));
    expect((await huge).status).toBe(413);
  });

  it("a database failure on commit surfaces as an error and nothing is reported as imported", async () => {
    state.rpcAnswer = (fn) => (fn === "import_people" ? { data: null, error: { code: "23505", message: "dup" } } : { data: null, error: null });
    expect((await call({ mode: "commit", csv, mapping, skip_invalid: true })).status).toBe(409);
  });
});

describe("templates", () => {
  it("creates from a preset with default lock and mapping, in the admin's organization", async () => {
    const res = await createTemplate(req("/api/team/templates", "POST", { name: "Sales", from: { kind: "preset", id: PRESETS[0].id }, departments: ["Sales"] }));
    expect(res.status).toBe(201);
    const row = writes()[0].args![0] as { org_id: string; lock_json: { editable: string[] }; field_map: Record<string, string>; departments: string[]; doc_json: { version: number } };
    expect(row.org_id).toBe(ORG);
    expect(row.doc_json.version).toBe(1);
    expect(row.lock_json.editable.length).toBeGreaterThan(0);
    expect(Object.values(row.field_map)).toContain("full_name");
    expect(row.departments).toEqual(["Sales"]);
  });

  it("creates from a saved signature (read through row-level security) and refuses an unknown one", async () => {
    state.answer = (q) => memberships(q) ?? (q.table === "signatures" ? { data: { doc_json: PRESETS[1].doc }, error: null } : { data: { id: ID }, error: null });
    expect((await createTemplate(req("/x", "POST", { name: "From sig", from: { kind: "signature", id: ID } }))).status).toBe(201);
    state.answer = (q) => memberships(q) ?? { data: null, error: null };
    expect((await createTemplate(req("/x", "POST", { name: "Gone", from: { kind: "signature", id: ID } }))).status).toBe(404);
    expect((await createTemplate(req("/x", "POST", { name: "x", from: { kind: "preset", id: "nope" } }))).status).toBe(404);
  });

  it("refuses a stored document that no longer validates", async () => {
    state.answer = (q) => memberships(q) ?? (q.table === "signatures" ? { data: { doc_json: { version: 1, nonsense: true } }, error: null } : { data: { id: ID }, error: null });
    expect((await createTemplate(req("/x", "POST", { name: "Bad", from: { kind: "signature", id: ID } }))).status).toBe(400);
  });

  it("PATCH validates lock and mapping together against the stored document", async () => {
    const doc = PRESETS[0].doc;
    state.answer = (q) => memberships(q) ?? { data: { id: ID, doc_json: doc, lock_json: { editable: [] }, field_map: {} }, error: null };
    const idIdx = doc.blocks.findIndex((b) => b.type === "identity");
    expect((await patchTemplate(req("/x", "PATCH", { lock: { editable: [`${idIdx}.title`] } }), params())).status).toBe(200);
    expect((writes().at(-1)!.args![0] as { lock_json: unknown }).lock_json).toEqual({ editable: [`${idIdx}.title`] });
    const before = writes().length;
    expect((await patchTemplate(req("/x", "PATCH", { lock: { editable: ["0.src"] } }), params())).status).toBe(400);
    expect((await patchTemplate(req("/x", "PATCH", { field_map: { [`${idIdx}.name`]: "ssn" } }), params())).status).toBe(400);
    expect((await patchTemplate(req("/x", "PATCH", { org_id: "other" }), params())).status).toBe(400);
    expect(writes()).toHaveLength(before);
  });
});

describe("approvals and settings", () => {
  it("approve and reject call the database function; reject needs a reason", async () => {
    expect((await review(req("/x", "POST", { decision: "approve" }), params())).status).toBe(200);
    expect(state.rpcs.find((r) => r.fn === "review_signature")!.args).toMatchObject({ p_id: ID, p_approve: true });
    state.rpcs = [];
    expect((await review(req("/x", "POST", { decision: "reject", note: "  " }), params())).status).toBe(400);
    expect(state.rpcs.some((r) => r.fn === "review_signature")).toBe(false);
    expect((await review(req("/x", "POST", { decision: "reject", note: "Wrong title" }), params())).status).toBe(200);
    expect(state.rpcs.find((r) => r.fn === "review_signature")!.args).toMatchObject({ p_approve: false, p_note: "Wrong title" });
  });

  it("maps database refusals: already decided 409, own submission 403", async () => {
    state.rpcAnswer = () => ({ data: null, error: { code: "TM005", message: "That submission has already been reviewed." } });
    expect((await review(req("/x", "POST", { decision: "approve" }), params())).status).toBe(409);
    state.rpcAnswer = () => ({ data: null, error: { code: "TM006", message: "x" } });
    expect((await review(req("/x", "POST", { decision: "approve" }), params())).status).toBe(403);
  });

  it("settings default to off and are written for the admin's organization", async () => {
    state.answer = (q) => memberships(q) ?? { data: null, error: null };
    expect((await (await getSettings(req("/x", "GET"))).json()).require_approval).toBe(false);
    await putSettings(req("/x", "PUT", { require_approval: true }));
    expect(writes()[0].args![0]).toMatchObject({ org_id: ORG, require_approval: true, updated_by: "admin-1" });
    expect((await putSettings(req("/x", "PUT", { require_approval: "yes" }))).status).toBe(400);
  });

  it("lists approvals for the organization only", async () => {
    await listApprovals(req("/api/team/approvals", "GET"));
    const q = state.queries.find((x) => x.table === "signature_versions")!;
    expect(q.filters).toContainEqual(["eq", "org_id", ORG]);
    expect(q.filters).toContainEqual(["eq", "status", "pending"]);
  });
});

describe("employee route /api/team/mine", () => {
  const doc = PRESETS[0].doc;
  const idIdx = doc.blocks.findIndex((b) => b.type === "identity");
  const emp = { id: "p1", org_id: ORG, email: "ann@x.com", full_name: "Ann Lee", title: "Eng", department: "", phone: "", mobile: "", location: "", first_name: "", last_name: "", custom: {} };
  const template = { id: "t1", name: "Brand", doc_json: doc, lock_json: { editable: [`${idIdx}.title`] }, field_map: { [`${idIdx}.name`]: "full_name" } };

  function setup(over: { template?: unknown } = {}) {
    state.user = { id: "emp-1", email: "ann@x.com", email_confirmed_at: "x" };
    state.role = "member";
    state.answer = (q) => {
      if (q.table === "memberships") return { data: [{ org_id: ORG }], error: null };
      if (q.table === "people") return { data: [emp], error: null };
      if (q.table === "brand_templates") return { data: over.template === undefined ? template : over.template, error: null };
      if (q.table === "org_settings") return { data: { require_approval: true }, error: null };
      if (q.table === "signature_versions") return { data: [], error: null };
      return { data: null, error: null };
    };
    state.rpcAnswer = (fn) => {
      if (fn === "template_for_person") return { data: "t1", error: null };
      if (fn === "submit_signature") return { data: "v1", error: null };
      return { data: null, error: null };
    };
  }

  it("needs sign-in and, for writes, a same-site request", async () => {
    state.user = null;
    expect((await getMine(req("/api/team/mine", "GET"))).status).toBe(401);
    expect((await postMine(req("/api/team/mine", "POST", { values: {} }))).status).toBe(401);
    setup();
    expect((await postMine(req("/api/team/mine", "POST", { values: {} }, { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("GET returns the person, the template and the settings, claiming the directory entry first", async () => {
    setup();
    const body = await (await getMine(req("/api/team/mine", "GET"))).json();
    expect(body).toMatchObject({ state: "ok", requireApproval: true, template: { name: "Brand" } });
    expect(state.rpcs.some((r) => r.fn === "claim_my_person" && r.args?.p_org === ORG)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("org_id");
  });

  it("GET says so when there is no directory entry or no template", async () => {
    setup();
    state.answer = (q) => (q.table === "memberships" ? { data: [{ org_id: ORG }], error: null } : { data: [], error: null });
    expect((await (await getMine(req("/x", "GET"))).json()).state).toBe("no_person");
    setup({ template: null });
    expect((await (await getMine(req("/x", "GET"))).json()).state).toBe("no_template");
  });

  it("POST submits allowed values through the database function", async () => {
    setup();
    const res = await postMine(req("/api/team/mine", "POST", { values: { [`${idIdx}.title`]: "Chief" } }));
    expect(res.status).toBe(201);
    expect(state.rpcs.find((r) => r.fn === "submit_signature")!.args).toEqual({ p_org: ORG, p_values: { [`${idIdx}.title`]: "Chief" } });
  });

  it("POST refuses locked fields on the server before the database is called", async () => {
    setup();
    for (const values of [{ [`${idIdx}.company`]: "Evil" }, { "0.src": "https://evil.example/a.png" }, { "theme.primary": "#000000" }]) {
      const res = await postMine(req("/api/team/mine", "POST", { values }));
      expect(res.status).toBe(400);
      expect((await res.json()).message).toMatch(/locked/);
    }
    expect(state.rpcs.some((r) => r.fn === "submit_signature")).toBe(false);
  });

  it("POST refuses non-text values, bad bodies and people without a template", async () => {
    setup();
    expect((await postMine(req("/x", "POST", { values: { [`${idIdx}.title`]: 5 } }))).status).toBe(400);
    expect((await postMine(req("/x", "POST", { values: { [`${idIdx}.title`]: "x".repeat(101) } }))).status).toBe(400);
    expect((await postMine(req("/x", "POST", "not json"))).status).toBe(400);
    setup({ template: null });
    expect((await postMine(req("/x", "POST", { values: {} }))).status).toBe(404);
    expect(state.rpcs.some((r) => r.fn === "submit_signature")).toBe(false);
  });

  it("POST passes through the database's lock refusal and pending conflict", async () => {
    setup();
    state.rpcAnswer = (fn) => (fn === "submit_signature" ? { data: null, error: { code: "TM004", message: "You already have a change waiting for review." } } : { data: fn === "template_for_person" ? "t1" : null, error: null });
    const res = await postMine(req("/x", "POST", { values: { [`${idIdx}.title`]: "A" } }));
    expect(res.status).toBe(409);
  });
});
