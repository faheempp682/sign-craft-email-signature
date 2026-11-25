import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { applyPreview, logEvent, SyncDbError } from "@/lib/sync/run";
import { isSource, needFeature, noStore, syncAdmin, syncFailure, UUID_RE } from "@/lib/sync/route";

export const runtime = "nodejs";

/**
 * Confirm a preview. The change applies in ONE database transaction (apply_sync_preview), which also enforces the safety
 * cap and refuses an empty source, a replaced or stale (over 24 hours old) preview and a non-admin caller.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return deny(400, "bad_request", "Invalid id.");
  const a = await syncAdmin(req, z.object({ confirm: z.literal(true) }));
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  try {
    const { data, error } = await supabase.from("sync_previews").select("org_id, source, stats").eq("id", id).maybeSingle();
    if (error) throw new SyncDbError(error.code ?? "", error.message);
    if (!data || data.org_id !== orgId || !isSource(data.source)) return deny(404, "not_found", "That preview does not exist.");
    const blocked = await needFeature(a.ctx.ctx, data.source);
    if (blocked) return blocked;
    try {
      const stats = await applyPreview(supabase, "admin", id);
      return Response.json({ applied: true, stats }, { headers: noStore });
    } catch (e) {
      // a refusal by the safety rules is kept in the history; the preview stays pending so the admin can read it
      if (e instanceof SyncDbError && (e.code === "SY002" || e.code === "SY003")) await logEvent(supabase, "admin", orgId, data.source, "blocked", e.message, data.stats as object, id);
      throw e;
    }
  } catch (e) {
    return syncFailure(e);
  }
}
