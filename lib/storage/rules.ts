/**
 * One source of truth for image limits. The server uses it to decide what to optimize, and the compatibility
 * checker uses it to explain what is still wrong. Pure and client-safe: no image library is imported here.
 */

export const KB = 1024;

export const LIMITS = {
  /** Largest file accepted at all. Bigger images are optimized down, so this is higher than the final-size targets. */
  uploadMaxBytes: 5 * 1024 * KB,
  /** PROJECT.md section 12: animated GIFs should stay under 200-300 KB. */
  gifWarnBytes: 300 * KB,
  gifErrorBytes: 1024 * KB,
  staticWarnBytes: 200 * KB,
  /** Hard cap on animation length, to bound server work. */
  maxFrames: 300,
  /** Decoded-pixel cap (per image or per animation), so a small file cannot expand into gigabytes of RAM. */
  maxPixels: 50_000_000,
  /** Smaller than this in either direction looks blurry once it is scaled up in an email. */
  minDimension: 40,
  /** Longest side kept after optimization, in pixels: roughly 2x the size at which each kind is displayed. */
  maxSide: { avatar: 400, banner: 1200, image: 1200 },
  /** An animated avatar is small and sits next to the text, so it gets a tighter budget than a banner. */
  gifAvatarWarnBytes: 100 * KB,
  /** More frames than this rarely adds anything a recipient can see, and every frame costs bytes. */
  gifFramesWarn: 40,
  /** WCAG 2.2.2: movement that lasts longer than this needs a way to pause, stop or hide it. */
  gifStopSeconds: 5,
  /** WCAG 2.3.1: no more than this many flashes in any one second. */
  flashLimit: 3,
} as const;

export type UploadPurpose = keyof typeof LIMITS.maxSide;
export const UPLOAD_PURPOSES = Object.keys(LIMITS.maxSide) as UploadPurpose[];

export type AssetInfo = {
  type: "image/png" | "image/jpeg" | "image/gif";
  /** Size of the stored (optimized) file. */
  bytes: number;
  width: number;
  height: number;
  animated: boolean;
  /** Size of the file as uploaded, when it was optimized. */
  originalBytes?: number;

  /* ---- Additive facts recorded at upload time. All optional: older images and pasted URLs have none of them. ---- */
  /** Animated GIFs: number of frames. */
  frames?: number;
  /** Animated GIFs: one full pass, in ms, with browser delay clamping applied (delays of 10 ms or less play as 100 ms). */
  durationMs?: number;
  /** Animated GIFs: the shortest frame delay in the file, in ms, as stored. */
  minDelayMs?: number;
  /** Animated GIFs: how many times it repeats; 0 means forever. */
  loopCount?: number;
  /** Animated GIFs: does frame 1 (all that Outlook on Windows shows) carry the message? */
  firstFrame?: "complete" | "sparse" | "blank";
  /** Share of frame 1 (0-1) that is content rather than background, and the same for the fullest frame. */
  firstFrameCoverage?: number;
  peakCoverage?: number;
  /** Animated GIFs: worst measured flashes in any one second (WCAG 2.3.1 allows 3). Whole-frame brightness only. */
  flashesPerSecond?: number;
  /** PNG / GIF: a meaningful part of the image is transparent. */
  hasTransparency?: boolean;
  /** Transparent image whose visible artwork is dark, so it will vanish on a dark email background. */
  darkArtwork?: boolean;
};

export type AssetWarning = { code: string; severity: "error" | "warning" | "info"; message: string };

export const formatBytes = (n: number): string => (n >= 1024 * KB ? `${(n / (1024 * KB)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / KB))} KB`);

