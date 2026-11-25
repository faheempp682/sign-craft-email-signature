import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/authz/db-harness";

/** Real migrations in Postgres (PGlite): isolation between organizations, brand-lock enforcement, the approval workflow. */

let t: TestDb;
let n = 0;
const email = () => `t${++n}@example.com`;

const DOC = { version: 1, template_id: "classic", blocks: [{ type: "identity", name: "X" }] };
const LOCK = { editable: ["0.title", "0.name"] };

async function newOrg(name: string) {
  return (await t.db.query<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [name])).rows[0].id;
}
async function member(org: string, role: "member" | "admin" = "member", addr = email()) {
  const id = await t.addUser(addr);
  await t.db.query("insert into public.memberships (org_id, user_id, role) values ($1, $2, $3) on conflict (org_id, user_id) do update set role = $3", [org, id, role]);
  return { id, email: addr };
}
async function person(org: string, addr: string, o: { department?: string; user_id?: string | null; name?: string } = {}) {
  return (
    await t.db.query<{ id: string }>("insert into public.people (org_id, email, full_name, department, user_id) values ($1, $2, $3, $4, $5) returning id", [org, addr, o.name ?? "Ada Lovelace", o.department ?? "", o.user_id ?? null])
  ).rows[0].id;
}
async function template(org: string, o: { name?: string; departments?: string[]; lock?: unknown; active?: boolean } = {}) {
  return (
    await t.db.query<{ id: string }>("insert into public.brand_templates (org_id, name, doc_json, lock_json, departments, is_active) values ($1, $2, $3, $4, $5, $6) returning id", [
      org, o.name ?? "Default", JSON.stringify(DOC), JSON.stringify(o.lock ?? LOCK), o.departments ?? [], o.active ?? true,
    ])
  ).rows[0].id;
}
const submit = (userId: string, org: string, values: unknown) => t.as(userId, async () => (await t.db.query<{ id: string }>("select public.submit_signature($1, $2) as id", [org, JSON.stringify(values)])).rows[0].id);
const status = async (id: string) => (await t.db.query<{ status: string }>("select status from public.signature_versions where id = $1", [id])).rows[0].status;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.db.close();
});

