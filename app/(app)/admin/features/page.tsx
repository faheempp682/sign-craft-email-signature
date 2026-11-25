import { notFound } from "next/navigation";
import { isPlatformAdmin } from "@/lib/authz/guard";
import { FEATURES, ROLES, isFeature, isRole, type Feature, type Role } from "@/lib/authz/roles";
import { createClient } from "@/lib/supabase/server";
import { FeaturesAdmin, type FlagRow, type OrgRow, type OverrideRow } from "./features-admin";

export const metadata = { title: "Features · Admin · SignCraft" };
export const dynamic = "force-dynamic";

export default async function FeaturesPage() {
  if (!(await isPlatformAdmin())) notFound(); // platform settings: admins of the default organization only
  const supabase = await createClient();
  if (!supabase) return null;

  const [flags, overrides, profiles, orgs] = await Promise.all([
    supabase.from("feature_flags").select("feature, description, default_enabled, min_role").order("feature"),
    supabase.from("feature_overrides").select("subject_type, subject_id, feature, enabled").order("updated_at", { ascending: false }),
    supabase.from("profiles").select("id, email"),
    supabase.from("organizations").select("id, name").order("name"),
  ]);
  const failed = flags.error ?? overrides.error ?? profiles.error ?? orgs.error;
  if (failed) {
    console.error("[admin/features] load failed:", failed.message);
    return <p className="card p-6 text-sm">Could not load the feature settings. Has <code>supabase/migrations/0003_access_control.sql</code> been applied?</p>;
  }

  const emailById = new Map((profiles.data ?? []).map((p) => [p.id, p.email]));
  const orgById = new Map((orgs.data ?? []).map((o) => [o.id, o.name]));

  const flagRows: FlagRow[] = (flags.data ?? []).flatMap((f) =>
    isFeature(f.feature) && isRole(f.min_role) ? [{ feature: f.feature, label: FEATURES[f.feature], description: f.description, defaultEnabled: f.default_enabled, minRole: f.min_role as Role }] : [],
  );
  const overrideRows: OverrideRow[] = (overrides.data ?? []).flatMap((o) => {
    if (!isFeature(o.feature) || (o.subject_type !== "user" && o.subject_type !== "org")) return [];
    const who = o.subject_type === "user" ? (emailById.get(o.subject_id) ?? "Deleted account") : (orgById.get(o.subject_id) ?? "Deleted organization");
    return [{ subjectType: o.subject_type, subjectId: o.subject_id, who, feature: o.feature as Feature, enabled: o.enabled }];
  });
  const orgRows: OrgRow[] = (orgs.data ?? []).map((o) => ({ id: o.id, name: o.name }));

  return <FeaturesAdmin flags={flagRows} overrides={overrideRows} orgs={orgRows} roles={[...ROLES]} />;
}
