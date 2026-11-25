import { createSign } from "node:crypto";

/**
 * Domain-wide delegation: a Google service account that a Workspace admin has authorised can act as any user in the
 * domain for the scopes the admin listed. This is how the server reads the company directory and sets signatures for
 * many people at once, without each person signing in.
 *
 * The credentials come from the server environment only (GOOGLE_SERVICE_ACCOUNT_JSON), never from a browser or a
 * database row. Nothing here is ever logged or returned to a caller except the short-lived access token itself.
 *
 * This module is separate from lib/google (the per-person OAuth flow used by Gmail push) and does not change it.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const LIFETIME_S = 3600;

export type ServiceAccount = { clientEmail: string; privateKey: string };

export type DwdErrorCode =
  | "not_configured" // no usable service account in the environment
  | "not_authorized" // the admin has not granted this service account these scopes (domain-wide delegation)
  | "bad_subject" // the user to act as does not exist or is suspended
  | "upstream"; // Google had a problem or could not be reached

/** An expected, explainable failure. `message` is safe to show an admin. */
export class DwdError extends Error {
  constructor(
    public readonly code: DwdErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Reads GOOGLE_SERVICE_ACCOUNT_JSON: the key file's JSON as-is, or that JSON base64-encoded (easier in some hosts'
 * settings screens). Returns null unless it holds a client_email and an RSA private key.
 */
export function readServiceAccount(env: Record<string, string | undefined> = process.env): ServiceAccount | null {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const j = JSON.parse(text) as { client_email?: unknown; private_key?: unknown };
    if (typeof j.client_email !== "string" || !/^[^@\s]+@[^@\s]+$/.test(j.client_email)) return null;
    if (typeof j.private_key !== "string" || !/-----BEGIN (RSA )?PRIVATE KEY-----/.test(j.private_key)) return null;
    return { clientEmail: j.client_email, privateKey: j.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** The signed request Google exchanges for an access token ("assertion"). `subject` is the user to act as. */
export function buildAssertion(sa: ServiceAccount, o: { subject: string; scopes: readonly string[]; nowMs?: number }): string {
  const iat = Math.floor((o.nowMs ?? Date.now()) / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.clientEmail, sub: o.subject, scope: o.scopes.join(" "), aud: TOKEN_URL, iat, exp: iat + LIFETIME_S }));
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${claims}`);
  return `${header}.${claims}.${sign.sign(sa.privateKey).toString("base64url")}`;
}

type Fetch = typeof fetch;
const cache = new Map<string, { token: string; expiresAt: number }>();

/** Clears remembered tokens (tests, or after credentials change). */
export const clearDelegatedTokens = () => cache.clear();

/**
 * An access token that acts as `subject` (an email in the Workspace) for `scopes`. Tokens are remembered until a minute
 * before they expire, so a batch of calls for the same person costs one exchange.
 */
export async function getDelegatedToken(sa: ServiceAccount, subject: string, scopes: readonly string[], fetchFn: Fetch = fetch, nowMs: number = Date.now()): Promise<string> {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(subject)) throw new DwdError("bad_subject", "That is not a valid email address to act as.");
  const key = `${sa.clientEmail}|${subject.toLowerCase()}|${[...scopes].sort().join(" ")}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt - 60_000 > nowMs) return hit.token;

  let res: Response;
  try {
    res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: GRANT, assertion: buildAssertion(sa, { subject, scopes, nowMs }) }),
    });
  } catch {
    throw new DwdError("upstream", "Could not reach Google. Check the connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    const desc = body.error_description ?? "";
    if (body.error === "unauthorized_client") {
      throw new DwdError("not_authorized", "Google refused: this service account has not been given domain-wide delegation for these permissions. A Workspace admin must add its client ID and the scopes in the Admin console (see the setup guide).");
    }
    if (body.error === "invalid_grant") {
      throw new DwdError("bad_subject", /signature|jwt/i.test(desc) ? "Google could not verify the service account key. Check GOOGLE_SERVICE_ACCOUNT_JSON." : `Google would not let the service account act as ${subject}. The account may not exist or may be suspended.`);
    }
    console.error("[dwd] token exchange failed:", res.status, body.error);
    throw new DwdError("upstream", "Google could not issue an access token right now. Please try again in a moment.");
  }
  cache.set(key, { token: body.access_token, expiresAt: nowMs + (body.expires_in ?? LIFETIME_S) * 1000 });
  return body.access_token;
}
