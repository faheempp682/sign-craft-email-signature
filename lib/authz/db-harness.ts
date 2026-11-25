import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Test support: a real Postgres (PGlite) with a minimal copy of the Supabase pieces our SQL relies on
 * (the `anon` / `authenticated` roles, `auth.users`, `auth.uid()`), then every migration in order.
 * This lets the tests exercise the actual RLS policies and SQL functions, not a mock of them.
 */
export async function createTestDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  const dir = join(process.cwd(), "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }

  /** Run `fn` as a signed-in user (or anonymous when id is null), exactly as PostgREST would: role `authenticated` + JWT subject. */
  async function as<T>(id: string | null, fn: () => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    await db.exec(id ? "set role authenticated" : "set role anon");
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
    }
  }

  /** Create an auth user (the signup trigger adds the profile and default membership). Sign-up is invite-only (0017), so this invites the address first. */
  async function addUser(email: string): Promise<string> {
    await db.query("insert into public.invitations (email) values (lower(btrim($1))) on conflict (email) do nothing", [email]);
    const { rows } = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
    return rows[0].id;
  }

  async function setRole(userId: string, role: "member" | "designer" | "admin") {
    await db.query("update public.memberships set role = $2 where user_id = $1", [userId, role]);
  }

  return { db, as, addUser, setRole };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;
