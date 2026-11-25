import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db-harness";
import { AI_FEATURES, FEATURES } from "./roles";

/** These run the real migrations in Postgres (PGlite), so they test the actual RLS policies and SQL functions. */

let t: TestDb;
let n = 0;
const email = (name: string) => `${name}${++n}@example.com`;
const quota = (feature: string) => t.db.query<{ r: Record<string, unknown> }>("select public.consume_ai_quota($1) as r", [feature]).then((x) => x.rows[0].r);
/** Ask as the user themselves, which is how the app does it. */
const enabled = (userId: string, feature: string) =>
  t.as(userId, async () => (await t.db.query<{ e: boolean }>("select public.feature_enabled_for($1, $2) as e", [userId, feature])).rows[0].e);
const count = async (sql: string, params: unknown[] = []) => (await t.db.query<{ c: number }>(sql, params)).rows[0].c;
const usageCount = (userId: string) => count("select count(*)::int as c from public.ai_usage where user_id = $1", [userId]);

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.db.close();
});

describe("code and database agree", () => {
  it("every feature in the TypeScript list is seeded, and nothing else is", async () => {
    const seeded = (await t.db.query<{ feature: string }>("select feature from public.feature_flags order by 1")).rows.map((r) => r.feature);
    expect(seeded).toEqual(Object.keys(FEATURES).sort());
  });

  it("every AI feature has limits for every role", async () => {
    const rows = (await t.db.query<{ feature: string; role: string }>("select feature, role from public.ai_limits")).rows;
    for (const feature of AI_FEATURES) {
      expect(rows.filter((r) => r.feature === feature).map((r) => r.role).sort()).toEqual(["admin", "designer", "member"]);
    }
    expect([...new Set(rows.map((r) => r.feature))].sort()).toEqual([...AI_FEATURES].sort());
  });
});

describe("sign-up", () => {
  it("creates a profile and a default-organization membership as member", async () => {
    const id = await t.addUser("Jane@Example.com");
    const profile = await t.db.query("select email from public.profiles where id = $1", [id]);
    expect(profile.rows).toEqual([{ email: "Jane@Example.com" }]);
    const m = await t.db.query("select role from public.memberships where user_id = $1", [id]);
    expect(m.rows).toEqual([{ role: "member" }]);
  });

  it("keeps the profile email in step with the account", async () => {
    const id = await t.addUser(email("old"));
    await t.db.query("update auth.users set email = 'new@example.com' where id = $1", [id]);
    expect((await t.db.query("select email from public.profiles where id = $1", [id])).rows).toEqual([{ email: "new@example.com" }]);
  });
});

describe("roles", () => {
  const roleOf = (id: string) => t.as(id, async () => (await t.db.query<{ r: string }>("select public.current_app_role() as r")).rows[0].r);

  it("uses the highest role across memberships, and member when there are none", async () => {
    const id = await t.addUser(email("multi"));
    await t.db.query("insert into public.organizations (name) values ('Second')");
    await t.db.query("insert into public.memberships (org_id, user_id, role) select id, $1, 'designer' from public.organizations where name = 'Second'", [id]);
    expect(await roleOf(id)).toBe("designer");

    await t.db.query("delete from public.memberships where user_id = $1", [id]);
    expect(await roleOf(id)).toBe("member");
  });

  it("is_admin is true only for admins", async () => {
    const a = await t.addUser(email("a"));
    const m = await t.addUser(email("m"));
    await t.setRole(a, "admin");
    const isAdmin = (id: string) => t.as(id, async () => (await t.db.query<{ v: boolean }>("select public.is_admin() as v")).rows[0].v);
    expect(await isAdmin(a)).toBe(true);
    expect(await isAdmin(m)).toBe(false);
  });
});

