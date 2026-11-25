import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/authz/db-harness";

/** Real migrations in Postgres (PGlite): approving the brand template's signature for people who have none. */

let t: TestDb;
let n = 0;
const email = () => `d${++n}@example.com`;
const DOC = { version: 1, template_id: "classic", blocks: [{ type: "identity", name: "X" }] };

const newOrg = async (name: string) => (await t.db.query<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [name])).rows[0].id;
async function admin(org: string, role: "member" | "admin" = "admin") {
  const id = await t.addUser(email());
  await t.db.query("insert into public.memberships (org_id, user_id, role) values ($1, $2, $3) on conflict (org_id, user_id) do update set role = $3", [org, id, role]);
  return id;
}
const person = async (org: string, o: { department?: string; status?: string } = {}) =>
  (await t.db.query<{ id: string }>("insert into public.people (org_id, email, full_name, department, status) values ($1, $2, 'Ada Lovelace', $3, $4) returning id", [org, email(), o.department ?? "", o.status ?? "active"])).rows[0].id;
const template = async (org: string, o: { departments?: string[]; name?: string } = {}) =>
  (await t.db.query<{ id: string }>("insert into public.brand_templates (org_id, name, doc_json, lock_json, departments) values ($1, $2, $3, '{\"editable\":[]}', $4) returning id", [org, o.name ?? "Default", JSON.stringify(DOC), o.departments ?? []])).rows[0].id;
const approve = (userId: string, org: string, ids: string[] | null = null) =>
  t.as(userId, async () => (await t.db.query<{ r: { created: number; already_approved: number; no_template: number } }>("select public.approve_directory_defaults($1, $2) as r", [org, ids])).rows[0].r);
const versions = async (personId: string) => (await t.db.query<{ status: string; version_no: number; values_json: unknown; review_note: string; reviewed_by: string | null }>("select status, version_no, values_json, review_note, reviewed_by from public.signature_versions where person_id = $1 order by version_no", [personId])).rows;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.db.close();
});

describe("approve_directory_defaults", () => {
  it("approves the template's signature for active people who have none, recording who did it", async () => {
    const org = await newOrg("A");
    const a = await admin(org);
    await template(org);
    const p1 = await person(org);
    const p2 = await person(org);
    expect(await approve(a, org)).toEqual({ created: 2, already_approved: 0, no_template: 0 });
    const v = await versions(p1);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ status: "approved", version_no: 1, values_json: {}, reviewed_by: a });
    expect(v[0].review_note).toMatch(/administrator/);
    expect((await versions(p2))[0].status).toBe("approved");
  });

  it("never replaces or duplicates a signature someone already has approved, and is safe to repeat", async () => {
    const org = await newOrg("B");
    const a = await admin(org);
    await template(org);
    const p = await person(org);
    expect((await approve(a, org)).created).toBe(1);
    expect(await approve(a, org)).toEqual({ created: 0, already_approved: 1, no_template: 0 });
    expect(await versions(p)).toHaveLength(1);
  });

  it("leaves out inactive people, and people no template applies to", async () => {
    const org = await newOrg("C");
    const a = await admin(org);
    await template(org, { departments: ["Sales"] });
    const sales = await person(org, { department: "Sales" });
    const eng = await person(org, { department: "Engineering" });
    const gone = await person(org, { department: "Sales", status: "inactive" });
    expect(await approve(a, org)).toEqual({ created: 1, already_approved: 0, no_template: 1 });
    expect(await versions(sales)).toHaveLength(1);
    expect(await versions(eng)).toHaveLength(0);
    expect(await versions(gone)).toHaveLength(0);
  });

  it("can be limited to chosen people", async () => {
    const org = await newOrg("D");
    const a = await admin(org);
    await template(org);
    const p1 = await person(org);
    const p2 = await person(org);
    expect((await approve(a, org, [p1])).created).toBe(1);
    expect(await versions(p2)).toHaveLength(0);
  });

  it("numbers a new approval after any earlier (for example rejected) version", async () => {
    const org = await newOrg("E");
    const a = await admin(org);
    await template(org);
    const p = await person(org);
    await t.db.query(
      "insert into public.signature_versions (org_id, person_id, template_snapshot, version_no, status, reviewed_at, review_note) values ($1, $2, '{}', 1, 'rejected', now(), 'no')",
      [org, p],
    );
    await approve(a, org);
    expect((await versions(p)).map((v) => [v.version_no, v.status])).toEqual([[1, "rejected"], [2, "approved"]]);
  });

  it("ignores people from other organizations, even when their ids are passed in", async () => {
    const mine = await newOrg("F1");
    const other = await newOrg("F2");
    const a = await admin(mine);
    await template(mine);
    await template(other);
    const stranger = await person(other);
    expect((await approve(a, mine, [stranger])).created).toBe(0);
    expect(await versions(stranger)).toHaveLength(0);
  });

  it("is for admins of that organization only", async () => {
    const org = await newOrg("G");
    const other = await newOrg("G2");
    await template(org);
    const p = await person(org);
    const member = await admin(org, "member");
    const outsider = await admin(other);
    await expect(approve(member, org)).rejects.toThrow(/permission/);
    await expect(approve(outsider, org)).rejects.toThrow(/permission/);
    await expect(t.as(null, () => t.db.query("select public.approve_directory_defaults($1, null)", [org]))).rejects.toThrow();
    expect(await versions(p)).toHaveLength(0);
  });

  it("refuses an oversized request", async () => {
    const org = await newOrg("H");
    const a = await admin(org);
    const ids = Array.from({ length: 1001 }, () => "6f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f");
    await expect(approve(a, org, ids)).rejects.toThrow(/at most 1000/);
  });
});
