import type { UserCtx } from "@/lib/authz/guard";
import { readServiceAccount } from "@/lib/google-dwd/token";
import { renderVersion, type PersonData } from "@/lib/team/render";
import { PERSON_COLUMNS } from "@/lib/team/route";
import { effectiveRules, evaluate, honoured, ruleSupport, type Rule, type TemplateLite } from "@/lib/rules/evaluate";
import { classify, gmailMailbox, type Mailbox } from "./mailbox";
import { countPlan, decide, fingerprint, pool, precheck, withBackoff, type Live, type PlanItem } from "./plan";
import type { Item, Resolved, Store } from "./runner";

type Supabase = UserCtx["supabase"];

export const MAX_PLAN_PEOPLE = 1000;
const READ_CONCURRENCY = 5;

export type PlanFilter = { personIds?: string[] | null; department?: string | null };

type PersonRow = PersonData & { id: string; status: string; email: string; full_name: string };
type VersionRow = { id: string; person_id: string; version_no: number; template_id: string | null; template_snapshot: unknown; values_json: unknown };

export type GmailPlan = {
  items: PlanItem[];
  counts: ReturnType<typeof countPlan>;
  fingerprint: string;
  /** Reasons the whole batch cannot work (for example the Workspace has not authorised the service account). */
  blockers: string[];
  /** Active rules Gmail cannot follow (anything but department rules), so the admin knows they are not applied. */
  notHonoured: { id: string; name: string; reasons: string[] }[];
  rulesApplied: boolean;
  truncated: boolean;
};

export class DeployError extends Error {
  constructor(public readonly code: "not_configured" | "stale" | "blocked" | "nothing" | "too_many" | "db", message: string, public readonly status: number) {
    super(message);
  }
}

export const NOT_SET_UP = "Gmail deployment is not set up on this server. Set GOOGLE_SERVICE_ACCOUNT_JSON and authorise the service account in the Google Admin console (see the setup steps).";

export function serverMailbox(): Mailbox {
  const sa = readServiceAccount();
  if (!sa) throw new DeployError("not_configured", NOT_SET_UP, 503);
  return gmailMailbox(sa);
}

/* ---------------------------------------------------------------------------- loading */

export async function loadRulesAndTemplates(supabase: Supabase, orgId: string) {
  const [r, t] = await Promise.all([
    supabase.from("signature_rules").select("id, name, message_kind, audience, departments, priority, template_id, is_active, created_at").eq("org_id", orgId),
    supabase.from("brand_templates").select("id, name, departments, is_active, created_at").eq("org_id", orgId),
  ]);
  if (r.error) throw new DeployError("db", "Could not load the rules.", 500);
  if (t.error) throw new DeployError("db", "Could not load the templates.", 500);
  return { rules: (r.data ?? []) as Rule[], templates: (t.data ?? []) as TemplateLite[] };
}

async function loadPeople(supabase: Supabase, orgId: string, f: PlanFilter): Promise<PersonRow[]> {
  let q = supabase.from("people").select(PERSON_COLUMNS).eq("org_id", orgId).order("email").limit(MAX_PLAN_PEOPLE + 1);
  if (f.personIds?.length) q = q.in("id", f.personIds);
  if (f.department) q = q.ilike("department", f.department.replace(/[\\%_]/g, "\\$&"));
  const { data, error } = await q;
  if (error) throw new DeployError("db", "Could not load the directory.", 500);
  return (data ?? []) as unknown as PersonRow[];
}

/** The newest approved version per person (the version to deploy). */
export async function latestApproved(supabase: Supabase, orgId: string, personIds: string[]): Promise<Map<string, VersionRow>> {
  const out = new Map<string, VersionRow>();
  for (let i = 0; i < personIds.length; i += 100) {
    const { data, error } = await supabase
      .from("signature_versions")
      .select("id, person_id, version_no, template_id, template_snapshot, values_json")
      .eq("org_id", orgId)
      .eq("status", "approved")
      .in("person_id", personIds.slice(i, i + 100))
      .order("version_no", { ascending: false });
    if (error) throw new DeployError("db", "Could not load the approved signatures.", 500);
    for (const v of (data ?? []) as VersionRow[]) if (!out.has(v.person_id)) out.set(v.person_id, v);
  }
  return out;
}

