import { deny, featureEnabled } from "@/lib/authz/guard";
import { loadSettings, sourceStatus } from "@/lib/sync/run";
import { noStore, syncAdmin, syncFailure } from "@/lib/sync/route";
import { SOURCE_FEATURE, SOURCE_LABEL, SYNC_SOURCES, type SyncSource } from "@/lib/sync/types";

export const runtime = "nodejs";

type Row = Record<string, unknown>;

/**
 * Connection status for every source the caller's features allow, and exactly which environment variables are missing
 * (names only, never values), plus the pending preview and the last history entry of each.
 */
export async function GET(req: Request) {
  const a = await syncAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  try {
    const flags = { directory_sync: await featureEnabled(supabase, "directory_sync"), crm_sync: await featureEnabled(supabase, "crm_sync") };
    if (flags.directory_sync === null || flags.crm_sync === null) return deny(503, "authz_unavailable", "Access control is not set up yet.");
    const allowed = SYNC_SOURCES.filter((s) => flags[SOURCE_FEATURE[s]]);
    if (!allowed.length) return deny(403, "feature_disabled", "Directory sync and CRM sync are not enabled for your account.");

    const [pend, runs] = await Promise.all([
      supabase.from("sync_previews").select("id, source, trigger, created_at, expires_at, fetched_count, stats").eq("org_id", orgId).eq("status", "pending"),
      supabase.from("sync_runs").select("source, status, trigger, created_at, message").eq("org_id", orgId).order("created_at", { ascending: false }).limit(60),
    ]);
    if (pend.error) throw Object.assign(new Error(pend.error.message), { code: pend.error.code });

    const sources = [];
    for (const s of allowed) {
      const st = sourceStatus(s);
      const settings = await loadSettings(supabase, orgId, s);
      sources.push({
        source: s as SyncSource,
        label: SOURCE_LABEL[s],
        kind: SOURCE_FEATURE[s] === "crm_sync" ? "crm" : "directory",
        configured: st.configured,
        missing: st.missing,
        enabled: settings.enabled,
        auto_apply: settings.auto_apply,
        pending: ((pend.data ?? []) as Row[]).find((p) => p.source === s) ?? null,
        last_run: ((runs.data ?? []) as Row[]).find((r) => r.source === s) ?? null,
      });
    }
    const cap = (await loadSettings(supabase, orgId, allowed[0])).cap;
    return Response.json({ sources, safety_cap_percent: cap, cron_configured: (process.env.SYNC_CRON_SECRET ?? "").length >= 32 }, { headers: noStore });
  } catch (e) {
    return syncFailure(e);
  }
}
