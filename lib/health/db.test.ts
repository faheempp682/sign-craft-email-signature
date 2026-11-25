import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/authz/db-harness";

/** Migration 0012 in a real Postgres (PGlite): isolation, who can write, the finding state machine, candidates, alerts claimed once. */

let t: TestDb;
let n = 0;
const email = () => `h${++n}@example.com`;
const H = (c: string) => c.repeat(64);

async function newOrg() {
  return (await t.db.query<{ id: string }>("insert into public.organizations (name) values ($1) returning id", ["Org" + ++n])).rows[0].id;
}
async function admin(org: string) {
  const id = await t.addUser(email());
  await t.db.query("insert into public.memberships (org_id, user_id, role) values ($1, $2, 'admin') on conflict (org_id, user_id) do update set role = 'admin'", [org, id]);
  return id;
}
async function member(org: string) {
  const id = await t.addUser(email());
  await t.db.query("insert into public.memberships (org_id, user_id, role) values ($1, $2, 'member') on conflict (org_id, user_id) do update set role = 'member'", [org, id]);
  return id;
}
async function person(org: string, status = "active") {
  return (await t.db.query<{ id: string }>("insert into public.people (org_id, email, full_name, status) values ($1, $2, 'Ada', $3) returning id", [org, email(), status])).rows[0].id;
}

/** A finished Gmail deployment (kind deploy) with each person's item done. Returns the item ids by person. */
async function deployDone(org: string, adm: string, people: string[], hash = H("b")) {
  const items = people.map((p) => ({ person_id: p, action: "set", status: "pending", expect_hash: H("a"), new_hash: hash, previous_hash: H("a") }));
  const dep = await t.as(adm, async () => (await t.db.query<{ id: string }>("select public.create_deployment($1, 'gmail', $2, $3) as id", [org, "fp-" + ++n + "-xxxx", JSON.stringify(items)])).rows[0].id);
  const claimed = await t.as(adm, async () => (await t.db.query<{ id: string; person_id: string }>("select * from public.claim_deployment_items($1, 50)", [dep])).rows);
  for (const c of claimed) {
    await t.as(adm, () => t.db.query("select public.record_previous_signature($1, 'old', false)", [c.id]));
    await t.as(adm, () => t.db.query("select public.finish_deployment_item($1, 'done', '', '')", [c.id]));
  }
  return { dep, items: new Map(claimed.map((c) => [c.person_id, c.id])) };
}

const res = (person_id: string, item_id: string, status: string, o: Record<string, unknown> = {}) => ({
  person_id, item_id, status, baseline_hash: H("c"), baseline_fp: H("d"), baseline_verified: true, reformatted: false, reason: "", live_hash: H("e"), live_fp: H("f"), expected_fp: H("d"), detail: "x", ...o,
});
const cands = (org: string, after: string | null = null) => t.db.query<{ person_id: string; baseline_hash: string | null }>("select * from public.health_candidates_service($1, $2, 100)", [org, after]).then((r) => r.rows);
const startRun = async (org: string) => (await t.db.query<{ id: string }>("select * from public.health_start_run_service($1)", [org])).rows[0].id;
const record = (run: string, results: unknown[], cursor: string | null = null) => t.db.query<{ r: number }>("select public.health_record_service($1, $2, $3) as r", [run, JSON.stringify(results), cursor]).then((r) => r.rows[0].r);
const finish = (run: string, status = "completed", capped = false, cursor: string | null = null) => t.db.query("select * from public.health_finish_service($1, $2, $3, $4, '')", [run, status, capped, cursor]);
const findings = async (org: string) => (await t.db.query<Record<string, unknown>>("select * from public.health_findings where org_id = $1 order by opened_at", [org])).rows;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.db.close();
});

