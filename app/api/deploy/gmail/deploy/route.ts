import { z } from "zod";
import { deployAdmin, deployFailure, noStore, UUID_RE } from "@/lib/deploy/route";
import { createGmailDeployment, serverMailbox } from "@/lib/deploy/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const ConfirmBody = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  set: z.number().int().min(0).max(100_000),
  replace: z.number().int().min(0).max(100_000),
  person_ids: z.array(z.string().regex(UUID_RE)).max(1000).nullish(),
  department: z.string().trim().max(80).nullish(),
  /** The admin ticked the explicit confirmation ("Deploy to 37 people, replacing 12 existing signatures"). */
  confirmed: z.literal(true),
});

/**
 * CONFIRM. Re-plans from scratch and creates the deployment only if the new plan has exactly the fingerprint (and the
 * counts) the admin reviewed. Nothing is written to Gmail here; the queue is worked through by the run route.
 */
export async function POST(req: Request) {
  const a = await deployAdmin(req, ConfirmBody);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const d = a.ctx.data;
  try {
    const { id, plan } = await createGmailDeployment(supabase, orgId, { personIds: d.person_ids, department: d.department || null }, { fingerprint: d.fingerprint, set: d.set, replace: d.replace }, serverMailbox());
    return Response.json({ id, counts: plan.counts }, { status: 201, headers: noStore });
  } catch (e) {
    return deployFailure(e);
  }
}
