import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPreset } from "@/lib/presets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { GMAIL_SETTINGS_SCOPE } from "@/lib/google/config";
import { saveConnection } from "@/lib/google/connection";
import { fingerprint } from "@/lib/google/crypto";
import { STATE_COOKIE, openState } from "@/lib/google/state";
import { KEY, fakeAdmin, fakeGoogle, idToken, testConfig } from "@/lib/google/test-kit";

const world = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; email_confirmed_at: string },
  featureOn: true,
  admin: null as unknown,
  /** What the signed-in person's own (row-level-security) client can see in google_connections. */
  ownRow: null as null | { google_email: string; hd: string },
  ownDeleted: 0,
}));

vi.mock("@/lib/supabase/server", () => {
  const client = {
    rpc: async (fn: string) => (fn === "feature_enabled" ? { data: world.featureOn, error: null } : { data: "member", error: null }),
    from: () => ({
      select: () => ({ maybeSingle: async () => ({ data: world.ownRow, error: null }) }),
      delete: () => ({
        eq: async () => {
          world.ownDeleted += 1;
          return { error: null };
        },
      }),
    }),
  };
  return { createClient: async () => client, getUser: async () => world.user };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => world.admin }));

import { GET as callback } from "./callback/route";
import { GET as connect } from "./connect/route";
import { POST as disconnect } from "./disconnect/route";
import { POST as push } from "./push/route";
import { POST as preview } from "./preview/route";
import { GET as sendas } from "./sendas/route";
import { GET as status } from "./status/route";

const BASE = "http://localhost:3000";
const doc = getPreset("classic")!.doc;
const html = renderToEmailHtml(doc);
const OLD = "<p>old signature</p>";
const cfg = testConfig();

let g: ReturnType<typeof fakeGoogle>;
let admin: ReturnType<typeof fakeAdmin>;

const ENV = {
  GOOGLE_CLIENT_ID: cfg.clientId,
  GOOGLE_CLIENT_SECRET: cfg.clientSecret,
  GOOGLE_TOKEN_ENCRYPTION_KEY: KEY.toString("base64"),
  GOOGLE_WORKSPACE_DOMAINS: "kimp.xyz",
  SUPABASE_SERVICE_ROLE_KEY: "service",
};

