export type GoogleErrorCode =
  | "not_configured" // server settings missing
  | "not_connected" // this person has not connected Google
  | "reconnect_required" // token expired or access was revoked
  | "wrong_account" // not an account in the allowed Workspace domain(s)
  | "scope_missing" // consent screen was completed without allowing signature changes
  | "no_refresh_token"
  | "denied" // person cancelled on Google's screen
  | "admin_blocked" // the Workspace admin blocks this app
  | "gmail_api_disabled" // Gmail API not enabled in the Cloud project
  | "address_not_found"
  | "address_not_editable"
  | "too_long"
  | "changed" // the existing signature changed after the person looked at it
  | "preview_stale" // the new signature differs from what the person previewed
  | "not_confirmed"
  | "forbidden" // Google refused the change
  | "rate_limited"
  | "upstream"; // Google had a problem

/** An expected, explainable failure. `message` is safe to show to the person. */
export class GoogleError extends Error {
  constructor(
    public readonly code: GoogleErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export const isGoogleError = (e: unknown): e is GoogleError => e instanceof GoogleError;
