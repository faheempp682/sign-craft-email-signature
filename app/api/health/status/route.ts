import { healthAdmin, healthFailure, maskWebhook, noStore } from "@/lib/health/route";
import { healthStatus } from "@/lib/health/service";

export const runtime = "nodejs";

const RUN_COLUMNS = "id, trigger, status, checked, ok, edited, removed, unreachable, reformatted, new_findings, resolved, capped, note, started_at, finished_at";

/** The status header: setup (names of missing variables only), settings (webhook masked), the last runs and the counts. */
export async function GET(req: Request) {
  const a = await healthAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  try {
    const [settings, runs, findings, people] = await Promise.all([
      supabase.from("health_settings").select("enabled, webhook_url, webhook_include_names, max_people").eq("org_id", orgId).maybeSingle(),
      supabase.from("health_runs").select(RUN_COLUMNS).eq("org_id", orgId).order("started_at", { ascending: false }).limit(5),
      supabase.from("health_findings").select("status").eq("org_id", orgId).in("status", ["open", "acknowledged"]).limit(5000),
      supabase.from("health_people").select("status").eq("org_id", orgId).limit(5000),
    ]);
    for (const r of [settings, runs, findings, people]) if (r.error) throw r.error;
    const s = (settings.data as { enabled: boolean; webhook_url: string | null; webhook_include_names: boolean; max_people: number } | null) ?? { enabled: false, webhook_url: null, webhook_include_names: false, max_people: 1000 };
    const count = (rows: { status: string }[] | null, v: string) => (rows ?? []).filter((x) => x.status === v).length;
    return Response.json(
      {
        setup: healthStatus(),
        settings: { enabled: s.enabled, has_webhook: !!s.webhook_url, webhook_masked: maskWebhook(s.webhook_url), include_names: s.webhook_include_names, max_people: s.max_people },
        runs: runs.data ?? [],
        counts: {
          open: count(findings.data as { status: string }[] | null, "open"),
          acknowledged: count(findings.data as { status: string }[] | null, "acknowledged"),
          monitored: (people.data ?? []).length,
          ok: count(people.data as { status: string }[] | null, "ok"),
          unreachable: count(people.data as { status: string }[] | null, "unreachable"),
        },
      },
      { headers: noStore },
    );
  } catch (e) {
    return healthFailure(e);
  }
}
