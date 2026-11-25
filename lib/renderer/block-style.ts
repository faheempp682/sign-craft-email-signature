import type { Block, BlockStyle, Theme } from "@/lib/schema/document";
import { GRADIENT_DIRECTIONS } from "@/lib/schema/document";

/**
 * Per-block design -> email-safe inline HTML. Pure and deterministic: same block + style in, same string out.
 * Only tables, inline CSS and attributes are produced (no flexbox/grid/SVG/background-image/base64).
 */

const TABLE = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;

/** How well email clients honour each style property. Drives the canvas "visual only / partial" badges and the exporter. */
export type Support = { level: "full" | "partial" | "none"; note: string };

export const STYLE_SUPPORT: Record<keyof BlockStyle, Support> = {
  fontFamily: { level: "full", note: "Email-safe fonts only." },
  fontSize: { level: "full", note: "Secondary lines scale in proportion." },
  fontWeight: { level: "full", note: "" },
  italic: { level: "full", note: "" },
  underline: { level: "full", note: "" },
  strike: { level: "partial", note: "Some Outlook versions ignore strike-through." },
  color: { level: "full", note: "" },
  align: { level: "full", note: "" },
  lineHeight: { level: "full", note: "" },
  letterSpacing: { level: "partial", note: "Outlook desktop ignores letter spacing." },
  textTransform: { level: "partial", note: "Outlook desktop ignores text transform." },
  bg: { level: "full", note: "Exported as bgcolor + background-color." },
  gradient: { level: "none", note: "Exported as a solid colour (the start colour). Gradients are not reliable in email." },
  borderColor: { level: "full", note: "" },
  borderWidth: { level: "full", note: "" },
  borderRadius: { level: "partial", note: "Outlook desktop shows square corners." },
  opacity: { level: "partial", note: "Outlook desktop ignores opacity." },
  paddingTop: { level: "full", note: "" },
  paddingRight: { level: "full", note: "" },
  paddingBottom: { level: "full", note: "" },
  paddingLeft: { level: "full", note: "" },
  marginTop: { level: "full", note: "Exported as spacing above the block." },
  marginBottom: { level: "full", note: "Exported as spacing below the block." },
};

/** Properties the user has actually set that email clients only partly (or never) honour. */
export function styleWarnings(style: BlockStyle | undefined): { key: keyof BlockStyle; support: Support }[] {
  if (!style) return [];
  return (Object.keys(style) as (keyof BlockStyle)[])
    .filter((k) => style[k] !== undefined && STYLE_SUPPORT[k] && STYLE_SUPPORT[k].level !== "full")
    .map((key) => ({ key, support: STYLE_SUPPORT[key] }));
}

const DIRECTION_CSS: Record<(typeof GRADIENT_DIRECTIONS)[number], string> = {
  "to-right": "to right",
  "to-left": "to left",
  "to-bottom": "to bottom",
  "to-top": "to top",
};

/** CSS gradient for the CANVAS only. The exporter never emits it. */
export function gradientCss(g: NonNullable<BlockStyle["gradient"]>): string {
  const a = Math.round(g.opacity * 255).toString(16).padStart(2, "0");
  return `linear-gradient(${DIRECTION_CSS[g.direction]}, ${g.from}${a}, ${g.to}${a})`;
}

/** The solid colour that stands in for a block's background in email. */
export function exportBackground(style: BlockStyle | undefined): string | undefined {
  if (!style) return undefined;
  return style.bg ?? style.gradient?.from;
}

