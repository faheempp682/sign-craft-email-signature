import { describe, expect, it } from "vitest";
import { readGoogleConfig } from "./config";
import { CryptoError, decryptSecret, encryptSecret, fingerprint, parseKey, tokenContext } from "./crypto";
import { STATE_TTL_MS, challengeFor, newHandshake, openState, sameState, sealState } from "./state";

const key = Buffer.alloc(32, 7);
const otherKey = Buffer.alloc(32, 9);

describe("parseKey", () => {
  it("accepts exactly 32 bytes, standard or url-safe base64", () => {
    const raw = Buffer.from(Array.from({ length: 32 }, (_, i) => 250 - i));
    expect(parseKey(raw.toString("base64"))?.equals(raw)).toBe(true);
    expect(parseKey(raw.toString("base64url"))?.equals(raw)).toBe(true);
    expect(parseKey(`  ${raw.toString("base64")}\n`)?.equals(raw)).toBe(true);
  });
  it.each([undefined, "", "   ", "not base64 at all!!", Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64"), Buffer.alloc(16).toString("base64")])("rejects %j", (v) => {
    expect(parseKey(v)).toBeNull();
  });
});

describe("encryptSecret / decryptSecret", () => {
  const ctx = tokenContext("user-1");

  it("round-trips, including unicode and long values", () => {
    for (const v of ["1//0gAbCdEf-refresh-token", "päss wörd ✓", "x".repeat(5000)]) expect(decryptSecret(encryptSecret(v, key, ctx), key, ctx)).toBe(v);
  });

  it("never contains the plain text, and differs every time (fresh random IV)", () => {
    const a = encryptSecret("super-secret-token", key, ctx);
    const b = encryptSecret("super-secret-token", key, ctx);
    expect(a).not.toContain("super-secret-token");
    expect(Buffer.from(a.split(".")[3], "base64url").toString("utf8")).not.toContain("super-secret");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
  });

  it("will not decrypt with the wrong key", () => {
    expect(() => decryptSecret(encryptSecret("t", key, ctx), otherKey, ctx)).toThrow(CryptoError);
  });

  it("will not decrypt for a different owner, so a token cannot be moved to another account", () => {
    const enc = encryptSecret("alice-token", key, tokenContext("alice"));
    expect(() => decryptSecret(enc, key, tokenContext("mallory"))).toThrow(CryptoError);
    expect(decryptSecret(enc, key, tokenContext("alice"))).toBe("alice-token");
  });

  it("detects any alteration of the iv, tag or ciphertext", () => {
    const [v, iv, tag, ct] = encryptSecret("a-token-value", key, ctx).split(".");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    for (const bad of [`${v}.${flip(iv)}.${tag}.${ct}`, `${v}.${iv}.${flip(tag)}.${ct}`, `${v}.${iv}.${tag}.${flip(ct)}`]) expect(() => decryptSecret(bad, key, ctx)).toThrow(CryptoError);
  });

  it.each(["", "garbage", "v2.a.b.c", "v1.a.b", "v1.a.b.c.d", "v1...."])("rejects the malformed value %j", (bad) => {
    expect(() => decryptSecret(bad, key, ctx)).toThrow(CryptoError);
  });
});

