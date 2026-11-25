/** Shared limits and option validation for the animated GIF maker. Pure and client-safe. */

import { z } from "zod";

export const GIF_LIMITS = {
  minFrames: 2,
  maxFrames: 6,
  /** Per frame, as uploaded. */
  maxFrameBytes: 2 * 1024 * 1024,
  /** Per frame, decoded (width x height). Keeps six frames far below the 50-megapixel server-wide cap. */
  maxFramePixels: 12_000_000,
  /** Whole request body: six frames plus form overhead. */
  maxBodyBytes: 6 * 2 * 1024 * 1024 + 256 * 1024,
  /** Refuse to return anything bigger than this, even after colours were reduced. The upload route enforces its own rules afterwards. */
  maxOutputBytes: 3 * 1024 * 1024,
  minDelayMs: 100,
  maxDelayMs: 10_000,
  defaultDelayMs: 1000,
  /** 0 means loop forever. */
  maxLoops: 10,
  width: { min: 100, max: 600 },
  height: { min: 20, max: 300 },
} as const;

const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** Everything besides the image files themselves. `delays` has one entry per frame. */
export const GifOptionsSchema = z
  .object({
    delays: z.array(int(GIF_LIMITS.minDelayMs, GIF_LIMITS.maxDelayMs)).min(GIF_LIMITS.minFrames).max(GIF_LIMITS.maxFrames),
    loop: int(0, GIF_LIMITS.maxLoops),
    width: int(GIF_LIMITS.width.min, GIF_LIMITS.width.max),
    height: int(GIF_LIMITS.height.min, GIF_LIMITS.height.max),
  })
  .strict();

export type GifOptions = z.infer<typeof GifOptionsSchema>;

/** The size of the finished GIF against the email guidelines (PROJECT.md section 12; the same numbers lib/storage/rules.ts uses). */
export type SizeLevel = "ok" | "warning" | "error";
export function sizeLevel(bytes: number, warnAt: number, errorAt: number): SizeLevel {
  return bytes > errorAt ? "error" : bytes > warnAt ? "warning" : "ok";
}
