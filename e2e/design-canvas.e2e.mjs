// Browser test for the design editor: select on canvas, edit style, undo/redo, resize, duplicate, hide, layers.
//   npm run dev   (http://localhost:3000)   then   node --test e2e/design-canvas.e2e.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const exe = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean).find((p) => fs.existsSync(p));
let browser, page;
before(async () => {
  browser = await chromium.launch({ executablePath: exe, headless: true });
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${BASE}/editor?t=classic`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="design-canvas"]', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.querySelector("[data-block]"), null, { timeout: 15000 });
});
after(async () => browser?.close());

const html = () => page.$eval("iframe", (f) => f.contentDocument.body.innerHTML);
const clickBlock = (i) => page.$eval("iframe", (f, i) => { const els = [...f.contentDocument.querySelectorAll("[data-block]")]; els[i].dispatchEvent(new MouseEvent("click", { bubbles: true })); }, i);

test("selecting on canvas shows the inspector, layers stay in sync", async () => {
  assert.ok(await page.isVisible('[data-testid="inspector-empty"]'));
  await clickBlock(0);
  await page.waitForSelector('[data-testid="inspector"]');
  assert.ok(await page.isVisible('[data-testid="selection"]'));
  assert.equal(await page.locator('[data-layer][aria-current="true"]').count(), 1);
});

test("style edit updates the preview, undo and redo restore it", async () => {
  await clickBlock(0);
  const before = await html();
  await page.locator('input[aria-label="Text color"]').fill("#ff0000");
  await page.waitForFunction(() => /color:\s*(#ff0000|rgb\(255, 0, 0\))/i.test(document.querySelector("iframe").contentDocument.body.innerHTML));
  await page.click('button[aria-label="Undo"]');
  await page.waitForFunction((b) => document.querySelector("iframe").contentDocument.body.innerHTML === b, before);
  await page.click('button[aria-label="Redo"]');
  await page.waitForFunction(() => /color:\s*(#ff0000|rgb\(255, 0, 0\))/i.test(document.querySelector("iframe").contentDocument.body.innerHTML));
});

test("gradient is shown as design-only with a solid export fallback", async () => {
  await clickBlock(0);
  await page.getByLabel("Gradient background").check();
  assert.ok(await page.isVisible('[data-support="none"]'));
});

test("duplicate, hide and delete via layers", async () => {
  const count = () => page.locator("[data-layer]").count();
  const n = await count();
  await page.click('button[aria-label="Duplicate"]');
  assert.equal(await count(), n + 1);
  await page.keyboard.press("Escape");
  await page.locator('[data-layer] button[aria-label^="Hide"]').first().click();
  assert.equal(await page.locator('[data-layer] button[aria-pressed="true"][aria-label^="Show"]').count(), 1);
  await page.click('button[aria-label="Undo"]');
  await page.click('button[aria-label="Undo"]');
});

test("zoom controls work", async () => {
  await page.click('button[aria-label="Zoom in"]');
  assert.equal(await page.textContent('[data-testid="zoom-value"]'), "135%");
  await page.click('button[aria-label="Reset zoom to 100%"]');
  assert.equal(await page.textContent('[data-testid="zoom-value"]'), "100%");
});

const rightClickBlock = (i) => page.$eval("iframe", (f, i) => { const els = [...f.contentDocument.querySelectorAll("[data-block]")]; els[i].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 30 })); }, i);

test("right-click menu: duplicate, move, delete, and Escape closes it", async () => {
  const count = () => page.locator("[data-layer]").count();
  const n = await count();
  await rightClickBlock(1);
  await page.waitForSelector('[data-testid="context-menu"]');
  assert.ok(await page.getByRole("menuitem", { name: "Duplicate" }).isVisible());
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  assert.equal(await count(), n + 1);
  await rightClickBlock(1);
  await page.getByRole("menuitem", { name: "Delete" }).click();
  assert.equal(await count(), n);
  await rightClickBlock(0);
  await page.waitForSelector('[data-testid="context-menu"]');
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="context-menu"]', { state: "detached" });
});

test("right-click on empty canvas offers paste and add element", async () => {
  await page.locator('[data-testid="design-canvas"]').click({ button: "right", position: { x: 6, y: 6 } });
  await page.waitForSelector('[data-testid="context-menu"]');
  assert.ok(await page.getByRole("menuitem", { name: "Select all" }).isVisible());
  await page.getByRole("menuitem", { name: "Button / CTA" }).click();
  assert.ok(await page.locator("[data-layer]", { hasText: "Button / CTA" }).count());
});

test("mobile: bottom action bar appears for a selected element", async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(300);
  await page.getByRole("tab", { name: "Canvas" }).first().click();
  await clickBlock(0);
  await page.waitForSelector('[data-testid="mobile-bar"]');
  const before = await html();
  await page.click('[data-testid="mobile-bar"] button:has-text("Larger")');
  await page.waitForFunction((b) => document.querySelector("iframe").contentDocument.body.innerHTML !== b, before);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("keyboard shortcuts work right after clicking a block in the preview", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const count = () => page.locator("[data-layer]").count();
  await clickBlock(0);
  const n = await count();
  await page.keyboard.press("Control+d");
  await page.waitForFunction((n) => document.querySelectorAll("[data-layer]").length === n + 1, n);
  await page.keyboard.press("Delete");
  await page.waitForFunction((n) => document.querySelectorAll("[data-layer]").length === n, n);
  await page.keyboard.press("Control+z");
  await page.waitForFunction((n) => document.querySelectorAll("[data-layer]").length === n + 1, n);
});
