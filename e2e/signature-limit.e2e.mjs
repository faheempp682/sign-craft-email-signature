// Browser + API test for the saved-signature limit and the admin setting, against the REAL Supabase project.
//
//   npm run dev -- -p 3100        (reads .env.local, so it talks to the real project)
//   E2E_BASE_URL=http://localhost:3100 node --test e2e/signature-limit.e2e.mjs
//
// It needs, in .env.local or the environment:
//   SUPABASE_SERVICE_ROLE_KEY   creates two throwaway confirmed accounts (a member and a platform admin) and deletes them afterwards
//   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
// and migrations 0017 and 0019 applied. Without any of these every test is skipped, not failed.
//
// It changes the real `max_signatures_per_account` setting while it runs and puts the original value (or no value) back at the end.
// Accounts are named signcraft-e2e-limit-*@example.com, which never receive mail. Their signatures are deleted with them.
//
// The same scenarios run against a real Postgres, without a browser or Supabase Auth, in app/api/signatures/limit.db.test.ts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";

if (fs.existsSync(".env.local")) {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KEY = "max_signatures_per_account";
const PASSWORD = `Pw-${Date.now()}-limit!`;
const exe = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean).find((p) => fs.existsSync(p));

const admin = SERVICE && SB_URL ? createClient(SB_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
let skip = !SERVICE ? "SUPABASE_SERVICE_ROLE_KEY is not set" : !SB_URL || !SB_ANON ? "Supabase is not configured" : false;

let browser;
let original; // the setting row before the test: { value } or null
const made = [];

before(async () => {
  if (skip) return;
  const tbl = await admin.from("platform_settings").select("value").eq("key", KEY).maybeSingle();
  if (tbl.error) skip = "migration 0019_platform_settings.sql is not applied to this Supabase project yet";
  else if ((await admin.from("invitations").select("email").limit(1)).error) skip = "migration 0017_invite_only.sql is not applied to this Supabase project yet";
  else original = tbl.data;
  if (!skip) browser = await chromium.launch({ executablePath: exe, headless: true });
});
after(async () => {
  await browser?.close();
  if (!admin || skip) return;
  await admin.from("platform_settings").delete().eq("key", KEY);
  if (original) await admin.from("platform_settings").insert({ key: KEY, value: original.value });
  for (const u of made) {
    await admin.auth.admin.deleteUser(u.id);
    await admin.from("invitations").delete().eq("email", u.email);
  }
});

/** A confirmed account with the given role in the default organization (sign-up is invite-only, so invite first). */
async function account(tag, role) {
  const email = `signcraft-e2e-limit-${tag}-${Date.now()}@example.com`;
  assert.ifError((await admin.from("invitations").insert({ email, role })).error);
  const r = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  assert.ifError(r.error);
  made.push({ id: r.data.user.id, email });
  return email;
}
async function signedIn(email) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  return page;
}
const api = (page, method, path, body) =>
  page.evaluate(async ([method, path, body]) => {
    const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, [method, path, body]);
let preset;
const save = async (page, name, id) => api(page, "POST", "/api/signatures", { name, id, doc: preset });
const setLimit = (page, limit) => api(page, "PUT", "/api/admin/signature-limit", { limit });
const count = async (email) => {
  const uid = made.find((m) => m.email === email).id;
  return (await admin.from("signatures").select("id", { count: "exact", head: true }).eq("owner_id", uid)).count;
};
const stored = async () => (await admin.from("platform_settings").select("value").eq("key", KEY).maybeSingle()).data?.value;

test("the 5-signature limit and the admin setting, as real signed-in people", { skip: () => skip, timeout: 300000 }, async (t) => {
  const member = await account("member", "member");
  const boss = await account("admin", "admin");
  const m = await signedIn(member);
  preset = { version: 1, template_id: "classic", theme: { primary: "#111111", text: "#111111" }, blocks: [{ type: "identity", name: "Limit Tester" }] };

  await t.test("a member saves 5, the 6th is refused, and exactly 5 are stored", async () => {
    await admin.from("platform_settings").delete().eq("key", KEY); // start from the default
    const ids = [];
    for (let i = 1; i <= 5; i++) {
      const r = await save(m, `Sig ${i}`);
      assert.equal(r.status, 201, `save ${i}: ${JSON.stringify(r.body)}`);
      ids.push(r.body.id);
    }
    const sixth = await save(m, "Sig 6");
    assert.equal(sixth.status, 429);
    assert.match(sixth.body.message, /limit of 5/);
    assert.equal(await count(member), 5);
    t.ids = ids;
  });

  await t.test("editing an existing signature still works at the limit", async () => {
    const r = await save(m, "Sig 1 renamed", t.ids[0]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await count(member), 5);
  });

  await t.test("deleting one frees one slot", async () => {
    assert.equal((await api(m, "DELETE", `/api/signatures/${t.ids[4]}`)).status, 200);
    assert.equal((await save(m, "Replacement")).status, 201);
    assert.equal((await save(m, "One too many")).status, 429);
  });

  const b = await signedIn(boss);

  await t.test("a member cannot change the limit", async () => {
    const r = await setLimit(m, 50);
    assert.equal(r.status, 403);
    assert.equal(await stored(), undefined);
  });

  await t.test("an admin sets the limit on the Limits page, it is stored in the database, and it persists after a refresh", async () => {
    await b.goto(`${BASE}/admin/limits`, { waitUntil: "networkidle" });
    await b.locator("#sig-limit").fill("3");
    await b.getByRole("button", { name: "Save" }).first().click();
    await b.getByText("Accounts can now keep 3 saved signatures.").waitFor({ timeout: 15000 });
    assert.equal(await stored(), 3, "stored in platform_settings");
    await b.reload({ waitUntil: "networkidle" });
    assert.equal(await b.locator("#sig-limit").inputValue(), "3", "still 3 after a refresh");
    const fresh = await signedIn(boss); // a new session, not just a reload
    await fresh.goto(`${BASE}/admin/limits`, { waitUntil: "networkidle" });
    assert.equal(await fresh.locator("#sig-limit").inputValue(), "3");
    await fresh.context().close();
  });

  await t.test("lowering it below what the member already has: they keep them, can edit, cannot save more", async () => {
    assert.equal(await count(member), 5);
    const over = await save(m, "Over");
    assert.equal(over.status, 429);
    assert.match(over.body.message, /limit of 3/);
    assert.equal((await save(m, "Edited", t.ids[0])).status, 200);
    assert.equal(await count(member), 5);
  });

  await t.test("blank resets to the environment value", async () => {
    await b.locator("#sig-limit").fill("");
    await b.getByRole("button", { name: "Save" }).first().click();
    await b.getByText("Signature limit reset to the environment value.").waitFor({ timeout: 15000 });
    assert.equal(await stored(), undefined);
  });

  await m.context().close();
  await b.context().close();
});
