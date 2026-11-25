import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { loadMine } from "@/lib/team/mine";
import { buildDoc } from "@/lib/team/render";
import { noStore, teamFailure, teamMember } from "@/lib/team/route";

export const runtime = "nodejs";

/** The signed-in employee's brand-locked signature: their directory data, the template, and their submissions. */
export async function GET(req: Request) {
  const g = await teamMember(req, null);
  if (!g.ok) return g.response;
  const { supabase, user } = g.ctx.ctx;
  return Response.json(await loadMine(supabase, user.id), { headers: noStore });
}

const Body = z.object({ values: z.record(z.string(), z.string()).refine((v) => Object.keys(v).length <= 40, "Too many fields.") });

/**
 * Submit the allowed fields. The server (1) loads the person and template itself, (2) rebuilds the whole document from
 * them and checks every value against the lock and the signature schema, then (3) the database checks the lock again
 * and decides whether the change is approved at once or waits for review. The client never sends HTML or a document.
 */
export async function POST(req: Request) {
  const g = await teamMember(req, Body);
  if (!g.ok) return g.response;
  const { supabase, user } = g.ctx.ctx;
  const { values } = g.ctx.data;

  const mine = await loadMine(supabase, user.id);
  if (mine.state === "no_person") return deny(404, "not_found", "You are not in your organization's directory yet. Ask an admin to add your email address.");
  if (mine.state === "no_template") return deny(404, "not_found", "Your organization has not set up a brand signature for you yet.");
  const built = buildDoc(mine.template.spec, mine.person, values);
  if (!built.ok) return Response.json({ error: "bad_request", message: built.error, field: built.key }, { status: 400, headers: noStore });

  const { data: id, error } = await supabase.rpc("submit_signature", { p_org: mine.orgId, p_values: values });
  if (error) return teamFailure(error);
  const { data: row } = await supabase.from("signature_versions").select("id, status").eq("id", id).maybeSingle();
  return Response.json({ id, status: row?.status ?? (mine.requireApproval ? "pending" : "approved") }, { status: 201, headers: noStore });
}
