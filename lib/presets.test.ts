import { describe, expect, it } from "vitest";
import { SignatureDocSchema } from "@/lib/schema/document";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { COLLECTIONS, DEFAULT_COLLECTION, PRESETS } from "./presets";

describe("presets", () => {
  it("ships 100+ unique templates", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(100);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  it("every preset validates and renders email-safe HTML", () => {
    for (const p of PRESETS) {
      expect(SignatureDocSchema.safeParse(p.doc).success, p.id).toBe(true);
      const html = renderToEmailHtml(p.doc);
      expect(html, p.id).toContain("<table");
      for (const banned of [/display:\s*flex/i, /display:\s*grid/i, /<svg/i, /<script/i, /data:image/i, /background-image/i, /@font-face/i]) {
        expect(html, p.id).not.toMatch(banned);
      }
    }
  });

  it("studio designs differ in structure, not just colour", () => {
    // Strip colours, text and urls: what remains is the layout skeleton.
    const skeleton = (html: string) => html.replace(/#[0-9a-fA-F]{6}/g, "#").replace(/>[^<]*</g, "><").replace(/(href|src|alt|title)="[^"]*"/g, "").replace(/width:\d+px|height:\d+px/g, "");
    const studio = PRESETS.filter((p) => p.engine === "studio");
    expect(studio.length).toBe(100);
    expect(new Set(studio.map((p) => skeleton(renderToEmailHtml(p.doc)))).size).toBeGreaterThanOrEqual(95);
  });

  it("keeps every template id and puts each one in exactly one collection (44 / 50 / 31)", () => {
    const hand = ["classic", "modern-split", "minimal", "editorial-arch", "bold-letter", "circle-accent", "green-sidebar", "maroon-frame", "spectrum", "geometric", "noir-agent", "orange-logo", "ticket", "listing-banner", "soft-card", "consultant-blue", "executive-navy", "minimal-line", "dark-luxe", "pastel-pill", "split-color", "talent-card", "mountain-logo", "script-contact", "ringed-sales"];
    const ids = new Set(PRESETS.map((p) => p.id));
    for (const id of [...hand, ...Array.from({ length: 100 }, (_, i) => `studio-${String(i + 1).padStart(3, "0")}`)]) expect(ids.has(id), id).toBe(true);
    expect(PRESETS.length).toBe(125);
    const count = (c: string) => PRESETS.filter((p) => p.collection === c).length;
    expect(COLLECTIONS.map(count)).toEqual([44, 50, 31]);
    expect(DEFAULT_COLLECTION).toBe("Essentials");
  });
});
