// Browser regression test for click-to-edit in the editor preview.
//
// For every template in the library it checks that each block shown in the editor's block list is clickable in the live
// preview, and that clicking it selects it. This is the behaviour that broke when layouts stacked several blocks in one
// table cell, and jsdom can't cover it, so it runs in a real browser.
//
//   npm run dev                       # in one terminal (default http://localhost:3000)
//   npm run test:e2e                  # in another
//
// Env: E2E_BASE_URL (default http://localhost:3000), CHROME_PATH (default: auto-detect an installed Chrome/Edge).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

// Templates whose layout deliberately does not render a block type, so it can't be clicked.
const NOT_RENDERED = { minimal: ["Divider"] };

let browser;
let ids = [];

before(async () => {
  const exe = CANDIDATES.find((p) => fs.existsSync(p));
  assert.ok(exe, "No Chrome/Edge found. Set CHROME_PATH.");
  browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--disable-gpu"] });
  const page = await browser.newPage();
  // The dev server may still be compiling or hot-reloading, so retry the setup read instead of failing on a navigation.
  let engines = [];
  for (let attempt = 0; attempt < 5 && !engines.length; attempt++) {
    const res = await page.goto(`${BASE}/editor?t=classic`, { waitUntil: "load" }).catch(() => null);
    assert.ok(attempt < 4 || res?.ok(), `Dev server not reachable at ${BASE}. Start it with "npm run dev" or set E2E_BASE_URL.`);
    engines = await page
      .waitForSelector("select#tpl option", { state: "attached", timeout: 20000 })
      .then(() => page.$$eval("select#tpl option", (os) => os.map((o) => o.value)))
      .catch(() => []);
  }
  // Hand-built layouts come from the template <select>; studio designs are studio-001 .. studio-100.
  ids = [...engines.filter((v) => v !== "studio"), ...Array.from({ length: 100 }, (_, i) => `studio-${String(i + 1).padStart(3, "0")}`)];
  await page.close();
});

after(async () => {
  await browser?.close();
});

test("every template: all blocks are clickable in the preview and selectable", async () => {
  assert.ok(ids.length >= 121, `expected 121 templates, found ${ids.length}`);
  const failures = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  for (const id of ids) {
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/editor?t=${id}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.querySelector("table"), null, { timeout: 20000 });
      await page.waitForFunction(() => document.querySelector("iframe").contentDocument.querySelector("[data-block]"), null, { timeout: 5000 }).catch(() => {});

      const blocks = await page.$$eval("button", (bs) => bs.map((b) => b.getAttribute("aria-label") || "").filter((l) => l.startsWith("Remove ")).map((l) => l.slice(7)));
      const expected = blocks.filter((l) => !(NOT_RENDERED[id] ?? []).includes(l));
      const mapped = await page.$eval("iframe", (f) => [...new Set([...f.contentDocument.querySelectorAll("[data-block]")].map((e) => e.getAttribute("data-block")))]);
      if (mapped.length < expected.length) failures.push(`${id}: ${mapped.length}/${expected.length} blocks are clickable`);

      // Clicking each mapped block must select it.
      for (const blockId of mapped) {
        await page.$eval("iframe", (f, b) => f.contentDocument.querySelector(`[data-block="${b}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true })), blockId);
        await page.waitForFunction((b) => document.querySelector("iframe").contentDocument.querySelector(`[data-selected]`)?.getAttribute("data-block") === b, blockId, { timeout: 3000 }).catch(() => failures.push(`${id}: clicking ${blockId} did not select it`));
      }
    } catch (e) {
      failures.push(`${id}: ${String(e.message).split("\n")[0]}`);
    }
    await page.close();
  }
  await ctx.close();
  assert.deepEqual(failures, [], `click-to-edit failures:\n${failures.join("\n")}`);
});
