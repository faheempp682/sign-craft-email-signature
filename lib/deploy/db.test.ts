import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/authz/db-harness";

/** Migration 0010 in a real Postgres (PGlite): isolation, the deployment state machine, the backup, rollback, rules. */

let t: TestDb;
let n = 0;
const email = () => `d${++n}@example.com`;
const H = (c: string) => c.repeat(64);

const DOC = { version: 1, template_id: "classic", blocks: [{ type: "identity", name: "X" }] };

async function newOrg(name: string) {
  return (await t.db.query<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [name])).rows[0].id;
}
async function member(org: string, role: "member" | "admin" = "admin") {
  const id = await t.addUser(email());
  await t.db.query("insert into public.memberships (org_id, user_id, role) values ($1, $2, $3) on conflict (org_id, user_id) do update set role = $3", [org, id, role]);
  return id;
}
async function person(org: string, name = "Ada") {
  return (await t.db.query<{ id: string }>("insert into public.people (org_id, email, full_name) values ($1, $2, $3) returning id", [org, email(), name])).rows[0].id;
}
async function template(org: string) {
  return (await t.db.query<{ id: string }>("insert into public.brand_templates (org_id, name, doc_json) values ($1, 'T', $2) returning id", [org, JSON.stringify(DOC)])).rows[0].id;
}
async function approvedVersion(org: string, personId: string, tpl: string) {
  return (
    await t.db.query<{ id: string }>(
      "insert into public.signature_versions (org_id, person_id, template_id, template_snapshot, version_no, status, reviewed_at) values ($1, $2, $3, '{}', 1, 'approved', now()) returning id",
      [org, personId, tpl],
    )
  ).rows[0].id;
}
const item = (person_id: string, o: Record<string, unknown> = {}) => ({ person_id, action: "replace", status: "pending", expect_hash: H("a"), new_hash: H("b"), previous_hash: H("a"), ...o });
const create = (admin: string, org: string, items: unknown[], fp = "fingerprint-1") =>
  t.as(admin, async () => (await t.db.query<{ id: string }>("select public.create_deployment($1, 'gmail', $2, $3) as id", [org, fp, JSON.stringify(items)])).rows[0].id);
const claim = (admin: string, dep: string, limit = 10) => t.as(admin, async () => (await t.db.query<{ id: string; status: string; email: string }>("select * from public.claim_deployment_items($1, $2)", [dep, limit])).rows);
const prev = (admin: string, id: string, sig: string, trunc = false) => t.as(admin, () => t.db.query("select public.record_previous_signature($1, $2, $3)", [id, sig, trunc]));
const finish = (admin: string, id: string, status: string, code = "", msg = "") => t.as(admin, () => t.db.query("select public.finish_deployment_item($1, $2, $3, $4)", [id, status, code, msg]));
const dep = async (id: string) => (await t.db.query<Record<string, unknown>>("select * from public.deployments where id = $1", [id])).rows[0];
const items = async (id: string) => (await t.db.query<Record<string, unknown>>("select * from public.deployment_items where deployment_id = $1 order by email", [id])).rows;

/** An org with an admin, `count` people, one template and a created deployment of all of them. */
async function setup(count = 3) {
  const org = await newOrg("Org" + ++n);
  const admin = await member(org);
  const people: string[] = [];
  for (let i = 0; i < count; i++) people.push(await person(org, `P${i}`));
  const d = await create(admin, org, people.map((p) => item(p)));
  return { org, admin, people, d };
}

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.db.close();
});

