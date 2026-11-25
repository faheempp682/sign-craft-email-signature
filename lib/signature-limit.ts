import type { SupabaseClient } from "@supabase/supabase-js";

/** Used when neither the admin setting nor the environment variable says otherwise. */
export const DEFAULT_SIGNATURE_LIMIT = 5;
export const SIGNATURE_LIMIT_KEY = "max_signatures_per_account";
/** Upper bound an admin can set, so a typo cannot remove the cap by accident. */
export const MAX_SIGNATURE_LIMIT = 1000;

/** A positive whole number within bounds, or null. Accepts numbers and numeric strings (env values, JSON). */
export function parseLimit(raw: unknown): number | null {
  const n = typeof raw === "string" && /^\d{1,5}$/.test(raw.trim()) ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_SIGNATURE_LIMIT ? n : null;
}

/** Environment fallback: MAX_SIGNATURES_PER_ACCOUNT, else 5. */
export function envSignatureLimit(env: Record<string, string | undefined> = process.env): number {
  return parseLimit(env.MAX_SIGNATURES_PER_ACCOUNT) ?? DEFAULT_SIGNATURE_LIMIT;
}

/** How many signatures one account may keep: the admin setting if there is one, else the environment value, else 5. */
export async function getSignatureLimit(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.from("platform_settings").select("value").eq("key", SIGNATURE_LIMIT_KEY).maybeSingle();
  return parseLimit(data?.value) ?? envSignatureLimit();
}
