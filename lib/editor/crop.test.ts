import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/storage/rules";
import {
  MAX_ZOOM,
  MIN_CROP_PX,
  baseCropSize,
  canCrop,
  clampState,
  clampZoom,
  cropRect,
  croppedName,
  initialState,
  maskRadius,
  maxZoomFor,
  nudge,
  outputSize,
  outputType,
  panBy,
  workingScale,
  zoomBy,
  zoomTo,
} from "./crop";

const inside = (r: { x: number; y: number; w: number; h: number }, img: { w: number; h: number }) => {
  const e = 1e-6;
  return r.x >= -e && r.y >= -e && r.x + r.w <= img.w + e && r.y + r.h <= img.h + e;
};

describe("baseCropSize", () => {
  it("is the largest region of the aspect that fits", () => {
    expect(baseCropSize({ w: 1000, h: 500 }, 1)).toEqual({ w: 500, h: 500 });
    expect(baseCropSize({ w: 500, h: 1000 }, 1)).toEqual({ w: 500, h: 500 });
    expect(baseCropSize({ w: 1000, h: 1000 }, 4)).toEqual({ w: 1000, h: 250 });
    expect(baseCropSize({ w: 1200, h: 200 }, 2)).toEqual({ w: 400, h: 200 });
  });
  it("falls back to square for a nonsense aspect", () => {
    expect(baseCropSize({ w: 100, h: 80 }, 0)).toEqual({ w: 80, h: 80 });
    expect(baseCropSize({ w: 100, h: 80 }, NaN)).toEqual({ w: 80, h: 80 });
    expect(baseCropSize({ w: 100, h: 80 }, -3)).toEqual({ w: 80, h: 80 });
  });
});

describe("zoom limits", () => {
  const img = { w: 2000, h: 1000 };
  it("clamps into [1, max]", () => {
    expect(clampZoom(0.2, img, 1)).toBe(1);
    expect(clampZoom(50, img, 1)).toBe(maxZoomFor(img, 1));
    expect(clampZoom(NaN, img, 1)).toBe(1);
    expect(clampZoom(Infinity, img, 1)).toBe(1); // garbage fails closed to "no zoom"
  });
  it("never goes past MAX_ZOOM", () => {
    expect(maxZoomFor({ w: 9000, h: 9000 }, 1)).toBe(MAX_ZOOM);
  });
  it("stops a small image from being magnified into mush", () => {
    // 60 px image: the region may not go under MIN_CROP_PX
    const small = { w: 60, h: 60 };
    const z = maxZoomFor(small, 1);
    expect(z).toBeCloseTo(60 / MIN_CROP_PX, 6);
    expect(60 / z).toBeGreaterThanOrEqual(MIN_CROP_PX - 1e-9);
  });
  it("a tiny image still has a usable zoom of exactly 1", () => {
    expect(maxZoomFor({ w: 10, h: 10 }, 1)).toBe(1);
  });
});

describe("clampState / initialState", () => {
  const img = { w: 1600, h: 900 };
  it("centres the first crop", () => {
    const s = initialState(img, 1);
    expect(s).toEqual({ zoom: 1, cx: 800, cy: 450 });
    expect(cropRect(s, img, 1)).toEqual({ x: 350, y: 0, w: 900, h: 900 });
  });
  it("keeps the region inside the image for any centre", () => {
    for (const cx of [-1e9, -5, 0, 800, 1600, 1e9, NaN]) {
      for (const cy of [-1e9, 0, 450, 900, 1e9, NaN]) {
        for (const zoom of [0, 1, 2.5, 8, 100, NaN]) {
          const r = cropRect({ zoom, cx, cy }, img, 16 / 9);
          expect(inside(r, img)).toBe(true);
          expect(r.w).toBeGreaterThan(0);
        }
      }
    }
  });
  it("keeps the requested aspect ratio", () => {
    for (const a of [1, 4, 0.5, 16 / 9]) {
      const r = cropRect({ zoom: 3, cx: 700, cy: 400 }, img, a);
      expect(r.w / r.h).toBeCloseTo(a, 6);
    }
  });
});

describe("panBy", () => {
  const img = { w: 1000, h: 1000 };
  const view = { w: 300, h: 300 };
  it("drags the picture with the pointer (region moves the opposite way)", () => {
    const s = zoomTo(initialState(img, 1), 2, img, 1);
    const moved = panBy(s, 30, 0, view, img, 1);
    expect(moved.cx).toBeLessThan(s.cx);
    expect(moved.cy).toBe(s.cy);
    const up = panBy(s, 0, -30, view, img, 1);
    expect(up.cy).toBeGreaterThan(s.cy);
  });
  it("moves one screen pixel by region/view source pixels", () => {
    const s = zoomTo(initialState(img, 1), 2, img, 1); // region is 500 px wide
    const moved = panBy(s, 30, 0, view, img, 1);
    expect(s.cx - moved.cx).toBeCloseTo((30 * 500) / 300, 6);
  });
  it("cannot be dragged past an edge", () => {
    const s = zoomTo(initialState(img, 1), 2, img, 1);
    const far = panBy(s, 1e6, 1e6, view, img, 1);
    expect(inside(cropRect(far, img, 1), img)).toBe(true);
    expect(cropRect(far, img, 1).x).toBe(0);
    expect(cropRect(far, img, 1).y).toBe(0);
  });
  it("does nothing useful at zoom 1 on a square image (nowhere to go)", () => {
    const s = initialState(img, 1);
    expect(panBy(s, 100, 100, view, img, 1)).toEqual(s);
  });
  it("survives a zero-size viewport", () => {
    const s = initialState(img, 1);
    expect(panBy(s, 10, 10, { w: 0, h: 0 }, img, 1)).toEqual(s);
  });
});

