import { z } from "zod";
import { healthAdmin, healthFailure, noStore } from "@/lib/health/route";

export const runtime = "nodejs";

const Body = z
  .object({
    enabled: z.boolean(),
    include_names: z.boolean(),
    max_people: z.number().int().min(1).max(1000),
    /** undefined keeps the stored address; null or "" removes it; otherwise a full https address. */
    webhook_url: z.string().trim().max(500).nullish(),
  })
  .strict();

export async function PUT(req: Request) {
  const a = await healthAdmin(req, Body);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const d = a.ctx.data;
  try {
    let url: string | null;
    if (d.webhook_url === undefined) {
      const cur = await supabase.from("health_settings").select("webhook_url").eq("org_id", orgId).maybeSingle();
      if (cur.error) throw cur.error;
      url = (cur.data as { webhook_url: string | null } | null)?.webhook_url ?? null;
    } else {
      url = d.webhook_url ? d.webhook_url : null;
    }
    const { error } = await supabase.rpc("health_save_settings", { p_org: orgId, p_enabled: d.enabled, p_webhook_url: url, p_include_names: d.include_names, p_max_people: d.max_people });
    if (error) throw error;
    return Response.json({ ok: true }, { headers: noStore });
  } catch (e) {
    return healthFailure(e);
  }
}
