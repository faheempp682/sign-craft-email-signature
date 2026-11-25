import { cleanField, clean, EMAIL_RE, readJson, SyncError, timedFetch, Warnings } from "./errors";
import { MAX_DIRECTORY_USERS, type DirectoryFetch, type SourceUser } from "./types";

/**
 * Microsoft 365 directory via Microsoft Graph with the client-credentials flow.
 *
 * Sources (read 2026):
 *  - Token: POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token, form client_id, client_secret, scope=https://graph.microsoft.com/.default,
 *    grant_type=client_credentials; answers { token_type, expires_in, access_token }; {tenant} is a GUID or a domain name.
 *    https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow
 *  - List users: GET https://graph.microsoft.com/v1.0/users?$select=...&$top=999 answers { value: [...], "@odata.nextLink": "<absolute url>" };
 *    application permission User.Read.All (admin consent). Properties not in the default set (businessPhones is, but mobilePhone,
 *    officeLocation, accountEnabled, department, jobTitle are listed explicitly in $select).
 *    https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0
 *
 * BUILT, NOT VERIFIED against a real tenant (no credentials in development); tested against fakes with these shapes.
 */

type Env = Record<string, string | undefined>;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const GRAPH_HOST = "graph.microsoft.com";
const SELECT = "id,displayName,givenName,surname,mail,userPrincipalName,jobTitle,department,businessPhones,mobilePhone,officeLocation,accountEnabled,userType";
const MAX_PAGES = 40;

/** The tenant goes into a URL path: only a GUID or a plain domain name is accepted (no "common", no slashes, no @, no dots-only tricks). */
export const validTenant = (t: string) => GUID.test(t) || (DOMAIN.test(t) && !/^(common|organizations|consumers)$/i.test(t));

export function microsoftMissing(env: Env = process.env): string[] {
  const out: string[] = [];
  if (!validTenant(env.MS_TENANT_ID?.trim() ?? "")) out.push("MS_TENANT_ID");
  if (!GUID.test(env.MS_CLIENT_ID?.trim() ?? "")) out.push("MS_CLIENT_ID");
  const secret = env.MS_CLIENT_SECRET ?? "";
  if (!secret.trim() || secret.length > 600) out.push("MS_CLIENT_SECRET");
  return out;
}

