import { describe, expect, it } from "vitest";
import { SignatureDocSchema, type SignatureDoc } from "@/lib/schema/document";
import { getPreset } from "@/lib/presets";
import { adjustToContrast, contrast } from "./contrast";
import { applyAllFixes, lintDoc, scoreOf } from "./index";

const base = (): SignatureDoc =>
  SignatureDocSchema.parse({
    version: 1,
    template_id: "classic",
    theme: { primary: "#1E3A8A", text: "#111827" },
    blocks: [
      { type: "identity", name: "Jane Doe", title: "Designer", company: "Acme" },
      { type: "contact", email: "jane@acme.com", phone: "+1 555 0100" },
    ],
  });

const ids = (d: SignatureDoc) => lintDoc(d).map((i) => i.id);

describe("contrast", () => {
  it("matches known WCAG values", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
  });
  it("adjusts a colour until it passes", () => {
    const fixed = adjustToContrast("#AAAAAA", "#FFFFFF", 4.5);
    expect(contrast(fixed, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("lintDoc", () => {
  it("passes a complete, well-formed signature", () => {
    // Dark-mode advisories are a separate category (see dark.test.ts): the ordinary near-black text colour always draws one.
    const issues = lintDoc(base()).filter((i) => i.category !== "dark");
    expect(issues).toEqual([]);
    expect(scoreOf(issues)).toBe(100);
  });

  it("flags a missing identity block", () => {
    const d = base();
    d.blocks = d.blocks.filter((b) => b.type !== "identity");
    expect(ids(d)).toContain("no-identity");
  });

  it("flags placeholder starter text and placeholder images", () => {
    const d = base();
    d.blocks[0] = { type: "identity", name: "Your Name", title: "Your title" };
    d.blocks.push({ type: "avatar", src: "https://placehold.co/160x160.png", alt: "", shape: "circle", size: 80 });
    expect(ids(d)).toEqual(expect.arrayContaining(["placeholder-text", "placeholder-image:2", "alt-text:2"]));
  });

  it("flags image formats email clients cannot show", () => {
    const d = base();
    d.blocks.push({ type: "banner", src: "https://cdn.acme.com/logo.svg", alt: "Acme", width: 400, height: 100 });
    d.blocks.push({ type: "banner", src: "https://cdn.acme.com/logo.webp?v=2", alt: "Acme", width: 400, height: 100 });
    expect(ids(d)).toEqual(expect.arrayContaining(["image-format:2", "image-format:3"]));
  });

  it("flags bare social profile links and duplicates, and fixes them without changing the block count", () => {
    const d = base();
    d.blocks.push({
      type: "social",
      links: [
        { network: "linkedin", url: "https://linkedin.com/in/" },
        { network: "twitter", url: "https://x.com/jane" },
        { network: "twitter", url: "https://x.com/jane2" },
      ],
    });
    expect(ids(d)).toEqual(expect.arrayContaining(["social-placeholder:2", "social-duplicate:2"]));
    const fixed = applyAllFixes(d);
    expect(fixed.blocks).toHaveLength(d.blocks.length);
    expect(fixed.blocks[2]).toMatchObject({ links: [{ network: "twitter", url: "https://x.com/jane" }] });
    expect(ids(fixed)).not.toContain("social-placeholder:2");
  });

  it("flags and fixes low text contrast", () => {
    const d = base();
    d.theme.text = "#CCCCCC";
    expect(ids(d)).toContain("contrast-text");
    const fixed = applyAllFixes(d);
    expect(contrast(fixed.theme.text, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(ids(fixed)).not.toContain("contrast-text");
  });

  it("checks text against the theme background on card templates", () => {
    const d = base();
    d.template_id = "dark-luxe";
    d.theme.bg = "#111111";
    d.theme.text = "#222222";
    expect(ids(d)).toContain("contrast-text");
    d.theme.text = "#F5F5F5"; // light text on a dark card is fine
    expect(ids(d)).not.toContain("contrast-text");
  });

  it("ignores theme.bg on plain templates, which sit on the client's white page", () => {
    const d = base();
    d.theme.bg = "#111111";
    expect(ids(d)).not.toContain("contrast-text");
  });

  it("fills missing alt text from the name", () => {
    const d = base();
    d.blocks.push({ type: "avatar", src: "https://cdn.acme.com/me.png", alt: "", shape: "circle", size: 80 });
    const fixed = applyAllFixes(d);
    expect(fixed.blocks[2]).toMatchObject({ alt: "Jane Doe" });
  });

  it("warns when there is no way to contact the person", () => {
    const d = base();
    d.blocks = [d.blocks[0]];
    expect(ids(d)).toContain("no-contact");
  });

  it("scores by severity and never goes below zero", () => {
    expect(scoreOf([{ id: "a", severity: "error", message: "" }, { id: "b", severity: "warning", message: "" }])).toBe(72);
    expect(scoreOf(Array.from({ length: 10 }, (_, i) => ({ id: String(i), severity: "error" as const, message: "" })))).toBe(0);
  });

  it("applyAllFixes never adds, removes or reorders blocks", () => {
    const d = base();
    d.theme.text = "#DDDDDD";
    d.theme.muted = "#EEEEEE";
    d.blocks.push({ type: "avatar", src: "https://cdn.acme.com/me.png", alt: "", shape: "circle", size: 80 });
    d.blocks.push({ type: "social", links: [{ network: "linkedin", url: "https://linkedin.com/in/" }] });
    const fixed = applyAllFixes(d);
    expect(fixed.blocks.map((b) => b.type)).toEqual(d.blocks.map((b) => b.type));
  });

  it("does not throw on any bundled template", () => {
    for (const id of ["classic", "minimal", "studio", "dark-luxe", "noir-agent"]) {
      const preset = getPreset(id);
      if (preset) expect(() => lintDoc(preset.doc)).not.toThrow();
    }
  });
});
