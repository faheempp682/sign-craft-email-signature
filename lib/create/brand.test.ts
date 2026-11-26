import { describe, expect, it } from "vitest";
import { PRESETS } from "@/lib/presets";
import { contrast } from "@/lib/linter/contrast";
import { SignatureDocSchema } from "@/lib/schema/document";
import { applyBrand, brandPalette } from "./brand";

/** n pixels of one colour as RGBA. */
const px = (n: number, r: number, g: number, b: number, a = 255) => Array.from({ length: n }, () => [r, g, b, a]).flat();

describe("brandPalette", () => {
  it("finds the logo's colour and ignores white, black, grey and transparent pixels", () => {
    const pixels = [...px(400, 255, 255, 255), ...px(300, 0, 0, 0), ...px(200, 128, 128, 128), ...px(500, 10, 10, 200, 0), ...px(120, 220, 40, 60)];
    expect(brandPalette(pixels)).toEqual([expect.stringMatching(/^#D[0-9A-F]2[0-9A-F]3[0-9A-F]$/)]);
  });

  it("offers a second colour only when it is clearly different, most prominent first", () => {
    const pixels = [...px(300, 220, 40, 60), ...px(290, 222, 42, 62), ...px(150, 20, 120, 220)];
    const palette = brandPalette(pixels);
    expect(palette).toHaveLength(2);
    expect(palette[0]).toMatch(/^#D[0-9A-F]2[0-9A-F]3/); // the two close reds merge into one, and lead
  });

  it("returns nothing for a black-and-white logo", () => {
    expect(brandPalette([...px(300, 0, 0, 0), ...px(300, 255, 255, 255)])).toEqual([]);
  });
});

describe("applyBrand", () => {
  it("does nothing when off or when there is no colour", () => {
    const doc = PRESETS[0].doc;
    expect(applyBrand(doc, undefined)).toBe(doc);
    expect(applyBrand(doc, { on: false, palette: ["#DC283C"], pick: 0 })).toBe(doc);
    expect(applyBrand(doc, { on: true, palette: [], pick: 0 })).toBe(doc);
  });

  it("recolours every template, keeps it valid, and keeps the main colour readable on the card", () => {
    for (const p of PRESETS) {
      const out = applyBrand(p.doc, { on: true, palette: ["#FFE600", "#1478DC"], pick: 0 }); // a pale yellow is the hard case
      expect(SignatureDocSchema.safeParse(out).success, p.id).toBe(true);
      expect(contrast(out.theme.primary, out.theme.bg), p.id).toBeGreaterThanOrEqual(3);
      expect(out.theme.bg, p.id).toBe(p.doc.theme.bg); // the designer's background stays
      expect(out.theme.text, p.id).toBe(p.doc.theme.text);
    }
  });

  it("lets the person pick which colour leads", () => {
    const out = applyBrand(PRESETS[0].doc, { on: true, palette: ["#DC283C", "#1478DC"], pick: 1 });
    expect(out.theme.primary.toUpperCase()).toBe("#1478DC");
  });
});
