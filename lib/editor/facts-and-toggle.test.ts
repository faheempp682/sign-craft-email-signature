import { describe, expect, it } from "vitest";
import { cleanValue, FIELDS } from "./blocks";
import { pickFacts, toAssetInfo, type UploadResult } from "./upload";

describe("pickFacts", () => {
  it("copies only the measured facts that are present", () => {
    expect(pickFacts({ frames: 6, firstFrame: "blank", hasTransparency: false, darkArtwork: undefined })).toEqual({ frames: 6, firstFrame: "blank", hasTransparency: false });
  });

  it("ignores everything that is not a fact, so a server answer cannot inject other fields", () => {
    const polluted = { frames: 2, url: "https://evil.example", bytes: 1, extra: "x" } as unknown as Parameters<typeof pickFacts>[0];
    expect(pickFacts(polluted)).toEqual({ frames: 2 });
  });

  it("keeps false and zero (they are facts), drops null and undefined", () => {
    expect(pickFacts({ hasTransparency: false, loopCount: 0, flashesPerSecond: null as unknown as undefined })).toEqual({ hasTransparency: false, loopCount: 0 });
  });
});

describe("toAssetInfo", () => {
  const r: UploadResult = { url: "https://cdn/x.gif", type: "image/gif", bytes: 1000, width: 400, height: 100, animated: true, frames: 5, firstFrame: "sparse", durationMs: 2500, notes: [], warnings: [] };

  it("carries the GIF facts to the linter", () => {
    expect(toAssetInfo(r)).toMatchObject({ animated: true, frames: 5, firstFrame: "sparse", durationMs: 2500 });
  });

  it("does not leak the url, notes or warnings into the asset record", () => {
    const info = toAssetInfo(r) as Record<string, unknown>;
    expect(info.url).toBeUndefined();
    expect(info.notes).toBeUndefined();
    expect(info.warnings).toBeUndefined();
  });
});

describe("the click-tracking toggle", () => {
  it("is a banner field of kind toggle", () => {
    expect(FIELDS.banner.find((f) => f.key === "track")).toMatchObject({ kind: "toggle" });
  });

  it("turns 'true' into true and anything else into undefined (so the key disappears from the document)", () => {
    expect(cleanValue("toggle", "true")).toBe(true);
    for (const raw of ["", "false", "on", "1"]) expect(cleanValue("toggle", raw)).toBeUndefined();
  });

  it("leaves the other field kinds as they were", () => {
    expect(cleanValue("number", "12")).toBe(12);
    expect(cleanValue("text", "")).toBeUndefined();
    expect(cleanValue("text", "hi")).toBe("hi");
  });
});
