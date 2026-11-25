import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearDelegatedTokens } from "@/lib/google-dwd/token";
import { fetchGoogleDirectory, googleMissing, mapGoogleUser } from "./google-directory";
import { fetchMicrosoftDirectory, mapMicrosoftUser, microsoftMissing, safeNextLink, validTenant } from "./microsoft-directory";
import { SyncError } from "./errors";

/** Fakes that follow the documented response shapes. Nothing here talks to Google or Microsoft. */

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const GENV = { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "sync@proj.iam.gserviceaccount.com", private_key: privateKey }), GOOGLE_DIRECTORY_ADMIN_EMAIL: "admin@acme.com" };
const MENV = { MS_TENANT_ID: "11111111-2222-3333-4444-555555555555", MS_CLIENT_ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", MS_CLIENT_SECRET: "s3cret-value" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const gUser = (i: number, o: object = {}) => ({
  id: `g${i}`, primaryEmail: `u${i}@acme.com`, name: { fullName: `User ${i}`, givenName: "User", familyName: String(i) },
  organizations: [{ title: "Engineer", department: "R&D", location: "Berlin", primary: true }],
  phones: [{ value: "+49 30 1", type: "work" }, { value: "+49 170 2", type: "mobile" }, { value: "+49 99 3", type: "home" }], ...o,
});

beforeEach(() => clearDelegatedTokens());

