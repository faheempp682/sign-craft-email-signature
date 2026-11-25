import { deny } from "@/lib/authz/guard";
import { safetyProblem } from "@/lib/sync/diff";
import { loadSettings } from "@/lib/sync/run";
import { isSource, needFeature, noStore, syncAdmin, syncFailure, UUID_RE } from "@/lib/sync/route";
import { isCrm, TEXT_FIELDS, type Plan, type PlanStats } from "@/lib/sync/types";

export const runtime = "nodejs";

export type Entry = { kind: "create" | "update" | "deactivate"; email: string; name: string; changes: { field: string; from: string; to: string }[] };

/** The diff of one preview, filtered and paged on the server (a directory can have thousands of changes). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return deny(400, "bad_request", "Invalid id.");
  const a = await syncAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  try {
    const { data, error } = await supabase.from("sync_previews").select("id, org_id, source, status, trigger, created_at, expires_at, fetched_count, stats, errors, plan").eq("id", id).maybeSingle();
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    if (!data || data.org_id !== orgId || !isSource(data.source)) return deny(404, "not_found", "That preview does not exist.");
    const blocked = await needFeature(a.ctx.ctx, data.source);
    if (blocked) return blocked;

    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") ?? "all";
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 100);
    const field = url.searchParams.get("field") ?? "";
    const offset = Math.max(0, Math.min(100_000, Number(url.searchParams.get("offset")) || 0));
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 50));

    const plan = data.plan as Plan;
    const all: Entry[] = [
      ...plan.creates.map((c): Entry => ({ kind: "create", email: c.email, name: c.full_name, changes: TEXT_FIELDS.filter((f) => c[f]).map((f) => ({ field: f, from: "", to: c[f] })) })),
      ...plan.updates.map((u): Entry => ({ kind: "update", email: u.email, name: u.name, changes: u.changes })),
      ...plan.deactivates.map((d): Entry => ({ kind: "deactivate", email: d.email, name: d.name, changes: [{ field: "status", from: "active", to: "inactive" }] })),
    ];
    const filtered = all.filter((e) => (kind === "all" || e.kind === kind) && (!q || e.email.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)) && (!field || e.changes.some((c) => c.field === field)));
    const cap = (await loadSettings(supabase, orgId, data.source)).cap;
    return Response.json(
      {
        preview: { id: data.id, source: data.source, status: data.status, trigger: data.trigger, created_at: data.created_at, expires_at: data.expires_at, fetched_count: data.fetched_count, stats: data.stats, warnings: plan.warnings ?? [] },
        refusal: safetyProblem(isCrm(data.source) ? "crm" : "directory", data.stats as PlanStats, cap),
        total: filtered.length,
        entries: filtered.slice(offset, offset + limit),
      },
      { headers: noStore },
    );
  } catch (e) {
    return syncFailure(e);
  }
}
