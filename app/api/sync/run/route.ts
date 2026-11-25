import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized, isSource, noStore } from "@/lib/sync/route";
import { runUnattended } from "@/lib/sync/run";
import { SOURCE_FEATURE, type SyncSource } from "@/lib/sync/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ org_id: z.string().uuid().optional(), source: z.string().optional() }).strict();

/**
 * Unattended sync, for a scheduler (cron). NOT a browser endpoint: no cookie, no same-origin check, only the secret.
 *   POST /api/sync/run   Authorization: Bearer <SYNC_CRON_SECRET>   optional JSON { org_id, source }
 * For every ENABLED source of every organization (whose feature flag is on) it computes a preview and applies it ONLY when the
 * organization turned on auto-apply for that source and the safety cap passes; otherwise the preview stays pending for an admin.
 * Runs with the service role (the database functions *_service). Needs SUPABASE_SERVICE_ROLE_KEY.
 * The answer lists organization ids, sources and outcomes, never names or emails.
 */
export async function POST(req: Request) {
  const auth = cronAuthorized(req);
  if (auth === "off") return deny(503, "not_configured", "Unattended sync is off: set SYNC_CRON_SECRET (at least 32 characters).");
  if (auth === "denied") return deny(401, "unauthorized", "Not authorized.");

  let body: z.infer<typeof Body> = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      const p = Body.safeParse(JSON.parse(text));
      if (!p.success) return deny(400, "bad_request", "Invalid body.");
      body = p.data;
    } catch {
      return deny(400, "bad_request", "Body must be JSON.");
    }
  }
  if (body.source !== undefined && !isSource(body.source)) return deny(400, "bad_request", "Unknown source.");

  const db = createAdminClient();
  if (!db) return deny(503, "not_configured", "SUPABASE_SERVICE_ROLE_KEY is not set, so unattended sync cannot run.");

  let q = db.from("sync_sources").select("org_id, source").eq("enabled", true);
  if (body.org_id) q = q.eq("org_id", body.org_id);
  if (body.source) q = q.eq("source", body.source);
  const { data, error } = await q.order("org_id").limit(500);
  if (error) {
    console.error("[sync] cron could not list sources:", error.code);
    return deny(500, "db", "Could not read the sync settings.");
  }

  const results: { org_id: string; source: string; status: string; reason?: string }[] = [];
  for (const row of (data ?? []) as { org_id: string; source: SyncSource }[]) {
    if (!isSource(row.source)) continue;
    const on = await db.rpc("sync_feature_on", { p_org: row.org_id, p_feature: SOURCE_FEATURE[row.source] });
    if (on.error || on.data !== true) {
      results.push({ org_id: row.org_id, source: row.source, status: "skipped", reason: "The feature is off for this organization." });
      continue;
    }
    const r = await runUnattended(db, row.org_id, row.source);
    results.push({ org_id: row.org_id, source: row.source, status: r.status, reason: "reason" in r ? r.reason : undefined });
  }
  return Response.json({ ran: results.length, results }, { headers: noStore });
}