// Rows hold other blocks that carry their own colours and sizes, so a row's style never re-typesets its children.
const IMAGE_TYPES = new Set<Block["type"]>(["avatar", "banner", "row"]);
const OWN_BOX = new Set<Block["type"]>(["button", "divider", "spacer"]);
function retypeset(html: string, s: BlockStyle): string {
  let out = html;
  if (s.color) out = out.replace(/(?<![-\w])color:#[0-9a-fA-F]{6}/g, `color:${s.color}`);
  if (s.fontSize) {
    const base = /font-size:(\d+)px/.exec(out);
    const ratio = base ? s.fontSize / Number(base[1]) : 1;
    out = out.replace(/font-size:(\d+)px/g, (m, n: string) => (Number(n) <= 1 ? m : `font-size:${Math.max(8, Math.round(Number(n) * ratio))}px`));
    out = out.replace(/line-height:(\d+)px/g, (m, n: string) => (Number(n) <= 1 || !base ? m : `line-height:${Math.round(Number(n) * ratio)}px`));
  }
  if (s.lineHeight) out = out.replace(/line-height:\d+px/g, `line-height:${s.lineHeight}px`);
  if (s.fontWeight === "normal") out = out.replace(/font-weight:bold/g, "font-weight:normal");
  if (s.underline || s.strike) {
    const deco = [s.underline ? "underline" : "", s.strike ? "line-through" : ""].filter(Boolean).join(" ");
    out = out.replace(/text-decoration:none/g, `text-decoration:${deco}`);
  }
  return out;
}

/**
 * Wrap a block's rendered HTML with its style. Returns "" for hidden or empty blocks and returns the HTML untouched
 * when there is no style, so documents created before block styling render byte-for-byte as before.
 */
export function applyBlockStyle(b: Block, html: string, theme: Theme): string {
  if (b.hidden || !html) return "";
  const s = b.style;
  if (!s || Object.keys(s).length === 0) return html;

  const text = IMAGE_TYPES.has(b.type) || b.type === "spacer" ? html : retypeset(html, s);
  const bg = OWN_BOX.has(b.type) ? undefined : exportBackground(s);

  const tdCss: string[] = [];
  if (s.fontFamily) {
    const generic = ["Georgia", "Times New Roman"].includes(s.fontFamily) ? "serif" : s.fontFamily === "Courier New" ? "monospace" : "sans-serif";
    tdCss.push(`font-family:${s.fontFamily}, ${generic}`);
  }
  if (s.fontWeight === "bold") tdCss.push("font-weight:bold");
  if (s.italic) tdCss.push("font-style:italic");
  const deco = [s.underline ? "underline" : "", s.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) tdCss.push(`text-decoration:${deco}`);
  if (s.align) tdCss.push(`text-align:${s.align}`);
  if (s.letterSpacing) tdCss.push(`letter-spacing:${s.letterSpacing}px`);
  if (s.textTransform && s.textTransform !== "none") tdCss.push(`text-transform:${s.textTransform}`);
  if (bg) tdCss.push(`background-color:${bg}`);
  if (s.borderWidth && !OWN_BOX.has(b.type)) tdCss.push(`border:${s.borderWidth}px solid ${s.borderColor ?? theme.primary}`);
  if (s.borderRadius && !OWN_BOX.has(b.type)) tdCss.push(`border-radius:${s.borderRadius}px`);
  if (s.opacity !== undefined && s.opacity < 1) tdCss.push(`opacity:${s.opacity}`);
  const pad = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft];
  if (pad.some((p) => p)) tdCss.push(`padding:${pad.map((p) => `${p ?? 0}px`).join(" ")}`);

  const hasBox = tdCss.length > 0;
  let out = text;
  if (hasBox) {
    const attrs = [bg ? `bgcolor="${bg}"` : "", s.align ? `align="${s.align}"` : ""].filter(Boolean).join(" ");
    out = `<table ${TABLE}><tr><td ${attrs} style="${tdCss.join(";")};">${text}</td></tr></table>`;
  }
  if (s.marginTop || s.marginBottom) {
    out = `<table ${TABLE}><tr><td style="padding:${s.marginTop ?? 0}px 0 ${s.marginBottom ?? 0}px 0;">${out}</td></tr></table>`;
  }
  return out;
}
