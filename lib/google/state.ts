import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { decryptSecret, encryptSecret } from "./crypto";

/**
 * The sign-in handshake. When someone clicks Connect we remember three things for ten minutes in an encrypted,
 * HttpOnly cookie: a random `state` (so the callback is the one we started, not a forged one), the PKCE `verifier`
 * (so a stolen authorization code is useless), and who started it. Nothing is stored in the database.
 */

export const STATE_COOKIE = "gmail_oauth";
export const STATE_TTL_MS = 10 * 60_000;
const CONTEXT = "gmail-oauth-state";

export type OAuthState = { state: string; verifier: string; userId: string; next: string; exp: number };

export const randomToken = () => randomBytes(32).toString("base64url");
export const challengeFor = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function newHandshake(userId: string, next: string, now = Date.now()): OAuthState {
  return { state: randomToken(), verifier: randomToken(), userId, next, exp: now + STATE_TTL_MS };
}

export const sealState = (s: OAuthState, key: Buffer): string => encryptSecret(JSON.stringify(s), key, CONTEXT);

/** Returns null for anything missing, altered, expired or malformed. */
export function openState(cookie: string | undefined, key: Buffer, now = Date.now()): OAuthState | null {
  if (!cookie) return null;
  try {
    const s = JSON.parse(decryptSecret(cookie, key, CONTEXT)) as Partial<OAuthState>;
    if (typeof s.state !== "string" || typeof s.verifier !== "string" || typeof s.userId !== "string" || typeof s.next !== "string" || typeof s.exp !== "number") return null;
    return s.exp > now ? (s as OAuthState) : null;
  } catch {
    return null;
  }
}

/** Constant-time comparison, so the state check does not leak how much of a guess was right. */
export function sameState(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
