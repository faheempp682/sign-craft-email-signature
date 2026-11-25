import type { z } from "zod";
import { deny, type Guard } from "@/lib/authz/guard";
import { campaignAdmin, type AdminCtx } from "@/lib/campaigns/route";
import { deployStatus } from "./config";
import { DeployError } from "./service";

export { UUID_RE, noStore } from "@/lib/team/route";

export const DEPLOYMENT_COLUMNS = "id, target, kind, rollback_of, status, note, total, done, failed, skipped, pending, created_at, finished_at, cancelled_at";

/** Deploy admin routes: same-origin on writes, the `team_deploy` flag, the admin role, then the organization and the body. */
export function deployAdmin<S extends z.ZodType | null>(req: Request, schema: S): Promise<Guard<{ ctx: AdminCtx; data: S extends z.ZodType ? z.infer<S> : null }>> {
  return campaignAdmin(req, schema, "team_deploy");
}

/** The "not set up" answer: exactly what an admin must do. */
export function notSetUp() {
  const s = deployStatus();
  return Response.json(
    { error: "not_configured", message: "Gmail deployment is not set up on this server yet.", steps: s.steps, scope: s.scope },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

type DbError = { code?: string; message: string };

/** Maps our own errors and the DP0xx errors raised by migration 0010 to HTTP answers. */
export function deployFailure(e: unknown): Response {
  if (e instanceof DeployError) {
    if (e.code === "not_configured") return notSetUp();
    return deny(e.status, e.code, e.message);
  }
  const error = e as DbError;
  switch (error?.code) {
    case "DP001":
      return deny(404, "not_found", error.message);
    case "DP003":
    case "23514":
    case "22023":
      return deny(400, "bad_request", error.code === "23514" ? "One of the values is not allowed." : error.message);
    case "DP004":
    case "DP005":
      return deny(409, "conflict", error.message);
    case "DP006":
    case "42501":
      return deny(403, "forbidden", "You do not have permission to do that.");
    case "23505":
      return deny(409, "conflict", "A deployment is already running for this organization. Wait for it to finish or cancel it.");
    case "23503":
      return deny(400, "bad_request", "That item does not exist.");
    default:
      console.error("[deploy] database error:", error?.code, error?.message);
      return deny(500, "db", "Could not complete that. Please try again.");
  }
}
