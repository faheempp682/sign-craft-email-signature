import type { SupabaseClient, User } from "@supabase/supabase-js";
import { sameOrigin } from "@/lib/authz/origin";
import { deny, requireFeature } from "@/lib/authz/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { readGoogleConfig, type GoogleConfig } from "./config";
import { isGoogleError } from "./errors";

/** Everything a Google route needs, after the standard checks. */
export type GoogleCtx = { cfg: GoogleConfig; admin: SupabaseClient; supabase: SupabaseClient; user: User };

export const originOf = (req: Request) => new URL(req.url).origin;

/** Turns an expected Google failure into the JSON answer; anything unexpected becomes a generic 500 (details go to the log). */
export function googleFailure(e: unknown): Response {
  if (isGoogleError(e)) return deny(e.status, e.code, e.message);
  console.error("[google] unexpected error:", e instanceof Error ? e.message : e);
  return deny(500, "unknown", "Something went wrong talking to Google. Please try again.");
}

/**
 * Common start for every Google route: signed in, `gmail_push` switched on for this person, server settings present.
 * For writes (`write: true`) a request from another site is refused too.
 */
export async function googleContext(req: Request, opts: { write?: boolean; requireFlag?: boolean } = {}): Promise<{ ok: true; ctx: GoogleCtx } | { ok: false; response: Response }> {
  if (opts.write && !sameOrigin(req)) return { ok: false, response: deny(403, "bad_origin", "This request did not come from the app.") };

  const g = await requireFeature("gmail_push", { unauthorized: "Sign in to use Gmail." });
  if (!g.ok) return g;

  const c = readGoogleConfig(originOf(req));
  const admin = createAdminClient();
  if (!c.ok || !admin) {
    const missing = c.ok ? ["SUPABASE_SERVICE_ROLE_KEY"] : c.missing;
    return { ok: false, response: Response.json({ error: "not_configured", message: `Gmail push is not set up yet. Add to .env.local: ${missing.join(", ")}.`, missing }, { status: 503, headers: { "Cache-Control": "no-store" } }) };
  }
  return { ok: true, ctx: { cfg: c.config, admin, supabase: g.ctx.supabase, user: g.ctx.user } };
}
