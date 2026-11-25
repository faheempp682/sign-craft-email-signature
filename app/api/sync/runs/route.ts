import { needAnyFeature, noStore, isSource, syncAdmin, syncFailure } from "@/lib/sync/route";
import { SyncDbError } from "@/lib/sync/run";

export const runtime = "nodejs";

/** The sync history, newest first (previews, applies, refusals and failures). */
export async function GET(req: Request) {
  const a = await syncAdmin(req, null);
  if (!a.ok) return a.response;
  const off = await needAnyFeature(a.ctx.ctx);
  if (off) return off;
  const { supabase, orgId } = a.ctx.ctx;
  const source = new URL(req.url).searchParams.get("source");
  let q = supabase.from("sync_runs").select("id, source, trigger, status, preview_id, created_at, message, stats, errors").eq("org_id", orgId);
  if (source && isSource(source)) q = q.eq("source", source);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(50);
  if (error) return syncFailure(new SyncDbError(error.code ?? "", error.message));
  return Response.json({ runs: data ?? [] }, { headers: noStore });
}
