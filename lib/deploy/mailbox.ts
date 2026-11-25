import { DwdError, getDelegatedToken, type ServiceAccount } from "@/lib/google-dwd/token";
import { isGoogleError } from "@/lib/google/errors";
import { getSendAs, setSignature } from "@/lib/google/gmail";

/**
 * Reading and writing one person's Gmail signature with the domain-wide-delegation service account. The only scope is
 * gmail.settings.basic (read and change signature and other basic settings; it cannot read mail).
 * The token and Gmail calls are the shared helpers; this file only translates their errors into reasons an admin can act on.
 */
export const DEPLOY_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";

export type ErrorKind = "no_mailbox" | "cannot_act" | "setup" | "rate_limited" | "upstream" | "rejected";

export type Classified = { kind: ErrorKind; message: string; retryable: boolean };

/** `setup` means every person will fail the same way until an admin fixes the Workspace configuration. */
export function classify(e: unknown): Classified {
  if (e instanceof DwdError) {
    if (e.code === "not_authorized" || e.code === "not_configured") return { kind: "setup", message: e.message, retryable: false };
    if (e.code === "bad_subject") return { kind: "cannot_act", message: "Google would not let SignCraft act as this user. The account may not exist, may be suspended, or the address is not a Workspace user.", retryable: false };
    return { kind: "upstream", message: e.message, retryable: true };
  }
  if (isGoogleError(e)) {
    switch (e.code) {
      case "rate_limited":
        return { kind: "rate_limited", message: "Google is limiting requests.", retryable: true };
      case "upstream":
        return { kind: "upstream", message: e.message, retryable: true };
      case "address_not_found":
        return { kind: "no_mailbox", message: "Gmail has no mailbox for this address.", retryable: false };
      case "gmail_api_disabled":
      case "scope_missing":
        return { kind: "setup", message: e.message, retryable: false };
      case "forbidden":
        // 422 is Gmail rejecting the signature content; 403 is "this account cannot have it changed"
        return e.status === 422 ? { kind: "rejected", message: e.message, retryable: false } : { kind: "no_mailbox", message: "Google refused: this account may not have Gmail, or signature changes are restricted by the Workspace admin.", retryable: false };
      default:
        return { kind: "cannot_act", message: e.message, retryable: false };
    }
  }
  console.error("[deploy] unexpected error:", e instanceof Error ? e.message : "unknown");
  return { kind: "upstream", message: "Something went wrong talking to Google. Try again.", retryable: true };
}

export type Mailbox = {
  /** The signature Gmail holds for the person's primary address (HTML, "" when none). */
  read(email: string): Promise<string>;
  write(email: string, html: string): Promise<void>;
};

type Fetch = typeof fetch;

export function gmailMailbox(sa: ServiceAccount, fetchFn: Fetch = fetch): Mailbox {
  return {
    async read(email) {
      const token = await getDelegatedToken(sa, email, [DEPLOY_SCOPE], fetchFn);
      return (await getSendAs(token, email, fetchFn)).signature;
    },
    async write(email, html) {
      const token = await getDelegatedToken(sa, email, [DEPLOY_SCOPE], fetchFn);
      await setSignature(token, email, html, fetchFn);
    },
  };
}
