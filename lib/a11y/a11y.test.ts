import { describe, expect, it } from "vitest";
import { SignatureDocSchema, type SignatureDoc } from "@/lib/schema/document";
import { applyAllFixes, lintDoc } from "@/lib/linter";
import { KB } from "@/lib/storage/rules";

const PHOTO = "https://cdn.acme.com/u/me.png";
const BANNER = "https://cdn.acme.com/u/banner.png";

const doc = (blocks?: unknown[], theme: Record<string, string> = {}): SignatureDoc =>
  SignatureDocSchema.parse({
    version: 1,
    template_id: "classic",
    theme: { primary: "#2563EB", text: "#111827", ...theme },
    blocks: blocks ?? [
      { type: "identity", name: "Jane Doe", title: "Designer", company: "Acme" },
      { type: "contact", email: "jane@acme.com", website: "acme.com" },
    ],
  });
// raw documents as the editor holds them can be invalid in ways parse() would reject, so skip the schema for those
const raw = (blocks: unknown[]): SignatureDoc => ({ ...doc(), blocks: blocks as SignatureDoc["blocks"] });

const a11y = (d: SignatureDoc, assets = {}) => lintDoc(d, assets).filter((i) => i.category === "accessibility");
const ids = (d: SignatureDoc, assets = {}) => a11y(d, assets).map((i) => i.id);
const ident = { type: "identity", name: "Jane Doe", company: "Acme" };

describe("accessibility: alt text quality", () => {
  it("flags generic and filename alt text, with a fix that keeps the same block", () => {
    for (const alt of ["image", "Logo", "click here", "IMG_2041.jpg", "https://acme.com/x.png"]) {
      const d = raw([ident, { type: "avatar", src: PHOTO, alt, shape: "circle", size: 80 }]);
      const issue = a11y(d).find((i) => i.id === "alt-generic:1");
      expect(issue, alt).toBeDefined();
      const fixed = issue!.fix!(d);
      expect((fixed.blocks[1] as { alt: string }).alt).toBe("Jane Doe");
      expect(fixed.blocks.map((b) => b.type)).toEqual(d.blocks.map((b) => b.type));
    }
  });
  it("trims 'image of' and flags over-long alt, and leaves good alt alone", () => {
    const wording = a11y(raw([ident, { type: "avatar", src: PHOTO, alt: "Photo of Jane Doe", shape: "circle", size: 80 }])).find((i) => i.id === "alt-wording:1")!;
    expect(wording.fixLabel).toBe('Use "Jane Doe"');
    expect(ids(raw([ident, { type: "banner", src: BANNER, alt: "x".repeat(130), width: 400, height: 100 }]))).toContain("alt-long:1");
    expect(ids(raw([ident, { type: "avatar", src: PHOTO, alt: "Jane Doe, account director", shape: "circle", size: 80 }]))).toEqual([]);
  });
  it("makes a missing alt on a linked banner an error and says why", () => {
    const d = raw([ident, { type: "banner", src: BANNER, alt: "", href: "https://acme.com", width: 400, height: 100 }]);
    const issue = a11y(d).find((i) => i.id === "alt-text:1")!;
    expect(issue.severity).toBe("error");
    expect(issue.message).toMatch(/announces only "link"/);
  });
  it("asks for a fuller description on an animated GIF", () => {
    const d = raw([ident, { type: "banner", src: BANNER, alt: "Sale", width: 400, height: 100 }]);
    const asset = { [BANNER]: { type: "image/gif", bytes: 50 * KB, width: 400, height: 100, animated: true } };
    expect(ids(d, asset)).toContain("alt-animated:1");
    const none = raw([ident, { type: "banner", src: BANNER, alt: "", width: 400, height: 100 }]);
    expect(a11y(none, asset).find((i) => i.id === "alt-text:1")!.message).toMatch(/animated GIF/);
  });
});

describe("accessibility: sizes and dimensions", () => {
  it("fixes an avatar under 32 px and suggests 48 for a small one", () => {
    const tiny = raw([ident, { type: "avatar", src: PHOTO, alt: "Jane", shape: "circle", size: 24 }]);
    const issue = a11y(tiny).find((i) => i.id === "avatar-small:1")!;
    expect(issue.severity).toBe("warning");
    expect((issue.fix!(tiny).blocks[1] as { size: number }).size).toBe(32);
    const small = raw([ident, { type: "avatar", src: PHOTO, alt: "Jane", shape: "circle", size: 40 }]);
    expect(a11y(small).find((i) => i.id === "avatar-small:1")!.severity).toBe("info");
    expect(ids(raw([ident, { type: "avatar", src: PHOTO, alt: "Jane", shape: "circle", size: 48 }]))).toEqual([]);
  });
  it("warns about a banner too small to read, with no automatic fix", () => {
    const d = raw([ident, { type: "banner", src: BANNER, alt: "Acme", width: 150, height: 30 }]);
    const issue = a11y(d).find((i) => i.id === "banner-small:1")!;
    expect(issue).toBeDefined();
    expect(issue.fix).toBeUndefined();
  });
  it("catches images with no explicit dimensions and fixes them", () => {
    const d = raw([ident, { type: "avatar", src: PHOTO, alt: "Jane" }, { type: "banner", src: BANNER, alt: "Acme" }]);
    const found = a11y(d).filter((i) => i.id.startsWith("image-dimensions"));
    expect(found.map((i) => i.id).sort()).toEqual(["image-dimensions:1", "image-dimensions:2"]);
    const fixed = applyAllFixes(d);
    expect(fixed.blocks[1]).toMatchObject({ size: 80 });
    expect(fixed.blocks[2]).toMatchObject({ width: 400, height: 100 });
    expect(fixed.blocks.length).toBe(3);
  });
  it("notes an image shown larger than its real size", () => {
    const d = raw([ident, { type: "avatar", src: PHOTO, alt: "Jane", shape: "circle", size: 120 }]);
    expect(ids(d, { [PHOTO]: { type: "image/png", bytes: KB, width: 60, height: 60, animated: false } })).toContain("image-low-res:1");
  });
});

