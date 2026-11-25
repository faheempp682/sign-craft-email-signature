import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { listActableOrgs, pickAgencyOrg, readActiveOrgCookie, resolveActiveOrg } from "@/lib/org/active";
import { noStore, orgFailure, orgRequest } from "@/lib/org/route";

export const runtime = "nodejs";

type ClientRow = { id: string; name: string; plan_id: string | null; created_at: string; member_count: number | string; people_count: number | string };

/** The agency organization the caller is working for, or null when they administer none. */
async function agencyFor(ctx: { supabase: Parameters<typeof listActableOrgs>[0]; user: { id: string } }): Promise<string | null> {
  const orgs = await listActableOrgs(ctx.supabase);
  const active = await resolveActiveOrg(ctx.supabase, ctx.user.id, { admin: false, cookie: await readActiveOrgCookie() });
  return pickAgencyOrg(orgs, active);
}

/** Client organizations of the caller's agency, with their plan and counts. Agency mode feature and admin role. */
export async function GET(req: Request) {
  const a = await orgRequest(req, null, { feature: "agency_mode", role: "admin" });
  if (!a.ok) return a.response;
  const agency = await agencyFor(a.ctx.ctx);
  if (!agency) return deny(403, "forbidden", "You do not administer an agency organization.");
  const { data, error } = await a.ctx.ctx.supabase.rpc("agency_clients", { p_parent: agency });
  if (error) return orgFailure(error);
  const clients = ((data ?? []) as ClientRow[]).map((c) => ({ id: c.id, name: c.name, plan_id: c.plan_id, created_at: c.created_at, members: Number(c.member_count), people: Number(c.people_count) }));
  return Response.json({ agency, clients }, { headers: noStore });
}

const Create = z.object({
  name: z.string().trim().min(1, "Give the client a name.").max(80, "The name is at most 80 characters."),
  plan_id: z.string().regex(/^[a-z][a-z0-9_]*$/, "Invalid plan.").nullable().default(null),
});

/** Create a client organization under the caller's agency. */
export async function POST(req: Request) {
  const a = await orgRequest(req, Create, { feature: "agency_mode", role: "admin" });
  if (!a.ok) return a.response;
  const agency = await agencyFor(a.ctx.ctx);
  if (!agency) return deny(403, "forbidden", "You do not administer an agency organization.");
  const { data, error } = await a.ctx.ctx.supabase.rpc("create_client_organization", { p_parent: agency, p_name: a.ctx.data.name, p_plan: a.ctx.data.plan_id });
  if (error) return orgFailure(error);
  return Response.json({ id: data }, { status: 201, headers: noStore });
}
