import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { resolveActiveOrg, UUID_RE } from "@/lib/org/active";
import { noStore, orgFailure, orgRequest } from "@/lib/org/route";

export const runtime = "nodejs";

const Body = z.object({
  org_id: z.string().regex(UUID_RE, "Invalid organization."),
  plan_id: z.string().regex(/^[a-z][a-z0-9_]*$/, "Invalid plan.").nullable(),
});

/**
 * Assign a plan preset to an organization, or null to remove it (the organization then behaves as it did before plans).
 * Nothing is charged. The caller must administer the organization, directly or as admin of its agency; the database
 * also enforces that a client's plan is changed only by its agency's admins.
 */
export async function PUT(req: Request) {
  const a = await orgRequest(req, Body, { role: "admin" });
  if (!a.ok) return a.response;
  const { supabase, user } = a.ctx.ctx;
  const { org_id, plan_id } = a.ctx.data;

  const allowed = await resolveActiveOrg(supabase, user.id, { admin: true, requested: org_id });
  if (allowed !== org_id) return deny(403, "forbidden", "You do not have permission to do that.");

  const { data, error } = await supabase.from("organizations").update({ plan_id }).eq("id", org_id).select("id, plan_id");
  if (error) return orgFailure(error);
  if (!data?.length) return deny(404, "not_found", "That organization does not exist.");
  return Response.json({ org_id, plan_id: data[0].plan_id }, { headers: noStore });
}
