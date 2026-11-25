// Renders every template (121) in every available browser engine and viewport and writes a contact sheet.
//
//   node scripts/render-matrix.mjs                    # all templates, desktop + phone, light, offline placeholders for images
//   node scripts/render-matrix.mjs --ids=classic,studio-003 --dark --online
//
// Flags: --ids=a,b  --dark (also render dark mode)  --online (fetch the real images instead of grey placeholders)
//        --skip-generate (reuse render-matrix/_pages)  --out=dir (default render-matrix)  --jobs=N (parallel pages per engine, default 3)
//
// Output (git-ignored): render-matrix/index.html (contact sheet), report.json (templates that render very differently across
// engines), img/<template>/<target>-<viewport>.png, _pages/*.html, manifest.json.
//
// Engines: system Chrome (or CHROME_PATH) for Chromium, and Playwright's WebKit and Firefox when installed
// (`npx playwright-core install webkit firefox`). A missing engine is skipped and listed in the report, never fatal.
// Works offline: the signature pages are generated locally, and images are replaced by grey placeholders unless --online.
//
// "real" columns are the unmodified HTML in a real engine. "simulation" columns are Chromium drawing rewritten HTML (see
// lib/render/outlook-word.ts and gmail-sanitize.ts). Simulations are never compared against real engines as if they were real.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, firefox, webkit } from "playwright-core";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const OUT = path.resolve(opt("out", "render-matrix"));
const ONLINE = flag("online");
const JOBS = Math.max(1, Number(opt("jobs", "3")) || 3);

if (!flag("skip-generate")) {
  const r = spawnSync("npx", ["vitest", "run", "scripts/render-matrix.test.ts"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, RENDER_MATRIX_DIR: OUT, RENDER_MATRIX_IDS: opt("ids", ""), RENDER_MATRIX_DARK: flag("dark") ? "1" : "" },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));

/* ---------- engines ---------- */
const CHROME = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean).find((p) => fs.existsSync(p));
const engines = {};
const skippedEngines = {};
async function tryLaunch(name, type, opts) {
  try {
    const browser = await type.launch({ headless: true, ...opts });
    engines[name] = browser;
  } catch (e) {
    skippedEngines[name] = String(e.message).split("\n")[0];
  }
}
await tryLaunch("chromium", chromium, CHROME ? { executablePath: CHROME, args: ["--disable-gpu"] } : { args: ["--disable-gpu"] });
await tryLaunch("webkit", webkit, {});
await tryLaunch("firefox", firefox, {});
console.log("engines:", Object.keys(engines).join(", ") || "none", Object.keys(skippedEngines).length ? `(skipped: ${JSON.stringify(skippedEngines)})` : "");
if (!Object.keys(engines).length) {
  console.error("No browser engine could be launched. Install Chrome or run: npx playwright-core install chromium");
  process.exit(1);
}

/* ---------- images ---------- */
const PLACEHOLDER = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#dcdcdc"/><text x="50%" y="50%" fill="#8a8a8a" font-family="Arial" font-size="${Math.max(9, Math.min(w, h) / 6)}" text-anchor="middle" dominant-baseline="middle">${w}x${h}</text></svg>`;
const imgCache = new Map();
async function fulfillImage(route) {
  const url = route.request().url();
  if (ONLINE && url.startsWith("https://")) {
    try {
      if (!imgCache.has(url)) {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        imgCache.set(url, { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "image/png" });
      }
      return route.fulfill(imgCache.get(url));
    } catch {
      /* fall through to the placeholder */
    }
  }
  const m = /(\d{2,4})x(\d{2,4})/.exec(url);
  return route.fulfill({ contentType: "image/svg+xml", body: PLACEHOLDER(m ? +m[1] : 120, m ? +m[2] : 120) });
}

