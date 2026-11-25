// Browser regression check: no template may split an ordinary word across lines, and extreme text must not make
// signatures overflow their frame in more templates than the recorded baseline.
//
//   npm run wrap-check        (generates the pages with vitest, then runs this)
//
// Env: CHROME_PATH (default: auto-detect Chrome/Edge), WRAP_CHECK_DIR (default wrap-check/).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const DIR = path.resolve(process.env.WRAP_CHECK_DIR ?? "wrap-check");
const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

/**
 * Templates that are wider than the 760px test frame or otherwise known to overflow under extreme text. This is a
 * ceiling, not a target: lower it when templates are fixed, and never raise it without a reason.
 */
const EXTREME_OVERFLOW_CEILING = 24;

let browser;
let page;

before(async () => {
  const exe = CANDIDATES.find((p) => fs.existsSync(p));
  assert.ok(exe, "No Chrome/Edge found. Set CHROME_PATH.");
  assert.ok(fs.existsSync(path.join(DIR, "normal.html")), `Run \`npm run wrap-check\` (or generate the pages first): ${DIR}/normal.html is missing.`);
  browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--disable-gpu"] });
  page = await (await browser.newContext({ viewport: { width: 820, height: 800 } })).newPage();
});
after(async () => browser?.close());

const measure = () =>
  page.evaluate(() => {
    const out = [];
    for (const cell of document.querySelectorAll(".cell")) {
      const split = new Set();
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        for (const m of (n.textContent ?? "").matchAll(/\S+/g)) {
          if (m[0].length < 4) continue;
          const r = document.createRange();
          r.setStart(n, m.index);
          r.setEnd(n, m.index + m[0].length);
          if (new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size > 1) split.add(m[0]);
        }
      }
      out.push({ id: cell.getAttribute("data-id"), overflow: cell.scrollWidth > cell.clientWidth + 1, split: [...split] });
    }
    return out;
  });

test("ordinary text: no template breaks a word across lines", async () => {
  await page.goto(pathToFileURL(path.join(DIR, "normal.html")).href);
  const bad = (await measure()).filter((r) => r.split.length).map((r) => `${r.id}: ${r.split.join(", ")}`);
  assert.deepEqual(bad, [], `Words split across lines:\n${bad.join("\n")}`);
});

test("ordinary text: no template is wider than the 760px frame", async () => {
  await page.goto(pathToFileURL(path.join(DIR, "normal.html")).href);
  const wide = (await measure()).filter((r) => r.overflow).map((r) => r.id);
  assert.deepEqual(wide, [], `Overflowing the frame at ordinary text: ${wide.join(", ")}`);
});

test(`extreme text: at most ${EXTREME_OVERFLOW_CEILING} templates overflow the frame`, async () => {
  await page.goto(pathToFileURL(path.join(DIR, "extreme.html")).href);
  const over = (await measure()).filter((r) => r.overflow).map((r) => r.id);
  assert.ok(over.length <= EXTREME_OVERFLOW_CEILING, `${over.length} templates overflow (ceiling ${EXTREME_OVERFLOW_CEILING}): ${over.join(", ")}`);
});
