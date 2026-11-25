import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_FEATURES, FEATURES, ROLES, isAiFeature, isFeature, isRole, type AiFeature, type Feature, type Role } from "@/lib/authz/roles";

/** Plan presets (migration 0015). A plan is data on an organization; nothing here charges anyone. */

export type PlanLimit = { role: Role; feature: AiFeature; perMinute: number | null; perDay: number | null };
export type PlanView = {
  id: string;
  name: string;
  description: string;
  /** Features the plan decides: true = on by default, false = off. Features not listed are left to the flag defaults. */
  features: Partial<Record<Feature, boolean>>;
  limits: PlanLimit[];
};

type PlanRow = { id: string; name: string; description: string; sort_order: number };
type FeatureRow = { plan: string; feature: string; enabled: boolean };
type LimitRow = { plan: string; role: string; feature: string; per_minute: number | null; per_day: number | null };

/** Read every preset with the caller's session (the three plan tables are readable by any signed-in person). null on failure. */
export async function loadPlans(supabase: Pick<SupabaseClient, "from">): Promise<PlanView[] | null> {
  const [plans, feats, limits] = await Promise.all([
    supabase.from("plans").select("id, name, description, sort_order").order("sort_order"),
    supabase.from("plan_features").select("plan, feature, enabled"),
    supabase.from("plan_ai_limits").select("plan, role, feature, per_minute, per_day"),
  ]);
  const failed = plans.error ?? feats.error ?? limits.error;
  if (failed) {
    console.error("[plans] load failed:", failed.message);
    return null;
  }
  return ((plans.data ?? []) as PlanRow[]).map((p) => {
    const features: PlanView["features"] = {};
    for (const f of (feats.data ?? []) as FeatureRow[]) if (f.plan === p.id && isFeature(f.feature)) features[f.feature] = f.enabled;
    const lim: PlanLimit[] = [];
    for (const l of (limits.data ?? []) as LimitRow[]) {
      if (l.plan === p.id && isRole(l.role) && isAiFeature(l.feature)) lim.push({ role: l.role, feature: l.feature, perMinute: l.per_minute, perDay: l.per_day });
    }
    lim.sort((a, b) => AI_FEATURES.indexOf(a.feature) - AI_FEATURES.indexOf(b.feature) || ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
    return { id: p.id, name: p.name, description: p.description, features, limits: lim };
  });
}

/** "5 a day", "2 a minute, 5 a day", "No limit". */
export function describeLimit(l: Pick<PlanLimit, "perMinute" | "perDay">): string {
  const parts = [l.perMinute === null ? null : `${l.perMinute} a minute`, l.perDay === null ? null : `${l.perDay} a day`].filter(Boolean);
  return parts.length ? parts.join(", ") : "No limit";
}

export const featureLabel = (f: Feature) => FEATURES[f];
export const FEATURE_KEYS = Object.keys(FEATURES) as Feature[];