describe("migration 0009 applies after every earlier migration", () => {
  it("creates the tables with row-level security on", async () => {
    const { rows } = await t.db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('people','brand_templates','signature_versions','people_imports','org_settings') and relkind = 'r'",
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
});

describe("people: isolation", () => {
  it("anonymous visitors get nothing", async () => {
    await expect(t.as(null, () => t.db.query("select * from public.people"))).rejects.toThrow(/permission denied/);
  });

  it("admins manage their own organization only", async () => {
    const a = await newOrg("A");
    const b = await newOrg("B");
    const adminA = await member(a, "admin");
    await person(a, email());
    const pb = await person(b, email());
    const visible = await t.as(adminA.id, async () => (await t.db.query<{ org_id: string }>("select org_id from public.people")).rows);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((r) => r.org_id === a)).toBe(true);
    // cannot insert into, update or delete from organization B
    await expect(t.as(adminA.id, () => t.db.query("insert into public.people (org_id, email, full_name) values ($1, 'x@example.com', 'X')", [b]))).rejects.toThrow(/row-level security/);
    const upd = await t.as(adminA.id, () => t.db.query("update public.people set title = 'hacked' where id = $1", [pb]));
    expect(upd.affectedRows).toBe(0);
    const del = await t.as(adminA.id, () => t.db.query("delete from public.people where id = $1", [pb]));
    expect(del.affectedRows).toBe(0);
  });

  it("a plain member sees only their own record and cannot write", async () => {
    const o = await newOrg("M");
    const m = await member(o);
    const mine = await person(o, m.email, { user_id: m.id });
    await person(o, email());
    const rows = await t.as(m.id, async () => (await t.db.query<{ id: string }>("select id from public.people")).rows);
    expect(rows.map((r) => r.id)).toEqual([mine]);
    await expect(t.as(m.id, () => t.db.query("insert into public.people (org_id, email, full_name) values ($1, 'z@example.com', 'Z')", [o]))).rejects.toThrow(/row-level security/);
    const upd = await t.as(m.id, () => t.db.query("update public.people set title = 'CEO' where id = $1", [mine]));
    expect(upd.affectedRows).toBe(0);
  });

  it("e-mail is unique per organization, case-insensitively, but may repeat across organizations", async () => {
    const a = await newOrg("U1");
    const b = await newOrg("U2");
    await person(a, "Dup@Example.com");
    await expect(person(a, "dup@example.COM")).rejects.toThrow(/duplicate key/);
    await person(b, "dup@example.com");
  });

  it("stores e-mail normalised, derives the full name, caps custom fields and checks the linked account", async () => {
    const o = await newOrg("N");
    const id = (await t.db.query<{ id: string }>("insert into public.people (org_id, email, full_name, first_name, last_name) values ($1, '  MiXed@Example.com ', '', 'Grace', 'Hopper') returning id", [o])).rows[0].id;
    const r = (await t.db.query<{ email: string; full_name: string }>("select email, full_name from public.people where id = $1", [id])).rows[0];
    expect(r).toEqual({ email: "mixed@example.com", full_name: "Grace Hopper" });
    const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"]));
    await expect(t.db.query("update public.people set custom = $2 where id = $1", [id, JSON.stringify(eleven)])).rejects.toThrow(/check constraint/);
    await expect(t.db.query("update public.people set custom = $2 where id = $1", [id, JSON.stringify({ "Bad Key": "v" })])).rejects.toThrow(/check constraint/);
    const outsider = await t.addUser(email());
    await t.db.query("delete from public.memberships where user_id = $1", [outsider]);
    await expect(t.db.query("update public.people set user_id = $2 where id = $1", [id, outsider])).rejects.toThrow(/not a member/);
  });

  it("a person claims their record by confirmed e-mail, once, and cannot claim someone else's", async () => {
    const o = await newOrg("C");
    const m = await member(o);
    const other = await member(o);
    const pid = await person(o, m.email);
    const got = await t.as(other.id, async () => (await t.db.query("select public.claim_my_person($1) as id", [o])).rows[0]);
    expect(got).toEqual({ id: null });
    const mine = await t.as(m.id, async () => (await t.db.query<{ id: string }>("select public.claim_my_person($1) as id", [o])).rows[0].id);
    expect(mine).toBe(pid);
    expect((await t.db.query<{ user_id: string }>("select user_id from public.people where id = $1", [pid])).rows[0].user_id).toBe(m.id);
    // a user who is not a member of that organization gets nothing
    const outsider = await t.addUser(email());
    await t.db.query("delete from public.memberships where user_id = $1", [outsider]);
    expect(await t.as(outsider, async () => (await t.db.query("select public.claim_my_person($1) as id", [o])).rows[0])).toEqual({ id: null });
  });
});

describe("brand templates: who sees what", () => {
  it("admins read and write their organization's; members see only the one that applies to them", async () => {
    const o = await newOrg("T");
    const admin = await member(o, "admin");
    const sales = await member(o);
    const other = await member(o);
    await person(o, sales.email, { user_id: sales.id, department: "Sales" });
    await person(o, other.email, { user_id: other.id, department: "Legal" });
    const everyone = await template(o, { name: "Everyone" });
    const salesT = await template(o, { name: "Sales only", departments: ["sales"] });
    await template(o, { name: "Inactive", active: false });
    const namesFor = (id: string) => t.as(id, async () => (await t.db.query<{ name: string }>("select name from public.brand_templates order by name")).rows.map((r) => r.name));
    expect(await namesFor(sales.id)).toEqual(["Sales only"]); // the department match beats "everyone"
    expect(await namesFor(other.id)).toEqual(["Everyone"]);
    expect((await namesFor(admin.id)).sort()).toEqual(["Everyone", "Inactive", "Sales only"]);
    expect(salesT).not.toBe(everyone);
    await expect(t.as(sales.id, () => t.db.query("insert into public.brand_templates (org_id, name, doc_json) values ($1, 'x', '{}')", [o]))).rejects.toThrow(/row-level security/);
    const upd = await t.as(sales.id, () => t.db.query("update public.brand_templates set name = 'pwned'"));
    expect(upd.affectedRows).toBe(0);
  });

  it("nothing leaks across organizations, even for admins", async () => {
    const a = await newOrg("TA");
    const b = await newOrg("TB");
    const adminA = await member(a, "admin");
    await template(b, { name: "Secret B" });
    const rows = await t.as(adminA.id, async () => (await t.db.query("select * from public.brand_templates where org_id = $1", [b])).rows);
    expect(rows).toEqual([]);
  });

  it("a member with no directory entry sees no template", async () => {
    const o = await newOrg("NT");
    const m = await member(o);
    await template(o);
    expect(await t.as(m.id, async () => (await t.db.query("select * from public.brand_templates")).rows)).toEqual([]);
  });
});

describe("submit_signature: brand lock enforced in the database", () => {
  async function setup(requireApproval = false) {
    const o = await newOrg("S");
    const admin = await member(o, "admin");
    const emp = await member(o);
    const pid = await person(o, emp.email, { user_id: emp.id });
    await template(o);
    if (requireApproval) await t.db.query("insert into public.org_settings (org_id, require_approval) values ($1, true)", [o]);
    return { o, admin, emp, pid };
  }

  it("accepts allowed fields and applies them immediately when approval is off", async () => {
    const { o, emp } = await setup();
    const id = await submit(emp.id, o, { "0.title": "Head of Things" });
    expect(await status(id)).toBe("approved");
    const row = (await t.db.query<{ values_json: unknown; template_snapshot: { lock: unknown } }>("select values_json, template_snapshot from public.signature_versions where id = $1", [id])).rows[0];
    expect(row.values_json).toEqual({ "0.title": "Head of Things" });
    expect(row.template_snapshot.lock).toEqual(LOCK);
  });

  it("refuses a locked field, however it is crafted", async () => {
    const { o, emp } = await setup();
    await expect(submit(emp.id, o, { "0.company": "Evil Corp" })).rejects.toThrow(/locked/);
    await expect(submit(emp.id, o, { "0.title": "ok", "1.src": "https://evil.example/x.png" })).rejects.toThrow(/locked/);
    await expect(submit(emp.id, o, { "theme.primary": "#000000" })).rejects.toThrow(/locked/);
    expect((await t.db.query("select * from public.signature_versions where person_id in (select id from public.people where org_id = $1)", [o])).rows).toHaveLength(0);
  });

  it("refuses non-string and oversized values", async () => {
    const { o, emp } = await setup();
    await expect(submit(emp.id, o, { "0.title": 5 })).rejects.toThrow(/not valid/);
    await expect(submit(emp.id, o, { "0.title": "x".repeat(1501) })).rejects.toThrow(/not valid/);
    await expect(submit(emp.id, o, [1])).rejects.toThrow(/object/);
  });

  it("refuses someone with no directory entry, an inactive person, and someone from another organization", async () => {
    const { o, emp, pid } = await setup();
    const stranger = await member(o);
    await expect(submit(stranger.id, o, { "0.title": "x" })).rejects.toThrow(/directory/);
    const otherOrg = await newOrg("S2");
    await expect(submit(emp.id, otherOrg, { "0.title": "x" })).rejects.toThrow(/directory/);
    await t.db.query("update public.people set status = 'inactive' where id = $1", [pid]);
    await expect(submit(emp.id, o, { "0.title": "x" })).rejects.toThrow(/directory/);
  });

  it("with approval on, the change waits, and a second one is refused while it waits", async () => {
    const { o, emp } = await setup(true);
    const id = await submit(emp.id, o, { "0.title": "Pending title" });
    expect(await status(id)).toBe("pending");
    await expect(submit(emp.id, o, { "0.title": "Another" })).rejects.toThrow(/waiting for review/);
  });

  it("admins' own changes are approved automatically even when approval is required", async () => {
    const { o, admin } = await setup(true);
    await person(o, admin.email, { user_id: admin.id });
    expect(await status(await submit(admin.id, o, { "0.title": "Boss" }))).toBe("approved");
  });
});

describe("review_signature and the append-only history", () => {
  async function pending() {
    const o = await newOrg("R");
    const admin = await member(o, "admin");
    const emp = await member(o);
    await person(o, emp.email, { user_id: emp.id });
    await template(o);
    await t.db.query("insert into public.org_settings (org_id, require_approval) values ($1, true)", [o]);
    const id = await submit(emp.id, o, { "0.title": "New" });
    return { o, admin, emp, id };
  }
  const review = (user: string, id: string, ok: boolean, note = "") => t.as(user, () => t.db.query("select public.review_signature($1, $2, $3)", [id, ok, note]));

  it("an admin approves; reviewer and time are recorded; a decided item cannot be decided again", async () => {
    const { admin, id } = await pending();
    await review(admin.id, id, true, "looks good");
    const r = (await t.db.query<{ status: string; reviewed_by: string; reviewed_at: string; review_note: string }>("select * from public.signature_versions where id = $1", [id])).rows[0];
    expect(r.status).toBe("approved");
    expect(r.reviewed_by).toBe(admin.id);
    expect(r.reviewed_at).toBeTruthy();
    expect(r.review_note).toBe("looks good");
    await expect(review(admin.id, id, false, "changed my mind")).rejects.toThrow(/already been reviewed/);
  });

  it("rejection needs a reason and keeps it", async () => {
    const { admin, id } = await pending();
    await expect(review(admin.id, id, false, "   ")).rejects.toThrow(/reason/);
    await review(admin.id, id, false, "Use the full title");
    const r = (await t.db.query<{ status: string; review_note: string }>("select status, review_note from public.signature_versions where id = $1", [id])).rows[0];
    expect(r).toEqual({ status: "rejected", review_note: "Use the full title" });
  });

  it("members, other organizations' admins and the submitter cannot review", async () => {
    const { emp, id } = await pending();
    await expect(review(emp.id, id, true)).rejects.toThrow(/permission/);
    const otherOrg = await newOrg("R2");
    const foreignAdmin = await member(otherOrg, "admin");
    await expect(review(foreignAdmin.id, id, true)).rejects.toThrow(/permission/);
    expect(await status(id)).toBe("pending");
  });

  it("an admin cannot review their own submission", async () => {
    const o = await newOrg("R3");
    const admin = await member(o, "admin");
    const other = await member(o, "admin");
    await person(o, admin.email, { user_id: admin.id });
    await template(o);
    // force a pending version submitted by the admin (as if approval had been demanded)
    await t.db.query("insert into public.org_settings (org_id, require_approval) values ($1, true)", [o]);
    const pid = (await t.db.query<{ id: string }>("select id from public.people where user_id = $1", [admin.id])).rows[0].id;
    const vid = (
      await t.db.query<{ id: string }>("insert into public.signature_versions (org_id, person_id, template_snapshot, version_no, submitted_by) values ($1, $2, '{}', 1, $3) returning id", [o, pid, admin.id])
    ).rows[0].id;
    await expect(review(admin.id, vid, true)).rejects.toThrow(/own submission/);
    await review(other.id, vid, true);
    expect(await status(vid)).toBe("approved");
  });

  it("history cannot be edited, re-reviewed, deleted or written directly by users", async () => {
    const { admin, emp, id } = await pending();
    await review(admin.id, id, true);
    await expect(t.db.query("update public.signature_versions set values_json = '{}' where id = $1", [id])).rejects.toThrow(/cannot be edited/);
    await expect(t.db.query("update public.signature_versions set status = 'pending' where id = $1", [id])).rejects.toThrow(/cannot become/);
    await expect(t.db.query("update public.signature_versions set review_note = 'x' where id = $1", [id])).rejects.toThrow(/cannot be changed/);
    for (const who of [admin.id, emp.id]) {
      await expect(t.as(who, () => t.db.query("update public.signature_versions set status = 'approved'"))).rejects.toThrow(/permission denied/);
      await expect(t.as(who, () => t.db.query("delete from public.signature_versions"))).rejects.toThrow(/permission denied/);
      await expect(t.as(who, () => t.db.query("insert into public.signature_versions (org_id, person_id, template_snapshot, version_no, status, reviewed_at) values (gen_random_uuid(), gen_random_uuid(), '{}', 1, 'approved', now())"))).rejects.toThrow(/permission denied/);
    }
  });

  it("an employee reads their own history only; an admin reads the organization's; version numbers count up", async () => {
    const { o, admin, emp, id } = await pending();
    await review(admin.id, id, true);
    const second = await submit(emp.id, o, { "0.title": "Newer" });
    const mine = await t.as(emp.id, async () => (await t.db.query<{ version_no: number }>("select version_no from public.signature_versions order by version_no")).rows);
    expect(mine.map((r) => r.version_no)).toEqual([1, 2]);
    const nosy = await member(o);
    await person(o, nosy.email, { user_id: nosy.id });
    expect(await t.as(nosy.id, async () => (await t.db.query("select * from public.signature_versions")).rows)).toEqual([]);
    expect((await t.as(admin.id, async () => (await t.db.query("select id from public.signature_versions")).rows)).length).toBe(2);
    expect(second).toBeTruthy();
  });
});

describe("import_people", () => {
  const imp = (user: string, org: string, rows: unknown[], source = "csv") => t.as(user, async () => (await t.db.query<{ r: { created: number; updated: number } }>("select public.import_people($1, $2, $3, 'people.csv', 1) as r", [org, JSON.stringify(rows), source])).rows[0].r);

  it("creates then updates by e-mail, keeps blanks, merges custom fields, records history, and is admin-only", async () => {
    const o = await newOrg("I");
    const admin = await member(o, "admin");
    const emp = await member(o);
    const first = await imp(admin.id, o, [
      { email: "A@x.com", full_name: "Ann", title: "Eng", custom: { badge: "7" } },
      { email: "b@x.com", full_name: "Bob" },
    ]);
    expect(first).toMatchObject({ created: 2, updated: 0 });
    const second = await imp(admin.id, o, [{ email: "a@X.com", full_name: "Ann Lee", title: "", custom: { desk: "9" } }, { email: "c@x.com", full_name: "Cy" }]);
    expect(second).toMatchObject({ created: 1, updated: 1 });
    const ann = (await t.db.query<{ full_name: string; title: string; custom: unknown; source: string }>("select * from public.people where org_id = $1 and email = 'a@x.com'", [o])).rows[0];
    expect(ann).toMatchObject({ full_name: "Ann Lee", title: "Eng", custom: { badge: "7", desk: "9" }, source: "csv" });
    expect((await t.db.query("select * from public.people_imports where org_id = $1", [o])).rows).toHaveLength(2);
    await expect(imp(emp.id, o, [{ email: "d@x.com", full_name: "D" }])).rejects.toThrow(/permission/);
    const other = await newOrg("I2");
    await expect(imp(admin.id, other, [{ email: "d@x.com", full_name: "D" }])).rejects.toThrow(/permission/);
  });

  it("is all-or-nothing: one bad row rolls the whole import back", async () => {
    const o = await newOrg("I3");
    const admin = await member(o, "admin");
    await expect(imp(admin.id, o, [{ email: "ok@x.com", full_name: "Fine" }, { email: "not-an-email", full_name: "Bad" }])).rejects.toThrow();
    expect((await t.db.query("select * from public.people where org_id = $1", [o])).rows).toHaveLength(0);
    expect((await t.db.query("select * from public.people_imports where org_id = $1", [o])).rows).toHaveLength(0);
  });

  it("refuses an unknown source and more than 5000 rows", async () => {
    const o = await newOrg("I4");
    const admin = await member(o, "admin");
    await expect(imp(admin.id, o, [], "hacker")).rejects.toThrow(/source/);
    await expect(imp(admin.id, o, Array.from({ length: 5001 }, (_, i) => ({ email: `p${i}@x.com`, full_name: "P" })))).rejects.toThrow(/5000/);
  });
});

describe("organization-scoped signatures", () => {
  const insertSig = (owner: string, org: string | null) => t.as(owner, async () => (await t.db.query<{ id: string }>("insert into public.signatures (owner_id, name, template_id, doc_json, org_id) values ($1, 'S', 'classic', '{}', $2) returning id", [owner, org])).rows[0].id);

  it("org admins read tagged signatures but cannot change or delete them; untagged ones stay private", async () => {
    const o = await newOrg("G");
    const admin = await member(o, "admin");
    const emp = await member(o);
    const tagged = await insertSig(emp.id, o);
    const untagged = await insertSig(emp.id, null);
    const seen = await t.as(admin.id, async () => (await t.db.query<{ id: string }>("select id from public.signatures")).rows.map((r) => r.id));
    expect(seen).toContain(tagged);
    expect(seen).not.toContain(untagged);
    expect((await t.as(admin.id, () => t.db.query("update public.signatures set name = 'x' where id = $1", [tagged]))).affectedRows).toBe(0);
    expect((await t.as(admin.id, () => t.db.query("delete from public.signatures where id = $1", [tagged]))).affectedRows).toBe(0);
    // the owner still has everything
    expect((await t.as(emp.id, () => t.db.query("update public.signatures set name = 'mine' where id = $1", [tagged]))).affectedRows).toBe(1);
  });

  it("other organizations' admins and other members read nothing; tagging an organization you are not in is refused", async () => {
    const o = await newOrg("G2");
    const emp = await member(o);
    const foreignOrg = await newOrg("G3");
    const foreignAdmin = await member(foreignOrg, "admin");
    const peer = await member(o);
    const tagged = await insertSig(emp.id, o);
    expect(await t.as(foreignAdmin.id, async () => (await t.db.query("select * from public.signatures where id = $1", [tagged])).rows)).toEqual([]);
    expect(await t.as(peer.id, async () => (await t.db.query("select * from public.signatures where id = $1", [tagged])).rows)).toEqual([]);
    await expect(insertSig(emp.id, foreignOrg)).rejects.toThrow(/row-level security/);
    const own = await insertSig(emp.id, null);
    await expect(t.as(emp.id, () => t.db.query("update public.signatures set org_id = $2 where id = $1", [own, foreignOrg]))).rejects.toThrow(/row-level security/);
  });
});
