import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { analyzeFrames, collectFacts, effectiveDelay, flashesPerSecond } from "./facts";
import { assetWarnings, KB, LIMITS, type AssetInfo } from "./rules";
import { optimizeImage } from "./optimize";
import { processUpload } from "./process";
import { sniffImage } from "./image";

const W = 160;
const H = 60;

const frame = (bg: [number, number, number], box?: [number, number, number]) => {
  const base = sharp({ create: { width: W, height: H, channels: 3, background: { r: bg[0], g: bg[1], b: bg[2] } } });
  if (!box) return base.png().toBuffer();
  const overlay = sharp({ create: { width: 100, height: 30, channels: 3, background: { r: box[0], g: box[1], b: box[2] } } }).png().toBuffer();
  return overlay.then((o) => base.composite([{ input: o, left: 30, top: 15 }]).png().toBuffer());
};

async function gif(frames: Buffer[], delay: number | number[], loop = 0): Promise<Buffer> {
  return sharp(frames, { join: { animated: true } })
    .gif({ delay: Array.isArray(delay) ? delay : frames.map(() => delay), loop })
    .toBuffer();
}

describe("effectiveDelay", () => {
  it("plays delays of 10 ms or less as 100 ms, like browsers", () => {
    expect(effectiveDelay(0)).toBe(100);
    expect(effectiveDelay(10)).toBe(100);
    expect(effectiveDelay(20)).toBe(20);
  });
});

describe("flashesPerSecond", () => {
  it("counts a fast black/white alternation as a hazard", () => {
    const lums = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
    expect(flashesPerSecond(lums, lums.map(() => 100), true)).toBeGreaterThan(3);
  });
  it("does not count a slow alternation or a gentle change", () => {
    const slow = [0, 1, 0, 1];
    expect(flashesPerSecond(slow, slow.map(() => 1000), true)).toBeLessThanOrEqual(1);
    const gentle = [0.5, 0.55, 0.5, 0.55, 0.5, 0.55];
    expect(flashesPerSecond(gentle, gentle.map(() => 100), true)).toBe(0);
  });
});

describe("analyzeFrames", () => {
  const mk = (frames: Array<"blank" | "box">) => {
    const size = 32;
    const px = size * size;
    const data = new Uint8Array(frames.length * px * 4);
    frames.forEach((kind, f) => {
      for (let i = 0; i < px; i++) {
        const o = (f * px + i) * 4;
        const x = i % size;
        const y = Math.floor(i / size);
        const inBox = kind === "box" && x > 6 && x < 26 && y > 8 && y < 24;
        const c = inBox ? 20 : 255;
        data[o] = data[o + 1] = data[o + 2] = c;
        data[o + 3] = 255;
      }
    });
    return { data, frames: frames.length, size };
  };
  it("calls a content-carrying first frame complete", () => {
    expect(analyzeFrames(mk(["box", "box"]), [100, 100], 0).firstFrame).toBe("complete");
  });
  it("flags a blank first frame when later frames carry content", () => {
    expect(analyzeFrames(mk(["blank", "box", "box"]), [100, 100, 100], 0).firstFrame).toBe("blank");
  });
  it("does not judge an animation that never shows any content", () => {
    expect(analyzeFrames(mk(["blank", "blank"]), [100, 100], 0).firstFrame).toBe("complete");
  });
});

describe("collectFacts on real GIFs", () => {
  it("measures frames, duration, loop and a complete first frame", async () => {
    const f = await frame([255, 255, 255], [20, 40, 160]);
    const f2 = await frame([255, 255, 255], [20, 40, 120]); // identical neighbouring frames are merged by the encoder
    const f3 = await frame([255, 255, 255], [20, 40, 80]);
    const g = await gif([f, f2, f3], 500, 0);
    const facts = await collectFacts(g, { type: "image/gif", animated: true });
    expect(facts).toMatchObject({ frames: 3, durationMs: 1500, loopCount: 0, firstFrame: "complete" });
  });

  it("detects a blank first frame (the Outlook on Windows trap)", async () => {
    const blank = await frame([255, 255, 255]);
    const full = await frame([255, 255, 255], [20, 40, 160]);
    const facts = await collectFacts(await gif([blank, full, full], 300), { type: "image/gif", animated: true });
    expect(facts.firstFrame).toBe("blank");
  });

  it("detects a flashing GIF and a finite loop count", async () => {
    const black = await frame([0, 0, 0]);
    const white = await frame([255, 255, 255]);
    const flash = await collectFacts(await gif([black, white, black, white, black, white, black, white], 100), { type: "image/gif", animated: true });
    expect(flash.flashesPerSecond).toBeGreaterThan(3);
    const calm = await collectFacts(await gif([black, white], 1000, 2), { type: "image/gif", animated: true });
    expect(calm.flashesPerSecond ?? 0).toBeLessThanOrEqual(3);
    expect(calm.loopCount).toBe(2);
  });

  it("flags dark artwork on a transparent PNG, and not a light one or an opaque one", async () => {
    const art = (rgb: [number, number, number], alpha: number) =>
      sharp({ create: { width: 80, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: { create: { width: 40, height: 40, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha } } }, left: 20, top: 20 }])
        .png()
        .toBuffer();
    expect(await collectFacts(await art([10, 10, 10], 1), { type: "image/png", animated: false })).toMatchObject({ hasTransparency: true, darkArtwork: true });
    expect(await collectFacts(await art([240, 240, 240], 1), { type: "image/png", animated: false })).toMatchObject({ hasTransparency: true, darkArtwork: false });
    const opaque = await sharp({ create: { width: 80, height: 80, channels: 3, background: { r: 5, g: 5, b: 5 } } }).png().toBuffer();
    expect(await collectFacts(opaque, { type: "image/png", animated: false })).toMatchObject({ hasTransparency: false, darkArtwork: false });
  });

  it("never throws on garbage: facts are optional", async () => {
    expect(await collectFacts(new Uint8Array([1, 2, 3]), { type: "image/gif", animated: true })).toEqual({});
  });
});

