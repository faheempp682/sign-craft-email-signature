import { describe, expect, it } from "vitest";
import { DwdError } from "@/lib/google-dwd/token";
import { GoogleError } from "@/lib/google/errors";
import { classify, type Mailbox } from "./mailbox";
import { signatureHash } from "./plan";
import { MAX_ATTEMPTS, processItem, runBatch, type Item, type Store } from "./runner";

/** In-memory fakes for the queue and for Gmail, so the execution rules can be checked without any service. */

const NEW = "<table><tr><td>New</td></tr></table>";
const OLD = "<p>old</p>";
const item = (o: Partial<Item> = {}): Item => ({ id: "i1", email: "ann@acme.com", action: "replace", expect_hash: signatureHash(OLD), new_hash: signatureHash(NEW), new_signature: null, previous_known: false, attempts: 1, person_id: "p1", ...o });

function fakes(queue: Item[], gmail: Record<string, string>, o: { failWrite?: (email: string) => unknown; failRead?: (email: string) => unknown } = {}) {
  const log: string[] = [];
  const results: Record<string, { status: string; code: string }> = {};
  const backups: Record<string, string> = {};
  const writes: string[] = [];
  const pending = [...queue];
  const store: Store = {
    async claim(n) {
      return pending.splice(0, n);
    },
    async recordPrevious(id, sig) {
      log.push(`backup:${id}`);
      backups[id] ??= sig;
    },
    async finish(id, status, code) {
      log.push(`finish:${id}:${status}`);
      results[id] = { status, code };
    },
    async release(id, code) {
      log.push(`release:${id}`);
      results[id] = { status: "released", code };
    },
  };
  const mailbox: Mailbox = {
    async read(email) {
      const e = o.failRead?.(email);
      if (e) throw e;
      return gmail[email] ?? "";
    },
    async write(email, html) {
      const e = o.failWrite?.(email);
      if (e) throw e;
      log.push(`write:${email}`);
      writes.push(email);
      gmail[email] = html;
    },
  };
  return { store, mailbox, log, results, backups, writes, gmail };
}
const deps = (f: ReturnType<typeof fakes>, resolve?: (i: Item) => Promise<{ ok: true; html: string } | { ok: false; code: string; message: string }>) => ({ store: f.store, mailbox: f.mailbox, resolve: resolve ?? (async () => ({ ok: true as const, html: NEW })), sleep: async () => {}, random: () => 0 });

