import { hslToRgb, luminance, mapStyle, parseColor, rgbToHsl, rewriteTags, toHex, type Ancestor, type Attrs, type RGB } from "./html-tools";
import type { Change } from "./outlook-word";

/**
 * SIMULATION of automatic dark mode in email clients. Clients differ in how much of a message they recolour, and none of
 * them publishes the exact algorithm, so this is a deliberately simple model of the *documented behaviour*:
 *
 *  none     the message is shown as designed on a dark pane (Apple Mail without dark-mode CSS, Gmail on the web).
 *  partial  "Lighter background colors get darkened"; light text on dark backgrounds stays; dark text that now sits on a darkened
 *           background is lightened (Outlook.com, Outlook mobile, Gmail on Android).
 *  full     "Full inversion ... changes both light and dark backgrounds" and the text colours with them (Outlook for Windows,
 *           Gmail on iOS).
 *
 * Source: Litmus, "The Ultimate Guide to Dark Mode for Email Marketers", client support chart (February 2025 edition),
 * https://www.litmus.com/blog/the-ultimate-guide-to-dark-mode-for-email-marketers . Gmail on the web: the same chart lists no colour change; Google's
 * "CSS support in Gmail" page adds "On the web, email bodies stay on a light background."
 * (https://developers.google.com/workspace/gmail/design/css)
 *
 * The real lightness mapping is unpublished and varies by client version, so the maths below is ours: lightness l becomes
 * 0.10 + 0.15 * (1 - l) for a light background, and 1 - l (kept inside 0.12..0.92) for full inversion. Images are never
 * touched, which matches the clients: a dark logo on a transparent background can still vanish on a dark pane.
 */

export type DarkMode = "none" | "partial" | "full";

export const DARK_LABEL: Record<DarkMode, string> = {
  none: "No automatic colour change",
  partial: "Simulation of partial dark-mode inversion",
  full: "Simulation of full dark-mode inversion",
};

const COLOR_TOKEN = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g;
const isLight = (c: RGB) => luminance(c) > 0.4;

function darkenBg(c: RGB): RGB {
  const { h, s, l } = rgbToHsl(c);
  return hslToRgb({ h, s: s * 0.8, l: 0.1 + 0.15 * (1 - l) });
}
function invert(c: RGB): RGB {
  const { h, s, l } = rgbToHsl(c);
  return hslToRgb({ h, s, l: Math.min(0.92, Math.max(0.12, 1 - l)) });
}
function lighten(c: RGB): RGB {
  const { h, s, l } = rgbToHsl(c);
  return hslToRgb({ h, s, l: Math.max(0.78, 1 - l) });
}

function bgOf(attrs: Attrs): RGB | null {
  const bg = attrs.get("bgcolor");
  if (bg) {
    const c = parseColor(bg);
    if (c) return c;
  }
  const st = attrs.get("style");
  if (st) {
    const m = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i.exec(st);
    if (m) {
      const t = m[1].match(COLOR_TOKEN)?.[0] ?? m[1].trim();
      return parseColor(t);
    }
  }
  return null;
}

function bump(map: Map<string, Change>, code: string) {
  const c = map.get(code);
  if (c) c.count++;
  else map.set(code, { code, count: 1 });
}

export function simulateDark(html: string, mode: DarkMode): { html: string; changes: Change[] } {
  if (mode === "none") return { html, changes: [] };
  const changes = new Map<string, Change>();

  const recolor = (value: string, f: (c: RGB) => RGB): string =>
    value.replace(COLOR_TOKEN, (tok) => {
      const c = parseColor(tok);
      return c ? toHex(f(c)) : tok;
    });

  // Ancestors share their attribute maps with the rewrite below, so remember each element's ORIGINAL background.
  const original = new WeakMap<Attrs, RGB | null>();

  const out = rewriteTags(html, (tag, ancestors: readonly Ancestor[]) => {
    // Colour of the surface this element sits on, as designed. The bare message pane counts as white.
    let surface: RGB = { r: 255, g: 255, b: 255 };
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const b = original.get(ancestors[i].attrs);
      if (b) {
        surface = b;
        break;
      }
    }
    const own = bgOf(tag.attrs);
    original.set(tag.attrs, own);
    const surfaceHere = own ?? surface;

    // Backgrounds.
    const bgFix = (c: RGB): RGB => {
      if (isLight(c)) {
        bump(changes, "dark-background-darkened");
        return darkenBg(c);
      }
      if (mode === "full") {
        bump(changes, "dark-background-inverted");
        return invert(c);
      }
      return c;
    };
    const bgAttr = tag.attrs.get("bgcolor");
    if (bgAttr) {
      const c = parseColor(bgAttr);
      if (c) tag.attrs.set("bgcolor", toHex(bgFix(c)));
    }

    mapStyle(tag, (d) => {
      if (d.prop === "background-color" || d.prop === "background") return { prop: d.prop, value: recolor(d.value, bgFix) };
      if (d.prop === "color") {
        const c = parseColor(d.value);
        if (!c) return d;
        if (mode === "full") {
          bump(changes, "dark-text-inverted");
          return { prop: d.prop, value: toHex(invert(c)) };
        }
        // partial: only dark text on a surface that has just been darkened is lightened.
        if (!isLight(c) && isLight(surfaceHere)) {
          bump(changes, "dark-text-lightened");
          return { prop: d.prop, value: toHex(lighten(c)) };
        }
        return d;
      }
      if (mode === "full" && (d.prop === "border" || d.prop.startsWith("border-"))) return { prop: d.prop, value: recolor(d.value, invert) };
      return d;
    });
  });

  return { html: out, changes: [...changes.values()] };
}