describe("candidates: who is monitored", () => {
  it("is only people whose latest Gmail item is done, active, and not rolled back", async () => {
    const org = await newOrg();
    const adm = await admin(org);
    const [a, b, c] = [await person(org), await person(org), await person(org, "inactive")];
    const never = await person(org);
    const { dep, items } = await deployDone(org, adm, [a, b, c]);
    expect(items.size).toBe(3);
    const got = (await cands(org)).map((x) => x.person_id).sort();
    expect(got).toEqual([a, b].sort());
    expect(got).not.toContain(never);

    // roll the deployment back: b is no longer monitored (the latest item is a restore)
    await t.as(adm, () => t.db.query("select public.create_rollback($1, $2)", [dep, 3]));
    const rb = (await t.db.query<{ id: string }>("select id from public.deployments where rollback_of = $1", [dep])).rows[0].id;
    const claimed = await t.as(adm, async () => (await t.db.query<{ id: string; person_id: string }>("select * from public.claim_deployment_items($1, 50)", [rb])).rows);
    for (const x of claimed.filter((x) => x.person_id === b)) {
      await t.as(adm, () => t.db.query("select public.record_previous_signature($1, 'x', false)", [x.id]));
      await t.as(adm, () => t.db.query("select public.finish_deployment_item($1, 'done', '', '')", [x.id]));
    }
    const after = (await cands(org)).map((x) => x.person_id);
    expect(after).not.toContain(b);
    expect(after).toContain(a);
  });

  it("does not return another organization's people", async () => {
    const o1 = await newOrg();
    const o2 = await newOrg();
    const a1 = await admin(o1);
    const p = await person(o1);
    await deployDone(o1, a1, [p]);
    expect(await cands(o2)).toHaveLength(0);
  });

  it("returns the stored baseline only while it belongs to the same deployment item", async () => {
    const org = await newOrg();
    const adm = await admin(org);
    const p = await person(org);
    const d1 = await deployDone(org, adm, [p]);
    const run = await startRun(org);
    await record(run, [res(p, d1.items.get(p)!, "ok")]);
    expect((await cands(org))[0].baseline_hash).toBe(H("c"));
    await finish(run);
    await deployDone(org, adm, [p], H("9")); // a newer deployment: a fresh baseline is needed
    expect((await cands(org))[0].baseline_hash).toBeNull();
  });
});

