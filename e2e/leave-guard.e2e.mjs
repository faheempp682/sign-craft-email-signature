// Browser test for the "leave without saving?" dialog in the editor (new-signature path, which needs no account).
//
//   Run the app WITHOUT Supabase variables, so it is the login-free local editor:
//     NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npx next dev -p 3250
//     E2E_BASE_URL=http://localhost:3250 node --test e2e/leave-guard.e2e.mjs
//
// The saved-signature buttons (Discard changes / Save) need a real account and are covered by leave-guard.test.tsx.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const exe = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean).find((p) => fs.existsSync(p));
const MARK = "airy"; // the edit: Spacing set to "airy" (a theme change counts as an edit like any other)
const FIELD = "#spacing";

let browser;
let skip = false;
before(async () => {
  browser = await chromium.launch({ executablePath: exe, headless: true });
  const res = await fetch(`${BASE}/editor`, { redirect: "manual" }).catch(() => null);
  if (!res) throw new Error(`Nothing is listening on ${BASE}. Start the app first (see the top of this file).`);
  if (res.status !== 200) skip = `${BASE}/editor answered ${res.status}: this server requires sign-in. Run it without Supabase variables.`;
});
after(async () => browser?.close());

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return { ctx, page, problems };
}

const BACK = 'nav a[href="/signatures"], aside a[href="/signatures"]'; // the sidebar link: present in both the Design and Form views
const dialog = (page) => page.getByRole("dialog");
const draftOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("signcraft:draft:v1") ?? "null"));

/** Opens a fresh editor and changes Spacing in the Form view. Returns that field. */
async function edit(page) {
  await page.goto(`${BASE}/editor?t=classic`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Form", exact: true }).click();
  const field = page.locator(FIELD);
  await field.selectOption(MARK);
  return field;
}

test("no edits: leaving goes straight through, no dialog", { skip }, async () => {
  const { ctx, page } = await fresh();
  await page.goto(`${BASE}/editor?t=classic`, { waitUntil: "networkidle" });
  await page.locator('a[aria-label="Back to my signatures"]').click(); // the Design view's back arrow
  await page.waitForURL(/\/signatures/);
  assert.equal(await dialog(page).count(), 0);
  await ctx.close();
});

test("new signature: the dialog offers exactly Cancel and Save as draft", { skip }, async () => {
  const { ctx, page } = await fresh();
  await edit(page);
  await page.locator(BACK).first().click();
  await dialog(page).waitFor();
  const buttons = await dialog(page).getByRole("button").allInnerTexts();
  assert.deepEqual(buttons.map((b) => b.trim()).filter((b) => b !== "✕").sort(), ["Cancel", "Save as draft"]);
  await ctx.close();
});

test("Cancel, X and Esc keep you in the editor with the edit intact", { skip }, async () => {
  const { ctx, page } = await fresh();
  const field = await edit(page);
  for (const close of [
    () => dialog(page).getByRole("button", { name: "Cancel" }).click(),
    () => dialog(page).getByRole("button", { name: "Close" }).click(),
    () => page.keyboard.press("Escape"),
  ]) {
    await page.locator(BACK).first().click();
    await dialog(page).waitFor();
    await close();
    await dialog(page).waitFor({ state: "detached" });
    assert.match(page.url(), /\/editor/);
    assert.equal(await field.inputValue(), MARK);
  }
  await ctx.close();
});

test("Save as draft keeps the work and the Signatures page offers it back", { skip }, async () => {
  const { ctx, page } = await fresh();
  await edit(page);
  await page.locator(BACK).first().click();
  await dialog(page).getByRole("button", { name: "Save as draft" }).click();
  await page.waitForURL(/\/signatures/);
  const draft = await draftOf(page);
  assert.ok(JSON.stringify(draft?.doc).includes(MARK), "the edit is in the stored draft");
  await page.getByRole("heading", { name: "Draft in progress" }).waitFor();
  await ctx.close();
});

test("refresh after editing restores the work", { skip }, async () => {
  const { ctx, page } = await fresh();
  await edit(page);
  await page.waitForTimeout(800); // past the autosave delay
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Form", exact: true }).click();
  assert.equal(await page.locator(FIELD).inputValue(), MARK);
  await ctx.close();
});
