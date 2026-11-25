import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRESETS } from "@/lib/presets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import type { SignatureDoc } from "@/lib/schema/document";

/**
 * Generator for e2e/word-wrap.e2e.mjs. Writes two pages with all 121 templates, one with ordinary text and one with
 * extreme text (very long names, titles, emails and websites), into WRAP_CHECK_DIR. Skipped unless that is set, so it
 * never writes files during a normal test run.
 *
 * Why it exists: `overflow-wrap:anywhere` makes text wrap instead of stretching a table, which protects against long
 * text but turns any template whose content does not fit its declared width into mid-word breaks ("Han/a", "Du/lse/ta").
 * A real browser is the only way to see that, so this feeds one.
 */
const OUT = process.env.WRAP_CHECK_DIR;

const LONG = {
  name: "Bartholomew-Maximilian Featherstonehaugh-Cholmondeley",
  title: "Senior Vice President of International Strategic Partnerships and Development",
  company: "Featherstonehaugh International Holdings and Partners Limited Liability",
  email: "bartholomew.maximilian.featherstonehaugh@internationalholdingsandpartners.example.com",
  website: "www.featherstonehaughinternationalholdingsandpartners-worldwide.example.com",
  phone: "+44 (0)20 7946 0958 ext. 123456789012345",
};
const extreme = (d: SignatureDoc): SignatureDoc => ({
  ...d,
  blocks: d.blocks.map((b) =>
    b.type === "identity" ? { ...b, name: LONG.name, title: LONG.title, company: LONG.company } : b.type === "contact" ? { ...b, email: LONG.email, website: LONG.website, phone: LONG.phone } : b,
  ),
});

const page = (docs: SignatureDoc[], ids: string[]) =>
  `<!doctype html><meta charset="utf-8"><body style="margin:8px;font-family:Arial">${docs
    .map((d, i) => `<div class="cell" data-id="${ids[i]}" style="width:760px;border:1px dashed #ccc;margin:6px;overflow:auto">${renderToEmailHtml(d)}</div>`)
    .join("")}</body>`;

describe.skipIf(!OUT)("word-wrap check pages", () => {
  it("writes the normal and extreme pages", () => {
    mkdirSync(OUT!, { recursive: true });
    const ids = PRESETS.map((p) => p.id);
    writeFileSync(join(OUT!, "normal.html"), page(PRESETS.map((p) => p.doc), ids));
    writeFileSync(join(OUT!, "extreme.html"), page(PRESETS.map((p) => extreme(p.doc)), ids));
    expect(ids).toHaveLength(121);
  });
});
