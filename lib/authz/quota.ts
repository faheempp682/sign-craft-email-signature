import type { SupabaseClient } from "@supabase/supabase-js";
import { createWindowLimiter } from "@/lib/ai/ttl-cache";
import { FEATURES, type AiFeature } from "./roles";

type Rpc = Pick<SupabaseClient, "rpc">;

export type QuotaResult =
  | { allowed: true; usageId: string; remainingDay: number | null }
  | { allowed: false; reason: "feature_disabled" | "rate_limited" | "daily_limit" | "unavailable" };

/**
 * Check the feature flag and the per-minute / per-day limits and record the use, in one atomic database call.
 * Fails closed: if the call itself fails (database down, migration not applied) nothing is allowed.
 */
export async function consumeQuota(db: Rpc, feature: AiFeature): Promise<QuotaResult> {
  const { data, error } = await db.rpc("consume_ai_quota", { p_feature: feature });
  if (error || !data || typeof data !== "object") {
    console.error("[authz] consume_ai_quota failed:", error?.message ?? "empty response");
    return { allowed: false, reason: "unavailable" };
  }
  const r = data as { allowed?: boolean; reason?: string; usage_id?: string; remaining_day?: number | null };
  if (r.allowed === true && typeof r.usage_id === "string") return { allowed: true, usageId: r.usage_id, remainingDay: r.remaining_day ?? null };
  if (r.reason === "feature_disabled" || r.reason === "rate_limited" || r.reason === "daily_limit") return { allowed: false, reason: r.reason };
  return { allowed: false, reason: "unavailable" };
}

/** Best effort: the paid call already happened, so a bookkeeping failure must not fail the user's request. */
export async function finishUsage(db: Rpc, usageId: string, tokensIn: number, tokensOut: number): Promise<void> {
  const { error } = await db.rpc("finish_ai_usage", { p_id: usageId, p_tokens_in: Math.round(tokensIn), p_tokens_out: Math.round(tokensOut) });
  if (error) console.error("[authz] finish_ai_usage failed:", error.message);
}

export async function refundUsage(db: Rpc, usageId: string): Promise<void> {
  const { error } = await db.rpc("refund_ai_usage", { p_id: usageId });
  if (error) console.error("[authz] refund_ai_usage failed:", error.message);
}

export type DenyReason = Extract<QuotaResult, { allowed: false }>["reason"];

export const quotaDenial: Record<DenyReason, (f: AiFeature) => { status: number; error: string; message: string }> = {
  feature_disabled: (f) => ({ status: 403, error: "feature_disabled", message: `${FEATURES[f]} is not enabled for your account.` }),
  rate_limited: () => ({ status: 429, error: "rate_limited", message: "Too many requests. Please wait a minute and try again." }),
  daily_limit: (f) => ({ status: 429, error: "daily_limit", message: `You have reached today's limit for ${FEATURES[f].toLowerCase()}. Try again tomorrow, or ask an admin to raise it.` }),
  unavailable: () => ({ status: 503, error: "authz_unavailable", message: "Usage limits are not set up yet. Apply supabase/migrations/0003_access_control.sql, then try again." }),
};

/**
 * Local-development fallback for when Supabase is not configured at all (the app then runs as a draft editor with no
 * accounts). In memory, per process, keyed by IP. Never used when Supabase is configured.
 */
const localLimiters = new Map<string, (key: string) => boolean>();
export function localQuota(feature: AiFeature, key: string, limits: { perMinute: number; perDay: number }): "ok" | "rate_limited" | "daily_limit" {
  const get = (suffix: string, windowMs: number, max: number) => {
    const id = `${feature}:${suffix}:${max}`;
    let l = localLimiters.get(id);
    if (!l) localLimiters.set(id, (l = createWindowLimiter(windowMs, max)));
    return l;
  };
  if (get("m", 60_000, limits.perMinute)(key)) return "rate_limited";
  if (get("d", 24 * 60 * 60_000, limits.perDay)(key)) return "daily_limit";
  return "ok";
}
