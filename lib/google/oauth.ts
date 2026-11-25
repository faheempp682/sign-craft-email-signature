import { GMAIL_SETTINGS_SCOPE, SCOPES, type GoogleConfig } from "./config";
import { challengeFor } from "./state";
import { GoogleError } from "./errors";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

type Fetch = typeof fetch;

/** The address Google sends the person to. `hd` only narrows the account chooser; the domain is enforced again on our side. */
export function buildAuthUrl(cfg: GoogleConfig, state: string, verifier: string): string {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
    code_challenge: challengeFor(verifier),
    code_challenge_method: "S256",
    access_type: "offline", // we need a refresh token
    prompt: "consent", // and Google only hands one out when the consent screen is shown
    include_granted_scopes: "false",
    ...(cfg.domains.length === 1 ? { hd: cfg.domains[0] } : {}),
  }).toString();
  return u.toString();
}

export type TokenSet = { accessToken: string; refreshToken?: string; idToken?: string; scope: string; expiresIn: number };

async function tokenRequest(params: Record<string, string>, fetchFn: Fetch): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetchFn(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  } catch {
    throw new GoogleError("upstream", "Could not reach Google. Check the connection and try again.", 502);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

/** Trades the one-time code for tokens. The PKCE verifier proves this is the browser that started the sign-in. */
export async function exchangeCode(cfg: GoogleConfig, code: string, verifier: string, fetchFn: Fetch = fetch): Promise<TokenSet> {
  const r = await tokenRequest(
    { code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: "authorization_code", code_verifier: verifier },
    fetchFn,
  );
  if (!r.ok) {
    if (r.body.error === "invalid_grant") throw new GoogleError("reconnect_required", "That sign-in expired. Please try connecting again.", 400);
    console.error("[google] code exchange failed:", r.status, r.body.error);
    throw new GoogleError("upstream", "Google did not accept the sign-in. Please try again.", 502);
  }
  return {
    accessToken: String(r.body.access_token ?? ""),
    refreshToken: typeof r.body.refresh_token === "string" ? r.body.refresh_token : undefined,
    idToken: typeof r.body.id_token === "string" ? r.body.id_token : undefined,
    scope: String(r.body.scope ?? ""),
    expiresIn: Number(r.body.expires_in ?? 0),
  };
}

/** Gets a fresh short-lived access token. `invalid_grant` means the person revoked access (or it expired): they must reconnect. */
export async function refreshAccessToken(cfg: GoogleConfig, refreshToken: string, fetchFn: Fetch = fetch): Promise<string> {
  const r = await tokenRequest({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }, fetchFn);
  if (!r.ok) {
    if (r.body.error === "invalid_grant") throw new GoogleError("reconnect_required", "Google access was removed or expired. Connect your Google account again.", 401);
    console.error("[google] token refresh failed:", r.status, r.body.error);
    throw new GoogleError("upstream", "Google could not refresh access right now. Please try again in a moment.", 502);
  }
  const token = r.body.access_token;
  if (typeof token !== "string" || !token) throw new GoogleError("upstream", "Google returned an unexpected answer. Please try again.", 502);
  return token;
}

export type RevokeResult = "revoked" | "already_invalid" | "failed";

/** Tells Google to cancel the grant. "already_invalid" means it was already gone, which is the outcome we wanted. */
export async function revokeToken(token: string, fetchFn: Fetch = fetch): Promise<RevokeResult> {
  try {
    const res = await fetchFn(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
    if (res.ok) return "revoked";
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error === "invalid_token" ? "already_invalid" : "failed";
  } catch {
    return "failed";
  }
}

export const hasSettingsScope = (scope: string): boolean => scope.split(/\s+/).includes(GMAIL_SETTINGS_SCOPE);

/* ---------- the identity Google vouches for ---------- */

export type Identity = { sub: string; email: string; hd: string };

/**
 * Reads the id_token. It came straight from Google's token endpoint over TLS in answer to our own request, so its
 * signature need not be re-checked (OpenID Connect Core 3.1.3.7); its claims are checked here instead.
 * The key check: it must be a Workspace account (`hd`) in one of the allowed domains.
 */
export function readIdentity(idToken: string | undefined, cfg: GoogleConfig, now = Date.now()): Identity {
  const bad = () => new GoogleError("upstream", "Google returned an unexpected answer. Please try again.", 502);
  const part = idToken?.split(".")[1];
  if (!part) throw bad();
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw bad();
  }
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!["https://accounts.google.com", "accounts.google.com"].includes(String(c.iss)) || !aud.includes(cfg.clientId) || typeof c.exp !== "number" || c.exp * 1000 <= now) throw bad();
  if (typeof c.sub !== "string" || typeof c.email !== "string" || c.email_verified !== true) throw bad();

  const hd = typeof c.hd === "string" ? c.hd.toLowerCase() : "";
  if (!hd) throw new GoogleError("wrong_account", `${c.email} is a personal Google account. Connect with your ${cfg.domains.join(" or ")} Workspace account.`, 403);
  if (!cfg.domains.includes(hd)) throw new GoogleError("wrong_account", `${c.email} is not in an allowed Workspace domain (${cfg.domains.join(", ")}).`, 403);
  return { sub: c.sub, email: c.email, hd };
}
