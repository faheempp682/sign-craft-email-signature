import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/authz/db-harness";

/** Migration 0011 in a real Postgres (PGlite): access rules, the one-transaction apply, the safety cap, the service path. */

let t: TestDb;
let n = 0;
const addr = () => `t${++n}@example.com`;

async function newOrg(name = "Acme") {
  return (await t.db.query<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [name])).rows[0].id;
}
async function member(org: string, role: "member" | "admin" = "member") {
  const id = await t.addUser(addr());
  await t.db.query("insert into public.memberships (org_id, user_id, role) values ($1, $2, $3) on conflict (org_id, user_id) do update set role = $3", [org, id, role]);
  return id;
}
async function person(org: string, o: { email?: string; name?: string; source?: string; ext?: string | null; status?: string; title?: string; phone?: string; custom?: object } = {}) {
  return (
    await t.db.query<{ id: string }>("insert into public.people (org_id, email, full_name, source, external_id, status, title, phone, custom) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id", [
      org, o.email ?? addr(), o.name ?? "Ada", o.source ?? "manual", o.ext ?? null, o.status ?? "active", o.title ?? "", o.phone ?? "", JSON.stringify(o.custom ?? {}),
    ])
  ).rows[0].id;
}
/** Google-managed people: ten of them, so a cap of 20 percent allows two deactivations. */
async function googleTen(org: string) {
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push(await person(org, { email: `g${i}@acme.com`, name: `G${i}`, source: "google", ext: `g${i}` }));
  return ids;
}

const emptyPlan = { creates: [], updates: [], deactivates: [], unchanged: 0, warnings: [] };
const create = (i: number) => ({ email: `new${i}@acme.com`, external_id: `n${i}`, full_name: `New ${i}`, first_name: "New", last_name: String(i), title: "T", department: "D", phone: "", mobile: "", location: "" });
const save = (as: string | null, org: string, source: string, plan: object, fetched = 5, stats: object = {}) =>
  t.as(as, async () => (await t.db.query<{ id: string }>("select public.save_sync_preview($1, $2, $3::jsonb, $4::jsonb, $5, '[]'::jsonb) as id", [org, source, JSON.stringify(plan), JSON.stringify(stats), fetched])).rows[0].id);
const apply = (as: string | null, id: string) => t.as(as, async () => (await t.db.query<{ s: Record<string, number> }>("select public.apply_sync_preview($1) as s", [id])).rows[0].s);
const count = async (sql: string, p: unknown[] = []) => Number((await t.db.query<{ c: string }>(sql, p)).rows[0].c);
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.db.close();
});