describe("nudge", () => {
  it("moves by a fraction of the visible region and stays inside", () => {
    const img = { w: 2000, h: 1000 };
    const s = initialState(img, 1); // 1000 px region, centred at 1000
    expect(nudge(s, 0.1, 0, img, 1).cx).toBeCloseTo(1100, 6);
    expect(nudge(s, -10, 0, img, 1).cx).toBe(500); // clamped at the left edge
    expect(nudge(s, 0, 1, img, 1).cy).toBe(500); // no vertical room
  });
});

describe("zoomTo / zoomBy", () => {
  const img = { w: 2000, h: 2000 };
  it("keeps the centre when zooming about the centre", () => {
    const s = { zoom: 1, cx: 1000, cy: 1000 };
    const z = zoomTo(s, 2, img, 1);
    expect(z.zoom).toBe(2);
    expect(z.cx).toBeCloseTo(1000, 6);
    expect(cropRect(z, img, 1).w).toBeCloseTo(1000, 6);
  });
  it("keeps the point under the focus fixed", () => {
    const s = { zoom: 2, cx: 900, cy: 900 };
    const before = cropRect(s, img, 1);
    const focus = { x: 0.25, y: 0.75 };
    const pBefore = { x: before.x + focus.x * before.w, y: before.y + focus.y * before.h };
    const z = zoomTo(s, 4, img, 1, focus);
    const after = cropRect(z, img, 1);
    expect(after.x + focus.x * after.w).toBeCloseTo(pBefore.x, 6);
    expect(after.y + focus.y * after.h).toBeCloseTo(pBefore.y, 6);
  });
  it("zooming out is clamped at 1 and the region stays inside", () => {
    const z = zoomTo({ zoom: 4, cx: 200, cy: 200 }, 0.1, img, 1);
    expect(z.zoom).toBe(1);
    expect(inside(cropRect(z, img, 1), img)).toBe(true);
  });
  it("zoomBy multiplies, ignoring bad factors", () => {
    const s = initialState(img, 1);
    expect(zoomBy(s, 2, img, 1).zoom).toBe(2);
    expect(zoomBy(s, 0, img, 1).zoom).toBe(1);
    expect(zoomBy(s, NaN, img, 1).zoom).toBe(1);
    expect(zoomBy(s, 1000, img, 1).zoom).toBe(maxZoomFor(img, 1));
  });
});

describe("outputSize", () => {
  it("never enlarges a small region", () => {
    expect(outputSize({ w: 120, h: 120 }, "avatar")).toEqual({ w: 120, h: 120 });
  });
  it("caps the longest side at LIMITS.maxSide for the purpose", () => {
    expect(outputSize({ w: 3000, h: 3000 }, "avatar")).toEqual({ w: LIMITS.maxSide.avatar, h: LIMITS.maxSide.avatar });
    const b = outputSize({ w: 4800, h: 1200 }, "banner");
    expect(b).toEqual({ w: LIMITS.maxSide.banner, h: 300 });
    expect(Math.max(b.w, b.h)).toBeLessThanOrEqual(LIMITS.maxSide.banner);
  });
  it("keeps the aspect ratio and never returns zero", () => {
    const o = outputSize({ w: 10000, h: 3, }, "banner");
    expect(o.w).toBe(1200);
    expect(o.h).toBe(1);
    expect(outputSize({ w: 0.2, h: 0.2 }, "avatar")).toEqual({ w: 1, h: 1 });
  });
});

describe("workingScale", () => {
  it("leaves normal images alone and shrinks huge ones to the cap", () => {
    expect(workingScale({ w: 3000, h: 2000 })).toBe(1);
    expect(workingScale({ w: 8192, h: 4096 })).toBe(0.5);
    expect(workingScale({ w: 4096, h: 4096 })).toBe(1);
  });
});

describe("helpers", () => {
  it("maskRadius matches the renderer shapes", () => {
    expect(maskRadius("circle")).toBe("50%");
    expect(maskRadius("rounded")).toBe("15%");
    expect(maskRadius("square")).toBe("0");
    expect(maskRadius(undefined)).toBe("0");
    expect(maskRadius("arch")).toContain("50% 50% 0 0");
  });
  it("keeps PNG as PNG and turns everything else into JPEG", () => {
    expect(outputType("image/png").mime).toBe("image/png");
    expect(outputType("image/jpeg")).toMatchObject({ mime: "image/jpeg", ext: "jpg" });
    expect(outputType("image/webp").mime).toBe("image/jpeg");
  });
  it("builds a safe file name", () => {
    expect(croppedName("My Photo (1).JPG", "jpg")).toBe("My-Photo-1-cropped.jpg");
    expect(croppedName("", "png")).toBe("image-cropped.png");
    expect(croppedName("../../etc/passwd", "png")).not.toContain("/");
  });
  it("only crops still formats", () => {
    expect(canCrop({ type: "image/png" })).toBe(true);
    expect(canCrop({ type: "image/jpeg" })).toBe(true);
    expect(canCrop({ type: "image/gif" })).toBe(false);
    expect(canCrop({ type: "" })).toBe(false);
  });
  it("clampState is idempotent", () => {
    const img = { w: 800, h: 600 };
    const once = clampState({ zoom: 3, cx: -50, cy: 9999 }, img, 1);
    expect(clampState(once, img, 1)).toEqual(once);
  });
});
