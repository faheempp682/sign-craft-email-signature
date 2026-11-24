import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

/** Server-side client bound to the request's session cookies. Returns null when Supabase is not configured. */
export async function createClient() {
  const env = getSupabaseEnv();
  if (!env) return null;
  const store = await cookies();
  return createServerClient(env.url, env.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* Called from a Server Component, where cookies are read-only. The middleware refreshes the session instead. */
        }
      },
    },
  });
}

/** The signed-in user, or null (also null when Supabase is not configured). Always verified with the auth server. */
export async function getUser() {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}