describe("migration 0011", () => {
  it("creates the tables with row-level security on", async () => {
    const { rows } = await t.db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname in ('sync_settings','sync_sources','sync_previews','sync_runs') and relkind = 'r'");
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
});

describe("access", () => {
  it("only the organization's admins read or write settings, previews and history", async () => {
    const org = await newOrg();
    const other = await newOrg("Other");
    const admin = await member(org, "admin");
    const plain = await member(org);
    const stranger = await member(other, "admin");
    await t.as(admin, () => t.db.query("insert into public.sync_settings (org_id, safety_cap_percent) values ($1, 30)", [org]));
    await t.as(admin, () => t.db.query("insert into public.sync_sources (org_id, source, enabled) values ($1, 'google', true)", [org]));
    const id = await save(admin, org, "google", { ...emptyPlan, creates: [create(1)] });

    for (const [who, expected] of [[admin, 1], [plain, 0], [stranger, 0]] as const) {
      for (const tbl of ["sync_settings", "sync_sources", "sync_previews", "sync_runs"]) {
        const rows = await t.as(who, async () => (await t.db.query(`select 1 from public.${tbl} where org_id = $1`, [org])).rows);
        expect(rows.length > 0, `${tbl} visible to ${who === admin ? "admin" : who === plain ? "member" : "stranger"}`).toBe(expected === 1);
      }
    }
    expect(await code(t.as(plain, () => t.db.query("insert into public.sync_settings (org_id) values ($1)", [org])))).not.toBe("ok");
    expect(await code(t.as(stranger, () => t.db.query("insert into public.sync_sources (org_id, source) values ($1, 'microsoft')", [org])))).not.toBe("ok");
    expect(id).toBeTruthy();
  });

  it("browser roles cannot write previews or history directly, or call the internal and service functions", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    const id = await save(admin, org, "google", emptyPlan);
    for (const sql of [
      "insert into public.sync_previews (org_id, source, trigger, fetched_count, plan) values ($1, 'google', 'manual', 1, '{\"creates\":[],\"updates\":[],\"deactivates\":[]}')",
      "update public.sync_previews set status = 'applied'",
      "delete from public.sync_previews",
      "insert into public.sync_runs (org_id, source, trigger, status) values ($1, 'google', 'manual', 'applied')",
      "delete from public.sync_runs",
    ]) {
      expect(await code(t.as(admin, () => t.db.query(sql, sql.includes("$1") ? [org] : []))), sql).not.toBe("ok");
    }
    const callable = [
      ["select public.save_sync_preview_service($1, 'google', '{\"creates\":[],\"updates\":[],\"deactivates\":[]}'::jsonb, '{}'::jsonb, 1, '[]'::jsonb)", [org]],
      ["select public.apply_sync_preview_service($1)", [id]],
      ["select public.sync_apply_impl($1, null, 'cron')", [id]],
      ["select public.sync_feature_on($1, 'directory_sync')", [org]],
    ] as const;
    for (const [sql, p] of callable) expect(await code(t.as(admin, () => t.db.query(sql, [...p]))), sql).not.toBe("ok");
    expect(await code(t.as(null, () => t.db.query("select public.apply_sync_preview($1)", [id])))).not.toBe("ok");
  });

  it("history cannot be updated, not even by the table owner", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    await save(admin, org, "google", emptyPlan);
    expect(await code(t.db.query("update public.sync_runs set message = 'x' where org_id = $1", [org]))).toBe("SY005");
  });

  it("a plain member and an admin of another organization cannot save or apply", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    const plain = await member(org);
    const stranger = await member(await newOrg("Other"), "admin");
    expect(await code(save(plain, org, "google", emptyPlan))).toBe("SY007");
    expect(await code(save(stranger, org, "google", emptyPlan))).toBe("SY007");
    const id = await save(admin, org, "google", { ...emptyPlan, creates: [create(1)] });
    expect(await code(apply(plain, id))).toBe("SY007");
    expect(await code(apply(stranger, id))).toBe("SY007");
    expect(await count("select count(*) as c from public.people where org_id = $1", [org])).toBe(0);
  });
});