/* ---------- measuring ---------- */
const measure = () => {
  const wrap = document.body.firstElementChild;
  const sig = wrap?.firstElementChild;
  const r = sig ? sig.getBoundingClientRect() : { width: 0, height: 0 };
  const clipped = [];
  for (const el of document.body.querySelectorAll("td,div,span,a,p")) {
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && ["hidden", "clip"].includes(getComputedStyle(el).overflowX)) clipped.push(el.tagName);
  }
  // Words that the layout broke across lines in the middle (e.g. "Han" / "a" in a narrow column): the classic sign of text being squeezed.
  const brokenWords = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? "";
    for (const m of text.matchAll(/[^\s ]{4,}/g)) {
      const range = document.createRange();
      range.setStart(n, m.index);
      range.setEnd(n, m.index + m[0].length);
      const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top / 3)));
      if (tops.size > 1) brokenWords.push(m[0]);
    }
  }
  const imgs = [...document.images];
  return {
    brokenWords: brokenWords.slice(0, 5),
    brokenWordCount: brokenWords.length,
    w: Math.round(r.width),
    h: Math.round(r.height),
    docW: document.documentElement.scrollWidth,
    docH: document.documentElement.scrollHeight,
    viewportW: window.innerWidth,
    clipped: clipped.length,
    brokenImages: imgs.filter((i) => !i.complete || i.naturalWidth === 0).length,
  };
};

async function renderEntry(entry) {
  const browser = engines[entry.engine];
  if (!browser) return null;
  const vp = entry.viewport === "phone" ? { width: 375, scale: 2 } : { width: 680, scale: 1 };
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: 100 }, deviceScaleFactor: vp.scale, colorScheme: entry.dark ? "dark" : "light", serviceWorkers: "block" });
  try {
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      if (req.url().startsWith("file://")) return route.continue();
      if (req.resourceType() === "image") return fulfillImage(route);
      return route.abort("blockedbyclient");
    });
    const page = await ctx.newPage();
    await page.goto("file:///" + path.join(OUT, entry.file).replace(/\\/g, "/"), { waitUntil: "load", timeout: 20000 });
    const metrics = await page.evaluate(measure);
    const rel = `img/${entry.id}/${entry.target}-${entry.viewport}${entry.dark ? "-dark" : ""}.png`;
    fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
    await page.screenshot({ path: path.join(OUT, rel), fullPage: true, type: "png" });
    return { ...entry, img: rel, metrics };
  } catch (e) {
    return { ...entry, error: String(e.message).split("\n")[0] };
  } finally {
    await ctx.close().catch(() => {});
  }
}

const todo = manifest.filter((e) => engines[e.engine]);
const results = [];
let done = 0;
// Per engine, JOBS pages at a time; engines run side by side.
await Promise.all(
  Object.keys(engines).map(async (eng) => {
    const queue = todo.filter((e) => e.engine === eng);
    await Promise.all(
      Array.from({ length: JOBS }, async () => {
        for (let e = queue.shift(); e; e = queue.shift()) {
          results.push(await renderEntry(e));
          if (++done % 50 === 0) console.log(`${done}/${todo.length}`);
        }
      }),
    );
  }),
);
await Promise.all(Object.values(engines).map((b) => b.close()));

/* ---------- compare real engines ---------- */
const key = (r) => `${r.id}|${r.viewport}|${r.dark}`;
const groups = new Map();
for (const r of results) {
  if (!r || r.error) continue;
  if (!groups.has(key(r))) groups.set(key(r), []);
  groups.get(key(r)).push(r);
}
const problems = [];
for (const rs of groups.values()) {
  const real = rs.filter((r) => r.kind === "real");
  const issues = [];
  if (real.length >= 2) {
    const hs = real.map((r) => r.metrics.h), ws = real.map((r) => r.metrics.w);
    const hRatio = Math.max(...hs) / Math.max(1, Math.min(...hs));
    if (hRatio > 1.1) issues.push(`height differs ${((hRatio - 1) * 100).toFixed(0)}% between real engines (${real.map((r) => `${r.engine} ${r.metrics.h}px`).join(", ")})`);
    if (Math.max(...ws) - Math.min(...ws) > 12) issues.push(`width differs by ${Math.max(...ws) - Math.min(...ws)}px between real engines (${real.map((r) => `${r.engine} ${r.metrics.w}px`).join(", ")})`);
  }
  for (const r of real) {
    if (r.viewport === "desktop" && r.metrics.docW > r.metrics.viewportW + 1) issues.push(`${r.engine}: content wider than the ${r.metrics.viewportW}px pane (${r.metrics.docW}px), so it scrolls sideways`);
    if (r.metrics.clipped) issues.push(`${r.engine}: ${r.metrics.clipped} element(s) clip their text`);
    if (r.metrics.brokenWordCount) issues.push(`${r.engine}: ${r.metrics.brokenWordCount} word(s) broken across lines mid-word (${r.metrics.brokenWords.join(", ")})`);
    if (r.metrics.h < 20) issues.push(`${r.engine}: rendered almost empty (${r.metrics.h}px high)`);
  }
  const chrome = real.find((r) => r.engine === "chromium");
  for (const s of rs.filter((r) => r.kind === "simulation")) {
    if (chrome && Math.abs(s.metrics.h - chrome.metrics.h) / Math.max(1, chrome.metrics.h) > 0.25) issues.push(`SIMULATION ${s.target}: height ${s.metrics.h}px vs ${chrome.metrics.h}px in plain Chromium (layout shifts a lot under those rules)`);
  }
  if (issues.length) problems.push({ id: rs[0].id, name: rs[0].name, viewport: rs[0].viewport, dark: rs[0].dark, issues });
}
const errors = results.filter((r) => r?.error).map((r) => ({ file: r.file, error: r.error }));
const report = {
  generated: new Date().toISOString(),
  engines: Object.keys(engines),
  skippedEngines,
  online: ONLINE,
  templates: new Set(manifest.map((m) => m.id)).size,
  renders: results.filter((r) => r && !r.error).length,
  note: "Heuristic: compares measured size of the signature between REAL engines, flags sideways scrolling, clipped text and near-empty renders. Simulations are only compared to Chromium for large layout shifts. A flagged template is a prompt to look at the contact sheet, not proof of a bug.",
  problems,
  errors,
};
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

