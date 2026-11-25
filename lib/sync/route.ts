import { createHash, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { deny, featureEnabled, type Guard } from "@/lib/authz/guard";
import { campaignAdmin, type AdminCtx } from "@/lib/campaigns/route";
import { SyncError } from "./errors";
import { SyncDbError } from "./run";
import { SOURCE_FEATURE, SYNC_SOURCES, type SyncSource } from "./types";

export const noStore = { "Cache-Control": "no-store" };
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isSource = (v: unknown): v is SyncSource => typeof v === "string" && (SYNC_SOURCES as readonly string[]).includes(v);

/** Same-origin on writes, the admin role, then the organization and the body. The source's feature flag is checked by `needFeature`. */
export function syncAdmin<S extends z.ZodType | null>(req: Request, schema: S): Promise<Guard<{ ctx: AdminCtx; data: S extends z.ZodType ? z.infer<S> : null }>> {
  return campaignAdmin(req, schema, null);
}

/** 403 unless the feature behind this source (directory_sync or crm_sync) is on for the caller. */
export async function needFeature(ctx: AdminCtx, source: SyncSource): Promise<Response | null> {
  const on = await featureEnabled(ctx.supabase, SOURCE_FEATURE[source]);
  if (on === null) return deny(503, "authz_unavailable", "Access control is not set up yet.");
  return on ? null : deny(403, "feature_disabled", `${SOURCE_FEATURE[source] === "crm_sync" ? "CRM sync" : "Directory sync"} is not enabled for your account.`);
}

/** 403 unless at least one of the two sync features is on (settings and history are shared by all sources). */
export async function needAnyFeature(ctx: AdminCtx): Promise<Response | null> {
  const [d, c] = [await featureEnabled(ctx.supabase, "directory_sync"), await featureEnabled(ctx.supabase, "crm_sync")];
  if (d === null || c === null) return deny(503, "authz_unavailable", "Access control is not set up yet.");
  return d || c ? null : deny(403, "feature_disabled", "Directory sync and CRM sync are not enabled for your account.");
}

/** An error from the sources or the database, as the right HTTP answer. Messages are our own and never contain secrets. */
export function syncFailure(e: unknown): Response {
  if (e instanceof SyncError) {
    const status = { not_configured: 409, bad_config: 400, blocked: 400, not_authorized: 502, upstream: 502, too_large: 422 }[e.code];
    return deny(status, e.code, e.message);
  }
  if (e instanceof SyncDbError) {
    switch (e.code) {
      case "SY001":
        return deny(404, "not_found", e.message);
      case "SY002":
      case "SY003":
      case "SY004":
        return deny(409, e.code === "SY004" ? "stale" : "refused", e.message);
      case "SY006":
      case "22023":
      case "23514":
        return deny(400, "bad_request", e.code === "23514" ? "One of the values is not allowed." : e.message);
      case "SY007":
      case "42501":
        return deny(403, "forbidden", "You do not have permission to do that.");
      case "23505":
        return deny(409, "duplicate", "That change would give two people the same email or external id.");
      default:
        console.error("[sync] database error:", e.code);
        return deny(500, "db", "Could not save. Please try again.");
    }
  }
  console.error("[sync] unexpected error:", e instanceof Error ? e.name : typeof e);
  return deny(500, "internal", "Something went wrong. Please try again.");
}

/**
 * The unattended-run secret: `Authorization: Bearer <SYNC_CRON_SECRET>`. Both sides are hashed first, so the comparison is
 * constant-time whatever the length of the guess. A missing or short (under 32 characters) secret means the endpoint is off.
 */
export function cronAuthorized(req: Request, env: Record<string, string | undefined> = process.env): "ok" | "off" | "denied" {
  const secret = env.SYNC_CRON_SECRET ?? "";
  if (secret.length < 32) return "off";
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return "denied";
  const a = createHash("sha256").update(m[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b) ? "ok" : "denied";
}
