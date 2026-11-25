import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { deployAdmin, deployFailure, noStore, UUID_RE } from "@/lib/deploy/route";

export const runtime = "nodejs";

const Body = z.object({
  /** How many signatures the admin was shown and agreed to restore. A different count now means nothing is created. */
  expected: z.number().int().min(1).max(100_000),
  confirmed: z.literal(true),
});

/**
 * Creates a rollback deployment that restores the previous signatures saved before each write. Nothing is written to
 * Gmail here; the run route does that. Only after explicit confirmation, and only for items that were done and backed up.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return deny(400, "bad_request", "Invalid id.");
  const a = await deployAdmin(req, Body);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const own = await supabase.from("deployments").select("id").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (own.error) return deployFailure(own.error);
  if (!own.data) return deny(404, "not_found", "That deployment does not exist.");
  const { data, error } = await supabase.rpc("create_rollback", { p_dep: id, p_expected: a.ctx.data.expected });
  if (error) return deployFailure(error);
  return Response.json({ id: data as string }, { status: 201, headers: noStore });
}
