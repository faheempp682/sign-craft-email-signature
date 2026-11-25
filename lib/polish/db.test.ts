import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/authz/db-harness";
import { getPreset } from "@/lib/presets";
import { POLISH_STATUSES, TRANSITIONS, canTransition, type PolishStatus } from "./status";

/** These run the real migrations (including 0008) in Postgres (PGlite): the actual RLS policies, functions and trigger. */

let t: TestDb;
let n = 0;
const email = (name: string) => `${name}${++n}@example.com`;
const DOC = getPreset("classic")!.doc;
const POLISHED = getPreset("minimal")!.doc;

let requester: string, other: string, designer: string, designer2: string, admin: string;

const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await t.db.query<T>(sql, params)).rows;
const call = (uid: string, fn: string, ...args: unknown[]) =>
  t.as(uid, async () => (await t.db.query<{ r: Record<string, unknown> }>(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r);
const fails = async (p: Promise<unknown>, message: string) => {
  await expect(p).rejects.toThrow(message);
};

const saveSig = async (owner: string, name = "Work", doc = DOC) =>
  (await rows<{ id: string }>("insert into public.signatures (owner_id, name, template_id, doc_json) values ($1, $2, $3, $4) returning id", [owner, name, doc.template_id, JSON.stringify(doc)]))[0].id;
const ask = async (owner = requester, note = "make the banner stand out", origin = "ai") => {
  const sig = await saveSig(owner);
  const r = await call(owner, "polish_create", sig, note, origin);
  return { sig, id: r.id as string };
};
const statusOf = async (id: string) => (await rows<{ status: string }>("select status from public.polish_requests where id = $1", [id]))[0].status;
const visible = (uid: string, sql: string, params: unknown[] = []) => t.as(uid, async () => (await t.db.query(sql, params)).rows);

beforeAll(async () => {
  t = await createTestDb();
  other = await t.addUser(email("other"));
  designer = await t.addUser(email("designer"));
  designer2 = await t.addUser(email("designer"));
  admin = await t.addUser(email("admin"));
  await t.setRole(designer, "designer");
  await t.setRole(designer2, "designer");
  await t.setRole(admin, "admin");
}, 60_000);
// A fresh requester per test (a member who has the feature switched on by an admin, which is how the paid add-on will be granted).
beforeEach(async () => {
  requester = await t.addUser(email("requester"));
  await t.db.query("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('user', $1, 'designer_polish', true)", [requester]);
});
afterAll(async () => {
  await t.db.close();
});

describe("asking for polish", () => {
  it("is refused for a member who does not have the designer_polish feature", async () => {
    const sig = await saveSig(other);
    await fails(call(other, "polish_create", sig, "please", "manual"), "feature_disabled");
    expect(await rows("select 1 from public.polish_requests where requester_id = $1", [other])).toHaveLength(0);
  });

  it("is allowed for designers and admins by default and for a member with an override", async () => {
    for (const uid of [designer, admin]) {
      const sig = await saveSig(uid);
      expect((await call(uid, "polish_create", sig, "polish please", "manual")).status).toBe("requested");
    }
    const { id } = await ask();
    expect(await statusOf(id)).toBe("requested");
  });

  it("stores a snapshot of the document, the origin, and who asked, read from the saved row not from the caller", async () => {
    const sig = await saveSig(requester, "Sales", DOC);
    const r = await call(requester, "polish_create", sig, "  make the banner stand out  ", "ai");
    const [row] = await rows<{ original_doc: unknown; origin: string; requester_id: string; note: string; signature_name: string }>("select * from public.polish_requests where id = $1", [r.id]);
    expect(row.original_doc).toEqual(JSON.parse(JSON.stringify(DOC)));
    expect(row.origin).toBe("ai");
    expect(row.requester_id).toBe(requester);
    expect(row.note).toBe("make the banner stand out");
    expect(row.signature_name).toBe("Sales");
    // Editing the saved signature afterwards does not change the snapshot.
    await t.db.query("update public.signatures set doc_json = $2 where id = $1", [sig, JSON.stringify(POLISHED)]);
    expect((await rows<{ original_doc: { template_id: string } }>("select original_doc from public.polish_requests where id = $1", [r.id]))[0].original_doc.template_id).toBe(DOC.template_id);
  });

  it("cannot be used on someone else's signature, with a bad note or origin, or twice for the same signature", async () => {
    const theirs = await saveSig(other);
    await fails(call(requester, "polish_create", theirs, "mine now", "manual"), "not_found");
    const mine = await saveSig(requester);
    await fails(call(requester, "polish_create", mine, "   ", "manual"), "invalid");
    await fails(call(requester, "polish_create", mine, "x".repeat(1001), "manual"), "invalid");
    await fails(call(requester, "polish_create", mine, "ok", "robot"), "invalid");
    await call(requester, "polish_create", mine, "first", "manual");
    await fails(call(requester, "polish_create", mine, "second", "manual"), "already_open");
  });

  it("caps open requests per person", async () => {
    const u = await t.addUser(email("busy"));
    await t.db.query("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('user', $1, 'designer_polish', true)", [u]);
    for (let i = 0; i < 5; i++) {
      const sig = await saveSig(u, `S${i}`);
      await call(u, "polish_create", sig, "polish", "manual");
    }
    await fails(call(u, "polish_create", await saveSig(u, "S6"), "polish", "manual"), "too_many_open");
  });

  it("rejects anonymous callers", async () => {
    await t.db.exec("set role anon");
    await expect(t.db.query("select public.polish_create(gen_random_uuid(), 'x', 'ai')")).rejects.toThrow();
    await t.db.exec("reset role");
  });
});

describe("who can see what", () => {
  it("lets a requester see only their own requests", async () => {
    const { id } = await ask();
    expect((await visible(requester, "select id from public.polish_requests where id = $1", [id])).length).toBe(1);
    expect(await visible(other, "select id from public.polish_requests where id = $1", [id])).toHaveLength(0);
  });

  it("shows designers and admins the open queue, but not requests another designer holds", async () => {
    const { id } = await ask();
    for (const uid of [designer, designer2, admin]) expect(await visible(uid, "select id from public.polish_requests where id = $1", [id])).toHaveLength(1);
    await call(designer, "polish_claim", id);
    expect(await visible(designer, "select id from public.polish_requests where id = $1", [id])).toHaveLength(1);
    expect(await visible(designer2, "select id from public.polish_requests where id = $1", [id])).toHaveLength(0);
    expect(await visible(admin, "select id from public.polish_requests where id = $1", [id])).toHaveLength(0);
    expect(await visible(other, "select id from public.polish_requests where id = $1", [id])).toHaveLength(0);
  });

  it("does not show a plain member the queue", async () => {
    await ask();
    expect(await visible(other, "select id from public.polish_requests")).toHaveLength(0);
  });

  it("never gives a designer access to the requester's saved signatures", async () => {
    const { sig, id } = await ask();
    await call(designer, "polish_claim", id);
    expect(await visible(designer, "select id from public.signatures where id = $1", [sig])).toHaveLength(0);
    const r = await t.as(designer, () => t.db.query("update public.signatures set name = 'hijack' where id = $1 returning id", [sig]));
    expect(r.rows).toHaveLength(0);
  });

  it("keeps comments and events to the requester and the designer holding the request", async () => {
    const { id } = await ask();
    await call(designer, "polish_claim", id);
    await call(requester, "polish_comment", id, "the logo is too small");
    await call(designer, "polish_comment", id, "on it");
    const readers: [string, number][] = [[requester, 2], [designer, 2], [designer2, 0], [admin, 0], [other, 0]];
    for (const [uid, count] of readers) {
      expect(await visible(uid, "select 1 from public.polish_comments where request_id = $1", [id])).toHaveLength(count);
      expect((await visible(uid, "select 1 from public.polish_events where request_id = $1", [id])).length > 0).toBe(count > 0);
    }
  });

  it("stops a designer who has released a request from reading it or its comments", async () => {
    const { id } = await ask();
    await call(designer, "polish_claim", id);
    await call(designer, "polish_comment", id, "hello");
    await call(designer, "polish_release", id);
    expect(await visible(designer, "select 1 from public.polish_comments where request_id = $1", [id])).toHaveLength(0);
  });
});

describe("nobody can write the tables directly", () => {
  it("refuses insert, update and delete for requesters and designers", async () => {
    const { id } = await ask();
    await call(designer, "polish_claim", id);
    const attempts = [
      `insert into public.polish_requests (requester_id, signature_name, origin, note, original_doc) values ('${requester}', 'x', 'ai', 'x', '{}')`,
      `update public.polish_requests set note = 'edited' where id = '${id}'`,
      `update public.polish_requests set delivered_doc = '{"version":1}' where id = '${id}'`,
      `update public.polish_requests set status = 'accepted' where id = '${id}'`,
      `delete from public.polish_requests where id = '${id}'`,
      `insert into public.polish_comments (request_id, author_id, author_role, body) values ('${id}', '${requester}', 'requester', 'forged')`,
      `insert into public.polish_events (request_id, actor_id, action, to_status) values ('${id}', '${designer}', 'accepted', 'accepted')`,
    ];
    for (const uid of [requester, designer, admin]) {
      for (const sql of attempts) await expect(t.as(uid, () => t.db.query(sql))).rejects.toThrow(/permission denied/);
    }
    expect(await statusOf(id)).toBe("in_progress");
  });

  it("keeps comments and the audit trail append-only, even for the database owner", async () => {
    const { id } = await ask();
    await call(requester, "polish_comment", id, "hello");
    await expect(t.db.query("update public.polish_comments set body = 'changed' where request_id = $1", [id])).rejects.toThrow("append_only");
    await expect(t.db.query("delete from public.polish_events where request_id = $1", [id])).rejects.toThrow("append_only");
  });
});

describe("claiming", () => {
  it("lets exactly one designer hold a request", async () => {
    const { id } = await ask();
    const first = await call(designer, "polish_claim", id);
    expect(first.status).toBe("in_progress");
    await fails(call(designer2, "polish_claim", id), "not_available");
    await fails(call(designer, "polish_claim", id), "not_available");
    expect((await rows<{ designer_id: string }>("select designer_id from public.polish_requests where id = $1", [id]))[0].designer_id).toBe(designer);
    expect(await rows("select 1 from public.polish_events where request_id = $1 and action = 'claimed'", [id])).toHaveLength(1);
  });

  it("serialises two claims issued at the same moment: one wins, one is told it is taken", async () => {
    // PGlite has a single connection, so this checks the outcome of two back-to-back claims inside one transaction each.
    // The lock that makes it race-safe on real Postgres is `select ... for update` in polish_lock (see the migration).
    const { id } = await ask();
    const results = await Promise.allSettled([call(designer, "polish_claim", id), call(designer2, "polish_claim", id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("is refused for members", async () => {
    const { id } = await ask();
    await fails(call(requester, "polish_claim", id), "forbidden");
    await fails(call(other, "polish_claim", id), "forbidden");
    expect(await statusOf(id)).toBe("requested");
  });

  it("cannot claim a request that is not open or does not exist", async () => {
    const { id } = await ask();
    await call(requester, "polish_cancel", id);
    await fails(call(designer, "polish_claim", id), "not_available");
    await fails(call(designer, "polish_claim", "00000000-0000-4000-8000-000000000000"), "not_found");
  });

  it("can be undone by the holder or an admin, and then someone else can claim", async () => {
    const { id } = await ask();
    await call(designer, "polish_claim", id);
    await fails(call(designer2, "polish_release", id), "not_found");
    await fails(call(requester, "polish_release", id), "not_found");
    await call(designer, "polish_release", id);
    await call(designer2, "polish_claim", id);
    await call(admin, "polish_release", id);
    expect(await statusOf(id)).toBe("requested");
  });
});

describe("the full workflow", () => {
  const through = async (reason?: "accept-new" | "accept-replace") => {
    const { sig, id } = await ask();
    await call(designer, "polish_claim", id);
    await call(designer, "polish_deliver", id, JSON.stringify(POLISHED), "Bigger banner, tighter spacing");
    return { sig, id, reason };
  };

  it("accepts as a NEW signature without touching the original", async () => {
    const { sig, id } = await through();
    const before = (await rows<{ doc_json: unknown }>("select doc_json from public.signatures where id = $1", [sig]))[0].doc_json;
    const r = await call(requester, "polish_accept", id, "new", "Sales (polished)", false);
    expect(r.status).toBe("accepted");
    const created = (await rows<{ owner_id: string; name: string; template_id: string; doc_json: unknown }>("select * from public.signatures where id = $1", [r.signature_id]))[0];
    expect(created).toMatchObject({ owner_id: requester, name: "Sales (polished)", template_id: POLISHED.template_id });
    expect(created.doc_json).toEqual(JSON.parse(JSON.stringify(POLISHED)));
    expect((await rows<{ doc_json: unknown }>("select doc_json from public.signatures where id = $1", [sig]))[0].doc_json).toEqual(before);
  });

  it("names the new signature automatically when no name is given", async () => {
    const { id } = await through();
    const r = await call(requester, "polish_accept", id, "new", null, false);
    expect((await rows<{ name: string }>("select name from public.signatures where id = $1", [r.signature_id]))[0].name).toBe("Work (polished)");
  });

  it("replaces the original only with explicit confirmation", async () => {
    const { sig, id } = await through();
    await fails(call(requester, "polish_accept", id, "replace", null, false), "confirm_required");
    await fails(call(requester, "polish_accept", id, "replace", null, null), "confirm_required");
    expect(await statusOf(id)).toBe("delivered");
    expect((await rows<{ template_id: string }>("select template_id from public.signatures where id = $1", [sig]))[0].template_id).toBe(DOC.template_id);
    const r = await call(requester, "polish_accept", id, "replace", null, true);
    expect(r.signature_id).toBe(sig);
    expect((await rows<{ template_id: string; doc_json: unknown }>("select template_id, doc_json from public.signatures where id = $1", [sig]))[0]).toMatchObject({ template_id: POLISHED.template_id });
  });

  it("cannot replace an original that has been deleted", async () => {
    const { sig, id } = await through();
    await t.db.query("delete from public.signatures where id = $1", [sig]);
    await fails(call(requester, "polish_accept", id, "replace", null, true), "source_missing");
    expect(await statusOf(id)).toBe("delivered");
  });

  it("declining with a reason can reopen the request for another round", async () => {
    const { id } = await through();
    await fails(call(requester, "polish_decline", id, "   ", true), "invalid");
    const r = await call(requester, "polish_decline", id, "The banner is still too small", true);
    expect(r).toMatchObject({ status: "requested", round: 2 });
    const [row] = await rows<{ designer_id: string | null; decline_reason: string }>("select designer_id, decline_reason from public.polish_requests where id = $1", [id]);
    expect(row).toEqual({ designer_id: null, decline_reason: "The banner is still too small" });
    await call(designer2, "polish_claim", id);
    expect(await statusOf(id)).toBe("in_progress");
  });

  it("declining can also close the request for good", async () => {
    const { id } = await through();
    expect((await call(requester, "polish_decline", id, "Not what I wanted", false)).status).toBe("declined");
    await fails(call(designer, "polish_claim", id), "not_available");
    await fails(call(requester, "polish_cancel", id), "invalid_state");
  });

  it("lets the requester cancel an open request, and nothing after it is final", async () => {
    for (const stage of ["requested", "in_progress", "delivered"] as const) {
      const { id } = await ask();
      if (stage !== "requested") await call(designer, "polish_claim", id);
      if (stage === "delivered") await call(designer, "polish_deliver", id, JSON.stringify(POLISHED), "done");
      expect((await call(requester, "polish_cancel", id)).status).toBe("cancelled");
      await fails(call(requester, "polish_comment", id, "late"), "invalid_state");
    }
  });

  it("writes an audit event for every step, with the actor and a timestamp", async () => {
    const { id } = await ask();
    await call(designer, "polish_claim", id);
    await call(designer, "polish_deliver", id, JSON.stringify(POLISHED), "Tightened the layout");
    await call(requester, "polish_decline", id, "try again", true);
    await call(designer2, "polish_claim", id);
    await call(designer2, "polish_deliver", id, JSON.stringify(POLISHED), "Second try");
    await call(requester, "polish_accept", id, "new", null, false);
    const events = await rows<{ action: string; actor_id: string; from_status: string | null; to_status: string; detail: string | null; created_at: unknown }>(
      "select * from public.polish_events where request_id = $1 order by created_at, id", [id]);
    expect(events.map((e) => [e.action, e.actor_id])).toEqual([
      ["requested", requester], ["claimed", designer], ["delivered", designer], ["reopened", requester], ["claimed", designer2], ["delivered", designer2], ["accepted", requester],
    ]);
    expect(events[2]).toMatchObject({ from_status: "in_progress", to_status: "delivered", detail: "Tightened the layout" });
    expect(events.every((e) => e.created_at instanceof Date)).toBe(true);
  });
});

describe("skipping states and impersonation", () => {
  it("cannot deliver, accept or decline a request that is in the wrong state", async () => {
    const { id } = await ask();
    await fails(call(designer, "polish_deliver", id, JSON.stringify(POLISHED), "x"), "not_found"); // not held by them
    await fails(call(requester, "polish_accept", id, "new", null, false), "invalid_state"); // requested -> accepted
    await fails(call(requester, "polish_decline", id, "no", true), "invalid_state");
    await call(designer, "polish_claim", id);
    await fails(call(requester, "polish_accept", id, "new", null, false), "invalid_state"); // in_progress -> accepted
    await fails(call(designer, "polish_deliver", id, JSON.stringify(POLISHED), "   "), "invalid");
    await fails(call(designer, "polish_deliver", id, JSON.stringify({ version: 2 }), "x"), "invalid_doc");
    await fails(call(designer, "polish_deliver", id, JSON.stringify({ version: 1, template_id: "classic" }), "x"), "invalid_doc");
    await call(designer, "polish_deliver", id, JSON.stringify(POLISHED), "ok");
    await fails(call(designer, "polish_deliver", id, JSON.stringify(POLISHED), "again"), "invalid_state"); // delivered -> delivered
  });

  it("rejects any status change the transition table does not allow, whoever runs it", async () => {
    const { id } = await ask();
    await expect(t.db.query("update public.polish_requests set status = 'delivered' where id = $1", [id])).rejects.toThrow("invalid_transition");
    await expect(t.db.query("update public.polish_requests set status = 'accepted' where id = $1", [id])).rejects.toThrow("invalid_transition");
    expect(await statusOf(id)).toBe("requested");
  });

  it("matches the transition table in lib/polish/status.ts for every pair of statuses", async () => {
    for (const from of POLISH_STATUSES) {
      for (const to of POLISH_STATUSES) {
        if (from === to) continue;
        requester = await t.addUser(email("pair"));
        await t.db.query("insert into public.feature_overrides (subject_type, subject_id, feature, enabled) values ('user', $1, 'designer_polish', true)", [requester]);
        const { id } = await ask();
        // Put the row in `from` by hand (the owner may write the table), then try the change.
        await t.db.exec("alter table public.polish_requests disable trigger polish_requests_guard");
        await t.db.query("update public.polish_requests set status = $2 where id = $1", [id, from as PolishStatus]);
        await t.db.exec("alter table public.polish_requests enable trigger polish_requests_guard");
        const attempt = t.db.query("update public.polish_requests set status = $2 where id = $1", [id, to]);
        if (canTransition(from, to)) await attempt;
        else await expect(attempt, `${from} -> ${to}`).rejects.toThrow(/invalid_transition|closed/);
      }
    }
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...POLISH_STATUSES].sort());
  }, 60_000);

  it("freezes a finished request", async () => {
    const { id } = await ask();
    await call(requester, "polish_cancel", id);
    await expect(t.db.query("update public.polish_requests set note = 'rewritten' where id = $1", [id])).rejects.toThrow("closed");
  });

  it("does not let anyone change the snapshot or the owner", async () => {
    const { id } = await ask();
    await expect(t.db.query("update public.polish_requests set original_doc = '{}' where id = $1", [id])).rejects.toThrow("immutable");
    await expect(t.db.query("update public.polish_requests set requester_id = $2 where id = $1", [id, other])).rejects.toThrow("immutable");
  });

  it("treats strangers like the request does not exist, so ids reveal nothing", async () => {
    const { id } = await ask();
    await call(designer, "polish_claim", id);
    await call(designer, "polish_deliver", id, JSON.stringify(POLISHED), "done");
    for (const [uid, fn, args] of [
      [other, "polish_accept", ["new", null, false]],
      [other, "polish_decline", ["no", true]],
      [other, "polish_cancel", []],
      [designer2, "polish_accept", ["new", null, false]],
      [designer, "polish_accept", ["new", null, false]],
      [designer2, "polish_deliver", [JSON.stringify(POLISHED), "mine"]],
      [admin, "polish_deliver", [JSON.stringify(POLISHED), "mine"]],
      [requester, "polish_deliver", [JSON.stringify(POLISHED), "I am the designer"]],
      [other, "polish_comment", ["hi"]],
      [designer2, "polish_comment", ["hi"]],
      [admin, "polish_comment", ["hi"]],
    ] as const) {
      await expect(call(uid, fn, id, ...args), `${fn} as outsider`).rejects.toThrow("not_found");
    }
    expect(await statusOf(id)).toBe("delivered");
  });

  it("stops a demoted designer from acting on a request they hold", async () => {
    const d = await t.addUser(email("fading"));
    await t.setRole(d, "designer");
    const { id } = await ask();
    await call(d, "polish_claim", id);
    await t.setRole(d, "member");
    await fails(call(d, "polish_deliver", id, JSON.stringify(POLISHED), "x"), "not_found");
    await fails(call(d, "polish_comment", id, "x"), "not_found");
    expect(await visible(d, "select 1 from public.polish_requests where id = $1", [id])).toHaveLength(0);
  });
});

describe("comments", () => {
  it("records who wrote them and in which role, and rejects empty or oversized ones", async () => {
    const { id } = await ask();
    await call(designer, "polish_claim", id);
    await call(requester, "polish_comment", id, "  please keep the logo  ");
    await call(designer, "polish_comment", id, "will do");
    await fails(call(requester, "polish_comment", id, "   "), "invalid");
    await fails(call(requester, "polish_comment", id, "x".repeat(2001)), "invalid");
    const list = await rows<{ author_id: string; author_role: string; body: string }>("select * from public.polish_comments where request_id = $1 order by created_at, id", [id]);
    expect(list.map((c) => [c.author_role, c.author_id, c.body])).toEqual([["requester", requester, "please keep the logo"], ["designer", designer, "will do"]]);
  });
});

describe("deleting accounts and signatures", () => {
  it("keeps a request when its original signature is deleted, and removes everything when the requester is deleted", async () => {
    const { sig, id } = await ask();
    await call(designer, "polish_claim", id);
    await call(requester, "polish_comment", id, "hi");
    await t.db.query("delete from public.signatures where id = $1", [sig]);
    expect((await rows<{ source_signature_id: string | null }>("select source_signature_id from public.polish_requests where id = $1", [id]))[0].source_signature_id).toBeNull();
    await t.db.query("delete from auth.users where id = $1", [requester]);
    expect(await rows("select 1 from public.polish_requests where id = $1", [id])).toHaveLength(0);
    expect(await rows("select 1 from public.polish_comments where request_id = $1", [id])).toHaveLength(0);
    expect(await rows("select 1 from public.polish_events where request_id = $1", [id])).toHaveLength(0);
  });

  it("lets a designer account be deleted without breaking finished requests", async () => {
    const d = await t.addUser(email("leaver"));
    await t.setRole(d, "designer");
    const { id } = await ask();
    await call(d, "polish_claim", id);
    await call(d, "polish_deliver", id, JSON.stringify(POLISHED), "done");
    await call(requester, "polish_accept", id, "new", null, false);
    await t.db.query("delete from auth.users where id = $1", [d]);
    expect(await statusOf(id)).toBe("accepted");
  });
});
