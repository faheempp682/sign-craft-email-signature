import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/lib/authz/db-harness";
import { SIGNATURE_LIMIT_KEY, envSignatureLimit, parseLimit } from "@/lib/signature-limit";

/**
 * The saved-signature limit end to end, with no mocked logic: the real route handlers (POST/DELETE /api/signatures and
 * PUT /api/admin/signature-limit) run against a real Postgres (PGlite) with every migration applied, including 0019, and the
 * real row-level-security policies. Only the Supabase *client* is swapped for a thin adapter that sends the same queries to
 * that database as the signed-in user (role `authenticated` + JWT subject), the way PostgREST would.
 *
 * What this does not cover: PostgREST itself, Supabase Auth, or the browser. Those need a live project (e2e/signature-limit.e2e.mjs).
 */

type Err = { code?: string; message: string };
type Res = { data: unknown; error: Err | null; count?: number | null };
const state = vi.hoisted(() => ({ t: null as unknown, uid: null as string | null }));
const db = () => state.t as TestDb;

const ident = (s: string) => {
  if (!/^[\w]+$/.test(s)) throw new Error(`bad identifier ${s}`);
  return s;
};
const cols = (s: string) => {
  if (!/^[\w, *]+$/.test(s)) throw new Error(`bad columns ${s}`);
  return s;
};
const param = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);

/** Just enough of supabase-js's query builder for the queries these routes make. */
class Query implements PromiseLike<Res> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private columns = "*";
  private head = false;
  private wantCount = false;
  private row: Record<string, unknown> = {};
  private filters: [string, unknown][] = [];
  private returning = false;
  private one: "single" | "maybe" | null = null;
  private conflict = "";
  constructor(private table: string) {}

  select(c = "*", opts?: { count?: "exact"; head?: boolean }) {
    if (this.op === "select") this.columns = c;
    else this.returning = true;
    if (this.op !== "select") this.columns = c;
    this.wantCount = !!opts?.count;
    this.head = !!opts?.head;
    return this;
  }
  insert(row: Record<string, unknown>) { this.op = "insert"; this.row = row; return this; }
  update(row: Record<string, unknown>) { this.op = "update"; this.row = row; return this; }
  upsert(row: Record<string, unknown>, o: { onConflict: string }) { this.op = "upsert"; this.row = row; this.conflict = o.onConflict; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filters.push([ident(c), v]); return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }

  then<A, B>(ok?: (r: Res) => A | PromiseLike<A>, bad?: (e: unknown) => B | PromiseLike<B>) {
    return this.run().then(ok, bad);
  }

  private async run(): Promise<Res> {
    const params: unknown[] = [];
    const p = (v: unknown) => (params.push(param(v)), `$${params.length}`);
    const where = this.filters.length ? ` where ${this.filters.map(([c, v]) => `${c} = ${p(v)}`).join(" and ")}` : "";
    const t = `public.${ident(this.table)}`;
    const keys = Object.keys(this.row).map(ident);
    const ret = ` returning ${cols(this.columns)}`;
    let sql: string;
    switch (this.op) {
      case "select": sql = this.head ? `select count(*)::int as c from ${t}${where}` : `select ${cols(this.columns)} from ${t}${where}`; break;
      case "insert": sql = `insert into ${t} (${keys.join(",")}) values (${keys.map((k) => p(this.row[k])).join(",")})${ret}`; break;
      case "upsert": sql = `insert into ${t} (${keys.join(",")}) values (${keys.map((k) => p(this.row[k])).join(",")}) on conflict (${ident(this.conflict)}) do update set ${keys.map((k) => `${k} = excluded.${k}`).join(",")}`; break;
      case "update": sql = `update ${t} set ${keys.map((k) => `${k} = ${p(this.row[k])}`).join(",")}${where}${ret}`; break;
      case "delete": sql = `delete from ${t}${where}${this.returning ? ret : ""}`; break;
    }
    try {
      const r = await db().as(state.uid, () => db().db.query<Record<string, unknown>>(sql, params));
      if (this.head) return { data: null, error: null, count: (r.rows[0] as { c: number }).c };
      const rows = r.rows;
      if (this.one === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "not exactly one row" } };
      if (this.one === "maybe") return { data: rows[0] ?? null, error: null };
      return { data: this.op === "select" || this.returning ? rows : null, error: null };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { data: null, error: { code: err.code, message: err.message ?? "error" } };
    }
  }
}

const client = {
  from: (table: string) => new Query(table),
  rpc: async (name: string): Promise<Res> => {
    try {
      const r = await db().as(state.uid, () => db().db.query<{ v: unknown }>(`select public.${ident(name)}() as v`));
      return { data: r.rows[0].v, error: null };
    } catch (e) {
      return { data: null, error: { code: (e as { code?: string }).code, message: (e as Error).message } };
    }
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client,
  getUser: async () => (state.uid ? { id: state.uid, email: `${state.uid}@example.com` } : null),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));

import { PUT as putLimit } from "../admin/signature-limit/route";
import { DELETE } from "./[id]/route";
import { POST } from "./route";

