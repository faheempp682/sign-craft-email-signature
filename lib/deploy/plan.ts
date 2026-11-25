import { createHash } from "node:crypto";
import { MAX_SIGNATURE_CHARS } from "@/lib/google/gmail";

/**
 * Pure planning logic for a Gmail deployment. Nothing here touches the network or the database: the caller reads the
 * live signature and passes it in, so every rule can be tested with plain values.
 */

/** Gmail may re-format the HTML it stores, so compare a whitespace-normalised form. (Whether Gmail changes more than whitespace is UNVERIFIED.) */
export const canon = (html: string) => html.replace(/\s+/g, " ").replace(/> </g, "><").trim();
export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
export const signatureHash = (html: string) => sha256(canon(html));

export type SkipCode =
  | "inactive"
  | "no_version"
  | "template_mismatch"
  | "render_failed"
  | "too_long"
  | "no_mailbox"
  | "cannot_act"
  | "unreadable"
  | "already_current";

export const SKIP_LABEL: Record<SkipCode, string> = {
  inactive: "Marked inactive in the directory",
  no_version: "No approved signature yet",
  template_mismatch: "Approved signature uses a different template than the rules choose",
  render_failed: "The signature cannot be built",
  too_long: "Over Gmail's size limit",
  no_mailbox: "No Gmail mailbox for this address",
  cannot_act: "Could not act as this user",
  unreadable: "Could not read the current signature",
  already_current: "Already up to date",
};

export type Live = { ok: true; signature: string } | { ok: false; code: "no_mailbox" | "cannot_act" | "unreadable"; message: string };

export type PlanInput = {
  person: { id: string; email: string; full_name: string; status: string };
  version: { id: string; template_id: string | null } | null;
  /** When the organization has active explicit rules: the template the rules choose for this person (Gmail honours department rules only). */
  expectedTemplateId: string | null;
  render: { ok: true; html: string } | { ok: false; error: string } | null;
  live: Live | null;
};

export type PlanItem = {
  person_id: string;
  email: string;
  name: string;
  /** set: no signature there now. replace: a different one exists. skip: nothing will be written. */
  action: "set" | "replace" | "skip";
  code: SkipCode | "";
  reason: string;
  version_id: string | null;
  new_hash: string | null;
  /** The hash the live signature must still have when the write happens. */
  expect_hash: string | null;
  previous_hash: string | null;
  has_existing: boolean;
};

const skip = (i: PlanInput, code: SkipCode, reason: string, extra: Partial<PlanItem> = {}): PlanItem => ({
  person_id: i.person.id, email: i.person.email, name: i.person.full_name, action: "skip", code, reason, version_id: i.version?.id ?? null, new_hash: null, expect_hash: null, previous_hash: null, has_existing: false, ...extra,
});

/** The checks that need no call to Google. A non-null answer means the person is skipped without reading their mailbox. */
export function precheck(i: Omit<PlanInput, "live">): PlanItem | null {
  const s = (code: SkipCode, reason: string) => skip({ ...i, live: null }, code, reason);
  if (i.person.status !== "active") return s("inactive", SKIP_LABEL.inactive + ". Inactive people are never changed.");
  if (!i.version) return s("no_version", "They have no approved signature. Only approved signatures are ever deployed.");
  if (i.expectedTemplateId !== null && i.version.template_id !== i.expectedTemplateId)
    return s("template_mismatch", "The rules choose a different template for them than the one their approved signature was made from. Gmail can only follow department rules; ask them to save their signature again.");
  if (!i.render || !i.render.ok) return s("render_failed", `The signature cannot be built: ${i.render && !i.render.ok ? i.render.error : "no data"}`);
  if (i.render.html.length > MAX_SIGNATURE_CHARS) return s("too_long", `The signature is ${i.render.html.length.toLocaleString("en-GB")} characters; Gmail allows ${MAX_SIGNATURE_CHARS.toLocaleString("en-GB")}.`);
  return null;
}

/** What would happen to one person, in the order the checks must run. */
export function decide(i: PlanInput): PlanItem {
  const early = precheck(i);
  if (early) return early;
  if (!i.live) return skip(i, "unreadable", "The current signature was not read.");
  if (!i.live.ok) return skip(i, i.live.code, i.live.message);
  const html = (i.render as { ok: true; html: string }).html;
  const version = i.version as { id: string };

  const newHash = signatureHash(html);
  const prevHash = signatureHash(i.live.signature);
  const has = canon(i.live.signature) !== "";
  if (prevHash === newHash) return skip(i, "already_current", "Their Gmail signature already matches. Nothing to do.", { new_hash: newHash, previous_hash: prevHash, expect_hash: prevHash, has_existing: true });
  return {
    person_id: i.person.id, email: i.person.email, name: i.person.full_name, action: has ? "replace" : "set", code: "", reason: has ? "Replaces the signature they have now." : "They have no signature now; this one will be set.",
    version_id: version.id, new_hash: newHash, expect_hash: prevHash, previous_hash: prevHash, has_existing: has,
  };
}

export type PlanCounts = { total: number; set: number; replace: number; skipped: number; already_current: number; actionable: number };

export function countPlan(items: PlanItem[]): PlanCounts {
  const set = items.filter((x) => x.action === "set").length;
  const replace = items.filter((x) => x.action === "replace").length;
  return { total: items.length, set, replace, actionable: set + replace, already_current: items.filter((x) => x.code === "already_current").length, skipped: items.filter((x) => x.action === "skip" && x.code !== "already_current").length };
}

export const PLAN_VERSION = 1;

/**
 * A fingerprint over everything the confirmation depends on: the organization, who gets what (by hash), what they have now
 * and which approved version it comes from. If anything changes between the plan and the confirmation, it differs and the
 * deployment is refused (a stale plan cannot run).
 */
export function fingerprint(org: string, items: PlanItem[]): string {
  const rows = items
    .map((x) => [x.person_id, x.action, x.code, x.version_id, x.new_hash, x.expect_hash])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return sha256(JSON.stringify([PLAN_VERSION, org, "gmail", rows]));
}

/* ------------------------------------------------------------------------ backoff */

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn`, retrying when `retryable(error)` says so, with exponential backoff and jitter (base * 2^attempt + up to 25%).
 * Gives the last error back when the attempts run out.
 */
export async function withBackoff<T>(fn: () => Promise<T>, o: { retryable: (e: unknown) => boolean; attempts?: number; baseMs?: number; sleep?: Sleep; random?: () => number }): Promise<T> {
  const attempts = o.attempts ?? 4;
  const sleep = o.sleep ?? realSleep;
  const rand = o.random ?? Math.random;
  let last: unknown;
  for (let n = 0; n < attempts; n++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (n === attempts - 1 || !o.retryable(e)) break;
      const wait = (o.baseMs ?? 500) * 2 ** n;
      await sleep(Math.round(wait + wait * 0.25 * rand()));
    }
  }
  throw last;
}

/** Runs `worker` over `items` with at most `limit` in flight. A worker that throws is reported, never lets the others stop. */
export async function pool<T, R>(items: T[], limit: number, worker: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await worker(items[i]) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return out;
}
