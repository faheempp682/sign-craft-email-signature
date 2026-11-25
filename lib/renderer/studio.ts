import type { Block, Theme } from "@/lib/schema/document";
import { NETWORK_LABEL, TABLE_ATTRS, esc } from "./shared";
import { badge, fonts, items, letterRows, mix, sp, splitName, stackCols, tbl, td, vsp, WORD, type B, type Skin, type Slots } from "./cards";

/**
 * "Studio" composer: one engine that assembles a signature from independent structural choices.
 * Every choice changes the HTML structure (not just colours), so 100 specs give 100 genuinely different designs.
 * Colours always come from the document theme, so the editor's colour pickers keep working.
 */

export const LAYOUT_COUNT = 11;
export const LAYOUT_NAMES = ["Side photo", "Photo right", "Centered", "Two-tier", "Three-column", "Header row", "Colour panel", "Contact band", "Sidebar", "Stacked", "Header band"];
export const NAME_COUNT = 9;
export const NAME_NAMES = ["Bold", "Two-tone", "Serif caps", "Greeting", "Italic serif", "Boxed", "Surname", "Underlined", "Mono"];

export type Spec = { layout: number; name: number; title: number; contact: number; social: number; photo: number; frame: number; deco: number };

/** Deterministic spec for variant "s001".."s999". Coprime strides keep neighbours structurally different. */
export function genSpec(variant: string): Spec {
  const i = Math.max(0, parseInt(variant.slice(1), 10) - 1 || 0);
  return {
    layout: i % LAYOUT_COUNT,
    name: (i * 4 + 1) % NAME_COUNT,
    title: (i * 5 + 2) % 6,
    contact: (i * 7 + 3) % 9,
    social: (i * 3 + 1) % 7,
    photo: (i * 5 + Math.floor(i / 11)) % 8,
    frame: (i * 3 + Math.floor(i / 9)) % 8,
    deco: (i * 5 + 2) % 6,
  };
}

/* ---------- colours ---------- */

