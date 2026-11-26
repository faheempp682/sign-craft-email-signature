import { adjustToContrast } from "@/lib/linter/contrast";
import type { SignatureDoc } from "@/lib/schema/document";

/** What the studio remembers about the logo's colours. `palette` is up to four colours, most prominent first. */
export type Brand = { on: boolean; palette: string[]; pick: number };

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/**
 * The most prominent brand-like colours in an image's RGBA pixels. Transparent, near-white, near-black and grey pixels are
 * skipped (they are background or ink, not the brand), the rest are grouped, and a colour too close to one already chosen is
 * not offered twice. A black-and-white logo returns [], since it has no colour to match.
 */
export function brandPalette(pixels: ArrayLike<number>, max = 4, loose = false): string[] {
  const minAlpha = loose ? 16 : 128, minSat = loose ? 0.1 : 0.22, minShare = loose ? 0 : 0.02;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number; weight: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
    if (a < minAlpha) continue;
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    const sat = hi === 0 ? 0 : (hi - lo) / hi;
    if (hi < 40 || (lo > 225 && sat < 0.15) || sat < minSat) continue; // black, white, grey
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, weight: 0 };
    cur.n++;
    cur.r += r;
    cur.g += g;
    cur.b += b;
    cur.weight += sat; // saturated colours count for more than washed-out ones
    buckets.set(key, cur);
  }
  const total = [...buckets.values()].reduce((s, x) => s + x.n, 0);
  const ranked = [...buckets.values()].filter((x) => x.n >= Math.max(loose ? 1 : 2, total * minShare)).sort((a, b) => b.weight - a.weight);
  const out: [number, number, number][] = [];
  for (const x of ranked) {
    const c: [number, number, number] = [x.r / x.n, x.g / x.n, x.b / x.n];
    if (out.every((o) => Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]) > 90)) out.push(c);
    if (out.length === max) break;
  }
  return out.map(([r, g, b]) => hex(r, g, b));
}

/**
 * The template in the brand's colours: the main colour (badges, strips, names) becomes the chosen one and the secondary
 * accent the next. Each is nudged just enough to stay readable on the template's own card colour; the layout, background
 * and text colour stay the designer's.
 */
export function applyBrand(doc: SignatureDoc, brand: Brand | null | undefined): SignatureDoc {
  if (!brand?.on || !brand.palette.length) return doc;
  const primary = brand.palette[brand.pick % brand.palette.length];
  const second = brand.palette.length > 1 ? brand.palette[(brand.pick + 1) % brand.palette.length] : undefined;
  const bg = doc.theme.bg;
  return {
    ...doc,
    theme: {
      ...doc.theme,
      primary: adjustToContrast(primary, bg, 3),
      ...(second ? { accent2: adjustToContrast(second, bg, 2) } : {}),
    },
  };
}

/** Reads the colours of a picture in the browser (a file, or an address whose server allows it). [] when it cannot be read. */
export async function paletteFromImage(source: Blob | string): Promise<string[]> {
  try {
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    const img = new window.Image();
    if (typeof source === "string") img.crossOrigin = "anonymous"; // without it the canvas cannot be read back
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("load"));
      img.src = url;
    });
    if (typeof source !== "string") URL.revokeObjectURL(url);
    const size = 128; // plenty to find the dominant colours, and quick
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    return brandPalette(data).length ? brandPalette(data) : brandPalette(data, 4, true); // a thin or faint logo: retry with looser limits
  } catch (e) {
    console.warn("Could not read the logo's colours:", e);
    return [];
  }
}
