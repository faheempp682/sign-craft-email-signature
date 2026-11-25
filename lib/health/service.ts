import type { SupabaseClient } from "@supabase/supabase-js";
import { gmailMailbox, type Mailbox } from "@/lib/deploy/mailbox";
import { signatureHash } from "@/lib/deploy/plan";
import { readServiceAccount } from "@/lib/google-dwd/token";
import { renderVersion, type PersonData } from "@/lib/team/render";
import { PERSON_COLUMNS } from "@/lib/team/route";
import { continueRun, HARD_CAP, type Candidate, type Deps, type Progress, type Result, type RunState, type Store } from "./checker";
import { textFingerprint } from "./fingerprint";
import { buildMessage, sendWebhook, type Delivery } from "./webhook";

/** Orchestration: database access (as a signed-in admin, or as the service role for cron), the expected text, the run, the alert. */

export class HealthError extends Error {
  constructor(public readonly code: "not_configured" | "db", message: string, public readonly status: number) {
    super(message);
  }
}

export const NOT_SET_UP = "The health monitor needs the Gmail deployment setup: GOOGLE_SERVICE_ACCOUNT_JSON with domain-wide delegation (see docs/deploy-and-rules.md).";

export function serverMailbox(): Mailbox {
  const sa = readServiceAccount();
  if (!sa) throw new HealthError("not_configured", NOT_SET_UP, 503);
  return gmailMailbox(sa);
}

/** What is missing for the monitor to work, as names only. (HEALTH_CRON_SECRET is needed only for unattended runs.) */
export function healthStatus(env: Record<string, string | undefined> = process.env) {
  const missingForChecks = readServiceAccount(env) ? [] : ["GOOGLE_SERVICE_ACCOUNT_JSON"];
  const secret = env.HEALTH_CRON_SECRET ?? "";
  const missingForCron = [...(secret.length >= 32 ? [] : ["HEALTH_CRON_SECRET (at least 32 characters)"]), ...(env.SUPABASE_SERVICE_ROLE_KEY ? [] : ["SUPABASE_SERVICE_ROLE_KEY"])];
  return { configured: missingForChecks.length === 0, missing: missingForChecks, unattended_ready: missingForChecks.length === 0 && missingForCron.length === 0, unattended_missing: missingForCron };
}

type Rpc = { data: unknown; error: { code?: string; message: string } | null };