describe("Google Workspace directory (fake Admin SDK)", () => {
  function fake(pages: unknown[], seen: string[] = []) {
    let n = 0;
    const calls: { url: string; auth: string | null }[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://oauth2.googleapis.com/token")) {
        const assertion = new URLSearchParams(String(init?.body)).get("assertion") ?? "";
        const claims = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString());
        seen.push(`${claims.sub}|${claims.scope}`);
        return json({ access_token: "tok", expires_in: 3600 });
      }
      calls.push({ url: u, auth: new Headers(init?.headers).get("authorization") });
      return json(pages[n++] ?? {});
    }) as typeof fetch;
    return { fetchFn, calls };
  }

  it("reports exactly which variables are missing, never values", () => {
    expect(googleMissing({})).toEqual(["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_DIRECTORY_ADMIN_EMAIL"]);
    expect(googleMissing(GENV)).toEqual([]);
  });

  it("acts as the configured admin with the readonly scope, follows nextPageToken and maps fields", async () => {
    const seen: string[] = [];
    const f = fake([{ users: [gUser(1)], nextPageToken: "T2" }, { users: [gUser(2, { suspended: true })] }], seen);
    const r = await fetchGoogleDirectory({ env: GENV, fetchFn: f.fetchFn });
    expect(seen).toEqual(["admin@acme.com|https://www.googleapis.com/auth/admin.directory.user.readonly"]);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].url).toContain("admin/directory/v1/users?customer=my_customer");
    expect(f.calls[0].url).not.toContain("pageToken");
    expect(f.calls[1].url).toContain("pageToken=T2");
    expect(f.calls[0].auth).toBe("Bearer tok");
    expect(r.users).toHaveLength(2);
    expect(r.users[0]).toEqual({ external_id: "g1", email: "u1@acme.com", full_name: "User 1", first_name: "User", last_name: "1", title: "Engineer", department: "R&D", phone: "+49 30 1", mobile: "+49 170 2", location: "Berlin", status: "active" });
    expect(r.users[1].status).toBe("inactive");
  });

  it("never puts a home number on a company signature; falls back to the building for location", () => {
    const m = mapGoogleUser({ id: "g", primaryEmail: "a@b.co", name: { fullName: "A B" }, phones: [{ value: "1", type: "home" }], organizations: [{ title: "T" }], locations: [{ buildingId: "HQ", floorName: "3", deskCode: "A1" }] });
    expect("user" in m && m.user).toMatchObject({ phone: "", mobile: "", location: "HQ, floor 3", title: "T" });
  });

  it("skips accounts without an email or name but still counts them as seen", async () => {
    const f = fake([{ users: [gUser(1), { id: "g9", primaryEmail: "", name: { fullName: "No Mail" } }] }]);
    const r = await fetchGoogleDirectory({ env: GENV, fetchFn: f.fetchFn });
    expect(r.users).toHaveLength(1);
    expect(r.seenIds.has("g9")).toBe(true);
    expect(r.skipped).toBe(1);
  });

  it("an empty directory is an empty list (users is absent in Google's answer)", async () => {
    const r = await fetchGoogleDirectory({ env: GENV, fetchFn: fake([{}]).fetchFn });
    expect(r.users).toEqual([]);
  });

  it("a failing page fails the whole fetch: a partial list is never returned", async () => {
    let n = 0;
    const fetchFn = (async (url: string | URL) => {
      if (String(url).includes("oauth2")) return json({ access_token: "t", expires_in: 3600 });
      return n++ === 0 ? json({ users: [gUser(1)], nextPageToken: "T2" }) : json({ error: { status: "UNAVAILABLE" } }, 503);
    }) as typeof fetch;
    await expect(fetchGoogleDirectory({ env: GENV, fetchFn })).rejects.toMatchObject({ code: "upstream" });
  });

  it("explains the common failures", async () => {
    const mk = (status: number, error: unknown) => (async (url: string | URL) => (String(url).includes("oauth2") ? json({ access_token: "t", expires_in: 3600 }) : json(error, status))) as typeof fetch;
    await expect(fetchGoogleDirectory({ env: GENV, fetchFn: mk(403, { error: { errors: [{ reason: "accessNotConfigured" }] } }) })).rejects.toThrow(/Admin SDK API is not enabled/);
    await expect(fetchGoogleDirectory({ env: GENV, fetchFn: mk(403, { error: { errors: [{ reason: "forbidden" }] } }) })).rejects.toThrow(/super administrator/);
    const unauthorized = (async () => json({ error: "unauthorized_client" }, 401)) as typeof fetch;
    await expect(fetchGoogleDirectory({ env: GENV, fetchFn: unauthorized })).rejects.toMatchObject({ code: "not_authorized" });
    await expect(fetchGoogleDirectory({ env: {} })).rejects.toMatchObject({ code: "not_configured" });
  });

  it("refuses a directory over 5000 users instead of truncating it", async () => {
    const big = Array.from({ length: 501 }, (_, i) => gUser(i));
    const pages = Array.from({ length: 11 }, (_, i) => ({ users: big.map((u) => ({ ...u, id: `p${i}-${u.id}` })), nextPageToken: "n" }));
    await expect(fetchGoogleDirectory({ env: GENV, fetchFn: fake(pages).fetchFn })).rejects.toMatchObject({ code: "too_large" });
  });

  it("running out of pages while Google still has more is not 'complete'", async () => {
    const f = fake(Array.from({ length: 41 }, () => ({ users: [], nextPageToken: "more" })));
    await expect(fetchGoogleDirectory({ env: GENV, fetchFn: f.fetchFn })).rejects.toMatchObject({ code: "too_large" });
  });
});