/** What is still wrong with an image that is already stored. Optimization happens first, so these are the leftovers. */
export function assetWarnings(a: AssetInfo, purpose?: UploadPurpose): AssetWarning[] {
  const out: AssetWarning[] = [];

  if (a.animated) {
    if (purpose === "avatar" && a.bytes > LIMITS.gifAvatarWarnBytes && a.bytes <= LIMITS.gifWarnBytes) {
      out.push({ code: "gif-size", severity: "warning", message: `This animated GIF is ${formatBytes(a.bytes)}. For a small photo or logo, keep it under ${formatBytes(LIMITS.gifAvatarWarnBytes)}: it sits next to the text and should not slow the whole signature.` });
    } else if (a.bytes > LIMITS.gifErrorBytes) {
      out.push({ code: "gif-size", severity: "error", message: `This animated GIF is ${formatBytes(a.bytes)}. Over 1 MB, most email clients will stall or skip it. Shorten the animation, use fewer colours, or make it smaller.` });
    } else if (a.bytes > LIMITS.gifWarnBytes) {
      out.push({ code: "gif-size", severity: "warning", message: `This animated GIF is ${formatBytes(a.bytes)}, over the ${formatBytes(LIMITS.gifWarnBytes)} guideline. It will load slowly. Shorten the animation, use fewer colours, or make it smaller.` });
    }
    out.push({ code: "gif-outlook", severity: "info", message: "Outlook on Windows shows only the first frame of an animated GIF. Make sure that frame works on its own." });

    if (a.firstFrame === "blank") {
      out.push({ code: "gif-first-frame", severity: "error", message: "The first frame of this GIF is mostly empty. Outlook on Windows shows only that frame, so those readers see a blank or near-blank image. Put the full message in the first frame, then animate from there." });
    } else if (a.firstFrame === "sparse") {
      out.push({ code: "gif-first-frame", severity: "warning", message: "The first frame of this GIF carries much less than the later frames. Outlook on Windows shows only the first frame, so those readers miss part of the message. Make the first frame complete." });
    }
    if (a.frames !== undefined && a.frames > LIMITS.gifFramesWarn) {
      out.push({ code: "gif-frames", severity: "warning", message: `This GIF has ${a.frames} frames. Beyond about ${LIMITS.gifFramesWarn} the file gets heavy for little visible gain. Use fewer frames or a shorter animation.` });
    }
    if (a.flashesPerSecond !== undefined && a.flashesPerSecond > LIMITS.flashLimit) {
      out.push({ code: "gif-flashing", severity: "error", message: `This GIF flashes about ${a.flashesPerSecond} times a second. More than ${LIMITS.flashLimit} flashes a second can trigger seizures (WCAG 2.3.1). Slow it down or remove the strong light-dark changes.` });
    } else if (a.flashesPerSecond === undefined && a.minDelayMs !== undefined && a.minDelayMs <= 160) {
      out.push({ code: "gif-fast", severity: "warning", message: "Some frames of this GIF last under a fifth of a second. If they alternate between light and dark that is a flashing hazard (WCAG 2.3.1) and hard to read. Slow it down." });
    }
    if (a.loopCount === 0) {
      const long = (a.durationMs ?? 0) > LIMITS.gifStopSeconds * 1000;
      out.push({
        code: "gif-loop",
        severity: long ? "warning" : "info",
        message: long
          ? `This GIF runs ${Math.round((a.durationMs ?? 0) / 1000)} seconds and repeats forever. Movement over ${LIMITS.gifStopSeconds} seconds needs a way to pause it (WCAG 2.2.2), and email has none. Set it to loop 2 or 3 times, or keep one pass under ${LIMITS.gifStopSeconds} seconds.`
          : "This GIF repeats forever. Consider limiting it to a few loops so it settles on the final frame and stops distracting.",
      });
    }
  } else if (a.bytes > LIMITS.staticWarnBytes) {
    out.push({ code: "image-size", severity: "warning", message: `This image is ${formatBytes(a.bytes)}, over the ${formatBytes(LIMITS.staticWarnBytes)} guideline. Heavy images slow the message and are more likely to be blocked.` });
  }

  if (a.darkArtwork) {
    out.push({ code: "dark-logo", severity: "warning", message: "This image has a transparent background and dark artwork. On a dark email background (dark mode) it can nearly disappear. Give it a light outline or a solid light background, or use a lighter version." });
  }

  if (a.width < LIMITS.minDimension || a.height < LIMITS.minDimension) {
    out.push({ code: "image-tiny", severity: "info", message: `This image is only ${a.width}×${a.height} px, so it will look blurry when shown at normal size.` });
  }
  return out;
}

/** True when the image's shape differs from the shape it is displayed in by more than `tolerance` (a fraction). */
export function aspectMismatch(naturalW: number, naturalH: number, shownW: number, shownH: number, tolerance = 0.05): boolean {
  if (naturalW <= 0 || naturalH <= 0 || shownW <= 0 || shownH <= 0) return false;
  const natural = naturalW / naturalH;
  const shown = shownW / shownH;
  return Math.abs(shown - natural) / natural > tolerance;
}
