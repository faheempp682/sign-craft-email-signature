import { DwdError, getDelegatedToken, readServiceAccount } from "@/lib/google-dwd/token";
import { cleanField, clean, EMAIL_RE, readJson, SyncError, timedFetch, Warnings } from "./errors";
import { MAX_DIRECTORY_USERS, type DirectoryFetch, type SourceUser } from "./types";

/**
 * Google Workspace directory via the Admin SDK Directory API.
 *
 * Sources (read 2026):
 *  - users.list: GET https://admin.googleapis.com/admin/directory/v1/users?customer=my_customer&maxResults&orderBy&projection&viewType&pageToken,
 *    answers { users: [...], nextPageToken } (the token is valid for three days); `users` is absent when there are none.
 *    https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/list
 *  - User resource: id, primaryEmail, name{fullName,givenName,familyName}, suspended, archived, organizations[]{title,department,location,primary},
 *    phones[]{value,type,primary}, locations[]{type,area,buildingId,floorName,floorSection,deskCode}.
 *    https://developers.google.com/workspace/admin/directory/reference/rest/v1/users
 *  - Scope https://www.googleapis.com/auth/admin.directory.user.readonly is accepted by users.list (same page).
 *  - Domain-wide delegation: the service account acts as a Workspace admin (GOOGLE_DIRECTORY_ADMIN_EMAIL) through lib/google-dwd.
 *
 * BUILT, NOT VERIFIED against a real Workspace (no credentials in development); tested against fakes with these shapes.
 */

export const DIRECTORY_SCOPE = "https://www.googleapis.com/auth/admin.directory.user.readonly";
const BASE = "https://admin.googleapis.com/admin/directory/v1/users";
const PAGE_SIZE = 500; // the documented maximum for users.list
const MAX_PAGES = 40;
const FIELDS =
  "nextPageToken,users(id,primaryEmail,suspended,archived,name(fullName,givenName,familyName),organizations(title,department,location,primary),phones(value,type,primary),locations(buildingId,floorName,floorSection,deskCode,area,type))";

type Env = Record<string, string | undefined>;

