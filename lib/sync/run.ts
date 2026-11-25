import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCrmConfig, type GenericConfigT, type HubspotConfigT } from "./crm-config";
import { diffCrm, diffDirectory, safetyProblem } from "./diff";
import { SyncError } from "./errors";
import { fetchGenericAll, genericMissing, type GenericDeps } from "./generic-crm";
import { fetchGoogleDirectory, googleMissing } from "./google-directory";
import { fetchHubspot, hubspotMissing } from "./hubspot";
import { fetchMicrosoftDirectory, microsoftMissing } from "./microsoft-directory";
import {
  DEFAULT_SAFETY_CAP,
  isCrm,
  isDirectory,
  type ExistingPerson,
  type FieldPolicy,
  type Plan,
  type PlanStats,
  type SourceSettings,
  type SyncSource,
  type SyncWarning,
} from "./types";

type Env = Record<string, string | undefined>;
export type Deps = { env?: Env; fetchFn?: typeof fetch } & GenericDeps;

/** Which environment variables a source still needs. Names only, never values. */
export function sourceStatus(source: SyncSource, env: Env = process.env): { configured: boolean; missing: string[] } {
  const missing = source === "google" ? googleMissing(env) : source === "microsoft" ? microsoftMissing(env) : source === "hubspot" ? hubspotMissing(env) : genericMissing(env);
  return { configured: missing.length === 0, missing };
}

export const DEFAULT_SETTINGS: SourceSettings = { enabled: false, auto_apply: false, allow_blank_overwrite: false, field_policy: {}, config: {} };

/* ------------------------------------------------------------------ database access */

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function loadSettings(db: SupabaseClient, orgId: string, source: SyncSource): Promise<SourceSettings & { cap: number }> {
  const [s, c] = await Promise.all([
    db.from("sync_sources").select("enabled, auto_apply, allow_blank_overwrite, field_policy, config").eq("org_id", orgId).eq("source", source).maybeSingle(),
    db.from("sync_settings").select("safety_cap_percent").eq("org_id", orgId).maybeSingle(),
  ]);
  if (s.error) throw dbError(s.error);
  if (c.error) throw dbError(c.error);
  const r = s.data as Row | null;
  const policy: FieldPolicy = {};
  for (const [k, v] of Object.entries((r?.field_policy as Record<string, unknown>) ?? {})) if (v === "source" || v === "directory") policy[k] = v;
  return {
    enabled: r?.enabled === true,
    auto_apply: r?.auto_apply === true,
    allow_blank_overwrite: r?.allow_blank_overwrite === true,
    field_policy: policy,
    config: (r?.config as Record<string, unknown>) ?? {},
    cap: typeof (c.data as Row | null)?.safety_cap_percent === "number" ? ((c.data as Row).safety_cap_percent as number) : DEFAULT_SAFETY_CAP,
  };
}

const PEOPLE_COLUMNS = "id, email, full_name, first_name, last_name, title, department, phone, mobile, location, custom, source, external_id, status";

