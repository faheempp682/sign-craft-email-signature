import { adminRequest, dbFailure, findProfile, noAccount } from "@/lib/admin/route";
import { MemberSet } from "@/lib/admin/schemas";
import { adminEmails } from "@/lib/authz/bootstrap";
import { deny } from "@/lib/authz/guard";

export const runtime = "nodejs";

/** Set a person's role in the default organization. The database refuses to remove the last admin. */
export async function PUT(req: Request) {
  const a = await adminRequest(req, MemberSet);
  if (!a.ok) return a.response;
  const { supabase } = a.ctx.ctx;
  const { email, role } = a.ctx.data;

  // People listed in ADMIN_EMAILS are re-promoted on their next request, so a demotion would silently not stick.
  if (role !== "admin" && adminEmails().includes(email)) {
    return deny(409, "bootstrap_admin", "This person is listed in ADMIN_EMAILS, so they are always an admin. Remove them from that setting first.");
  }

  const profile = await findProfile(supabase, email);
  if (!profile) return noAccount();
  const { data: org } = await supabase.from("organizations").select("id").eq("is_default", true).maybeSingle();
  if (!org) return deny(500, "db", "The default organization is missing. Has migration 0003 been applied?");

  const { error } = await supabase.from("memberships").upsert({ org_id: org.id, user_id: profile.id, role }, { onConflict: "org_id,user_id" });
  if (error) return dbFailure(error);
  return Response.json({ email: profile.email, role }, { headers: { "Cache-Control": "no-store" } });
}
