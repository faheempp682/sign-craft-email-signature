import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { healthAdmin, healthFailure, noStore, UUID_RE } from "@/lib/health/route";

export const runtime = "nodejs";

const Body = z.object({ note: z.string().trim().min(1, "Add a short note saying why.").max(300) }).strict();

/** Acknowledge a finding with a note. The database records who and when, and refuses anything but an open finding. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return deny(404, "not_found", "That finding does not exist.");
  const a = await healthAdmin(req, Body);
  if (!a.ok) return a.response;
  const { supabase } = a.ctx.ctx;
  try {
    const { error } = await supabase.rpc("health_acknowledge", { p_finding: id, p_note: a.ctx.data.note });
    if (error) throw error;
    return Response.json({ ok: true }, { headers: noStore });
  } catch (e) {
    return healthFailure(e);
  }
}
