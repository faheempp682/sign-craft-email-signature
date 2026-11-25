import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/public-routes";
import { getSupabaseEnv } from "./env";

/**
 * Without Supabase variables the app is a local-only editor with no login. That is right on a developer's machine and wrong
 * on a server: a missing or misspelled variable would silently serve every page to everyone. So in production the private
 * routes answer 503 until Supabase is configured. A deployment that really wants the login-free editor says so with
 * ALLOW_LOCAL_MODE=true (docs/access-control.md).
 */
export function mustFailClosed(pathname: string, env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" && env.ALLOW_LOCAL_MODE !== "true" && !isPublicPath(pathname);
}

/** Refreshes the session cookie on every request and gates everything except the public routes (see lib/public-routes.ts). */
export async function updateSession(request: NextRequest) {
  const env = getSupabaseEnv();
  if (!env) {
    if (!mustFailClosed(request.nextUrl.pathname)) return NextResponse.next({ request }); // not configured: run as a local-only editor
    const body = { error: "not_configured", message: "Sign-in is not set up on this server. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY." };
    return NextResponse.json(body, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() validates the token with Supabase; getSession() would trust the cookie blindly.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isPublic = isPublicPath(pathname);

  if (!user && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized", message: "Please sign in." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    const redirect = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }

  return response;
}
