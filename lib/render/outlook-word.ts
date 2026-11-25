import { mapStyle, rewriteTags, type Decl } from "./html-tools";

/**
 * SIMULATION of Outlook for Windows (classic), whose HTML is laid out by Microsoft Word's engine.
 *
 * This is NOT Outlook. It rewrites the signature HTML according to documented Word-engine behaviour and then lets Chrome
 * draw the result. Chrome still lays out tables with its own algorithm, so spacing and text metrics differ by a few
 * pixels from the real thing. What it reliably shows is which features disappear. Always confirm in a real Outlook.
 *
 * Sources (every rule below cites one):
 *  [MS]  Microsoft, "Word 2007 HTML and CSS Rendering Capabilities in Outlook 2007 (Part 1 of 2)", Zeyad Rajabi and Erika Ehrli,
 *        https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2007/aa338201(v=office.12)
 *        Lists the CSS properties Word supports per element (CORE for span and body, COREEXTENDED for div and p, FULL for the
 *        rest) and says "Word 2007 considers unsupported cascading style sheet properties to be unknown properties", so they are
 *        ignored. That list has no border-radius, box-shadow, opacity, gradients, flex, grid, transform, max-width, overflow-wrap
 *        or word-break, and names background-image, float, max-width, min-width, overflow, position, text-shadow as unsupported.
 *        Also: "Animated GIF images. Only a static representation of the GIF image shows." and the HTML attribute
 *        "background (only when there is a URL)" is unsupported.
 *        Documented for Outlook 2007. Outlook 2010 to 2021 use the same Word-based engine and the vendor guides below describe the
 *        same limits for them, but Microsoft has not republished the list, so treat details as "documented for 2007, widely
 *        reported for later versions".
 *  [CM]  Campaign Monitor, "Outlook 2007-16" CSS support, https://www.campaignmonitor.com/css/email-client/outlook-2007-16
 *        text-transform: "Partial. Only uppercase is supported." display: "Partial. Sometimes supports none."
 *        margin and padding: buggy or partial, "mainly on table elements". line-height: "Buggy."
 *  [EOA] Email on Acid, "Outlook desktop" tips, https://www.emailonacid.com/tip/outlook-desktop/
 *        "Outlook 2007 and 2010 do not support the margin or padding CSS properties on images." Width and height are respected
 *        from the HTML width/height attributes, with "poor or no support" for sizing through CSS.
 *
 * Deliberately NOT simulated (reported instead by differences.ts): animated GIF first frame (needs the image bytes), DPI
 * scaling, line-height rounding, VML background fallbacks, and the exact table width algorithm.
 */

export const OUTLOOK_WORD_LABEL = "Simulation of Outlook for Windows (Word engine), not real Outlook";

export type Change = { code: string; count: number; detail?: string };

/** Properties Word accepts on every element ([MS] CORE). */
const CORE = new Set([
  "color", "font", "font-family", "font-style", "font-variant", "font-size", "font-weight", "text-decoration", "background-color",
  "text-align", "vertical-align", "letter-spacing", "line-height", "white-space", "border", "border-color", "border-style",
  "border-width", "list-style", "list-style-type", "border-collapse", "direction",
]);
/** [MS] COREEXTENDED, div and p only. */
const MARGIN = new Set(["margin", "margin-left", "margin-right", "margin-top", "margin-bottom", "text-indent"]);
/** [MS] FULL: the remaining elements (table, td, tr, img, a, ...). */
const FULL = new Set([
  "width", "height", "padding", "padding-left", "padding-right", "padding-top", "padding-bottom", "border-left", "border-right",
  "border-top", "border-bottom", "border-left-color", "border-left-width", "border-left-style", "border-right-color",
  "border-right-width", "border-right-style", "border-top-color", "border-top-width", "border-top-style", "border-bottom-color",
  "border-bottom-width", "border-bottom-style",
]);

const COLOR_TOKEN = /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|red|blue|green|gray|grey|silver|navy|yellow|orange|purple|maroon)\b)/;

