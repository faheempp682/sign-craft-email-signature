import { deny } from "@/lib/authz/guard";
import { DEPLOYMENT_COLUMNS, deployAdmin, deployFailure, noStore, UUID_RE } from "@/lib/deploy/route";

export const runtime = "nodejs";

/** Signature bodies (the backups) are never sent to the browser. */
const ITEM_COLUMNS = "id, person_id, email, person_name, action, status, error_code, error, attempts, previous_known, previous_truncated, finished_at";
const STATUSES = ["pending", "running", "done", "failed", "skipped"];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return deny(400, "bad_request", "Invalid id.");
  const a = await deployAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const page = Math.max(0, Number(url.searchParams.get("page")) || 0);

  const dep = await supabase.from("deployments").select(DEPLOYMENT_COLUMNS).eq("org_id", orgId).eq("id", id).maybeSingle();
  if (dep.error) return deployFailure(dep.error);
  if (!dep.data) return deny(404, "not_found", "That deployment does not exist.");

  let q = supabase.from("deployment_items").select(ITEM_COLUMNS, { count: "exact" }).eq("org_id", orgId).eq("deployment_id", id).order("email").range(page * 100, page * 100 + 99);
  if (status && STATUSES.includes(status)) q = q.eq("status", status);
  const items = await q;
  if (items.error) return deployFailure(items.error);
  return Response.json({ deployment: dep.data, items: items.data ?? [], total: items.count ?? 0, page }, { headers: noStore });
}