export async function loadPeople(db: SupabaseClient, orgId: string): Promise<ExistingPerson[]> {
  const out: ExistingPerson[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await db.from("people").select(PEOPLE_COLUMNS).eq("org_id", orgId).order("id").range(from, from + 999);
    if (error) throw dbError(error);
    for (const r of (data ?? []) as Row[]) {
      out.push({
        id: str(r.id), email: str(r.email), full_name: str(r.full_name), first_name: str(r.first_name), last_name: str(r.last_name), title: str(r.title), department: str(r.department),
        phone: str(r.phone), mobile: str(r.mobile), location: str(r.location), custom: (r.custom as Record<string, string>) ?? {}, source: str(r.source),
        external_id: typeof r.external_id === "string" ? r.external_id : null, status: r.status === "inactive" ? "inactive" : "active",
      });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** A database failure with the SY0xx code the migration raised, so routes can answer with the right status. */
export class SyncDbError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function dbError(e: { code?: string; message: string }): SyncDbError {
  return new SyncDbError(e.code ?? "", e.message);
}

/* ------------------------------------------------------------------------ preview */

export type Built = { plan: Plan; stats: PlanStats; warnings: SyncWarning[] };

/** Fetch the source, map it and compute the diff against the directory. Writes nothing. */
export async function buildPreview(db: SupabaseClient, orgId: string, source: SyncSource, settings: SourceSettings, deps: Deps = {}): Promise<Built> {
  const people = await loadPeople(db, orgId);
  if (isDirectory(source)) {
    const fetched = source === "google" ? await fetchGoogleDirectory(deps) : await fetchMicrosoftDirectory(deps);
    const { plan, stats } = diffDirectory({ source, fetched, existing: people, policy: settings.field_policy, allowBlankOverwrite: settings.allow_blank_overwrite });
    return { plan, stats, warnings: plan.warnings };
  }
  const parsed = parseCrmConfig(source, settings.config);
  if (!parsed.ok) throw new SyncError("bad_config", `The ${source === "hubspot" ? "HubSpot" : "CRM"} mapping is not set up yet: ${parsed.message}`);
  const emails = people.filter((p) => p.status === "active").map((p) => p.email.toLowerCase());
  const got = source === "hubspot" ? await fetchHubspot(parsed.config as HubspotConfigT, emails, deps) : await fetchGenericAll(parsed.config as GenericConfigT, emails, deps);
  const { plan, stats } = diffCrm({ records: got.records, people, policy: settings.field_policy, defaultPolicy: "directory", allowBlankOverwrite: settings.allow_blank_overwrite, fetchedWarnings: got.warnings });
  stats.skipped += got.skipped - got.warnings.length;
  return { plan, stats, warnings: plan.warnings };
}

export type Mode = "admin" | "service";
const fn = (mode: Mode, name: string) => (mode === "service" ? `${name}_service` : name);

export async function savePreview(db: SupabaseClient, mode: Mode, orgId: string, source: SyncSource, b: Built): Promise<string> {
  const { data, error } = await db.rpc(fn(mode, "save_sync_preview"), {
    p_org: orgId,
    p_source: source,
    p_plan: b.plan,
    p_stats: b.stats,
    p_fetched: b.stats.fetched,
    p_errors: b.warnings.slice(0, 100),
  });
  if (error || typeof data !== "string") throw dbError(error ?? { message: "No preview id returned." });
  return data;
}

export async function applyPreview(db: SupabaseClient, mode: Mode, previewId: string): Promise<Record<string, number>> {
  const { data, error } = await db.rpc(fn(mode, "apply_sync_preview"), { p_preview: previewId });
  if (error) throw dbError(error);
  return (data ?? {}) as Record<string, number>;
}

/** Best effort: a failure to write the history must not hide the real problem. */
export async function logEvent(db: SupabaseClient, mode: Mode, orgId: string, source: SyncSource, status: "blocked" | "failed", message: string, stats: object = {}, previewId: string | null = null): Promise<void> {
  const { error } = await db.rpc(fn(mode, "log_sync_event"), { p_org: orgId, p_source: source, p_status: status, p_message: message.slice(0, 500), p_stats: stats, p_errors: [], p_preview: previewId });
  if (error) console.error("[sync] could not write history:", error.code);
}

export type PreviewOutcome = { previewId: string; stats: PlanStats; refusal: string | null };

/** The whole preview step: build, store, and say whether the safety rules would allow applying it. */
export async function runPreview(db: SupabaseClient, mode: Mode, orgId: string, source: SyncSource, deps: Deps = {}): Promise<PreviewOutcome & { settings: SourceSettings & { cap: number } }> {
  const settings = await loadSettings(db, orgId, source);
  let built: Built;
  try {
    built = await buildPreview(db, orgId, source, settings, deps);
  } catch (e) {
    if (e instanceof SyncError) await logEvent(db, mode, orgId, source, "failed", e.message);
    throw e;
  }
  const previewId = await savePreview(db, mode, orgId, source, built);
  return { previewId, stats: built.stats, refusal: safetyProblem(isCrm(source) ? "crm" : "directory", built.stats, settings.cap), settings };
}

export type RunResult =
  | { status: "applied"; previewId: string; stats: Record<string, number> }
  | { status: "pending"; previewId: string; reason: string }
  | { status: "blocked"; previewId: string; reason: string }
  | { status: "failed"; reason: string };

/** One unattended run for one source: preview, then apply only if auto-apply is on and the safety cap passes. Never throws. */
export async function runUnattended(db: SupabaseClient, orgId: string, source: SyncSource, deps: Deps = {}): Promise<RunResult> {
  let p: Awaited<ReturnType<typeof runPreview>>;
  try {
    p = await runPreview(db, "service", orgId, source, deps);
  } catch (e) {
    const reason = e instanceof SyncError || e instanceof SyncDbError ? e.message : "Unexpected error.";
    if (!(e instanceof SyncError)) console.error("[sync] unattended preview failed:", source, e instanceof SyncDbError ? e.code : "");
    if (!(e instanceof SyncError)) await logEvent(db, "service", orgId, source, "failed", reason);
    return { status: "failed", reason };
  }
  if (p.refusal) {
    await logEvent(db, "service", orgId, source, "blocked", p.refusal, p.stats, p.previewId);
    return { status: "blocked", previewId: p.previewId, reason: p.refusal };
  }
  if (!p.settings.auto_apply) return { status: "pending", previewId: p.previewId, reason: "Auto-apply is off. An admin must confirm this preview." };
  if (p.stats.creates + p.stats.updates + p.stats.deactivates === 0) return { status: "pending", previewId: p.previewId, reason: "Nothing to change." };
  try {
    return { status: "applied", previewId: p.previewId, stats: await applyPreview(db, "service", p.previewId) };
  } catch (e) {
    const reason = e instanceof SyncDbError ? e.message : "Unexpected error.";
    await logEvent(db, "service", orgId, source, "blocked", reason, p.stats, p.previewId);
    return { status: "blocked", previewId: p.previewId, reason };
  }
}