function bump(map: Map<string, Change>, code: string, detail?: string) {
  const c = map.get(code);
  if (c) c.count++;
  else map.set(code, { code, count: 1, detail });
}

export function simulateOutlookWord(html: string): { html: string; changes: Change[] } {
  const changes = new Map<string, Change>();

  const out = rewriteTags(html, (tag) => {
    const el = tag.name;
    const isDivP = el === "div" || el === "p";
    const isCoreOnly = el === "span" || el === "body";
    const isImg = el === "img";

    // [MS] HTML attribute "background" with a URL is unsupported.
    if (tag.attrs.has("background")) {
      tag.attrs.delete("background");
      bump(changes, "background-image-attr");
    }

    // [EOA] Image size comes from the HTML attributes; CSS sizing is poorly supported. No attributes: natural size.
    const hasAttrSize = tag.attrs.has("width") && tag.attrs.has("height");

    mapStyle(tag, (d: Decl): Decl | Decl[] | null => {
      const p = d.prop;
      if (p.startsWith("mso-")) return d;

      // background shorthand: [MS] "background (only color)".
      if (p === "background") {
        const m = COLOR_TOKEN.exec(d.value);
        if (/gradient|url\(/i.test(d.value)) bump(changes, /gradient/i.test(d.value) ? "gradient" : "background-image");
        return m ? { prop: "background-color", value: m[1] } : null;
      }
      if (p === "background-image") {
        bump(changes, /gradient/i.test(d.value) ? "gradient" : "background-image");
        return null;
      }

      // [CM] text-transform: only uppercase works.
      if (p === "text-transform") {
        if (/uppercase/i.test(d.value)) return d;
        bump(changes, "text-transform");
        return null;
      }
      // [MS] display unsupported, [CM] "sometimes supports none". Keep none, and display:block on images (not documented as changing anything).
      if (p === "display") {
        if (/^none\b/i.test(d.value) || (isImg && /^block\b/i.test(d.value))) return d;
        bump(changes, "display");
        return null;
      }

      if (p === "border-radius" || p.startsWith("border-") && p.endsWith("-radius")) {
        bump(changes, "border-radius");
        return null;
      }

      if (MARGIN.has(p)) {
        if (isDivP) return d;
        bump(changes, isImg ? "img-margin-padding" : "margin-unsupported");
        return null;
      }
      if (FULL.has(p)) {
        if (isDivP || isCoreOnly) {
          bump(changes, p === "width" || p === "height" ? "size-on-block" : "padding-unsupported");
          return null;
        }
        if (isImg && p.startsWith("padding")) {
          bump(changes, "img-margin-padding");
          return null;
        }
        // [EOA] CSS width/height on an image without width/height attributes is ignored: it shows at natural size.
        if (isImg && (p === "width" || p === "height") && !hasAttrSize) {
          bump(changes, "img-css-size");
          return null;
        }
        return d;
      }
      if (CORE.has(p)) return d;

      // Everything else is an "unknown property" in Word and is ignored. [MS]
      if (p === "max-width" || p === "min-width" || p === "max-height" || p === "min-height") bump(changes, "max-width");
      else if (p === "box-shadow" || p === "text-shadow") bump(changes, "shadow");
      else if (p === "opacity") bump(changes, "opacity");
      else if (p === "overflow-wrap" || p === "word-break" || p === "word-wrap") bump(changes, "overflow-wrap");
      else if (p === "overflow" || p === "overflow-x" || p === "overflow-y") bump(changes, "overflow");
      else if (p === "float" || p === "position") bump(changes, "float-position");
      else bump(changes, "other-unsupported", p);
      return null;
    });
  });

  // Animated GIFs: [MS] only a static image shows. We cannot pick frame 1 without the bytes, so report them.
  const gifs = (html.match(/<img\b[^>]*\bsrc="[^"]*\.gif(?:[?#][^"]*)?"/gi) ?? []).length;
  if (gifs) changes.set("animated-gif", { code: "animated-gif", count: gifs });

  return { html: out, changes: [...changes.values()] };
}
