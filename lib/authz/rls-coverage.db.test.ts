import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db-harness";

/**
 * Guard rails over the whole schema (every migration applied): a new table cannot ship without row-level security, and a
 * SECURITY DEFINER function cannot ship without a pinned search_path or open to signed-out callers by accident.
 * If one of these fails, fix the migration; do not loosen the test.
 */

let t: TestDb;
const q = async <T = Record<string, unknown>>(sql: string) => (await t.db.query<T>(sql)).rows;

beforeAll(async () => {
  t = await createTestDb();
}, 90_000);
afterAll(async () => {
  await t.db.close();
});

describe("schema-wide security invariants", () => {
  it("every table in the public schema has row-level security enabled", async () => {
    const rows = await q<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("every SECURITY DEFINER function pins its search_path", async () => {
    const rows = await q<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
        order by 1`,
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it("no SECURITY DEFINER function can be run by a signed-out caller, except the ones listed here on purpose", async () => {
    // Add a name here only when a function is meant for anonymous callers, and say why in its migration.
    // get_public_card: the public digital-card page (/c/...). Returns only the public columns of a PUBLISHED card (0007).
    const intentionallyPublic: string[] = ["get_public_card"];
    const rows = await q<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
          and has_function_privilege('anon', p.oid, 'execute') order by 1`,
    );
    expect(rows.map((r) => r.proname).filter((n) => !intentionallyPublic.includes(n))).toEqual([]);
  });

  it("a signed-out caller can read nothing from the core tables", async () => {
    for (const table of ["profiles", "memberships", "organizations", "ai_usage", "signatures", "assets"]) {
      // Either no rows, or the database refuses outright (42501). Both mean a signed-out visitor gets nothing.
      const outcome = await t.as(null, () =>
        t.db.query(`select 1 from public.${table}`).then(
          (r) => r.rows.length,
          (e: { code?: string }) => e.code,
        ),
      );
      expect(outcome === 0 || outcome === "42501", `${table}: ${String(outcome)}`).toBe(true);
    }
  });
});
