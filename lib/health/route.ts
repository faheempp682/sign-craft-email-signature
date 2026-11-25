import type { z } from "zod";
import { deny, type Guard } from "@/lib/authz/guard";
import { campaignAdmin, type AdminCtx } from "@/lib/campaigns/route";
import { cronAuthorized as syncCronAuthorized } from "@/lib/sync/route";
import { DwdError } from "@/lib/google-dwd/token";
import { HealthError } from "./service";

export const noStore = { "Cache-Control": "no-store" };
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Health admin routes: same-origin on writes, the `health_monitor` flag, the admin role, then the organization and the body. */
export function healthAdmin<S extends z.ZodType | null>(req: Request, schema: S): Promise<Guard<{ ctx: AdminCtx; data: S extends z.ZodType ? z.infer<S> : null }>> {
  return campaignAdmin(req, schema, "health_monitor");
}

/**
 * The unattended-run secret: `Authorization: Bearer <HEALTH_CRON_SECRET>`. This is exactly lib/sync's comparison (both sides hashed,
 * constant time, under 32 characters means off); only the variable name differs. It never reads SYNC_CRON_SECRET.
 */
export function cronAuthorized(req: Request, env: Record<string, string | undefined> = process.env): "ok" | "off" | "denied" {
  return syncCronAuthorized(req, { SYNC_CRON_SECRET: env.HEALTH_CRON_SECRET });
}

type DbError = { code?: string; message: string };

/** Maps our errors and the HM0xx errors raised by migration 0012 to HTTP answers. Messages are ours, never raw upstream text. */
export function healthFailure(e: unknown): Response {
  if (e instanceof HealthError) return deny(e.status, e.code === "not_configured" ? "not_configured" : "db", e.message);
  if (e instanceof DwdError) return deny(502, "upstream", e.message);
  const error = e as DbError;
  switch (error?.code) {
    case "HM001":
      return deny(404, "not_found", error.message);
    case "HM003":
    case "22023":
    case "23514":
      return deny(400, "bad_request", error.code === "23514" ? "One of the values is not allowed." : error.message);
    case "HM004":
      return deny(409, "conflict", error.message);
    case "HM006":
    case "42501":
      return deny(403, "forbidden", "You do not have permission to do that.");
    default:
      console.error("[health] database error:", error?.code);
      return deny(500, "db", "Could not complete that. Please try again.");
  }
}

/** Never show a stored webhook address in full: it usually contains a secret token. */
export function maskWebhook(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return "https://…";
  }
}
