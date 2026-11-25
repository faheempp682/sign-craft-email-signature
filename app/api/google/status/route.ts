import { deny, requireFeature } from "@/lib/authz/guard";
import { readGoogleConfig } from "@/lib/google/config";
import { originOf } from "@/lib/google/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** What the screen needs to decide between "not set up", "Connect", and "Connected as ...". Never returns a token. */
export async function GET(req: Request) {
  const g = await requireFeature("gmail_push", { unauthorized: "Sign in to use Gmail." });
  if (!g.ok) return g.response;

  const c = readGoogleConfig(originOf(req));
  const configured = c.ok && !!createAdminClient();
  if (!configured) return Response.json({ configured: false, connected: false }, { headers: { "Cache-Control": "no-store" } });

  // The signed-in person's own client: row-level security limits this to their row, and the token column is not readable.
  const { data, error } = await g.ctx.supabase.from("google_connections").select("google_email, hd").maybeSingle();
  if (error) {
    console.error("[google] status failed:", error.message);
    return deny(503, "authz_unavailable", "Gmail push is not set up yet. Apply supabase/migrations/0004_google_connections.sql, then try again.");
  }
  return Response.json({ configured: true, connected: !!data, email: data?.google_email ?? null, domain: data?.hd ?? null }, { headers: { "Cache-Control": "no-store" } });
}
