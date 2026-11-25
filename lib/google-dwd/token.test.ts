import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DwdError, buildAssertion, clearDelegatedTokens, getDelegatedToken, readServiceAccount } from "./token";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const KEY_JSON = JSON.stringify({ type: "service_account", client_email: "sync@proj.iam.gserviceaccount.com", private_key: privateKey });
const sa = { clientEmail: "sync@proj.iam.gserviceaccount.com", privateKey };
const SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";
const NOW = 1_700_000_000_000;

const parts = (jwt: string) => jwt.split(".");
const claimsOf = (jwt: string) => JSON.parse(Buffer.from(parts(jwt)[1], "base64url").toString("utf8")) as Record<string, unknown>;
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => clearDelegatedTokens());

describe("readServiceAccount", () => {
  it("reads the key file JSON, or the same JSON base64-encoded", () => {
    expect(readServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: KEY_JSON })).toEqual({ clientEmail: sa.clientEmail, privateKey });
    expect(readServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: Buffer.from(KEY_JSON).toString("base64") })?.clientEmail).toBe(sa.clientEmail);
  });

  it("repairs a key whose newlines were flattened to the two characters \\n by an env file", () => {
    const flat = JSON.stringify({ client_email: sa.clientEmail, private_key: privateKey.replace(/\n/g, "\\n") });
    expect(readServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: flat })?.privateKey).toBe(privateKey);
  });

  it.each([undefined, "", "   ", "not json", "{}", '{"client_email":"a@b.c"}', '{"client_email":"nope","private_key":"-----BEGIN PRIVATE KEY-----x"}', '{"client_email":"a@b.c","private_key":"hunter2"}', "AAAA"])("returns null for %j", (v) => {
    expect(readServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: v })).toBeNull();
  });
});

describe("buildAssertion", () => {
  const jwt = buildAssertion(sa, { subject: "jane@kimp.xyz", scopes: [SCOPE, "openid"], nowMs: NOW });

  it("is a valid RS256 JWT that Google can verify with the service account's public key", () => {
    const [h, c, s] = parts(jwt);
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${c}`);
    expect(v.verify(createPublicKey(publicKey), Buffer.from(s, "base64url"))).toBe(true);
  });

  it("names the service account, the person to act as, the scopes and Google's token endpoint", () => {
    expect(claimsOf(jwt)).toEqual({ iss: sa.clientEmail, sub: "jane@kimp.xyz", scope: `${SCOPE} openid`, aud: "https://oauth2.googleapis.com/token", iat: NOW / 1000, exp: NOW / 1000 + 3600 });
  });

  it("is rejected if any byte of the claims is altered", () => {
    const [h, c, s] = parts(jwt);
    const forged = Buffer.from(JSON.stringify({ ...claimsOf(jwt), sub: "ceo@kimp.xyz" })).toString("base64url");
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${forged}`);
    expect(v.verify(createPublicKey(publicKey), Buffer.from(s, "base64url"))).toBe(false);
    expect(forged).not.toBe(c);
  });

  it("never contains the private key", () => {
    expect(jwt).not.toContain("PRIVATE KEY");
  });
});

describe("getDelegatedToken", () => {
  it("exchanges the assertion and returns the access token", async () => {
    const f = reply(200, { access_token: "tok-1", expires_in: 3600 });
    expect(await getDelegatedToken(sa, "jane@kimp.xyz", [SCOPE], f as unknown as typeof fetch, NOW)).toBe("tok-1");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const form = new URLSearchParams(String(init.body));
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(claimsOf(form.get("assertion")!).sub).toBe("jane@kimp.xyz");
  });

  it("reuses a token for the same person and scopes until a minute before it expires", async () => {
    const f = reply(200, { access_token: "tok-1", expires_in: 3600 });
    const get = (at: number) => getDelegatedToken(sa, "Jane@Kimp.xyz", [SCOPE], f as unknown as typeof fetch, at);
    await get(NOW);
    await get(NOW + 3000_000);
    expect(f).toHaveBeenCalledTimes(1);
    await get(NOW + 3541_000); // within the last minute: fetch a fresh one
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("never shares a token between different people or different scopes", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: `t${Math.random()}`, expires_in: 3600 })));
    const g = f as unknown as typeof fetch;
    const a = await getDelegatedToken(sa, "a@kimp.xyz", [SCOPE], g, NOW);
    const b = await getDelegatedToken(sa, "b@kimp.xyz", [SCOPE], g, NOW);
    const c = await getDelegatedToken(sa, "a@kimp.xyz", ["https://www.googleapis.com/auth/admin.directory.user.readonly"], g, NOW);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid subject before contacting Google", async () => {
    const f = reply(200, {});
    for (const bad of ["", "nobody", "a b@c.d", "a@b"]) await expect(getDelegatedToken(sa, bad, [SCOPE], f as unknown as typeof fetch, NOW)).rejects.toMatchObject({ code: "bad_subject" });
    expect(f).not.toHaveBeenCalled();
  });

  it("explains when the admin has not granted domain-wide delegation", async () => {
    const e = await getDelegatedToken(sa, "a@kimp.xyz", [SCOPE], reply(401, { error: "unauthorized_client", error_description: "Client is unauthorized to retrieve access tokens using this method" }) as unknown as typeof fetch, NOW).catch((x) => x);
    expect(e).toBeInstanceOf(DwdError);
    expect(e).toMatchObject({ code: "not_authorized" });
    expect(e.message).toMatch(/domain-wide delegation/);
  });

  it("distinguishes an unknown user from a bad key", async () => {
    const user = await getDelegatedToken(sa, "ghost@kimp.xyz", [SCOPE], reply(400, { error: "invalid_grant", error_description: "Invalid email or User ID" }) as unknown as typeof fetch, NOW).catch((x) => x);
    expect(user).toMatchObject({ code: "bad_subject" });
    expect(user.message).toContain("ghost@kimp.xyz");
    const key = await getDelegatedToken(sa, "a@kimp.xyz", [SCOPE], reply(400, { error: "invalid_grant", error_description: "Invalid JWT Signature." }) as unknown as typeof fetch, NOW).catch((x) => x);
    expect(key).toMatchObject({ code: "bad_subject" });
    expect(key.message).toMatch(/service account key/);
  });

  it("treats outages as 'upstream' and does not cache failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(getDelegatedToken(sa, "a@kimp.xyz", [SCOPE], down as unknown as typeof fetch, NOW)).rejects.toMatchObject({ code: "upstream" });
    await expect(getDelegatedToken(sa, "a@kimp.xyz", [SCOPE], reply(503, {}) as unknown as typeof fetch, NOW)).rejects.toMatchObject({ code: "upstream" });
    const ok = reply(200, { access_token: "tok-2", expires_in: 3600 });
    expect(await getDelegatedToken(sa, "a@kimp.xyz", [SCOPE], ok as unknown as typeof fetch, NOW)).toBe("tok-2");
  });

  it("never puts the private key or the assertion into an error message", async () => {
    const e = (await getDelegatedToken(sa, "a@kimp.xyz", [SCOPE], reply(500, { error: "backend_error" }) as unknown as typeof fetch, NOW).catch((x) => x)) as Error;
    expect(e.message).not.toContain("PRIVATE KEY");
    expect(e.message).not.toMatch(/eyJ/);
  });
});
