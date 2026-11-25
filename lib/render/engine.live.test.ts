/**
 * Opt-in smoke test against the REAL browsers. Skipped unless RENDER_LIVE_TEST=1 (needs Chrome, and playwright's webkit and firefox).
 *   RENDER_ENABLED=true RENDER_LIVE_TEST=1 RENDER_LIVE_OUT=some/dir npx vitest run lib/render/engine.live.test.ts
 * With RENDER_LIVE_OUT set it also writes the PNGs there so a person can look at them.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getPreset } from "@/lib/presets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { closeBrowsers, engineStatus, renderMany } from "./engine";
import { RENDER_TARGET_IDS } from "./targets";

const live = process.env.RENDER_LIVE_TEST === "1";

describe.skipIf(!live)("render engines (live)", () => {
  afterAll(() => closeBrowsers());

  it("draws real PNGs in every available engine", async () => {
    process.env.RENDER_ENABLED = "true";
    const status = await engineStatus();
    const ids = process.env.RENDER_LIVE_IDS?.split(",") ?? ["classic", "dark-luxe"];
    const out = process.env.RENDER_LIVE_OUT;
    if (out) fs.mkdirSync(out, { recursive: true });
    for (const id of ids) {
      const html = renderToEmailHtml(getPreset(id)!.doc);
      for (const dark of [false, true]) {
        const r = await renderMany(html, [...RENDER_TARGET_IDS], ["desktop", "phone"], dark);
        expect(r.results.length).toBeGreaterThan(0);
        for (const x of r.results) {
          expect(x.png.subarray(1, 4).toString()).toBe("PNG");
          expect(x.width).toBeGreaterThan(100);
          if (out) fs.writeFileSync(path.join(out, `${id}-${dark ? "dark" : "light"}-${x.target}-${x.viewport}.png`), x.png);
        }
        const missing = Object.entries(status.engines).filter(([, v]) => !v.available).length;
        expect(r.skipped.length).toBeLessThanOrEqual(missing * 2);
      }
    }
  }, 180000);
});