describe("findings: one per person, automatic resolve, acknowledge", () => {
  it("opens one finding, does not repeat it, resolves when live matches again", async () => {
    const org = await newOrg();
    const adm = await admin(org);
    const p = await person(org);
    const { items } = await deployDone(org, adm, [p]);
    const it = items.get(p)!;
    const r1 = await startRun(org);
    expect(await record(r1, [res(p, it, "edited")])).toBe(1);
    expect(await record(r1, [res(p, it, "edited")])).toBe(0);
    expect(await findings(org)).toHaveLength(1);
    await finish(r1);

    const r2 = await startRun(org);
    expect(await record(r2, [res(p, it, "edited")])).toBe(0);
    await finish(r2);
    expect((await findings(org))[0].status).toBe("open");

    const r3 = await startRun(org);
    await record(r3, [res(p, it, "unreachable", { live_hash: null, live_fp: null })]);
    expect((await findings(org))[0].status).toBe("open"); // an outage never resolves or opens anything
    await record(r3, [res(p, it, "ok")]);
    const f = (await findings(org))[0];
    expect(f.status).toBe("resolved");
    expect(f.resolved_reason).toBe("live_matches");
    const run = (await t.db.query<{ resolved: number; unreachable: number }>("select * from public.health_runs where id = $1", [r3])).rows[0];
    expect(run.resolved).toBe(1);
    expect(run.unreachable).toBe(1);
    await finish(r3);

    // edited again after being resolved: a NEW finding
    const r4 = await startRun(org);
    expect(await record(r4, [res(p, it, "removed")])).toBe(1);
    expect(await findings(org)).toHaveLength(2);
  });

  it("an unreachable person never creates a finding", async () => {
    const org = await newOrg();
    const adm = await admin(org);
    const p = await person(org);
    const { items } = await deployDone(org, adm, [p]);
    const run = await startRun(org);
    expect(await record(run, [res(p, items.get(p)!, "unreachable", { live_hash: null, live_fp: null, reason: "Google is limiting requests." })])).toBe(0);
    expect(await findings(org)).toHaveLength(0);
    const hp = (await t.db.query<{ status: string; reason: string }>("select status, reason from public.health_people where person_id = $1", [p])).rows[0];
    expect(hp).toEqual({ status: "unreachable", reason: "Google is limiting requests." });
  });

  it("acknowledge needs a note, records who, only works on open, and a worse problem reopens it", async () => {
    const org = await newOrg();
    const adm = await admin(org);
    const p = await person(org);
    const { items } = await deployDone(org, adm, [p]);
    const it = items.get(p)!;
    const run = await startRun(org);
    await record(run, [res(p, it, "edited")]);
    const id = (await findings(org))[0].id as string;
    const ack = (note: string, who = adm) => t.as(who, () => t.db.query("select public.health_acknowledge($1, $2)", [id, note]));
    await expect(ack("   ")).rejects.toMatchObject({ code: "HM003" });
    await ack("Agreed with Sam: the legal footer is intended");
    const f = (await findings(org))[0];
    expect(f.status).toBe("acknowledged");
    expect(f.acknowledged_by).toBe(adm);
    expect(f.ack_note).toContain("legal footer");
    await expect(ack("again")).rejects.toMatchObject({ code: "HM004" });

    // same kind again: stays acknowledged and no new alert
    expect(await record(run, [res(p, it, "edited")])).toBe(0);
    expect((await findings(org))[0].status).toBe("acknowledged");
    // removed is worse than edited: open again and counted as new
    expect(await record(run, [res(p, it, "removed")])).toBe(1);
    const g = (await findings(org))[0];
    expect(g.status).toBe("open");
    expect(g.kind).toBe("removed");
    expect(g.acknowledged_by).toBeNull();
    expect(await findings(org)).toHaveLength(1);
  });

  it("the database itself refuses a second open finding for the same person", async () => {
    const org = await newOrg();
    const adm = await admin(org);
    const p = await person(org);
    const { items } = await deployDone(org, adm, [p]);
    const run = await startRun(org);
    await record(run, [res(p, items.get(p)!, "edited")]);
    await expect(t.db.query("insert into public.health_findings (org_id, person_id, email, kind) values ($1, $2, 'x@y.z', 'removed')", [org, p])).rejects.toMatchObject({ code: "23505" });
  });

  it("a resolved finding is final and findings cannot be re-pointed", async () => {
    const org = await newOrg();
    const adm = await admin(org);
    const p = await person(org);
    const { items } = await deployDone(org, adm, [p]);
    const run = await startRun(org);
    await record(run, [res(p, items.get(p)!, "edited")]);
    await record(run, [res(p, items.get(p)!, "ok")]);
    await expect(t.db.query("update public.health_findings set status = 'open' where org_id = $1", [org])).rejects.toMatchObject({ code: "HM004" });
    await expect(t.db.query("update public.health_findings set person_id = $2 where org_id = $1", [org, await person(org)])).rejects.toMatchObject({ code: "HM004" });
  });

  it("closes the finding of someone who is no longer monitored when a run finishes", async () => {
    const org = await newOrg();
    const adm = await admin(org);
    const [a, b] = [await person(org), await person(org)];
    const { items } = await deployDone(org, adm, [a, b]);
    const run = await startRun(org);
    await record(run, [res(a, items.get(a)!, "edited"), res(b, items.get(b)!, "edited")]);
    await t.db.query("update public.people set status = 'inactive' where id = $1", [b]);
    await finish(run);
    const byPerson = Object.fromEntries((await findings(org)).map((f) => [f.person_id as string, f]));
    expect(byPerson[a].status).toBe("open");
    expect(byPerson[b].status).toBe("resolved");
    expect(byPerson[b].resolved_reason).toBe("not_monitored");
  });
});