describe("row-level security", () => {
  it("members see only their own profile and membership; admins see everyone", async () => {
    const admin = await t.addUser(email("admin"));
    await t.setRole(admin, "admin");
    const u1 = await t.addUser(email("u1"));
    await t.addUser(email("u2"));

    const own = await t.as(u1, async () => (await t.db.query("select id from public.profiles")).rows);
    expect(own).toEqual([{ id: u1 }]);
    const ownMemberships = await t.as(u1, async () => (await t.db.query("select user_id from public.memberships")).rows);
    expect(ownMemberships).toEqual([{ user_id: u1 }]);

    const all = await t.as(admin, async () => (await t.db.query("select id from public.profiles")).rows);
    expect(all.length).toBeGreaterThan(2);
  });

  it("members cannot change flags, limits, roles or overrides", async () => {
    const u = await t.addUser(email("member"));
    const affected = (sql: string) => t.as(u, async () => (await t.db.query(sql)).affectedRows ?? 0);
    expect(await affected("update public.feature_flags set default_enabled = false")).toBe(0);
    expect(await affected("update public.ai_limits set per_day = 100000")).toBe(0);
    expect(await affected("update public.memberships set role = 'admin'")).toBe(0);
    expect(await affected("delete from public.feature_flags")).toBe(0);
    await expect(
      t.as(u, () => t.db.query("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('user', gen_random_uuid(), 'ai_design', true)")),
    ).rejects.toThrow(/row-level security/);
    await expect(
      t.as(u, () => t.db.query("insert into public.memberships (org_id, user_id, role) select id, gen_random_uuid(), 'admin' from public.organizations")),
    ).rejects.toThrow();
    // the flags are untouched: only animated_gif is off by default
    expect(await count("select count(*)::int as c from public.feature_flags where default_enabled = false")).toBe(1);
  });

  it("members cannot promote themselves", async () => {
    const u = await t.addUser(email("sneaky"));
    const changed = await t.as(u, async () => (await t.db.query("update public.memberships set role = 'admin' where user_id = $1", [u])).affectedRows ?? 0);
    expect(changed).toBe(0);
    expect((await t.db.query("select role from public.memberships where user_id = $1", [u])).rows).toEqual([{ role: "member" }]);
  });

  it("admins can manage limits", async () => {
    const admin = await t.addUser(email("boss"));
    await t.setRole(admin, "admin");
    const changed = await t.as(admin, async () => (await t.db.query("update public.ai_limits set per_day = 61 where role = 'member' and feature = 'ai_autofill'")).affectedRows);
    expect(changed).toBe(1);
    await t.db.query("update public.ai_limits set per_day = 60 where role = 'member' and feature = 'ai_autofill'");
  });

  it("anonymous visitors see nothing and cannot use AI", async () => {
    expect(await t.as(null, async () => (await t.db.query("select * from public.profiles")).rows)).toHaveLength(0);
    await expect(t.as(null, () => t.db.query("select public.consume_ai_quota('ai_design')"))).rejects.toThrow(/permission denied|not authenticated/);
  });
});

describe("feature flags", () => {
  it("applies the default and the minimum role", async () => {
    const member = await t.addUser(email("m"));
    const designer = await t.addUser(email("d"));
    const admin = await t.addUser(email("ad"));
    await t.setRole(designer, "designer");
    await t.setRole(admin, "admin");

    expect(await enabled(member, "ai_design")).toBe(true);
    expect(await enabled(member, "custom_html")).toBe(false); // designer and up
    expect(await enabled(designer, "custom_html")).toBe(true);
    expect(await enabled(designer, "analytics")).toBe(false); // admin only
    expect(await enabled(admin, "analytics")).toBe(true);
    expect(await enabled(admin, "team_deploy")).toBe(true);
  });

  it("a flag that is off by default stays off for everyone, admins included, until overridden", async () => {
    const admin = await t.addUser(email("ad"));
    await t.setRole(admin, "admin");
    expect(await enabled(admin, "animated_gif")).toBe(false);
  });

  it("an unknown feature is never enabled", async () => {
    expect(await enabled(await t.addUser(email("x")), "does_not_exist")).toBe(false);
  });

  it("a user override turns a feature on or off, even above or below their role", async () => {
    const u = await t.addUser(email("client"));
    await t.db.query("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('user', $1, 'animated_gif', true)", [u]);
    expect(await enabled(u, "animated_gif")).toBe(true);
    await t.db.query("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('user', $1, 'ai_design', false)", [u]);
    expect(await enabled(u, "ai_design")).toBe(false);
    await t.db.query("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('user', $1, 'custom_html', true)", [u]);
    expect(await enabled(u, "custom_html")).toBe(true);
  });

  it("an organization override applies to its members, and a user override beats it", async () => {
    const orgId = (await t.db.query<{ id: string }>("insert into public.organizations (name) values ('Client Co') returning id")).rows[0].id;
    const a = await t.addUser(email("a"));
    const b = await t.addUser(email("b"));
    await t.db.query("insert into public.memberships (org_id, user_id) values ($1, $2), ($1, $3)", [orgId, a, b]);
    await t.db.query("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('org', $1, 'animated_gif', true)", [orgId]);
    expect(await enabled(a, "animated_gif")).toBe(true);
    expect(await enabled(b, "animated_gif")).toBe(true);
    await t.db.query("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('user', $1, 'animated_gif', false)", [b]);
    expect(await enabled(b, "animated_gif")).toBe(false);
    expect(await enabled(a, "animated_gif")).toBe(true);
  });

  it("with several organizations, an explicit off wins", async () => {
    const o1 = (await t.db.query<{ id: string }>("insert into public.organizations (name) values ('One') returning id")).rows[0].id;
    const o2 = (await t.db.query<{ id: string }>("insert into public.organizations (name) values ('Two') returning id")).rows[0].id;
    const u = await t.addUser(email("two-orgs"));
    await t.db.query("insert into public.memberships (org_id, user_id) values ($1, $3), ($2, $3)", [o1, o2, u]);
    await t.db.query(
      "insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('org', $1, 'animated_gif', true), ('org', $2, 'animated_gif', false)",
      [o1, o2],
    );
    expect(await enabled(u, "animated_gif")).toBe(false);
  });

  it("users can check themselves but not others; admins can check anyone", async () => {
    const u = await t.addUser(email("self"));
    const other = await t.addUser(email("other"));
    const admin = await t.addUser(email("adm"));
    await t.setRole(admin, "admin");
    const ask = (as: string, who: string) =>
      t.as(as, async () => (await t.db.query<{ e: boolean }>("select public.feature_enabled_for($1, 'ai_design') as e", [who])).rows[0].e);
    await expect(ask(u, u)).resolves.toBe(true);
    await expect(ask(u, other)).rejects.toThrow(/forbidden/);
    await expect(ask(admin, other)).resolves.toBe(true);
  });
});

