import { describe, expect, it } from "vitest";
import { KB, LIMITS, aspectMismatch, assetWarnings, formatBytes, type AssetInfo } from "./rules";

const info = (o: Partial<AssetInfo> = {}): AssetInfo => ({ type: "image/png", bytes: 20 * KB, width: 400, height: 200, animated: false, ...o });
const codes = (a: AssetInfo) => assetWarnings(a).map((w) => `${w.code}:${w.severity}`);

describe("assetWarnings: file size", () => {
  it("is silent for a small static image", () => {
    expect(assetWarnings(info())).toEqual([]);
  });
  it("warns when a static image is over 200 KB, but not at exactly 200 KB", () => {
    expect(codes(info({ bytes: LIMITS.staticWarnBytes }))).toEqual([]);
    expect(codes(info({ bytes: LIMITS.staticWarnBytes + 1 }))).toEqual(["image-size:warning"]);
  });
});

describe("assetWarnings: animated GIFs", () => {
  const gif = (o: Partial<AssetInfo> = {}) => info({ type: "image/gif", animated: true, ...o });
  it("always reminds that Outlook desktop shows only the first frame", () => {
    expect(codes(gif({ bytes: 50 * KB }))).toEqual(["gif-outlook:info"]);
  });
  it("warns above 300 KB, not at exactly 300 KB", () => {
    expect(codes(gif({ bytes: LIMITS.gifWarnBytes }))).toEqual(["gif-outlook:info"]);
    expect(codes(gif({ bytes: LIMITS.gifWarnBytes + 1 }))).toEqual(["gif-size:warning", "gif-outlook:info"]);
  });
  it("is an error above 1 MB", () => {
    expect(codes(gif({ bytes: LIMITS.gifErrorBytes + 1 }))[0]).toBe("gif-size:error");
  });
  it("does not apply the animated limit to a static GIF", () => {
    expect(codes(info({ type: "image/gif", animated: false, bytes: 250 * KB }))).toEqual(["image-size:warning"]);
  });
  it("quotes the real size in the message", () => {
    expect(assetWarnings(info({ type: "image/gif", animated: true, bytes: 412 * KB }))[0].message).toContain("412 KB");
  });
});

describe("assetWarnings: dimensions", () => {
  it("notes images that are too small to stay sharp", () => {
    expect(codes(info({ width: 30, height: 200 }))).toEqual(["image-tiny:info"]);
    expect(codes(info({ width: 200, height: 39 }))).toEqual(["image-tiny:info"]);
    expect(codes(info({ width: 40, height: 40 }))).toEqual([]);
  });
});

describe("aspectMismatch", () => {
  it("tolerates small rounding differences and catches real distortion", () => {
    expect(aspectMismatch(1200, 300, 400, 100)).toBe(false);
    expect(aspectMismatch(1200, 300, 400, 101)).toBe(false);
    expect(aspectMismatch(1200, 300, 400, 150)).toBe(true);
    expect(aspectMismatch(300, 200, 1, 1)).toBe(true);
    expect(aspectMismatch(0, 0, 400, 100)).toBe(false);
  });
});

describe("formatBytes", () => {
  it("formats KB and MB", () => {
    expect(formatBytes(1)).toBe("1 KB");
    expect(formatBytes(300 * KB)).toBe("300 KB");
    expect(formatBytes(1536 * KB)).toBe("1.5 MB");
  });
});