describe("Microsoft 365 directory (fake Graph)", () => {
  const mUser = (i: number, o: object = {}) => ({ id: `m${i}`, displayName: `User ${i}`, givenName: "User", surname: String(i), mail: `U${i}@acme.com`, jobTitle: "PM", department: "Sales", businessPhones: ["+1 555 0100"], mobilePhone: "+1 555 0199", officeLocation: "NYC", accountEnabled: true, userType: "Member", ...o });
  function fake(pages: unknown[], tokenBody: { status?: number; body?: unknown } = {}) {
    let n = 0;
    const calls: { url: string; body?: string; auth?: string | null }[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? String(init.body) : undefined, auth: new Headers(init?.headers).get("authorization") });
      if (u.startsWith("https://login.microsoftonline.com/")) return json(tokenBody.body ?? { access_token: "mtok", expires_in: 3599, token_type: "Bearer" }, tokenBody.status ?? 200);
      return json(pages[n++] ?? { value: [] });
    }) as typeof fetch;
    return { fetchFn, calls };
  }

  it("guards the tenant id that goes into the token URL", () => {
    expect(validTenant("11111111-2222-3333-4444-555555555555")).toBe(true);
    expect(validTenant("acme.onmicrosoft.com")).toBe(true);
    for (const bad of ["common", "organizations", "../x", "acme.com/evil", "a@b.com", "acme.com?x=1", "", "evil.com:443/x", "localhost"]) expect(validTenant(bad)).toBe(false);
    expect(microsoftMissing({ MS_TENANT_ID: "common", MS_CLIENT_ID: "x" })).toEqual(["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET"]);
  });

  it("uses client credentials, pages with @odata.nextLink and maps fields", async () => {
    const f = fake([{ value: [mUser(1)], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skiptoken=abc" }, { value: [mUser(2, { accountEnabled: false }), mUser(3, { userType: "Guest" }), mUser(4, { mail: null })] }]);
    const r = await fetchMicrosoftDirectory({ env: MENV, fetchFn: f.fetchFn });
    expect(f.calls[0].url).toBe("https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/token");
    const form = new URLSearchParams(f.calls[0].body);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("scope")).toBe("https://graph.microsoft.com/.default");
    expect(f.calls[1].url).toContain("graph.microsoft.com/v1.0/users?");
    expect(decodeURIComponent(f.calls[1].url)).toContain("$select=id,displayName");
    expect(f.calls[1].auth).toBe("Bearer mtok");
    expect(f.calls[2].url).toContain("skiptoken=abc");
    expect(r.users.map((u) => [u.email, u.status])).toEqual([["u1@acme.com", "active"], ["u2@acme.com", "inactive"]]);
    expect(r.users[0]).toMatchObject({ external_id: "m1", title: "PM", department: "Sales", phone: "+1 555 0100", mobile: "+1 555 0199", location: "NYC" });
    expect(r.seenIds.has("m4")).toBe(true);
    expect(r.skipped).toBe(2); // one guest, one without mail
  });

  it("refuses a next link that does not point at Graph (it would carry the bearer token elsewhere)", async () => {
    for (const bad of ["https://evil.example.com/v1.0/users?x", "http://graph.microsoft.com/v1.0/users", "https://graph.microsoft.com.evil.com/v1.0/users", "https://graph.microsoft.com:8443/v1.0/users", "https://user@graph.microsoft.com/v1.0/users", "https://graph.microsoft.com/v1.0/me"]) {
      expect(safeNextLink(bad)).toBeNull();
    }
    const f = fake([{ value: [mUser(1)], "@odata.nextLink": "https://evil.example.com/steal" }]);
    await expect(fetchMicrosoftDirectory({ env: MENV, fetchFn: f.fetchFn })).rejects.toMatchObject({ code: "blocked" });
    expect(f.calls).toHaveLength(2); // token + first page only
  });

  it("explains the common failures without echoing secrets or free text", async () => {
    const bad = fake([], { status: 401, body: { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided. Trace ID: abc s3cret-value" } });
    const err = (await fetchMicrosoftDirectory({ env: MENV, fetchFn: bad.fetchFn }).catch((e) => e)) as SyncError;
    expect(err.code).toBe("not_authorized");
    expect(err.message).toMatch(/AADSTS7000215/);
    expect(err.message).not.toMatch(/s3cret|Trace/);
    const denied = (async (u: string | URL) => (String(u).includes("login.") ? json({ access_token: "t" }) : json({ error: { code: "Authorization_RequestDenied" } }, 403))) as typeof fetch;
    await expect(fetchMicrosoftDirectory({ env: MENV, fetchFn: denied })).rejects.toThrow(/User\.Read\.All/);
    await expect(fetchMicrosoftDirectory({ env: {} })).rejects.toMatchObject({ code: "not_configured" });
  });

  it("a failing page fails the whole fetch", async () => {
    let n = 0;
    const fetchFn = (async (u: string | URL) => (String(u).includes("login.") ? json({ access_token: "t" }) : n++ === 0 ? json({ value: [mUser(1)], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skiptoken=x" }) : json({}, 503))) as typeof fetch;
    await expect(fetchMicrosoftDirectory({ env: MENV, fetchFn })).rejects.toMatchObject({ code: "upstream" });
  });

  it("maps a user without accountEnabled as active", () => {
    const m = mapMicrosoftUser({ id: "x", displayName: "A", mail: "a@b.co" });
    expect("user" in m && m.user.status).toBe("active");
  });
});
