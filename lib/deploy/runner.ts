import { MAX_SIGNATURE_CHARS } from "@/lib/google/gmail";
import { classify, type Mailbox } from "./mailbox";
import { pool, realSleep, signatureHash, withBackoff, type Sleep } from "./plan";

/**
 * Executes the items of a confirmed deployment. All side effects go through `Store` (the database functions) and
 * `Mailbox` (Gmail), so the logic can be tested with in-memory fakes.
 *
 * For every item, in this order, and never writing outside it:
 *   1. work out the signature to write (deploy: re-render the approved version now; restore: the saved backup)
 *      and refuse if it is no longer the one that was confirmed (hash differs) or is over the Gmail limit
 *   2. read what Gmail holds now; refuse (skip) if it is not what the plan saw (someone changed it)
 *   3. save that live signature as the backup (the first copy only), THEN write
 *   4. mark done. A crash between 3 and 4 is repaired on the next run: the live signature already equals the new one.
 */

export type Item = {
  id: string;
  email: string;
  action: "set" | "replace" | "restore" | "skip";
  expect_hash: string | null;
  new_hash: string | null;
  new_signature: string | null;
  previous_known: boolean;
  attempts: number;
  person_id: string | null;
};

export type Store = {
  claim(limit: number): Promise<Item[]>;
  recordPrevious(itemId: string, signature: string, truncated: boolean): Promise<void>;
  finish(itemId: string, status: "done" | "failed" | "skipped", code: string, message: string): Promise<void>;
  release(itemId: string, code: string): Promise<void>;
};

export type Resolved = { ok: true; html: string } | { ok: false; code: string; message: string };
export type Deps = { store: Store; mailbox: Mailbox; resolve: (item: Item) => Promise<Resolved>; sleep?: Sleep; now?: () => number; random?: () => number };

export type Outcome = { id: string; status: "done" | "failed" | "skipped" | "released"; code: string; setup?: boolean };

export const MAX_ATTEMPTS = 5;

export async function processItem(item: Item, d: Deps): Promise<Outcome> {
  const end = async (status: "done" | "failed" | "skipped", code: string, message: string, setup = false): Promise<Outcome> => {
    await d.store.finish(item.id, status, code, message);
    return { id: item.id, status, code, setup };
  };
  if (item.action === "skip" || !item.new_hash || !item.expect_hash) return end("skipped", "not_planned", "This item was not planned for a change.");

  // 1. the signature to write
  const want = await d.resolve(item);
  if (!want.ok) return end("skipped", want.code, want.message);
  if (signatureHash(want.html) !== item.new_hash) return end("skipped", "changed", "The approved signature or the directory entry changed after the plan was made. Plan again.");
  if (want.html.length > MAX_SIGNATURE_CHARS) return end("skipped", "too_long", "The signature is over Gmail's size limit.");

  const retry = { retryable: (e: unknown) => classify(e).retryable, sleep: d.sleep ?? realSleep, random: d.random };

  // 2. what is there now
  let live: string;
  try {
    live = await withBackoff(() => d.mailbox.read(item.email), retry);
  } catch (e) {
    return fail(item, d, e);
  }
  const liveHash = signatureHash(live);
  if (liveHash === item.new_hash) {
    // already what we want: either a crash after the write on an earlier run (the backup was saved first) or someone else did it
    return item.previous_known ? end("done", "", "") : end("skipped", "already_current", "The signature already matches; nothing was written.");
  }
  if (liveHash !== item.expect_hash) return end("skipped", "changed", "The signature in Gmail was changed after the plan was made, so it was left alone. Plan again.");

  // 3. backup, then write
  try {
    await d.store.recordPrevious(item.id, live.slice(0, MAX_SIGNATURE_CHARS), live.length > MAX_SIGNATURE_CHARS);
    await withBackoff(() => d.mailbox.write(item.email, want.html), retry);
  } catch (e) {
    return fail(item, d, e);
  }
  return end("done", "", "");
}

async function fail(item: Item, d: Deps, e: unknown): Promise<Outcome> {
  const c = classify(e);
  // Throttled: hand the item back (not a failure) until it has been tried too often.
  if (c.kind === "rate_limited" && item.attempts < MAX_ATTEMPTS) {
    await d.store.release(item.id, "rate_limited");
    return { id: item.id, status: "released", code: "rate_limited" };
  }
  const code = c.kind === "setup" ? "not_authorized" : c.kind;
  await d.store.finish(item.id, "failed", code, c.message);
  return { id: item.id, status: "failed", code, setup: c.kind === "setup" };
}

export type BatchResult = { processed: number; done: number; failed: number; skipped: number; released: number; throttled: boolean; setupProblem: boolean; claimedNothing: boolean };

/**
 * Works through the queue for up to `budgetMs`, `concurrency` items at a time. Stops early when Google is throttling
 * (the caller waits and calls again) or when every item fails because the Workspace is not set up.
 */
export async function runBatch(d: Deps, o: { concurrency?: number; budgetMs?: number; claimSize?: number } = {}): Promise<BatchResult> {
  const now = d.now ?? Date.now;
  const started = now();
  const res: BatchResult = { processed: 0, done: 0, failed: 0, skipped: 0, released: 0, throttled: false, setupProblem: false, claimedNothing: false };
  const concurrency = o.concurrency ?? 4;
  while (now() - started < (o.budgetMs ?? 20_000)) {
    const items = await d.store.claim(o.claimSize ?? concurrency * 2);
    if (!items.length) {
      res.claimedNothing = res.processed === 0;
      break;
    }
    const outs = await pool(items, concurrency, (it) => processItem(it, d));
    for (const [i, r] of outs.entries()) {
      res.processed++;
      if (r.status === "rejected") {
        // a store failure: the item stays "running" and is taken back after 5 minutes; stop rather than pile on
        console.error("[deploy] item handling failed:", items[i].id);
        res.failed++;
        res.throttled = true;
        continue;
      }
      const o2 = r.value;
      if (o2.status === "done") res.done++;
      else if (o2.status === "failed") res.failed++;
      else if (o2.status === "skipped") res.skipped++;
      else {
        res.released++;
        res.throttled = true;
      }
      if (o2.setup) res.setupProblem = true;
    }
    if (res.throttled || res.setupProblem) break;
  }
  return res;
}
