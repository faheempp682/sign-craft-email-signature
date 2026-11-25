import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/authz/db-harness";
import { FEATURES } from "@/lib/authz/roles";

/**
 * Migration 0015 against a real Postgres (PGlite): plan resolution, AI limits, the agency rule behind is_org_admin /
 * is_org_member, the guards on parent_id / plan_id, and branding. Written to be able to fail: each rule has a test
 * that a wrong implementation would break (see the deliberate breakages listed in the report).
 */

let t: TestDb;
let n = 0;
const email = () => `o${++n}@example.com`;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await t.db.query<T>(sql, p)).rows;
const as = <T>(id: string | null, fn: () => Promise<T>) => t.as(id, fn);
const rows = (id: string | null, sql: string, p: unknown[] = []) => t.as(id, async () => (await t.db.query(sql, p)).rows);
const code = (fn: () => Promise<unknown>) => fn().then(() => "ok", (e: { code?: string }) => e.code ?? "error");

const newOrg = async (name: string) => (await q<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [name]))[0].id;
/** A user whose ONLY membership is the given one (no default-organization membership), so tests are explicit about who is where. */
async function person(org: string | null, role: "member" | "designer" | "admin" = "member") {
  const id = await t.addUser(email());
  await q("delete from public.memberships where user_id = $1", [id]);
  if (org) await q("insert into public.memberships (org_id, user_id, role) values ($1,$2,$3)", [org, id, role]);
  return id;
}
const join = (org: string, user: string, role: "member" | "designer" | "admin" = "member") =>
  q("insert into public.memberships (org_id, user_id, role) values ($1,$2,$3) on conflict (org_id, user_id) do update set role = excluded.role", [org, user, role]);
const enabled = (user: string, feature: string) => as(user, async () => (await t.db.query<{ e: boolean }>("select public.feature_enabled_for($1,$2) as e", [user, feature])).rows[0].e);
const quota = (user: string, feature: string) => as(user, async () => (await t.db.query<{ r: { allowed: boolean; reason?: string; remaining_day?: number | null } }>("select public.consume_ai_quota($1) as r", [feature])).rows[0].r);
const setPlan = (org: string, plan: string | null) => q("update public.organizations set plan_id = $2 where id = $1", [org, plan]);
const isAdminOf = (user: string, org: string) => as(user, async () => (await t.db.query<{ v: boolean }>("select public.is_org_admin($1) as v", [org])).rows[0].v);
const isMemberOf = (user: string, org: string) => as(user, async () => (await t.db.query<{ v: boolean }>("select public.is_org_member($1) as v", [org])).rows[0].v);

beforeAll(async () => {
  t = await createTestDb();
}, 90_000);
afterAll(async () => {
  await t.db.close();
});

/* ------------------------------------------------------------------ seeds */

describe("plan presets", () => {
  it("has the four plans and every plan decides every feature", async () => {
    expect((await q<{ id: string }>("select id from public.plans order by sort_order")).map((r) => r.id)).toEqual(["free", "pro", "business", "agency"]);
    const features = Object.keys(FEATURES).length;
    for (const plan of ["free", "pro", "business", "agency"]) {
      expect((await q<{ c: number }>("select count(*)::int c from public.plan_features where plan = $1", [plan]))[0].c).toBe(features);
    }
  });

  it("free: 3 to 5 AI uses a day, no GIF, no custom HTML, no campaigns, no deploy; agency: everything", async () => {
    const on = async (plan: string) => (await q<{ feature: string }>("select feature from public.plan_features where plan = $1 and enabled order by 1", [plan])).map((r) => r.feature);
    const free = await on("free");
    for (const off of ["animated_gif", "custom_html", "campaigns", "team_deploy", "agency_mode"]) expect(free).not.toContain(off);
    expect(await on("agency")).toEqual(Object.keys(FEATURES).sort());
    const days = (await q<{ per_day: number }>("select per_day from public.plan_ai_limits where plan = 'free'")).map((r) => r.per_day);
    expect(days.length).toBe(9);
    for (const d of days) expect(d).toBeGreaterThanOrEqual(3), expect(d).toBeLessThanOrEqual(5);
  });

  it("the preset tables cannot be written from the browser, even by an admin", async () => {
    const admin = await person(null, "admin");
    await q("insert into public.memberships (org_id, user_id, role) select id, $1, 'admin' from public.organizations where is_default", [admin]);
    expect(await code(() => as(admin, () => t.db.query("insert into public.plan_features (plan, feature, enabled) values ('free', 'x', true)")))).toBe("42501");
    expect(await code(() => as(admin, () => t.db.query("update public.plan_features set enabled = true where plan = 'free'")))).toBe("42501");
    expect(await code(() => as(admin, () => t.db.query("delete from public.plans where id = 'free'")))).toBe("42501");
    expect(await code(() => as(admin, () => t.db.query("update public.plan_ai_limits set per_day = null where plan = 'free'")))).toBe("42501");
    expect((await rows(admin, "select id from public.plans")).length).toBe(4); // but they can read them
  });
});

/* ------------------------------------------------------------ feature resolution */

