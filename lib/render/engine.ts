import fs from "node:fs";
import { buildRenderDocument } from "./simulate";
import { ByteCache, Gate, QueueFull, hashOf, withTimeout } from "./limits";
import { fetchImage } from "./safe-image";
import { ENGINES, RENDER_TARGETS, VIEWPORTS, type EngineId, type RenderTargetId, type ViewportId } from "./targets";
import type { Change } from "./outlook-word";

/**
 * Server-side render service: draws signature HTML in real browser engines with Playwright and returns PNG images.
 *
 * Needs a long-lived Node server with browsers installed (RENDER_ENABLED=true). It will not run on a serverless host.
 *
 * Safety model, in layers (see docs/rendered-previews.md):
 *  1. The HTML always comes from renderToEmailHtml(doc) on the server, from a zod-validated document, never from the caller.
 *  2. The browser context has JavaScript turned off, service workers blocked and downloads off.
 *  3. A Content-Security-Policy (response header and meta tag) allows only inline styles and https/data images.
 *  4. Every request the browser makes is intercepted. The page itself is served from memory. Images are fetched by
 *     safe-image.ts (public https hosts only, pinned DNS, size and time limits) and handed to the browser. Everything else is aborted.
 *  5. Hard timeout per render, concurrency cap with a bounded queue, and a content-hash cache.
 */

export const DOC_URL = "http://signcraft-render.invalid/signature.html";

export function renderEnabled(): boolean {
  return process.env.RENDER_ENABLED === "true";
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const TIMEOUT_MS = () => num(process.env.RENDER_TIMEOUT_MS, 15000);

/* ---------- playwright loading ---------- */

type PwBrowser = { newContext: (o: Record<string, unknown>) => Promise<PwContext>; close: () => Promise<void>; on: (e: string, f: () => void) => void; isConnected: () => boolean; version: () => string };
type PwContext = {
  route: (p: string, h: (r: PwRoute) => Promise<void>) => Promise<void>;
  newPage: () => Promise<PwPage>;
  close: () => Promise<void>;
};
type PwRoute = {
  request: () => { url: () => string; resourceType: () => string };
  fulfill: (o: { status?: number; contentType?: string; headers?: Record<string, string>; body?: Buffer | string }) => Promise<void>;
  abort: (c?: string) => Promise<void>;
};
type PwPage = { goto: (u: string, o?: Record<string, unknown>) => Promise<unknown>; screenshot: (o: Record<string, unknown>) => Promise<Buffer> };
type PwType = { launch: (o: Record<string, unknown>) => Promise<PwBrowser>; executablePath: () => string };
type Pw = { chromium: PwType; webkit: PwType; firefox: PwType };

let pwPromise: Promise<Pw> | null = null;
function loadPlaywright(): Promise<Pw> {
  // Loaded at run time and kept out of the bundle, so builds work (and the module can be absent) where the service is off.
  pwPromise ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "playwright-core" as string) as Promise<Pw>;
  return pwPromise;
}