describe("apply: one transaction, people never deleted", () => {
  it("creates, updates and deactivates, records history and an import row", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    const ids = await googleTen(org);
    const plan = {
      ...emptyPlan,
      creates: [create(1), create(2)],
      updates: [{ person_id: ids[0], email: "g0@acme.com", name: "G0", set: { title: "CTO", phone: "555", email: "g0.new@acme.com" }, custom_set: {}, custom_remove: [], changes: [] }],
      deactivates: [{ person_id: ids[9], email: "g9@acme.com", name: "G9" }],
    };
    const id = await save(admin, org, "google", plan, 10, { fetched: 10 });
    const s = await apply(admin, id);
    expect(s).toMatchObject({ applied_created: 2, applied_updated: 1, applied_deactivated: 1 });
    const p0 = (await t.db.query<{ title: string; phone: string; email: string }>("select title, phone, email from public.people where id = $1", [ids[0]])).rows[0];
    expect(p0).toEqual({ title: "CTO", phone: "555", email: "g0.new@acme.com" });
    expect((await t.db.query<{ status: string }>("select status from public.people where id = $1", [ids[9]])).rows[0].status).toBe("inactive");
    expect((await t.db.query<{ source: string; external_id: string }>("select source, external_id from public.people where email = 'new1@acme.com'")).rows[0]).toEqual({ source: "google", external_id: "n1" });
    expect(await count("select count(*) as c from public.people where org_id = $1", [org])).toBe(12); // nobody deleted
    const imp = (await t.db.query<{ source: string; created: number; updated: number }>("select source, created, updated from public.people_imports where org_id = $1", [org])).rows[0];
    expect(imp).toMatchObject({ source: "google", created: 2, updated: 2 });
    const runs = (await t.db.query<{ status: string }>("select status from public.sync_runs where org_id = $1 order by created_at, status", [org])).rows.map((r) => r.status);
    expect(runs.sort()).toEqual(["applied", "previewed"]);
    expect((await t.db.query<{ status: string }>("select status from public.sync_previews where id = $1", [id])).rows[0].status).toBe("applied");
  });

  it("refuses to apply twice, and a newer preview replaces the older one", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    const a = await save(admin, org, "microsoft", { ...emptyPlan, creates: [create(1)] });
    const b = await save(admin, org, "microsoft", { ...emptyPlan, creates: [create(2)] });
    expect(await code(apply(admin, a))).toBe("SY004");
    await apply(admin, b);
    expect(await code(apply(admin, b))).toBe("SY004");
    expect(await count("select count(*) as c from public.people where org_id = $1", [org])).toBe(1);
  });

  it("refuses a preview older than 24 hours", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    const id = await save(admin, org, "google", { ...emptyPlan, creates: [create(1)] });
    await t.db.query("update public.sync_previews set expires_at = now() - interval '1 minute' where id = $1", [id]);
    expect(await code(apply(admin, id))).toBe("SY004");
    expect(await count("select count(*) as c from public.people where org_id = $1", [org])).toBe(0);
  });

  it("is atomic: a failure half-way leaves nothing applied", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    const ids = await googleTen(org);
    await person(org, { email: "taken@acme.com" });
    const plan = { ...emptyPlan, creates: [create(1)], updates: [{ person_id: ids[0], email: "g0@acme.com", name: "G0", set: { email: "taken@acme.com" }, custom_set: {}, custom_remove: [], changes: [] }] };
    const id = await save(admin, org, "google", plan, 10);
    expect(await code(apply(admin, id))).toBe("23505");
    expect(await count("select count(*) as c from public.people where email = 'new1@acme.com' and org_id = $1", [org])).toBe(0);
    expect((await t.db.query<{ status: string }>("select status from public.sync_previews where id = $1", [id])).rows[0].status).toBe("pending");
    expect(await count("select count(*) as c from public.people_imports where org_id = $1", [org])).toBe(0);
  });

  it("a crafted plan cannot touch other sources' people or other organizations", async () => {
    const org = await newOrg();
    const other = await newOrg("Other");
    const admin = await member(org, "admin");
    const manual = await person(org, { email: "manual@acme.com", source: "manual", title: "Keep" });
    const foreign = await person(other, { email: "f@other.com", source: "google", ext: "f1", title: "Keep" });
    const ms = await person(org, { email: "ms@acme.com", source: "microsoft", ext: "m1" });
    const plan = {
      ...emptyPlan,
      updates: [{ person_id: foreign, email: "f", name: "f", set: { title: "Hacked" }, custom_set: {}, custom_remove: [], changes: [] }],
      deactivates: [{ person_id: manual, email: "m", name: "m" }, { person_id: ms, email: "ms", name: "ms" }, { person_id: foreign, email: "f", name: "f" }],
    };
    await googleTen(org);
    await t.db.query("insert into public.sync_settings (org_id, safety_cap_percent) values ($1, 100)", [org]);
    const id = await save(admin, org, "google", plan, 5);
    expect(await apply(admin, id)).toMatchObject({ applied_updated: 0, applied_deactivated: 0, applied_skipped: 1 });
    const rows = (await t.db.query<{ id: string; status: string; title: string }>("select id, status, title from public.people where id in ($1,$2,$3)", [manual, ms, foreign])).rows;
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by[manual].status).toBe("active");
    expect(by[ms].status).toBe("active");
    expect(by[foreign]).toMatchObject({ status: "active", title: "Keep" });
  });

  it("a preview is limited to a few kinds of change and malformed plans are refused", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    expect(await code(save(admin, org, "google", { creates: [] }))).toBe("SY006");
    expect(await code(save(admin, org, "bogus", emptyPlan))).toBe("SY006");
    expect(await code(save(admin, org, "hubspot", { ...emptyPlan, creates: [create(1)] }))).toBe("SY006");
    expect(await code(save(admin, org, "generic", { ...emptyPlan, deactivates: [{ person_id: "00000000-0000-0000-0000-000000000000" }] }))).toBe("SY006");
  });
});

