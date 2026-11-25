import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/authz/db-harness";

/** Real migrations in Postgres (PGlite): who can see or change a stored Google connection. */

let t: TestDb;
let n = 0;
const email = () => `g${++n}@example.com`;
const connect = (userId: string, token = "v1.ciphertext") =>
  t.db.query("insert into public.google_connections (user_id, google_sub, google_email, hd, scope, refresh_token_enc) values ($1, 'sub', 'a@kimp.xyz', 'kimp.xyz', 'gmail.settings.basic', $2)", [userId, token]);

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.db.close();
});

describe("google_connections", () => {
  it("the owner can see that they are connected, but never the encrypted token", async () => {
    const u = await t.addUser(email());
    await connect(u);
    const meta = await t.as(u, async () => (await t.db.query("select google_email, hd from public.google_connections")).rows);
    expect(meta).toEqual([{ google_email: "a@kimp.xyz", hd: "kimp.xyz" }]);
    await expect(t.as(u, () => t.db.query("select refresh_token_enc from public.google_connections"))).rejects.toThrow(/permission denied/);
    await expect(t.as(u, () => t.db.query("select * from public.google_connections"))).rejects.toThrow(/permission denied/);
  });

  it("nobody else can see someone's connection", async () => {
    const a = await t.addUser(email());
    const b = await t.addUser(email());
    await connect(a);
    expect(await t.as(b, async () => (await t.db.query("select user_id from public.google_connections")).rows)).toEqual([]);
  });

  it("the browser-facing roles cannot create or change a connection (so a token cannot be planted or swapped)", async () => {
    const u = await t.addUser(email());
    const v = await t.addUser(email());
    await expect(
      t.as(u, () => t.db.query("insert into public.google_connections (user_id, google_sub, google_email, hd, scope, refresh_token_enc) values ($1, 's', 'x@kimp.xyz', 'kimp.xyz', 'x', 'planted')", [u])),
    ).rejects.toThrow(/permission denied/);
    await connect(v, "original");
    await expect(t.as(v, () => t.db.query("update public.google_connections set refresh_token_enc = 'swapped'"))).rejects.toThrow(/permission denied/);
    expect((await t.db.query("select refresh_token_enc from public.google_connections where user_id = $1", [v])).rows).toEqual([{ refresh_token_enc: "original" }]);
  });

  it("anonymous visitors get nothing", async () => {
    await expect(t.as(null, () => t.db.query("select user_id from public.google_connections"))).rejects.toThrow(/permission denied/);
  });

  it("the owner can delete their own connection, and only their own", async () => {
    const a = await t.addUser(email());
    const b = await t.addUser(email());
    await connect(a);
    await connect(b);
    expect(await t.as(a, async () => (await t.db.query("delete from public.google_connections")).affectedRows)).toBe(1);
    expect((await t.db.query("select user_id from public.google_connections where user_id = $1", [b])).rows).toHaveLength(1);
  });

  it("is removed with the account", async () => {
    const u = await t.addUser(email());
    await connect(u);
    await t.db.query("delete from auth.users where id = $1", [u]);
    expect((await t.db.query("select 1 from public.google_connections where user_id = $1", [u])).rows).toHaveLength(0);
  });
});

describe("gmail_push_log", () => {
  const log = (userId: string) => t.db.query("insert into public.gmail_push_log (user_id, send_as_email, previous_signature, new_signature_hash) values ($1, 'a@kimp.xyz', '<p>old</p>', 'abc')", [userId]);

  it("owners read their own log, and cannot write or alter it", async () => {
    const a = await t.addUser(email());
    const b = await t.addUser(email());
    await log(a);
    await log(b);
    expect(await t.as(a, async () => (await t.db.query("select user_id from public.gmail_push_log")).rows)).toEqual([{ user_id: a }]);
    await expect(t.as(a, () => t.db.query("insert into public.gmail_push_log (user_id, send_as_email, new_signature_hash) values ($1, 'x@kimp.xyz', 'h')", [a]))).rejects.toThrow(/permission denied/);
    await expect(t.as(a, () => t.db.query("update public.gmail_push_log set previous_signature = 'tampered'"))).rejects.toThrow(/permission denied/);
    await expect(t.as(a, () => t.db.query("delete from public.gmail_push_log"))).rejects.toThrow(/permission denied/);
  });

  it("refuses an absurdly large stored signature", async () => {
    const u = await t.addUser(email());
    await expect(t.db.query("insert into public.gmail_push_log (user_id, send_as_email, previous_signature, new_signature_hash) values ($1, 'a@kimp.xyz', repeat('x', 200001), 'h')", [u])).rejects.toThrow(/check/);
  });
});
