import { listActableOrgs, readActiveOrgCookie, resolveActiveOrg } from "@/lib/org/active";
import { noStore, orgRequest } from "@/lib/org/route";

export const runtime = "nodejs";

/** The organizations the caller may act in, and which one is active. Any signed-in person (the switcher uses it). */
export async function GET(req: Request) {
  const a = await orgRequest(req, null);
  if (!a.ok) return a.response;
  const { supabase, user } = a.ctx.ctx;
  const orgs = await listActableOrgs(supabase);
  const active = await resolveActiveOrg(supabase, user.id, { admin: false, cookie: await readActiveOrgCookie() });
  return Response.json({ active, orgs }, { headers: noStore });
}
