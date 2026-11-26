// Browser + API test for sign-in, invite-only sign-up, sessions and route protection, against the REAL Supabase project.
//
//   npm run dev -- -p 3100        (reads .env.local, so it talks to the real project)
//   E2E_BASE_URL=http://localhost:3100 node --test e2e/auth.e2e.mjs
//
// Part 1 needs nothing but the running app and creates nothing: logged-out access, login screen, wrong password.
//
// Part 2 creates real accounts, so it only runs when it is allowed to clean up after itself. It needs, in .env.local or the environment:
//   SUPABASE_SERVICE_ROLE_KEY   lets the test invite people, confirm an email without opening an inbox, read the database and delete what it made
//   E2E_EMAIL_BASE              an inbox you own, e.g. you@your-company.com. Each run signs up you+signcraft-e2e-<time>@your-company.com
//                               (plus-addressing), so Supabase's real confirmation email lands in your inbox, never a stranger's.
// It also needs migrations 0017 (invite-only) and 0018 applied to the project. Without them Part 2 is skipped, not failed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";

// Read .env.local without printing or exporting anything else.
if (fs.existsSync(".env.local")) {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL_BASE = process.env.E2E_EMAIL_BASE;
const PASSWORD = `Pw-${Date.now()}-e2e!`;

const exe = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean).find((p) => fs.existsSync(p));
let browser;
before(async () => {
  assert.ok(SB_URL && SB_ANON, "Supabase is not configured for this test run (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY missing).");
  browser = await chromium.launch({ executablePath: exe, headless: true });
});
after(async () => browser?.close());

