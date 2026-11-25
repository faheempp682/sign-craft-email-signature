import { siteOrigin } from "@/lib/cards/public";
import { healthAdmin, healthFailure, noStore } from "@/lib/health/route";
import { checkOrg, serverMailbox } from "@/lib/health/service";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Time one request may spend before it hands back "not finished": the screen calls again and the run resumes from its cursor. */
const BUDGET_MS = 40_000;

/**
 * RUN CHECK NOW. Starts a run (or resumes the one already running) and checks people in batches until the time budget is
 * used. `done: false` means call again. Reads signatures only; it never writes to Gmail.
 */
export async function POST(req: Request) {
  const a = await healthAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  try {
    const out = await checkOrg({ client: supabase, service: false, orgId, mailbox: serverMailbox(), budgetMs: BUDGET_MS, origin: siteOrigin(req.headers) });
    return Response.json(out, { headers: noStore });
  } catch (e) {
    return healthFailure(e);
  }
}
