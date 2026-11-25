import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

/**
 * A privileged client that bypasses row-level security. SERVER ONLY, never import it from a client component.
 * It exists for exactly one job: promoting the emails listed in ADMIN_EMAILS (see lib/authz/bootstrap.ts), which
 * cannot be done as the user themselves without letting anyone promote themselves.
 * Returns null when SUPABASE_SERVICE_ROLE_KEY is not set.
 */
export function createAdminClient() {
  const env = getSupabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env || !key) return null;
  return createClient(env.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
