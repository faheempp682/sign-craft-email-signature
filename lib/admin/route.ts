import type { z } from "zod";
import { deny, requirePlatformAdmin, type Guard, type UserCtx } from "@/lib/authz/guard";
import type { Role } from "@/lib/authz/roles";

export { sameOrigin } from "@/lib/authz/origin";
import { sameOrigin } from "@/lib/authz/origin";

/** Origin check, then admin check, then JSON body validation. Every admin write goes through this. */
export async function adminRequest<S extends z.ZodType>(req: Request, schema: S): Promise<Guard<{ ctx: UserCtx & { role: Role }; data: z.infer<S> }>> {
  if (!sameOrigin(req)) return { ok: false, response: deny(403, "bad_origin", "This request did not come from the app.") };
  const g = await requirePlatformAdmin({ unauthorized: "Sign in as an admin." });
  if (!g.ok) return g;
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

/** Turn a database error into the right HTTP answer. */
export function dbFailure(error: DbError): Response {
  if (error.code === "P0001") return deny(409, "last_admin", error.message); // raised by protect_last_admin()
  if (error.code === "42501") return deny(403, "forbidden", "You do not have permission to do that.");
  if (error.code === "23503") return deny(400, "bad_request", "That item does not exist.");
  console.error("[admin] database error:", error.code, error.message);
  return deny(500, "db", "Could not save. Please try again.");
}

/** Find an account by email (exact, case-insensitive). Reads `profiles`, which admins can read under RLS. */
export async function findProfile(supabase: UserCtx["supabase"], email: string): Promise<{ id: string; email: string } | null> {
  const escaped = email.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data } = await supabase.from("profiles").select("id, email").ilike("email", escaped).maybeSingle();
  return data ?? null;
}

export const noAccount = () => deny(404, "user_not_found", "No account with that email has signed in yet. Ask them to sign in once, then try again.");
