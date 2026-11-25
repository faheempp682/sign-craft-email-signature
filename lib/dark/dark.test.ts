import { describe, expect, it } from "vitest";
import { SignatureDocSchema, type SignatureDoc } from "@/lib/schema/document";
import { contrast } from "@/lib/linter/contrast";
import { applyAllFixes, lintDoc, scoresOf } from "@/lib/linter";
import { bothModesSafe, checkDarkMode, darkVariant, darkVariantHtml, DARK_SURFACES, solveBothModes } from "./index";

const doc = (o: { template_id?: string; theme?: Record<string, string>; blocks?: unknown[] } = {}): SignatureDoc =>
  SignatureDocSchema.parse({
    version: 1,
    template_id: o.template_id ?? "classic",
    theme: { primary: "#1E3A8A", text: "#111827", ...(o.theme ?? {}) },
    blocks: o.blocks ?? [
      { type: "identity", name: "Jane Doe", title: "Designer", company: "Acme" },
      { type: "contact", email: "jane@acme.com" },
    ],
  });

const darkMin = (c: string) => Math.min(...DARK_SURFACES.map((s) => contrast(c, s)));

describe("checkDarkMode", () => {
  it("reports near-black text as failing on dark but fine on light", () => {
    const r = checkDarkMode(doc());
    const text = r.roles.find((x) => x.role === "text")!;
    expect(text.lightOk).toBe(true);
    expect(text.darkOk).toBe(false);
    expect(text.darkRatio).toBeLessThan(1.5);
    expect(r.ok).toBe(false);
  });
  it("reports white text as failing on light", () => {
    const text = checkDarkMode(doc({ theme: { text: "#FFFFFF" } })).roles.find((x) => x.role === "text")!;
    expect(text.lightOk).toBe(false);
    expect(text.darkOk).toBe(true);
  });
  it("judges a designed card against its own background in both modes", () => {
    const r = checkDarkMode(doc({ template_id: "dark-luxe", theme: { bg: "#111111", text: "#F5F5F5", primary: "#F4C542", muted: "#BBBBBB" } }));
    expect(r.plain).toBe(false);
    expect(r.ok).toBe(true);
  });
});