describe("safety rules enforced by the database", () => {
  it("refuses a run that would deactivate more than the cap, changes nothing, and says why", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    const ids = await googleTen(org);
    const dea = (i: number) => ({ person_id: ids[i], email: `g${i}@acme.com`, name: `G${i}` });
    const id = await save(admin, org, "google", { ...emptyPlan, creates: [create(1)], deactivates: [dea(0), dea(1), dea(2)] }, 7);
    const err = await t.as(admin, () => t.db.query("select public.apply_sync_preview($1)", [id])).then(() => null, (e: Error & { code?: string }) => e);
    expect(err?.code).toBe("SY002");
    expect(err?.message).toMatch(/safety cap.*deactivate 3 of 10 people \(30 percent\).*allowed 20 percent/);
    expect(await count("select count(*) as c from public.people where org_id = $1 and status = 'inactive'", [org])).toBe(0);
    expect(await count("select count(*) as c from public.people where email = 'new1@acme.com' and org_id = $1", [org])).toBe(0);
    // exactly at the cap is fine
    const ok = await save(admin, org, "google", { ...emptyPlan, deactivates: [dea(0), dea(1)] }, 8);
    expect(await apply(admin, ok)).toMatchObject({ applied_deactivated: 2 });
  });

  it("the cap is configurable per organization", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    const ids = await googleTen(org);
    await t.as(admin, () => t.db.query("insert into public.sync_settings (org_id, safety_cap_percent) values ($1, 50)", [org]));
    const id = await save(admin, org, "google", { ...emptyPlan, deactivates: ids.slice(0, 5).map((p, i) => ({ person_id: p, email: `g${i}@acme.com`, name: "x" })) }, 5);
    expect(await apply(admin, id)).toMatchObject({ applied_deactivated: 5 });
    expect(await code(t.as(admin, () => t.db.query("update public.sync_settings set safety_cap_percent = 0 where org_id = $1", [org])))).toBe("23514");
  });

  it("refuses when the source returned nothing, even though deactivating 'everyone' would be 100 percent", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    const ids = await googleTen(org);
    await t.db.query("insert into public.sync_settings (org_id, safety_cap_percent) values ($1, 100)", [org]); // even a 100 percent cap cannot let an empty answer through
    const id = await save(admin, org, "google", { ...emptyPlan, deactivates: ids.map((p) => ({ person_id: p, email: "x@x.co", name: "x" })) }, 0);
    const err = await t.as(admin, () => t.db.query("select public.apply_sync_preview($1)", [id])).then(() => null, (e: Error & { code?: string }) => e);
    expect(err?.code).toBe("SY003");
    expect(err?.message).toMatch(/returned no users/);
    expect(await count("select count(*) as c from public.people where org_id = $1 and status = 'active'", [org])).toBe(10);
  });

  it("deactivating one person out of a directory of three is refused at the default cap", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    const a = await person(org, { source: "google", ext: "a" });
    await person(org, { source: "google", ext: "b" });
    await person(org, { source: "google", ext: "c" });
    const id = await save(admin, org, "google", { ...emptyPlan, deactivates: [{ person_id: a, email: "a", name: "a" }] }, 2);
    expect(await code(apply(admin, id))).toBe("SY002");
  });
});

describe("CRM runs", () => {
  it("fill custom fields and columns; only existing people change; history says crm", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    const p = await person(org, { title: "Old", custom: { keep: "1", booking: "old" } });
    for (let i = 0; i < 4; i++) await person(org);
    const plan = { ...emptyPlan, updates: [{ person_id: p, email: "x", name: "x", set: { phone: "555", title: "Head" }, custom_set: { booking: "https://cal/x", other: "y" }, custom_remove: [], changes: [] }] };
    const id = await save(admin, org, "hubspot", plan, 5);
    expect(await apply(admin, id)).toMatchObject({ applied_updated: 1 });
    const row = (await t.db.query<{ title: string; phone: string; custom: Record<string, string>; source: string }>("select title, phone, custom, source from public.people where id = $1", [p])).rows[0];
    expect(row).toEqual({ title: "Head", phone: "555", custom: { keep: "1", booking: "https://cal/x", other: "y" }, source: "manual" });
    expect((await t.db.query<{ source: string }>("select source from public.people_imports where org_id = $1", [org])).rows[0].source).toBe("crm");
  });

  it("removes custom keys, and the safety cap counts people who would LOSE values", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await person(org, { custom: { booking: "x" }, phone: "1" }));
    const wipe = (k: number) => ids.slice(0, k).map((p) => ({ person_id: p, email: "x", name: "x", set: { phone: "" }, custom_set: {}, custom_remove: ["booking"], changes: [] }));
    const big = await save(admin, org, "generic", { ...emptyPlan, updates: wipe(3) }, 10);
    expect(await code(apply(admin, big))).toBe("SY002");
    expect(await count("select count(*) as c from public.people where org_id = $1 and phone = ''", [org])).toBe(0);
    const ok = await save(admin, org, "generic", { ...emptyPlan, updates: wipe(2) }, 10);
    await apply(admin, ok);
    expect(await count("select count(*) as c from public.people where org_id = $1 and custom ? 'booking'", [org])).toBe(8);
    const none = await save(admin, org, "generic", { ...emptyPlan, updates: wipe(1) }, 0);
    expect(await code(apply(admin, none))).toBe("SY003");
  });
});