let t: TestDb;
let n = 0;
let alice: string; // plain member
let bob: string; // another plain member
let platform: string; // admin of the default organization
let clientAdmin: string; // admin of a client organization only
const as = (uid: string) => void (state.uid = uid);
const q = async <R = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await t.db.query<R>(sql, p)).rows;

async function person(role: "member" | "admin", org?: string) {
  const id = await t.addUser(`lim${++n}@example.com`);
  if (org) {
    await q("delete from public.memberships where user_id = $1", [id]);
    await q("insert into public.memberships (org_id, user_id, role) values ($1,$2,$3)", [org, id, role]);
  } else if (role === "admin") await t.setRole(id, "admin");
  return id;
}

const doc = () => import("@/lib/presets").then((m) => m.PRESETS[0].doc);
async function save(name: string, id?: string) {
  const res = await POST(new Request("http://localhost/api/signatures", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, doc: await doc(), ...(id ? { id } : {}) }) }));
  return { status: res.status, body: (await res.json()) as { id?: string; message?: string; limit?: number; error?: string } };
}
const remove = async (id: string) => (await DELETE(new Request(`http://localhost/api/signatures/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) })).status;
const setLimit = async (limit: unknown, headers: Record<string, string> = {}) => {
  const res = await putLimit(new Request("http://localhost/api/admin/signature-limit", { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ limit }) }));
  return { status: res.status, body: (await res.json()) as { limit?: number; source?: string; message?: string } };
};
const owned = async (uid: string) => (await q<{ id: string; name: string }>("select id, name from public.signatures where owner_id = $1 order by created_at, name", [uid]));
/** What the Limits admin page reads on every load (app/(app)/admin/limits/page.tsx). */
const pageReads = (uid: string) => {
  as(uid);
  return client.from("platform_settings").select("value").eq("key", SIGNATURE_LIMIT_KEY).maybeSingle().then((r) => parseLimit((r.data as { value: unknown } | null)?.value));
};

beforeAll(async () => {
  t = await createTestDb();
  state.t = t;
  const defaultOrg = (await q<{ id: string }>("select id from public.organizations where is_default"))[0].id;
  const clientOrg = (await q<{ id: string }>("insert into public.organizations (name, parent_id) values ('Client', $1) returning id", [defaultOrg]))[0].id;
  alice = await person("member");
  bob = await person("member");
  platform = await person("admin");
  clientAdmin = await person("admin", clientOrg);
}, 90_000);
afterAll(async () => {
  await t.db.close();
});
beforeEach(async () => {
  delete process.env.MAX_SIGNATURES_PER_ACCOUNT;
  await q("delete from public.platform_settings");
  await q("delete from public.signatures");
});

describe("the default limit of 5, against a real database", () => {
  it("saves 5, refuses the 6th, and keeps exactly 5 rows", async () => {
    as(alice);
    for (let i = 1; i <= 5; i++) expect((await save(`Sig ${i}`)).status, `save ${i}`).toBe(201);
    const sixth = await save("Sig 6");
    expect(sixth.status).toBe(429);
    expect(sixth.body.limit).toBe(5);
    expect(sixth.body.message).toContain("limit of 5");
    expect(await owned(alice)).toHaveLength(5);
  });

  it("editing an existing signature still works at the limit, and does not add a row", async () => {
    as(alice);
    const first = await save("Sig 1");
    for (let i = 2; i <= 5; i++) await save(`Sig ${i}`);
    const edit = await save("Sig 1 renamed", first.body.id);
    expect(edit.status).toBe(200);
    expect((await owned(alice)).map((r) => r.name)).toContain("Sig 1 renamed");
    expect(await owned(alice)).toHaveLength(5);
  });

  it("deleting one frees a slot for exactly one more", async () => {
    as(alice);
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) ids.push((await save(`Sig ${i}`)).body.id!);
    expect(await remove(ids[2])).toBe(200);
    expect((await save("Replacement")).status).toBe(201);
    expect((await save("One too many")).status).toBe(429);
    expect(await owned(alice)).toHaveLength(5);
  });

  it("is per account: another person's signatures do not count, and cannot be deleted by someone else", async () => {
    as(alice);
    const mine: string[] = [];
    for (let i = 1; i <= 5; i++) mine.push((await save(`A${i}`)).body.id!);
    as(bob);
    expect((await save("B1")).status).toBe(201);
    expect(await remove(mine[0])).toBe(404); // row-level security: not Bob's
    expect(await owned(alice)).toHaveLength(5);
  });

  it("an org admin who can READ someone's tagged signature does not have it counted against them", async () => {
    // The quota counts owner_id = caller only; this guards the query against widening to "rows I can see".
    as(alice);
    for (let i = 1; i <= 5; i++) await save(`A${i}`);
    as(platform);
    for (let i = 1; i <= 5; i++) expect((await save(`P${i}`)).status).toBe(201);
  });
});

describe("the admin setting, against a real database", () => {
  it("a platform admin sets the limit; it is stored as a number and the next save obeys it", async () => {
    as(platform);
    expect(await setLimit(8)).toEqual({ status: 200, body: { limit: 8, source: "admin" } });
    expect((await q<{ value: unknown }>("select value from public.platform_settings where key = $1", [SIGNATURE_LIMIT_KEY]))[0].value).toBe(8);
    as(alice);
    for (let i = 1; i <= 8; i++) expect((await save(`S${i}`)).status, `save ${i}`).toBe(201);
    const ninth = await save("S9");
    expect(ninth.status).toBe(429);
    expect(ninth.body.message).toContain("limit of 8");
  });

  it("persists: the Limits page reads the same value in a fresh request, for any signed-in user", async () => {
    as(platform);
    await setLimit(7);
    expect(await pageReads(platform)).toBe(7);
    expect(await pageReads(alice)).toBe(7);
    state.uid = null; // "refresh": nothing is remembered in the process, only in the database
    expect(await pageReads(platform)).toBe(7);
  });

  it("lowering it below what someone already has: they keep their signatures, can still edit, but cannot save more", async () => {
    as(alice);
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) ids.push((await save(`S${i}`)).body.id!);
    as(platform);
    await setLimit(2);
    as(alice);
    expect(await owned(alice)).toHaveLength(5); // nothing is deleted
    expect((await save("S1 edited", ids[0])).status).toBe(200); // editing is allowed
    expect((await save("New")).status).toBe(429);
    expect((await save("New")).body.message).toContain("limit of 2");
    // They have to get down to below the limit before they can add again.
    await remove(ids[1]);
    await remove(ids[2]);
    await remove(ids[3]);
    expect((await save("New")).status).toBe(429); // 2 saved, limit 2
    await remove(ids[4]);
    expect((await save("New")).status).toBe(201); // 1 saved, limit 2
    expect(await owned(alice)).toHaveLength(2);
  });

  it("raising it again lets people save more straight away", async () => {
    as(platform);
    await setLimit(1);
    as(alice);
    await save("One");
    expect((await save("Two")).status).toBe(429);
    as(platform);
    await setLimit(3);
    as(alice);
    expect((await save("Two")).status).toBe(201);
  });

  it("clearing it removes the row and the environment value (or 5) applies again", async () => {
    as(platform);
    await setLimit(2);
    process.env.MAX_SIGNATURES_PER_ACCOUNT = "4";
    expect(await setLimit(null)).toEqual({ status: 200, body: { limit: 4, source: "default" } });
    expect(await q("select * from public.platform_settings")).toEqual([]);
    expect(envSignatureLimit()).toBe(4);
    as(alice);
    for (let i = 1; i <= 4; i++) expect((await save(`S${i}`)).status).toBe(201);
    expect((await save("S5")).status).toBe(429);
  });

  it("setting it twice keeps one row (no duplicates)", async () => {
    as(platform);
    await setLimit(3);
    await setLimit(6);
    const rows = await q<{ value: unknown }>("select value from public.platform_settings");
    expect(rows).toEqual([{ value: 6 }]);
  });

  it("a member and a client organization's admin are refused with 403, and nothing changes", async () => {
    as(platform);
    await setLimit(3);
    for (const who of [alice, clientAdmin]) {
      as(who);
      expect((await setLimit(100)).status, who).toBe(403);
      expect((await setLimit(null)).status, who).toBe(403);
    }
    expect(await pageReads(platform)).toBe(3);
  });

  it("signed out: 401", async () => {
    state.uid = null;
    expect((await setLimit(5)).status).toBe(401);
  });

  it("a request from another website is refused", async () => {
    as(platform);
    expect((await setLimit(9, { origin: "https://evil.example", host: "localhost" })).status).toBe(403);
    expect(await q("select * from public.platform_settings")).toEqual([]);
  });

  it.each([0, -1, 1001, 2.5, "7", "abc", true, {}])("refuses %j with 400 and stores nothing", async (bad) => {
    as(platform);
    expect((await setLimit(bad)).status).toBe(400);
    expect(await q("select * from public.platform_settings")).toEqual([]);
  });

  it("a stored value that is not valid (edited by hand) is ignored: the default applies", async () => {
    await q("insert into public.platform_settings (key, value) values ($1, '\"lots\"'::jsonb)", [SIGNATURE_LIMIT_KEY]);
    as(alice);
    for (let i = 1; i <= 5; i++) await save(`S${i}`);
    expect((await save("S6")).status).toBe(429);
  });
});

describe("before migration 0019 is applied", () => {
  it("saving still works with the environment value, and the admin route says what to do", async () => {
    await q("drop table public.platform_settings");
    try {
      process.env.MAX_SIGNATURES_PER_ACCOUNT = "2";
      as(alice);
      expect((await save("One")).status).toBe(201);
      expect((await save("Two")).status).toBe(201);
      expect((await save("Three")).status).toBe(429);
      as(platform);
      const r = await setLimit(9);
      expect(r.status).toBe(503);
      expect(r.body.message).toContain("0019_platform_settings.sql");
    } finally {
      await t.db.exec(await import("node:fs").then((fs) => fs.readFileSync("supabase/migrations/0019_platform_settings.sql", "utf8")));
    }
  });
});
