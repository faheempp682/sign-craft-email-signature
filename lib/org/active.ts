import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The ACTIVE organization: the one a signed-in person is working in right now.
 *
 * A cookie remembers the choice, but a cookie is only a request. It is honoured when the database says the caller may
 * act in that organization (a member of it; for admin screens an admin of it, directly or as admin of its agency).
 * Anything else, including a forged, stale or malformed cookie, silently falls back to the caller's own default
 * organization, which is exactly what the routes used before this existed.
 */

export const ACTIVE_ORG_COOKIE = "sc_active_org";
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THIRTY_DAYS = 60 * 60 * 24 * 30;

/** Options for the cookie: not readable by scripts, not sent cross-site, https only in production. */
export function activeOrgCookieOptions(maxAge = THIRTY_DAYS) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge };
}

/** The remembered choice, or undefined (also when called outside a request). Never trusted on its own. */
export async function readActiveOrgCookie(): Promise<string | undefined> {
  try {
    const v = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
    return v && UUID_RE.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

type Db = Pick<SupabaseClient, "from" | "rpc">;

/**
 * Resolve the active organization id for `userId`.
 *
 *   admin: true   organizations the person administers (admin screens and admin APIs)
 *   admin: false  organizations the person belongs to
 *
 * Order: `requested` (an explicit organization the caller asked for, such as `org_id` in a request body; it is never
 * ignored, so a refused request is refused, not redirected), then the cookie (silently ignored when not allowed),
 * then the first matching own membership. Returns null when there is nothing to act in.
 *
 * With no cookie and nothing requested this makes exactly the query it always made (the person's own memberships),
 * so a person in one organization behaves as before. The database is consulted again only to approve an
 * organization that is not one of their own memberships (an agency's client).
 */
export async function resolveActiveOrg(
  supabase: Db,
  userId: string,
  opts: { admin: boolean; requested?: string; cookie?: string },
): Promise<string | null> {
  let q = supabase.from("memberships").select("org_id").eq("user_id", userId);
  if (opts.admin) q = q.eq("role", "admin");
  const { data, error } = await q;
  if (error || !data?.length) return null;
  const own = (data as { org_id: string }[]).map((r) => r.org_id);

  const candidate = opts.requested ?? opts.cookie;
  if (candidate) {
    if (own.includes(candidate)) return candidate;
    if (await mayAct(supabase, candidate, opts.admin)) return candidate;
    if (opts.requested) return null;
  }
  return own[0];
}

/** Ask the database (the same functions the row-level security policies use) whether the caller may act in `org`. */
async function mayAct(supabase: Db, org: string, admin: boolean): Promise<boolean> {
  if (!UUID_RE.test(org)) return false;
  try {
    const { data, error } = await supabase.rpc(admin ? "is_org_admin" : "is_org_member", { p_org: org });
    return !error && data === true;
  } catch {
    return false;
  }
}

export type ActableOrg = { id: string; name: string; parentId: string | null; planId: string | null; role: "member" | "designer" | "admin"; viaAgency: boolean };

type MyOrgRow = { id: string; name: string; parent_id: string | null; plan_id: string | null; role: ActableOrg["role"]; via_agency: boolean };

/** Every organization the caller may act in (own memberships, then clients of agencies they administer). [] on any failure. */
export async function listActableOrgs(supabase: Db): Promise<ActableOrg[]> {
  try {
    const { data, error } = await supabase.rpc("my_orgs");
    if (error || !Array.isArray(data)) return [];
    return (data as MyOrgRow[]).map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id, planId: r.plan_id, role: r.role, viaAgency: r.via_agency }));
  } catch {
    return [];
  }
}

/**
 * Which organization is the AGENCY for this person: the active organization when it is a top-level organization they
 * administer; the parent when they are acting inside a client; else the first top-level organization they administer.
 */
export function pickAgencyOrg(orgs: ActableOrg[], activeId: string | null | undefined): string | null {
  const direct = orgs.filter((o) => !o.viaAgency && o.role === "admin" && o.parentId === null);
  const active = orgs.find((o) => o.id === activeId);
  if (active?.parentId) return direct.find((o) => o.id === active.parentId)?.id ?? null;
  if (active && direct.some((o) => o.id === active.id)) return active.id;
  return direct[0]?.id ?? null;
}

/** The ids the switcher should offer, and whether to show it at all: only for several organizations or an agency role. */
export function switcherVisible(orgs: ActableOrg[]): boolean {
  return orgs.length > 1;
}