describe("fingerprint", () => {
  it("is stable, 32 hex characters, and sensitive to every character", () => {
    expect(fingerprint("<p>a</p>")).toBe(fingerprint("<p>a</p>"));
    expect(fingerprint("<p>a</p>")).toMatch(/^[a-f0-9]{32}$/);
    expect(fingerprint("<p>a</p>")).not.toBe(fingerprint("<p>b</p>"));
    expect(fingerprint("")).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("PKCE", () => {
  it("matches the RFC 7636 test vector", () => {
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("sign-in cookie", () => {
  const t0 = 1_700_000_000_000;

  it("round-trips, and expires after ten minutes", () => {
    const hs = newHandshake("user-1", "/preview", t0);
    const cookie = sealState(hs, key);
    expect(openState(cookie, key, t0 + 1000)).toEqual(hs);
    expect(openState(cookie, key, t0 + STATE_TTL_MS - 1)).not.toBeNull();
    expect(openState(cookie, key, t0 + STATE_TTL_MS + 1)).toBeNull();
  });

  it("is useless if missing, forged, altered, or sealed with another key", () => {
    const cookie = sealState(newHandshake("user-1", "/preview", t0), key);
    expect(openState(undefined, key, t0)).toBeNull();
    expect(openState("", key, t0)).toBeNull();
    expect(openState("forged", key, t0)).toBeNull();
    expect(openState(cookie.slice(0, -2) + "xx", key, t0)).toBeNull();
    expect(openState(cookie, otherKey, t0)).toBeNull();
  });

  it("does not expose the PKCE verifier or state in the cookie", () => {
    const hs = newHandshake("user-1", "/preview", t0);
    const cookie = sealState(hs, key);
    expect(cookie).not.toContain(hs.verifier);
    expect(cookie).not.toContain(hs.state);
    expect(Buffer.from(cookie.split(".")[3], "base64url").toString("latin1")).not.toContain(hs.verifier);
  });

  it("every handshake is unique", () => {
    const a = newHandshake("u", "/x", t0);
    const b = newHandshake("u", "/x", t0);
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.state.length).toBeGreaterThanOrEqual(40);
  });

  it("sameState compares exactly", () => {
    expect(sameState("abc", "abc")).toBe(true);
    expect(sameState("abc", "abd")).toBe(false);
    expect(sameState("abc", "abcd")).toBe(false);
    expect(sameState(null, "abc")).toBe(false);
    expect(sameState("", "abc")).toBe(false);
  });
});

describe("readGoogleConfig", () => {
  const good = {
    GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "shh",
    GOOGLE_TOKEN_ENCRYPTION_KEY: key.toString("base64"),
    GOOGLE_WORKSPACE_DOMAINS: "Kimp.xyz, example.org",
    SUPABASE_SERVICE_ROLE_KEY: "service",
  };

  it("builds the config, lower-casing domains and defaulting the redirect to this site", () => {
    const r = readGoogleConfig("https://app.example.com", good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.domains).toEqual(["kimp.xyz", "example.org"]);
      expect(r.config.redirectUri).toBe("https://app.example.com/api/google/callback");
      expect(r.config.key.equals(key)).toBe(true);
    }
  });

  it("honours an explicit redirect URI (needed in production behind a proxy)", () => {
    const r = readGoogleConfig("http://internal:3000", { ...good, GOOGLE_REDIRECT_URI: "https://signcraft.kimp.xyz/api/google/callback" });
    expect(r.ok && r.config.redirectUri).toBe("https://signcraft.kimp.xyz/api/google/callback");
  });

  it("falls back to ALLOWED_EMAIL_DOMAINS for the Workspace domains", () => {
    const rest = Object.fromEntries(Object.entries(good).filter(([k]) => k !== "GOOGLE_WORKSPACE_DOMAINS"));
    const r = readGoogleConfig("http://localhost:3000", { ...rest, ALLOWED_EMAIL_DOMAINS: "kimp.xyz" });
    expect(r.ok && r.config.domains).toEqual(["kimp.xyz"]);
  });

  it("names exactly what is missing and never echoes a value", () => {
    const r = readGoogleConfig("http://localhost:3000", { GOOGLE_CLIENT_SECRET: "top-secret-value", GOOGLE_TOKEN_ENCRYPTION_KEY: "short" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing.map((m) => m.split(" ")[0])).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_TOKEN_ENCRYPTION_KEY", "GOOGLE_WORKSPACE_DOMAINS", "SUPABASE_SERVICE_ROLE_KEY"]);
      expect(JSON.stringify(r)).not.toContain("top-secret-value");
    }
  });

  it("refuses to run without an explicit Workspace domain (so it can never default to 'any account')", () => {
    const rest = Object.fromEntries(Object.entries(good).filter(([k]) => k !== "GOOGLE_WORKSPACE_DOMAINS"));
    expect(readGoogleConfig("http://localhost:3000", rest).ok).toBe(false);
  });
});
