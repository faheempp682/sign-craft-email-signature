import { backTo, clearStateCookie, readCookie } from "@/lib/google/cookies";
import { saveConnection } from "@/lib/google/connection";
import { GoogleError, isGoogleError } from "@/lib/google/errors";
import { exchangeCode, hasSettingsScope, readIdentity, revokeToken } from "@/lib/google/oauth";
import { googleContext, originOf } from "@/lib/google/server";
import { STATE_COOKIE, openState, sameState } from "@/lib/google/state";

export const runtime = "nodejs";

/** Google's `error` values that mean the Workspace itself blocks the app, rather than the person saying no. */
const ADMIN_BLOCKED = new Set(["admin_policy_enforced", "org_internal", "disallowed_useragent", "invalid_client", "access_blocked"]);

/**
 * Where Google sends the browser after the consent screen. Every check here exists because this is the one place a
 * forged or replayed request could attach someone else's Google account to a SignCraft user.
 */
export async function GET(req: Request) {
  const origin = originOf(req);
  const secure = origin.startsWith("https:");
  const clear = { "Set-Cookie": clearStateCookie(secure) };
  const url = new URL(req.url);

  const g = await googleContext(req);
  if (!g.ok) {
    if (g.response.status === 401) return Response.redirect(new URL("/login", origin), 302);
    const { error } = (await g.response.json().catch(() => ({}))) as { error?: string };
    return backTo(origin, "/preview", error ?? "error", clear);
  }
  const { cfg, admin, user } = g.ctx;

  // 1. This must be the sign-in WE started, for THIS signed-in person, still fresh.
  const st = openState(readCookie(req, STATE_COOKIE), cfg.key);
  if (!st || st.userId !== user.id) return backTo(origin, "/preview", "expired", clear);
  const back = (code: string) => backTo(origin, st.next, code, clear);
  if (!sameState(url.searchParams.get("state"), st.state)) return back("expired");

  // 2. They said no, or the Workspace admin blocks the app.
  const err = url.searchParams.get("error");
  if (err) return back(ADMIN_BLOCKED.has(err) ? "admin_blocked" : "denied");
  const code = url.searchParams.get("code");
  if (!code) return back("expired");

  // 3. Trade the code (PKCE proves it is the same browser), then vet what Google says about the account.
  let refreshToken: string | undefined;
  let accessToken: string | undefined;
  try {
    const tokens = await exchangeCode(cfg, code, st.verifier);
    refreshToken = tokens.refreshToken;
    accessToken = tokens.accessToken;
    const who = readIdentity(tokens.idToken, cfg); // Workspace account in an allowed domain
    if (!hasSettingsScope(tokens.scope)) throw new GoogleError("scope_missing", "Signature changes were not allowed.", 403);
    if (!tokens.refreshToken) throw new GoogleError("no_refresh_token", "Google did not return a long-lived connection.", 502);
    await saveConnection(admin, cfg, user.id, who, tokens.scope, tokens.refreshToken);
    return back("connected");
  } catch (e) {
    // Do not leave a grant behind that we are not going to use.
    const leftover = refreshToken ?? accessToken;
    if (leftover) await revokeToken(leftover);
    if (isGoogleError(e)) return back(e.code);
    console.error("[google] callback failed:", e instanceof Error ? e.message : e);
    return back("error");
  }
}
