/**
 * Tiny, dependency-free HTML helpers shared by the client simulations (Outlook Word, Gmail, dark mode).
 *
 * They work on the HTML SignCraft itself generates (tables, inline styles, double-quoted attributes), on the server and in
 * the browser, so they use a small tokenizer instead of the DOM. They are NOT a general HTML parser: anything they do not
 * understand is passed through untouched.
 */

export type Attrs = Map<string, string>;
export type TagInfo = {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: Attrs;
};
/** Ancestor chain, outermost first. Only open tags that are not void elements. */
export type Ancestor = { name: string; attrs: Attrs };

const VOID = new Set(["img", "br", "hr", "meta", "link", "input", "col", "area", "base", "wbr", "source"]);
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export function parseAttrs(src: string): Attrs {
  const out: Attrs = new Map();
  for (const m of src.matchAll(ATTR_RE)) out.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

export function serializeAttrs(attrs: Attrs): string {
  let s = "";
  for (const [k, v] of attrs) s += v === "" && !["alt", "style", "src", "href"].includes(k) ? ` ${k}` : ` ${k}="${v.replace(/"/g, "&quot;")}"`;
  return s;
}

/**
 * Calls `fn` for every opening tag (with its ancestors) and writes back whatever attributes it leaves in `tag.attrs`.
 * `fn` may return `"drop"` to remove the tag, or a string to replace the whole opening tag. Closing tags pass through.
 */
export function rewriteTags(html: string, fn: (tag: TagInfo, ancestors: readonly Ancestor[]) => void | "drop" | string): string {
  const stack: Ancestor[] = [];
  const raw = new Set(["script", "style"]);
  let skipUntilClose: string | null = null;
  return html.replace(TAG_RE, (whole, slash: string, rawName: string, attrSrc: string, selfSlash: string) => {
    const name = rawName.toLowerCase();
    if (skipUntilClose) {
      if (slash && name === skipUntilClose) skipUntilClose = null;
      return whole;
    }
    if (slash) {
      // Pop to the matching open tag (tolerates unclosed tags).
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
      return whole;
    }
    const tag: TagInfo = { name, closing: false, selfClosing: !!selfSlash, attrs: parseAttrs(attrSrc) };
    const r = fn(tag, stack);
    const isVoid = VOID.has(name) || tag.selfClosing;
    if (!isVoid) stack.push({ name, attrs: tag.attrs });
    if (raw.has(name) && !tag.selfClosing) skipUntilClose = name;
    if (r === "drop") return "";
    if (typeof r === "string") return r;
    return `<${rawName}${serializeAttrs(tag.attrs)}${selfSlash ? " /" : ""}>`;
  });
}

/* ---------- inline style ---------- */

export type Decl = { prop: string; value: string };

export function parseStyle(style: string): Decl[] {
  const out: Decl[] = [];
  // Split on ; outside parentheses/quotes (url(...) and font names can contain ;).
  let depth = 0;
  let quote = "";
  let cur = "";
  const flush = () => {
    const i = cur.indexOf(":");
    if (i > 0) {
      const prop = cur.slice(0, i).trim().toLowerCase();
      const value = cur.slice(i + 1).trim();
      if (prop) out.push({ prop, value });
    }
    cur = "";
  };
  for (const ch of style) {
    if (quote) {
      if (ch === quote) quote = "";
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "(") {
      depth++;
      cur += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (ch === ";" && depth === 0) flush();
    else cur += ch;
  }
  flush();
  return out;
}

export function serializeStyle(decls: Decl[]): string {
  return decls.map((d) => `${d.prop}:${d.value}`).join(";") + (decls.length ? ";" : "");
}

/** Rewrites each declaration of a tag's style attribute. `fn` returns the declarations to keep (possibly changed). */
export function mapStyle(tag: TagInfo, fn: (d: Decl) => Decl | Decl[] | null): void {
  const style = tag.attrs.get("style");
  if (style === undefined) return;
  const next: Decl[] = [];
  for (const d of parseStyle(style)) {
    const r = fn(d);
    if (r) next.push(...(Array.isArray(r) ? r : [r]));
  }
  if (next.length) tag.attrs.set("style", serializeStyle(next));
  else tag.attrs.delete("style");
}

/* ---------- colours ---------- */

export type RGB = { r: number; g: number; b: number };

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000", red: "#ff0000", blue: "#0000ff", green: "#008000", gray: "#808080", grey: "#808080", silver: "#c0c0c0", navy: "#000080", yellow: "#ffff00", orange: "#ffa500", purple: "#800080", maroon: "#800000", transparent: "" };

export function parseColor(v: string): RGB | null {
  const s = v.trim().toLowerCase();
  const named = NAMED[s];
  if (named) return parseColor(named);
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16) };
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (m) return { r: Math.min(255, +m[1]), g: Math.min(255, +m[2]), b: Math.min(255, +m[3]) };
  return null;
}

export const toHex = ({ r, g, b }: RGB) => "#" + [r, g, b].map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0")).join("");

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance({ r, g, b }: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/* ---------- measuring ---------- */

/** Widest fixed width (px) declared on a table or image in the signature. null when nothing declares one. */
export function declaredWidth(html: string): number | null {
  let max = 0;
  rewriteTags(html, (tag) => {
    if (tag.name !== "table") return;
    const attr = tag.attrs.get("width");
    const a = attr && /^\d+$/.test(attr) ? Number(attr) : 0;
    const st = tag.attrs.get("style");
    const m = st ? /(?:^|;)\s*width\s*:\s*(\d+)px/i.exec(st) : null;
    max = Math.max(max, a, m ? Number(m[1]) : 0);
  });
  return max || null;
}

export function countMatches(html: string, re: RegExp): number {
  return (html.match(re) ?? []).length;
}
