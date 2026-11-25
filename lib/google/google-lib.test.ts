import { describe, expect, it, vi } from "vitest";
import { getPreset } from "@/lib/presets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { GMAIL_SETTINGS_SCOPE } from "./config";
import { deleteConnection, getAccessToken, readRefreshToken, saveConnection } from "./connection";
import { encryptSecret, fingerprint, tokenContext } from "./crypto";
import { GoogleError } from "./errors";
import { MAX_SIGNATURE_CHARS, getSendAs, listSendAs, setSignature } from "./gmail";
import { buildAuthUrl, exchangeCode, hasSettingsScope, readIdentity, refreshAccessToken, revokeToken } from "./oauth";
import { buildPreview, pushApproved } from "./push";
import { CLIENT_ID, KEY, fakeAdmin, fakeGoogle, idToken, testConfig } from "./test-kit";

const cfg = testConfig();
const doc = getPreset("classic")!.doc;
const expectCode = async (p: Promise<unknown>, code: string, status?: number) => {
  const e = await p.catch((x) => x);
  expect(e).toBeInstanceOf(GoogleError);
  expect((e as GoogleError).code).toBe(code);
  if (status) expect((e as GoogleError).status).toBe(status);
};

describe("buildAuthUrl", () => {
  const u = new URL(buildAuthUrl(cfg, "state-1", "verifier-1"));
  const p = u.searchParams;
  it("asks Google for exactly the permissions we need and nothing else", () => {
    expect(p.get("scope")?.split(" ")).toEqual(["openid", "email", GMAIL_SETTINGS_SCOPE]);
    expect(p.get("scope")).not.toMatch(/gmail\.(readonly|modify|compose|send)|mail\.google\.com/);
  });
  it("uses the authorization-code flow with PKCE (S256) and our state", () => {
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("state")).toBe("state-1");
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(cfg.redirectUri);
  });
  it("requests a refresh token (offline + consent screen) and never sends the verifier or secret", () => {
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(u.toString()).not.toContain("verifier-1");
    expect(u.toString()).not.toContain(cfg.clientSecret);
  });
  it("hints the domain only when there is exactly one", () => {
    expect(p.get("hd")).toBe("kimp.xyz");
    expect(new URL(buildAuthUrl(testConfig({ domains: ["a.com", "b.com"] }), "s", "v")).searchParams.has("hd")).toBe(false);
  });
});

