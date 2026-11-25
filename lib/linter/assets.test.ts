import { describe, expect, it } from "vitest";
import { SignatureDocSchema, type SignatureDoc } from "@/lib/schema/document";
import { KB, type AssetInfo } from "@/lib/storage/rules";
import { applyAllFixes, lintDoc, type AssetMap } from "./index";

const BANNER = "https://cdn.acme.com/u/banner.gif";
const PHOTO = "https://cdn.acme.com/u/me.png";

const doc = (): SignatureDoc =>
  SignatureDocSchema.parse({
    version: 1,
    template_id: "classic",
    theme: { primary: "#1E3A8A", text: "#111827" },
    blocks: [
      { type: "identity", name: "Jane Doe", title: "Designer", company: "Acme" },
      { type: "contact", email: "jane@acme.com" },
      { type: "avatar", src: PHOTO, alt: "Jane", shape: "circle", size: 80 },
      { type: "banner", src: BANNER, alt: "Acme sale", href: "https://acme.com/sale", width: 400, height: 100 },
    ],
  });

const asset = (o: Partial<AssetInfo> = {}): AssetInfo => ({ type: "image/png", bytes: 30 * KB, width: 400, height: 100, animated: false, ...o });
// Dark-mode advisories (near-black text, PNG logo guidance) are tested in lib/dark; these tests are about upload findings.
const ids = (d: SignatureDoc, a: AssetMap) => lintDoc(d, a).filter((i) => i.category !== "dark").map((i) => i.id);

describe("upload findings in the compatibility checker", () => {
  it("adds nothing when no upload facts are known (pasted URLs, older images)", () => {
    expect(ids(doc(), {})).toEqual([]);
  });

  it("is clean for a well-sized upload", () => {
    expect(ids(doc(), { [BANNER]: asset(), [PHOTO]: asset({ width: 200, height: 200 }) })).toEqual([]);
  });

  it("warns that an animated GIF over 300 KB is too heavy, on the right block", () => {
    const issues = lintDoc(doc(), { [BANNER]: asset({ type: "image/gif", animated: true, bytes: 412 * KB }) });
    const gif = issues.find((i) => i.id === "asset-gif-size:3");
    expect(gif).toMatchObject({ severity: "warning", blockIndex: 3 });
    expect(gif!.message).toContain("412 KB");
    expect(gif!.message).toContain("banner");
  });

  it("makes a GIF over 1 MB an error, and always notes Outlook's first-frame behaviour for animations", () => {
    const issues = lintDoc(doc(), { [BANNER]: asset({ type: "image/gif", animated: true, bytes: 2000 * KB }) });
    expect(issues.find((i) => i.id === "asset-gif-size:3")?.severity).toBe("error");
    expect(issues.find((i) => i.id === "asset-gif-outlook:3")?.severity).toBe("info");
  });

  it("does not warn about a small animated GIF beyond the Outlook note", () => {
    expect(ids(doc(), { [BANNER]: asset({ type: "image/gif", animated: true, bytes: 120 * KB }) })).toEqual(["asset-gif-outlook:3"]);
  });

  it("warns about a heavy static image", () => {
    expect(ids(doc(), { [PHOTO]: asset({ bytes: 350 * KB, width: 200, height: 200 }) })).toContain("asset-image-size:2");
  });

  it("notes a tiny image", () => {
    expect(ids(doc(), { [PHOTO]: asset({ width: 24, height: 24 }) })).toContain("asset-image-tiny:2");
  });
});

describe("image shape", () => {
  it("flags a banner shown at the wrong proportions and offers a fix that preserves the ratio", () => {
    const d = doc();
    d.blocks[3] = { ...d.blocks[3], width: 400, height: 200 } as SignatureDoc["blocks"][3]; // shown 2:1, image is 4:1
    const assets = { [BANNER]: asset({ width: 1200, height: 300 }) };
    const issue = lintDoc(d, assets).find((i) => i.id === "asset-stretched:3");
    expect(issue).toBeDefined();
    expect(issue!.fixLabel).toBe("Show at 400×100");
    const fixed = issue!.fix!(d);
    expect(fixed.blocks[3]).toMatchObject({ width: 400, height: 100 });
    expect(ids(fixed, assets)).not.toContain("asset-stretched:3");
  });

  it("keeps the corrected banner inside the allowed size range", () => {
    const d = doc();
    d.blocks[3] = { ...d.blocks[3], width: 600, height: 100 } as SignatureDoc["blocks"][3];
    const assets = { [BANNER]: asset({ width: 100, height: 400 }) }; // a tall image: height would be 2400
    const fixed = applyAllFixes(d, assets);
    const b = fixed.blocks[3] as { width: number; height: number };
    expect(b.height).toBeLessThanOrEqual(300);
    expect(b.width).toBeGreaterThanOrEqual(100);
    expect(SignatureDocSchema.safeParse(fixed).success).toBe(true);
  });

  it("flags a non-square photo that is shown in a square frame", () => {
    const issue = lintDoc(doc(), { [PHOTO]: asset({ width: 300, height: 200 }) }).find((i) => i.id === "asset-not-square:2");
    expect(issue).toMatchObject({ severity: "warning", blockIndex: 2 });
    expect(issue!.fix).toBeUndefined(); // cropping needs the user's eye, so there is no auto-fix
  });

  it("leaves a square photo alone", () => {
    expect(ids(doc(), { [PHOTO]: asset({ width: 200, height: 200 }) })).not.toContain("asset-not-square:2");
  });
});

describe("fixes never change the document structure", () => {
  it("applyAllFixes keeps the same blocks in the same order, and never touches image URLs", () => {
    const d = doc();
    d.blocks[3] = { ...d.blocks[3], width: 400, height: 250 } as SignatureDoc["blocks"][3];
    const fixed = applyAllFixes(d, { [BANNER]: asset({ width: 800, height: 200 }) });
    expect(fixed.blocks.map((b) => b.type)).toEqual(d.blocks.map((b) => b.type));
    expect((fixed.blocks[3] as { src: string }).src).toBe(BANNER);
    expect(fixed.version).toBe(1);
  });

  it("does not change the JSON document shape: facts live in a separate map", () => {
    const d = doc();
    const before = JSON.stringify(d);
    lintDoc(d, { [BANNER]: asset({ type: "image/gif", animated: true, bytes: 900 * KB }) });
    expect(JSON.stringify(d)).toBe(before);
    expect(SignatureDocSchema.safeParse(JSON.parse(before)).success).toBe(true);
  });
});
