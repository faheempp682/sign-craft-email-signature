import { classify, type Mailbox } from "@/lib/deploy/mailbox";
import { pool, realSleep, withBackoff, type Sleep } from "@/lib/deploy/plan";
import { classifyLive, type Baseline } from "./classify";

/**
 * Walks the monitored people in id order, a batch at a time, reads each one's live Gmail signature (bounded concurrency, backoff
 * on 429 and 5xx), classifies it and records the batch. It stops when the time budget is used up (the run is resumed by the next
 * call, from the saved cursor), when the per-run cap is reached, or when Google says the setup is wrong (every person would fail
 * the same way). All side effects go through `Store` and `Mailbox`, so it is tested with in-memory fakes.
 *
 * An unreachable mailbox (outage, no mailbox, delegation problem) is recorded as "unreachable" with the reason. It is never a
 * finding and never resolves or opens one.
 */

export const HARD_CAP = 1000;
export const BATCH = 25;
export const CONCURRENCY = 5;

export type Candidate = {
  person_id: string;
  email: string;
  full_name: string;
  item_id: string;
  version_id: string | null;
  new_hash: string | null;
  baseline_hash: string | null;
  baseline_fp: string | null;
  baseline_verified: boolean;
};

export type Result = {
  person_id: string;
  item_id: string;
  status: "ok" | "edited" | "removed" | "unreachable";
  baseline_hash: string | null;
  baseline_fp: string | null;
  baseline_verified: boolean;
  reformatted: boolean;
  reason: string;
  live_hash: string | null;
  live_fp: string | null;
  expected_fp: string | null;
  detail: string;
};

export type RunState = { id: string; cursor: string | null; checked: number };

export type Store = {
  candidates(after: string | null, limit: number): Promise<Candidate[]>;
  record(runId: string, results: Result[], cursor: string | null): Promise<void>;
  finish(runId: string, status: "completed" | "failed", capped: boolean, cursor: string | null, note: string): Promise<void>;
};

export type Deps = {
  store: Store;
  mailbox: Mailbox;
  /** Text fingerprint of what was deployed, per person, or null when it cannot be rebuilt exactly. */
  expected: (batch: Candidate[]) => Promise<Map<string, string | null>>;
  cap: number;
  budgetMs: number;
  sleep?: Sleep;
  now?: () => number;
  random?: () => number;
};

export type Progress = { done: boolean; checked: number; capped: boolean; failed: boolean; note: string };

const noBase = (c: Candidate): Baseline => ({ hash: c.baseline_hash, fp: c.baseline_fp, verified: c.baseline_verified });

async function checkOne(c: Candidate, expectedFp: string | null, d: Deps): Promise<{ result: Result; setup: string | null }> {
  const base = noBase(c);
  try {
    const live = await withBackoff(() => d.mailbox.read(c.email), { retryable: (e) => classify(e).retryable, sleep: d.sleep ?? realSleep, random: d.random });
    const v = classifyLive({ live, expectedFp, baseline: base });
    return {
      setup: null,
      result: { person_id: c.person_id, item_id: c.item_id, status: v.status, baseline_hash: v.baseline.hash, baseline_fp: v.baseline.fp, baseline_verified: v.baseline.verified, reformatted: v.reformatted, reason: "", live_hash: v.liveHash, live_fp: v.liveFp, expected_fp: expectedFp, detail: v.detail },
    };
  } catch (e) {
    const k = classify(e);
    const reason = k.retryable ? `${k.message} It will be tried again at the next check.` : k.message;
    return {
      setup: k.kind === "setup" ? k.message : null,
      result: { person_id: c.person_id, item_id: c.item_id, status: "unreachable", baseline_hash: base.hash, baseline_fp: base.fp, baseline_verified: base.verified, reformatted: false, reason: reason.slice(0, 300), live_hash: null, live_fp: null, expected_fp: expectedFp, detail: "" },
    };
  }
}

export async function continueRun(run: RunState, d: Deps): Promise<Progress> {
  const now = d.now ?? Date.now;
  const started = now();
  const cap = Math.max(1, Math.min(d.cap, HARD_CAP));
  let cursor = run.cursor;
  let checked = run.checked;

  for (;;) {
    if (checked >= cap) {
      const more = await d.store.candidates(cursor, 1);
      await d.store.finish(run.id, "completed", more.length > 0, cursor, more.length ? `Stopped at the cap of ${cap} people; the next check continues after them.` : "");
      return { done: true, checked, capped: more.length > 0, failed: false, note: "" };
    }
    if (now() - started >= d.budgetMs) return { done: false, checked, capped: false, failed: false, note: "" };

    const batch = await d.store.candidates(cursor, Math.min(BATCH, cap - checked));
    if (!batch.length) {
      await d.store.finish(run.id, "completed", false, null, "");
      return { done: true, checked, capped: false, failed: false, note: "" };
    }
    const exp = await d.expected(batch);
    const settled = await pool(batch, CONCURRENCY, (c) => checkOne(c, exp.get(c.person_id) ?? null, d));
    const results: Result[] = [];
    let setup: string | null = null;
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") {
        results.push(s.value.result);
        setup = setup ?? s.value.setup;
      } else {
        // an unexpected bug in our own code for one person: say so for that person only
        const c = batch[i];
        results.push({ person_id: c.person_id, item_id: c.item_id, status: "unreachable", baseline_hash: c.baseline_hash, baseline_fp: c.baseline_fp, baseline_verified: c.baseline_verified, reformatted: false, reason: "The check failed unexpectedly for this person.", live_hash: null, live_fp: null, expected_fp: null, detail: "" });
      }
    });
    cursor = batch[batch.length - 1].person_id;
    checked += batch.length;
    await d.store.record(run.id, results, cursor);
    if (setup) {
      const note = String(setup).slice(0, 300);
      await d.store.finish(run.id, "failed", false, null, note);
      return { done: true, checked, capped: false, failed: true, note };
    }
  }
}
