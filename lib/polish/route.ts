import type { z } from "zod";
import { deny, requireFeature, requireRole, requireUser, type Guard, type UserCtx } from "@/lib/authz/guard";
import { sameOrigin } from "@/lib/authz/origin";
import { SignatureDocSchema, type SignatureDoc } from "@/lib/schema/document";
import { IdParam } from "./schemas";
import { isPolishStatus, type PolishOrigin, type PolishStatus } from "./status";

export const noStore = { "Cache-Control": "no-store" } as const;
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

/** How the database says no (the message of the exception) and what the caller is told. */
const FAILURES: Record<string, [number, string, string]> = {
  not_found: [404, "not_found", "That request does not exist, or it is not yours."],
  not_available: [409, "not_available", "Someone else already took this request."],
  invalid_state: [409, "invalid_state", "That is not possible at this stage of the request."],
  already_open: [409, "already_open", "This signature already has an open polish request."],
  too_many_open: [429, "too_many_open", "You have 5 open polish requests. Wait for one to finish or cancel one first."],
  confirm_required: [400, "confirm_required", "Confirm that you want to replace the original signature."],
  source_missing: [409, "source_missing", "The original signature no longer exists. Save the polished version as a new signature instead."],
  quota: [429, "quota", "You have reached the limit of 100 saved signatures."],
  too_many_comments: [429, "too_many_comments", "This request has reached its comment limit."],
  invalid: [400, "bad_request", "Check the text you entered and try again."],
  invalid_doc: [400, "bad_request", "That signature document is not valid."],
  feature_disabled: [403, "feature_disabled", "Designer polish is not enabled for your account."],
  forbidden: [403, "forbidden", "You do not have permission to do that."],
};

type DbError = { code?: string; message: string };

/** Turn a database error into the right HTTP answer. The database message is a short code, never user content. */
export function dbFailure(error: DbError): Response {
  const known = FAILURES[error.message];
  if (known) return deny(known[0], known[1], known[2]);
  if (error.code === "42501") return deny(403, "forbidden", "You do not have permission to do that.");
  if (error.code === "42883" || error.code === "42P01" || error.code === "PGRST202") {
    return deny(503, "unavailable", "Designer polish is not set up yet. Apply supabase/migrations/0008_designer_polish.sql, then try again.");
  }
  console.error("[polish] database error:", error.code, error.message);
  return deny(500, "db", "Something went wrong. Please try again.");
}

export type Who = "member" | "designer" | "feature";
async function guardFor(who: Who): Promise<Guard<UserCtx>> {
  if (who === "feature") return requireFeature("designer_polish", { unauthorized: "Sign in to request polish." });
  if (who === "designer") return requireRole("designer", { unauthorized: "Sign in as a designer." });
  return requireUser({ unauthorized: "Sign in first." });
}

export async function parseId(params: Promise<{ id: string }>): Promise<{ ok: true; id: string } | { ok: false; response: Response }> {
  const parsed = IdParam.safeParse((await params).id);
  return parsed.success ? { ok: true, id: parsed.data } : { ok: false, response: deny(400, "bad_request", "Invalid request id.") };
}

/**
 * One write to a polish request: same-origin check, then sign-in and permission, then body validation, then a single
 * database function that does the real authorization and the state change. Routes stay a few lines each.
 */
export async function polishWrite<S extends z.ZodType | null>(
  req: Request,
  params: Promise<{ id: string }> | null,
  opts: { who: Who; schema: S; rpc: string; args: (data: S extends z.ZodType ? z.infer<S> : null, id: string | null) => Record<string, unknown>; status?: number },
): Promise<Response> {
  if (!sameOrigin(req)) return deny(403, "bad_origin", "This request did not come from the app.");
  const g = await guardFor(opts.who);
  if (!g.ok) return g.response;

  let id: string | null = null;
  if (params) {
    const p = await parseId(params);
    if (!p.ok) return p.response;
    id = p.id;
  }
  let data: unknown = null;
  if (opts.schema) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return deny(400, "bad_request", "Request body must be JSON.");
    }
    const parsed = opts.schema.safeParse(body);
    if (!parsed.success) return deny(400, "bad_request", parsed.error.issues[0]?.message ?? "Invalid request.");
    data = parsed.data;
  }

  const { data: result, error } = await g.ctx.supabase.rpc(opts.rpc, opts.args(data as never, id));
  if (error) return dbFailure(error);
  return json(result, opts.status ?? 200);
}

/** Columns safe for lists: no documents. */
export const SUMMARY_COLUMNS = "id, signature_name, origin, note, status, round, created_at, updated_at, delivered_at, resolved_at";

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);

export type PolishSummary = {
  id: string;
  signatureName: string;
  origin: PolishOrigin;
  note: string;
  status: PolishStatus;
  round: number;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
};

export function toSummary(r: Row): PolishSummary | null {
  if (!isPolishStatus(r.status) || (r.origin !== "ai" && r.origin !== "manual") || typeof r.id !== "string") return null;
  return {
    id: r.id,
    signatureName: String(r.signature_name ?? ""),
    origin: r.origin,
    note: String(r.note ?? ""),
    status: r.status,
    round: typeof r.round === "number" ? r.round : 1,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    deliveredAt: str(r.delivered_at),
  };
}

/** A stored document is only ever shown after it passes the schema again. */
export function parseDoc(v: unknown): SignatureDoc | null {
  const p = SignatureDocSchema.safeParse(v);
  return p.success ? p.data : null;
}

export type PolishComment = { id: string; role: "requester" | "designer"; mine: boolean; body: string; createdAt: string };
export type PolishEvent = { id: string; action: string; by: "requester" | "designer" | "system"; detail: string | null; createdAt: string };
export type PolishDetail = PolishSummary & {
  isRequester: boolean;
  /** This person is the designer who holds the request. */
  isHolder: boolean;
  /** A designer or admin looking at a request nobody holds yet. */
  canClaim: boolean;
  originalDoc: SignatureDoc | null;
  deliveredDoc: SignatureDoc | null;
  /** Only for the designer holding the request: where to start working (the last delivery on a repeat round, else the original). */
  workDoc: SignatureDoc | null;
  changeNote: string | null;
  declineReason: string | null;
  hasSource: boolean;
  acceptedMode: "new" | "replace" | null;
  comments: PolishComment[];
  events: PolishEvent[];
};