describe("processItem", () => {
  it("backs up the live signature BEFORE writing, then marks done", async () => {
    const f = fakes([], { "ann@acme.com": OLD });
    const out = await processItem(item(), deps(f));
    expect(out.status).toBe("done");
    expect(f.log).toEqual(["backup:i1", "write:ann@acme.com", "finish:i1:done"]);
    expect(f.backups.i1).toBe(OLD);
    expect(f.gmail["ann@acme.com"]).toBe(NEW);
  });

  it("leaves the signature alone when it changed after the plan", async () => {
    const f = fakes([], { "ann@acme.com": "<p>edited by Ann</p>" });
    const out = await processItem(item(), deps(f));
    expect(out).toMatchObject({ status: "skipped", code: "changed" });
    expect(f.writes).toEqual([]);
    expect(f.backups).toEqual({});
  });

  it("does not write when the approved signature changed after the plan (hash differs)", async () => {
    const f = fakes([], { "ann@acme.com": OLD });
    const out = await processItem(item(), deps(f, async () => ({ ok: true, html: "<p>different</p>" })));
    expect(out).toMatchObject({ status: "skipped", code: "changed" });
    expect(f.writes).toEqual([]);
  });

  it("does not write when the signature can no longer be built or is over the limit", async () => {
    const f = fakes([], { "ann@acme.com": OLD });
    expect((await processItem(item(), deps(f, async () => ({ ok: false, code: "no_version", message: "x" })))).code).toBe("no_version");
    const big = "x".repeat(10_001);
    expect((await processItem(item({ new_hash: signatureHash(big) }), deps(f, async () => ({ ok: true, html: big })))).code).toBe("too_long");
    expect(f.writes).toEqual([]);
  });

  it("refuses an item that was not planned for a change", async () => {
    const f = fakes([], { "ann@acme.com": OLD });
    expect((await processItem(item({ action: "skip", new_hash: null }), deps(f))).status).toBe("skipped");
    expect(f.writes).toEqual([]);
  });

  it("is idempotent: when Gmail already holds the new signature nothing is written", async () => {
    const f = fakes([], { "ann@acme.com": NEW });
    expect(await processItem(item(), deps(f))).toMatchObject({ status: "skipped", code: "already_current" });
    expect(f.writes).toEqual([]);
    // crash recovery: the backup exists (previous_known) and the write happened, so it completes as done
    const g = fakes([], { "ann@acme.com": NEW });
    expect((await processItem(item({ previous_known: true }), deps(g))).status).toBe("done");
    expect(g.writes).toEqual([]);
  });

  it("restores a saved signature and refuses when it was changed since the deployment", async () => {
    const restore = item({ action: "restore", expect_hash: signatureHash(NEW), new_hash: signatureHash(OLD), new_signature: OLD });
    const resolve = async (i: Item) => ({ ok: true as const, html: i.new_signature! });
    const f = fakes([], { "ann@acme.com": NEW });
    expect((await processItem(restore, deps(f, resolve))).status).toBe("done");
    expect(f.gmail["ann@acme.com"]).toBe(OLD);
    const g = fakes([], { "ann@acme.com": "<p>Ann changed it again</p>" });
    expect(await processItem(restore, deps(g, resolve))).toMatchObject({ status: "skipped", code: "changed" });
    expect(g.writes).toEqual([]);
  });

  it("restores to an empty signature", async () => {
    const restore = item({ action: "restore", expect_hash: signatureHash(NEW), new_hash: signatureHash(""), new_signature: "" });
    const f = fakes([], { "ann@acme.com": NEW });
    expect((await processItem(restore, deps(f, async () => ({ ok: true, html: "" })))).status).toBe("done");
    expect(f.gmail["ann@acme.com"]).toBe("");
  });

  it("a failed write is recorded as failed, with the backup already saved", async () => {
    const f = fakes([], { "ann@acme.com": OLD }, { failWrite: () => new GoogleError("forbidden", "Gmail rejected the signature: too fancy", 422) });
    const out = await processItem(item(), deps(f));
    expect(out).toMatchObject({ status: "failed", code: "rejected" });
    expect(f.backups.i1).toBe(OLD);
    expect(f.gmail["ann@acme.com"]).toBe(OLD);
  });

  it("rate limiting is retried with backoff, then released (not failed) so the queue can slow down", async () => {
    let calls = 0;
    const f = fakes([], { "ann@acme.com": OLD }, { failRead: () => (++calls < 3 ? new GoogleError("rate_limited", "slow", 429) : null) });
    expect((await processItem(item(), deps(f))).status).toBe("done");
    const g = fakes([], { "ann@acme.com": OLD }, { failRead: () => new GoogleError("rate_limited", "slow", 429) });
    expect(await processItem(item({ attempts: 1 }), deps(g))).toMatchObject({ status: "released", code: "rate_limited" });
    expect(await processItem(item({ attempts: MAX_ATTEMPTS }), deps(g))).toMatchObject({ status: "failed", code: "rate_limited" });
    expect(g.writes).toEqual([]);
  });

  it("maps a missing mailbox and a setup problem", async () => {
    const f = fakes([], {}, { failRead: () => new GoogleError("address_not_found", "x", 404) });
    expect(await processItem(item(), deps(f))).toMatchObject({ status: "failed", code: "no_mailbox" });
    const g = fakes([], {}, { failRead: () => new DwdError("not_authorized", "not delegated") });
    expect(await processItem(item(), deps(g))).toMatchObject({ status: "failed", code: "not_authorized", setup: true });
  });
});

