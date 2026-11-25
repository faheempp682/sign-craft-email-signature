const toRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** WCAG 2.x relative luminance of a #RRGGBB colour. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Nudges `fg` toward black or white (whichever reaches the target) until it meets `target` contrast against `bg`. */
export function adjustToContrast(fg: string, bg: string, target = 4.5): string {
  if (contrast(fg, bg) >= target) return fg;
  const towardBlack = luminance(bg) > 0.4;
  const end: [number, number, number] = towardBlack ? [0, 0, 0] : [255, 255, 255];
  const start = toRgb(fg);
  for (let step = 1; step <= 20; step++) {
    const t = step / 20;
    const candidate = toHex(start.map((v, i) => v + (end[i] - v) * t) as [number, number, number]);
    if (contrast(candidate, bg) >= target) return candidate;
  }
  return toHex(end);
}
