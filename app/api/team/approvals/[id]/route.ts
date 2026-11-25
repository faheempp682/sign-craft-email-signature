import { z } from "zod";
import { badId, noStore, teamAdmin, teamFailure, UUID_RE } from "@/lib/team/route";

export const runtime = "nodejs";

const Body = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(500, "Keep the note under 500 characters.").default("") });

/** Approve or reject a pending submission. The database decides whether the transition is legal (pending only, not your own, reason on reject). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();
  const a = await teamAdmin(req, Body);
  if (!a.ok) return a.response;
  const { supabase } = a.ctx.ctx;
  const { decision, note } = a.ctx.data;
  if (decision === "reject" && !note) return Response.json({ error: "bad_request", message: "Give a reason when you reject." }, { status: 400, headers: noStore });
  const { error } = await supabase.rpc("review_signature", { p_id: id, p_approve: decision === "approve", p_note: note });
  if (error) return teamFailure(error);
  return Response.json({ ok: true }, { headers: noStore });
}