describe("feature resolution with plans", () => {
  it("plan NULL: exactly the old rule (flag default AND minimum role)", async () => {
    const org = await newOrg("NoPlan");
    expect((await q("select plan_id from public.organizations where id = $1", [org]))[0]).toEqual({ plan_id: null });
    const member = await person(org, "member");
    const designer = await person(org, "designer");
    const admin = await person(org, "admin");
    expect(await enabled(member, "animated_gif")).toBe(false); // default off
    expect(await enabled(member, "ai_autofill")).toBe(true);
    expect(await enabled(member, "custom_html")).toBe(false); // designer and up
    expect(await enabled(designer, "custom_html")).toBe(true);
    expect(await enabled(member, "analytics")).toBe(false); // admin only
    expect(await enabled(admin, "analytics")).toBe(true);
    expect(await enabled(admin, "agency_mode")).toBe(false); // default off even for admins
    expect(await enabled(admin, "no_such_feature")).toBe(false);
  });

  it("a plan turns a feature on or off for the organization's members; the minimum role still applies", async () => {
    const org = await newOrg("Pro");
    await setPlan(org, "pro");
    const member = await person(org, "member");
    const designer = await person(org, "designer");
    const admin = await person(org, "admin");
    expect(await enabled(member, "animated_gif")).toBe(true); // off by default, on in Pro
    expect(await enabled(member, "analytics")).toBe(false); // on in Pro, but admin-only: a plan cannot lift a role rule
    expect(await enabled(admin, "analytics")).toBe(true);
    expect(await enabled(admin, "team_deploy")).toBe(false); // off in Pro even though the flag default is on
    expect(await enabled(designer, "custom_html")).toBe(true);

    await setPlan(org, "free");
    expect(await enabled(member, "animated_gif")).toBe(false);
    expect(await enabled(designer, "custom_html")).toBe(false); // flag default says yes, the Free plan says no
    expect(await enabled(admin, "campaigns")).toBe(false);
    expect(await enabled(member, "ai_autofill")).toBe(true);

    await setPlan(org, "agency");
    expect(await enabled(admin, "agency_mode")).toBe(true);
    expect(await enabled(member, "agency_mode")).toBe(false); // agency_mode is admin-only
    expect(await enabled(admin, "team_deploy")).toBe(true);

    await setPlan(org, null); // removing the plan restores the old behaviour at once
    expect(await enabled(member, "animated_gif")).toBe(false);
    expect(await enabled(admin, "agency_mode")).toBe(false);
    expect(await enabled(designer, "custom_html")).toBe(true);
  });

  it("a plan that does not define a feature leaves it to the flag", async () => {
    await q("insert into public.plans (id, name) values ('thin', 'Thin')");
    await q("insert into public.plan_features (plan, feature, enabled) values ('thin', 'animated_gif', true)");
    const org = await newOrg("Thin");
    await setPlan(org, "thin");
    const designer = await person(org, "designer");
    expect(await enabled(designer, "animated_gif")).toBe(true); // from the plan
    expect(await enabled(designer, "custom_html")).toBe(true); // not in the plan: flag default and designer role
    expect(await enabled(designer, "analytics")).toBe(false); // not in the plan: admin-only flag
  });

  it("organization override beats the plan; user override beats both", async () => {
    const org = await newOrg("Over");
    await setPlan(org, "free");
    const u = await person(org, "member");
    const other = await person(org, "member");
    await q("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('org', $1, 'animated_gif', true)", [org]);
    expect(await enabled(u, "animated_gif")).toBe(true); // Free says no, the organization exception says yes
    await q("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('user', $1, 'animated_gif', false)", [u]);
    expect(await enabled(u, "animated_gif")).toBe(false);
    expect(await enabled(other, "animated_gif")).toBe(true);

    const org2 = await newOrg("Over2");
    await setPlan(org2, "pro");
    const v = await person(org2, "member");
    await q("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('org', $1, 'animated_gif', false)", [org2]);
    expect(await enabled(v, "animated_gif")).toBe(false); // Pro says yes, the organization exception says no
    await q("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('user', $1, 'animated_gif', true)", [v]);
    expect(await enabled(v, "animated_gif")).toBe(true);
  });

  it("several organizations: the most permissive PLAN wins; organizations without a plan do not take part", async () => {
    const free = await newOrg("MFree");
    const pro = await newOrg("MPro");
    const bare = await newOrg("MBare");
    await setPlan(free, "free");
    await setPlan(pro, "pro");
    const both = await person(free, "member");
    await join(pro, both);
    expect(await enabled(both, "animated_gif")).toBe(true); // Pro grants it even though Free does not
    const freeAndBare = await person(free, "designer");
    await join(bare, freeAndBare, "designer");
    expect(await enabled(freeAndBare, "custom_html")).toBe(false); // the plan-less organization does not undo Free's restriction
    expect(await enabled(freeAndBare, "animated_gif")).toBe(false);
    const onlyBare = await person(bare, "designer");
    expect(await enabled(onlyBare, "custom_html")).toBe(true);
  });

  it("several organizations: an explicit organization 'off' still wins over another organization's plan", async () => {
    const a = await newOrg("OffA");
    const b = await newOrg("OffB");
    await setPlan(a, "pro");
    const u = await person(a, "member");
    await join(b, u);
    expect(await enabled(u, "animated_gif")).toBe(true);
    await q("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('org', $1, 'animated_gif', false)", [b]);
    expect(await enabled(u, "animated_gif")).toBe(false);
  });

  it("asking about someone else is still forbidden for non-admins", async () => {
    const a = await person(null, "member");
    const b = await person(null, "member");
    expect(await code(() => as(a, () => t.db.query("select public.feature_enabled_for($1,'ai_design')", [b])))).toBe("42501");
  });
});

