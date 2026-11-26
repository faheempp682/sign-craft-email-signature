import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, getUser } from "@/lib/supabase/server";
import { isBootstrapAdmin, promoteToAdmin } from "./bootstrap";
import { FEATURES, atLeast, isRole, type Feature, type Role } from "./roles";

/**
 * The one place API routes check who is calling and whether they may. Routes do not do their own auth checks.
 *
 *   const g = await requireUser();            if (!g.ok) return g.response;
 *   const g = await requireRole("admin");     if (!g.ok) return g.response;   // g.ctx.role
 *   const g = await requireFeature("gmail_push");  if (!g.ok) return g.response;
 *
 * Error responses keep the shape the app already used: { error, message } with 401 / 403 / 503.
 */

export type UserCtx = { kind: "user"; supabase: SupabaseClient; user: User };
export type Guard<T> = { ok: true; ctx: T } | { ok: false; response: Response };

export const deny = (status: number, error: string, message: string) =>
  Response.json({ error, message }, { status, headers: { "Cache-Control": "no-store" } });

/** Thrown when the access-control tables or functions cannot be reached (for example migration 0003 was not applied). */
export class AuthzUnavailable extends Error {}
const unavailable = () => deny(503, "authz_unavailable", "Access control is not set up yet. Apply supabase/migrations/0003_access_control.sql, then try again.");

type Messages = { unauthorized?: string; notConfigured?: string };

/** Signed-in user, or a 401 (503 when Supabase is not configured at all). */
export async function requireUser(messages: Messages = {}): Promise<Guard<UserCtx>> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, response: deny(503, "not_configured", messages.notConfigured ?? "Sign-in is not set up yet. Add the Supabase variables to .env.local.") };
  const user = await getUser();
  if (!user) return { ok: false, response: deny(401, "unauthorized", messages.unauthorized ?? "Sign in first.") };
  return { ok: true, ctx: { kind: "user", supabase, user } };
}

/** The caller's effective role. Promotes the caller first if their (confirmed) email is listed in ADMIN_EMAILS. */
export async function roleOf(ctx: UserCtx): Promise<Role> {
  let role = await readRole(ctx.supabase);
  if (role !== "admin" && isBootstrapAdmin(ctx.user)) {
    const admin = createAdminClient();
    if (!admin) {
      console.warn("[authz] ADMIN_EMAILS matches this user but SUPABASE_SERVICE_ROLE_KEY is not set, so they cannot be promoted automatically. See docs/access-control.md.");
    } else if (await promoteToAdmin(admin as never, ctx.user.id)) {
      role = await readRole(ctx.supabase);
    }
  }
  return role;
}

async function readRole(supabase: SupabaseClient): Promise<Role> {
  const { data, error } = await supabase.rpc("current_app_role");
  if (error || !isRole(data)) {
    console.error("[authz] could not read role:", error?.message ?? `unexpected value ${String(data)}`);
    throw new AuthzUnavailable();
  }
  return data;
}

/** The signed-in user's role for server-rendered pages. null when signed out, Supabase is off, or access control is unavailable. */
export const currentRole = cache(async (): Promise<Role | null> => {
  const g = await requireUser();
  if (!g.ok) return null;
  try {
    return await roleOf(g.ctx);
  } catch (e) {
    if (e instanceof AuthzUnavailable) return null;
    throw e;
  }
});

/** Signed in AND at least `min`. 403 otherwise. */
export async function requireRole(min: Role, messages: Messages = {}): Promise<Guard<UserCtx & { role: Role }>> {
  const g = await requireUser(messages);
  if (!g.ok) return g;
  try {
    const role = await roleOf(g.ctx);
    if (!atLeast(role, min)) return { ok: false, response: deny(403, "forbidden", "You do not have permission to do that.") };
    return { ok: true, ctx: { ...g.ctx, role } };
  } catch (e) {
    if (e instanceof AuthzUnavailable) return { ok: false, response: unavailable() };
    throw e;
  }
}

/**
 * Platform admin: an admin of the DEFAULT organization (database function is_admin(), migration 0016). This is who may change
 * global settings: feature flags, AI limits, per-person overrides, roles in the default organization. An admin of some other
 * organization (a client of an agency, say) passes requireRole("admin") for their own organization's screens but is NOT a
 * platform admin. The database enforces the same rule under row-level security; this makes the API answer 403 cleanly.
 */
export async function requirePlatformAdmin(messages: Messages = {}): Promise<Guard<UserCtx & { role: Role }>> {
  const g = await requireRole("admin", messages); // also performs the ADMIN_EMAILS promotion
  if (!g.ok) return g;
  const { data, error } = await g.ctx.supabase.rpc("is_admin");
  if (error || typeof data !== "boolean") {
    console.error("[authz] could not check platform admin:", error?.message ?? `unexpected value ${String(data)}`);
    return { ok: false, response: unavailable() };
  }
  if (!data) return { ok: false, response: deny(403, "forbidden", "You do not have permission to do that.") };
  return g;
}

/** For server-rendered pages: true only for a platform admin. */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const g = await requirePlatformAdmin();
  return g.ok;
});

/** Signed in AND the feature is enabled for them (role default, then organization and user overrides). */
export async function requireFeature(feature: Feature, messages: Messages = {}): Promise<Guard<UserCtx>> {
  const g = await requireUser(messages);
  if (!g.ok) return g;
  const on = await featureEnabled(g.ctx.supabase, feature);
  if (on === null) return { ok: false, response: unavailable() };
  if (!on) return { ok: false, response: deny(403, "feature_disabled", `${FEATURES[feature]} is not enabled for your account.`) };
  return g;
}

/** null means the check itself failed (treated as "unavailable", never as "allowed"). */
export const featureEnabled = cache(async (supabase: SupabaseClient, feature: Feature): Promise<boolean | null> => {
  const { data, error } = await supabase.rpc("feature_enabled", { p_feature: feature });
  if (error || typeof data !== "boolean") {
    console.error("[authz] could not check feature:", feature, error?.message ?? `unexpected value ${String(data)}`);
    return null;
  }
  return data;
});
