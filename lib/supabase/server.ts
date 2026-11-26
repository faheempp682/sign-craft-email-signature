import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { getSupabaseEnv } from "./env";

/**
 * Server-side client bound to the request's session cookies. Returns null when Supabase is not configured.
 * Memoized per request (React `cache`): the layout, the page and every guard share one client.
 */
export const createClient = cache(async () => {
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
});

/**
 * The signed-in user, or null (also null when Supabase is not configured). Always verified with the auth server.
 * Memoized per request: that verification is a network round trip, and one page render used to make it about five times.
 */
export const getUser = cache(async () => {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
});
