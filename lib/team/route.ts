import { z } from "zod";
import { deny, requireUser, type Guard, type UserCtx } from "@/lib/authz/guard";
import { sameOrigin } from "@/lib/authz/origin";
import { campaignAdmin, type AdminCtx } from "@/lib/campaigns/route";

export const noStore = { "Cache-Control": "no-store" };
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_BODY_BYTES = 3 * 1024 * 1024;

/** Team admin routes: same-origin on writes, the `team_deploy` flag, the admin role, then the organization and the body. */
export function teamAdmin<S extends z.ZodType | null>(req: Request, schema: S): Promise<Guard<{ ctx: AdminCtx; data: S extends z.ZodType ? z.infer<S> : null }>> {
  return campaignAdmin(req, schema, "team_deploy");
}

/** Any signed-in person (employee routes): same-origin on writes, then a JSON body when a schema is given. */
export async function teamMember<S extends z.ZodType | null>(req: Request, schema: S): Promise<Guard<{ ctx: UserCtx; data: S extends z.ZodType ? z.infer<S> : null }>> {
  const write = req.method !== "GET" && req.method !== "HEAD";
  if (write && !sameOrigin(req)) return { ok: false, response: deny(403, "bad_origin", "This request did not come from the app.") };
  const g = await requireUser();
  if (!g.ok) return g;
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
  return { ok: true, ctx: { ctx: g.ctx, data: data as never } };
}

type DbError = { code?: string; message: string };

/** Turn a database error into the right HTTP answer. TM0xx codes are raised by the functions in migration 0009. */
export function teamFailure(error: DbError): Response {
  switch (error.code) {
    case "TM001":
    case "TM002":
      return deny(404, "not_found", error.message);
    case "TM003":
    case "TM007":
    case "TM008":
    case "22023":
    case "23514":
      return deny(400, "bad_request", error.code === "23514" ? "One of the values is not allowed." : error.message);
    case "TM004":
    case "TM005":
      return deny(409, "conflict", error.message);
    case "TM006":
    case "42501":
      return deny(403, "forbidden", "You do not have permission to do that.");
    case "23505":
      return deny(409, "duplicate", "That value already exists in the directory (an email or external id is used twice).");
    case "23503":
      return deny(400, "bad_request", "That item does not exist.");
    default:
      console.error("[team] database error:", error.code, error.message);
      return deny(500, "db", "Could not save. Please try again.");
  }
}

export const notFound = (what = "item") => deny(404, "not_found", `That ${what} does not exist.`);
export const badId = () => deny(400, "bad_request", "Invalid id.");

export const PERSON_COLUMNS = "id, email, full_name, first_name, last_name, title, department, phone, mobile, location, custom, source, external_id, status, user_id, updated_at";
export const TEMPLATE_COLUMNS = "id, name, doc_json, lock_json, field_map, departments, is_active, created_at, updated_at";
export const Departments = z.array(z.string().trim().min(1).max(80)).max(20);