describe("runBatch", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => item({ id: `i${i}`, email: `u${i}@acme.com` }));
  const mailboxOf = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`u${i}@acme.com`, OLD]));

  it("processes everything, one person's failure never aborts the others", async () => {
    const f = fakes(many(10), mailboxOf(10), { failWrite: (e) => (e === "u3@acme.com" ? new GoogleError("forbidden", "no", 403) : null) });
    const r = await runBatch(deps(f), { concurrency: 3 });
    expect(r).toMatchObject({ processed: 10, done: 9, failed: 1 });
    expect(f.results.i3).toMatchObject({ status: "failed", code: "no_mailbox" });
    expect(f.writes).toHaveLength(9);
  });

  it("only ever writes to people that were in the queue", async () => {
    const f = fakes(many(4), { ...mailboxOf(4), "stranger@elsewhere.com": OLD });
    await runBatch(deps(f));
    expect(new Set(f.writes)).toEqual(new Set(many(4).map((i) => i.email)));
    expect(f.gmail["stranger@elsewhere.com"]).toBe(OLD);
  });

  it("respects the concurrency limit", async () => {
    let active = 0;
    let max = 0;
    const f = fakes(many(12), mailboxOf(12));
    const slow: Mailbox = {
      async read(e) {
        active++;
        max = Math.max(max, active);
        await new Promise((r) => setTimeout(r, 3));
        active--;
        return f.gmail[e] ?? "";
      },
      write: f.mailbox.write,
    };
    await runBatch({ ...deps(f), mailbox: slow }, { concurrency: 4 });
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBeGreaterThan(1);
  });

  it("stops when Google throttles, leaving the rest in the queue", async () => {
    const f = fakes(many(20), mailboxOf(20), { failRead: () => new GoogleError("rate_limited", "slow", 429) });
    const r = await runBatch(deps(f), { concurrency: 2, claimSize: 2 });
    expect(r.throttled).toBe(true);
    expect(r.released).toBe(2);
    expect(r.processed).toBeLessThan(20);
  });

  it("stops on a setup problem instead of failing every person", async () => {
    const f = fakes(many(20), mailboxOf(20), { failRead: () => new DwdError("not_authorized", "no") });
    const r = await runBatch(deps(f), { concurrency: 2, claimSize: 2 });
    expect(r.setupProblem).toBe(true);
    expect(r.processed).toBeLessThanOrEqual(2);
  });

  it("stops at the time budget and reports an empty queue", async () => {
    let t = 0;
    const f = fakes(many(40), mailboxOf(40));
    const r = await runBatch({ ...deps(f), now: () => (t += 1000) }, { budgetMs: 3500, claimSize: 2, concurrency: 2 });
    expect(r.processed).toBeLessThan(40);
    const empty = await runBatch(deps(fakes([], {})));
    expect(empty.claimedNothing).toBe(true);
  });

  it("a rerun after a partial failure touches only what is not done", async () => {
    const q = many(3);
    const f = fakes([...q], mailboxOf(3), { failWrite: (e) => (e === "u1@acme.com" ? new GoogleError("upstream", "x", 502) : null) });
    await runBatch(deps(f));
    expect(f.results.i1.status).toBe("failed");
    const writesBefore = [...f.writes];
    // the failed item goes back in the queue (the database function does this); the done ones are not queued again
    const retry = fakes([item({ id: "i1", email: "u1@acme.com", previous_known: true })], f.gmail);
    await runBatch(deps(retry));
    expect(writesBefore).toEqual(["u0@acme.com", "u2@acme.com"]);
    expect(retry.writes).toEqual(["u1@acme.com"]);
  });
});

describe("classify", () => {
  it("never leaks raw Google text for unknown errors", () => {
    expect(classify(new Error("secret token abc"))).toMatchObject({ kind: "upstream", retryable: true });
    expect(classify(new Error("secret token abc")).message).not.toContain("secret");
  });
  it("distinguishes rejected content (422) from a refused account (403)", () => {
    expect(classify(new GoogleError("forbidden", "m", 422)).kind).toBe("rejected");
    expect(classify(new GoogleError("forbidden", "m", 403)).kind).toBe("no_mailbox");
    expect(classify(new GoogleError("gmail_api_disabled", "m", 503)).kind).toBe("setup");
    expect(classify(new DwdError("bad_subject", "m")).kind).toBe("cannot_act");
    expect(classify(new DwdError("upstream", "m")).retryable).toBe(true);
  });
});