/* ------------------------------------------------------------------ AI limits */

describe("AI limits with plans", () => {
  const backdate = (user: string, feature: string, count: number, interval: string) =>
    q("insert into public.ai_usage (user_id, feature, created_at) select $1, $2, now() - $3::interval from generate_series(1, $4)", [user, feature, interval, count]);

  it("plan NULL: the ai_limits rows apply exactly as before (member vision: 3 a minute)", async () => {
    const org = await newOrg("AiNone");
    const u = await person(org, "member");
    for (let i = 0; i < 3; i++) expect((await quota(u, "ai_vision")).allowed).toBe(true);
    expect(await quota(u, "ai_vision")).toEqual({ allowed: false, reason: "rate_limited" });
    const d = await person(org, "member");
    await backdate(d, "ai_vision", 10, "2 hours");
    expect(await quota(d, "ai_vision")).toEqual({ allowed: false, reason: "daily_limit" });
    const unlimited = await person(org, "admin");
    const r = await quota(unlimited, "ai_vision");
    expect(r.allowed).toBe(true);
    expect(r.remaining_day).toBeNull();
  });

  it("a plan row replaces the ai_limits row for that role and feature (Free: 5 a day, 2 a minute)", async () => {
    const org = await newOrg("AiFree");
    await setPlan(org, "free");
    const u = await person(org, "member");
    expect((await quota(u, "ai_autofill")).remaining_day).toBe(4);
    expect((await quota(u, "ai_autofill")).allowed).toBe(true);
    expect(await quota(u, "ai_autofill")).toEqual({ allowed: false, reason: "rate_limited" }); // 2 a minute (the member row alone would allow 8)
    const d = await person(org, "member");
    await backdate(d, "ai_autofill", 5, "2 hours");
    expect(await quota(d, "ai_autofill")).toEqual({ allowed: false, reason: "daily_limit" }); // 5 a day (the member row alone would allow 60)
    const a = await person(org, "admin");
    await backdate(a, "ai_autofill", 5, "2 hours");
    expect(await quota(a, "ai_autofill")).toEqual({ allowed: false, reason: "daily_limit" }); // Free limits admins too (they are unlimited in ai_limits)
  });

  it("a plan can be more generous than ai_limits, and null means unlimited", async () => {
    const org = await newOrg("AiBiz");
    await setPlan(org, "business");
    const admin = await person(org, "admin");
    await backdate(admin, "ai_design", 400, "2 hours");
    const r = await quota(admin, "ai_design");
    expect(r.allowed).toBe(true);
    expect(r.remaining_day).toBeNull();
    const member = await person(org, "member");
    await backdate(member, "ai_design", 100, "2 hours"); // ai_limits would stop a member at 40 a day; Business allows 120
    expect((await quota(member, "ai_design")).allowed).toBe(true);
  });

  it("a plan with no row for that role and feature falls back to ai_limits", async () => {
    const org = await newOrg("AiThin");
    await setPlan(org, "thin");
    const u = await person(org, "member");
    for (let i = 0; i < 3; i++) expect((await quota(u, "ai_vision")).allowed).toBe(true);
    expect(await quota(u, "ai_vision")).toEqual({ allowed: false, reason: "rate_limited" });
    // and a plan that defines only one role: the other role uses ai_limits
    await q("insert into public.plan_ai_limits (plan, role, feature, per_minute, per_day) values ('thin', 'designer', 'ai_design', 1, 1)");
    const des = await person(org, "designer");
    expect((await quota(des, "ai_design")).allowed).toBe(true);
    expect(await quota(des, "ai_design")).toEqual({ allowed: false, reason: "rate_limited" });
    const mem = await person(org, "member");
    expect((await quota(mem, "ai_design")).allowed).toBe(true);
    expect((await quota(mem, "ai_design")).allowed).toBe(true); // member row of ai_limits: 10 a minute
  });

  it("several organizations: the most permissive limit wins, null beating any number", async () => {
    const free = await newOrg("AiMF");
    const biz = await newOrg("AiMB");
    await setPlan(free, "free");
    await setPlan(biz, "business");
    const u = await person(free, "member");
    await join(biz, u);
    await backdate(u, "ai_autofill", 150, "2 hours"); // over Free's 5, under Business's 200
    expect((await quota(u, "ai_autofill")).allowed).toBe(true);
    const onlyFree = await person(free, "member");
    await backdate(onlyFree, "ai_autofill", 150, "2 hours");
    expect(await quota(onlyFree, "ai_autofill")).toEqual({ allowed: false, reason: "daily_limit" });

    const agencyOrg = await newOrg("AiMA");
    await setPlan(agencyOrg, "agency");
    const w = await person(free, "member");
    await join(agencyOrg, w);
    await backdate(w, "ai_autofill", 2000, "2 hours");
    expect((await quota(w, "ai_autofill")).remaining_day).toBeNull(); // Agency member per_day is null: unlimited beats Free's 5
  });

  it("the feature flag is still checked first, and an exception still blocks", async () => {
    const org = await newOrg("AiOff");
    await setPlan(org, "free");
    const u = await person(org, "member");
    await q("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('user', $1, 'ai_design', false)", [u]);
    expect(await quota(u, "ai_design")).toEqual({ allowed: false, reason: "feature_disabled" });
    const unauth = await code(() => as(null, () => t.db.query("select public.consume_ai_quota('ai_design')")));
    expect(unauth).not.toBe("ok");
  });
});