describe("runs", () => {
  it("one running run per organization: starting again resumes it", async () => {
    const org = await newOrg();
    const a = await startRun(org);
    expect(await startRun(org)).toBe(a);
    await finish(a);
    expect(await startRun(org)).not.toBe(a);
  });

  it("a capped run saves where the next one continues, a full pass clears it", async () => {
    const org = await newOrg();
    const adm = await admin(org);
    const [p1, p2] = [await person(org), await person(org)];
    await deployDone(org, adm, [p1, p2]);
    const [first] = (await cands(org)).map((x) => x.person_id);
    const r1 = await startRun(org);
    await finish(r1, "completed", true, first);
    const r2 = (await t.db.query<{ id: string; cursor: string }>("select * from public.health_start_run_service($1)", [org])).rows[0];
    expect(r2.cursor).toBe(first);
    await finish(r2.id, "completed", false, null);
    expect((await t.db.query<{ rotate_cursor: string | null }>("select rotate_cursor from public.health_settings where org_id = $1", [org])).rows[0].rotate_cursor).toBeNull();
  });

  it("hands out the alert claim exactly once, and only when there are new findings", async () => {
    const org = await newOrg();
    const adm = await admin(org);
    const p = await person(org);
    const { items } = await deployDone(org, adm, [p]);
    const none = await startRun(org);
    await finish(none);
    expect((await t.db.query<{ c: boolean }>("select public.health_claim_notification_service($1) as c", [none])).rows[0].c).toBe(false);
    const run = await startRun(org);
    await record(run, [res(p, items.get(p)!, "edited")]);
    expect((await t.db.query<{ c: boolean }>("select public.health_claim_notification_service($1) as c", [run])).rows[0].c).toBe(false); // still running
    await finish(run);
    expect((await t.db.query<{ c: boolean }>("select public.health_claim_notification_service($1) as c", [run])).rows[0].c).toBe(true);
    expect((await t.db.query<{ c: boolean }>("select public.health_claim_notification_service($1) as c", [run])).rows[0].c).toBe(false);
  });

  it("refuses a batch naming someone from another organization, or an item that is not theirs", async () => {
    const o1 = await newOrg();
    const o2 = await newOrg();
    const a1 = await admin(o1);
    const a2 = await admin(o2);
    const p1 = await person(o1);
    const p2 = await person(o2);
    const d1 = await deployDone(o1, a1, [p1]);
    const d2 = await deployDone(o2, a2, [p2]);
    const run = await startRun(o1);
    await expect(record(run, [res(p2, d2.items.get(p2)!, "edited")])).rejects.toMatchObject({ code: "HM003" });
    await expect(record(run, [res(p1, d2.items.get(p2)!, "edited")])).rejects.toMatchObject({ code: "HM003" });
    await expect(record(run, [res(p1, d1.items.get(p1)!, "weird")])).rejects.toMatchObject({ code: "HM003" });
    expect(await findings(o1)).toHaveLength(0);
  });
});

