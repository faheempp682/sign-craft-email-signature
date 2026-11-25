import { FIELD_MAX, type SyncWarning, type TextField } from "./types";

export type SyncErrorCode =
  | "not_configured" // an environment variable is missing or malformed
  | "not_authorized" // the service rejected our credentials or permissions
  | "upstream" // the service failed, was unreachable, or answered something unexpected
  | "too_large" // more data than we are willing to handle (never truncated: a partial list would deactivate people)
  | "blocked" // the request itself was refused by our own guards (bad URL, private address ...)
  | "bad_config";

/** An expected, explainable failure. `message` is safe to show an admin and never contains a secret. */
export class SyncError extends Error {
  constructor(
    public readonly code: SyncErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Plain single-line text: control characters removed, whitespace collapsed, trimmed. */
export function clean(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
}

export const cleanField = (v: unknown, f: TextField) => clean(v).slice(0, FIELD_MAX[f]).trim();

/** Collects warnings but keeps only the first 50 (a broken source must not produce a huge history row). */
export class Warnings {
  list: SyncWarning[] = [];
  count = 0;
  add(who: string, message: string) {
    this.count++;
    if (this.list.length < 50) this.list.push({ who, message });
  }
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A fetch with a time limit; network errors become a SyncError, never a raw exception with URLs or tokens in it. */
export async function timedFetch(fetchFn: typeof fetch, url: string, init: RequestInit, who: string, ms = 20_000): Promise<Response> {
  try {
    return await fetchFn(url, { ...init, signal: AbortSignal.timeout(ms), redirect: "error" });
  } catch {
    throw new SyncError("upstream", `Could not reach ${who}. Check the connection and try again.`);
  }
}

/** Reads a JSON body up to a size limit. */
export async function readJson(res: Response, who: string, maxBytes = 20 * 1024 * 1024): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (text.length > maxBytes) throw new SyncError("too_large", `${who} sent a response that is too large.`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new SyncError("upstream", `${who} sent an answer that is not valid JSON.`);
  }
}
