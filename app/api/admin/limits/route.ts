import { adminRequest, dbFailure } from "@/lib/admin/route";
import { LimitSet } from "@/lib/admin/schemas";

export const runtime = "nodejs";

/** Set the per-minute and per-day AI limits for a role and feature. Blank (null) means no limit. Takes effect on the next request. */
export async function PUT(req: Request) {
  const a = await adminRequest(req, LimitSet);
  if (!a.ok) return a.response;
  const row = a.ctx.data;
  const { error } = await a.ctx.ctx.supabase.from("ai_limits").upsert(row, { onConflict: "role,feature" });
  if (error) return dbFailure(error);
  return Response.json(row, { headers: { "Cache-Control": "no-store" } });
}