const personData = (p: PersonRow): PersonData => ({ email: p.email, full_name: p.full_name, first_name: p.first_name, last_name: p.last_name, title: p.title, department: p.department, phone: p.phone, mobile: p.mobile, location: p.location, custom: p.custom });

/* ------------------------------------------------------------------------------ plan */

export async function buildGmailPlan(supabase: Supabase, orgId: string, filter: PlanFilter, mailbox: Mailbox, sleep?: (ms: number) => Promise<void>): Promise<GmailPlan> {
  const people = await loadPeople(supabase, orgId, filter);
  if (people.length > MAX_PLAN_PEOPLE) throw new DeployError("too_many", `That is more than ${MAX_PLAN_PEOPLE} people. Pick a department or specific people and deploy in parts.`, 400);
  const { rules, templates } = await loadRulesAndTemplates(supabase, orgId);
  const versions = await latestApproved(supabase, orgId, people.filter((p) => p.status === "active").map((p) => p.id));

  const explicit = rules.filter((r) => r.is_active);
  const rulesApplied = explicit.length > 0;
  const notHonoured = explicit.filter((r) => ruleSupport(r, "gmail").level === "unsupported").map((r) => ({ id: r.id, name: r.name, reasons: ruleSupport(r, "gmail").reasons }));
  const gmailRules = honoured(effectiveRules(explicit, templates), "gmail");

  const prepared = people.map((p) => {
    const v = versions.get(p.id) ?? null;
    const expected = rulesApplied ? (evaluate({ department: p.department ?? "", kind: "new", audience: "external" }, gmailRules).winner?.template_id ?? null) : null;
    const render = v ? renderVersion(v, personData(p)) : null;
    const input = { person: { id: p.id, email: p.email, full_name: p.full_name, status: p.status }, version: v ? { id: v.id, template_id: v.template_id } : null, expectedTemplateId: rulesApplied ? (expected ?? "none") : null, render: render ? (render.ok ? { ok: true as const, html: render.html } : { ok: false as const, error: render.error }) : null };
    return { input, early: precheck(input) };
  });

  const blockers = new Set<string>();
  const live = new Map<string, Live>();
  await pool(
    prepared.filter((x) => !x.early),
    READ_CONCURRENCY,
    async ({ input }) => {
      try {
        const sig = await withBackoff(() => mailbox.read(input.person.email), { retryable: (e) => classify(e).retryable, sleep });
        live.set(input.person.id, { ok: true, signature: sig });
      } catch (e) {
        const c = classify(e);
        if (c.kind === "setup") blockers.add(c.message);
        live.set(input.person.id, { ok: false, code: c.kind === "no_mailbox" ? "no_mailbox" : c.kind === "cannot_act" || c.kind === "setup" ? "cannot_act" : "unreadable", message: c.kind === "rate_limited" || c.kind === "upstream" ? `${c.message} Plan again in a minute.` : c.message });
      }
    },
  );

  const items = prepared.map(({ input }) => decide({ ...input, live: live.get(input.person.id) ?? null }));
  return { items, counts: countPlan(items), fingerprint: fingerprint(orgId, items), blockers: [...blockers], notHonoured, rulesApplied, truncated: false };
}

/** Public shape of a plan item (no signature bodies). */
export const publicItem = (x: PlanItem) => ({ person_id: x.person_id, email: x.email, name: x.name, action: x.action, code: x.code, reason: x.reason, has_existing: x.has_existing });

/* ------------------------------------------------------------------------- confirm */