/** A next-page link from Graph is followed only if it points at Graph's own users endpoint. */
export function safeNextLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.hostname !== GRAPH_HOST || u.port || u.username || u.password) return null;
    if (!/^\/(v1\.0|beta)\/users(\/|$)/.test(u.pathname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

type MUser = {
  id?: unknown;
  displayName?: unknown;
  givenName?: unknown;
  surname?: unknown;
  mail?: unknown;
  jobTitle?: unknown;
  department?: unknown;
  businessPhones?: unknown;
  mobilePhone?: unknown;
  officeLocation?: unknown;
  accountEnabled?: unknown;
  userType?: unknown;
};

export function mapMicrosoftUser(u: MUser): { user: SourceUser } | { skip: string } | { guest: true } {
  const id = typeof u.id === "string" ? u.id : "";
  if (!id) return { skip: "The account has no id." };
  if (u.userType === "Guest") return { guest: true };
  const email = clean(u.mail).toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return { skip: "The account has no mail address (a mailbox is needed)." };
  const given = cleanField(u.givenName, "first_name");
  const family = cleanField(u.surname, "last_name");
  const full = cleanField(u.displayName, "full_name") || `${given} ${family}`.trim();
  if (!full) return { skip: "The account has no name." };
  const phones = Array.isArray(u.businessPhones) ? u.businessPhones.map(clean).filter(Boolean) : [];
  return {
    user: {
      external_id: id.slice(0, 200),
      email,
      full_name: full,
      first_name: given,
      last_name: family,
      title: cleanField(u.jobTitle, "title"),
      department: cleanField(u.department, "department"),
      phone: cleanField(phones[0], "phone"),
      mobile: cleanField(u.mobilePhone, "mobile"),
      location: cleanField(u.officeLocation, "location"),
      status: u.accountEnabled === false ? "inactive" : "active",
    },
  };
}

async function getToken(env: Env, fetchFn: typeof fetch): Promise<string> {
  const res = await timedFetch(
    fetchFn,
    `https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID!.trim())}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: env.MS_CLIENT_ID!.trim(), client_secret: env.MS_CLIENT_SECRET!, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
    },
    "Microsoft",
  );
  const body = (await readJson(res, "Microsoft", 200_000).catch(() => ({}))) as { access_token?: unknown; error?: unknown; error_description?: unknown };
  if (res.ok && typeof body.access_token === "string") return body.access_token;
  // Only the AADSTS code is repeated; the free-text description can carry tenant and trace details.
  const code = /AADSTS\d{3,8}/.exec(typeof body.error_description === "string" ? body.error_description : "")?.[0] ?? "";
  const hint = code ? ` (${code})` : "";
  if (body.error === "invalid_client") return fail("not_authorized", `Microsoft rejected the client id or secret${hint}. The secret may have expired: create a new one in the Azure app registration and update MS_CLIENT_SECRET.`);
  if (code === "AADSTS90002" || code === "AADSTS900023") return fail("not_authorized", `Microsoft does not know the tenant ${hint}. Check MS_TENANT_ID.`);
  if (res.status >= 400 && res.status < 500) return fail("not_authorized", `Microsoft would not issue a token${hint}. Check MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET.`);
  return fail("upstream", "Microsoft could not issue a token right now. Please try again in a moment.");
}
const fail = (code: SyncError["code"], message: string): never => {
  throw new SyncError(code, message);
};

export async function fetchMicrosoftDirectory(o: { env?: Env; fetchFn?: typeof fetch } = {}): Promise<DirectoryFetch> {
  const env = o.env ?? process.env;
  const fetchFn = o.fetchFn ?? fetch;
  const missing = microsoftMissing(env);
  if (missing.length) throw new SyncError("not_configured", `Microsoft 365 is not set up. Missing or invalid: ${missing.join(", ")}.`);
  const token = await getToken(env, fetchFn);

  const users: SourceUser[] = [];
  const seenIds = new Set<string>();
  const w = new Warnings();
  let guests = 0;
  let next: string | null = `https://${GRAPH_HOST}/v1.0/users?${new URLSearchParams({ $select: SELECT, $top: "999" })}`;
  for (let page = 0; page < MAX_PAGES && next; page++) {
    const res: Response = await timedFetch(fetchFn, next, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, "Microsoft Graph");
    if (res.status === 401) throw new SyncError("not_authorized", "Microsoft Graph rejected the access token.");
    if (res.status === 403) throw new SyncError("not_authorized", "Microsoft Graph refused to list users. In the Azure app registration add the application permission User.Read.All and click Grant admin consent.");
    if (res.status === 429 || res.status >= 500) throw new SyncError("upstream", "Microsoft Graph is busy or unavailable. Please try again in a moment.");
    if (!res.ok) throw new SyncError("upstream", "Microsoft Graph did not accept the request.");
    const body = (await readJson(res, "Microsoft Graph")) as { value?: MUser[]; "@odata.nextLink"?: unknown };
    if (!Array.isArray(body.value)) throw new SyncError("upstream", "Microsoft Graph answered in a shape we do not recognise.");
    for (const g of body.value) {
      if (typeof g?.id === "string") seenIds.add(g.id.slice(0, 200));
      if (seenIds.size > MAX_DIRECTORY_USERS) throw new SyncError("too_large", `The directory has more than ${MAX_DIRECTORY_USERS} users. Nothing was read, because a partial list would wrongly deactivate people.`);
      const m = mapMicrosoftUser(g ?? {});
      if ("guest" in m) guests++;
      else if ("skip" in m) w.add(typeof g?.id === "string" ? g.id : "(unknown)", m.skip);
      else users.push(m.user);
    }
    const link = body["@odata.nextLink"];
    if (link === undefined || link === null || link === "") {
      if (guests) {
        w.count += guests;
        w.list.push({ who: `${guests} guest accounts`, message: "Guest accounts are not synced." });
      }
      return { users, seenIds, skipped: w.count, warnings: w.list };
    }
    next = safeNextLink(link);
    if (!next) throw new SyncError("blocked", "Microsoft Graph sent a next-page link that does not point at Graph. Stopped without applying anything.");
  }
  throw new SyncError("too_large", "The directory has more pages than we will read. Nothing was applied.");
}
