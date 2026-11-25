import { z } from "zod";
import { adminRequest, dbFailure } from "@/lib/admin/route";
import { deny } from "@/lib/authz/guard";
import { ROLES } from "@/lib/authz/roles";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address.");
const Invite = z.object({ email, role: z.enum(ROLES, { error: "Choose a role." }) });
const Withdraw = z.object({ email });

const noStore = { "Cache-Control": "no-store" };

/**
 * Invite someone: only an invited email address can create an account (migration 0017, enforced by the database).
 * Writing the same address again changes the role they will get. Row-level security limits this to platform admins.
 */
export async function PUT(req: Request) {
  const a = await adminRequest(req, Invite);
  if (!a.ok) return a.response;
  const { supabase, user } = a.ctx.ctx;
  const { email, role } = a.ctx.data;

  const existing = await supabase.from("profiles").select("id").ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`)).maybeSingle();
  if (existing.data) return deny(409, "already_member", "That person already has an account. Change their role on the People page instead.");

  const { error } = await supabase
    .from("invitations")
    .upsert({ email, role, invited_by: user.id, accepted_at: null, created_at: new Date().toISOString() }, { onConflict: "email" });
  if (error) return dbFailure(error);

  // Email the person a link that signs them in and sends them to set a password (needs SUPABASE_SERVICE_ROLE_KEY and email set up in Supabase).
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? new URL(req.url).origin;
  const link = `${origin}/login`;
  let emailed = false;
  const admin = createAdminClient();
  if (admin) {
    const { error: sendError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${origin}/reset-password` });
    if (sendError) console.error("[admin/invitations] email failed:", sendError.message);
    else emailed = true;
  }
  return Response.json({ email, role, emailed, link }, { headers: noStore });
}

/** Withdraw an invitation that has not been used. */
export async function DELETE(req: Request) {
  const a = await adminRequest(req, Withdraw);
  if (!a.ok) return a.response;
  const { error } = await a.ctx.ctx.supabase.from("invitations").delete().eq("email", a.ctx.data.email).is("accepted_at", null);
  if (error) return dbFailure(error);
  return Response.json({ email: a.ctx.data.email }, { headers: noStore });
}