const get = (path: string, headers: Record<string, string> = {}) => new Request(`${BASE}${path}`, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", host: "localhost:3000", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const json = async (r: Response) => ({ status: r.status, ...(await r.json()) });

const approval = (over: Record<string, unknown> = {}) => ({ doc, email: "jane@kimp.xyz", confirm: true, newHash: fingerprint(html), currentHash: fingerprint(OLD), ...over });
const connected = async (userId = "user-1") => saveConnection(admin as never, cfg, userId, { sub: "s", email: "jane@kimp.xyz", hd: "kimp.xyz" }, GMAIL_SETTINGS_SCOPE, "refresh-1");

/** Runs the real "connect" step and returns what the browser would hold afterwards: the cookie and the state Google echoes back. */
async function startConnect(next = "/preview") {
  const res = await connect(get(`/api/google/connect?next=${encodeURIComponent(next)}`));
  const cookieHeader = res.headers.get("set-cookie")!;
  const cookie = cookieHeader.split(";")[0];
  const sealed = decodeURIComponent(cookie.slice(STATE_COOKIE.length + 1));
  const st = openState(sealed, KEY)!;
  return { res, cookieHeader, cookie, st, location: new URL(res.headers.get("location")!) };
}
const finish = (cb: { cookie: string; st: { state: string } }, params: Record<string, string> = {}) =>
  callback(get(`/api/google/callback?${new URLSearchParams({ code: "code-1", state: cb.st.state, ...params })}`, { cookie: cb.cookie }));
const outcome = (r: Response) => ({ status: r.status, to: new URL(r.headers.get("location")!), code: new URL(r.headers.get("location")!).searchParams.get("gmail") });

beforeEach(() => {
  Object.assign(process.env, ENV);
  world.user = { id: "user-1", email: "jane@kimp.xyz", email_confirmed_at: "x" };
  world.featureOn = true;
  admin = fakeAdmin();
  world.admin = admin;
  world.ownRow = null;
  world.ownDeleted = 0;
  g = fakeGoogle();
  vi.stubGlobal("fetch", g.fetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) delete process.env[k];
  delete process.env.GOOGLE_REDIRECT_URI;
});

/* ----------------------------------------------------------------------------------- access */

describe("every Google route: access", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["status", () => status(get("/api/google/status"))],
    ["sendas", () => sendas(get("/api/google/sendas"))],
    ["preview", () => preview(post("/api/google/preview", { doc, email: "jane@kimp.xyz" }))],
    ["push", () => push(post("/api/google/push", approval()))],
  ];

  it.each(calls)("%s is 401 when signed out, and Google is never contacted", async (_n, run) => {
    world.user = null;
    expect((await run()).status).toBe(401);
    expect(g.mock).not.toHaveBeenCalled();
  });

  it.each(calls)("%s is 403 when the gmail_push feature is off for this person", async (_n, run) => {
    world.featureOn = false;
    const r = await json(await run());
    expect(r).toMatchObject({ status: 403, error: "feature_disabled" });
    expect(g.mock).not.toHaveBeenCalled();
  });

  it.each(calls.slice(1))("%s says exactly which settings are missing, without echoing any value", async (_n, run) => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    const res = await run();
    const body = JSON.stringify(await res.json());
    expect(res.status).toBe(503);
    expect(body).toContain("GOOGLE_CLIENT_ID");
    expect(body).toContain("GOOGLE_TOKEN_ENCRYPTION_KEY");
    expect(body).not.toContain(cfg.clientSecret);
  });

  it("the two write routes refuse a request from another site", async () => {
    await connected();
    const evil = { origin: "https://evil.example" };
    expect((await json(await preview(post("/api/google/preview", { doc, email: "jane@kimp.xyz" }, evil)))).error).toBe("bad_origin");
    expect((await json(await push(post("/api/google/push", approval(), evil)))).error).toBe("bad_origin");
    expect((await json(await disconnect(post("/api/google/disconnect", {}, evil)))).error).toBe("bad_origin");
    expect(g.patches()).toHaveLength(0);
    expect(admin.store.connections.size).toBe(1);
  });
});

/* ----------------------------------------------------------------------------------- connect */