describe("unattended (service) path", () => {
  it("saves and applies with no signed-in user, and records trigger cron", async () => {
    const org = await newOrg();
    const ids = await googleTen(org);
    const q = (await t.db.query<{ id: string }>("select public.save_sync_preview_service($1, 'google', $2::jsonb, '{}'::jsonb, 10, '[]'::jsonb) as id", [org, JSON.stringify({ ...emptyPlan, deactivates: [{ person_id: ids[0], email: "g0@acme.com", name: "G0" }] })])).rows[0].id;
    const s = (await t.db.query<{ s: Record<string, number> }>("select public.apply_sync_preview_service($1) as s", [q])).rows[0].s;
    expect(s.applied_deactivated).toBe(1);
    const runs = (await t.db.query<{ trigger: string; status: string; created_by: string | null }>("select trigger, status, created_by from public.sync_runs where org_id = $1", [org])).rows;
    expect(runs.every((r) => r.trigger === "cron" && r.created_by === null)).toBe(true);
    expect(runs.map((r) => r.status).sort()).toEqual(["applied", "previewed"]);
  });

  it("the service path enforces the same safety cap", async () => {
    const org = await newOrg();
    const ids = await googleTen(org);
    const q = (await t.db.query<{ id: string }>("select public.save_sync_preview_service($1, 'google', $2::jsonb, '{}'::jsonb, 10, '[]'::jsonb) as id", [org, JSON.stringify({ ...emptyPlan, deactivates: ids.slice(0, 5).map((p) => ({ person_id: p, email: "x", name: "x" })) })])).rows[0].id;
    expect(await code(t.db.query("select public.apply_sync_preview_service($1)", [q]))).toBe("SY002");
    expect(await count("select count(*) as c from public.people where org_id = $1 and status = 'inactive'", [org])).toBe(0);
  });

  it("log events: admins and the service can add blocked / failed rows, nothing else", async () => {
    const org = await newOrg();
    const admin = await member(org, "admin");
    await t.as(admin, () => t.db.query("select public.log_sync_event($1, 'google', 'failed', 'x', '{}'::jsonb, '[]'::jsonb, null)", [org]));
    await t.db.query("select public.log_sync_event_service($1, 'google', 'blocked', 'y', '{}'::jsonb, '[]'::jsonb, null)", [org]);
    expect(await code(t.as(admin, () => t.db.query("select public.log_sync_event($1, 'google', 'applied', 'faked', '{}'::jsonb, '[]'::jsonb, null)", [org])))).toBe("SY006");
    expect(await code(t.as(await member(await newOrg("O2")), () => t.db.query("select public.log_sync_event($1, 'google', 'failed', 'x', '{}'::jsonb, '[]'::jsonb, null)", [org])))).toBe("SY007");
  });

  it("sync_feature_on follows organization overrides, then the flag default", async () => {
    const org = await newOrg();
    const on = async () => (await t.db.query<{ v: boolean }>("select public.sync_feature_on($1, 'directory_sync') as v", [org])).rows[0].v;
    const def = await on();
    await t.db.query("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('org', $1, 'directory_sync', $2)", [org, !def]);
    expect(await on()).toBe(!def);
  });
});
