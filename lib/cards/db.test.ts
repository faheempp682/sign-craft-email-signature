import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/authz/db-harness";

/** Real migrations in Postgres (PGlite): who can see or change a digital card, and what anonymous visitors get. */

let t: TestDb;
let n = 0;
const email = () => `c${++n}@example.com`;
let slugN = 0;
const slug = () => `card-${++slugN}-x`;

const insertSql =
  "insert into public.digital_cards (owner_id, slug, display_name, published, phone, bio) values ($1, $2, $3, $4, '+1 555 0100', 'secret-free bio') returning id";
const make = async (owner: string, o: { slug?: string; published?: boolean; name?: string } = {}) =>
  (await t.db.query<{ id: string }>(insertSql, [owner, o.slug ?? slug(), o.name ?? "Ada Lovelace", o.published ?? false])).rows[0].id;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.db.close();
});

describe("digital_cards: anonymous visitors", () => {
  it("cannot read the table in any way", async () => {
    await expect(t.as(null, () => t.db.query("select * from public.digital_cards"))).rejects.toThrow(/permission denied/);
    await expect(t.as(null, () => t.db.query("select slug from public.digital_cards"))).rejects.toThrow(/permission denied/);
    await expect(t.as(null, () => t.db.query("insert into public.digital_cards (owner_id, slug, display_name) values (gen_random_uuid(), 'abc', 'x')"))).rejects.toThrow(/permission denied/);
    await expect(t.as(null, () => t.db.query("update public.digital_cards set published = true"))).rejects.toThrow(/permission denied/);
  });

  it("get_public_card returns a published card with only the public columns", async () => {
    const u = await t.addUser(email());
    const s = slug();
    await make(u, { slug: s, published: true });
    const rows = await t.as(null, async () => (await t.db.query<Record<string, unknown>>("select * from public.get_public_card($1)", [s])).rows);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ["accent_color", "address", "bio", "booking_url", "company", "display_name", "email", "indexable", "phone", "photo_url", "slug", "social_links", "title", "website"].sort(),
    );
    const flat = JSON.stringify(rows[0]);
    expect(flat).not.toContain(u); // the owner id never appears
    expect(rows[0].indexable).toBe(false); // noindex by default
  });

  it("is case-insensitive on the slug", async () => {
    const u = await t.addUser(email());
    const s = slug();
    await make(u, { slug: s, published: true });
    const rows = await t.as(null, async () => (await t.db.query("select slug from public.get_public_card($1)", [s.toUpperCase()])).rows);
    expect(rows).toHaveLength(1);
  });

  it("gets nothing for an unpublished card, and nothing for a missing one (the same answer)", async () => {
    const u = await t.addUser(email());
    const s = slug();
    await make(u, { slug: s, published: false });
    const hidden = await t.as(null, async () => (await t.db.query("select * from public.get_public_card($1)", [s])).rows);
    const missing = await t.as(null, async () => (await t.db.query("select * from public.get_public_card($1)", ["no-such-card"])).rows);
    expect(hidden).toEqual([]);
    expect(missing).toEqual([]);
  });

  it("unpublishing takes the card off the public path immediately", async () => {
    const u = await t.addUser(email());
    const s = slug();
    const id = await make(u, { slug: s, published: true });
    await t.as(u, () => t.db.query("update public.digital_cards set published = false where id = $1", [id]));
    expect(await t.as(null, async () => (await t.db.query("select 1 from public.get_public_card($1)", [s])).rows)).toEqual([]);
  });

  it("cannot call the slug-availability helper or the internal functions", async () => {
    await expect(t.as(null, () => t.db.query("select public.digital_card_slug_available('abc')"))).rejects.toThrow(/permission denied/);
  });
});

