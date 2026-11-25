import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/authz/db-harness";

/** The real 0006 migration in Postgres (PGlite): who can see or change campaigns, events and disclaimers. */

let t: TestDb;
let n = 0;
const email = () => `c${++n}@example.com`;

type World = { orgA: string; orgB: string; adminA: string; adminB: string; memberA: string; campA: string; campB: string; varA: string };
let w: World;

beforeAll(async () => {
  t = await createTestDb();
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await t.db.query<T>(sql, p)).rows;
  const [{ id: orgA }] = await q<{ id: string }>("insert into public.organizations (name) values ('A') returning id");
  const [{ id: orgB }] = await q<{ id: string }>("insert into public.organizations (name) values ('B') returning id");
  const adminA = await t.addUser(email());
  const adminB = await t.addUser(email());
  const memberA = await t.addUser(email());
  await t.db.query("delete from public.memberships where user_id in ($1,$2,$3)", [adminA, adminB, memberA]);
  await t.db.query("insert into public.memberships (org_id, user_id, role) values ($1,$2,'admin'), ($3,$4,'admin'), ($1,$5,'member')", [orgA, adminA, orgB, adminB, memberA]);
  const mk = async (org: string, name: string) =>
    (await q<{ id: string }>("insert into public.banner_campaigns (org_id, name, href, fallback_src) values ($1,$2,'https://a.com/x','https://a.com/f.png') returning id", [org, name]))[0].id;
  const campA = await mk(orgA, "A campaign");
  const campB = await mk(orgB, "B campaign");
  const varA = (await q<{ id: string }>("insert into public.campaign_variants (campaign_id, image_url, weight) values ($1,'https://a.com/v.png',1) returning id", [campA]))[0].id;
  w = { orgA, orgB, adminA, adminB, memberA, campA, campB, varA };
}, 60_000);
afterAll(async () => {
  await t.db.close();
});

const rows = (userId: string | null, sql: string, p: unknown[] = []) => t.as(userId, async () => (await t.db.query(sql, p)).rows);

describe("campaigns and variants", () => {
  it("members of an organization can read its campaigns, admins of other organizations cannot", async () => {
    expect(await rows(w.memberA, "select name from public.banner_campaigns")).toEqual([{ name: "A campaign" }]);
    expect(await rows(w.adminB, "select name from public.banner_campaigns")).toEqual([{ name: "B campaign" }]);
    expect(await rows(w.adminB, "select id from public.campaign_variants")).toEqual([]);
  });

  it("only admins of that organization write; members and outsiders cannot", async () => {
    const ins = (org: string) => t.db.query("insert into public.banner_campaigns (org_id, name, href, fallback_src) values ($1,'x','https://a.com','https://a.com/f.png')", [org]);
    await expect(t.as(w.memberA, () => ins(w.orgA))).rejects.toThrow(/row-level security/);
    await expect(t.as(w.adminB, () => ins(w.orgA))).rejects.toThrow(/row-level security/);
    await t.as(w.adminA, () => ins(w.orgA));
    expect(await rows(w.adminB, "update public.banner_campaigns set name = 'hijack' where id = $1 returning id", [w.campA])).toEqual([]);
    expect(await rows(w.adminB, "delete from public.banner_campaigns where id = $1 returning id", [w.campA])).toEqual([]);
    await expect(t.as(w.adminB, () => t.db.query("insert into public.campaign_variants (campaign_id, image_url) values ($1,'https://a.com/v.png')", [w.campA]))).rejects.toThrow(/row-level security/);
  });

  it("an admin cannot move a campaign into another organization", async () => {
    await expect(t.as(w.adminA, () => t.db.query("update public.banner_campaigns set org_id = $1 where id = $2", [w.orgB, w.campA]))).rejects.toThrow(/row-level security/);
  });

  it("rejects non-https links, bad schedules and bad weights", async () => {
    const bad = (href: string, extra = "") => t.db.query(`insert into public.banner_campaigns (org_id, name, href, fallback_src ${extra ? ", starts_at, ends_at" : ""}) values ($1,'x',$2,'https://a.com/f.png' ${extra})`, [w.orgA, href]);
    await expect(bad("http://a.com")).rejects.toThrow(/check/);
    await expect(bad("javascript:alert(1)")).rejects.toThrow(/check/);
    await expect(bad("https://a.com", ", '2026-02-01', '2026-01-01'")).rejects.toThrow(/check/);
    await expect(t.db.query("insert into public.campaign_variants (campaign_id, image_url, weight) values ($1,'https://a.com/v.png',-1)", [w.campA])).rejects.toThrow(/check/);
  });
});

