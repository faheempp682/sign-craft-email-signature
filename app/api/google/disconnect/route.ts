import { deny, requireUser } from "@/lib/authz/guard";
import { sameOrigin } from "@/lib/authz/origin";
import { readGoogleConfig } from "@/lib/google/config";
import { deleteConnection, readRefreshToken } from "@/lib/google/connection";
import { revokeToken, type RevokeResult } from "@/lib/google/oauth";
import { googleFailure, originOf } from "@/lib/google/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Disconnect: cancel the grant with Google, then delete our stored copy. Deliberately NOT behind the gmail_push
 * switch, so anyone can always remove their connection even if the feature is turned off for them later.
 * The stored copy is deleted even if Google could not be reached (it would be unusable to us anyway), and the answer
 * says honestly whether Google confirmed the revocation.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return deny(403, "bad_origin", "This request did not come from the app.");
  const g = await requireUser({ unauthorized: "Sign in first." });
  if (!g.ok) return g.response;

  const admin = createAdminClient();
  const c = readGoogleConfig(originOf(req));
  let revoked: RevokeResult | "not_attempted" = "not_attempted";

  try {
    if (admin && c.ok) {
      const token = await readRefreshToken(admin, c.config, g.ctx.user.id).catch(() => null); // unreadable token: nothing to revoke, still delete
      if (token) revoked = await revokeToken(token);
      await deleteConnection(admin, g.ctx.user.id);
    } else {
      // Server settings are missing, so we cannot decrypt or revoke. The person can still remove the stored row themselves.
      const { error } = await g.ctx.supabase.from("google_connections").delete().eq("user_id", g.ctx.user.id);
      if (error) return deny(500, "db", "Could not remove the saved connection. Please try again.");
    }
  } catch (e) {
    return googleFailure(e);
  }
  return Response.json({ ok: true, revoked }, { headers: { "Cache-Control": "no-store" } });
}
