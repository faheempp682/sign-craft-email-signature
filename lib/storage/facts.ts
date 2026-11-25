import sharp from "sharp";
import type { AssetInfo } from "./rules";

/** Side of the square thumbnail each frame is reduced to for analysis. Small on purpose: this runs on every upload. */
export const SAMPLE = 32;

export type RgbaFrames = { data: Uint8Array; frames: number; size: number };

type Facts = Pick<
  AssetInfo,
  "frames" | "durationMs" | "minDelayMs" | "loopCount" | "firstFrame" | "firstFrameCoverage" | "peakCoverage" | "flashesPerSecond" | "hasTransparency" | "darkArtwork"
>;

/** sRGB channel (0-255) to linear light, as WCAG defines relative luminance. */
const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** Browsers play GIF frame delays of 10 ms or less as 100 ms, so that is what recipients actually see. */
export const effectiveDelay = (ms: number) => (ms <= 10 ? 100 : ms);

type FrameStat = { coverage: number; transparent: number; meanLum: number };

/**
 * How much of one frame carries "content". A pixel is content when it is opaque and differs from the frame's
 * dominant colour (its background). A mostly transparent frame counts its opaque pixels instead.
 */
function frameStat(px: Uint8Array, offset: number, pixels: number): FrameStat {
  let transparent = 0;
  let lumSum = 0;
  const buckets = new Map<number, number>();
  for (let i = 0; i < pixels; i++) {
    const o = offset + i * 4;
    const a = px[o + 3] / 255;
    // Composite over white: an email signature normally sits on a light page, and it keeps the maths one-dimensional.
    const r = px[o] * a + 255 * (1 - a);
    const g = px[o + 1] * a + 255 * (1 - a);
    const b = px[o + 2] * a + 255 * (1 - a);
    lumSum += lum(r, g, b);
    if (px[o + 3] < 32) {
      transparent++;
      continue;
    }
    const key = ((px[o] >> 4) << 8) | ((px[o + 1] >> 4) << 4) | (px[o + 2] >> 4);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const transparentFrac = transparent / pixels;
  let coverage: number;
  if (transparentFrac > 0.5) {
    coverage = 1 - transparentFrac;
  } else {
    let mode = -1;
    let best = 0;
    for (const [k, n] of buckets) {
      if (n > best) {
        best = n;
        mode = k;
      }
    }
    const mr = ((mode >> 8) & 15) * 16 + 8;
    const mg = ((mode >> 4) & 15) * 16 + 8;
    const mb = (mode & 15) * 16 + 8;
    let content = 0;
    for (let i = 0; i < pixels; i++) {
      const o = offset + i * 4;
      if (px[o + 3] < 32) continue;
      if (Math.max(Math.abs(px[o] - mr), Math.abs(px[o + 1] - mg), Math.abs(px[o + 2] - mb)) > 40) content++;
    }
    coverage = content / pixels;
  }
  return { coverage, transparent: transparentFrac, meanLum: lumSum / pixels };
}

/**
 * WCAG 2.3.1 asks for no more than three flashes in any one second. A flash is a pair of opposite, significant
 * (10% of the luminance range or more) changes in brightness. This measures whole-frame brightness, so it can miss a
 * flash that only covers part of the picture: it is a screen, not a certification.
 */
export function flashesPerSecond(lums: number[], delays: number[], loops: boolean): number {
  const n = lums.length;
  if (n < 2) return 0;
  const seq = loops ? 2 : 1; // an endlessly looping animation also flashes at the seam between its last and first frame
  const events: { t: number; sign: number }[] = [];
  let t = 0;
  let prevLum = lums[0];
  for (let rep = 0; rep < seq; rep++) {
    for (let i = rep === 0 ? 1 : 0; i < n; i++) {
      t += effectiveDelay(delays[i === 0 ? n - 1 : i - 1] ?? 100);
      const d = lums[i] - prevLum;
      if (Math.abs(d) >= 0.1) {
        const sign = d > 0 ? 1 : -1;
        const last = events[events.length - 1];
        if (!last || last.sign !== sign) events.push({ t, sign });
      }
      prevLum = lums[i];
    }
  }
  let most = 0;
  for (let j = 0; j < events.length; j++) {
    let c = 0;
    for (let k = j; k < events.length && events[k].t - events[j].t < 1000; k++) c++;
    most = Math.max(most, c);
  }
  return Math.floor(most / 2);
}

/** Pure analysis of already-decoded frames, so it can be tested without an image library. */
export function analyzeFrames(rgba: RgbaFrames, delays: number[], loopCount: number | undefined): Partial<Facts> {
  const { data, frames, size } = rgba;
  const pixels = size * size;
  const stats: FrameStat[] = [];
  for (let f = 0; f < frames; f++) stats.push(frameStat(data, f * pixels * 4, pixels));
  const first = stats[0];
  const peak = Math.max(...stats.map((s) => s.coverage));

  let firstFrame: Facts["firstFrame"] = "complete";
  if (peak >= 0.05) {
    if (first.coverage < 0.02 || first.transparent > 0.9) firstFrame = "blank";
    else if (first.coverage < peak * 0.35) firstFrame = "sparse";
  }

  const eff = delays.map((d) => effectiveDelay(d));
  const durationMs = eff.reduce((s, d) => s + d, 0);
  return {
    frames,
    durationMs,
    minDelayMs: delays.length ? Math.min(...delays) : undefined,
    loopCount,
    firstFrame,
    firstFrameCoverage: Math.round(first.coverage * 1000) / 1000,
    peakCoverage: Math.round(peak * 1000) / 1000,
    flashesPerSecond: flashesPerSecond(stats.map((s) => s.meanLum), delays, loopCount === 0 || loopCount === undefined),
  };
}

/** Dark artwork on a transparent background is invisible on a dark email background. Measured from the first frame. */
export function analyzeStill(rgba: RgbaFrames): Partial<Facts> {
  const { data, size } = rgba;
  const pixels = size * size;
  let transparent = 0;
  let opaque = 0;
  let lumSum = 0;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    if (data[o + 3] < 32) {
      transparent++;
    } else if (data[o + 3] >= 200) {
      opaque++;
      lumSum += lum(data[o], data[o + 1], data[o + 2]);
    }
  }
  const hasTransparency = transparent / pixels > 0.05;
  const darkArtwork = hasTransparency && opaque > 0 && lumSum / opaque < 0.12;
  return { hasTransparency, darkArtwork };
}

