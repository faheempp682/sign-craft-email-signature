import { deny } from "@/lib/authz/guard";
import { siteOrigin } from "@/lib/cards/public";
import { cronAuthorized, noStore } from "@/lib/health/route";
import { checkOrg, serverMailbox } from "@/lib/health/service";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const BUDGET_MS = 240_000;

/**
 * Unattended check, for a scheduler (cron). NOT a browser endpoint: no cookie, no same-origin check, only the secret.
 *   POST /api/health/run   Authorization: Bearer <HEALTH_CRON_SECRET>
 * Visits every organization that switched the monitor on (and whose health_monitor feature is on), within one time budget; a run that
 * does not finish is resumed by the next call. Needs SUPABASE_SERVICE_ROLE_KEY and the Gmail service account.
 * The answer holds counts and run ids only: no names, no emails, no organization names.
 */
export async function POST(req: Request) {
  const auth = cronAuthorized(req);
  if (auth === "off") return deny(503, "not_configured", "Unattended health checks are off: set HEALTH_CRON_SECRET (at least 32 characters).");
  if (auth === "denied") return deny(401, "unauthorized", "Not authorized.");

  const db = createAdminClient();
  if (!db) return deny(503, "not_configured", "SUPABASE_SERVICE_ROLE_KEY is not set, so unattended checks cannot run.");
  let mailbox;
  try {
    mailbox = serverMailbox();
  } catch {
    return deny(503, "not_configured", "GOOGLE_SERVICE_ACCOUNT_JSON is not set, so no mailbox can be read.");
  }

  const orgs = await db.rpc("health_enabled_orgs_service");
  if (orgs.error) {
    console.error("[health] cron could not list organizations:", orgs.error.code);
    return deny(500, "db", "Could not read the health settings.");
  }
  const started = Date.now();
  const results: { run_id?: string; status: string; checked?: number; capped?: boolean; alert?: string }[] = [];
  for (const orgId of (orgs.data ?? []) as string[]) {
    const left = BUDGET_MS - (Date.now() - started);
    if (left < 5_000) {
      results.push({ status: "deferred" });
      continue;
    }
    try {
      const r = await checkOrg({ client: db, service: true, orgId, mailbox, budgetMs: left, origin: siteOrigin(req.headers) });
      results.push({ run_id: r.run_id, status: r.failed ? "failed" : r.done ? "completed" : "continues", checked: r.checked, capped: r.capped, alert: r.alert });
    } catch (e) {
      console.error("[health] cron organization failed:", (e as { code?: string })?.code ?? "error");
      results.push({ status: "error" });
    }
  }
  return Response.json({ ran: results.length, results }, { headers: noStore });
}
