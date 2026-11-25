import { isRole, type Role } from "@/lib/authz/roles";
import { createClient } from "@/lib/supabase/server";
import { InvitationsAdmin, type Invitation } from "./invitations-admin";

export const metadata = { title: "Invitations · Admin · SignCraft" };
export const dynamic = "force-dynamic";

/** Sign-up is invite-only: this is where an admin lets someone in. */
export default async function InvitationsPage() {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase.from("invitations").select("email, role, created_at, accepted_at").order("created_at", { ascending: false });
  if (error) {
    console.error("[admin/invitations] load failed:", error.message);
    return <p className="card p-6 text-sm">Could not load invitations. Has <code>supabase/migrations/0017_invite_only.sql</code> been applied, and are you a platform admin?</p>;
  }
  const invitations: Invitation[] = (data ?? []).map((r) => ({
    email: r.email,
    role: (isRole(r.role) ? r.role : "member") as Role,
    invited: r.created_at,
    accepted: r.accepted_at,
  }));
  return <InvitationsAdmin invitations={invitations} />;
}
