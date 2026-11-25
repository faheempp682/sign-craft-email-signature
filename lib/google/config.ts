import { parseKey } from "./crypto";

/** The only permission requested: read and change Gmail settings such as the signature. It cannot read mail. */
export const GMAIL_SETTINGS_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";
export const SCOPES = ["openid", "email", GMAIL_SETTINGS_SCOPE];

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  /** 32-byte key used to encrypt refresh tokens. Server only. */
  key: Buffer;
  /** Workspace domains allowed to connect, lower case. */
  domains: string[];
  redirectUri: string;
};

export type ConfigResult = { ok: true; config: GoogleConfig } | { ok: false; missing: string[] };

/**
 * Reads the server settings. Nothing here ever reaches the browser. Returns the names of whatever is missing, so the
 * message can say exactly what to add to .env.local.
 */
export function readGoogleConfig(origin: string, env: Record<string, string | undefined> = process.env): ConfigResult {
  const missing: string[] = [];
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const key = parseKey(env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  const domains = (env.GOOGLE_WORKSPACE_DOMAINS || env.ALLOWED_EMAIL_DOMAINS || "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  if (!clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!key) missing.push("GOOGLE_TOKEN_ENCRYPTION_KEY (32 random bytes, base64)");
  if (domains.length === 0) missing.push("GOOGLE_WORKSPACE_DOMAINS");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length || !clientId || !clientSecret || !key) return { ok: false, missing };

  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim() || new URL("/api/google/callback", origin).toString();
  return { ok: true, config: { clientId, clientSecret, key, domains, redirectUri } };
}
