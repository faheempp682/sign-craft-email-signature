import { readServiceAccount } from "@/lib/google-dwd/token";
import { DEPLOY_SCOPE } from "./mailbox";

/**
 * Whether Gmail deployment can run on this server, and exactly what an admin must do if not. Never returns the key.
 * The service account's client email and numeric client ID are not secret (the Workspace admin pastes the client ID into
 * the Admin console), so they are shown; the private key is never read into the result.
 */
export type DeployStatus = {
  configured: boolean;
  serviceAccountEmail: string | null;
  clientId: string | null;
  scope: string;
  steps: string[];
};

export const SETUP_STEPS = [
  "In Google Cloud Console, pick or create a project and enable the Gmail API.",
  "Create a service account (IAM and Admin, Service accounts) and create a JSON key for it. Do not give it any project roles.",
  "Set the server environment variable GOOGLE_SERVICE_ACCOUNT_JSON to the contents of that JSON file (or the same text base64-encoded), then restart the server.",
  `In the Google Admin console (admin.google.com) go to Security, Access and data control, API controls, Manage domain-wide delegation. Add the service account's numeric client ID with the single scope ${DEPLOY_SCOPE}.`,
];

function clientIdOf(env: Record<string, string | undefined>): string | null {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const j = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as { client_id?: unknown };
    return typeof j.client_id === "string" && /^\d{5,30}$/.test(j.client_id) ? j.client_id : null;
  } catch {
    return null;
  }
}

export function deployStatus(env: Record<string, string | undefined> = process.env): DeployStatus {
  const sa = readServiceAccount(env);
  return { configured: !!sa, serviceAccountEmail: sa?.clientEmail ?? null, clientId: sa ? clientIdOf(env) : null, scope: DEPLOY_SCOPE, steps: SETUP_STEPS };
}
