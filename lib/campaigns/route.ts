import type { z } from "zod";
import { deny, requireFeature, requireRole, type Guard, type UserCtx } from "@/lib/authz/guard";
import { sameOrigin } from "@/lib/authz/origin";
import type { Feature } from "@/lib/authz/roles";
import { readActiveOrgCookie, resolveActiveOrg } from "@/lib/org/active";

export type AdminCtx = UserCtx & { orgId: string };

/**
 * The organization an admin request acts on: the one asked for in the request, else the one remembered in the
 * "active organization" cookie, else the first organization they administer. The choice is honoured only when the
 * database says they may administer it (directly, or as admin of its agency); see lib/org/active.ts.
 */
export async function adminOrg(supabase: UserCtx["supabase"], userId: string, requested?: string): Promise<string | null> {
  return resolveActiveOrg(supabase, userId, { admin: true, requested, cookie: requested ? undefined : await readActiveOrgCookie() });
}

/**
 * Origin check (writes), feature flag, admin role, then the organization and the body. Every campaign admin route
 * goes through this, so none of them can forget a check.
 */
export async function campaignAdmin<S extends z.ZodType | null>(
  req: Request,
  schema: S,
  feature: Feature | null = "campaigns",
  requestedOrg?: string,
): Promise<Guard<{ ctx: AdminCtx; data: S extends z.ZodType ? z.infer<S> : null }>> {
  const write = req.method !== "GET" && req.method !== "HEAD";
  if (write && !sameOrigin(req)) return { ok: false, response: deny(403, "bad_origin", "This request did not come from the app.") };
  if (feature) {
    const f = await requireFeature(feature, { unauthorized: "Sign in as an admin." });
    if (!f.ok) return f;
  }
  const r = await requireRole("admin", { unauthorized: "Sign in as an admin." });
  if (!r.ok) return r;

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
  const orgId = await adminOrg(r.ctx.supabase, r.ctx.user.id, requestedOrg ?? (schema && typeof data === "object" && data ? (data as { org_id?: string }).org_id : undefined));
  if (!orgId) return { ok: false, response: deny(403, "forbidden", "You do not have permission to do that.") };
  return { ok: true, ctx: { ctx: { ...r.ctx, orgId }, data: data as never } };
}

export const noStore = { "Cache-Control": "no-store" };

type DbError = { code?: string; message: string };

export function dbFailure(error: DbError): Response {
  if (error.code === "42501") return deny(403, "forbidden", "You do not have permission to do that.");
  if (error.code === "23503") return deny(400, "bad_request", "That item does not exist.");
  if (error.code === "23514") return deny(400, "bad_request", "One of the values is not allowed.");
  if (error.code === "22023") return deny(400, "bad_request", error.message);
  console.error("[campaigns] database error:", error.code, error.message);
  return deny(500, "db", "Could not save. Please try again.");
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const notFound = () => deny(404, "not_found", "That campaign does not exist.");
