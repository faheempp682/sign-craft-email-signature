/**
 * First-admin bootstrap. Someone has to be admin before the admin screens can make anyone else one, so the emails in
 * ADMIN_EMAILS (comma-separated; the older single ADMIN_EMAIL also works) are promoted the first time they use the app.
 *
 * Safety: only a CONFIRMED email counts, so keep email confirmation switched on in Supabase. Without it, anyone could
 * sign up with an admin's address before the admin does.
 */
export function adminEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.ADMIN_EMAILS || env.ADMIN_EMAIL || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

type MaybeConfirmedUser = { email?: string | null; email_confirmed_at?: string | null };

export function isBootstrapAdmin(user: MaybeConfirmedUser, list: string[] = adminEmails()): boolean {
  return !!user.email && !!user.email_confirmed_at && list.includes(user.email.trim().toLowerCase());
}

/** The slice of the Supabase admin client this needs, so it can be tested without a database. */
export type AdminDb = {
  from(table: string): {
    select(cols: string): { eq(col: string, v: unknown): { maybeSingle(): PromiseLike<{ data: { id: string } | null; error: { message: string } | null }> } };
    upsert(row: Record<string, unknown>, opts: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>;
  };
};

/** Make the user an admin of the default organization. Returns true on success. */
export async function promoteToAdmin(db: AdminDb, userId: string): Promise<boolean> {
  const org = await db.from("organizations").select("id").eq("is_default", true).maybeSingle();
  if (org.error || !org.data) {
    console.error("[authz] bootstrap: default organization not found. Has migration 0003 been applied?", org.error?.message ?? "");
    return false;
  }
  const { error } = await db.from("memberships").upsert({ org_id: org.data.id, user_id: userId, role: "admin" }, { onConflict: "org_id,user_id" });
  if (error) {
    console.error("[authz] bootstrap: could not grant admin:", error.message);
    return false;
  }
  return true;
}