describe("AI quota", () => {
  it("allows a call and records it", async () => {
    const u = await t.addUser(email("q"));
    expect(await t.as(u, () => quota("ai_autofill"))).toMatchObject({ allowed: true, remaining_day: 59 });
    expect(await usageCount(u)).toBe(1);
  });

  it("enforces the per-minute limit and does not record denied calls", async () => {
    const u = await t.addUser(email("fast"));
    await t.as(u, async () => {
      for (let i = 0; i < 3; i++) expect(await quota("ai_vision")).toMatchObject({ allowed: true }); // member: 3 per minute
      expect(await quota("ai_vision")).toEqual({ allowed: false, reason: "rate_limited" });
    });
    expect(await usageCount(u)).toBe(3);
  });

  it("enforces the per-day limit, and old usage ages out", async () => {
    const u = await t.addUser(email("daily"));
    await t.db.query("insert into public.ai_usage (user_id, feature, created_at) select $1, 'ai_vision', now() - interval '2 hours' from generate_series(1, 10)", [u]);
    expect(await t.as(u, () => quota("ai_vision"))).toEqual({ allowed: false, reason: "daily_limit" });
    await t.db.query("update public.ai_usage set created_at = now() - interval '25 hours' where user_id = $1", [u]);
    expect(await t.as(u, () => quota("ai_vision"))).toMatchObject({ allowed: true });
  });

  it("the per-minute window slides", async () => {
    const u = await t.addUser(email("slide"));
    await t.db.query("insert into public.ai_usage (user_id, feature, created_at) select $1, 'ai_vision', now() - interval '2 minutes' from generate_series(1, 3)", [u]);
    expect(await t.as(u, () => quota("ai_vision"))).toMatchObject({ allowed: true });
  });

  it("limits are per feature and per user", async () => {
    const a = await t.addUser(email("a"));
    const b = await t.addUser(email("b"));
    await t.as(a, async () => {
      for (let i = 0; i < 3; i++) await quota("ai_vision");
      expect(await quota("ai_vision")).toMatchObject({ allowed: false });
      expect(await quota("ai_design")).toMatchObject({ allowed: true });
    });
    expect(await t.as(b, () => quota("ai_vision"))).toMatchObject({ allowed: true });
  });

  it("gives designers higher limits and admins none", async () => {
    const d = await t.addUser(email("d"));
    const admin = await t.addUser(email("a"));
    await t.setRole(d, "designer");
    await t.setRole(admin, "admin");
    await t.as(d, async () => {
      for (let i = 0; i < 6; i++) expect(await quota("ai_vision")).toMatchObject({ allowed: true });
      expect(await quota("ai_vision")).toMatchObject({ allowed: false, reason: "rate_limited" });
    });
    const last = await t.as(admin, async () => {
      let r;
      for (let i = 0; i < 30; i++) r = await quota("ai_design");
      return r;
    });
    expect(last).toMatchObject({ allowed: true, remaining_day: null });
  });

  it("refuses when the feature is off, and records nothing", async () => {
    const u = await t.addUser(email("off"));
    await t.db.query("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('user', $1, 'ai_design', false)", [u]);
    expect(await t.as(u, () => quota("ai_design"))).toEqual({ allowed: false, reason: "feature_disabled" });
    expect(await usageCount(u)).toBe(0);
  });

  it("picks up limits changed by an admin immediately; a role with no row uses the member row", async () => {
    const u = await t.addUser(email("cfg"));
    await t.db.query("update public.ai_limits set per_day = 1 where role = 'member' and feature = 'ai_design'");
    await t.as(u, async () => {
      expect(await quota("ai_design")).toMatchObject({ allowed: true });
      expect(await quota("ai_design")).toEqual({ allowed: false, reason: "daily_limit" });
    });
    const d = await t.addUser(email("fallback"));
    await t.setRole(d, "designer");
    await t.db.query("delete from public.ai_limits where role = 'designer' and feature = 'ai_design'");
    await t.as(d, async () => {
      expect(await quota("ai_design")).toMatchObject({ allowed: true });
      expect(await quota("ai_design")).toMatchObject({ allowed: false, reason: "daily_limit" });
    });
    await t.db.query("update public.ai_limits set per_day = 40 where role = 'member' and feature = 'ai_design'");
    await t.db.query("insert into public.ai_limits values ('designer', 'ai_design', 20, 150)");
  });

  it("a limit of zero blocks the feature", async () => {
    const u = await t.addUser(email("zero"));
    await t.db.query("update public.ai_limits set per_day = 0 where role = 'member' and feature = 'ai_vision'");
    expect(await t.as(u, () => quota("ai_vision"))).toEqual({ allowed: false, reason: "daily_limit" });
    await t.db.query("update public.ai_limits set per_day = 10 where role = 'member' and feature = 'ai_vision'");
  });

  it("requires sign-in", async () => {
    await expect(t.as(null, () => quota("ai_design"))).rejects.toThrow();
  });

  it("users cannot write usage rows directly, so limits cannot be bypassed or reset", async () => {
    const u = await t.addUser(email("cheat"));
    await t.as(u, () => quota("ai_design"));
    await expect(t.as(u, () => t.db.query("insert into public.ai_usage (user_id, feature) values ($1, 'ai_design')", [u]))).rejects.toThrow(/row-level security/);
    expect(await t.as(u, async () => (await t.db.query("delete from public.ai_usage")).affectedRows)).toBe(0);
    expect(await t.as(u, async () => (await t.db.query("update public.ai_usage set created_at = now() - interval '2 days'")).affectedRows)).toBe(0);
    expect(await usageCount(u)).toBe(1);
  });

  it("users read only their own usage; admins read all", async () => {
    const a = await t.addUser(email("a"));
    const b = await t.addUser(email("b"));
    const admin = await t.addUser(email("adm"));
    await t.setRole(admin, "admin");
    await t.as(a, () => quota("ai_design"));
    await t.as(b, () => quota("ai_design"));
    expect(await t.as(a, async () => (await t.db.query("select distinct user_id from public.ai_usage")).rows)).toEqual([{ user_id: a }]);
    expect((await t.as(admin, async () => (await t.db.query("select distinct user_id from public.ai_usage")).rows)).length).toBeGreaterThan(1);
  });

  it("records tokens, and refunds only calls that produced nothing", async () => {
    const u = await t.addUser(email("tok"));
    const other = await t.addUser(email("other"));
    const first = (await t.as(u, () => quota("ai_design"))) as { usage_id: string };
    const second = (await t.as(u, () => quota("ai_design"))) as { usage_id: string };

    await t.as(u, () => t.db.query("select public.finish_ai_usage($1, 120, 80)", [first.usage_id]));
    expect((await t.db.query("select tokens_in, tokens_out from public.ai_usage where id = $1", [first.usage_id])).rows).toEqual([{ tokens_in: 120, tokens_out: 80 }]);

    await t.as(u, () => t.db.query("select public.refund_ai_usage($1)", [first.usage_id])); // already has tokens: kept
    await t.as(other, () => t.db.query("select public.refund_ai_usage($1)", [second.usage_id])); // someone else's: kept
    await t.as(other, () => t.db.query("select public.finish_ai_usage($1, 1, 1)", [second.usage_id])); // someone else's: untouched
    expect(await usageCount(u)).toBe(2);
    expect((await t.db.query("select tokens_in from public.ai_usage where id = $1", [second.usage_id])).rows).toEqual([{ tokens_in: null }]);

    await t.as(u, () => t.db.query("select public.refund_ai_usage($1)", [second.usage_id])); // own, no tokens: refunded
    expect(await usageCount(u)).toBe(1);
  });
});

describe("last admin protection", () => {
  it("cannot demote or remove the only admin, but can once another exists", async () => {
    const f = await createTestDb();
    try {
      const a = await f.addUser("a@example.com");
      const b = await f.addUser("b@example.com");
      await f.setRole(a, "admin");
      await expect(f.setRole(a, "member")).rejects.toThrow(/at least one admin/);
      await expect(f.db.query("delete from public.memberships where user_id = $1", [a])).rejects.toThrow(/at least one admin/);
      await f.setRole(b, "admin");
      await f.setRole(a, "member"); // fine now that another admin exists
      await expect(f.setRole(b, "member")).rejects.toThrow(/at least one admin/);
      await f.db.query("delete from auth.users where id = $1", [b]); // deleting the account itself is not blocked
    } finally {
      await f.db.close();
    }
  }, 60_000);
});