const CHROME_CANDIDATES = [
  process.env.RENDER_CHROME_PATH,
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((x): x is string => !!x);

export type EngineStatus = { available: boolean; reason?: string; version?: string };

async function executableFor(engine: EngineId): Promise<{ path?: string; reason?: string }> {
  try {
    if (engine === "chromium") {
      const own = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
      if (own) return { path: own };
    }
    const pw = await loadPlaywright();
    const p = pw[engine].executablePath();
    if (p && fs.existsSync(p)) return engine === "chromium" ? {} : { path: p };
    return {
      reason: engine === "chromium" ? "No Chrome or Chromium found. Install Chrome or set RENDER_CHROME_PATH." : `The ${engine} browser is not installed. Run: npx playwright-core install ${engine}`,
    };
  } catch (e) {
    return { reason: `playwright-core could not be loaded: ${(e as Error).message}` };
  }
}

/* ---------- browsers (one per engine, reused) ---------- */

const browsers = new Map<EngineId, Promise<PwBrowser>>();

async function getBrowser(engine: EngineId): Promise<PwBrowser> {
  let b = browsers.get(engine);
  if (!b) {
    b = (async () => {
      const pw = await loadPlaywright();
      const exe = await executableFor(engine);
      if (exe.reason) throw new Error(exe.reason);
      const args = engine === "chromium" ? ["--disable-gpu", ...(process.env.RENDER_NO_SANDBOX === "true" ? ["--no-sandbox"] : [])] : [];
      const br = await withTimeout(pw[engine].launch({ headless: true, executablePath: exe.path, args }), 30000, `${engine} launch`);
      br.on("disconnected", () => browsers.delete(engine));
      return br;
    })();
    browsers.set(engine, b);
    b.catch(() => browsers.delete(engine));
  }
  return b;
}

export async function closeBrowsers() {
  const all = [...browsers.values()];
  browsers.clear();
  await Promise.all(all.map((p) => p.then((b) => b.close()).catch(() => {})));
}

export async function engineStatus(): Promise<{ enabled: boolean; engines: Record<EngineId, EngineStatus> }> {
  const engines = {} as Record<EngineId, EngineStatus>;
  for (const e of ENGINES) {
    if (!renderEnabled()) {
      engines[e] = { available: false, reason: "Rendering is switched off (RENDER_ENABLED is not true)." };
      continue;
    }
    const x = await executableFor(e);
    engines[e] = x.reason ? { available: false, reason: x.reason } : { available: true };
  }
  return { enabled: renderEnabled(), engines };
}

/* ---------- limits and caches ---------- */

const gate = new Gate(num(process.env.RENDER_CONCURRENCY, 2), num(process.env.RENDER_QUEUE, 12));
const results = new ByteCache<{ bytes: number; png: Buffer; width: number; height: number; changes: Change[] }>(64 * 1024 * 1024, 10 * 60 * 1000);
const images = new ByteCache<{ bytes: number; body: Buffer; contentType: string }>(20 * 1024 * 1024, 5 * 60 * 1000);
export const _caches = { results, images };

/* ---------- one render ---------- */

export type RenderResult = {
  target: RenderTargetId;
  viewport: ViewportId;
  engine: EngineId;
  kind: "real" | "simulation";
  label: string;
  width: number;
  height: number;
  png: Buffer;
  cached: boolean;
  /** What the simulation changed (empty for real engines). Used for the known-differences report. */
  changes: Change[];
};

export function pngSize(png: Buffer): { width: number; height: number } {
  // PNG signature (8 bytes) + IHDR chunk: width and height are the first two big-endian uint32 of the chunk data at offset 16.
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) return { width: 0, height: 0 };
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function drawPage(engine: EngineId, doc: string, viewport: ViewportId, dark: boolean): Promise<Buffer> {
  const vp = VIEWPORTS[viewport];
  const browser = await getBrowser(engine);
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: 100 }, // tiny on purpose: the full-page screenshot then fits the content instead of padding to a window height
    deviceScaleFactor: vp.scale,
    javaScriptEnabled: false,
    serviceWorkers: "block",
    acceptDownloads: false,
    colorScheme: dark ? "dark" : "light",
  });
  try {
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      try {
        if (url === DOC_URL) {
          return await route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            headers: { "content-security-policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'", "x-content-type-options": "nosniff" },
            body: doc,
          });
        }
        if (req.resourceType() === "image" && url.startsWith("https://")) {
          let img = images.get(url);
          if (!img) {
            const r = await fetchImage(url);
            if (!r.ok) return await route.abort("blockedbyclient");
            img = { bytes: r.body.length, body: r.body, contentType: r.contentType };
            images.set(url, img);
          }
          return await route.fulfill({ status: 200, contentType: img.contentType, body: img.body });
        }
        return await route.abort("blockedbyclient"); // scripts, fonts, frames, http:, ws:, everything else
      } catch {
        await route.abort("failed").catch(() => {});
      }
    });
    const page = await ctx.newPage();
    await page.goto(DOC_URL, { waitUntil: "load", timeout: TIMEOUT_MS() });
    return await page.screenshot({ fullPage: true, type: "png", timeout: TIMEOUT_MS() });
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function renderOne(html: string, target: RenderTargetId, viewport: ViewportId, dark: boolean): Promise<RenderResult> {
  const t = RENDER_TARGETS[target];
  const { doc, changes } = buildRenderDocument(html, t, viewport, dark);
  const key = hashOf(doc, t.engine, viewport, String(dark));
  const hit = results.get(key);
  const base = { target, viewport, engine: t.engine, kind: t.kind, label: t.label };
  if (hit) return { ...base, width: hit.width, height: hit.height, png: hit.png, cached: true, changes: hit.changes };
  const png = await gate.run(() => withTimeout(drawPage(t.engine, doc, viewport, dark), TIMEOUT_MS() + 5000, `${target} render`));
  const { width, height } = pngSize(png);
  results.set(key, { bytes: png.length, png, width, height, changes });
  return { ...base, width, height, png, cached: false, changes };
}

export type RenderSkip = { target: RenderTargetId; reason: string };

/** Renders every requested target and viewport. Targets whose engine is missing are skipped with a reason, not failed. */
export async function renderMany(html: string, targets: RenderTargetId[], viewports: ViewportId[], dark: boolean): Promise<{ results: RenderResult[]; skipped: RenderSkip[] }> {
  const status = await engineStatus();
  const skipped: RenderSkip[] = [];
  const runnable = targets.filter((t) => {
    const st = status.engines[RENDER_TARGETS[t].engine];
    if (!st.available) skipped.push({ target: t, reason: st.reason ?? "Engine not available." });
    return st.available;
  });
  const jobs = runnable.flatMap((t) => viewports.map((v) => ({ t, v })));
  const settled = await Promise.allSettled(jobs.map((j) => renderOne(html, j.t, j.v, dark)));
  const out: RenderResult[] = [];
  const failed = new Set<RenderTargetId>();
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") out.push(s.value);
    else {
      if (s.reason instanceof QueueFull) throw s.reason;
      if (!failed.has(jobs[i].t)) {
        failed.add(jobs[i].t);
        skipped.push({ target: jobs[i].t, reason: /timed out/.test(String(s.reason?.message)) ? "The render timed out." : "The render failed." });
      }
    }
  });
  return { results: out, skipped };
}