/** The database functions of migration 0012. `service` picks the *_service entry points (no signed-in user; service-role client only). */
export function healthDb(client: SupabaseClient, service: boolean, orgId: string) {
  const fn = (base: string) => (service ? `${base}_service` : base);
  const must = (r: Rpc) => {
    if (r.error) throw r.error;
    return r.data;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => must((await client.rpc(fn(name), args)) as Rpc);

  const store = (): Store => ({
    async candidates(after, limit) {
      return (await rpc("health_candidates", { p_org: orgId, p_after: after, p_limit: limit })) as Candidate[] ?? [];
    },
    async record(runId, results, cursor) {
      await rpc("health_record", { p_run: runId, p_results: results, p_cursor: cursor });
    },
    async finish(runId, status, capped, cursor, note) {
      await rpc("health_finish", { p_run: runId, p_status: status, p_capped: capped, p_cursor: cursor, p_note: note });
    },
  });
  return {
    store,
    async startRun(): Promise<RunState & { status: string }> {
      const r = (await rpc("health_start_run", { p_org: orgId })) as { id: string; cursor: string | null; checked: number; status: string };
      return { id: r.id, cursor: r.cursor, checked: r.checked, status: r.status };
    },
    async claimNotification(runId: string): Promise<boolean> {
      return (await rpc("health_claim_notification", { p_run: runId })) === true;
    },
  };
}

type PersonRow = PersonData & { id: string };
type VersionRow = { id: string; person_id: string; template_snapshot: unknown; values_json: unknown };

const personData = (p: PersonRow): PersonData => ({ email: p.email, full_name: p.full_name, first_name: p.first_name, last_name: p.last_name, title: p.title, department: p.department, phone: p.phone, mobile: p.mobile, location: p.location, custom: p.custom });

/**
 * The text of what was deployed. The deployment only kept the HASH of what it sent, so the HTML is rebuilt from the approved
 * version that was planned and the person's directory entry. It counts ONLY when the rebuilt HTML hashes to exactly the hash that
 * was deployed; otherwise (template or directory changed since) the answer is null and the monitor falls back to the baseline.
 */
export function expectedFrom(client: SupabaseClient, orgId: string): Deps["expected"] {
  return async (batch) => {
    const out = new Map<string, string | null>();
    const withVersion = batch.filter((c) => c.version_id && c.new_hash);
    for (const c of batch) out.set(c.person_id, null);
    if (!withVersion.length) return out;
    const [p, v] = await Promise.all([
      client.from("people").select(PERSON_COLUMNS).eq("org_id", orgId).in("id", withVersion.map((c) => c.person_id)),
      client.from("signature_versions").select("id, person_id, template_snapshot, values_json").eq("org_id", orgId).in("id", withVersion.map((c) => c.version_id as string)),
    ]);
    if (p.error || v.error) return out; // cannot rebuild: fall back to the baseline, never guess
    const people = new Map(((p.data ?? []) as unknown as PersonRow[]).map((x) => [x.id, x]));
    const versions = new Map(((v.data ?? []) as unknown as VersionRow[]).map((x) => [x.id, x]));
    for (const c of withVersion) {
      const person = people.get(c.person_id);
      const ver = versions.get(c.version_id as string);
      if (!person || !ver || ver.person_id !== c.person_id) continue;
      const r = renderVersion(ver, personData(person));
      if (r.ok && signatureHash(r.html) === c.new_hash) out.set(c.person_id, textFingerprint(r.html));
    }
    return out;
  };
}

export type Settings = { enabled: boolean; webhook_url: string | null; webhook_include_names: boolean; max_people: number };
const DEFAULTS: Settings = { enabled: false, webhook_url: null, webhook_include_names: false, max_people: HARD_CAP };

export async function loadSettings(client: SupabaseClient, orgId: string): Promise<Settings> {
  const { data, error } = await client.from("health_settings").select("enabled, webhook_url, webhook_include_names, max_people").eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  return (data as Settings | null) ?? DEFAULTS;
}

export type CheckOutcome = { run_id: string; done: boolean; checked: number; capped: boolean; failed: boolean; note: string; alert: "none" | "sent" | "failed"; alert_reason?: string };

type RunDeps = { client: SupabaseClient; service: boolean; orgId: string; mailbox: Mailbox; budgetMs: number; origin: string; post?: typeof sendWebhook; sleep?: Deps["sleep"]; now?: Deps["now"] };

/** One request's worth of checking: start or resume the run, work until done or out of time, then alert once if there are new findings. */
export async function checkOrg(o: RunDeps): Promise<CheckOutcome> {
  const settings = await loadSettings(o.client, o.orgId);
  const h = healthDb(o.client, o.service, o.orgId);
  const run = await h.startRun();
  const p: Progress = await continueRun(run, { store: h.store(), mailbox: o.mailbox, expected: expectedFrom(o.client, o.orgId), cap: settings.max_people, budgetMs: o.budgetMs, sleep: o.sleep, now: o.now });
  let alert: CheckOutcome["alert"] = "none";
  let alert_reason: string | undefined;
  if (p.done && !p.failed) {
    const sent = await notify(o, h, run.id, settings);
    alert = sent.alert;
    alert_reason = sent.reason;
  }
  return { run_id: run.id, done: p.done, checked: p.checked, capped: p.capped, failed: p.failed, note: p.note, alert, alert_reason };
}

/** Sends the one batched message for a finished run, at most once (the database hands out the claim once). Never throws. */
async function notify(o: RunDeps, h: ReturnType<typeof healthDb>, runId: string, s: Settings): Promise<{ alert: "none" | "sent" | "failed"; reason?: string }> {
  if (!s.webhook_url) return { alert: "none" };
  try {
    if (!(await h.claimNotification(runId))) return { alert: "none" };
    const { data: found } = await o.client.from("health_findings").select("kind, person_name, email").eq("run_id", runId).eq("status", "open").limit(500);
    const rows = (found ?? []) as { kind: string; person_name: string; email: string }[];
    const edited = rows.filter((r) => r.kind === "edited").length;
    const removed = rows.filter((r) => r.kind === "removed").length;
    const d: Delivery = await (o.post ?? sendWebhook)(
      s.webhook_url,
      buildMessage({ edited, removed, link: `${o.origin}/team/health`, names: s.webhook_include_names ? rows.map((r) => `${r.person_name || r.email} (${r.kind})`) : undefined }),
    );
    return d.ok ? { alert: "sent" } : { alert: "failed", reason: d.reason };
  } catch {
    return { alert: "failed", reason: "The alert could not be sent." };
  }
}

export type { Result };
