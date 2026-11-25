import { z } from "zod";
import { deployFailure, deployAdmin, noStore, UUID_RE } from "@/lib/deploy/route";
import { buildGmailPlan, publicItem, serverMailbox } from "@/lib/deploy/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const PlanBody = z.object({
  person_ids: z.array(z.string().regex(UUID_RE)).max(1000).nullish(),
  department: z.string().trim().max(80).nullish(),
});

/**
 * PLAN (dry run). Reads each targeted person's current Gmail signature with the delegated token and reports what would
 * happen. Writes nothing anywhere, in Gmail or in the database.
 */
export async function POST(req: Request) {
  const a = await deployAdmin(req, PlanBody);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  try {
    const plan = await buildGmailPlan(supabase, orgId, { personIds: a.ctx.data.person_ids, department: a.ctx.data.department || null }, serverMailbox());
    return Response.json({ ...plan, items: plan.items.map(publicItem) }, { headers: noStore });
  } catch (e) {
    return deployFailure(e);
  }
}
