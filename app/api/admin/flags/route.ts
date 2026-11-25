import { adminRequest, dbFailure } from "@/lib/admin/route";
import { FlagPatch } from "@/lib/admin/schemas";
import { deny } from "@/lib/authz/guard";

export const runtime = "nodejs";

/** Change a feature's default (on/off) or the minimum role that gets it by default. */
export async function PATCH(req: Request) {
  const a = await adminRequest(req, FlagPatch);
  if (!a.ok) return a.response;
  const { feature, default_enabled, min_role } = a.ctx.data;
  const patch = { ...(default_enabled !== undefined && { default_enabled }), ...(min_role !== undefined && { min_role }) };
  const { data, error } = await a.ctx.ctx.supabase.from("feature_flags").update(patch).eq("feature", feature).select("feature, default_enabled, min_role").maybeSingle();
  if (error) return dbFailure(error);
  if (!data) return deny(404, "not_found", "That feature does not exist.");
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