describe("the upload pipeline records the facts", () => {
  it("returns facts from processUpload and the matching warnings", async () => {
    const blank = await frame([255, 255, 255]);
    const full = await frame([255, 255, 255], [20, 40, 160]);
    const r = await processUpload(new Uint8Array(await gif([blank, full], 400)), "banner");
    expect(r.info.frames).toBe(2);
    expect(r.info.firstFrame).toBe("blank");
    expect(r.warnings.map((w) => w.code)).toContain("gif-first-frame");
    expect(r.warnings.map((w) => w.code)).toContain("gif-loop");
  });

  it("optimizeImage keeps the original fields intact", async () => {
    const f = await frame([255, 255, 255], [20, 40, 160]);
    const buf = new Uint8Array(await gif([f, await frame([255, 255, 255], [20, 40, 100])], 200));
    const r = await optimizeImage(buf, sniffImage(buf)!, "banner");
    expect(r.info).toMatchObject({ type: "image/gif", animated: true, width: W, height: H });
  });
});

describe("assetWarnings: GIF rules", () => {
  const gifInfo = (o: Partial<AssetInfo> = {}): AssetInfo => ({ type: "image/gif", bytes: 50 * KB, width: 400, height: 100, animated: true, ...o });
  const codes = (a: AssetInfo, p?: Parameters<typeof assetWarnings>[1]) => assetWarnings(a, p).map((w) => w.code);

  it("adds nothing beyond the Outlook note when no facts are known", () => {
    expect(codes(gifInfo())).toEqual(["gif-outlook"]);
  });
  it("first frame: blank is an error, sparse a warning, complete nothing", () => {
    expect(assetWarnings(gifInfo({ firstFrame: "blank" })).find((w) => w.code === "gif-first-frame")?.severity).toBe("error");
    expect(assetWarnings(gifInfo({ firstFrame: "sparse" })).find((w) => w.code === "gif-first-frame")?.severity).toBe("warning");
    expect(codes(gifInfo({ firstFrame: "complete" }))).not.toContain("gif-first-frame");
  });
  it("too many frames", () => {
    expect(codes(gifInfo({ frames: LIMITS.gifFramesWarn + 1 }))).toContain("gif-frames");
    expect(codes(gifInfo({ frames: LIMITS.gifFramesWarn }))).not.toContain("gif-frames");
  });
  it("flashing above 3 per second is an error; 3 is allowed", () => {
    expect(assetWarnings(gifInfo({ flashesPerSecond: 4 })).find((w) => w.code === "gif-flashing")?.severity).toBe("error");
    expect(codes(gifInfo({ flashesPerSecond: 3 }))).not.toContain("gif-flashing");
  });
  it("fast frames warn only when flashing was not measured", () => {
    expect(codes(gifInfo({ minDelayMs: 50 }))).toContain("gif-fast");
    expect(codes(gifInfo({ minDelayMs: 50, flashesPerSecond: 0 }))).not.toContain("gif-fast");
  });
  it("endless loops: warning when longer than 5 s, tip when short, nothing when finite", () => {
    expect(assetWarnings(gifInfo({ loopCount: 0, durationMs: 8000 })).find((w) => w.code === "gif-loop")?.severity).toBe("warning");
    expect(assetWarnings(gifInfo({ loopCount: 0, durationMs: 2000 })).find((w) => w.code === "gif-loop")?.severity).toBe("info");
    expect(codes(gifInfo({ loopCount: 3, durationMs: 8000 }))).not.toContain("gif-loop");
  });
  it("size budget depends on purpose: 150 KB is fine for a banner, heavy for an avatar", () => {
    expect(codes(gifInfo({ bytes: 150 * KB }), "banner")).not.toContain("gif-size");
    expect(codes(gifInfo({ bytes: 150 * KB }), "avatar")).toContain("gif-size");
  });
  it("dark logos", () => {
    expect(codes({ type: "image/png", bytes: 10 * KB, width: 200, height: 200, animated: false, darkArtwork: true })).toContain("dark-logo");
  });
});
