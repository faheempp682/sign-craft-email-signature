import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db-harness";

/** Migration 0017: only an invited email address can create an account, and the invitation decides the role. */

let t: TestDb;
let admin: string;
let member: string;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await t.db.query<T>(sql, p)).rows;
const code = (fn: () => Promise<unknown>) => fn().then(() => "ok", (e: { code?: string }) => e.code ?? "error");
const signUp = (email: string) => q<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
const invite = (email: string, role = "member") => q("insert into public.invitations (email, role) values ($1, $2)", [email, role]);

beforeAll(async () => {
  t = await createTestDb();
  admin = await t.addUser("boss@example.com");
  await t.setRole(admin, "admin");
  member = await t.addUser("plain@example.com");
}, 90_000);
afterAll(async () => {
  await t.db.close();
});

describe("sign-up needs an invitation", () => {
  it("refuses an address nobody invited", async () => {
    expect(await code(() => signUp("stranger@example.com"))).toBe("P0001");
    expect(await q("select 1 from auth.users where email = 'stranger@example.com'")).toHaveLength(0);
    expect(await q("select 1 from public.profiles where email = 'stranger@example.com'")).toHaveLength(0);
  });

  it("refuses a missing email", async () => {
    expect(await code(() => q("insert into auth.users (email) values (null)"))).toBe("P0001");
  });

  it("accepts an invited address, case and spacing aside", async () => {
    await invite("jane@example.com");
    expect(await code(() => signUp("  Jane@Example.COM "))).toBe("ok");
  });

  it("gives the invited role in the default organization and uses the invitation up", async () => {
    await invite("designer@example.com", "designer");
    const [{ id }] = await signUp("designer@example.com");
    const m = await q<{ role: string; is_default: boolean }>(
      "select m.role, o.is_default from public.memberships m join public.organizations o on o.id = m.org_id where m.user_id = $1",
      [id],
    );
    expect(m).toEqual([{ role: "designer", is_default: true }]);
    const inv = await q<{ accepted_at: string | null }>("select accepted_at from public.invitations where email = 'designer@example.com'");
    expect(inv[0].accepted_at).not.toBeNull();
    expect(await q("select email from public.profiles where id = $1", [id])).toEqual([{ email: "designer@example.com" }]);
  });

  it("an invited admin becomes an admin of the default organization", async () => {
    await invite("second-admin@example.com", "admin");
    const [{ id }] = await signUp("second-admin@example.com");
    expect(await t.as(id, async () => (await t.db.query<{ v: boolean }>("select public.is_admin() as v")).rows[0].v)).toBe(true);
  });

  it("an invitation works once: a second account for the same address is refused", async () => {
    await invite("once@example.com");
    await signUp("once@example.com");
    await q("delete from auth.users where email = 'once@example.com'");
    expect(await code(() => signUp("once@example.com"))).toBe("P0001");
  });

  it("people who already have an account are not affected (sign-in never touches the table)", async () => {
    expect(await q("select 1 from public.profiles where id = $1", [member])).toHaveLength(1);
  });
});

describe("who can manage invitations", () => {
  it("an admin can invite, list and withdraw", async () => {
    expect(await code(() => t.as(admin, () => t.db.query("insert into public.invitations (email, role, invited_by) values ('new@example.com', 'member', $1)", [admin])))).toBe("ok");
    expect((await t.as(admin, async () => (await t.db.query("select email from public.invitations where email = 'new@example.com'")).rows)).length).toBe(1);
    await t.as(admin, () => t.db.query("delete from public.invitations where email = 'new@example.com'"));
    expect(await q("select 1 from public.invitations where email = 'new@example.com'")).toHaveLength(0);
    expect(await code(() => signUp("new@example.com"))).toBe("P0001");
  });

  it("a plain member cannot invite, read or withdraw invitations", async () => {
    expect(await code(() => t.as(member, () => t.db.query("insert into public.invitations (email) values ('sneaky@example.com')")))).toBe("42501");
    expect(await t.as(member, async () => (await t.db.query("select 1 from public.invitations")).rows)).toHaveLength(0);
    await invite("keep@example.com");
    await t.as(member, () => t.db.query("delete from public.invitations where email = 'keep@example.com'"));
    expect(await q("select 1 from public.invitations where email = 'keep@example.com'")).toHaveLength(1);
  });

  it("a signed-out caller gets nothing", async () => {
    expect(await code(() => t.as(null, () => t.db.query("insert into public.invitations (email) values ('anon@example.com')")))).toBe("42501");
    expect(await t.as(null, async () => (await t.db.query("select * from public.invitations")).rows)).toHaveLength(0);
  });

  it("an invitation must be a clean lowercase address", async () => {
    expect(await code(() => invite("Mixed@Example.com"))).toBe("23514");
    expect(await code(() => invite("no-at-sign"))).toBe("23514");
  });

  it("the trigger functions cannot be called directly by browsers", async () => {
    expect(await code(() => t.as(member, () => t.db.query("select public.require_invitation()")))).toBe("42501");
    expect(await code(() => t.as(member, () => t.db.query("select public.handle_new_user()")))).toBe("42501");
  });
});
