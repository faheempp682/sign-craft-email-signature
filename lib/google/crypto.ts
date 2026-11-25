import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption for secrets we must keep (Google refresh tokens) and for the short-lived sign-in cookie.
 * AES-256-GCM: the ciphertext is also tamper-proof. The "context" string is bound into the ciphertext, so a value
 * encrypted for one person (or purpose) fails to decrypt for another. Even someone with database access cannot move a
 * token between accounts. Format: v1.<iv>.<tag>.<ciphertext>, each part base64url.
 */

export class CryptoError extends Error {}

const b64 = (b: Buffer) => b.toString("base64url");

/** A usable key is exactly 32 bytes, given as base64 (standard or url-safe). Anything else returns null. */
export function parseKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  try {
    const key = Buffer.from(value.trim(), "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function encryptSecret(plain: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(ct)}`;
}

export function decryptSecret(payload: string, key: Buffer, context: string): string {
  const [version, iv, tag, ct, extra] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ct || extra !== undefined) throw new CryptoError("Unrecognised encrypted value.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new CryptoError("Could not decrypt (wrong key, wrong owner, or the value was altered).");
  }
}

/** Binds a stored refresh token to its owner. */
export const tokenContext = (userId: string) => `google-refresh:${userId}`;

/** A short fingerprint of some text, used to prove "this is exactly what you were shown". */
export const fingerprint = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 32);
