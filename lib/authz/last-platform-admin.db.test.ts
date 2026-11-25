import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db-harness";

/**
 * Migrations 0003 + 0016: the platform must never be left without a platform admin.
 *
 * 0003 protects "the last admin" anywhere. Since 0016 a platform admin is an admin of the DEFAULT organization only, so an
 * admin of some client organization must not count as "another admin" when the last default-organization admin is demoted
 * or removed: that would leave nobody able to change feature flags, AI limits or memberships of the default organization.
 */

let t: TestDb;
let defaultOrg: string;
let clientOrg: string;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await t.db.query<T>(sql, p)).rows;
const code = (fn: () => Promise<unknown>) => fn().then(() => "ok", (e: { code?: string }) => e.code ?? "error");

beforeAll(async () => {
  t = await createTestDb();
  defaultOrg = (await q<{ id: string }>("select id from public.organizations where is_default"))[0].id;
  clientOrg = (await q<{ id: string }>("insert into public.organizations (name) values ('Client') returning id"))[0].id;
}, 90_000);
afterAll(async () => {
  await t.db.close();
});

async function onlyPlatformAdmin(email: string) {
  // Reset the fixture with the protection off (it would, rightly, refuse to remove the last admin), then switch it back on.
  await q("alter table public.memberships disable trigger memberships_protect_last_admin");
  await q("delete from public.memberships where role = 'admin'");
  await q("alter table public.memberships enable trigger memberships_protect_last_admin");
  const platform = await t.addUser(email);
  await t.setRole(platform, "admin");
  const clientAdmin = await t.addUser(`client-${email}`);
  await q("delete from public.memberships where user_id = $1", [clientAdmin]);
  await q("insert into public.memberships (org_id, user_id, role) values ($1, $2, 'admin')", [clientOrg, clientAdmin]);
  return platform;
}

describe("the last platform admin is protected", () => {
  it("cannot be demoted while only a client organization's admin remains", async () => {
    const platform = await onlyPlatformAdmin("p1@example.com");
    expect(await code(() => t.db.query("update public.memberships set role = 'member' where user_id = $1 and org_id = $2", [platform, defaultOrg]))).toBe("P0001");
  });

  it("cannot be removed while only a client organization's admin remains", async () => {
    const platform = await onlyPlatformAdmin("p2@example.com");
    expect(await code(() => t.db.query("delete from public.memberships where user_id = $1 and org_id = $2", [platform, defaultOrg]))).toBe("P0001");
  });

  it("can be replaced: with a second platform admin in place the first may step down", async () => {
    const first = await onlyPlatformAdmin("p3@example.com");
    const second = await t.addUser("p3b@example.com");
    await t.setRole(second, "admin");
    expect(await code(() => t.db.query("update public.memberships set role = 'member' where user_id = $1 and org_id = $2", [first, defaultOrg]))).toBe("ok");
  });

  it("a client organization's last admin is not protected by this rule", async () => {
    await onlyPlatformAdmin("p4@example.com");
    expect(await code(() => t.db.query("update public.memberships set role = 'member' where org_id = $1", [clientOrg]))).toBe("ok");
  });

  it("with no default organization, the old rule still applies (an admin anywhere counts)", async () => {
    const f = await createTestDb();
    try {
      await f.db.query("update public.organizations set is_default = false");
      const org = (await f.db.query<{ id: string }>("insert into public.organizations (name) values ('Only') returning id")).rows[0].id;
      const u = await f.addUser("solo@example.com");
      await f.db.query("alter table public.memberships disable trigger memberships_protect_last_admin");
      await f.db.query("delete from public.memberships");
      await f.db.query("alter table public.memberships enable trigger memberships_protect_last_admin");
      await f.db.query("insert into public.memberships (org_id, user_id, role) values ($1, $2, 'admin')", [org, u]);
      expect(await code(() => f.db.query("update public.memberships set role = 'member' where user_id = $1", [u]))).toBe("P0001");
    } finally {
      await f.db.close();
    }
  }, 60_000);
});
