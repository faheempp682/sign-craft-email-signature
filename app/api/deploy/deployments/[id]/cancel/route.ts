import { deny } from "@/lib/authz/guard";
import { deployAdmin, deployFailure, noStore, UUID_RE } from "@/lib/deploy/route";

export const runtime = "nodejs";

/** Stops a running deployment. People not reached yet are skipped; one already in flight finishes. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return deny(400, "bad_request", "Invalid id.");
  const a = await deployAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const own = await supabase.from("deployments").select("id").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (own.error) return deployFailure(own.error);
  if (!own.data) return deny(404, "not_found", "That deployment does not exist.");
  const { error } = await supabase.rpc("cancel_deployment", { p_dep: id });
  if (error) return deployFailure(error);
  return Response.json({ ok: true }, { headers: noStore });
}