/* ---------- contact sheet ---------- */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const targets = [...new Set(manifest.map((m) => m.target))].filter((t) => engines[manifest.find((m) => m.target === t).engine]);
const meta = Object.fromEntries(manifest.map((m) => [m.target, m]));
const ids = [...new Set(manifest.map((m) => m.id))];
const flagged = new Set(problems.map((p) => p.id));
const rows = ids
  .map((id) => {
    const name = manifest.find((m) => m.id === id).name;
    const cells = targets
      .map((t) => {
        const cs = results.filter((r) => r && r.id === id && r.target === t && !r.error).sort((a, b) => a.viewport.localeCompare(b.viewport));
        return `<td>${cs.map((c) => `<a href="${esc(c.img)}"><img loading="lazy" src="${esc(c.img)}" alt="${esc(`${name}, ${t}, ${c.viewport}`)}" class="${c.viewport}"></a>`).join("") || "<em>not rendered</em>"}</td>`;
      })
      .join("");
    return `<tr class="${flagged.has(id) ? "flag" : ""}"><th scope="row">${esc(name)}<br><small>${esc(id)}</small>${flagged.has(id) ? "<br><b>differs</b>" : ""}</th>${cells}</tr>`;
  })
  .join("\n");
const heads = targets.map((t) => `<th scope="col">${esc(t)}<br><small class="${meta[t].kind}">${meta[t].kind === "real" ? "Real engine" : "Simulation"}</small></th>`).join("");
fs.writeFileSync(
  path.join(OUT, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Render matrix</title>
<style>:root{color-scheme:light dark;--bg:#f7f7f6;--ink:#111;--line:#d8d8d4;--mut:#555}@media(prefers-color-scheme:dark){:root{--bg:#0d0d0d;--ink:#f5f5f4;--line:#333;--mut:#aaa}}
body{font:14px system-ui,sans-serif;margin:16px;background:var(--bg);color:var(--ink)}table{border-collapse:collapse}th,td{border:1px solid var(--line);padding:6px;vertical-align:top;text-align:left}thead th{position:sticky;top:0;background:var(--bg)}
img{display:block;max-width:300px;height:auto;background:#fff;margin-bottom:6px}img.phone{max-width:150px}tr.flag th{outline:2px solid #c2410c;outline-offset:-2px}small{color:var(--mut)}small.simulation{border:1px dashed;padding:0 4px;border-radius:8px}small.real{border:1px solid;padding:0 4px;border-radius:8px}</style>
<h1>Render matrix</h1><p>${report.templates} templates, engines: ${esc(report.engines.join(", "))}${Object.keys(skippedEngines).length ? `. Not available: ${esc(Object.keys(skippedEngines).join(", "))}` : ""}. ${problems.length} flagged (see report.json). Images are ${ONLINE ? "the real remote images" : "grey placeholders (offline mode)"}. Simulation columns are not the real clients.</p>
<table><thead><tr><th scope="col">Template</th>${heads}</tr></thead><tbody>${rows}</tbody></table>`,
);
console.log(`Done. ${report.renders} renders, ${problems.length} flagged, ${errors.length} errors.\nOpen ${path.join(OUT, "index.html")}\nReport: ${path.join(OUT, "report.json")}`);
