import type { z } from "zod";
import { deny, requireFeature, requireRole, requireUser, type Guard, type UserCtx } from "@/lib/authz/guard";
import { sameOrigin } from "@/lib/authz/origin";
import type { Feature, Role } from "@/lib/authz/roles";

export const noStore = { "Cache-Control": "no-store" };

type Need = { feature?: Feature; role?: Role };

/**
 * Same-origin check on writes, then sign-in (or the feature flag and the role), then the JSON body. Every route under
 * /api/agency and /api/plans goes through this, so none of them can forget a check.
 */
export async function orgRequest<S extends z.ZodType | null>(
  req: Request,
  schema: S,
  need: Need = {},
): Promise<Guard<{ ctx: UserCtx & { role?: Role }; data: S extends z.ZodType ? z.infer<S> : null }>> {
  const write = req.method !== "GET" && req.method !== "HEAD";
  if (write && !sameOrigin(req)) return { ok: false, response: deny(403, "bad_origin", "This request did not come from the app.") };

  let ctx: UserCtx & { role?: Role };
  if (need.feature) {
    const f = await requireFeature(need.feature, { unauthorized: "Sign in as an admin." });
    if (!f.ok) return f;
    ctx = f.ctx;
  } else {
    const u = await requireUser();
    if (!u.ok) return u;
    ctx = u.ctx;
  }
  if (need.role) {
    const r = await requireRole(need.role, { unauthorized: "Sign in as an admin." });
    if (!r.ok) return r;
    ctx = r.ctx;
  }

  let data: unknown = null;
  if (schema) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return { ok: false, response: deny(400, "bad_request", "Request body must be JSON.") };
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return { ok: false, response: deny(400, "bad_request", parsed.error.issues[0]?.message ?? "Invalid request.") };
    data = parsed.data;
  }
  return { ok: true, ctx: { ctx, data: data as never } };
}

type DbError = { code?: string; message: string };

/** Turn a database error into the right HTTP answer. AG002 is raised by the agency rules in migration 0015. */
export function orgFailure(error: DbError): Response {
  switch (error.code) {
    case "42501":
      return deny(403, "forbidden", "You do not have permission to do that.");
    case "AG002":
      return deny(409, "conflict", error.message);
    case "22023":
      return deny(400, "bad_request", error.message);
    case "23514":
      return deny(400, "bad_request", "One of the values is not allowed.");
    case "23503":
      return deny(400, "bad_request", "That item does not exist.");
    default:
      console.error("[agency] database error:", error.code, error.message);
      return deny(500, "db", "Could not save. Please try again.");
  }
}
