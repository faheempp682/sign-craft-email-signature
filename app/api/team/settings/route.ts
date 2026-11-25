import { z } from "zod";
import { noStore, teamAdmin, teamFailure } from "@/lib/team/route";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const a = await teamAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("org_settings").select("require_approval").eq("org_id", orgId).maybeSingle();
  if (error) return teamFailure(error);
  return Response.json({ require_approval: data?.require_approval ?? false }, { headers: noStore });
}

/** Turn the approval requirement on or off for the organization (default off). */
export async function PUT(req: Request) {
  const a = await teamAdmin(req, z.object({ require_approval: z.boolean() }));
  if (!a.ok) return a.response;
  const { supabase, user, orgId } = a.ctx.ctx;
  const { error } = await supabase.from("org_settings").upsert({ org_id: orgId, require_approval: a.ctx.data.require_approval, updated_by: user.id });
  if (error) return teamFailure(error);
  return Response.json({ require_approval: a.ctx.data.require_approval }, { headers: noStore });
}
