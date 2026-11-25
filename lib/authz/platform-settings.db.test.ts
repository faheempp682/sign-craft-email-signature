import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db-harness";

/**
 * Migration 0019: platform_settings holds admin-editable, platform-wide values (today: the saved-signature limit).
 * Everyone signed in may read it (the app needs the number); only platform admins may change it.
 */

let t: TestDb;
let n = 0;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await t.db.query<T>(sql, p)).rows;
const code = (fn: () => Promise<unknown>) => fn().then(() => "ok", (e: { code?: string }) => e.code ?? "error");
const affected = (user: string, sql: string, p: unknown[] = []) => t.as(user, async () => (await t.db.query(sql, p)).affectedRows ?? 0);
const upsert = (user: string, value: unknown) =>
  t.as(user, () => t.db.query("insert into public.platform_settings (key, value) values ('max_signatures_per_account', $1::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()", [JSON.stringify(value)]));
const stored = async () => (await q<{ value: unknown }>("select value from public.platform_settings where key = 'max_signatures_per_account'"))[0]?.value;

let defaultOrg: string;
let client: string;
let platform: string;
let member: string;
let clientAdmin: string;

async function person(org: string, role: "member" | "admin") {
  const id = await t.addUser(`ps${++n}@example.com`);
  await q("delete from public.memberships where user_id = $1", [id]);
  await q("insert into public.memberships (org_id, user_id, role) values ($1,$2,$3)", [org, id, role]);
  return id;
}

beforeAll(async () => {
  t = await createTestDb();
  defaultOrg = (await q<{ id: string }>("select id from public.organizations where is_default"))[0].id;
  client = (await q<{ id: string }>("insert into public.organizations (name, parent_id) values ('Client', $1) returning id", [defaultOrg]))[0].id;
  platform = await person(defaultOrg, "admin");
  member = await person(defaultOrg, "member");
  clientAdmin = await person(client, "admin");
}, 90_000);
afterAll(async () => {
  await t.db.close();
});

describe("platform_settings (migration 0019)", () => {
  it("starts empty, so the environment value (or 5) applies", async () => {
    expect(await q("select * from public.platform_settings")).toEqual([]);
  });

  it("a platform admin can set, change and remove the signature limit, and it is stored as a number", async () => {
    expect(await code(() => upsert(platform, 8))).toBe("ok");
    expect(await stored()).toBe(8);
    expect(await code(() => upsert(platform, 3))).toBe("ok"); // the same upsert the route sends: overwrites, no duplicate row
    expect(await stored()).toBe(3);
    expect((await q<{ c: number }>("select count(*)::int c from public.platform_settings"))[0].c).toBe(1);
    expect(await affected(platform, "delete from public.platform_settings where key = 'max_signatures_per_account'")).toBe(1);
    expect(await stored()).toBeUndefined();
  });

  it("everyone signed in can read it", async () => {
    await upsert(platform, 6);
    for (const who of [member, clientAdmin, platform]) {
      const rows = await t.as(who, async () => (await t.db.query<{ value: unknown }>("select value from public.platform_settings where key = 'max_signatures_per_account'")).rows);
      expect(rows).toEqual([{ value: 6 }]);
    }
  });

  it("a member and a client organization's admin cannot create, change or delete it", async () => {
    for (const who of [member, clientAdmin]) {
      expect(await code(() => upsert(who, 1000)), "insert/upsert").toBe("42501");
      expect(await affected(who, "update public.platform_settings set value = '1'::jsonb"), "update").toBe(0);
      expect(await affected(who, "delete from public.platform_settings"), "delete").toBe(0);
    }
    expect(await stored()).toBe(6);
  });

  it("an anonymous caller sees nothing and cannot write", async () => {
    // anon has table grants in Supabase; row-level security is what gives it nothing to see.
    expect(await t.as(null, async () => (await t.db.query("select * from public.platform_settings")).rows)).toEqual([]);
    expect(await code(() => upsert(null as unknown as string, 1))).not.toBe("ok");
    expect(await stored()).toBe(6);
  });

  it("keys must be short snake_case names", async () => {
    for (const key of ["Bad Key", "", "x".repeat(61), "has-dash"]) {
      expect(await code(() => t.db.query("insert into public.platform_settings (key, value) values ($1, '1'::jsonb)", [key])), key).toBe("23514");
    }
  });

  it("a signature limit can be changed again after being removed (admin edits persist across a round trip)", async () => {
    await t.as(platform, () => t.db.query("delete from public.platform_settings"));
    expect(await stored()).toBeUndefined();
    await upsert(platform, 12);
    expect(await stored()).toBe(12);
  });
});