describe("migration 0010", () => {
  it("applies after 0009 with row-level security on every table", async () => {
    const { rows } = await t.db.query<{ relname: string; relrowsecurity: boolean }>("select relname, relrowsecurity from pg_class where relname in ('signature_rules','deployments','deployment_items') and relkind = 'r'");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
});

describe("isolation", () => {
  it("anonymous visitors, members and other organizations' admins see nothing; browsers cannot write the tables", async () => {
    const { org, admin, d } = await setup(2);
    const other = await member(await newOrg("Other"));
    const plain = await member(org, "member");
    await expect(t.as(null, () => t.db.query("select * from public.deployments"))).rejects.toThrow(/permission denied/);
    expect((await t.as(admin, () => t.db.query("select * from public.deployments where id = $1", [d]))).rows).toHaveLength(1);
    expect((await t.as(admin, () => t.db.query("select * from public.deployment_items where deployment_id = $1", [d]))).rows).toHaveLength(2);
    for (const u of [other, plain]) {
      expect((await t.as(u, () => t.db.query("select * from public.deployments"))).rows).toHaveLength(0);
      expect((await t.as(u, () => t.db.query("select * from public.deployment_items"))).rows).toHaveLength(0);
    }
    await expect(t.as(admin, () => t.db.query("insert into public.deployments (org_id, target, fingerprint) values ($1, 'gmail', 'abcdefgh')", [org]))).rejects.toThrow(/permission denied/);
    await expect(t.as(admin, () => t.db.query("update public.deployment_items set status = 'done' where deployment_id = $1", [d]))).rejects.toThrow(/permission denied/);
    await expect(t.as(admin, () => t.db.query("delete from public.deployments where id = $1", [d]))).rejects.toThrow(/permission denied/);
  });

  it("another organization's admin cannot use the functions on this deployment", async () => {
    const { d } = await setup(1);
    const other = await member(await newOrg("Other2"));
    await expect(claim(other, d)).rejects.toThrow(/permission/);
    await expect(t.as(other, () => t.db.query("select public.cancel_deployment($1)", [d]))).rejects.toThrow(/permission/);
    await expect(t.as(other, () => t.db.query("select public.create_rollback($1, 1)", [d]))).rejects.toThrow(/permission/);
  });
});

describe("create_deployment", () => {
  it("copies e-mail and name from the directory and refuses non-admins", async () => {
    const org = await newOrg("c1");
    const admin = await member(org);
    const plain = await member(org, "member");
    const p = await person(org, "Grace Hopper");
    await expect(create(plain, org, [item(p)])).rejects.toThrow(/permission/);
    const d = await create(admin, org, [item(p)]);
    const [row] = await items(d);
    expect(row.person_name).toBe("Grace Hopper");
    expect(String(row.email)).toMatch(/@example.com$/);
    expect(await dep(d)).toMatchObject({ status: "running", total: 1, pending: 1, target: "gmail", kind: "deploy" });
  });

  it("refuses someone from another organization, a duplicate, an unapproved version and bad items", async () => {
    const org = await newOrg("c2");
    const admin = await member(org);
    const mine = await person(org);
    const foreign = await person(await newOrg("c2b"));
    await expect(create(admin, org, [item(mine), item(foreign)])).rejects.toThrow(/not in this organization/);
    await expect(create(admin, org, [item(mine), item(mine)])).rejects.toThrow(/twice|not allowed|not in this/);
    await expect(create(admin, org, [item(mine, { version_id: "00000000-0000-4000-8000-000000000000" })])).rejects.toThrow(/approved/);
    await expect(create(admin, org, [item(mine, { status: "done" })])).rejects.toThrow(/not allowed/);
    await expect(create(admin, org, [item(mine, { new_hash: null })])).rejects.toThrow(/not allowed/);
    await expect(create(admin, org, [])).rejects.toThrow(/between 1 and 2000/);
    expect((await t.db.query("select 1 from public.deployments where org_id = $1", [org])).rows).toHaveLength(0);
  });

  it("accepts an approved version of that person and records skipped items as finished", async () => {
    const org = await newOrg("c3");
    const admin = await member(org);
    const p = await person(org);
    const p2 = await person(org);
    const v = await approvedVersion(org, p, await template(org));
    const d = await create(admin, org, [item(p, { version_id: v }), item(p2, { action: "skip", status: "skipped", error_code: "no_version", error: "No approved signature." })]);
    expect(await dep(d)).toMatchObject({ total: 2, pending: 1, skipped: 1 });
    await expect(create(admin, org, [item(p2, { version_id: v })], "fingerprint-2")).rejects.toThrow(/approved signature of that person/);
  });

  it("allows one running deployment per organization and target", async () => {
    const { org, admin, d } = await setup(1);
    const p = await person(org);
    await expect(create(admin, org, [item(p)], "fingerprint-2")).rejects.toThrow(/duplicate|unique/);
    await t.as(admin, () => t.db.query("select public.cancel_deployment($1)", [d]));
    await expect(create(admin, org, [item(p)], "fingerprint-3")).resolves.toBeTruthy();
  });
});

describe("running items", () => {
  it("claims each item once and counts progress", async () => {
    const { admin, d } = await setup(3);
    const a = await claim(admin, d, 2);
    expect(a).toHaveLength(2);
    const b = await claim(admin, d, 10);
    expect(b).toHaveLength(1);
    expect(new Set([...a, ...b].map((x) => x.id)).size).toBe(3);
    expect(await claim(admin, d)).toHaveLength(0);
  });

  it("will not mark an item done without a saved backup, and the backup never changes", async () => {
    const { admin, d } = await setup(1);
    const [it1] = await claim(admin, d);
    await expect(finish(admin, it1.id, "done")).rejects.toThrow(/check|constraint/i);
    await prev(admin, it1.id, "<p>old</p>");
    await prev(admin, it1.id, "<p>SOMETHING ELSE</p>"); // a retry must not replace the first copy
    await finish(admin, it1.id, "done");
    const [row] = await items(d);
    expect(row).toMatchObject({ status: "done", previous_signature: "<p>old</p>", previous_known: true, previous_truncated: false });
    expect(await dep(d)).toMatchObject({ status: "succeeded", done: 1, pending: 0 });
    await expect(t.db.query("update public.deployment_items set previous_signature = 'x' where id = $1", [it1.id])).rejects.toThrow(/backup|final/);
  });

  it("an empty previous signature is a valid backup; an over-long one is flagged truncated", async () => {
    const { admin, d } = await setup(2);
    const [a, b] = await claim(admin, d);
    await prev(admin, a.id, "");
    await prev(admin, b.id, "x".repeat(10_050));
    await finish(admin, a.id, "done");
    await finish(admin, b.id, "done");
    const rows = await items(d);
    expect(rows.map((r) => [r.previous_known, r.previous_truncated, String(r.previous_signature).length]).sort()).toEqual([
      [true, false, 0],
      [true, true, 10_000],
    ]);
  });

  it("done and skipped items are final, immutable columns cannot change, wrong states are refused", async () => {
    const { admin, d } = await setup(2);
    const [a] = await claim(admin, d, 1);
    await expect(t.db.query("update public.deployment_items set new_hash = $2 where id = $1", [a.id, H("c")])).rejects.toThrow(/cannot be edited/);
    await expect(t.db.query("update public.deployment_items set email = 'x@y.zz' where id = $1", [a.id])).rejects.toThrow(/cannot be edited/);
    await finish(admin, a.id, "skipped", "changed", "changed");
    await expect(finish(admin, a.id, "done")).rejects.toThrow(/not being worked on/);
    await expect(t.db.query("update public.deployment_items set status = 'pending' where id = $1", [a.id])).rejects.toThrow(/final/);
    const pending = (await items(d)).find((r) => r.status === "pending")!;
    await expect(finish(admin, String(pending.id), "done")).rejects.toThrow(/not being worked on/);
    await expect(t.db.query("update public.deployment_items set status = 'done' where id = $1", [pending.id])).rejects.toThrow(/cannot become|check/);
  });

  it("a released item goes back in the queue without becoming a failure", async () => {
    const { admin, d } = await setup(1);
    const [a] = await claim(admin, d);
    await t.as(admin, () => t.db.query("select public.release_deployment_item($1, 'rate_limited')", [a.id]));
    const [row] = await items(d);
    expect(row).toMatchObject({ status: "pending", attempts: 1, error_code: "rate_limited" });
    expect(await claim(admin, d)).toHaveLength(1);
  });

  it("takes back an item stuck running for over 5 minutes (crash), but not a fresh one", async () => {
    const { admin, d } = await setup(1);
    const [a] = await claim(admin, d);
    expect(await claim(admin, d)).toHaveLength(0);
    await t.db.query("update public.deployment_items set started_at = now() - interval '6 minutes' where id = $1", [a.id]);
    const again = await claim(admin, d);
    expect(again).toHaveLength(1);
    expect((await items(d))[0].attempts).toBe(2);
  });
});

describe("failures, retry, cancel", () => {
  it("a failed run can be retried and only the failed items are touched", async () => {
    const { admin, d } = await setup(3);
    const [a, b, c] = await claim(admin, d);
    await prev(admin, a.id, "old-a");
    await finish(admin, a.id, "done");
    await finish(admin, b.id, "failed", "rate_limited", "Slow down");
    await finish(admin, c.id, "skipped", "changed", "changed");
    expect(await dep(d)).toMatchObject({ status: "partial", done: 1, failed: 1, skipped: 1, pending: 0 });
    const n1 = (await t.as(admin, () => t.db.query<{ r: number }>("select public.retry_failed_items($1) as r", [d]))).rows[0].r;
    expect(n1).toBe(1);
    expect(await dep(d)).toMatchObject({ status: "running", pending: 1 });
    const again = await claim(admin, d);
    expect(again.map((x) => x.id)).toEqual([b.id]);
    await prev(admin, b.id, "old-b");
    await finish(admin, b.id, "done");
    expect(await dep(d)).toMatchObject({ status: "succeeded", done: 2, failed: 0, skipped: 1 });
    await expect(t.as(admin, () => t.db.query("select public.retry_failed_items($1)", [d]))).rejects.toThrow(/nothing to retry/);
  });

  it("all failed gives status failed", async () => {
    const { admin, d } = await setup(1);
    const [a] = await claim(admin, d);
    await finish(admin, a.id, "failed", "no_mailbox", "x");
    expect((await dep(d)).status).toBe("failed");
  });

  it("cancel skips what has not started, lets the item in flight finish, and stops new claims", async () => {
    const { admin, d } = await setup(3);
    const [a] = await claim(admin, d, 1);
    await t.as(admin, () => t.db.query("select public.cancel_deployment($1)", [d]));
    expect((await dep(d)).status).toBe("running");
    expect(await claim(admin, d)).toHaveLength(0);
    await prev(admin, a.id, "old");
    await finish(admin, a.id, "done");
    expect(await dep(d)).toMatchObject({ status: "cancelled", done: 1, skipped: 2 });
    await expect(t.as(admin, () => t.db.query("select public.cancel_deployment($1)", [d]))).rejects.toThrow(/running/);
  });
});

describe("rollback", () => {
  async function deployed(count = 2) {
    const s = await setup(count);
    const its = await claim(s.admin, s.d);
    for (const [i, x] of its.entries()) {
      await prev(s.admin, x.id, `<p>old ${i}</p>`);
      await finish(s.admin, x.id, "done");
    }
    return s;
  }
  const rollback = (admin: string, d: string, expected: number) => t.as(admin, async () => (await t.db.query<{ id: string }>("select public.create_rollback($1, $2) as id", [d, expected])).rows[0].id);

  it("creates a rollback deployment that restores the saved signatures, only after a matching confirmation", async () => {
    const { admin, d } = await deployed(2);
    await expect(rollback(admin, d, 5)).rejects.toThrow(/now 2, not 5/);
    expect((await t.db.query("select 1 from public.deployments where rollback_of = $1", [d])).rows).toHaveLength(0);
    const r = await rollback(admin, d, 2);
    expect(await dep(r)).toMatchObject({ kind: "rollback", rollback_of: d, status: "running", total: 2, pending: 2 });
    const rows = await items(r);
    expect(rows.every((x) => x.action === "restore" && x.expect_hash === H("b") && x.new_hash === H("a"))).toBe(true);
    expect(rows.map((x) => x.new_signature).sort()).toEqual(["<p>old 0</p>", "<p>old 1</p>"]);
    await expect(rollback(admin, d, 2)).rejects.toThrow(/already rolled back/);
  });

  it("refuses while running, for nothing to restore, for a rollback, and for another organization", async () => {
    const run = await setup(1);
    await expect(rollback(run.admin, run.d, 0)).rejects.toThrow(/finish/);
    const [a] = await claim(run.admin, run.d);
    await finish(run.admin, a.id, "failed", "upstream", "x");
    await expect(rollback(run.admin, run.d, 0)).rejects.toThrow(/nothing to restore/);
    const ok = await deployed(1);
    const r = await rollback(ok.admin, ok.d, 1);
    await expect(rollback(ok.admin, r, 1)).rejects.toThrow(/Only a deployment/);
    const outsider = await member(await newOrg("Out"));
    await expect(rollback(outsider, ok.d, 1)).rejects.toThrow(/permission/);
  });

  it("a truncated backup is listed but never restored; people not changed are skipped", async () => {
    const s = await setup(3);
    const [a, b, c] = await claim(s.admin, s.d);
    await prev(s.admin, a.id, "<p>fine</p>");
    await finish(s.admin, a.id, "done");
    await prev(s.admin, b.id, "z".repeat(10_001));
    await finish(s.admin, b.id, "done");
    await finish(s.admin, c.id, "failed", "upstream", "x");
    const r = await rollback(s.admin, s.d, 1);
    const rows = await items(r);
    expect(rows).toHaveLength(3);
    expect(rows.filter((x) => x.status === "pending")).toHaveLength(1);
    expect(rows.map((x) => x.error_code).sort()).toEqual(["", "no_backup", "not_deployed"]);
    expect(await dep(r)).toMatchObject({ pending: 1, skipped: 2 });
  });

  it("a rollback can finish, and a cancelled rollback allows a new one", async () => {
    const { admin, d } = await deployed(1);
    const r = await rollback(admin, d, 1);
    const [x] = await claim(admin, r);
    await prev(admin, x.id, "<p>new</p>");
    await finish(admin, x.id, "done");
    expect((await dep(r)).status).toBe("succeeded");
    const s2 = await deployed(1);
    const r2 = await rollback(s2.admin, s2.d, 1);
    await t.as(s2.admin, () => t.db.query("select public.cancel_deployment($1)", [r2]));
    await expect(rollback(s2.admin, s2.d, 1)).resolves.toBeTruthy();
  });
});

describe("record_script", () => {
  it("records a generated Exchange script for admins only, and it never has items", async () => {
    const org = await newOrg("sc");
    const admin = await member(org);
    const plain = await member(org, "member");
    await expect(t.as(plain, () => t.db.query("select public.record_script($1, 'abcdefgh')", [org]))).rejects.toThrow(/permission/);
    const id = (await t.as(admin, () => t.db.query<{ id: string }>("select public.record_script($1, 'abcdefgh', 'note') as id", [org]))).rows[0].id;
    expect(await dep(id)).toMatchObject({ target: "exchange", kind: "script", status: "generated" });
    await expect(t.db.query("update public.deployments set status = 'running' where id = $1", [id])).rejects.toThrow(/cannot become|cannot be/);
  });
});

describe("signature_rules", () => {
  it("admins manage their own organization's rules only; the template must be in the same organization", async () => {
    const orgA = await newOrg("rA");
    const orgB = await newOrg("rB");
    const a = await member(orgA);
    const b = await member(orgB);
    const plain = await member(orgA, "member");
    const tplA = await template(orgA);
    const tplB = await template(orgB);
    const ins = (u: string, org: string, tpl: string) => t.as(u, () => t.db.query("insert into public.signature_rules (org_id, name, template_id, departments) values ($1, 'r', $2, '{Sales}') returning id", [org, tpl]));
    await expect(ins(a, orgA, tplA)).resolves.toBeTruthy();
    await expect(ins(a, orgA, tplB)).rejects.toThrow(/does not belong/);
    await expect(ins(b, orgA, tplA)).rejects.toThrow(/row-level security|does not belong/);
    await expect(ins(plain, orgA, tplA)).rejects.toThrow(/row-level security|does not belong/);
    expect((await t.as(a, () => t.db.query("select * from public.signature_rules"))).rows).toHaveLength(1);
    expect((await t.as(b, () => t.db.query("select * from public.signature_rules"))).rows).toHaveLength(0);
    expect((await t.as(plain, () => t.db.query("select * from public.signature_rules"))).rows).toHaveLength(0);
    // moving a rule to another organization's template is refused too
    const id = (await t.db.query<{ id: string }>("select id from public.signature_rules limit 1")).rows[0].id;
    await expect(t.as(a, () => t.db.query("update public.signature_rules set template_id = $2 where id = $1", [id, tplB]))).rejects.toThrow(/does not belong/);
    await expect(t.as(a, () => t.db.query("insert into public.signature_rules (org_id, name, template_id, priority) values ($1, 'r', $2, 5000)", [orgA, tplA]))).rejects.toThrow(/check/);
  });
});
