import { deny, requireUser } from "@/lib/authz/guard";
import { featureEnabled } from "@/lib/authz/guard";
import { BRANDING_COLUMNS, BrandingInput, resolveBranding, type BrandingRow } from "@/lib/org/branding";
import { readActiveOrgCookie, resolveActiveOrg, UUID_RE } from "@/lib/org/active";
import { noStore, orgFailure, orgRequest } from "@/lib/org/route";

export const runtime = "nodejs";

/** Branding of the active organization (or `?org_id=`, which must be one the caller belongs to). Any signed-in member. */
export async function GET(req: Request) {
  const u = await requireUser();
  if (!u.ok) return u.response;
  const { supabase, user } = u.ctx;
  const asked = new URL(req.url).searchParams.get("org_id") ?? undefined;
  if (asked && !UUID_RE.test(asked)) return deny(400, "bad_request", "Invalid organization.");
  const org = await resolveActiveOrg(supabase, user.id, { admin: false, requested: asked, cookie: asked ? undefined : await readActiveOrgCookie() });
  if (!org) return deny(404, "not_found", "No organization.");
  const { data, error } = await supabase.from("organization_branding").select(BRANDING_COLUMNS).eq("org_id", org).maybeSingle();
  if (error) return orgFailure(error);
  return Response.json({ org_id: org, branding: resolveBranding(data as BrandingRow | null), stored: data ?? null }, { headers: noStore });
}

/**
 * Replace the branding of an organization the caller administers (their own, or a client of their agency).
 * Hiding "Powered by SignCraft" is part of white-label and needs the agency_mode feature.
 */
export async function PUT(req: Request) {
  const a = await orgRequest(req, BrandingInput, { role: "admin" });
  if (!a.ok) return a.response;
  const { supabase, user } = a.ctx.ctx;
  const { org_id, ...fields } = a.ctx.data;

  const org = await resolveActiveOrg(supabase, user.id, { admin: true, requested: org_id, cookie: org_id ? undefined : await readActiveOrgCookie() });
  if (!org) return deny(403, "forbidden", "You do not have permission to do that.");

  if (fields.show_powered_by === false) {
    const on = await featureEnabled(supabase, "agency_mode");
    if (on !== true) return deny(403, "feature_disabled", "Hiding “Powered by SignCraft” needs agency mode.");
  }

  const row = { org_id: org, ...fields, updated_by: user.id, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from("organization_branding").upsert(row, { onConflict: "org_id" }).select(BRANDING_COLUMNS).single();
  if (error) return orgFailure(error);
  return Response.json({ org_id: org, branding: resolveBranding(data as BrandingRow) }, { headers: noStore });
}