describe("access", () => {
  it("admins read their own organization's findings only; members and anonymous read nothing", async () => {
    const o1 = await newOrg();
    const o2 = await newOrg();
    const a1 = await admin(o1);
    const a2 = await admin(o2);
    const m1 = await member(o1);
    const p = await person(o1);
    const { items } = await deployDone(o1, a1, [p]);
    const run = await startRun(o1);
    await record(run, [res(p, items.get(p)!, "edited")]);
    const count = (who: string | null, table: string) => t.as(who, async () => Number((await t.db.query<{ c: string }>(`select count(*) as c from public.${table}`)).rows[0].c));
    expect(await count(a1, "health_findings")).toBe(1);
    expect(await count(a1, "health_runs")).toBe(1);
    expect(await count(a1, "health_people")).toBe(1);
    expect(await count(a2, "health_findings")).toBe(0);
    expect(await count(a2, "health_runs")).toBe(0);
    expect(await count(m1, "health_findings")).toBe(0);
    await expect(count(null, "health_findings")).rejects.toMatchObject({ code: "42501" });
  });

  it("browser roles have no write privilege and cannot use another organization's functions or the service entry points", async () => {
    const o1 = await newOrg();
    const o2 = await newOrg();
    const a1 = await admin(o1);
    const a2 = await admin(o2);
    const m1 = await member(o1);
    const p = await person(o1);
    const { items } = await deployDone(o1, a1, [p]);
    const run = await startRun(o1);
    await record(run, [res(p, items.get(p)!, "edited")]);
    const fid = (await findings(o1))[0].id as string;

    await expect(t.as(a1, () => t.db.query("insert into public.health_findings (org_id, person_id, email, kind) values ($1, $2, 'x@y.z', 'edited')", [o1, p]))).rejects.toMatchObject({ code: "42501" });
    await expect(t.as(a1, () => t.db.query("update public.health_findings set status = 'resolved', resolved_at = now() where id = $1", [fid]))).rejects.toMatchObject({ code: "42501" });
    await expect(t.as(a1, () => t.db.query("delete from public.health_findings"))).rejects.toMatchObject({ code: "42501" });
    await expect(t.as(a1, () => t.db.query("insert into public.health_settings (org_id, enabled) values ($1, true)", [o1]))).rejects.toMatchObject({ code: "42501" });
    await expect(t.as(a1, () => t.db.query("select public.health_candidates_service($1, null, 10)", [o1]))).rejects.toMatchObject({ code: "42501" });
    await expect(t.as(a1, () => t.db.query("select public.health_record_service($1, '[]', null)", [run]))).rejects.toMatchObject({ code: "42501" });
    await expect(t.as(a1, () => t.db.query("select public.health_record_impl($1, '[]', null)", [run]))).rejects.toMatchObject({ code: "42501" });
    // admin entry points check the caller's organization
    await expect(t.as(a2, () => t.db.query("select public.health_acknowledge($1, 'nope')", [fid]))).rejects.toMatchObject({ code: "HM006" });
    await expect(t.as(a2, () => t.db.query("select * from public.health_candidates($1, null, 10)", [o1]))).rejects.toMatchObject({ code: "HM006" });
    await expect(t.as(a2, () => t.db.query("select * from public.health_start_run($1)", [o1]))).rejects.toMatchObject({ code: "HM006" });
    await expect(t.as(a2, () => t.db.query("select public.health_record($1, '[]', null)", [run]))).rejects.toMatchObject({ code: "HM006" });
    await expect(t.as(a2, () => t.db.query("select public.health_save_settings($1, true, null, false, 100)", [o1]))).rejects.toMatchObject({ code: "HM006" });
    await expect(t.as(m1, () => t.db.query("select public.health_acknowledge($1, 'nope')", [fid]))).rejects.toMatchObject({ code: "HM006" });
    expect((await findings(o1))[0].status).toBe("open");
  });

  it("admin settings: validated, saved through the function only", async () => {
    const org = await newOrg();
    const adm = await admin(org);
    const save = (url: string | null, cap = 500) => t.as(adm, () => t.db.query("select public.health_save_settings($1, true, $2, true, $3)", [org, url, cap]));
    await expect(save("http://insecure.example.com/x")).rejects.toMatchObject({ code: "HM003" });
    await expect(save("https://hooks.example.com/x", 1001)).rejects.toMatchObject({ code: "HM003" });
    await save("https://hooks.example.com/x", 250);
    const s = await t.as(adm, async () => (await t.db.query<{ enabled: boolean; max_people: number; webhook_include_names: boolean }>("select * from public.health_settings where org_id = $1", [org])).rows[0]);
    expect(s).toMatchObject({ enabled: true, max_people: 250, webhook_include_names: true });
    await save(null);
    expect((await t.db.query<{ webhook_url: string | null }>("select webhook_url from public.health_settings where org_id = $1", [org])).rows[0].webhook_url).toBeNull();
  });

  it("the unattended list holds only organizations that enabled it", async () => {
    const o1 = await newOrg();
    const o2 = await newOrg();
    const a1 = await admin(o1);
    await admin(o2);
    await t.as(a1, () => t.db.query("select public.health_save_settings($1, true, null, false, 100)", [o1]));
    const ids = (await t.db.query<{ id: string }>("select public.health_enabled_orgs_service() as id")).rows.map((r) => r.id);
    expect(ids).toContain(o1);
    expect(ids).not.toContain(o2);
  });
});
