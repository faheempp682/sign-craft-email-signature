import { GoogleError } from "./errors";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs";
type Fetch = typeof fetch;

/** Gmail's documented limit for the signature field. Checked before sending so the person gets a clear answer. */
export const MAX_SIGNATURE_CHARS = 10_000;

export type SendAs = {
  email: string;
  displayName: string;
  isPrimary: boolean;
  isDefault: boolean;
  /** The signature currently saved for this address, as Gmail returns it (HTML). Empty when none. */
  signature: string;
  /** Aliases must be verified before Gmail will let their settings change. */
  canEdit: boolean;
};

type Raw = { sendAsEmail?: string; displayName?: string; isPrimary?: boolean; isDefault?: boolean; signature?: string; verificationStatus?: string };

const toSendAs = (r: Raw): SendAs | null =>
  r.sendAsEmail
    ? {
        email: r.sendAsEmail,
        displayName: r.displayName ?? "",
        isPrimary: !!r.isPrimary,
        isDefault: !!r.isDefault,
        signature: r.signature ?? "",
        canEdit: !!r.isPrimary || r.verificationStatus === undefined || r.verificationStatus === "accepted",
      }
    : null;

/** Turns a failed Gmail response into something the person can act on. Google's own wording is not shown, except for a rejected signature. */
export async function gmailFailure(res: Response): Promise<GoogleError> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; status?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } } | null;
  const reasons = [...(body?.error?.errors ?? []), ...(body?.error?.details ?? [])].map((e) => e.reason ?? "");
  const has = (...r: string[]) => reasons.some((x) => r.includes(x));

  if (res.status === 401) return new GoogleError("reconnect_required", "Google access has expired. Connect your Google account again.", 401);
  if (res.status === 403) {
    if (has("accessNotConfigured", "SERVICE_DISABLED")) return new GoogleError("gmail_api_disabled", "The Gmail API is switched off for this app's Google Cloud project. An admin needs to enable it. See docs/gmail-push.md.", 503);
    if (has("insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT")) return new GoogleError("scope_missing", "Signature changes were not allowed when you connected. Disconnect and connect again, and tick every permission.", 403);
    return new GoogleError("forbidden", "Google refused the change. Your Workspace admin may restrict signature changes, or this mailbox may not have Gmail.", 403);
  }
  if (res.status === 404) return new GoogleError("address_not_found", "That send-as address was not found on your Gmail account.", 404);
  if (res.status === 400) return new GoogleError("forbidden", `Gmail rejected the signature${body?.error?.message ? `: ${body.error.message}` : "."}`, 422);
  if (res.status === 429) return new GoogleError("rate_limited", "Google is limiting requests. Wait a minute and try again.", 429);
  console.error("[gmail] unexpected response:", res.status, body?.error?.status);
  return new GoogleError("upstream", "Gmail had a problem. Please try again in a moment.", 502);
}

async function call(token: string, url: string, init: RequestInit, fetchFn: Fetch): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers } });
  } catch {
    throw new GoogleError("upstream", "Could not reach Gmail. Check the connection and try again.", 502);
  }
  if (!res.ok) throw await gmailFailure(res);
  return res;
}

/** Every address this account can send as: the primary one plus any aliases. */
export async function listSendAs(token: string, fetchFn: Fetch = fetch): Promise<SendAs[]> {
  const res = await call(token, BASE, { method: "GET" }, fetchFn);
  const body = (await res.json().catch(() => ({}))) as { sendAs?: Raw[] };
  return (body.sendAs ?? []).flatMap((r) => toSendAs(r) ?? []);
}

export async function getSendAs(token: string, email: string, fetchFn: Fetch = fetch): Promise<SendAs> {
  const res = await call(token, `${BASE}/${encodeURIComponent(email)}`, { method: "GET" }, fetchFn);
  const one = toSendAs((await res.json().catch(() => ({}))) as Raw);
  if (!one) throw new GoogleError("upstream", "Gmail returned an unexpected answer. Please try again.", 502);
  return one;
}

/** Replaces the signature for one address. Callers must have shown the person the exact HTML and got their approval first. */
export async function setSignature(token: string, email: string, html: string, fetchFn: Fetch = fetch): Promise<void> {
  await call(token, `${BASE}/${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ signature: html }) }, fetchFn);
}
