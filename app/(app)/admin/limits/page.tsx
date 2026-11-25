import { notFound } from "next/navigation";
import { isPlatformAdmin } from "@/lib/authz/guard";
import { AI_FEATURES, FEATURES, ROLES, isAiFeature, type AiFeature, type Role } from "@/lib/authz/roles";
import { createClient } from "@/lib/supabase/server";
import { SIGNATURE_LIMIT_KEY, envSignatureLimit, parseLimit } from "@/lib/signature-limit";
import { LimitsAdmin, type LimitRow, type UsageRow } from "./limits-admin";

export const metadata = { title: "AI limits · Admin · SignCraft" };
export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60_000;
const USAGE_ROWS = 5000; // enough for a team; the summary says so if it was cut

export default async function LimitsPage() {
  if (!(await isPlatformAdmin())) notFound(); // platform settings: admins of the default organization only
  const supabase = await createClient();
  if (!supabase) return null;

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const [limits, usage, profiles, setting] = await Promise.all([
    supabase.from("ai_limits").select("role, feature, per_minute, per_day"),
    supabase.from("ai_usage").select("user_id, feature, tokens_in, tokens_out").gte("created_at", since).order("created_at", { ascending: false }).limit(USAGE_ROWS),
    supabase.from("profiles").select("id, email"),
    supabase.from("platform_settings").select("value").eq("key", SIGNATURE_LIMIT_KEY).maybeSingle(),
  ]);
  const failed = limits.error ?? usage.error ?? profiles.error;
  if (failed) {
    console.error("[admin/limits] load failed:", failed.message);
    return <p className="card p-6 text-sm">Could not load the limits. Has <code>supabase/migrations/0003_access_control.sql</code> been applied?</p>;
  }

  const byKey = new Map((limits.data ?? []).map((l) => [`${l.role}:${l.feature}`, l]));
  const rows: LimitRow[] = AI_FEATURES.flatMap((feature: AiFeature) =>
    ROLES.map((role: Role) => {
      const l = byKey.get(`${role}:${feature}`);
      return { role, feature, label: FEATURES[feature], perMinute: l?.per_minute ?? null, perDay: l?.per_day ?? null, configured: !!l };
    }),
  );

  const emailById = new Map((profiles.data ?? []).map((p) => [p.id, p.email]));
  const agg = new Map<string, UsageRow>();
  for (const u of usage.data ?? []) {
    if (!isAiFeature(u.feature)) continue;
    const key = `${u.user_id}:${u.feature}`;
    const row = agg.get(key) ?? { who: emailById.get(u.user_id) ?? "Deleted account", feature: u.feature, label: FEATURES[u.feature], calls: 0, tokensIn: 0, tokensOut: 0 };
    row.calls += 1;
    row.tokensIn += u.tokens_in ?? 0;
    row.tokensOut += u.tokens_out ?? 0;
    agg.set(key, row);
  }
  const usageRows = [...agg.values()].sort((a, b) => b.calls - a.calls).slice(0, 25);

  // A missing platform_settings table (migration 0019 not applied yet) just means "no admin setting": the environment value applies.
  const adminLimit = setting.error ? null : parseLimit(setting.data?.value);
  return <LimitsAdmin rows={rows} usage={usageRows} truncated={(usage.data?.length ?? 0) >= USAGE_ROWS} signatureLimit={{ adminValue: adminLimit, fallback: envSignatureLimit(), tableMissing: !!setting.error }} />;
}
