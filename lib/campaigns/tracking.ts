import type { TrackOptions } from "@/lib/renderer/shared";
import { readSecret, signToken } from "./token";

/**
 * Tracking options for renderToEmailHtml, built on the server. Returns undefined when CAMPAIGN_TOKEN_SECRET is not
 * set, so tracked banners simply render as plain banners instead of emitting links that could not be verified.
 *
 * `baseUrl` must be the PUBLIC address recipients' mail apps can reach (CAMPAIGN_BASE_URL), not localhost.
 */
export function trackingOptions(signatureId: string, fallbackOrigin: string, env: Record<string, string | undefined> = process.env): TrackOptions | undefined {
  const secret = readSecret(env);
  if (!secret) return undefined;
  const base = (env.CAMPAIGN_BASE_URL?.trim() || fallbackOrigin).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) return undefined;
  return { baseUrl: base, signatureId, sign: (p) => signToken(p, secret) };
}
