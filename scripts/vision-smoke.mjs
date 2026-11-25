// Live smoke test for screenshot-to-signature. Needs a real model, so it is NOT part of `npm test`.
//
//   1. npm run client-pack                      (renders sample signatures to client-pack/index.html)
//   2. ANTHROPIC_API_KEY=... in .env.local, and leave Supabase UNSET so the route runs in local mode
//      (or sign in and adapt this script to send your session cookie), then `npm run dev`
//   3. npm run vision:smoke
//
// For each of the first N signatures it takes a screenshot, sends it to /api/ai/vision, and prints what came back.
// Screenshots and the rebuilt documents are written to vision-smoke/ so you can compare them by eye
// (open a .json by pasting it into the editor's draft, or just read the summary).
// Env: E2E_BASE_URL (default http://localhost:3000), CHROME_PATH, VISION_SMOKE_COUNT (default 5), VISION_SMOKE_NOTE.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const COUNT = Number(process.env.VISION_SMOKE_COUNT ?? 5);
const OUT = "vision-smoke";
const PACK = path.resolve("client-pack", "index.html");
const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const exe = CANDIDATES.find((p) => fs.existsSync(p));
if (!exe) throw new Error("No Chrome/Edge found. Set CHROME_PATH.");
if (!fs.existsSync(PACK)) throw new Error("client-pack/index.html is missing. Run `npm run client-pack` first.");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--disable-gpu"] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 })).newPage();
await page.goto(pathToFileURL(PACK).href);
const cases = await page.$$eval(".case", (els) => els.map((e) => ({ key: e.id, title: e.querySelector("h2")?.textContent ?? e.id })));

let failures = 0;
for (const c of cases.slice(0, COUNT)) {
  const file = path.join(OUT, `${c.key}.png`);
  await (await page.$(`#sig-${c.key}`)).screenshot({ path: file, animations: "disabled" });

  const form = new FormData();
  form.set("file", new Blob([fs.readFileSync(file)], { type: "image/png" }), `${c.key}.png`);
  if (process.env.VISION_SMOKE_NOTE) form.set("note", process.env.VISION_SMOKE_NOTE);

  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${BASE}/api/ai/vision`, { method: "POST", body: form });
  } catch (e) {
    console.log(`\n${c.title}\n  could not reach ${BASE}: ${e.message}`);
    failures++;
    continue;
  }
  const body = await res.json().catch(() => ({}));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${c.title}  [${res.status}, ${secs}s${body.cached ? ", cached" : ""}]`);
  if (!res.ok || !body.doc) {
    console.log(`  ${body.error ?? "error"}: ${body.message ?? "no message"}`);
    failures++;
    continue;
  }
  fs.writeFileSync(path.join(OUT, `${c.key}.json`), JSON.stringify(body.doc, null, 2));
  const id = body.doc.blocks.find((b) => b.type === "identity");
  console.log(`  layout: ${body.doc.template_id} | font: ${body.doc.theme.font} | accent: ${body.doc.theme.primary}`);
  console.log(`  blocks: ${body.doc.blocks.map((b) => b.type).join(", ")}`);
  console.log(`  identity: ${id ? [id.name, id.title, id.company].filter(Boolean).join(" / ") : "(none)"}`);
  console.log(`  reply: ${body.reply}`);
}
await browser.close();
console.log(`\nDone. ${Math.min(COUNT, cases.length) - failures} of ${Math.min(COUNT, cases.length)} rebuilt. Files are in ${OUT}/.`);
process.exit(failures ? 1 : 0);