const lum = (c: string) => {
  const [r, g, b] = [1, 3, 5].map((k) => {
    const v = parseInt(c.slice(k, k + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const onColor = (bg: string) => (lum(bg) > 0.4 ? "#111111" : "#FFFFFF");

type K = { ink: string; muted: string; primary: string; accent: string; chipBg: string; chipFg: string; line: string };

function palette(t: Theme, inverse: boolean): K {
  const onP = onColor(t.primary);
  if (!inverse) return { ink: t.text, muted: t.muted, primary: t.primary, accent: t.accent2, chipBg: t.primary, chipFg: onP, line: mix(t.bg, t.text, 0.22) };
  return { ink: onP, muted: mix(t.primary, onP, 0.78), primary: onP, accent: t.accent2, chipBg: onP, chipFg: t.primary, line: mix(t.primary, onP, 0.4) };
}

const ICON = { phone: "T", email: "@", website: "W", address: "A" } as const;
/** Badge + value rows. The gap is padding (not a width) so it can never collapse when a long value squeezes the row. */
function badgeRows(it: ReturnType<typeof items>, o: { fs: number; lh: number; gap: number; size: number; bg: string; fg: string; tc: string; round?: boolean }) {
  if (!it.length) return "";
  return tbl(it.map((x, i) => {
    const pad = i ? `padding-top:${o.gap}px;` : "";
    return `<tr><td valign="middle" width="${o.size}" style="width:${o.size}px;${pad}padding-right:8px;">${badge(ICON[x.k], { size: o.size, bg: o.bg, fg: o.fg, round: o.round, r: 3, fs: 8 })}</td><td valign="middle" style="${pad}font-size:${o.fs}px;line-height:${o.lh}px;color:${o.tc};">${x.html}</td></tr>`;
  }).join(""));
}

const alignAttr = (al: string) => (al === "center" ? 'align="center"' : "");
const SERIF = "Georgia,'Times New Roman',serif";

/* ---------- identity: name style x title style ---------- */

function nameHtml(style: number, b: B<"identity">, k: K, al: string): string {
  const [f, r] = splitName(b.name);
  switch (style) {
    case 1:
      return `<div style="font-size:34px;line-height:36px;font-weight:normal;color:${k.ink};">${esc(f)}</div>${r ? `<div style="font-size:34px;line-height:36px;font-weight:bold;color:${k.ink};">${esc(r)}</div>` : ""}`;
    case 2:
      return `<div style="font-family:${SERIF};font-size:22px;line-height:28px;letter-spacing:3px;text-transform:uppercase;color:${k.ink};">${esc(b.name)}</div>`;
    case 3:
      return `<div style="font-size:15px;line-height:20px;color:${k.muted};">hello, I&#39;m</div><div style="font-size:32px;line-height:36px;font-weight:bold;letter-spacing:-1px;color:${k.ink};">${esc(f.toLowerCase())}${r ? ` <span style="color:${k.primary};">${esc(r.toLowerCase())}</span>` : ""}</div>`;
    case 4:
      return `<div style="font-family:${SERIF};font-size:30px;line-height:34px;font-style:italic;color:${k.ink};">${esc(b.name)}</div>`;
    case 5:
      return `<table ${TABLE_ATTRS} ${alignAttr(al)}><tr><td bgcolor="${k.chipBg}" style="background-color:${k.chipBg};padding:6px 14px;font-size:20px;line-height:26px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${k.chipFg};">${esc(b.name)}</td></tr></table>`;
    case 6:
      return `<div style="font-size:12px;line-height:16px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;color:${k.muted};">${esc(f)}</div><div style="font-size:32px;line-height:34px;font-weight:bold;text-transform:uppercase;color:${k.primary};">${esc(r || f)}</div>`;
    case 7:
      return `<table ${TABLE_ATTRS} ${alignAttr(al)}><tr><td style="border-bottom:3px solid ${k.primary};padding-bottom:4px;font-size:24px;line-height:30px;font-weight:bold;color:${k.ink};">${esc(b.name)}</td></tr></table>`;
    case 8:
      return `<div style="font-family:'Courier New',monospace;font-size:19px;line-height:26px;font-weight:bold;text-transform:uppercase;color:${k.ink};"><span style="color:${k.primary};">&gt;</span> ${esc(b.name)}</div>`;
    default:
      return `<div style="font-size:22px;line-height:28px;font-weight:bold;color:${k.ink};">${esc(b.name)}</div>`;
  }
}

function titleHtml(style: number, b: B<"identity">, k: K, al: string): string {
  const title = b.title ? esc(b.title) : "";
  const company = b.company ? esc(b.company) : "";
  if (!title && !company) return "";
  switch (style) {
    case 1:
      return `${title ? `<div style="padding-top:6px;"><table ${TABLE_ATTRS} ${alignAttr(al)}><tr><td bgcolor="${k.chipBg}" style="background-color:${k.chipBg};border-radius:12px;padding:3px 12px;font-size:11px;line-height:16px;font-weight:bold;color:${k.chipFg};">${title}</td></tr></table></div>` : ""}${company ? `<div style="padding-top:5px;font-size:12px;line-height:16px;font-weight:bold;color:${k.muted};">${company}</div>` : ""}`;
    case 2:
      return `<div style="padding-top:4px;font-size:11px;line-height:16px;letter-spacing:2px;text-transform:uppercase;color:${k.muted};">${title}</div>${company ? `<div style="font-size:11px;line-height:16px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${k.ink};">${company}</div>` : ""}`;
    case 3:
      return `<div style="padding-top:2px;font-family:${SERIF};font-size:15px;line-height:21px;font-style:italic;color:${k.muted};">${[title, company].filter(Boolean).join(", ")}</div>`;
    case 4:
      return `<div style="padding-top:2px;font-size:13px;line-height:18px;color:${k.muted};">${title}${title && company ? ` <span style="color:${k.primary};font-weight:bold;">/</span> ` : ""}${company ? `<span style="color:${k.ink};">${company}</span>` : ""}</div>`;
    case 5:
      return `<div style="padding-top:8px;"><table ${TABLE_ATTRS} ${alignAttr(al)}><tr><td style="border-left:3px solid ${k.primary};padding-left:10px;"><div style="font-size:13px;line-height:18px;font-weight:bold;color:${k.ink};">${title}</div>${company ? `<div style="font-size:12px;line-height:16px;color:${k.muted};">${company}</div>` : ""}</td></tr></table></div>`;
    default:
      return `<div style="padding-top:2px;font-size:13px;line-height:18px;color:${k.muted};">${[title, company].filter(Boolean).join(" &middot; ")}</div>`;
  }
}

/* ---------- contact styles ---------- */

function contactHtml(style: number, b: B<"contact">, k: K, per = 2): string {
  const it = items(b, k.ink, k.primary);
  if (!it.length) return "";
  const letters = { phone: "P", email: "E", website: "W", address: "A" } as const;
  switch (style) {
    case 1:
      return badgeRows(it, { fs: 12, lh: 16, gap: 7, size: 16, bg: k.chipBg, fg: k.chipFg, tc: k.ink, round: false });
    case 2:
      return letterRows(it, { fs: 12, lh: 17, gap: 5, lw: 20, lc: k.primary, tc: k.ink, label: letters });
    case 3:
      // Items are grouped per line (two, or one in narrow layouts) so a separator can never be stranded at a wrap point.
      return `<div style="font-size:12px;line-height:20px;color:${k.ink};">${Array.from({ length: Math.ceil(it.length / per) }, (_, n) => it.slice(n * per, n * per + per).map((x) => x.html).join(`<span style="color:${k.muted};">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`)).join("<br />")}</div>`;
    case 4:
      return stackCols(it, { cols: 2, lfs: 9, lc: k.primary, vfs: 11, vlh: 15, gap: 10, colGap: 22 });
    case 5:
      return stackCols(it, { cols: 1, lfs: 8, lc: k.primary, vfs: 12, vlh: 16, gap: 8, upper: true });
    case 6:
      return tbl(it.map((x) => `<tr><td valign="top" width="64" style="width:64px;padding:5px 0;border-bottom:1px solid ${k.line};font-size:10px;line-height:16px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${k.muted};">${WORD[x.k]}</td><td valign="top" style="padding:5px 0 5px 10px;border-bottom:1px solid ${k.line};font-size:12px;line-height:16px;color:${k.ink};">${x.html}</td></tr>`).join(""));
    case 7:
      return tbl(it.map((x, i) => `<tr><td style="padding-top:${i ? 5 : 0}px;"><table ${TABLE_ATTRS}><tr><td style="border:1px solid ${k.primary};border-radius:12px;padding:2px 11px;font-size:12px;line-height:17px;color:${k.ink};">${x.html}</td></tr></table></td></tr>`).join(""));
    case 8:
      return `<div style="font-size:12px;line-height:20px;color:${k.ink};">${it.map((x) => x.html).join("<br />")}</div>`;
    default:
      return badgeRows(it, { fs: 12, lh: 16, gap: 7, size: 16, bg: k.chipBg, fg: k.chipFg, tc: k.ink });
  }
}

/* ---------- social styles ---------- */

const GL: Record<string, string> = { linkedin: "in", twitter: "X", facebook: "f", instagram: "ig", youtube: "yt", github: "gh", tiktok: "tk" };

function socialHtml(style: number, b: B<"social">, k: K): string {
  if (!b.links.length) return "";
  const a = (l: B<"social">["links"][number], css: string, text: string) => `<a href="${esc(l.url)}" target="_blank" title="${esc(NETWORK_LABEL[l.network] ?? l.network)}" style="text-decoration:none;${css}">${text}</a>`;
  const label = (l: B<"social">["links"][number]) => esc(NETWORK_LABEL[l.network] ?? l.network);
  const row = (cells: string[], gap = 6) => tbl(`<tr>${cells.map((c, i) => (i ? sp(gap) : "") + c).join("")}</tr>`);
  switch (style) {
    case 1:
      return row(b.links.map((l) => `<td align="center" width="22" height="22" bgcolor="${k.chipBg}" style="width:22px;height:22px;background-color:${k.chipBg};border-radius:3px;">${a(l, `display:block;color:${k.chipFg};font-size:9px;font-weight:bold;line-height:22px;text-align:center;`, GL[l.network])}</td>`));
    case 2:
      return row(b.links.map((l) => `<td align="center" width="22" height="22" style="width:22px;height:22px;border:1px solid ${k.primary};border-radius:11px;">${a(l, `display:block;color:${k.primary};font-size:9px;font-weight:bold;line-height:22px;text-align:center;`, GL[l.network])}</td>`));
    case 3:
      return `<div style="font-size:12px;line-height:18px;font-weight:bold;white-space:nowrap;">${b.links.map((l) => a(l, `color:${k.primary};`, label(l))).join(`<span style="color:${k.muted};"> &nbsp;|&nbsp; </span>`)}</div>`;
    case 4:
      return `<div style="font-size:10px;line-height:16px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${b.links.map((l) => `<span style="white-space:nowrap;">${a(l, `color:${k.primary};`, label(l))}</span>`).join(" ")}</div>`;
    case 5:
      return row(b.links.map((l) => `<td bgcolor="${k.chipBg}" style="background-color:${k.chipBg};border-radius:12px;padding:3px 11px;white-space:nowrap;">${a(l, `color:${k.chipFg};font-size:11px;font-weight:bold;line-height:16px;`, label(l))}</td>`), 5);
    case 6:
      return `<div style="font-size:13px;line-height:18px;font-weight:bold;letter-spacing:1px;white-space:nowrap;">${b.links.map((l) => a(l, `color:${k.primary};`, GL[l.network])).join(` <span style="color:${k.muted};">&middot;</span> `)}</div>`;
    default:
      return row(b.links.map((l) => `<td align="center" width="22" height="22" bgcolor="${k.chipBg}" style="width:22px;height:22px;background-color:${k.chipBg};border-radius:11px;">${a(l, `display:block;color:${k.chipFg};font-size:9px;font-weight:bold;line-height:22px;text-align:center;`, GL[l.network])}</td>`));
  }
}

/* ---------- photo treatments ---------- */

function photoHtml(style: number, b: B<"avatar">, k: K): string {
  const s = b.size;
  const img = (radius: string) => `<img src="${esc(b.src)}" width="${s}" height="${s}" alt="${esc(b.alt)}" style="display:block;border:0;width:${s}px;height:${s}px;border-radius:${radius};" />`;
  switch (style) {
    case 1:
      return img("0");
    case 2:
      return img("14px");
    case 3:
      return img(`${Math.round(s / 2)}px ${Math.round(s / 2)}px 0 0`);
    case 4:
      return tbl(`<tr><td bgcolor="${k.primary}" style="background-color:${k.primary};border-radius:50%;padding:4px;">${img("50%")}</td></tr>`);
    case 5:
      return tbl(`<tr><td style="border:1px solid ${k.primary};padding:4px;">${img("0")}</td></tr>`);
    case 6:
      return tbl(`<tr><td bgcolor="${k.accent}" style="background-color:${k.accent};padding:0 10px 10px 0;">${img("0")}</td></tr>`);
    default:
      return img("50%");
  }
}

/* ---------- decorations (placed between the name block and the details) ---------- */

function decoHtml(style: number, k: K): string {
  const bar = (w: string, h: number, c: string, extra = "") => `<table ${TABLE_ATTRS} ${w === "100%" ? 'width="100%"' : ""}><tr><td ${w === "100%" ? "" : `width="${w}"`} height="${h}" bgcolor="${c}" style="${w === "100%" ? "" : `width:${w}px;`}height:${h}px;line-height:${h}px;font-size:1px;background-color:${c};${extra}">&nbsp;</td></tr></table>`;
  switch (style) {
    case 1:
      return vsp(10) + bar("44", 3, k.accent === k.chipFg ? k.primary : k.primary) + vsp(10);
    case 2:
      return vsp(10) + bar("100%", 1, k.line) + vsp(10);
    case 3:
      return vsp(10) + `<table ${TABLE_ATTRS} width="100%"><tr><td height="1" style="height:1px;line-height:1px;font-size:1px;border-top:1px dotted ${k.primary};">&nbsp;</td></tr></table>` + vsp(10);
    case 4:
      return vsp(10) + tbl(`<tr>${[k.primary, k.accent, k.muted].map((c, i) => (i ? sp(4) : "") + `<td width="8" height="8" bgcolor="${c}" style="width:8px;height:8px;background-color:${c};font-size:1px;line-height:1px;">&nbsp;</td>`).join("")}</tr>`) + vsp(10);
    case 5:
      return vsp(10) + bar("100%", 2, k.primary) + vsp(3) + bar("100%", 1, k.line) + vsp(10);
    default:
      return vsp(12);
  }
}

/* ---------- frames ---------- */

function frame(style: number, inner: string, w: number, t: Theme, bleed: boolean): string {
  const line = mix(t.bg, t.text, 0.22);
  const pad = bleed ? 0 : 18;
  const base = `width:${w}px;background-color:${t.bg};font-family:${fonts(t)};color:${t.text};`;
  const open = (extra: string) => `<table ${TABLE_ATTRS} width="${w}" bgcolor="${t.bg}" style="${base}${extra}">`;
  switch (style) {
    case 1:
      return `${open(`border:1px solid ${line};${bleed ? "" : "border-radius:10px;"}`)}<tr><td style="padding:${pad}px;">${inner}</td></tr></table>`;
    case 2:
      return `${open("")}<tr><td height="4" bgcolor="${t.primary}" style="height:4px;line-height:4px;font-size:1px;background-color:${t.primary};">&nbsp;</td></tr><tr><td style="padding:${bleed ? 0 : 16}px ${bleed ? 0 : 18}px ${bleed ? 0 : 18}px;">${inner}</td></tr></table>`;
    case 3:
      return `${open("")}<tr><td width="5" bgcolor="${t.primary}" style="width:5px;background-color:${t.primary};font-size:1px;">&nbsp;</td><td style="padding:${pad}px;">${inner}</td></tr></table>`;
    case 4:
      return `${open("")}<tr><td style="padding:${bleed ? 0 : 16}px ${bleed ? 0 : 18}px 12px;">${inner}</td></tr><tr><td height="6" bgcolor="${t.primary}" style="height:6px;line-height:6px;font-size:1px;background-color:${t.primary};">&nbsp;</td></tr></table>`;
    case 5: {
      const fill = lum(t.bg) > 0.9 ? mix("#FFFFFF", t.primary, 0.08) : mix(t.bg, "#FFFFFF", 0.07);
      return `<table ${TABLE_ATTRS} width="${w}" bgcolor="${fill}" style="width:${w}px;background-color:${fill};${bleed ? "" : "border-radius:14px;"}font-family:${fonts(t)};color:${t.text};"><tr><td style="padding:${bleed ? 0 : 20}px;">${inner}</td></tr></table>`;
    }
    case 6:
      return `${open(`border:1px solid ${t.primary};`)}<tr><td style="padding:4px;"><table ${TABLE_ATTRS} width="100%" style="border:1px solid ${t.primary};"><tr><td style="padding:${bleed ? 0 : 14}px;">${inner}</td></tr></table></td></tr></table>`;
    case 7:
      return `${open(`border-bottom:2px solid ${t.primary};`)}<tr><td style="padding:${bleed ? 0 : 8}px ${bleed ? 0 : 6}px 14px;">${inner}</td></tr></table>`;
    default:
      return `${open("")}<tr><td style="padding:${bleed ? 0 : 8}px;">${inner}</td></tr></table>`;
  }
}

/* ---------- the skin ---------- */

const widthFor = (layout: number) => [540, 540, 380, 560, 620, 560, 600, 560, 600, 460, 560][layout];

export function composeSkin(variant: string): Skin {
  const sp_ = genSpec(variant);
  const L = sp_.layout;
  const center = L === 2;
  const al = center ? "center" : "left";
  const invId = L === 6 || L === 10;
  const invCo = L === 7;
  const invSo = L === 7 || L === 8;
  const invPh = L === 6 || L === 8 || L === 10;

  return {
    block(b: Block, t: Theme) {
      if (b.type === "avatar") return sp_.photo === 7 ? "" : photoHtml(sp_.photo, b, palette(t, invPh));
      if (b.type === "identity") {
        const k = palette(t, invId);
        return nameHtml(sp_.name, b, k, al) + titleHtml(sp_.title, b, k, al);
      }
      if (b.type === "contact") return contactHtml((L === 4 || L === 2) && sp_.contact === 4 ? 5 : sp_.contact, b, palette(t, invCo), L === 2 || L === 4 || L === 9 ? 1 : 2);
      if (b.type === "social") return socialHtml(L === 8 ? ({ 3: 1, 4: 2, 5: 0 } as Record<number, number>)[sp_.social] ?? sp_.social : sp_.social, b, palette(t, invSo));
    },
    layout(s: Slots, t: Theme) {
      const av = s.get("avatar");
      const id = s.get("identity");
      const co = s.get("contact");
      const so = s.get("social");
      const k = palette(t, false);
      const deco = decoHtml(sp_.deco, k);
      const w = widthFor(L);
      const ident = id?.html ?? "";
      const stack = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join("");
      const text = stack(ident, (co || so) && deco, co?.html, so && (co ? vsp(10) : "") + so.html);
      const pc = (p: number) => `padding:${p}px;`;
      let inner = "";
      let bleed = false;

      switch (L) {
        case 0:
          inner = `<table ${TABLE_ATTRS}><tr>${td(av?.html, 'valign="middle" style="padding-right:18px;"')}<td valign="middle">${text}</td></tr></table>`;
          break;
        case 1:
          inner = `<table ${TABLE_ATTRS}><tr><td valign="middle">${text}</td>${td(av?.html, 'valign="middle" style="padding-left:22px;"')}</tr></table>`;
          break;
        case 2:
          inner = `<table ${TABLE_ATTRS} width="100%"><tr><td align="center">${av ? `<table ${TABLE_ATTRS} align="center"><tr><td>${av.html}</td></tr></table>${vsp(12)}` : ""}${ident}${(co || so) ? deco : ""}${co ? `<table ${TABLE_ATTRS} align="center"><tr><td>${co.html}</td></tr></table>` : ""}${so ? vsp(10) + `<table ${TABLE_ATTRS} align="center"><tr><td>${so.html}</td></tr></table>` : ""}</td></tr></table>`;
          break;
        case 3:
          inner = `<table ${TABLE_ATTRS} width="100%"><tr><td valign="middle">${ident}</td>${td(av?.html, 'valign="middle" align="right" style="padding-left:16px;"')}</tr>${co || so ? `<tr><td colspan="2">${deco}</td></tr><tr><td valign="top">${co?.html ?? ""}</td>${so ? `<td valign="bottom" align="right" style="padding-top:8px;white-space:nowrap;">${so.html}</td>` : "<td></td>"}</tr>` : ""}</table>`;
          break;
        case 4:
          inner = `<table ${TABLE_ATTRS}><tr>${td(av?.html, 'valign="middle" style="padding-right:18px;"')}<td valign="middle">${ident}</td><td valign="middle" width="250" style="width:250px;padding:0 0 0 20px;"><table ${TABLE_ATTRS}><tr><td style="border-left:1px solid ${k.line};padding-left:20px;">${stack(co?.html, so && vsp(10) + so.html)}</td></tr></table></td></tr></table>`;
          break;
        case 5:
          inner = `<table ${TABLE_ATTRS} width="100%"><tr><td colspan="2">${ident}${vsp(12)}</td></tr><tr>${td(av?.html, 'valign="top" width="1" style="padding-right:22px;"')}<td valign="top">${co?.html ?? ""}</td></tr>${so ? `<tr><td colspan="2" align="right" style="padding-top:10px;white-space:nowrap;">${so.html}</td></tr>` : ""}</table>`;
          break;
        case 6: {
          bleed = true;
          const left = `<td valign="middle" width="210" bgcolor="${t.primary}" style="width:210px;background-color:${t.primary};padding:24px;">${stack(av?.html, av && vsp(14), ident)}</td>`;
          inner = `<table ${TABLE_ATTRS} width="100%"><tr>${left}<td valign="middle" style="${pc(24)}">${stack(co?.html, so && vsp(12) + so.html)}</td></tr></table>`;
          break;
        }
        case 7: {
          bleed = true;
          const band = co || so ? `<tr><td bgcolor="${t.primary}" style="background-color:${t.primary};padding:12px 20px;">${sp_.contact === 7 ? `${co?.html ?? ""}${so ? vsp(10) + so.html : ""}` : `<table ${TABLE_ATTRS} width="100%"><tr><td valign="middle">${co?.html ?? ""}</td>${so ? `<td valign="middle" align="right" style="padding-left:14px;white-space:nowrap;">${so.html}</td>` : ""}</tr></table>`}</td></tr>` : "";
          inner = `<table ${TABLE_ATTRS} width="100%"><tr><td style="padding:18px 20px;"><table ${TABLE_ATTRS}><tr>${td(av?.html, 'valign="middle" style="padding-right:18px;"')}<td valign="middle">${ident}</td></tr></table></td></tr>${band}</table>`;
          break;
        }
        case 8: {
          bleed = true;
          const right = av || so ? `<td valign="middle" align="center" width="170" bgcolor="${t.primary}" style="width:170px;background-color:${t.primary};padding:20px 16px;">${av ? `<table ${TABLE_ATTRS} align="center"><tr><td>${av.html}</td></tr></table>` : ""}${so ? vsp(av ? 12 : 0) + `<table ${TABLE_ATTRS} align="center"><tr><td>${so.html}</td></tr></table>` : ""}</td>` : "";
          inner = `<table ${TABLE_ATTRS} width="100%"><tr><td valign="middle" style="padding:22px 24px;">${stack(ident, co && deco, co?.html)}</td>${right}</tr></table>`;
          break;
        }
        case 9:
          inner = `${stack(av?.html, av && vsp(12), ident, (co || so) && deco)}<table ${TABLE_ATTRS} width="100%"><tr><td valign="top">${co?.html ?? ""}</td>${so ? `<td valign="bottom" align="right" style="padding-top:8px;white-space:nowrap;">${so.html}</td>` : ""}</tr></table>`;
          break;
        default: {
          bleed = true;
          const head = `<tr><td bgcolor="${t.primary}" style="background-color:${t.primary};padding:20px 24px;"><table ${TABLE_ATTRS} width="100%"><tr><td valign="middle">${ident}</td>${td(av?.html, 'valign="middle" align="right" style="padding-left:16px;"')}</tr></table></td></tr>`;
          inner = `<table ${TABLE_ATTRS} width="100%">${head}${co || so ? `<tr><td style="padding:18px 24px;"><table ${TABLE_ATTRS} width="100%"><tr><td valign="top">${co?.html ?? ""}</td>${so ? `<td valign="bottom" align="right" style="padding-top:8px;white-space:nowrap;">${so.html}</td>` : ""}</tr></table></td></tr>` : ""}</table>`;
        }
      }
      return frame(sp_.frame, inner, w, t, bleed);
    },
  };
}
