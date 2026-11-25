/**
 * Generates a test pack for checking exported signatures in real Gmail / Outlook accounts.
 *
 *   npm run client-pack            # writes ./client-pack/index.html (+ one .html per signature)
 *
 * It is a vitest file only so it can reuse the project's TypeScript/alias setup; it does nothing unless CLIENT_PACK_DIR is set.
 */
import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PRESETS, getPreset } from "@/lib/presets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import type { SignatureDoc } from "@/lib/schema/document";

const OUT = process.env.CLIENT_PACK_DIR;

// One of each studio layout, the hand-built designs that lean hardest on email-client quirks, and a few stress cases.
const BASE_IDS = ["classic", "minimal", "editorial-arch", "geometric", "green-sidebar", "dark-luxe", "pastel-pill", "listing-banner", ...Array.from({ length: 11 }, (_, i) => `studio-${String(i + 1).padStart(3, "0")}`)];

const longText = (d: SignatureDoc): SignatureDoc => ({
  ...d,
  blocks: d.blocks.map((b) =>
    b.type === "identity" ? { ...b, name: "Alexandra Montgomery-Wellington", title: "Senior Vice President, Strategic Partnerships", company: "Montgomery & Associates International" }
    : b.type === "contact" ? { ...b, email: "alexandra.montgomery@montgomery-intl.com", website: "www.montgomery-international.com", address: "1234 Long Boulevard, Suite 5678, Springfield, MA" }
    : b),
});
const noPhoto = (d: SignatureDoc): SignatureDoc => ({ ...d, blocks: d.blocks.filter((b) => b.type !== "avatar") });

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

describe.skipIf(!OUT)("client test pack", () => {
  it("writes the pack", () => {
    const dir = path.resolve(OUT!);
    fs.mkdirSync(dir, { recursive: true });
    const cases: { key: string; title: string; html: string }[] = [];
    for (const id of BASE_IDS) {
      const p = getPreset(id);
      if (!p) continue;
      cases.push({ key: id, title: `${p.name} (${id})`, html: renderToEmailHtml(p.doc) });
    }
    for (const id of ["studio-003", "studio-007", "studio-009"]) {
      const p = getPreset(id)!;
      cases.push({ key: `${id}-long`, title: `${p.name} (${id}) - long text`, html: renderToEmailHtml(longText(p.doc)) });
      cases.push({ key: `${id}-nophoto`, title: `${p.name} (${id}) - no photo`, html: renderToEmailHtml(noPhoto(p.doc)) });
    }
    const rows = cases
      .map((c, i) => `<section class="case" id="${c.key}"><h2>${i + 1}. ${esc(c.title)}</h2><div class="sig" id="sig-${c.key}">${c.html}</div><button onclick="copySig('sig-${c.key}')">Copy signature</button> <span class="ok" id="ok-${c.key}"></span></section>`)
      .join("\n");
    fs.writeFileSync(
      path.join(dir, "index.html"),
      `<!doctype html><meta charset="utf-8"><title>Signature client test pack</title>
<style>body{font:14px Arial,sans-serif;margin:24px;max-width:900px;color:#111}h1{margin:0 0 4px}.case{border-top:1px solid #ddd;padding:18px 0}.sig{padding:12px;background:#fff;border:1px dashed #ccc;overflow:auto}button{margin-top:10px;padding:8px 14px;cursor:pointer}.ok{color:#047857}</style>
<h1>Signature client test pack</h1>
<p>${cases.length} signatures. Click <b>Copy signature</b>, then paste into the signature editor of the mail client (see docs/client-testing.md). Placeholder images come from placehold.co; use a real hosted image for a true test.</p>
${rows}
<script>function copySig(id){var el=document.getElementById(id);var r=document.createRange();r.selectNodeContents(el);var s=getSelection();s.removeAllRanges();s.addRange(r);var ok=document.execCommand('copy');s.removeAllRanges();var k=document.getElementById('ok-'+id.slice(4));k.textContent=ok?'Copied':'Copy failed - select it manually';}</script>`,
    );
    fs.writeFileSync(path.join(dir, "cases.json"), JSON.stringify(cases.map((c) => c.key), null, 2));
    // Sanity: the pack only uses real presets.
    if (PRESETS.length < 100) throw new Error("presets missing");
  });
});