async function decode(buf: Uint8Array, animated: boolean, pages: number): Promise<RgbaFrames | null> {
  const { data, info } = await sharp(buf, { animated, limitInputPixels: 50_000_000, failOn: "error" })
    .resize(SAMPLE, SAMPLE, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const frames = animated ? pages : 1;
  // Each frame must have come out as SAMPLE x SAMPLE pixels, stacked top to bottom. Anything else: do not guess.
  if (info.width !== SAMPLE || info.height !== SAMPLE * frames || info.channels !== 4) return null;
  return { data, frames, size: SAMPLE };
}

/**
 * Facts about an already-optimized image that the checker can use later. Never throws: facts are advice, and a
 * failure to measure them must not fail an upload (the field is simply left out).
 */
export async function collectFacts(buf: Uint8Array, info: Pick<AssetInfo, "type" | "animated">): Promise<Partial<Facts>> {
  try {
    if (info.type === "image/jpeg") return { hasTransparency: false, darkArtwork: false };
    if (!info.animated) return info.type === "image/png" || info.type === "image/gif" ? analyzeStill((await decode(buf, false, 1))!) : {};
    const meta = await sharp(buf, { animated: true, limitInputPixels: 50_000_000 }).metadata();
    const pages = meta.pages ?? 1;
    const rgba = await decode(buf, true, pages);
    if (!rgba) return { frames: pages };
    const delays = (meta.delay ?? []).slice(0, pages);
    while (delays.length < pages) delays.push(100);
    return { ...analyzeFrames(rgba, delays, meta.loop), ...analyzeStill({ ...rgba, data: rgba.data.subarray(0, SAMPLE * SAMPLE * 4), frames: 1 }) };
  } catch {
    return {};
  }
}
