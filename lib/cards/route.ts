import type { z } from "zod";
import { deny, requireFeature, type Guard, type UserCtx } from "@/lib/authz/guard";
import { sameOrigin } from "@/lib/authz/origin";

/** Feature check ("digital_card"), origin check for writes, then JSON body validation. Every card write goes through this. */
export async function cardWrite<S extends z.ZodType>(req: Request, schema: S | null): Promise<Guard<{ ctx: UserCtx; data: z.infer<S> }>> {
  if (!sameOrigin(req)) return { ok: false, response: deny(403, "bad_origin", "This request did not come from the app.") };
  const g = await requireFeature("digital_card", { unauthorized: "Sign in to manage your digital cards." });
  if (!g.ok) return g;
  if (!schema) return { ok: true, ctx: { ctx: g.ctx, data: undefined as z.infer<S> } };
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: deny(400, "bad_request", "Request body must be JSON.") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, response: deny(400, "bad_request", parsed.error.issues[0]?.message ?? "Invalid request.") };
  return { ok: true, ctx: { ctx: g.ctx, data: parsed.data } };
}

type DbError = { code?: string; message: string };

/** Turn a database error into the right HTTP answer without leaking internals. */
export function cardDbFailure(error: DbError): Response {
  if (error.code === "23505") return deny(409, "slug_taken", "That address is already taken. Choose another.");
  if (error.code === "P0001") return deny(409, "limit", error.message);
  if (error.code === "23514") return deny(400, "bad_request", "One of the fields is not valid.");
  if (error.code === "42501") return deny(403, "forbidden", "You do not have permission to do that.");
  console.error("[cards] database error:", error.code);
  return deny(500, "db", "Could not save. Please try again.");
}
