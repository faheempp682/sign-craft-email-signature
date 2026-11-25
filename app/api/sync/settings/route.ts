import { z } from "zod";
import { needAnyFeature, noStore, syncAdmin, syncFailure } from "@/lib/sync/route";
import { SyncDbError } from "@/lib/sync/run";
import { DEFAULT_SAFETY_CAP } from "@/lib/sync/types";

export const runtime = "nodejs";

/** Organization-wide sync settings: the safety cap and a free-text note about the schedule. */
export async function GET(req: Request) {
  const a = await syncAdmin(req, null);
  if (!a.ok) return a.response;
  const off = await needAnyFeature(a.ctx.ctx);
  if (off) return off;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("sync_settings").select("safety_cap_percent, schedule_note").eq("org_id", orgId).maybeSingle();
  if (error) return syncFailure(new SyncDbError(error.code ?? "", error.message));
  return Response.json({ safety_cap_percent: data?.safety_cap_percent ?? DEFAULT_SAFETY_CAP, schedule_note: data?.schedule_note ?? "" }, { headers: noStore });
}

const Body = z.object({
  safety_cap_percent: z.number().int().min(1, "The cap is at least 1 percent.").max(100, "The cap is at most 100 percent."),
  schedule_note: z.string().trim().max(200, "Keep the note under 200 characters."),
});

export async function PUT(req: Request) {
  const a = await syncAdmin(req, Body);
  if (!a.ok) return a.response;
  const off = await needAnyFeature(a.ctx.ctx);
  if (off) return off;
  const { supabase, user, orgId } = a.ctx.ctx;
  const { error } = await supabase.from("sync_settings").upsert({ org_id: orgId, ...a.ctx.data, updated_by: user.id });
  if (error) return syncFailure(new SyncDbError(error.code ?? "", error.message));
  return Response.json(a.ctx.data, { headers: noStore });
}
