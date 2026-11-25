import { z } from "zod";
import { deny, requireFeature } from "@/lib/authz/guard";
import { json } from "@/lib/polish/route";

export const runtime = "nodejs";

/**
 * Can this person ask for polish? 200 when the feature is on for them (with the id of an already open request for the
 * given signature, if any), 403 when it is not, 401 when signed out. The "Request polish" button hides itself on 401/403/503.
 */
export async function GET(req: Request) {
  const g = await requireFeature("designer_polish", { unauthorized: "Sign in to request polish." });
  if (!g.ok) return g.response;
  const sig = z.string().uuid().safeParse(new URL(req.url).searchParams.get("signatureId") ?? undefined);
  let openRequestId: string | null = null;
  if (sig.success) {
    const { data, error } = await g.ctx.supabase
      .from("polish_requests")
      .select("id")
      .eq("requester_id", g.ctx.user.id)
      .eq("source_signature_id", sig.data)
      .in("status", ["requested", "in_progress", "delivered"])
      .maybeSingle();
    if (error) return deny(503, "unavailable", "Designer polish is not set up yet. Apply supabase/migrations/0008_designer_polish.sql, then try again.");
    openRequestId = data?.id ?? null;
  }
  return json({ enabled: true, openRequestId });
}