describe("accessibility: links", () => {
  it("flags and fixes a non-https banner link, and removes one that cannot be fixed", () => {
    const d = raw([ident, { type: "banner", src: BANNER, alt: "Acme", href: "http://acme.com/sale", width: 400, height: 100 }]);
    const issue = a11y(d).find((i) => i.id === "link-insecure:1")!;
    expect(issue.severity).toBe("error");
    expect((issue.fix!(d).blocks[1] as { href: string }).href).toBe("https://acme.com/sale");
    const junk = raw([ident, { type: "banner", src: BANNER, alt: "Acme", href: "javascript:alert(1)", width: 400, height: 100 }]);
    expect((a11y(junk).find((i) => i.id === "link-insecure:1")!.fix!(junk).blocks[1] as { href?: string }).href).toBeUndefined();
  });
  it("fixes insecure social links without removing the block", () => {
    const d = raw([ident, { type: "social", links: [{ network: "linkedin", url: "http://linkedin.com/in/jane" }, { network: "twitter", url: "not a url at all" }] }]);
    const fixed = applyAllFixes(d);
    expect(fixed.blocks).toHaveLength(2);
    expect((fixed.blocks[1] as { links: { url: string }[] }).links).toEqual([{ network: "linkedin", url: "https://linkedin.com/in/jane" }]);
  });
  it("flags vague link alt, bad email/website/phone, long website, and crowded links", () => {
    expect(ids(raw([ident, { type: "banner", src: BANNER, alt: "Click here", href: "https://acme.com", width: 400, height: 100 }]))).toContain("link-text:1");
    const c = ids(raw([ident, { type: "contact", email: "nope", website: "a b", phone: "12" }]));
    expect(c).toEqual(expect.arrayContaining(["link-email:1", "link-website:1", "link-phone:1"]));
    expect(ids(raw([ident, { type: "contact", website: `https://acme.com/${"a".repeat(70)}` }]))).toContain("link-long:1");
    const links = ["linkedin", "twitter", "github"].map((n) => ({ network: n, url: `https://${n}.com/jane` }));
    expect(ids(raw([ident, { type: "social", links }]))).toContain("touch-spacing:1");
  });
});

describe("accessibility: colour and text", () => {
  const withLink = [ident, { type: "contact", website: "acme.com" }];
  it("asks for 4.5:1 on link text when the accent only reaches 3:1, and the fix passes", () => {
    const d = doc(withLink, { primary: "#7B7BE8" }); // about 3.6:1 on white
    const issue = a11y(d).find((i) => i.id === "contrast-link")!;
    expect(issue).toBeDefined();
    const fixed = issue.fix!(d);
    expect(ids(fixed)).not.toContain("contrast-link");
  });
  it("does not talk about link colour when there are no links", () => {
    expect(ids(doc([ident], { primary: "#7B7BE8" }))).not.toContain("contrast-link");
  });
  it("flags links that differ from text by colour alone", () => {
    expect(ids(doc(withLink, { primary: "#222222", text: "#111827" }))).toContain("link-colour-only");
    expect(ids(doc(withLink))).not.toContain("link-colour-only");
  });
  it("notes capital-letter disclaimers and long small print", () => {
    const text = "THIS MESSAGE IS CONFIDENTIAL AND INTENDED ONLY FOR THE NAMED RECIPIENT. ".repeat(6);
    const d = raw([ident, { type: "disclaimer", text }]);
    expect(ids(d)).toEqual(expect.arrayContaining(["text-caps:1", "text-small:1"]));
    expect(ids(raw([ident, { type: "disclaimer", text: "Short note." }]))).toEqual([]);
  });
});

describe("accessibility fixes never change structure", () => {
  it("applyAllFixes keeps blocks, order and image sources", () => {
    const d = raw([
      ident,
      { type: "avatar", src: PHOTO, alt: "image", shape: "circle", size: 20 },
      { type: "banner", src: BANNER, alt: "", href: "http://acme.com", width: 400, height: 100 },
    ]);
    const fixed = applyAllFixes(d);
    expect(fixed.blocks.map((b) => b.type)).toEqual(d.blocks.map((b) => b.type));
    expect((fixed.blocks[1] as { src: string }).src).toBe(PHOTO);
    expect((fixed.blocks[2] as { src: string }).src).toBe(BANNER);
    expect(ids(fixed)).toEqual([]);
  });
  it("a clean, well-formed signature has no accessibility issues", () => {
    expect(ids(doc())).toEqual([]);
  });
});
