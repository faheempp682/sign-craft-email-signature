import { healthAdmin, healthFailure, noStore } from "@/lib/health/route";

export const runtime = "nodejs";

const COLUMNS = "id, person_id, email, person_name, kind, status, detail, opened_at, last_seen_at, resolved_at, resolved_reason, acknowledged_at, ack_note";
const PAGE = 50;

/** Findings of the caller's organization. ?status=open|acknowledged|resolved (default: all), ?kind=edited|removed, ?page=0.. */
export async function GET(req: Request) {
  const a = await healthAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const u = new URL(req.url);
  const status = u.searchParams.get("status");
  const kind = u.searchParams.get("kind");
  const page = Math.max(0, Math.min(1000, parseInt(u.searchParams.get("page") ?? "0", 10) || 0));
  try {
    let q = supabase.from("health_findings").select(COLUMNS, { count: "exact" }).eq("org_id", orgId);
    if (status && ["open", "acknowledged", "resolved"].includes(status)) q = q.eq("status", status);
    if (kind && ["edited", "removed"].includes(kind)) q = q.eq("kind", kind);
    const { data, error, count } = await q.order("opened_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    return Response.json({ items: data ?? [], total: count ?? 0, page, page_size: PAGE }, { headers: noStore });
  } catch (e) {
    return healthFailure(e);
  }
}
