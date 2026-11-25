import { z } from "zod";
import { runPreview } from "@/lib/sync/run";
import { needFeature, noStore, syncAdmin, syncFailure } from "@/lib/sync/route";
import { SYNC_SOURCES } from "@/lib/sync/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Fetch the source, compute the diff against the directory and store it as a pending preview.
 * The people table is NOT touched; only the preview and a history entry are written.
 */
export async function POST(req: Request) {
  const a = await syncAdmin(req, z.object({ source: z.enum(SYNC_SOURCES) }));
  if (!a.ok) return a.response;
  const { source } = a.ctx.data;
  const blocked = await needFeature(a.ctx.ctx, source);
  if (blocked) return blocked;
  try {
    const p = await runPreview(a.ctx.ctx.supabase, "admin", a.ctx.ctx.orgId, source);
    return Response.json({ preview_id: p.previewId, stats: p.stats, refusal: p.refusal }, { headers: noStore });
  } catch (e) {
    return syncFailure(e);
  }
}