describe("digital_cards: owners and admins", () => {
  it("an owner sees and edits only their own cards", async () => {
    const a = await t.addUser(email());
    const b = await t.addUser(email());
    const ca = await make(a);
    await make(b);
    const seen = await t.as(a, async () => (await t.db.query("select id from public.digital_cards")).rows);
    expect(seen).toEqual([{ id: ca }]);
    const touched = await t.as(b, async () => (await t.db.query("update public.digital_cards set display_name = 'Hacked' where id = $1", [ca])).affectedRows);
    expect(touched).toBe(0);
    expect((await t.db.query("select display_name from public.digital_cards where id = $1", [ca])).rows[0]).toEqual({ display_name: "Ada Lovelace" });
    expect(await t.as(b, async () => (await t.db.query("delete from public.digital_cards where id = $1", [ca])).affectedRows)).toBe(0);
  });

  it("a user cannot create a card owned by someone else", async () => {
    const a = await t.addUser(email());
    const b = await t.addUser(email());
    await expect(t.as(a, () => t.db.query(insertSql, [b, slug(), "Impostor", false]))).rejects.toThrow(/row-level security/);
  });

  it("an owner can create, publish, and delete their own card", async () => {
    const a = await t.addUser(email());
    const id = await t.as(a, async () => (await t.db.query<{ id: string }>(insertSql, [a, slug(), "Me", true])).rows[0].id);
    expect(await t.as(a, async () => (await t.db.query("delete from public.digital_cards where id = $1", [id])).affectedRows)).toBe(1);
  });

  it("owner_id and created_at cannot be changed (no transferring a card)", async () => {
    const a = await t.addUser(email());
    const b = await t.addUser(email());
    const id = await make(a);
    await expect(t.as(a, () => t.db.query("update public.digital_cards set owner_id = $1 where id = $2", [b, id]))).rejects.toThrow(/permission denied/);
    await expect(t.as(a, () => t.db.query("update public.digital_cards set created_at = now() where id = $1", [id]))).rejects.toThrow(/permission denied/);
  });

  it("an owner cannot attach a card to an organization they are not in", async () => {
    const a = await t.addUser(email());
    const { rows } = await t.db.query<{ id: string }>("insert into public.organizations (name) values ('Other') returning id");
    await expect(t.as(a, () => t.db.query("insert into public.digital_cards (owner_id, org_id, slug, display_name) values ($1, $2, $3, 'x')", [a, rows[0].id, slug()]))).rejects.toThrow(/row-level security/);
    // but their own (default) organization is fine
    const mine = (await t.db.query<{ org_id: string }>("select org_id from public.memberships where user_id = $1", [a])).rows[0].org_id;
    await t.as(a, () => t.db.query("insert into public.digital_cards (owner_id, org_id, slug, display_name) values ($1, $2, $3, 'x')", [a, mine, slug()]));
  });

  it("admins can read and delete every card but not edit it", async () => {
    const admin = await t.addUser(email());
    await t.setRole(admin, "admin");
    const u = await t.addUser(email());
    const id = await make(u, { published: false });
    const seen = await t.as(admin, async () => (await t.db.query("select id from public.digital_cards where id = $1", [id])).rows);
    expect(seen).toHaveLength(1);
    expect(await t.as(admin, async () => (await t.db.query("update public.digital_cards set display_name = 'x' where id = $1", [id])).affectedRows)).toBe(0);
    expect(await t.as(admin, async () => (await t.db.query("delete from public.digital_cards where id = $1", [id])).affectedRows)).toBe(1);
  });

  it("a non-admin cannot read other people's unpublished cards", async () => {
    const a = await t.addUser(email());
    const b = await t.addUser(email());
    const id = await make(a, { published: true });
    expect(await t.as(b, async () => (await t.db.query("select id from public.digital_cards where id = $1", [id])).rows)).toEqual([]);
  });

  it("slug availability works for signed-in users and can exclude the card being edited", async () => {
    const a = await t.addUser(email());
    const s = slug();
    const id = await make(a, { slug: s });
    const check = (x: string, except: string | null = null) => t.as(a, async () => (await t.db.query<{ r: boolean }>("select public.digital_card_slug_available($1, $2) as r", [x, except])).rows[0].r);
    expect(await check(s)).toBe(false);
    expect(await check(s.toUpperCase())).toBe(false);
    expect(await check(s, id)).toBe(true);
    expect(await check("totally-free")).toBe(true);
  });
});

