import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db-harness";

/**
 * Migration 0016: is_admin() means "admin of the DEFAULT organization" (a platform admin), not "admin of any
 * organization". Without it, a client organization's admin (agency mode) would be able to rewrite global feature flags and
 * limits, edit every membership, and promote themselves in the agency's own organization.
 */

let t: TestDb;
let n = 0;
const email = () => `pa${++n}@example.com`;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await t.db.query<T>(sql, p)).rows;
const code = (fn: () => Promise<unknown>) => fn().then(() => "ok", (e: { code?: string }) => e.code ?? "error");
const affected = (user: string, sql: string, p: unknown[] = []) => t.as(user, async () => (await t.db.query(sql, p)).affectedRows ?? 0);

let defaultOrg: string;
let agency: string;
let client: string;
let platform: string; // admin of the default organization
let agencyAdmin: string; // admin of the agency only
let clientAdmin: string; // admin of the client only
let member: string; // plain member of the default organization

/** A user whose ONLY memberships are the ones given. */
async function person(memberships: { org: string; role: "member" | "designer" | "admin" }[]) {
  const id = await t.addUser(email());
  await q("delete from public.memberships where user_id = $1", [id]);
  for (const m of memberships) await q("insert into public.memberships (org_id, user_id, role) values ($1,$2,$3)", [m.org, id, m.role]);
  return id;
}
const isAdmin = (user: string | null) => t.as(user, async () => (await t.db.query<{ v: boolean }>("select public.is_admin() as v")).rows[0].v);

beforeAll(async () => {
  t = await createTestDb();
  defaultOrg = (await q<{ id: string }>("select id from public.organizations where is_default"))[0].id;
  agency = (await q<{ id: string }>("insert into public.organizations (name) values ('Agency') returning id"))[0].id;
  client = (await q<{ id: string }>("insert into public.organizations (name, parent_id) values ('Client', $1) returning id", [agency]))[0].id;
  platform = await person([{ org: defaultOrg, role: "admin" }]);
  member = await person([{ org: defaultOrg, role: "member" }]);
  agencyAdmin = await person([{ org: agency, role: "admin" }]);
  clientAdmin = await person([{ org: client, role: "admin" }]);
}, 90_000);
afterAll(async () => {
  await t.db.close();
});

describe("who is a platform admin", () => {
  it("only an admin of the default organization", async () => {
    expect(await isAdmin(platform)).toBe(true);
    expect(await isAdmin(member)).toBe(false);
    expect(await isAdmin(agencyAdmin)).toBe(false);
    expect(await isAdmin(clientAdmin)).toBe(false);
  });

  it("an admin of the default organization AND of other organizations still is", async () => {
    const both = await person([{ org: defaultOrg, role: "admin" }, { org: client, role: "admin" }]);
    expect(await isAdmin(both)).toBe(true);
  });

  it("is lost when the default-organization admin role is lost", async () => {
    const temp = await person([{ org: defaultOrg, role: "admin" }, { org: client, role: "member" }]);
    expect(await isAdmin(temp)).toBe(true);
    await q("update public.memberships set role = 'member' where user_id = $1 and org_id = $2", [temp, defaultOrg]);
    expect(await isAdmin(temp)).toBe(false);
  });

  it("a designer or member of the default organization is not one, even with an admin role elsewhere", async () => {
    const u = await person([{ org: defaultOrg, role: "designer" }, { org: client, role: "admin" }]);
    expect(await isAdmin(u)).toBe(false);
  });

  it("an anonymous caller cannot even ask", async () => {
    expect(await code(() => isAdmin(null))).toBe("42501");
  });
});

