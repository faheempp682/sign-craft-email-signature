import { describe, expect, it } from "vitest";
import { SignatureDocSchema } from "@/lib/schema/document";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { PRESETS } from "./presets";

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
});