describe("digital_cards: limits and validation", () => {
  it("caps cards per user at 5, per user", async () => {
    const a = await t.addUser(email());
    const b = await t.addUser(email());
    for (let i = 0; i < 5; i++) await make(a);
    await expect(make(a)).rejects.toThrow(/at most 5/);
    await expect(t.as(a, () => t.db.query(insertSql, [a, slug(), "x", false]))).rejects.toThrow(/at most 5/);
    await make(b); // someone else is unaffected
  });

  it("slugs are unique, case-insensitively (stored lowercase only)", async () => {
    const a = await t.addUser(email());
    const b = await t.addUser(email());
    await make(a, { slug: "ada-lovelace" });
    await expect(make(b, { slug: "ada-lovelace" })).rejects.toThrow(/unique/);
    await expect(make(b, { slug: "Ada-Lovelace-2" })).rejects.toThrow(/slug_format/);
  });

  it.each(["ab", "-abc", "abc-", "a b c", "a_bc", "x".repeat(41), "ünï-cardé", "a/../b"])("rejects the malformed slug %j", async (bad) => {
    const a = await t.addUser(email());
    await expect(make(a, { slug: bad })).rejects.toThrow(/slug_format/);
  });

  it.each(["admin", "api", "login", "c", "vcard"])("rejects the reserved slug %j", async (word) => {
    const a = await t.addUser(email());
    // "c" is too short for the format check as well; either way it must be refused
    await expect(make(a, { slug: word })).rejects.toThrow(/slug_(reserved|format)/);
  });

  it("accepts a 3 and a 40 character slug", async () => {
    const a = await t.addUser(email());
    await make(a, { slug: "abc" });
    await make(a, { slug: "a" + "b".repeat(38) + "c" });
  });

  it("limits bio to 300 characters and refuses non-https links", async () => {
    const a = await t.addUser(email());
    const q = (col: string, value: string) => t.db.query(`insert into public.digital_cards (owner_id, slug, display_name, ${col}) values ($1, $2, 'x', $3)`, [a, slug(), value]);
    await expect(q("bio", "x".repeat(301))).rejects.toThrow(/check/);
    await q("bio", "x".repeat(300));
    await expect(q("website", "http://example.com")).rejects.toThrow(/check/);
    await expect(q("website", "javascript:alert(1)")).rejects.toThrow(/check/);
    await expect(q("photo_url", "data:image/png;base64,AAAA")).rejects.toThrow(/check/);
    await expect(q("booking_url", "https://a.com/ b")).rejects.toThrow(/check/);
    await expect(q("email", "not an email")).rejects.toThrow(/check/);
    await expect(q("phone", "+1; DROP")).rejects.toThrow(/check/);
    await expect(q("accent_color", "red")).rejects.toThrow(/check/);
  });

  it("validates social links: known network, https url, at most 10, no extra keys", async () => {
    const a = await t.addUser(email());
    const q = (v: unknown) => t.db.query("insert into public.digital_cards (owner_id, slug, display_name, social_links) values ($1, $2, 'x', $3::jsonb)", [a, slug(), JSON.stringify(v)]);
    await q([{ network: "linkedin", url: "https://linkedin.com/in/ada" }]);
    await expect(q([{ network: "myspace", url: "https://x.com/a" }])).rejects.toThrow(/socials_valid/);
    await expect(q([{ network: "github", url: "http://github.com/a" }])).rejects.toThrow(/socials_valid/);
    await expect(q([{ network: "github", url: "javascript:alert(1)" }])).rejects.toThrow(/socials_valid/);
    await expect(q([{ network: "github", url: "https://github.com/a", extra: 1 }])).rejects.toThrow(/socials_valid/);
    await expect(q({ network: "github" })).rejects.toThrow(/socials_valid/);
    await expect(q(Array.from({ length: 11 }, () => ({ network: "github", url: "https://github.com/a" })))).rejects.toThrow(/socials_valid/);
  });

  it("updated_at moves when a card changes", async () => {
    const a = await t.addUser(email());
    const id = await make(a);
    const before = (await t.db.query<{ u: string }>("select updated_at::text as u from public.digital_cards where id = $1", [id])).rows[0].u;
    await t.db.query("select pg_sleep(0.01)");
    await t.db.query("update public.digital_cards set title = 'CTO' where id = $1", [id]);
    const after = (await t.db.query<{ u: string }>("select updated_at::text as u from public.digital_cards where id = $1", [id])).rows[0].u;
    expect(after).not.toBe(before);
  });

  it("cards are removed with the account", async () => {
    const a = await t.addUser(email());
    const id = await make(a);
    await t.db.query("delete from auth.users where id = $1", [a]);
    expect((await t.db.query("select 1 from public.digital_cards where id = $1", [id])).rows).toHaveLength(0);
  });
});
