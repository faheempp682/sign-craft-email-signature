/**
 * Step 1 of scripts/render-matrix.mjs: writes the exact HTML pages the render service would draw, one per template, target and
 * viewport, plus manifest.json. It is a vitest file only so it can reuse the project's TypeScript and alias setup. It does
 * nothing unless RENDER_MATRIX_DIR is set. Optional: RENDER_MATRIX_IDS=classic,studio-003 and RENDER_MATRIX_DARK=1.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { PRESETS } from "@/lib/presets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { buildRenderDocument } from "@/lib/render/simulate";
import { RENDER_TARGETS, RENDER_TARGET_IDS, VIEWPORT_IDS } from "@/lib/render/targets";

const OUT = process.env.RENDER_MATRIX_DIR;

describe.skipIf(!OUT)("render matrix pages", () => {
  it("writes the pages", () => {
    const dir = path.resolve(OUT!, "_pages");
    fs.mkdirSync(dir, { recursive: true });
    const only = process.env.RENDER_MATRIX_IDS?.split(",").filter(Boolean);
    const presets = PRESETS.filter((p) => !only?.length || only.includes(p.id));
    const darks = process.env.RENDER_MATRIX_DARK === "1" ? [false, true] : [false];
    const manifest: { id: string; name: string; target: string; engine: string; kind: string; viewport: string; dark: boolean; file: string; changes: { code: string; count: number }[] }[] = [];
    for (const p of presets) {
      const html = renderToEmailHtml(p.doc);
      for (const target of RENDER_TARGET_IDS) {
        for (const viewport of VIEWPORT_IDS) {
          for (const dark of darks) {
            const { doc, changes } = buildRenderDocument(html, RENDER_TARGETS[target], viewport, dark);
            const file = `${p.id}__${target}__${viewport}${dark ? "__dark" : ""}.html`;
            fs.writeFileSync(path.join(dir, file), doc);
            manifest.push({ id: p.id, name: p.name, target, engine: RENDER_TARGETS[target].engine, kind: RENDER_TARGETS[target].kind, viewport, dark, file: `_pages/${file}`, changes });
          }
        }
      }
    }
    fs.writeFileSync(path.resolve(OUT!, "manifest.json"), JSON.stringify(manifest, null, 1));
  });
});