describe("a client organization's admin cannot touch platform settings", () => {
  it("cannot change feature flags, AI limits or overrides", async () => {
    expect(await affected(clientAdmin, "update public.feature_flags set default_enabled = false")).toBe(0);
    expect(await affected(clientAdmin, "update public.ai_limits set per_day = 999999")).toBe(0);
    expect(await affected(clientAdmin, "delete from public.feature_flags")).toBe(0);
    expect(await code(() => t.as(clientAdmin, () => t.db.query("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('user', $1, 'analytics', true)", [clientAdmin])))).toBe("42501");
    expect((await q<{ c: number }>("select count(*)::int c from public.feature_flags where default_enabled = false"))[0].c).toBeLessThan(5); // untouched (a couple are off by design)
  });

  it("cannot promote themselves, or anyone, in the default organization", async () => {
    expect(await code(() => t.as(clientAdmin, () => t.db.query("insert into public.memberships (org_id, user_id, role) values ($1, $2, 'admin')", [defaultOrg, clientAdmin])))).toBe("42501");
    expect(await affected(clientAdmin, "update public.memberships set role = 'admin' where user_id = $1", [member])).toBe(0);
    expect(await isAdmin(clientAdmin)).toBe(false);
    expect((await q<{ role: string }>("select role from public.memberships where user_id = $1 and org_id = $2", [member, defaultOrg]))[0].role).toBe("member");
  });

  it("cannot write the organizations table (creating clients goes through the guarded function)", async () => {
    expect(await code(() => t.as(clientAdmin, () => t.db.query("insert into public.organizations (name) values ('Mine')")))).toBe("42501");
    expect(await affected(clientAdmin, "update public.organizations set name = 'Hacked' where id = $1", [defaultOrg])).toBe(0);
    expect(await affected(agencyAdmin, "update public.organizations set name = 'Hacked' where id = $1", [client])).toBe(0);
    expect((await q<{ name: string }>("select name from public.organizations where id = $1", [defaultOrg]))[0].name).not.toBe("Hacked");
  });

  it("cannot read other people's profiles, memberships or AI usage", async () => {
    const profiles = await t.as(clientAdmin, async () => (await t.db.query<{ id: string }>("select id from public.profiles")).rows);
    expect(profiles).toEqual([{ id: clientAdmin }]);
    const memberships = await t.as(clientAdmin, async () => (await t.db.query<{ user_id: string }>("select user_id from public.memberships")).rows);
    expect(memberships.every((m) => m.user_id === clientAdmin)).toBe(true);
  });

  it("cannot ask what features another person has", async () => {
    expect(await code(() => t.as(clientAdmin, () => t.db.query("select public.feature_enabled_for($1, 'ai_design')", [member])))).toBe("42501");
  });

  it("the platform admin still can do all of it", async () => {
    expect(await affected(platform, "update public.ai_limits set per_day = per_day where role = 'member'")).toBeGreaterThan(0);
    const profiles = await t.as(platform, async () => (await t.db.query("select id from public.profiles")).rows);
    expect(profiles.length).toBeGreaterThan(3);
    expect(await code(() => t.as(platform, () => t.db.query("select public.feature_enabled_for($1, 'ai_design')", [member])))).toBe("ok");
  });
});

describe("organization-level power is untouched", () => {
  it("a client's admin is still an admin of that client, and an agency admin of its clients", async () => {
    const orgAdmin = (u: string, org: string) => t.as(u, async () => (await t.db.query<{ v: boolean }>("select public.is_org_admin($1) as v", [org])).rows[0].v);
    expect(await orgAdmin(clientAdmin, client)).toBe(true);
    expect(await orgAdmin(agencyAdmin, client)).toBe(true); // the agency rule from 0015
    expect(await orgAdmin(clientAdmin, agency)).toBe(false);
    expect(await orgAdmin(clientAdmin, defaultOrg)).toBe(false);
  });

  it("a client's admin can still manage that client's own data under row-level security", async () => {
    const tpl = (u: string, org: string) =>
      t.as(u, () => t.db.query("insert into public.brand_templates (org_id, name, doc_json, lock_json) values ($1, 'T', '{}'::jsonb, '{\"editable\":[]}'::jsonb)", [org]));
    expect(await code(() => tpl(clientAdmin, client))).toBe("ok");
    expect(await code(() => tpl(clientAdmin, defaultOrg))).toBe("42501"); // but not the agency's or the default organization's
  });
});

describe("a deployment can never lock itself out", () => {
  it("with no default organization at all, the old rule applies (an admin anywhere is an admin)", async () => {
    const f = await createTestDb();
    try {
      await f.db.query("update public.organizations set is_default = false");
      const org = (await f.db.query<{ id: string }>("insert into public.organizations (name) values ('Only') returning id")).rows[0].id;
      const u = await f.addUser("solo@example.com");
      await f.db.query("delete from public.memberships where user_id = $1", [u]);
      await f.db.query("insert into public.memberships (org_id, user_id, role) values ($1, $2, 'admin')", [org, u]);
      expect(await f.as(u, async () => (await f.db.query<{ v: boolean }>("select public.is_admin() as v")).rows[0].v)).toBe(true);
      const m = await f.addUser("plain@example.com");
      expect(await f.as(m, async () => (await f.db.query<{ v: boolean }>("select public.is_admin() as v")).rows[0].v)).toBe(false);
    } finally {
      await f.db.close();
    }
  }, 60_000);
});