describe("GET /api/google/connect", () => {
  it("sends the person to Google with PKCE and a state that matches the cookie we set", async () => {
    const c = await startConnect();
    expect(c.res.status).toBe(302);
    expect(c.location.origin + c.location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(c.location.searchParams.get("state")).toBe(c.st.state);
    expect(c.location.searchParams.get("code_challenge")).toBeTruthy();
    expect(c.location.searchParams.get("scope")).toContain(GMAIL_SETTINGS_SCOPE);
    expect(c.st).toMatchObject({ userId: "user-1", next: "/preview" });
  });

  it("sets an HttpOnly, path-limited, short-lived cookie, and the verifier is not visible in it or in the URL", async () => {
    const c = await startConnect();
    expect(c.cookieHeader).toMatch(/HttpOnly/);
    expect(c.cookieHeader).toMatch(/SameSite=Lax/);
    expect(c.cookieHeader).toMatch(/Path=\/api\/google/);
    expect(c.cookieHeader).toMatch(/Max-Age=600/);
    expect(c.cookieHeader).not.toContain(c.st.verifier);
    expect(c.location.toString()).not.toContain(c.st.verifier);
  });

  it("only ever returns to a page on this site", async () => {
    for (const evil of ["https://evil.example/x", "//evil.example", "/\\evil.example"]) expect((await startConnect(evil)).st.next).toBe("/preview");
    expect((await startConnect("/editor")).st.next).toBe("/editor");
  });

  it("sends a signed-out person to sign in first", async () => {
    world.user = null;
    const r = await connect(get("/api/google/connect"));
    expect(new URL(r.headers.get("location")!).pathname).toBe("/login");
  });

  it("sends the person back with a reason when the feature is off or the server is not set up", async () => {
    world.featureOn = false;
    expect(outcome(await connect(get("/api/google/connect"))).code).toBe("feature_disabled");
    world.featureOn = true;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(outcome(await connect(get("/api/google/connect"))).code).toBe("not_configured");
  });
});

/* ----------------------------------------------------------------------------------- callback */

describe("GET /api/google/callback", () => {
  it("connects: exchanges the code with the PKCE verifier, stores the token encrypted, and clears the cookie", async () => {
    const c = await startConnect("/editor");
    const r = await finish(c);
    expect(outcome(r)).toMatchObject({ code: "connected" });
    expect(outcome(r).to.pathname).toBe("/editor");
    expect(new URLSearchParams(g.s.seen[0].body).get("code_verifier")).toBe(c.st.verifier);
    const row = admin.store.connections.get("user-1")!;
    expect(row).toMatchObject({ google_email: "jane@kimp.xyz", hd: "kimp.xyz" });
    expect(String(row.refresh_token_enc)).not.toContain("refresh-1");
    expect(r.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(g.s.revoked).toEqual([]);
  });

  it("rejects a callback whose state does not match (forged or replayed), without contacting Google", async () => {
    const c = await startConnect();
    const r = await callback(get(`/api/google/callback?code=c&state=forged`, { cookie: c.cookie }));
    expect(outcome(r).code).toBe("expired");
    expect(g.mock).not.toHaveBeenCalled();
    expect(admin.store.connections.size).toBe(0);
  });

  it("rejects a callback with no cookie, a garbage cookie, or a cookie from someone else's sign-in", async () => {
    const c = await startConnect();
    expect(outcome(await callback(get(`/api/google/callback?code=c&state=${c.st.state}`))).code).toBe("expired");
    expect(outcome(await callback(get(`/api/google/callback?code=c&state=${c.st.state}`, { cookie: `${STATE_COOKIE}=garbage` }))).code).toBe("expired");
    world.user = { id: "attacker", email: "x@kimp.xyz", email_confirmed_at: "x" }; // a different signed-in person presents the victim's cookie
    expect(outcome(await finish(c)).code).toBe("expired");
    expect(g.mock).not.toHaveBeenCalled();
    expect(admin.store.connections.size).toBe(0);
  });

  it("people who say no, or whose Workspace blocks the app, get the right message", async () => {
    expect(outcome(await finish(await startConnect(), { error: "access_denied", code: "" })).code).toBe("denied");
    expect(outcome(await finish(await startConnect(), { error: "admin_policy_enforced", code: "" })).code).toBe("admin_blocked");
    expect(outcome(await finish(await startConnect(), { error: "org_internal", code: "" })).code).toBe("admin_blocked");
    expect(g.mock).not.toHaveBeenCalled();
  });

  it("a missing code is treated as an expired sign-in", async () => {
    const c = await startConnect();
    expect(outcome(await callback(get(`/api/google/callback?state=${c.st.state}`, { cookie: c.cookie }))).code).toBe("expired");
  });

  it("refuses a personal Gmail account and revokes what Google just granted", async () => {
    g.s.exchange.body.id_token = idToken({ email: "me@gmail.com", hd: undefined });
    expect(outcome(await finish(await startConnect())).code).toBe("wrong_account");
    expect(admin.store.connections.size).toBe(0);
    expect(g.s.revoked).toEqual(["refresh-1"]);
  });

  it("refuses a Workspace account from another company", async () => {
    g.s.exchange.body.id_token = idToken({ hd: "other.com", email: "x@other.com" });
    expect(outcome(await finish(await startConnect())).code).toBe("wrong_account");
    expect(admin.store.connections.size).toBe(0);
    expect(g.s.revoked).toHaveLength(1);
  });

  it("refuses when signature access was unticked on the consent screen, and revokes", async () => {
    g.s.exchange.body.scope = "openid email";
    expect(outcome(await finish(await startConnect())).code).toBe("scope_missing");
    expect(admin.store.connections.size).toBe(0);
    expect(g.s.revoked).toEqual(["refresh-1"]);
  });

  it("refuses when Google gave no long-lived token, and revokes the short-lived one", async () => {
    delete g.s.exchange.body.refresh_token;
    expect(outcome(await finish(await startConnect())).code).toBe("no_refresh_token");
    expect(admin.store.connections.size).toBe(0);
    expect(g.s.revoked).toEqual(["access-1"]);
  });

  it("a code that was already used or has expired is reported as such", async () => {
    g.s.exchange = { status: 400, body: { error: "invalid_grant" } };
    expect(outcome(await finish(await startConnect())).code).toBe("reconnect_required");
    expect(admin.store.connections.size).toBe(0);
  });

  it("if saving fails, the grant is revoked rather than left dangling", async () => {
    admin.store.failSave = true;
    expect(outcome(await finish(await startConnect())).code).toBe("upstream");
    expect(g.s.revoked).toEqual(["refresh-1"]);
  });

  it("the error redirect never contains a token or the code", async () => {
    g.s.exchange.body.id_token = idToken({ hd: "other.com" });
    const r = await finish(await startConnect());
    const loc = r.headers.get("location")!;
    for (const secret of ["refresh-1", "access-1", "code-1", cfg.clientSecret]) expect(loc).not.toContain(secret);
  });
});

/* ----------------------------------------------------------------------------------- status */

describe("GET /api/google/status", () => {
  it("reports 'not set up' when server settings are missing", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(await json(await status(get("/api/google/status")))).toMatchObject({ status: 200, configured: false, connected: false });
  });

  it("reports connected or not, from the person's own row, and never includes a token", async () => {
    expect(await json(await status(get("/api/google/status")))).toMatchObject({ configured: true, connected: false });
    world.ownRow = { google_email: "jane@kimp.xyz", hd: "kimp.xyz" };
    const r = await status(get("/api/google/status"));
    const body = await r.json();
    expect(body).toEqual({ configured: true, connected: true, email: "jane@kimp.xyz", domain: "kimp.xyz" });
    expect(JSON.stringify(body)).not.toMatch(/token|refresh/i);
  });
});

/* ----------------------------------------------------------------------------------- send-as */

describe("GET /api/google/sendas", () => {
  it("lists addresses (primary first) without returning any signature text", async () => {
    await connected();
    g.s.addresses.set("a-sales@kimp.xyz", { sendAsEmail: "a-sales@kimp.xyz", verificationStatus: "accepted", signature: "<p>sales</p>" });
    g.s.addresses.set("pending@kimp.xyz", { sendAsEmail: "pending@kimp.xyz", verificationStatus: "pending" });
    const r = await json(await sendas(get("/api/google/sendas")));
    expect(r.addresses.map((a: { email: string }) => a.email)).toEqual(["jane@kimp.xyz", "a-sales@kimp.xyz", "pending@kimp.xyz"]);
    expect(r.addresses.find((a: { email: string }) => a.email === "pending@kimp.xyz")).toMatchObject({ canEdit: false, hasSignature: false });
    expect(r.addresses[0]).toMatchObject({ isPrimary: true, hasSignature: true, canEdit: true });
    expect(JSON.stringify(r)).not.toContain("old signature");
  });

  it("is 409 when the person has not connected", async () => {
    expect(await json(await sendas(get("/api/google/sendas")))).toMatchObject({ status: 409, error: "not_connected" });
  });

  it("if Google access was revoked, says to reconnect and forgets the dead connection", async () => {
    await connected();
    g.s.refresh = { status: 400, body: { error: "invalid_grant" } };
    expect(await json(await sendas(get("/api/google/sendas")))).toMatchObject({ status: 401, error: "reconnect_required" });
    expect(admin.store.connections.size).toBe(0);
  });

  it("reports Google being down without losing the connection", async () => {
    await connected();
    g.s.gmailFail = { status: 503 };
    expect(await json(await sendas(get("/api/google/sendas")))).toMatchObject({ status: 502, error: "upstream" });
    expect(admin.store.connections.size).toBe(1);
  });

  it("explains when the Gmail API is not enabled for the Cloud project", async () => {
    await connected();
    g.s.gmailFail = { status: 403, body: { error: { errors: [{ reason: "accessNotConfigured" }] } } };
    expect(await json(await sendas(get("/api/google/sendas")))).toMatchObject({ status: 503, error: "gmail_api_disabled" });
  });
});

/* ----------------------------------------------------------------------------------- preview + push */

describe("POST /api/google/preview", () => {
  it("returns the new and current signature with fingerprints, and changes nothing", async () => {
    await connected();
    const r = await json(await preview(post("/api/google/preview", { doc, email: "jane@kimp.xyz" })));
    expect(r).toMatchObject({ status: 200, address: { email: "jane@kimp.xyz", isPrimary: true }, newHtml: html, newHash: fingerprint(html), current: { html: OLD, hash: fingerprint(OLD), hasSignature: true } });
    expect(g.patches()).toHaveLength(0);
  });

  it("works for a different send-as address", async () => {
    await connected();
    g.s.addresses.set("sales@kimp.xyz", { sendAsEmail: "sales@kimp.xyz", verificationStatus: "accepted", signature: "" });
    const r = await json(await preview(post("/api/google/preview", { doc, email: "sales@kimp.xyz" })));
    expect(r).toMatchObject({ address: { email: "sales@kimp.xyz", isPrimary: false }, current: { hasSignature: false } });
  });

  it("rejects an invalid signature document or address", async () => {
    await connected();
    for (const bad of [{ doc: { nope: 1 }, email: "jane@kimp.xyz" }, { doc, email: "not-an-email" }, {}, "{broken"]) expect((await preview(post("/api/google/preview", bad))).status).toBe(400);
    expect(g.mock).not.toHaveBeenCalled();
  });

  it("explains an alias that is not verified yet", async () => {
    await connected();
    g.s.addresses.set("pending@kimp.xyz", { sendAsEmail: "pending@kimp.xyz", verificationStatus: "pending" });
    expect(await json(await preview(post("/api/google/preview", { doc, email: "pending@kimp.xyz" })))).toMatchObject({ status: 422, error: "address_not_editable" });
  });
});

describe("POST /api/google/push", () => {
  it("replaces the signature with exactly what the server rendered, and logs what it replaced", async () => {
    await connected();
    const r = await json(await push(post("/api/google/push", approval())));
    expect(r).toMatchObject({ status: 200, ok: true, email: "jane@kimp.xyz", logged: true });
    expect(g.patches()).toHaveLength(1);
    expect(JSON.parse(g.patches()[0].body).signature).toBe(html);
    expect(admin.store.log).toEqual([{ user_id: "user-1", send_as_email: "jane@kimp.xyz", previous_signature: OLD, new_signature_hash: fingerprint(html), template_id: doc.template_id }]);
  });

  it("does nothing without the confirm flag", async () => {
    await connected();
    expect(await json(await push(post("/api/google/push", approval({ confirm: false }))))).toMatchObject({ status: 400, error: "not_confirmed" });
    expect((await push(post("/api/google/push", approval({ confirm: undefined })))).status).toBe(400);
    expect(g.patches()).toHaveLength(0);
    expect(admin.store.log).toHaveLength(0);
  });

  it("does nothing if the existing signature changed after the preview", async () => {
    await connected();
    g.s.addresses.get("jane@kimp.xyz")!.signature = "<p>edited meanwhile</p>";
    expect(await json(await push(post("/api/google/push", approval())))).toMatchObject({ status: 409, error: "changed" });
    expect(g.patches()).toHaveLength(0);
  });

  it("does nothing if the new signature is not the previewed one", async () => {
    await connected();
    expect(await json(await push(post("/api/google/push", approval({ newHash: fingerprint("other")  }))))).toMatchObject({ status: 409, error: "preview_stale" });
    expect(g.patches()).toHaveLength(0);
  });

  it("rejects malformed fingerprints and addresses before touching Google", async () => {
    await connected();
    for (const bad of [{ newHash: "x" }, { currentHash: "" }, { email: "nope" }, { doc: {} }]) expect((await push(post("/api/google/push", approval(bad)))).status).toBe(400);
    expect(g.mock).not.toHaveBeenCalled();
  });

  it("a failure to write the log does not turn a successful change into an error, but says so", async () => {
    await connected();
    admin.store.failLog = true;
    expect(await json(await push(post("/api/google/push", approval())))).toMatchObject({ status: 200, ok: true, logged: false });
    expect(g.patches()).toHaveLength(1);
  });

  it("reports Gmail refusing the change, and leaves the old signature and the log untouched", async () => {
    await connected();
    g.s.patchFail = { status: 403, body: { error: { message: "Mail service not enabled" } } };
    expect(await json(await push(post("/api/google/push", approval())))).toMatchObject({ status: 403, error: "forbidden" });
    expect(g.s.addresses.get("jane@kimp.xyz")!.signature).toBe(OLD);
    expect(admin.store.log).toHaveLength(0);
  });

  it("if access was revoked between preview and push, asks to reconnect and changes nothing", async () => {
    await connected();
    g.s.refresh = { status: 400, body: { error: "invalid_grant" } };
    expect(await json(await push(post("/api/google/push", approval())))).toMatchObject({ status: 401, error: "reconnect_required" });
    expect(g.patches()).toHaveLength(0);
  });

  it("is a 409 when not connected", async () => {
    expect(await json(await push(post("/api/google/push", approval())))).toMatchObject({ status: 409, error: "not_connected" });
  });
});

/* ----------------------------------------------------------------------------------- disconnect */

describe("POST /api/google/disconnect", () => {
  it("revokes the grant with Google, then deletes the stored token", async () => {
    await connected();
    const r = await json(await disconnect(post("/api/google/disconnect", {})));
    expect(r).toMatchObject({ status: 200, ok: true, revoked: "revoked" });
    expect(g.s.revoked).toEqual(["refresh-1"]);
    expect(admin.store.connections.size).toBe(0);
  });

  it("still deletes the stored token when Google cannot be reached, and says the revocation was not confirmed", async () => {
    await connected();
    g.s.revoke.throws = true;
    expect(await json(await disconnect(post("/api/google/disconnect", {})))).toMatchObject({ ok: true, revoked: "failed" });
    expect(admin.store.connections.size).toBe(0);
  });

  it("treats an already-revoked grant as success", async () => {
    await connected();
    g.s.revoke = { status: 400, body: { error: "invalid_token" }, throws: false };
    expect(await json(await disconnect(post("/api/google/disconnect", {})))).toMatchObject({ ok: true, revoked: "already_invalid" });
    expect(admin.store.connections.size).toBe(0);
  });

  it("works for someone who was never connected", async () => {
    expect(await json(await disconnect(post("/api/google/disconnect", {})))).toMatchObject({ status: 200, ok: true, revoked: "not_attempted" });
  });

  it("always works, even if the gmail_push feature has since been switched off for this person", async () => {
    await connected();
    world.featureOn = false;
    expect((await disconnect(post("/api/google/disconnect", {}))).status).toBe(200);
    expect(admin.store.connections.size).toBe(0);
  });

  it("requires sign-in", async () => {
    world.user = null;
    expect((await disconnect(post("/api/google/disconnect", {}))).status).toBe(401);
  });

  it("an unreadable stored token (changed key) is still removed", async () => {
    admin.store.connections.set("user-1", { user_id: "user-1", refresh_token_enc: "v1.bad.bad.bad" });
    expect(await json(await disconnect(post("/api/google/disconnect", {})))).toMatchObject({ ok: true, revoked: "not_attempted" });
    expect(admin.store.connections.size).toBe(0);
  });

  it("with the server settings missing, the person can still remove their own stored row", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(await json(await disconnect(post("/api/google/disconnect", {})))).toMatchObject({ ok: true, revoked: "not_attempted" });
    expect(world.ownDeleted).toBe(1);
  });

  it("reports a storage failure instead of claiming success", async () => {
    await connected();
    admin.store.failDelete = true;
    expect((await disconnect(post("/api/google/disconnect", {}))).status).toBeGreaterThanOrEqual(500);
  });
});
