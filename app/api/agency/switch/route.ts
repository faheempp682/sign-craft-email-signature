import { NextResponse } from "next/server";
import { z } from "zod";
import { ACTIVE_ORG_COOKIE, activeOrgCookieOptions, listActableOrgs, UUID_RE } from "@/lib/org/active";
import { noStore, orgRequest } from "@/lib/org/route";
import { deny } from "@/lib/authz/guard";

export const runtime = "nodejs";

const Body = z.object({ org_id: z.string().regex(UUID_RE, "Invalid organization.").nullable() });

/**
 * Switch the active organization (same-origin POST). The database decides: the organization must be one the caller
 * belongs to or administers as an agency. org_id null leaves the client context and goes back to the caller's own default.
 */
export async function POST(req: Request) {
  const a = await orgRequest(req, Body);
  if (!a.ok) return a.response;
  const { supabase } = a.ctx.ctx;
  const { org_id } = a.ctx.data;

  const res = NextResponse.json({ active: org_id }, { headers: noStore });
  if (org_id === null) {
    res.cookies.set(ACTIVE_ORG_COOKIE, "", activeOrgCookieOptions(0));
    return res;
  }
  const orgs = await listActableOrgs(supabase);
  if (!orgs.some((o) => o.id === org_id)) return deny(403, "forbidden", "You cannot switch to that organization.");
  res.cookies.set(ACTIVE_ORG_COOKIE, org_id, activeOrgCookieOptions());
  return res;
}