/** Names of the environment variables that are missing or unusable (never their values). */
export function googleMissing(env: Env = process.env): string[] {
  const out: string[] = [];
  if (!readServiceAccount(env)) out.push("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env.GOOGLE_DIRECTORY_ADMIN_EMAIL?.trim() ?? "")) out.push("GOOGLE_DIRECTORY_ADMIN_EMAIL");
  return out;
}

type GUser = {
  id?: unknown;
  primaryEmail?: unknown;
  suspended?: unknown;
  archived?: unknown;
  name?: { fullName?: unknown; givenName?: unknown; familyName?: unknown };
  organizations?: { title?: unknown; department?: unknown; location?: unknown; primary?: unknown }[];
  phones?: { value?: unknown; type?: unknown; primary?: unknown }[];
  locations?: { buildingId?: unknown; floorName?: unknown; floorSection?: unknown; deskCode?: unknown }[];
};

const arr = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
/** The entry flagged primary, else the first one for which `ok` holds. */
const pick = <T extends { primary?: unknown }>(list: T[], ok: (x: T) => boolean): T | undefined => list.find((x) => x.primary === true && ok(x)) ?? list.find(ok);

/** Maps one Google user. Returns null with a reason when the account cannot be used. */
export function mapGoogleUser(u: GUser): { user: SourceUser } | { skip: string } {
  const id = typeof u.id === "string" ? u.id : "";
  const email = clean(u.primaryEmail).toLowerCase();
  if (!id) return { skip: "The account has no id." };
  if (!EMAIL_RE.test(email) || email.length > 254) return { skip: "The account has no usable primary email." };

  const orgs = arr(u.organizations);
  const org = pick(orgs, (o) => clean(o.title) !== "" || clean(o.department) !== "") ?? orgs[0];
  const phones = arr(u.phones);
  const type = (p: { type?: unknown }) => (typeof p.type === "string" ? p.type : "");
  const withValue = phones.filter((p) => clean(p.value) !== "");
  // Only work numbers go on a company signature: never a home or "other" number.
  const work = pick(withValue, (p) => type(p) === "work") ?? pick(withValue, (p) => type(p) === "main");
  const mobile = pick(withValue, (p) => type(p) === "mobile") ?? pick(withValue, (p) => type(p) === "work_mobile");

  const locOrg = pick(orgs, (o) => clean(o.location) !== "");
  const loc = arr(u.locations)[0];
  let location = locOrg ? clean(locOrg.location) : "";
  if (!location && loc) {
    const floor = clean(loc.floorName);
    location = [clean(loc.buildingId), floor ? `floor ${floor}` : ""].filter(Boolean).join(", ");
  }

  const given = cleanField(u.name?.givenName, "first_name");
  const family = cleanField(u.name?.familyName, "last_name");
  const full = cleanField(u.name?.fullName, "full_name") || `${given} ${family}`.trim();
  if (!full) return { skip: "The account has no name." };

  return {
    user: {
      external_id: id.slice(0, 200),
      email,
      full_name: full,
      first_name: given,
      last_name: family,
      title: org ? cleanField(org.title, "title") : "",
      department: org ? cleanField(org.department, "department") : "",
      phone: work ? cleanField(work.value, "phone") : "",
      mobile: mobile ? cleanField(mobile.value, "mobile") : "",
      location: cleanField(location, "location"),
      status: u.suspended === true || u.archived === true ? "inactive" : "active",
    },
  };
}

export async function fetchGoogleDirectory(o: { env?: Env; fetchFn?: typeof fetch } = {}): Promise<DirectoryFetch> {
  const env = o.env ?? process.env;
  const fetchFn = o.fetchFn ?? fetch;
  const missing = googleMissing(env);
  if (missing.length) throw new SyncError("not_configured", `Google Workspace is not set up. Missing or invalid: ${missing.join(", ")}.`);
  const sa = readServiceAccount(env)!;
  const admin = env.GOOGLE_DIRECTORY_ADMIN_EMAIL!.trim();

  let token: string;
  try {
    token = await getDelegatedToken(sa, admin, [DIRECTORY_SCOPE], fetchFn);
  } catch (e) {
    if (e instanceof DwdError) throw new SyncError(e.code === "upstream" ? "upstream" : "not_authorized", e.message);
    throw e;
  }

  const users: SourceUser[] = [];
  const seenIds = new Set<string>();
  const w = new Warnings();
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ customer: "my_customer", maxResults: String(PAGE_SIZE), orderBy: "email", projection: "basic", viewType: "admin_view", fields: FIELDS });
    if (pageToken) q.set("pageToken", pageToken);
    const res = await timedFetch(fetchFn, `${BASE}?${q}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, "Google");
    if (!res.ok) throw googleHttpError(res.status, await readJson(res, "Google", 200_000).catch(() => ({})));
    const body = (await readJson(res, "Google")) as { users?: GUser[]; nextPageToken?: unknown };
    if (body.users !== undefined && !Array.isArray(body.users)) throw new SyncError("upstream", "Google answered in a shape we do not recognise.");
    for (const g of body.users ?? []) {
      if (typeof g?.id === "string") seenIds.add(g.id.slice(0, 200));
      const m = mapGoogleUser(g ?? {});
      if ("skip" in m) w.add(typeof g?.id === "string" ? g.id : "(unknown)", m.skip);
      else users.push(m.user);
      if (seenIds.size > MAX_DIRECTORY_USERS) throw new SyncError("too_large", `The directory has more than ${MAX_DIRECTORY_USERS} users. Nothing was read, because a partial list would wrongly deactivate people. Split the sync by organizational unit or ask for the limit to be raised.`);
    }
    pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : "";
    if (!pageToken) return { users, seenIds, skipped: w.count, warnings: w.list };
  }
  // Ran out of pages while Google still had more: never treat that as complete.
  throw new SyncError("too_large", "The directory has more pages than we will read. Nothing was applied.");
}

function googleHttpError(status: number, body: unknown): SyncError {
  const reason = (body as { error?: { errors?: { reason?: string }[]; status?: string } })?.error?.errors?.[0]?.reason ?? (body as { error?: { status?: string } })?.error?.status ?? "";
  if (status === 401) return new SyncError("not_authorized", "Google rejected the access token. Check the service account and its domain-wide delegation.");
  if (status === 403) {
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason)) return new SyncError("not_authorized", "The Admin SDK API is not enabled for the service account's Google Cloud project. Enable it in the Cloud console (APIs & Services).");
    return new SyncError("not_authorized", "Google refused to list users. GOOGLE_DIRECTORY_ADMIN_EMAIL must be a super administrator (or have a role that can read users) and the service account needs the admin.directory.user.readonly scope in domain-wide delegation.");
  }
  if (status === 404 || status === 400) return new SyncError("upstream", "Google did not accept the request (check that the domain has a customer account).");
  return new SyncError("upstream", "Google could not list users right now. Please try again in a moment.");
}