describe("event tables are server-written only", () => {
  const server = (sql: string, p: unknown[]) => t.db.query(sql, p);

  it("the browser-facing roles cannot insert, update or delete events, or call the recorders", async () => {
    for (const sql of [
      "insert into public.click_events (campaign_id, org_id, day, visitor_hash) values ($1, $2, current_date, 'abcdefgh')",
      "insert into public.campaign_image_loads (campaign_id, org_id, day, loads) values ($1, $2, current_date, 5)",
    ]) {
      await expect(t.as(w.adminA, () => t.db.query(sql, [w.campA, w.orgA]))).rejects.toThrow(/permission denied/);
    }
    await expect(t.as(w.adminA, () => t.db.query("select public.record_click($1, null, 'mobile', 'abcdefgh')", [w.campA]))).rejects.toThrow(/permission denied/);
    await expect(t.as(null, () => t.db.query("select public.record_image_load($1, null)", [w.campA]))).rejects.toThrow(/permission denied/);
    await expect(t.as(w.adminA, () => t.db.query("delete from public.click_events"))).rejects.toThrow(/permission denied/);
    await expect(t.as(null, () => t.db.query("select * from public.click_events"))).rejects.toThrow(/permission denied/);
  });

  it("the server records clicks and loads; counts add up; only that organization's admins read them", async () => {
    await server("select public.record_click($1, $2, 'mobile', 'hash-one-aaaa')", [w.campA, w.varA]);
    await server("select public.record_click($1, $2, 'mobile', 'hash-one-aaaa')", [w.campA, w.varA]);
    await server("select public.record_click($1, null, 'desktop', 'hash-two-bbbb')", [w.campA]);
    for (let i = 0; i < 3; i++) await server("select public.record_image_load($1, $2)", [w.campA, w.varA]);
    await server("select public.record_image_load($1, null)", [w.campA]);

    const stats = await rows(w.adminA, "select variant_id, clicks, unique_clicks, image_loads from public.campaign_stats($1, current_date - 1, current_date + 1) order by variant_id nulls last", [w.orgA]);
    expect(stats).toEqual([
      { variant_id: w.varA, clicks: 2, unique_clicks: 1, image_loads: 3 },
      { variant_id: null, clicks: 1, unique_clicks: 1, image_loads: 1 },
    ]);

    expect(await rows(w.adminB, "select * from public.click_events")).toEqual([]);
    expect(await rows(w.adminB, "select * from public.campaign_image_loads")).toEqual([]);
    expect(await rows(w.memberA, "select * from public.click_events")).toEqual([]);
    expect(await rows(w.adminB, "select * from public.campaign_stats($1, current_date - 1, current_date + 1)", [w.orgA])).toEqual([]);
  });

  it("ignores events for unknown campaigns and clamps odd values", async () => {
    await server("select public.record_click('99999999-9999-4999-8999-999999999999', null, 'mobile', 'abcdefgh')", []);
    await server("select public.record_click($1, $2, 'toaster', 'zzzzzzzz')", [w.campA, w.campB]); // variant from another campaign
    const { rows: r } = await t.db.query<{ device_class: string; variant_id: string | null }>("select device_class, variant_id from public.click_events where visitor_hash = 'zzzzzzzz'");
    expect(r).toEqual([{ device_class: "other", variant_id: null }]);
  });

  it("stores no address, user agent or location columns at all", async () => {
    const { rows: cols } = await t.db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name in ('click_events','campaign_image_loads')");
    expect(cols.map((c) => c.column_name).join(" ")).not.toMatch(/ip|agent|geo|country|city|email|referer/);
  });

  it("rejects an absurd date range", async () => {
    await expect(rows(w.adminA, "select * from public.campaign_stats($1, '2020-01-01', '2026-01-01')", [w.orgA])).rejects.toThrow(/Date range/);
  });
});

describe("legal_disclaimers", () => {
  it("ships neutral global templates, every one flagged as needing legal review", async () => {
    const { rows: r } = await t.db.query<{ category: string; needs_review: boolean; body: string }>("select category, needs_review, body from public.legal_disclaimers where org_id is null");
    expect(r.length).toBeGreaterThanOrEqual(8);
    expect(r.every((x) => x.needs_review)).toBe(true);
    expect(new Set(r.map((x) => x.category))).toEqual(new Set(["confidentiality", "data_protection", "financial", "medical", "legal", "other"]));
    expect(r.every((x) => x.body.length <= 1500)).toBe(true);
  });

  it("every signed-in person reads the globals, only their own organization's custom ones", async () => {
    await t.db.query("insert into public.legal_disclaimers (org_id, title, category, body) values ($1,'Org B own','legal','text')", [w.orgB]);
    const a = await rows(w.memberA, "select title from public.legal_disclaimers where org_id is not null");
    expect(a).toEqual([]);
    expect((await rows(w.adminB, "select title from public.legal_disclaimers where org_id is not null")).map((r) => (r as { title: string }).title)).toEqual(["Org B own"]);
    expect((await rows(w.memberA, "select 1 from public.legal_disclaimers where org_id is null")).length).toBeGreaterThanOrEqual(8);
    await expect(t.as(null, () => t.db.query("select * from public.legal_disclaimers"))).rejects.toThrow(/permission denied/);
  });

  it("org admins write only their own; globals cannot be edited, deleted or created through the API roles", async () => {
    const ins = (org: string | null) => t.db.query("insert into public.legal_disclaimers (org_id, title, category, body) values ($1,'t','legal','b')", [org]);
    await t.as(w.adminA, () => ins(w.orgA));
    await expect(t.as(w.adminA, () => ins(null))).rejects.toThrow(/row-level security/);
    await expect(t.as(w.adminA, () => ins(w.orgB))).rejects.toThrow(/row-level security/);
    await expect(t.as(w.memberA, () => ins(w.orgA))).rejects.toThrow(/row-level security/);
    expect(await rows(w.adminA, "update public.legal_disclaimers set title = 'x' where org_id is null returning id")).toEqual([]);
    expect(await rows(w.adminA, "delete from public.legal_disclaimers where org_id is null returning id")).toEqual([]);
    await expect(t.db.query("insert into public.legal_disclaimers (org_id, title, category, body) values (null,'t','legal',repeat('x',1501))")).rejects.toThrow(/check/);
  });
});