/* ---------------------------------------------------------------- agency rule */

type World = { agency: string; c1: string; c2: string; other: string; agency2: string; d1: string; aAdmin: string; aMember: string; c1Admin: string; c1Member: string; c2Admin: string; oAdmin: string; bAdmin: string; both: string; outsider: string };
let w: World;

describe("agency rule: is_org_admin / is_org_member", () => {
  beforeAll(async () => {
    const agency = await newOrg("Agency A");
    const other = await newOrg("Other");
    const agency2 = await newOrg("Agency B");
    // seeded with no JWT subject (the service role), so the guard trigger does not apply
    const c1 = (await q<{ id: string }>("insert into public.organizations (name, parent_id) values ('Client 1', $1) returning id", [agency]))[0].id;
    const c2 = (await q<{ id: string }>("insert into public.organizations (name, parent_id) values ('Client 2', $1) returning id", [agency]))[0].id;
    const d1 = (await q<{ id: string }>("insert into public.organizations (name, parent_id) values ('Client of B', $1) returning id", [agency2]))[0].id;
    w = {
      agency, c1, c2, other, agency2, d1,
      aAdmin: await person(agency, "admin"),
      aMember: await person(agency, "member"),
      c1Admin: await person(c1, "admin"),
      c1Member: await person(c1, "member"),
      c2Admin: await person(c2, "admin"),
      oAdmin: await person(other, "admin"),
      bAdmin: await person(agency2, "admin"),
      both: await person(other, "admin"),
      outsider: await person(null, "member"),
    };
    await join(agency, w.both, "admin");
  }, 60_000);

  it("an admin of the agency is an admin and a member of each of its direct clients", async () => {
    expect(await isAdminOf(w.aAdmin, w.c1)).toBe(true);
    expect(await isAdminOf(w.aAdmin, w.c2)).toBe(true);
    expect(await isMemberOf(w.aAdmin, w.c1)).toBe(true);
    expect(await isAdminOf(w.aAdmin, w.agency)).toBe(true); // and of their own organization, as before
  });

  it("nothing else changes: not the other direction, not siblings, not other agencies, not plain members", async () => {
    expect(await isAdminOf(w.c1Admin, w.agency)).toBe(false); // a client's admin is not an admin of the agency
    expect(await isMemberOf(w.c1Admin, w.agency)).toBe(false);
    expect(await isAdminOf(w.c1Admin, w.c2)).toBe(false); // nor of a sibling
    expect(await isMemberOf(w.c1Admin, w.c2)).toBe(false);
    expect(await isAdminOf(w.c1Admin, w.c1)).toBe(true);
    expect(await isAdminOf(w.aMember, w.c1)).toBe(false); // a plain member of the agency gets nothing
    expect(await isMemberOf(w.aMember, w.c1)).toBe(false);
    expect(await isAdminOf(w.aAdmin, w.d1)).toBe(false); // another agency's client
    expect(await isAdminOf(w.bAdmin, w.c1)).toBe(false);
    expect(await isAdminOf(w.oAdmin, w.c1)).toBe(false); // an unrelated admin
    expect(await isAdminOf(w.oAdmin, w.agency)).toBe(false);
    expect(await isAdminOf(w.outsider, w.c1)).toBe(false);
    expect(await isMemberOf(w.outsider, w.agency)).toBe(false);
    expect(await isAdminOf(w.c1Member, w.c1)).toBe(false);
    expect(await isMemberOf(w.c1Member, w.c1)).toBe(true);
  });

  it("anonymous callers are never admins or members", async () => {
    expect(await as(null, async () => (await t.db.query<{ v: boolean }>("select public.is_org_admin($1) as v", [w.c1])).rows[0].v).catch(() => false)).toBe(false);
  });

  it("the rule reaches one level only (a client of a client gets nothing)", async () => {
    const grandchild = (await q<{ id: string }>("insert into public.organizations (name, parent_id) values ('Grandchild', $1) returning id", [w.c1]))[0].id; // possible only with the service role
    expect(await isAdminOf(w.aAdmin, grandchild)).toBe(false);
    expect(await isAdminOf(w.c1Admin, grandchild)).toBe(true); // the direct parent's admin, by the same rule
  });

  it("the agency's admin can be demoted: access follows the membership", async () => {
    const tmp = await person(w.agency, "admin");
    expect(await isAdminOf(tmp, w.c1)).toBe(true);
    await q("update public.memberships set role = 'designer' where user_id = $1 and org_id = $2", [tmp, w.agency]);
    expect(await isAdminOf(tmp, w.c1)).toBe(false);
  });

  it("old rule equals new rule everywhere there is no agency: a reference copy of the 0006 definition", async () => {
    const orgs = await q<{ id: string; parent_id: string | null }>("select id, parent_id from public.organizations");
    const users = await q<{ id: string }>("select id from auth.users");
    const old = async (user: string, org: string) => (await q<{ v: boolean }>("select exists (select 1 from public.memberships where org_id = $1 and user_id = $2 and role = 'admin') as v", [org, user]))[0].v;
    const oldMember = async (user: string, org: string) => (await q<{ v: boolean }>("select exists (select 1 from public.memberships where org_id = $1 and user_id = $2) as v", [org, user]))[0].v;
    const hasParent = new Set(orgs.filter((o) => o.parent_id).map((o) => o.id));
    let checked = 0;
    for (const o of orgs) {
      for (const u of users) {
        if (hasParent.has(o.id)) continue; // only client organizations can differ
        expect(await isAdminOf(u.id, o.id)).toBe(await old(u.id, o.id));
        expect(await isMemberOf(u.id, o.id)).toBe(await oldMember(u.id, o.id));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 60_000);
});

describe("agency rule through the row-level security of existing tables", () => {
  let camp1: string;
  let campA: string;
  let tmpl: string;

  beforeAll(async () => {
    camp1 = (await q<{ id: string }>("insert into public.banner_campaigns (org_id, name, href, fallback_src) values ($1,'Client campaign','https://a.com','https://a.com/f.png') returning id", [w.c1]))[0].id;
    campA = (await q<{ id: string }>("insert into public.banner_campaigns (org_id, name, href, fallback_src) values ($1,'Agency campaign','https://a.com','https://a.com/f.png') returning id", [w.agency]))[0].id;
    await q("insert into public.people (org_id, email, full_name) values ($1,'p@c1.com','Client Person'), ($2,'p@agency.com','Agency Person')", [w.c1, w.agency]);
    tmpl = (await q<{ id: string }>("insert into public.brand_templates (org_id, name, doc_json) values ($1,'T','{}') returning id", [w.c1]))[0].id;
    await q("insert into public.signature_rules (org_id, name, template_id) values ($1,'R',$2)", [w.c1, tmpl]);
    await q("insert into public.sync_settings (org_id) values ($1)", [w.c1]);
    await q("insert into public.org_settings (org_id) values ($1)", [w.c1]);
    await q("insert into public.legal_disclaimers (org_id, title, category, body) values ($1,'D','other','Body')", [w.c1]);
  });

  const tables: [string, string][] = [
    ["banner_campaigns", "org_id"],
    ["people", "org_id"],
    ["brand_templates", "org_id"],
    ["signature_rules", "org_id"],
    ["sync_settings", "org_id"],
    ["org_settings", "org_id"],
    ["legal_disclaimers", "org_id"],
  ];

  it.each(tables)("%s: the agency admin reads the client's rows; siblings, other admins, strangers and the client's own admin keep their old view", async (table, col) => {
    const count = (user: string) => rows(user, `select count(*)::int c from public.${table} where ${col} = $1`, [w.c1]).then((r) => (r[0] as { c: number }).c);
    expect(await count(w.aAdmin)).toBeGreaterThan(0); // NEW: agency admin
    expect(await count(w.c1Admin)).toBeGreaterThan(0); // as before
    expect(await count(w.c2Admin)).toBe(0); // sibling client
    expect(await count(w.oAdmin)).toBe(0); // unrelated admin
    expect(await count(w.bAdmin)).toBe(0); // another agency
    expect(await count(w.outsider)).toBe(0);
    expect(await count(w.aMember)).toBe(0); // plain member of the agency
  });

  it("the client's admin cannot see the agency's own data (campaigns, people)", async () => {
    expect(await rows(w.c1Admin, "select id from public.banner_campaigns where id = $1", [campA])).toEqual([]);
    expect(await rows(w.c1Admin, "select id from public.people where org_id = $1", [w.agency])).toEqual([]);
    expect(await rows(w.c2Admin, "select id from public.banner_campaigns where id = $1", [camp1])).toEqual([]);
  });

  it("the agency admin can write for the client; nobody else new can", async () => {
    const ins = (org: string) => t.db.query("insert into public.banner_campaigns (org_id, name, href, fallback_src) values ($1,'x','https://a.com','https://a.com/f.png')", [org]);
    await as(w.aAdmin, () => ins(w.c1));
    await as(w.aAdmin, () => ins(w.c2));
    expect(await code(() => as(w.c1Admin, () => ins(w.agency)))).toBe("42501");
    expect(await code(() => as(w.c1Admin, () => ins(w.c2)))).toBe("42501");
    expect(await code(() => as(w.aAdmin, () => ins(w.d1)))).toBe("42501");
    expect(await code(() => as(w.aMember, () => ins(w.c1)))).toBe("42501");
    expect(await rows(w.aAdmin, "update public.banner_campaigns set name = 'renamed' where id = $1 returning id", [camp1])).toHaveLength(1);
    expect(await rows(w.c2Admin, "update public.banner_campaigns set name = 'hijack' where id = $1 returning id", [camp1])).toEqual([]);
    expect(await rows(w.c2Admin, "delete from public.banner_campaigns where id = $1 returning id", [camp1])).toEqual([]);
    expect(await rows(w.aAdmin, "delete from public.banner_campaigns where id = $1 returning id", [camp1])).toHaveLength(1);
  });

  it("functions that check is_org_admin inside (directory defaults, approvals) admit the agency admin and still refuse the rest", async () => {
    const call = (user: string, org: string) => as(user, async () => (await t.db.query("select public.approve_directory_defaults($1) as r", [org])).rows[0]);
    await call(w.aAdmin, w.c1);
    expect(await code(() => call(w.c2Admin, w.c1))).toBe("TM006");
    expect(await code(() => call(w.oAdmin, w.c1))).toBe("TM006");
    expect(await code(() => call(w.c1Admin, w.agency))).toBe("TM006");
  });

  it("a person can tag a signature with a client organization only when is_org_member says so (agency admin yes, stranger no)", async () => {
    const ins = (user: string, org: string) => as(user, () => t.db.query("insert into public.signatures (owner_id, name, template_id, doc_json, org_id) values ($1, 's', 't', '{}'::jsonb, $2)", [user, org]));
    await ins(w.aAdmin, w.c1);
    expect(await code(() => ins(w.oAdmin, w.c1))).toBe("42501");
  });
});

/* ------------------------------------------------------- who may set parent_id / plan_id */

describe("parent_id and plan_id are guarded", () => {
  const enableAgency = async (user: string) => q("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('user', $1, 'agency_mode', true) on conflict (subject_type, subject_id, feature) do update set enabled = true", [user]);
  const create = (user: string, parent: string, name = "New client", plan: string | null = null) =>
    as(user, async () => (await t.db.query<{ id: string }>("select public.create_client_organization($1,$2,$3) as id", [parent, name, plan])).rows[0].id);

  it("create_client_organization needs the agency_mode feature, admin rights on the parent, and a valid name", async () => {
    expect(await code(() => create(w.aAdmin, w.agency))).toBe("42501"); // feature off
    await enableAgency(w.aAdmin);
    const id = await create(w.aAdmin, w.agency, "  Fresh client  ", "free");
    const row = (await q<{ name: string; parent_id: string; plan_id: string }>("select name, parent_id, plan_id from public.organizations where id = $1", [id]))[0];
    expect(row).toEqual({ name: "Fresh client", parent_id: w.agency, plan_id: "free" });
    expect(await isAdminOf(w.aAdmin, id)).toBe(true);
    expect(await code(() => create(w.aAdmin, w.agency, "   "))).toBe("22023");
    expect(await code(() => create(w.aAdmin, w.agency, "x", "nonexistent"))).toBe("23503");
    await enableAgency(w.oAdmin);
    expect(await code(() => create(w.oAdmin, w.agency))).toBe("42501"); // admin elsewhere
    await enableAgency(w.aMember);
    expect(await code(() => create(w.aMember, w.agency))).toBe("42501"); // member only
    await enableAgency(w.c1Admin);
    expect(await code(() => create(w.c1Admin, w.c1))).toBe("AG002"); // a client cannot have clients (depth one)
    expect(await code(() => create(w.aAdmin, w.c1))).toBe("42501"); // the agency admin is not a DIRECT admin of the client
  });

});

/**
 * The guard trigger on parent_id / plan_id is defence in depth. Since migration 0016 only PLATFORM admins (admins of the
 * default organization) can write the organizations table at all, so these checks run for actors who hold that role as
 * well as the organization roles named in each test. (That plain organization admins cannot reach the table is tested in
 * lib/authz/platform-admin.db.test.ts.)
 */
describe("parent_id and plan_id are guarded (for platform admins, who are the only ones that can reach the trigger)", () => {
  const actors = () => [w.aAdmin, w.oAdmin, w.c1Admin, w.c2Admin, w.both];
  beforeAll(async () => {
    for (const u of actors()) {
      await q("insert into public.memberships (org_id, user_id, role) select id, $1, 'admin' from public.organizations where is_default on conflict (org_id, user_id) do update set role = 'admin'", [u]);
    }
  });
  afterAll(async () => {
    await q("delete from public.memberships where user_id = any($1::uuid[]) and org_id in (select id from public.organizations where is_default)", [actors()]);
  });

  it("a parent can be set on a new organization only by an admin of that parent (direct insert)", async () => {
    const ins = (user: string, parent: string) => as(user, () => t.db.query("insert into public.organizations (name, parent_id) values ('Direct', $1)", [parent]));
    await ins(w.aAdmin, w.agency);
    expect(await code(() => ins(w.oAdmin, w.agency))).toBe("42501"); // an admin of ANOTHER organization cannot hang a client on someone else
    expect(await code(() => ins(w.c1Admin, w.agency))).toBe("42501");
    expect(await code(() => ins(w.aAdmin, w.c1))).toBe("AG002"); // parent must be top-level
    expect(await code(() => ins(w.aAdmin, w.agency2))).toBe("42501");
  });

  it("a plan cannot be set at creation of a top-level organization from the browser", async () => {
    expect(await code(() => as(w.aAdmin, () => t.db.query("insert into public.organizations (name, plan_id) values ('Sneaky', 'agency')")))).toBe("42501");
    await as(w.aAdmin, () => t.db.query("insert into public.organizations (name) values ('Plain')"));
  });

  it("a client cannot re-parent itself; attaching needs an admin of BOTH sides; re-parenting needs a release first", async () => {
    const upd = (user: string, org: string, parent: string | null) => as(user, () => t.db.query("update public.organizations set parent_id = $2 where id = $1", [org, parent]));
    expect(await code(() => upd(w.c1Admin, w.c1, w.other))).toBe("AG002"); // already a client
    expect(await code(() => upd(w.c1Admin, w.c1, null))).toBe("42501"); // cannot leave on its own
    expect(await code(() => upd(w.c1Admin, w.c1, w.c1))).not.toBe("ok");
    // taking over an existing organization by attaching it
    expect(await code(() => upd(w.aAdmin, w.other, w.agency))).toBe("42501"); // admin of the parent only
    expect(await code(() => upd(w.oAdmin, w.other, w.agency))).toBe("42501"); // admin of the child only
    expect(await code(() => upd(w.oAdmin, w.other, w.other))).not.toBe("ok");
    // an organization that has clients cannot become a client (depth, and no cycles)
    expect(await code(() => upd(w.both, w.agency, w.other))).toBe("AG002");
    // consent from both sides works
    await upd(w.both, w.other, w.agency);
    expect((await q<{ parent_id: string }>("select parent_id from public.organizations where id = $1", [w.other]))[0].parent_id).toBe(w.agency);
    expect(await isAdminOf(w.aAdmin, w.other)).toBe(true);
    // direct re-parent to another agency is refused; release first
    expect(await code(() => upd(w.both, w.other, w.agency2))).toBe("AG002");
    expect(await code(() => upd(w.oAdmin, w.other, null))).toBe("42501"); // the client's own admin cannot release it
    await upd(w.aAdmin, w.other, null); // the agency's admin can
    expect((await q<{ parent_id: string | null }>("select parent_id from public.organizations where id = $1", [w.other]))[0].parent_id).toBeNull();
    expect(await isAdminOf(w.aAdmin, w.other)).toBe(false);
  });

  it("database constraint: an organization is never its own parent, even for the service role", async () => {
    await expect(q("update public.organizations set parent_id = id where id = $1", [w.agency])).rejects.toMatchObject({ code: "23514" });
  });

  it("a client's plan is changed by its agency's admins only; a top-level organization's plan by its own admins only", async () => {
    const upd = (user: string, org: string, plan: string | null) => as(user, () => t.db.query("update public.organizations set plan_id = $2 where id = $1", [org, plan]));
    expect(await code(() => upd(w.c1Admin, w.c1, "agency"))).toBe("42501"); // a client cannot upgrade itself
    expect(await code(() => upd(w.c2Admin, w.c1, "agency"))).toBe("42501");
    expect(await code(() => upd(w.oAdmin, w.c1, "agency"))).toBe("42501");
    await upd(w.aAdmin, w.c1, "pro");
    expect((await q<{ plan_id: string }>("select plan_id from public.organizations where id = $1", [w.c1]))[0].plan_id).toBe("pro");
    await upd(w.aAdmin, w.c1, null);
    expect(await code(() => upd(w.oAdmin, w.agency, "agency"))).toBe("42501"); // an admin of another organization
    await upd(w.oAdmin, w.other, "business");
    expect(await code(() => upd(w.aAdmin, w.other, null))).toBe("42501");
    await upd(w.oAdmin, w.other, null);
    expect(await code(() => upd(w.aAdmin, w.c1, "nonexistent"))).toBe("23503");
  });

  it("unrelated updates of an organization (a rename) are not affected by the guard", async () => {
    await as(w.c1Admin, () => t.db.query("update public.organizations set name = 'Client 1 renamed' where id = $1", [w.c1]));
    expect((await q<{ name: string }>("select name from public.organizations where id = $1", [w.c1]))[0].name).toBe("Client 1 renamed");
  });
});

/* ------------------------------------------------------------------- functions */

describe("my_orgs and agency_clients", () => {
  it("lists own memberships and, for an agency admin, the clients (marked via_agency)", async () => {
    const mine = (user: string) => rows(user, "select id, role, via_agency from public.my_orgs()") as Promise<{ id: string; role: string; via_agency: boolean }[]>;
    const a = await mine(w.aAdmin);
    expect(a.find((o) => o.id === w.agency)).toMatchObject({ role: "admin", via_agency: false });
    expect(a.find((o) => o.id === w.c1)).toMatchObject({ role: "admin", via_agency: true });
    expect(a.find((o) => o.id === w.d1)).toBeUndefined();
    expect(await mine(w.outsider)).toEqual([]);
    const c1 = (await mine(w.c1Admin)).map((o) => o.id);
    expect(c1).toContain(w.c1);
    expect(c1).not.toContain(w.agency); // a client sees nothing upward
    expect(c1).not.toContain(w.c2);
    expect((await mine(w.aMember)).map((o) => o.id)).toEqual([w.agency]); // a member of the agency sees no clients
  });

  it("a person who is both a member and an agency admin of a client appears once", async () => {
    const u = await person(w.agency, "admin");
    await join(w.c2, u, "member");
    const list = (await rows(u, "select id, via_agency from public.my_orgs() where id = $1", [w.c2])) as { via_agency: boolean }[];
    expect(list).toEqual([{ id: w.c2, via_agency: false }]);
  });

  it("agency_clients returns clients with counts, and refuses everyone but the agency's own admins", async () => {
    const list = (await rows(w.aAdmin, "select id, name, member_count::int m, people_count::int p from public.agency_clients($1)", [w.agency])) as { id: string; m: number; p: number }[];
    expect(list.find((c) => c.id === w.c1)).toMatchObject({ m: expect.any(Number), p: 1 });
    expect(list.some((c) => c.id === w.d1)).toBe(false);
    for (const user of [w.c1Admin, w.aMember, w.oAdmin, w.outsider]) {
      expect(await code(() => as(user, () => t.db.query("select * from public.agency_clients($1)", [w.agency])))).toBe("42501");
    }
    expect(await code(() => as(w.aAdmin, () => t.db.query("select * from public.agency_clients($1)", [w.agency2])))).toBe("42501");
  });
});

/* ------------------------------------------------------------------- branding */

describe("organization_branding", () => {
  const ok = { name: "Acme Studio", logo: "https://cdn.acme.com/logo.png", accent: "#0B5FFF" };
  const put = (user: string, org: string, over: Partial<{ name: string | null; logo: string | null; w: number | null; h: number | null; accent: string | null }> = {}) => {
    const v = { name: ok.name, logo: ok.logo, w: 120, h: 40, accent: ok.accent, ...over };
    return as(user, () =>
      t.db.query(
        "insert into public.organization_branding (org_id, brand_name, logo_url, logo_width, logo_height, accent) values ($1,$2,$3,$4,$5,$6) on conflict (org_id) do update set brand_name = excluded.brand_name, logo_url = excluded.logo_url, logo_width = excluded.logo_width, logo_height = excluded.logo_height, accent = excluded.accent",
        [org, v.name, v.logo, v.w, v.h, v.accent],
      ),
    );
  };

  it("admins write their own organization's branding; the agency's admin writes a client's; others cannot", async () => {
    await put(w.c1Admin, w.c1);
    await put(w.aAdmin, w.c2, { name: "Client 2 brand" });
    expect(await code(() => put(w.c1Admin, w.agency))).toBe("42501"); // a client cannot rebrand the agency
    expect(await code(() => put(w.c1Admin, w.c2))).toBe("42501"); // nor a sibling
    expect(await code(() => put(w.oAdmin, w.c1))).toBe("42501");
    expect(await code(() => put(w.c1Member, w.c1))).toBe("42501");
    expect(await code(() => put(w.outsider, w.c1))).toBe("42501");
  });

  it("members read their own organization's branding and nobody else's", async () => {
    expect(await rows(w.c1Member, "select brand_name from public.organization_branding")).toEqual([{ brand_name: "Acme Studio" }]);
    expect(await rows(w.aAdmin, "select count(*)::int c from public.organization_branding where org_id in ($1,$2)", [w.c1, w.c2])).toEqual([{ c: 2 }]);
    expect(await rows(w.c2Admin, "select org_id from public.organization_branding where org_id = $1", [w.c1])).toEqual([]);
    expect(await rows(w.outsider, "select org_id from public.organization_branding")).toEqual([]);
    expect(await code(() => as(null, () => t.db.query("select * from public.organization_branding")))).toBe("42501");
  });

  it("database checks: https logo with a size, accent with 4.5:1 contrast on white, sane lengths", async () => {
    expect(await code(() => put(w.c1Admin, w.c1, { logo: "http://cdn.acme.com/logo.png" }))).toBe("23514");
    expect(await code(() => put(w.c1Admin, w.c1, { logo: "javascript:alert(1)" }))).toBe("23514");
    expect(await code(() => put(w.c1Admin, w.c1, { logo: 'https://a.com/x".png' }))).toBe("23514");
    expect(await code(() => put(w.c1Admin, w.c1, { w: null, h: null }))).toBe("23514"); // a logo needs explicit width and height
    expect(await code(() => put(w.c1Admin, w.c1, { w: 5000 }))).toBe("23514");
    expect(await code(() => put(w.c1Admin, w.c1, { logo: null, w: 120, h: 40 }))).toBe("23514"); // size without a logo
    expect(await code(() => put(w.c1Admin, w.c1, { accent: "#FFFF00" }))).toBe("23514"); // yellow on white: 1.07:1
    expect(await code(() => put(w.c1Admin, w.c1, { accent: "#777777" }))).toBe("23514"); // 4.48:1
    expect(await code(() => put(w.c1Admin, w.c1, { accent: "red" }))).toBe("23514");
    expect(await code(() => put(w.c1Admin, w.c1, { name: "x".repeat(61) }))).toBe("23514");
    await put(w.c1Admin, w.c1, { accent: "#767676" }); // the lightest grey that passes (4.54:1)
    await put(w.c1Admin, w.c1, { logo: null, w: null, h: null, accent: null, name: null }); // everything optional
  });

  it("contrast_ok_on_white agrees with the TypeScript rule on a sample of colours", async () => {
    const { contrast } = await import("@/lib/linter/contrast");
    for (const hex of ["#000000", "#0B5FFF", "#767676", "#777777", "#FF0000", "#008000", "#FFA500", "#123456", "#F0522D", "#6B21A8", "#ABCDEF", "#FFFFFF"]) {
      const sql = (await q<{ v: boolean }>("select public.contrast_ok_on_white($1) v", [hex]))[0].v;
      expect(sql, hex).toBe(contrast(hex, "#ffffff") >= 4.5);
    }
  });
});