const fresh = async () => (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const noRedirect = (path, init) => fetch(`${BASE}${path}`, { redirect: "manual", ...init });

/* ------------------------------------------------------------------ Part 1 */

const PRIVATE_PAGES = ["/", "/create", "/editor", "/signatures", "/team", "/agency", "/cards", "/guides", "/polish", "/preview", "/admin", "/admin/users", "/admin/features", "/admin/limits", "/admin/invitations"];
const PRIVATE_APIS = ["/api/admin/members", "/api/admin/invitations", "/api/admin/flags", "/api/ai/design", "/api/ai/vision", "/api/upload", "/api/sync/runs", "/api/health/status"];

test("logged out: every private page sends you to the login page and remembers where you were going", async () => {
  for (const path of PRIVATE_PAGES) {
    const res = await noRedirect(path);
    assert.equal(res.status, 307, path);
    const to = new URL(res.headers.get("location"), BASE);
    assert.equal(to.pathname, "/login", path);
    if (path !== "/") assert.equal(to.searchParams.get("next"), path, path);
  }
});

test("logged out: every private API answers 401 (reads and writes), never data", async () => {
  for (const path of PRIVATE_APIS) {
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      const res = await noRedirect(path, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal((await res.json()).error, "unauthorized");
    }
  }
});

test("logged out: the login page and the email-link landing are reachable; a bad link goes back to login with a message", async () => {
  assert.equal((await noRedirect("/login")).status, 200);
  const res = await noRedirect("/auth/callback?code=not-a-real-code");
  assert.equal(res.status, 307);
  assert.match(res.headers.get("location"), /\/login\?error=callback$/);
  assert.equal(new URL(res.headers.get("location"), BASE).origin, new URL(BASE).origin);
  const page = await fresh();
  await page.goto(`${BASE}/login?error=callback`);
  assert.match(await page.locator('[role="alert"]').innerText(), /invalid or has expired/i);
  await page.context().close();
});

test("login screen: invite-only wording, validation, and a generic error for a wrong password", async () => {
  const page = await fresh();
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: "Invited? Create your account" }).click();
  assert.ok(await page.getByText(/invitation was sent to/i).isVisible());
  await page.getByRole("button", { name: "Already have an account? Sign in" }).click();

  await page.getByLabel("Email").fill(`nobody-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("definitely-wrong-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Incorrect email or password.").waitFor({ timeout: 20000 });
  assert.match(new URL(page.url()).pathname, /^\/login/); // still on the login page
  await page.context().close();
});

/* ------------------------------------------------------------------ Part 2 */

const skipReason = !SERVICE ? "SUPABASE_SERVICE_ROLE_KEY is not set" : !EMAIL_BASE?.includes("@") ? "E2E_EMAIL_BASE is not set (an inbox you own, e.g. you@your-company.com)" : false;

const admin = SERVICE ? createClient(SB_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const made = { emails: [] };
const plus = (tag) => {
  const [local, domain] = EMAIL_BASE.split("@");
  const email = `${local.split("+")[0]}+signcraft-e2e-${tag}-${Date.now()}@${domain}`.toLowerCase();
  made.emails.push(email);
  return email;
};
const userIdOf = async (email) => (await admin.from("profiles").select("id").eq("email", email).maybeSingle()).data?.id ?? null;

after(async () => {
  if (!admin) return;
  for (const email of made.emails) {
    const id = await userIdOf(email);
    if (id) await admin.auth.admin.deleteUser(id);
    await admin.from("invitations").delete().eq("email", email);
  }
});

async function migrationsApplied() {
  const r = await admin.from("invitations").select("email").limit(1);
  return !r.error;
}

async function signUpViaUi(page, email) {
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: "Invited? Create your account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
}
async function signInViaUi(page, email, next) {
  await page.goto(`${BASE}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}
const confirmEmail = async (email) => {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const u = data.users.find((x) => x.email?.toLowerCase() === email);
  assert.ok(u, `no auth user for ${email}`);
  const r = await admin.auth.admin.updateUserById(u.id, { email_confirm: true });
  assert.ifError(r.error);
};

test("invite-only: an address nobody invited cannot sign up, through the form or by calling Supabase directly", { skip: skipReason }, async (t) => {
  if (!(await migrationsApplied())) return t.skip("migration 0017_invite_only.sql is not applied to this Supabase project yet");
  const email = plus("uninvited");
  const page = await fresh();
  await signUpViaUi(page, email);
  await page.getByText(/invitation only/i).waitFor({ timeout: 30000 });

  // The public sign-up endpoint with only the browser-safe key: this is what a script would call.
  const anon = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
  const direct = await anon.auth.signUp({ email, password: PASSWORD });
  assert.ok(direct.error, "direct sign-up must be refused");
  assert.equal(await userIdOf(email), null);
  assert.equal((await admin.auth.admin.listUsers({ perPage: 200 })).data.users.some((u) => u.email?.toLowerCase() === email), false);
  await page.context().close();
});

test("invited member journey: sign up, confirm email, profile and role, sign in, app, log out, sign in again", { skip: skipReason, timeout: 180000 }, async (t) => {
  if (!(await migrationsApplied())) return t.skip("migration 0017_invite_only.sql is not applied to this Supabase project yet");
  const email = plus("member");
  assert.ifError((await admin.from("invitations").insert({ email, role: "member" })).error);

  // Sign up. With email confirmation on there is no session yet, only a message.
  const page = await fresh();
  await signUpViaUi(page, email);
  await page.getByText(/Check your email for a confirmation link/i).waitFor({ timeout: 30000 });

  // The account exists, with a profile and the invited role in the default organization, and the invitation is used up.
  const id = await userIdOf(email);
  assert.ok(id, "profile row was not created for the new account");
  const m = await admin.from("memberships").select("role, organizations!inner(is_default)").eq("user_id", id);
  assert.equal(m.data.length, 1);
  assert.equal(m.data[0].role, "member");
  assert.equal(m.data[0].organizations.is_default, true);
  assert.ok((await admin.from("invitations").select("accepted_at").eq("email", email).single()).data.accepted_at);

  // Until the email is confirmed, signing in is refused with a helpful message.
  await signInViaUi(page, email);
  await page.getByText(/Confirm your email first/i).waitFor({ timeout: 20000 });
  assert.match(new URL(page.url()).pathname, /^\/login/);

  // Confirm (stands in for clicking the link in the inbox), then sign in. A hostile ?next= must not leave the site.
  await confirmEmail(email);
  await signInViaUi(page, email, "/\t/evil.example");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  assert.equal(new URL(page.url()).origin, new URL(BASE).origin);
  assert.equal(new URL(page.url()).pathname, "/create");
  await page.getByLabel("Account menu").click();
  assert.ok(await page.getByText(email, { exact: true }).first().isVisible(), "the signed-in email is shown in the account menu");
  assert.ok(await page.getByRole("button", { name: "Log out" }).first().isVisible(), "Log out is in the account menu");

  // Session survives a reload and works for the API as the browser.
  await page.reload();
  assert.equal(new URL(page.url()).pathname, "/create");
  const me = await page.evaluate(() => fetch("/api/admin/members", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x@example.com", role: "admin" }) }).then((r) => r.status));
  assert.equal(me, 403, "a plain member must not be able to change roles");

  // A member cannot see the admin area (404, so it does not advertise itself) or invite anyone.
  assert.equal((await page.goto(`${BASE}/admin/users`)).status(), 404);
  const inv = await page.evaluate(() => fetch("/api/admin/invitations", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x@example.com", role: "member" }) }).then((r) => r.status));
  assert.equal(inv, 403);
  assert.equal(await admin.from("invitations").select("email").eq("email", "x@example.com").then((r) => r.data.length), 0);

  // Logging in while logged in just goes to the app; logging out ends the session everywhere.
  await page.goto(`${BASE}/login`);
  assert.equal(new URL(page.url()).pathname, "/create");
  if (!(await page.getByRole("button", { name: "Log out" }).first().isVisible())) await page.getByLabel("Account menu").click();
  await page.getByRole("button", { name: "Log out" }).first().click();
  await page.waitForURL(/\/login/, { timeout: 30000 });
  for (const path of ["/create", "/editor", "/admin"]) {
    await page.goto(`${BASE}${path}`);
    assert.equal(new URL(page.url()).pathname, "/login", `${path} must need a login again after logging out`);
  }
  assert.equal(await page.evaluate(() => fetch("/api/upload", { method: "POST" }).then((r) => r.status)), 401);

  // And back in again.
  await signInViaUi(page, email, "/editor");
  await page.waitForURL((u) => u.pathname === "/editor", { timeout: 30000 });
  await page.context().close();
});

test("invited admin: gets the admin area; an admin can invite and withdraw people from the page", { skip: skipReason, timeout: 180000 }, async (t) => {
  if (!(await migrationsApplied())) return t.skip("migration 0017_invite_only.sql is not applied to this Supabase project yet");
  const email = plus("admin");
  assert.ifError((await admin.from("invitations").insert({ email, role: "admin" })).error);
  const page = await fresh();
  await signUpViaUi(page, email);
  await page.getByText(/Check your email/i).waitFor({ timeout: 30000 });
  await confirmEmail(email);
  await signInViaUi(page, email, "/admin/invitations");
  await page.waitForURL((u) => u.pathname === "/admin/invitations", { timeout: 30000 });

  const guest = plus("guest");
  await page.getByLabel("Email address").fill(guest);
  await page.getByRole("button", { name: "Invite" }).click();
  await page.getByText(guest).waitFor({ timeout: 20000 });
  assert.equal((await admin.from("invitations").select("role").eq("email", guest).single()).data.role, "member");

  await page.getByText(guest).locator("xpath=ancestor::div[contains(@class,'flex')][1]").getByRole("button", { name: "Withdraw" }).click();
  await page.getByText(/withdrawn/i).waitFor({ timeout: 20000 });
  assert.equal((await admin.from("invitations").select("email").eq("email", guest)).data.length, 0);
  await page.context().close();
});