export async function createGmailDeployment(supabase: Supabase, orgId: string, filter: PlanFilter, confirm: { fingerprint: string; set: number; replace: number }, mailbox: Mailbox): Promise<{ id: string; plan: GmailPlan }> {
  const plan = await buildGmailPlan(supabase, orgId, filter, mailbox);
  if (plan.fingerprint !== confirm.fingerprint || plan.counts.set !== confirm.set || plan.counts.replace !== confirm.replace)
    throw new DeployError("stale", "Something changed since you reviewed the plan (a signature, an approval, the directory or someone's Gmail signature). Nothing was written. Review the new plan and confirm again.", 409);
  if (plan.blockers.length) throw new DeployError("blocked", plan.blockers[0], 409);
  if (!plan.counts.actionable) throw new DeployError("nothing", "There is nothing to deploy: every person is skipped or already up to date.", 400);

  const payload = plan.items.map((x) => ({
    person_id: x.person_id, version_id: x.version_id, action: x.action, status: x.action === "skip" ? "skipped" : "pending",
    expect_hash: x.expect_hash, new_hash: x.new_hash, previous_hash: x.previous_hash, error_code: x.code, error: x.action === "skip" ? x.reason : "",
  }));
  const { data, error } = await supabase.rpc("create_deployment", { p_org: orgId, p_target: "gmail", p_fingerprint: plan.fingerprint, p_items: payload, p_note: `${plan.counts.set} set, ${plan.counts.replace} replaced` });
  if (error) throw error;
  return { id: data as string, plan };
}

/* ------------------------------------------------------------------------ the queue */

export function dbStore(supabase: Supabase, depId: string): Store {
  const must = (error: { message: string } | null) => {
    if (error) throw error;
  };
  return {
    async claim(limit) {
      const { data, error } = await supabase.rpc("claim_deployment_items", { p_dep: depId, p_limit: limit });
      must(error);
      return ((data ?? []) as Item[]).map((i) => ({ id: i.id, email: i.email, action: i.action, expect_hash: i.expect_hash, new_hash: i.new_hash, new_signature: i.new_signature, previous_known: i.previous_known, attempts: i.attempts, person_id: i.person_id }));
    },
    async recordPrevious(id, signature, truncated) {
      must((await supabase.rpc("record_previous_signature", { p_item: id, p_signature: signature, p_truncated: truncated })).error);
    },
    async finish(id, status, code, message) {
      must((await supabase.rpc("finish_deployment_item", { p_item: id, p_status: status, p_error_code: code, p_error: message })).error);
    },
    async release(id, code) {
      must((await supabase.rpc("release_deployment_item", { p_item: id, p_error_code: code })).error);
    },
  };
}

/** The signature to write for an item: a stored backup for a restore, otherwise the person's newest approved version rendered now. */
export function dbResolver(supabase: Supabase, orgId: string): (item: Item) => Promise<Resolved> {
  return async (item) => {
    if (item.action === "restore") return item.new_signature === null ? { ok: false, code: "no_backup", message: "There is no saved signature to restore." } : { ok: true, html: item.new_signature };
    if (!item.person_id) return { ok: false, code: "person_removed", message: "This person is no longer in the directory." };
    const { data, error } = await supabase.from("people").select(PERSON_COLUMNS).eq("org_id", orgId).eq("id", item.person_id).maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, code: "person_removed", message: "This person is no longer in the directory." };
    const p = data as unknown as PersonRow;
    if (p.status !== "active") return { ok: false, code: "inactive", message: "This person was marked inactive after the plan was made." };
    if (p.email.toLowerCase() !== item.email.toLowerCase()) return { ok: false, code: "changed", message: "The person's email changed after the plan was made. Plan again." };
    const v = (await latestApproved(supabase, orgId, [p.id])).get(p.id);
    if (!v) return { ok: false, code: "no_version", message: "They no longer have an approved signature." };
    const r = renderVersion(v, personData(p));
    return r.ok ? { ok: true, html: r.html } : { ok: false, code: "render_failed", message: r.error };
  };
}
