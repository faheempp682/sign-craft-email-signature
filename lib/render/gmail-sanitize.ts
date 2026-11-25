import { mapStyle, rewriteTags } from "./html-tools";
import type { Change } from "./outlook-word";

/**
 * SIMULATION of what Gmail's HTML clean-up does to a signature before the message is shown. Not Gmail itself.
 *
 * Source: Google, "CSS support in Gmail", https://developers.google.com/workspace/gmail/design/css, which says, among other things:
 *  - properties outside Gmail's supported list are removed; examples named: position, z-index, flex, grid, gap, box-shadow,
 *    transform, transition and custom properties (--*)
 *  - negative margins and text-indent are removed
 *  - white-space: pre becomes pre-wrap
 *  - url() works only in background and background-image, with https/http or cid: sources; data: URLs are rewritten to url('')
 *  - space-separated colour functions such as oklch() or color-mix() make the whole style attribute be discarded
 *  - <style> blocks outside <head>, <link>, @import and @font-face are removed
 * Anything the page does not list is left alone here (border-radius, for instance, is supported by Gmail and stays).
 * Script, iframe, object, embed and form elements are removed as well: Gmail never runs or embeds them (general knowledge, not on that page).
 *
 * The real Gmail also proxies every image through Google and may hide images until the reader allows them. That is
 * reported in the known-differences list, not simulated.
 */

export const GMAIL_LABEL = "Simulation of Gmail's HTML clean-up in Chrome, not real Gmail";

const DROP_PROPS = new Set(["position", "z-index", "gap", "row-gap", "column-gap", "box-shadow", "transform", "transform-origin", "transition", "animation"]);
const DROP_PREFIX = ["flex", "grid", "--", "transition-", "animation-", "transform-"];
const DROP_TAGS = new Set(["script", "iframe", "object", "embed", "form", "link", "input", "button", "textarea", "select"]);

function bump(map: Map<string, Change>, code: string, detail?: string) {
  const c = map.get(code);
  if (c) c.count++;
  else map.set(code, { code, count: 1, detail });
}

export function simulateGmail(html: string): { html: string; changes: Change[] } {
  const changes = new Map<string, Change>();
  // <style>...</style> blocks in a body fragment: Gmail only keeps head styles, and signatures have no head.
  let src = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, () => {
    bump(changes, "style-block");
    return "";
  });
  src = src.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, () => {
    bump(changes, "removed-element", "script");
    return "";
  });

  const out = rewriteTags(src, (tag) => {
    if (DROP_TAGS.has(tag.name)) {
      bump(changes, "removed-element", tag.name);
      return "drop";
    }
    // Whole style attribute discarded when it uses a modern space-separated colour function.
    const st = tag.attrs.get("style");
    if (st && /\b(?:oklch|oklab|lch|lab|color-mix|color)\(\s*[^),]+\s+[^),]+/i.test(st)) {
      tag.attrs.delete("style");
      bump(changes, "style-attribute-discarded");
      return;
    }
    mapStyle(tag, (d) => {
      const p = d.prop;
      if (DROP_PROPS.has(p) || DROP_PREFIX.some((x) => p.startsWith(x))) {
        bump(changes, p === "box-shadow" ? "box-shadow" : "unsupported-property", p);
        return null;
      }
      if ((p.startsWith("margin") || p === "text-indent") && /(^|\s)-\d/.test(d.value)) {
        bump(changes, "negative-margin");
        return null;
      }
      if (p === "white-space" && /^pre$/i.test(d.value)) return { prop: p, value: "pre-wrap" };
      if (/url\(/i.test(d.value)) {
        if (p !== "background" && p !== "background-image") {
          bump(changes, "url-outside-background", p);
          return null;
        }
        if (/url\(\s*['"]?data:/i.test(d.value)) {
          bump(changes, "data-url");
          return { prop: p, value: d.value.replace(/url\(\s*['"]?data:[^)]*\)/gi, "url('')") };
        }
      }
      return d;
    });
  });

  return { html: out, changes: [...changes.values()] };
}
