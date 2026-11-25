import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { TrackPayload } from "@/lib/renderer/shared";

/**
 * Signed tracking tokens for /b/<token> (banner image) and /r/<token> (click redirect).
 *
 * token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, "sc-token-v1:" + first part))
 *
 * The payload carries everything a redirect may ever target (`h`, `f`), and it is signed, so the person holding a link
 * can read it but cannot change it: there is no open redirect and no way to point a tracked link anywhere new.
 * The secret is CAMPAIGN_TOKEN_SECRET; without it nothing is signed and every token is refused (fail closed).
 */

export const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 2600;
const B64URL = /^[A-Za-z0-9_-]+$/;

export function readSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.CAMPAIGN_TOKEN_SECRET?.trim();
  return s && s.length >= MIN_SECRET_LENGTH ? s : null;
}

/** An https URL we are willing to send anyone to: no credentials in it, a real host, bounded length. */
export function safeTarget(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 1000 || /[\u0000-\u001f\u007f\s]/.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const url = z.string().refine((v) => safeTarget(v) !== null);
const uuid = z.string().uuid();
const Payload = z.strictObject({ t: z.enum(["r", "b"]), c: uuid.optional(), s: uuid, h: url.optional(), f: url.optional() });

const mac = (secret: string, body: string) => createHmac("sha256", secret).update(`sc-token-v1:${body}`).digest("base64url");

export function signToken(payload: TrackPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${mac(secret, body)}`;
}

/** The payload when the token is well formed, signed with this secret and of the expected kind; otherwise null. */
export function verifyToken(token: unknown, secret: string | null, kind: "r" | "b"): TrackPayload | null {
  if (!secret || typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !B64URL.test(parts[0]) || !B64URL.test(parts[1])) return null;
  const given = Buffer.from(parts[1], "base64url");
  const expected = Buffer.from(mac(secret, parts[0]), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = Payload.safeParse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
    return parsed.success && parsed.data.t === kind ? (parsed.data as TrackPayload) : null;
  } catch {
    return null;
  }
}

/** A hash that changes every UTC day, so a visitor cannot be followed across days. Never stored. */
export function visitorHash(secret: string, day: string, ip: string, userAgent: string): string {
  const salt = createHmac("sha256", secret).update(`sc-salt-v1:${day}`).digest();
  return createHash("sha256").update(salt).update(ip).update("\n").update(userAgent.slice(0, 300)).digest("hex").slice(0, 32);
}
