import { notFound } from "next/navigation";
import { isPlatformAdmin } from "@/lib/authz/guard";
import { adminEmails } from "@/lib/authz/bootstrap";
import { isRole, type Role } from "@/lib/authz/roles";
import { createClient } from "@/lib/supabase/server";
import { UsersAdmin, type Person, type PendingInvite } from "./users-admin";

export const metadata = { title: "People · Admin · SignCraft" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  if (!(await isPlatformAdmin())) notFound(); // platform settings: admins of the default organization only
  const supabase = await createClient();
  if (!supabase) return null;

  const org = await supabase.from("organizations").select("id, name").eq("is_default", true).maybeSingle();
  const [profiles, members] = await Promise.all([
    supabase.from("profiles").select("id, email, created_at").order("email"),
    org.data ? supabase.from("memberships").select("user_id, role").eq("org_id", org.data.id) : Promise.resolve({ data: [], error: null }),
  ]);
  const failed = org.error ?? profiles.error ?? members.error;
  if (failed || !org.data) {
    console.error("[admin/users] load failed:", failed?.message ?? "default organization missing");
    return <p className="card p-6 text-sm">Could not load people. Has <code>supabase/migrations/0003_access_control.sql</code> been applied?</p>;
  }

  const roleById = new Map((members.data ?? []).map((m) => [m.user_id, m.role]));
  const always = new Set(adminEmails());
  const people: Person[] = (profiles.data ?? []).map((p) => {
    const r = roleById.get(p.id);
    return { email: p.email, joined: p.created_at, role: (isRole(r) ? r : "member") as Role, always: always.has(p.email.trim().toLowerCase()) };
  });

  // Open invitations are a nice-to-have here: if they cannot load, the page still works.
  const invites = await supabase.from("invitations").select("email, role, created_at").is("accepted_at", null).order("created_at", { ascending: false });
  if (invites.error) console.error("[admin/users] invitations load failed:", invites.error.message);
  const pending: PendingInvite[] = (invites.data ?? []).map((r) => ({
    email: r.email,
    role: (isRole(r.role) ? r.role : "member") as Role,
    invited: r.created_at,
  }));

  return <UsersAdmin orgName={org.data.name} people={people} pending={pending} />;
}
