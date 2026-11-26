// Browser test: Contact block link/social fields in the design inspector, validation, and exported HTML.
//   npm run dev   (http://localhost:3000)   then   node --test e2e/contact-links.e2e.mjs
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
const contactIndex = () => page.$eval("iframe", (f) => [...f.contentDocument.querySelectorAll("[data-block]")].findIndex((e) => /@/.test(e.textContent ?? "") && e.querySelector("a[href^='mailto:']")));
const clickBlock = (i) => page.$eval("iframe", (f, i) => [...f.contentDocument.querySelectorAll("[data-block]")][i].dispatchEvent(new MouseEvent("click", { bubbles: true })), i);

test("contact block shows link + social controls", async () => {
  const i = await contactIndex();
  assert.ok(i >= 0, "classic template has a contact block");
  await clickBlock(i);
  await page.waitForSelector('[data-testid="inspector"]');
  for (const label of ["Website link text (optional)", "Address link (optional)"]) assert.ok(await page.getByLabel(label).isVisible(), label);
  assert.ok(await page.getByText("Social links").isVisible());
});

test("friendly website text, address link and social links reach the preview", async () => {
  await page.getByLabel("Website", { exact: true }).fill("modernhome.co.uk");
  await page.getByLabel("Website link text (optional)").fill("Visit our showroom");
  await page.getByLabel("Address", { exact: true }).fill("Studio 1, London");
  await page.getByLabel("Address link (optional)").fill("https://maps.google.com/?q=studio");
  await page.getByRole("button", { name: "Add link" }).first().click();
  await page.getByLabel("Network").last().selectOption("instagram");
  await page.locator('input[id$="-link-0"]').last().fill("https://instagram.com/modernhome");
  await page.waitForFunction(() => /Visit our showroom/.test(document.querySelector("iframe").contentDocument.body.innerHTML));
  const h = await html();
  assert.match(h, /href="https:\/\/modernhome\.co\.uk\/"[^>]*>Visit our showroom</);
  assert.match(h, /href="https:\/\/maps\.google\.com\/\?q=studio"/);
  assert.match(h, /href="https:\/\/instagram\.com\/modernhome"/);
  assert.match(h, /href="mailto:/);
});

test("a malformed website is rejected with a message", async () => {
  await page.getByLabel("Website", { exact: true }).fill("www.@modernhome.co.uk");
  await page.waitForSelector("text=/valid website/i");
  assert.equal(await page.getByLabel("Website", { exact: true }).getAttribute("aria-invalid"), "true");
});