describe("exchangeCode / refreshAccessToken / revokeToken", () => {
  it("exchanges the code, sending the PKCE verifier and secret in the body, not the URL", async () => {
    const g = fakeGoogle();
    const t = await exchangeCode(cfg, "code-1", "verifier-1", g.fetch);
    expect(t).toMatchObject({ accessToken: "access-1", refreshToken: "refresh-1", expiresIn: 3600 });
    const sent = g.s.seen[0];
    expect(sent.url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(sent.body);
    expect(Object.fromEntries(form)).toMatchObject({ code: "code-1", code_verifier: "verifier-1", grant_type: "authorization_code", client_id: CLIENT_ID, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri });
  });

  it("maps an expired or replayed code to a retry message", async () => {
    const g = fakeGoogle();
    g.s.exchange = { status: 400, body: { error: "invalid_grant" } };
    await expectCode(exchangeCode(cfg, "c", "v", g.fetch), "reconnect_required", 400);
  });

  it("maps other failures and a network outage to 'upstream'", async () => {
    const g = fakeGoogle();
    g.s.exchange = { status: 500, body: { error: "server_error" } };
    await expectCode(exchangeCode(cfg, "c", "v", g.fetch), "upstream", 502);
    g.s.networkDown = true;
    await expectCode(exchangeCode(cfg, "c", "v", g.fetch), "upstream", 502);
  });

  it("refreshes an access token, and treats invalid_grant as 'must reconnect'", async () => {
    const g = fakeGoogle();
    expect(await refreshAccessToken(cfg, "refresh-1", g.fetch)).toBe("access-1");
    expect(new URLSearchParams(g.s.seen[0].body).get("grant_type")).toBe("refresh_token");
    g.s.refresh = { status: 400, body: { error: "invalid_grant" } };
    await expectCode(refreshAccessToken(cfg, "refresh-1", g.fetch), "reconnect_required", 401);
    g.s.refresh = { status: 503, body: {} };
    await expectCode(refreshAccessToken(cfg, "refresh-1", g.fetch), "upstream");
    g.s.refresh = { status: 200, body: {} };
    await expectCode(refreshAccessToken(cfg, "refresh-1", g.fetch), "upstream");
  });

  it("reports whether Google confirmed a revocation", async () => {
    const g = fakeGoogle();
    expect(await revokeToken("tok", g.fetch)).toBe("revoked");
    expect(g.s.revoked).toEqual(["tok"]);
    g.s.revoke = { status: 400, body: { error: "invalid_token" }, throws: false };
    expect(await revokeToken("tok", g.fetch)).toBe("already_invalid");
    g.s.revoke = { status: 500, body: {}, throws: false };
    expect(await revokeToken("tok", g.fetch)).toBe("failed");
    g.s.revoke = { status: 200, body: {}, throws: true };
    expect(await revokeToken("tok", g.fetch)).toBe("failed");
  });

  it("checks the granted scope", () => {
    expect(hasSettingsScope(`openid email ${GMAIL_SETTINGS_SCOPE}`)).toBe(true);
    expect(hasSettingsScope("openid email")).toBe(false);
    expect(hasSettingsScope(`${GMAIL_SETTINGS_SCOPE}.evil`)).toBe(false);
  });
});

describe("readIdentity: only Workspace accounts in the allowed domain(s)", () => {
  it("accepts a verified account in an allowed domain", () => {
    expect(readIdentity(idToken(), cfg)).toEqual({ sub: "google-sub-1", email: "jane@kimp.xyz", hd: "kimp.xyz" });
    expect(readIdentity(idToken({ hd: "KIMP.xyz" }), cfg).hd).toBe("kimp.xyz");
    expect(readIdentity(idToken({ aud: ["other", CLIENT_ID] }), cfg).sub).toBe("google-sub-1");
    expect(readIdentity(idToken({ iss: "accounts.google.com" }), cfg).sub).toBe("google-sub-1");
  });

  it("rejects a personal Gmail account (no hd claim)", () => {
    const tok = idToken({ email: "someone@gmail.com", hd: undefined });
    expect(() => readIdentity(tok, cfg)).toThrow(/personal Google account/);
    expect(() => readIdentity(tok, cfg)).toThrow(GoogleError);
  });

  it("rejects a Workspace account from another domain, even a lookalike", () => {
    for (const hd of ["other.com", "kimp.xyz.evil.com", "evilkimp.xyz", "xyz"]) {
      const e = (() => {
        try {
          readIdentity(idToken({ hd, email: `x@${hd}` }), cfg);
        } catch (x) {
          return x as GoogleError;
        }
      })();
      expect(e?.code, hd).toBe("wrong_account");
    }
  });

  it("rejects an unverified email, expired token, wrong audience, wrong issuer, and garbage", () => {
    for (const claims of [{ email_verified: false }, { exp: Math.floor(Date.now() / 1000) - 10 }, { aud: "someone-else" }, { iss: "https://evil.example" }, { sub: undefined }, { email: undefined }]) {
      expect(() => readIdentity(idToken(claims), cfg)).toThrow(GoogleError);
    }
    for (const bad of [undefined, "", "no-dots", "a.@@@.c", `a.${Buffer.from("not json").toString("base64url")}.c`]) expect(() => readIdentity(bad, cfg)).toThrow(GoogleError);
  });
});

describe("Gmail client", () => {
  it("lists send-as addresses and decides which can be edited", async () => {
    const g = fakeGoogle();
    g.s.addresses.set("sales@kimp.xyz", { sendAsEmail: "sales@kimp.xyz", verificationStatus: "accepted", signature: "" });
    g.s.addresses.set("pending@kimp.xyz", { sendAsEmail: "pending@kimp.xyz", verificationStatus: "pending" });
    const list = await listSendAs("access-1", g.fetch);
    const by = Object.fromEntries(list.map((a) => [a.email, a]));
    expect(by["jane@kimp.xyz"]).toMatchObject({ isPrimary: true, canEdit: true, signature: "<p>old signature</p>" });
    expect(by["sales@kimp.xyz"].canEdit).toBe(true);
    expect(by["pending@kimp.xyz"].canEdit).toBe(false);
  });

  it("sends the bearer token, encodes the address in the path, and PATCHes only the signature", async () => {
    const g = fakeGoogle();
    g.s.addresses.set("a+b@kimp.xyz", { sendAsEmail: "a+b@kimp.xyz", signature: "" });
    await setSignature("access-1", "a+b@kimp.xyz", "<p>new</p>", g.fetch);
    const p = g.patches()[0];
    expect(p.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/a%2Bb%40kimp.xyz");
    expect(p.headers.Authorization).toBe("Bearer access-1");
    expect(JSON.parse(p.body)).toEqual({ signature: "<p>new</p>" });
    expect((await getSendAs("access-1", "a+b@kimp.xyz", g.fetch)).signature).toBe("<p>new</p>");
  });

  it.each([
    [401, {}, "reconnect_required", 401],
    [403, { error: { errors: [{ reason: "accessNotConfigured" }] } }, "gmail_api_disabled", 503],
    [403, { error: { details: [{ reason: "SERVICE_DISABLED" }] } }, "gmail_api_disabled", 503],
    [403, { error: { errors: [{ reason: "insufficientPermissions" }] } }, "scope_missing", 403],
    [403, { error: { message: "Mail service not enabled" } }, "forbidden", 403],
    [404, {}, "address_not_found", 404],
    [400, { error: { message: "Invalid signature" } }, "forbidden", 422],
    [429, {}, "rate_limited", 429],
    [500, {}, "upstream", 502],
    [503, {}, "upstream", 502],
  ])("maps a %i answer to a clear error (%j -> %s)", async (status, body, code, outStatus) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const g = fakeGoogle();
    g.s.gmailFail = { status, body };
    await expectCode(listSendAs("access-1", g.fetch), code, outStatus);
  });

  it("does not pass Google's raw wording through, except to explain a rejected signature", async () => {
    const g = fakeGoogle();
    g.s.gmailFail = { status: 403, body: { error: { message: "internal-project-number-1234 leaked detail" } } };
    const e = await listSendAs("access-1", g.fetch).catch((x) => x as GoogleError);
    expect((e as GoogleError).message).not.toContain("1234");
  });

  it("reports an unreachable Gmail", async () => {
    const g = fakeGoogle();
    g.s.networkDown = true;
    await expectCode(listSendAs("access-1", g.fetch), "upstream", 502);
  });
});

describe("preview and approved push", () => {
  const html = renderToEmailHtml(doc);
  const approval = (over: Partial<{ confirm: boolean; newHash: string; currentHash: string }> = {}) => ({ confirm: true, newHash: fingerprint(html), currentHash: fingerprint("<p>old signature</p>"), ...over });

  it("renders the new signature on the server and shows what Gmail currently holds", async () => {
    const g = fakeGoogle();
    const p = await buildPreview("access-1", doc, "jane@kimp.xyz", g.fetch);
    expect(p.newHtml).toBe(html);
    expect(p.newHash).toBe(fingerprint(html));
    expect(p.current).toEqual({ html: "<p>old signature</p>", hash: fingerprint("<p>old signature</p>"), hasSignature: true });
    expect(p.address).toEqual({ email: "jane@kimp.xyz", displayName: "Jane Doe", isPrimary: true });
    expect(p.tooLong).toBe(false);
    expect(g.patches()).toHaveLength(0); // previewing changes nothing
  });

  it("replaces the signature with exactly the previewed HTML once approved", async () => {
    const g = fakeGoogle();
    const done = await pushApproved("access-1", doc, "jane@kimp.xyz", approval(), g.fetch);
    expect(g.patches()).toHaveLength(1);
    expect(JSON.parse(g.patches()[0].body).signature).toBe(html);
    expect(g.s.addresses.get("jane@kimp.xyz")!.signature).toBe(html);
    expect(done).toEqual({ email: "jane@kimp.xyz", previousSignature: "<p>old signature</p>", newHash: fingerprint(html) });
  });

  it("never writes without explicit confirmation", async () => {
    const g = fakeGoogle();
    await expectCode(pushApproved("access-1", doc, "jane@kimp.xyz", approval({ confirm: false }), g.fetch), "not_confirmed", 400);
    expect(g.patches()).toHaveLength(0);
    expect(g.s.addresses.get("jane@kimp.xyz")!.signature).toBe("<p>old signature</p>");
  });

  it("requires approval even when there is no existing signature to lose", async () => {
    const g = fakeGoogle();
    g.s.addresses.get("jane@kimp.xyz")!.signature = "";
    await expectCode(pushApproved("access-1", doc, "jane@kimp.xyz", approval({ confirm: false, currentHash: fingerprint("") }), g.fetch), "not_confirmed");
    expect(g.patches()).toHaveLength(0);
    await pushApproved("access-1", doc, "jane@kimp.xyz", approval({ currentHash: fingerprint("") }), g.fetch);
    expect(g.patches()).toHaveLength(1);
  });

  it("refuses if the existing signature changed since the person looked at it", async () => {
    const g = fakeGoogle();
    g.s.addresses.get("jane@kimp.xyz")!.signature = "<p>edited in Gmail meanwhile</p>";
    await expectCode(pushApproved("access-1", doc, "jane@kimp.xyz", approval(), g.fetch), "changed", 409);
    expect(g.patches()).toHaveLength(0);
    expect(g.s.addresses.get("jane@kimp.xyz")!.signature).toBe("<p>edited in Gmail meanwhile</p>");
  });

  it("refuses if the new signature is not the one that was previewed", async () => {
    const g = fakeGoogle();
    await expectCode(pushApproved("access-1", doc, "jane@kimp.xyz", approval({ newHash: fingerprint("<p>something else</p>") }), g.fetch), "preview_stale", 409);
    const other = getPreset("minimal")!.doc;
    await expectCode(pushApproved("access-1", other, "jane@kimp.xyz", approval(), g.fetch), "preview_stale"); // different doc than previewed
    expect(g.patches()).toHaveLength(0);
  });

  it("refuses a signature over Gmail's size limit, before writing anything", async () => {
    const g = fakeGoogle();
    const huge = { ...doc, blocks: [...doc.blocks, { type: "disclaimer" as const, text: "x".repeat(MAX_SIGNATURE_CHARS) }] };
    const bigHtml = renderToEmailHtml(huge);
    const p = await buildPreview("access-1", huge, "jane@kimp.xyz", g.fetch);
    expect(p.tooLong).toBe(true);
    await expectCode(pushApproved("access-1", huge, "jane@kimp.xyz", { confirm: true, newHash: fingerprint(bigHtml), currentHash: fingerprint("<p>old signature</p>") }, g.fetch), "too_long", 422);
    expect(g.patches()).toHaveLength(0);
  });

  it("will not touch an unverified alias, or an address that does not exist", async () => {
    const g = fakeGoogle();
    g.s.addresses.set("pending@kimp.xyz", { sendAsEmail: "pending@kimp.xyz", verificationStatus: "pending", signature: "" });
    await expectCode(buildPreview("access-1", doc, "pending@kimp.xyz", g.fetch), "address_not_editable", 422);
    await expectCode(buildPreview("access-1", doc, "nobody@kimp.xyz", g.fetch), "address_not_found", 404);
    expect(g.patches()).toHaveLength(0);
  });

  it("passes Gmail's refusal on to the person and leaves the old signature in place", async () => {
    const g = fakeGoogle();
    g.s.patchFail = { status: 403, body: { error: { message: "Mail service not enabled" } } };
    await expectCode(pushApproved("access-1", doc, "jane@kimp.xyz", approval(), g.fetch), "forbidden");
    expect(g.s.addresses.get("jane@kimp.xyz")!.signature).toBe("<p>old signature</p>");
  });
});

describe("stored connection", () => {
  const who = { sub: "s", email: "jane@kimp.xyz", hd: "kimp.xyz" };

  it("stores the refresh token encrypted, bound to its owner", async () => {
    const admin = fakeAdmin();
    await saveConnection(admin as never, cfg, "user-1", who, "scope", "refresh-token-plain");
    const row = admin.store.connections.get("user-1")!;
    expect(String(row.refresh_token_enc)).not.toContain("refresh-token-plain");
    expect(row).toMatchObject({ user_id: "user-1", google_email: "jane@kimp.xyz", hd: "kimp.xyz", google_sub: "s" });
    expect(await readRefreshToken(admin as never, cfg, "user-1")).toBe("refresh-token-plain");
    expect(await readRefreshToken(admin as never, cfg, "someone-else")).toBeNull();
  });

  it("a ciphertext moved to another account cannot be used", async () => {
    const admin = fakeAdmin();
    await saveConnection(admin as never, cfg, "alice", who, "scope", "alices-token");
    admin.store.connections.set("mallory", { ...admin.store.connections.get("alice")!, user_id: "mallory" });
    await expectCode(readRefreshToken(admin as never, cfg, "mallory"), "reconnect_required", 401);
  });

  it("a changed encryption key asks for a fresh connection rather than crashing", async () => {
    const admin = fakeAdmin();
    admin.store.connections.set("u", { user_id: "u", refresh_token_enc: encryptSecret("t", Buffer.alloc(32, 99), tokenContext("u")) });
    await expectCode(readRefreshToken(admin as never, cfg, "u"), "reconnect_required");
  });

  it("deletes the stored token", async () => {
    const admin = fakeAdmin();
    await saveConnection(admin as never, cfg, "user-1", who, "scope", "t");
    await deleteConnection(admin as never, "user-1");
    expect(admin.store.connections.size).toBe(0);
  });

  it("surfaces storage failures instead of pretending to have connected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = fakeAdmin();
    admin.store.failSave = true;
    await expectCode(saveConnection(admin as never, cfg, "u", who, "s", "t"), "upstream");
    admin.store.failDelete = true;
    await expectCode(deleteConnection(admin as never, "u"), "upstream");
  });

  it("getAccessToken: not connected, refreshes, and removes a connection Google has revoked", async () => {
    const admin = fakeAdmin();
    const g = fakeGoogle();
    await expectCode(getAccessToken(admin as never, cfg, "u", g.fetch), "not_connected", 409);

    await saveConnection(admin as never, cfg, "u", who, "scope", "refresh-1");
    expect(await getAccessToken(admin as never, cfg, "u", g.fetch)).toBe("access-1");
    expect(new URLSearchParams(g.s.seen[0].body).get("refresh_token")).toBe("refresh-1");

    g.s.refresh = { status: 400, body: { error: "invalid_grant" } };
    await expectCode(getAccessToken(admin as never, cfg, "u", g.fetch), "reconnect_required", 401);
    expect(admin.store.connections.has("u")).toBe(false); // so the screen offers Connect again
  });

  it("a temporary Google outage does NOT delete the connection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = fakeAdmin();
    const g = fakeGoogle();
    await saveConnection(admin as never, cfg, "u", who, "scope", "refresh-1");
    g.s.refresh = { status: 503, body: {} };
    await expectCode(getAccessToken(admin as never, cfg, "u", g.fetch), "upstream");
    expect(admin.store.connections.has("u")).toBe(true);
  });
});

void KEY;
