import { featureEnabled, requireUser } from "@/lib/authz/guard";
import { noStore } from "@/lib/health/route";

export const runtime = "nodejs";

/**
 * How many findings are open, for the badge on the Team link. Any signed-in person may ask: it answers 0 unless they are an admin
 * of an organization with the monitor switched on (row-level security only lets admins see findings; nothing else is returned).
 */
export async function GET() {
  const g = await requireUser();
  if (!g.ok) return g.response;
  const { supabase } = g.ctx;
  try {
    if ((await featureEnabled(supabase, "health_monitor")) !== true) return Response.json({ open: 0 }, { headers: noStore });
    const { count, error } = await supabase.from("health_findings").select("id", { count: "exact", head: true }).eq("status", "open");
    if (error) return Response.json({ open: 0 }, { headers: noStore });
    return Response.json({ open: count ?? 0 }, { headers: noStore });
  } catch {
    return Response.json({ open: 0 }, { headers: noStore });
  }
}