describe("solveBothModes", () => {
  it("leaves a colour that already passes both alone", () => {
    // pure black page is the one dark surface where a mid-grey can reach 4.5 on both
    const s = solveBothModes("#767676", 4.5, ["#FFFFFF"], ["#000000"]);
    expect(s.status).toBe("ok");
    expect(s.color).toBe("#767676");
  });
  it("finds a colour passing both when one exists", () => {
    const s = solveBothModes("#111827", 4.5, ["#FFFFFF"], ["#000000"]);
    expect(s.status).toBe("fixed");
    expect(contrast(s.color, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(s.color, "#000000")).toBeGreaterThanOrEqual(4.5);
  });
  it("says so honestly when 4.5:1 on white and on dark grey is mathematically impossible", () => {
    const s = solveBothModes("#111827", 4.5, ["#FFFFFF"], DARK_SURFACES);
    expect(s.status).toBe("best-effort");
    expect(s.lightRatio).toBeGreaterThanOrEqual(4.5); // light mode is protected first
    expect(s.darkRatio).toBeLessThan(4.5);
    expect(s.darkRatio).toBeGreaterThan(3); // and dark gets the most that leaves
    // no colour at all does better than 4.5 on white and 4.5 on both dark surfaces: sample the whole grey ramp
    for (let v = 0; v <= 255; v++) {
      const c = `#${v.toString(16).padStart(2, "0").repeat(3)}`.toUpperCase();
      expect(contrast(c, "#FFFFFF") >= 4.5 && darkMin(c) >= 4.5).toBe(false);
    }
  });
  it("reaches the 3:1 target for accent colours on both", () => {
    const s = solveBothModes("#1E3A8A", 3, ["#FFFFFF"], DARK_SURFACES);
    expect(s.status).toBe("fixed");
    expect(contrast(s.color, "#FFFFFF")).toBeGreaterThanOrEqual(3);
    expect(darkMin(s.color)).toBeGreaterThanOrEqual(3);
  });
});

describe("bothModesSafe", () => {
  it("changes only theme colours, never the blocks, and keeps the doc valid", () => {
    const d = doc();
    const r = bothModesSafe(d);
    expect(r.doc.blocks).toEqual(d.blocks);
    expect(r.doc.template_id).toBe(d.template_id);
    expect(SignatureDocSchema.safeParse(r.doc).success).toBe(true);
    const text = r.results.find((x) => x.role === "text")!;
    expect(text.to).not.toBe(text.from);
    expect(text.status).toBe("best-effort");
    expect(r.allPass).toBe(false);
    expect(r.results.find((x) => x.role === "primary")!.status).toBe("fixed");
  });
  it("leaves designed card templates alone", () => {
    const d = doc({ template_id: "soft-card" });
    expect(bothModesSafe(d).doc.theme).toEqual(d.theme);
  });
  it("keeps light mode passing so the normal contrast rules stay quiet", () => {
    const fixed = bothModesSafe(doc()).doc;
    expect(lintDoc(fixed).map((i) => i.id)).not.toEqual(expect.arrayContaining(["contrast-text", "contrast-muted"]));
  });
});

describe("darkVariant", () => {
  it("lightens dark text for dark backgrounds and lists what changed and why", () => {
    const d = doc();
    const v = darkVariant(d);
    expect(darkMin(v.doc.theme.text)).toBeGreaterThanOrEqual(4.5);
    expect(darkMin(v.doc.theme.primary)).toBeGreaterThanOrEqual(3);
    const c = v.changes.find((x) => x.field === "theme.text")!;
    expect(c.from).toBe("#111827");
    expect(c.reason).toMatch(/too dark/);
    expect(v.doc.blocks).toEqual(d.blocks);
    expect(d.theme.text).toBe("#111827"); // original untouched
  });
  it("makes no change when colours are already light", () => {
    const d = doc({ theme: { text: "#F3F4F6", muted: "#C9CDD3", primary: "#93C5FD" } });
    expect(darkVariant(d).changes).toEqual([]);
  });
  it("darkens a light card and rechecks the text against it", () => {
    const d = doc({ template_id: "soft-card", theme: { bg: "#FFF7ED", text: "#1F2937", muted: "#6B7280" } });
    const v = darkVariant(d);
    expect(v.changes.some((c) => c.field === "theme.bg")).toBe(true);
    expect(contrast(v.doc.theme.text, v.doc.theme.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v.doc.theme.muted, v.doc.theme.bg)).toBeGreaterThanOrEqual(4.5);
  });
  it("produces email-safe HTML, with an optional preview background", () => {
    const d = doc();
    const plain = darkVariantHtml(d);
    expect(plain.html).toContain(plain.doc.theme.text);
    expect(plain.html).not.toContain("#111827");
    expect(plain.html).not.toMatch(/<style|background-image|display:flex|<svg/i);
    const wrapped = darkVariantHtml(d, { previewBackground: true });
    expect(wrapped.html).toContain('bgcolor="#121212"');
    expect(wrapped.html.startsWith("<table")).toBe(true);
  });
});

describe("dark-mode lint rules", () => {
  const ids = (d: SignatureDoc, a = {}) => lintDoc(d, a).filter((i) => i.category === "dark").map((i) => i.id);

  it("warns about near-black text on a plain template and offers an opt-in fix", () => {
    const issue = lintDoc(doc()).find((i) => i.id === "dark-text")!;
    expect(issue.category).toBe("dark");
    expect(issue.optIn).toBe(true);
    expect(issue.message).toMatch(/almost black/);
    expect(issue.message).toMatch(/No single colour/); // honest about the impossibility
    expect(issue.fix).toBeTypeOf("function");
  });
  it("is quiet for a card template with good contrast, other than bright-card guidance", () => {
    expect(ids(doc({ template_id: "dark-luxe", theme: { bg: "#111111", text: "#F5F5F5", primary: "#F4C542", muted: "#BBBBBB" } }))).toEqual([]);
    expect(ids(doc({ template_id: "soft-card", theme: { bg: "#FFFFFF" } }))).toEqual(["dark-card-bright"]);
  });
  it("Fix all never applies dark fixes (they trade off the light-mode look), so it cannot oscillate with contrast fixes", () => {
    const d = doc({ theme: { text: "#999999" } }); // fails light contrast: the contrast rule fixes this
    const fixed = applyAllFixes(d);
    expect(contrast(fixed.theme.text, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(fixed.theme.primary).toBe(d.theme.primary);
  });
  it("after applying the dark fix the text still passes light contrast and the issue does not loop", () => {
    const d = doc();
    const fixed = lintDoc(d).find((i) => i.id === "dark-text")!.fix!(d);
    expect(contrast(fixed.theme.text, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    const again = lintDoc(fixed).find((i) => i.id === "dark-text");
    expect(again?.fix).toBeUndefined(); // already the best possible: no pointless fix button
    expect(lintDoc(fixed).some((i) => i.id === "contrast-text")).toBe(false);
  });
  it("gives generic PNG logo guidance unless the upload proved the image is opaque or light", () => {
    const d = doc({ blocks: [{ type: "identity", name: "J" }, { type: "avatar", src: "https://cdn.acme.com/logo.png", alt: "Acme logo", shape: "square", size: 80 }] });
    expect(ids(d)).toContain("dark-png:1");
    const src = "https://cdn.acme.com/logo.png";
    const base = { type: "image/png" as const, bytes: 1000, width: 200, height: 200, animated: false };
    expect(ids(d, { [src]: { ...base, hasTransparency: false } })).not.toContain("dark-png:1");
    expect(ids(d, { [src]: { ...base, hasTransparency: true, darkArtwork: false } })).not.toContain("dark-png:1");
    expect(ids(d, { [src]: { ...base, type: "image/jpeg" } })).not.toContain("dark-png:1");
    const dark = lintDoc(d, { [src]: { ...base, hasTransparency: true, darkArtwork: true } }).find((i) => i.id === "asset-dark-logo:1")!;
    expect(dark.category).toBe("dark");
    expect(dark.severity).toBe("warning");
  });
  it("reports per-category scores", () => {
    const s = scoresOf(lintDoc(doc()));
    expect(s.dark).toBeLessThan(100);
    expect(s.compat).toBe(100);
    expect(s.accessibility).toBe(100);
    expect(s.overall).toBeLessThan(100);
  });
});
