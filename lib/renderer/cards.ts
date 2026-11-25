import type { Block, SignatureDoc, Theme } from "@/lib/schema/document";
import { composeSkin } from "./studio";
import { GAP, NETWORK_LABEL, TABLE_ATTRS, esc, fontStack, renderBlock, safeHttpsUrl, telHref } from "./shared";

/**
 * Designed ("card") templates. Same rules as the base layouts: nested tables, inline styles, bgcolor + background-color,
 * no flex/grid/svg/background-image/web fonts. Every block's HTML sits alone inside its own <td> so click-to-edit keeps working.
 * Gradients are drawn as strips of solid-colour cells; icons are letter badges (no hosted icon PNGs needed).
 */

export const CARD_IDS = [
  "editorial-arch",
  "bold-letter",
  "circle-accent",
  "green-sidebar",
  "maroon-frame",
  "spectrum",
  "geometric",
  "noir-agent",
  "orange-logo",
  "ticket",
  "listing-banner",
  "soft-card",
  "consultant-blue",
  "executive-navy",
  "minimal-line",
  "dark-luxe",
  "pastel-pill",
  "split-color",
  "studio",
] as const;
export type CardId = (typeof CARD_IDS)[number];
export const isCardTemplate = (id: string): id is CardId => (CARD_IDS as readonly string[]).includes(id);

export type B<T extends Block["type"]> = Extract<Block, { type: T }>;
type Slot<T extends Block["type"]> = { b: B<T>; html: string };

/* ---------- small building blocks ---------- */

export const tbl = (inner: string, attrs = "") => `<table ${TABLE_ATTRS} ${attrs}>${inner}</table>`;
export const sp = (w: number) => `<td width="${w}" style="width:${w}px;font-size:1px;line-height:1px;">&nbsp;</td>`;
export const vsp = (h: number) => `<div style="height:${h}px;line-height:${h}px;font-size:1px;">&nbsp;</div>`;

export function splitName(name: string): [string, string] {
  const p = name.trim().split(/\s+/);
  return [p[0] ?? "", p.slice(1).join(" ")];
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [hex(a), hex(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

function vStrip(a: string, b: string, w: number, h: number, steps = 16) {
  const rh = Math.ceil(h / steps);
  const rows = Array.from({ length: steps }, (_, i) => `<tr><td width="${w}" height="${rh}" bgcolor="${mix(a, b, i / (steps - 1))}" style="width:${w}px;height:${rh}px;font-size:1px;line-height:1px;background-color:${mix(a, b, i / (steps - 1))};">&nbsp;</td></tr>`).join("");
  return tbl(rows);
}

export function badge(text: string, o: { size: number; bg: string; fg: string; fs?: number; round?: boolean; r?: number }) {
  const radius = o.round === false ? (o.r ?? 0) : Math.round(o.size / 2);
  return `<table ${TABLE_ATTRS}><tr><td align="center" valign="middle" width="${o.size}" height="${o.size}" bgcolor="${o.bg}" style="width:${o.size}px;height:${o.size}px;background-color:${o.bg};border-radius:${radius}px;color:${o.fg};font-size:${o.fs ?? 9}px;font-weight:bold;line-height:${o.size}px;text-align:center;">${text}</td></tr></table>`;
}

/* ---------- contact + social primitives ---------- */

type Key = "phone" | "email" | "website" | "address";
type Item = { k: Key; html: string };

export function items(b: B<"contact">, color: string, linkColor = color): Item[] {
  const a = (href: string, text: string, c: string) => `<a href="${esc(href)}" target="_blank" style="color:${c};text-decoration:none;">${text}</a>`;
  const out: Item[] = [];
  if (b.phone) {
    const h = telHref(b.phone);
    out.push({ k: "phone", html: h ? a(h, esc(b.phone), color) : esc(b.phone) });
  }
  if (b.email) out.push({ k: "email", html: a(`mailto:${b.email}`, esc(b.email), color) });
  if (b.website) {
    const h = safeHttpsUrl(b.website);
    const label = esc(b.website.replace(/^https?:\/\//i, "").replace(/\/$/, ""));
    out.push({ k: "website", html: h ? a(h, label, linkColor) : label });
  }
  if (b.address) out.push({ k: "address", html: esc(b.address) });
  return out;
}

export const WORD: Record<Key, string> = { phone: "Phone", email: "Email", website: "Website", address: "Address" };
const LETTER: Record<Key, string> = { phone: "P", email: "E", website: "W", address: "A" };
const ICON: Record<Key, string> = { phone: "T", email: "@", website: "W", address: "A" };

/** "P  value" rows. */
export function letterRows(it: Item[], o: { fs: number; lh: number; gap: number; lw: number; lc: string; tc: string; label?: Record<Key, string> }) {
  if (!it.length) return "";
  const lab = o.label ?? LETTER;
  return tbl(
    it
      .map((x, i) => {
        const pad = i ? `padding-top:${o.gap}px;` : "";
        return `<tr><td valign="top" width="${o.lw}" style="width:${o.lw}px;${pad}font-size:${o.fs}px;line-height:${o.lh}px;font-weight:bold;color:${o.lc};">${lab[x.k]}</td><td valign="top" style="${pad}font-size:${o.fs}px;line-height:${o.lh}px;color:${o.tc};">${x.html}</td></tr>`;
      })
      .join(""),
  );
}

/** Coloured badge + value rows. */
export function badgeRows(it: Item[], o: { fs: number; lh: number; gap: number; size: number; bg: string; fg: string; tc: string; round?: boolean }) {
  if (!it.length) return "";
  return tbl(
    it
      .map((x, i) => {
        const pad = i ? `padding-top:${o.gap}px;` : "";
        return `<tr><td valign="middle" width="${o.size + 8}" style="width:${o.size + 8}px;${pad}">${badge(ICON[x.k], { size: o.size, bg: o.bg, fg: o.fg, round: o.round, r: 3, fs: 8 })}</td><td valign="middle" style="${pad}font-size:${o.fs}px;line-height:${o.lh}px;color:${o.tc};">${x.html}</td></tr>`;
      })
      .join(""),
  );
}

/** Small label above a value, optionally in two columns. */
export function stackCols(it: Item[], o: { cols: 1 | 2; lfs: number; lc: string; vfs: number; vlh: number; gap: number; upper?: boolean; colGap?: number; leftW?: number }) {
  if (!it.length) return "";
  const one = (x: Item) =>
    `<div style="font-size:${o.lfs}px;line-height:${o.lfs + 4}px;font-weight:bold;color:${o.lc};${o.upper ? "text-transform:uppercase;letter-spacing:1px;" : ""}">${WORD[x.k]}</div><div style="font-size:${o.vfs}px;line-height:${o.vlh}px;">${x.html}</div>`;
  const col = (list: Item[]) => tbl(list.map((x, i) => `<tr><td style="padding-top:${i ? o.gap : 0}px;">${one(x)}</td></tr>`).join(""));
  if (o.cols === 1) return col(it);
  const left = it.filter((_, i) => i % 2 === 0);
  const right = it.filter((_, i) => i % 2 === 1);
  // leftW pins the first column to its content width, so a long value in the second column cannot squeeze it into mid-word breaks.
  const leftAttr = o.leftW ? ` width="${o.leftW}" style="width:${o.leftW}px;"` : "";
  return tbl(`<tr><td valign="top"${leftAttr}>${col(left)}</td>${sp(o.colGap ?? 24)}<td valign="top">${col(right)}</td></tr>`);
}

const GLYPH: Record<string, string> = { linkedin: "in", twitter: "X", facebook: "f", instagram: "ig", youtube: "yt", github: "gh", tiktok: "tk" };

function socialBadges(b: B<"social">, o: { size: number; bg: string; fg: string; gap?: number; dir?: "row" | "col"; round?: boolean; fs?: number }) {
  if (!b.links.length) return "";
  const gap = o.gap ?? 6;
  const cell = (l: B<"social">["links"][number]) => {
    const radius = o.round === false ? 3 : Math.round(o.size / 2);
    return `<td align="center" valign="middle" width="${o.size}" height="${o.size}" bgcolor="${o.bg}" style="width:${o.size}px;height:${o.size}px;background-color:${o.bg};border-radius:${radius}px;"><a href="${esc(l.url)}" target="_blank" title="${esc(NETWORK_LABEL[l.network] ?? l.network)}" style="display:block;color:${o.fg};text-decoration:none;font-size:${o.fs ?? 9}px;font-weight:bold;line-height:${o.size}px;text-align:center;">${GLYPH[l.network] ?? l.network}</a></td>`;
  };
  if (o.dir === "col") return tbl(b.links.map((l, i) => `${i ? `<tr><td height="${gap}" style="height:${gap}px;font-size:1px;line-height:1px;">&nbsp;</td></tr>` : ""}<tr>${cell(l)}</tr>`).join(""));
  return tbl(`<tr>${b.links.map((l, i) => (i ? sp(gap) : "") + cell(l)).join("")}</tr>`);
}

/* ---------- skins: how each template styles its blocks ---------- */

export type Skin = {
  /** Return HTML to override the default for this block, or undefined to use the base renderer. */
  block?: (b: Block, t: Theme) => string | undefined;
  layout: (s: Slots, t: Theme) => string;
};

export class Slots {
  used = new Set<number>();
  constructor(
    public doc: SignatureDoc,
    private skin: Skin,
  ) {}
  html(b: Block) {
    return this.skin.block?.(b, this.doc.theme) ?? renderBlock(b, { theme: this.doc.theme });
  }
  get<T extends Block["type"]>(type: T): Slot<T> | undefined {
    const i = this.doc.blocks.findIndex((b) => b.type === type);
    if (i < 0) return undefined;
    this.used.add(i);
    const b = this.doc.blocks[i] as B<T>;
    const html = this.html(b);
    return html ? { b, html } : undefined;
  }
  leftover(): string[] {
    return this.doc.blocks.flatMap((b, i) => (this.used.has(i) ? [] : [this.html(b)])).filter(Boolean);
  }
}

export const td = (html: string | undefined, attrs = "") => (html ? `<td ${attrs}>${html}</td>` : "");
/** Font stack for a card's root table. `overflow-wrap:anywhere` lets long names/emails wrap instead of widening the card. */
export const fonts = (t: Theme) => `${fontStack(t)};overflow-wrap:anywhere`;

/* ===== editorial-arch (Neermana): beige card, arch photo, big serif name, side strip of socials ===== */
const editorialArch: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      const [f, r] = splitName(b.name);
      return `<div style="font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:38px;color:${t.text};">${esc(f)}</div>${r ? `<div style="font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:38px;color:${t.text};padding-left:26px;">${esc(r)}</div>` : ""}${b.title ? `<div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:26px;font-style:italic;color:${t.text};padding-left:12px;">${esc(b.title)}</div>` : ""}`;
    }
    if (b.type === "contact") return letterRows(items(b, t.text), { fs: 11, lh: 15, gap: 9, lw: 26, lc: t.text, tc: t.text });
    if (b.type === "disclaimer") return `<div style="font-size:11px;line-height:16px;color:${t.text};">${esc(b.text)}</div>`;
    if (b.type === "social") return socialBadges(b, { size: 22, bg: t.primary, fg: t.bg, gap: 8, dir: "col", fs: 11 });
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const di = s.get("disclaimer");
    const company = id?.b.company ? `<div style="font-family:Georgia,'Times New Roman',serif;font-size:13px;color:${t.text};">${esc(id.b.company)}</div>` : "";
    const right = [co?.html, di ? vsp(14) + di.html : ""].filter(Boolean).join(vsp(14));
    const main = `<table ${TABLE_ATTRS}><tr><td colspan="5" style="padding-bottom:14px;">${company}</td></tr><tr>${td(av?.html, 'valign="bottom"')}${sp(14)}${td(id?.html, 'valign="middle"')}${sp(22)}<td valign="middle" style="border-left:1px solid ${mix(t.bg, t.text, 0.35)};padding-left:22px;width:230px;">${right}</td></tr></table>`;
    const strip = so ? `<td valign="middle" align="center" width="44" bgcolor="${t.primary}" style="width:44px;background-color:${t.primary};border-radius:0 12px 12px 0;">${so.html}</td>` : "";
    return `<table ${TABLE_ATTRS} width="710" bgcolor="${t.bg}" style="width:710px;background-color:${t.bg};border-radius:12px;font-family:${fonts(t)};color:${t.text};"><tr><td style="padding:24px 28px;">${main}</td>${strip}</tr></table>`;
  },
};

/* ===== bold-letter (Rukii / Mona Monroe): giant initial block, big lowercase greeting, pill title ===== */
const boldLetter: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      const [f] = splitName(b.name);
      const pill = [b.title, b.company].filter(Boolean).map((x) => esc(x as string)).join(" &middot; ");
      return `<div style="font-size:34px;line-height:34px;font-weight:bold;letter-spacing:-1px;color:${t.text};">hello,</div><div style="font-size:34px;line-height:36px;font-weight:bold;letter-spacing:-1px;color:${t.text};">i&#39;m ${esc(f.toLowerCase())}</div>${pill ? `<div style="padding-top:10px;"><table ${TABLE_ATTRS}><tr><td bgcolor="${t.muted}" style="background-color:${mix(t.bg, t.muted, 0.18)};border-radius:12px;padding:4px 14px 4px 10px;font-size:11px;line-height:14px;color:${t.muted};"><span style="color:${t.muted};">&#9679;</span>&nbsp; ${pill}</td></tr></table></div>` : ""}`;
    }
    if (b.type === "contact") return letterRows(items(b, t.text), { fs: 12, lh: 17, gap: 6, lw: 22, lc: t.text, tc: t.text });
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const initial = esc((splitName(id?.b.name ?? "x")[0][0] ?? "x").toLowerCase());
    const letter = `<td valign="bottom" align="center" width="120" height="150" bgcolor="${t.primary}" style="width:120px;height:150px;background-color:${t.primary};"><div style="font-size:150px;line-height:130px;font-weight:bold;color:${t.bg};letter-spacing:-8px;">${initial}<span style="font-size:60px;">.</span></div></td>`;
    const nameRow = id ? `<div style="font-size:12px;line-height:17px;padding-bottom:6px;"><span style="font-weight:bold;color:${t.text};">N:</span>&nbsp;&nbsp;<span style="color:${t.text};">${esc(id.b.name)}</span></div>` : "";
    const mid = `${id?.html ? `<table ${TABLE_ATTRS}><tr><td>${id.html}</td></tr></table>` : ""}`;
    const right = `${nameRow}${co?.html ?? ""}${so ? vsp(8) + `<div style="font-size:12px;">${so.html}</div>` : ""}`;
    const photo = av ? `<td valign="middle" align="right" style="padding-left:16px;">${av.html}</td>` : "";
    return `<table ${TABLE_ATTRS} width="640" bgcolor="${t.bg}" style="width:640px;background-color:${t.bg};font-family:${fonts(t)};color:${t.text};"><tr>${letter}${sp(22)}<td valign="middle" style="padding:14px 0;">${mid}</td>${sp(22)}<td valign="middle" style="padding:14px 0;">${right}</td>${photo}</tr><tr><td colspan="${5 + (av ? 1 : 0)}" height="4" bgcolor="${t.primary}" style="height:4px;line-height:4px;font-size:1px;background-color:${t.primary};">&nbsp;</td></tr></table>`;
  },
};

/* ===== circle-accent (Dandinie): greeting, circle photo with accent dot, labelled columns ===== */
const circleAccent: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      const [f, r] = splitName(b.name);
      return `<div style="font-size:11px;line-height:16px;color:${t.text};">Hello, my name is</div><div style="font-size:30px;line-height:34px;color:${t.text};">${esc(f)}</div>${r ? `<div style="font-size:30px;line-height:34px;font-weight:bold;color:${t.text};">${esc(r)}</div>` : ""}${b.title ? `<div style="padding-top:6px;font-size:11px;line-height:16px;color:${t.text};">I&#39;m a ${esc(b.title.toLowerCase())}</div>` : ""}`;
    }
    if (b.type === "contact") return stackCols(items(b, t.text), { cols: 2, lfs: 9, lc: t.text, vfs: 9, vlh: 13, gap: 14, colGap: 26, leftW: 110 });
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const brand = id?.b.company ? `<div style="font-size:10px;font-weight:bold;color:${t.text};padding-bottom:30px;"><span style="color:${t.primary};">&#9679;</span> ${esc(id.b.company)}</div>` : vsp(30);
    const dot = `<td valign="bottom" width="50" style="width:50px;"><table ${TABLE_ATTRS}><tr><td width="50" height="50" bgcolor="${t.accent2}" style="width:50px;height:50px;background-color:${t.accent2};border-radius:25px;font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td>`;
    const rightCol = `${co?.html ?? ""}${so ? vsp(12) + so.html : ""}`;
    return `<table ${TABLE_ATTRS} width="690" bgcolor="${t.bg}" style="width:690px;background-color:${t.bg};border-radius:6px;font-family:${fonts(t)};color:${t.text};"><tr><td style="padding:26px 30px;"><table ${TABLE_ATTRS}><tr><td valign="top" width="150" style="width:150px;">${brand}${id?.html ?? ""}</td>${dot}${td(av?.html, 'valign="middle"')}${sp(26)}<td valign="middle">${rightCol}</td></tr></table></td></tr></table>`;
  },
};

/* ===== green-sidebar (Jean Andrean): photo with accent edge, social under the photo, icon rows ===== */
const greenSidebar: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      const sub = [b.title, b.company].filter(Boolean).map((x) => esc(x as string)).join(" &middot; ");
      return `<div style="font-size:22px;line-height:28px;font-weight:bold;color:${t.primary};">${esc(b.name)}</div>${sub ? `<div style="font-size:12px;line-height:18px;letter-spacing:1px;color:${t.muted};">${sub}</div>` : ""}`;
    }
    if (b.type === "contact") return badgeRows(items(b, t.text), { fs: 12, lh: 16, gap: 8, size: 15, bg: t.primary, fg: "#FFFFFF", tc: t.text });
    if (b.type === "social") return socialBadges(b, { size: 20, bg: t.primary, fg: "#FFFFFF", gap: 8, fs: 8 });
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const left = `<td valign="top" bgcolor="${t.primary}" width="12" style="width:12px;background-color:${t.primary};font-size:1px;">&nbsp;</td><td valign="top" style="padding:14px 0 14px 14px;">${av?.html ?? ""}${so ? vsp(10) + so.html : ""}</td>`;
    const rule = `<table ${TABLE_ATTRS} width="100%"><tr><td height="1" style="height:1px;line-height:1px;font-size:1px;border-top:1px solid ${mix("#FFFFFF", t.text, 0.3)};">&nbsp;</td></tr></table>`;
    const right = `<td valign="middle" style="padding:14px 22px 14px 22px;">${id?.html ?? ""}${vsp(8)}${rule}${vsp(10)}${co?.html ?? ""}</td>`;
    return `<table ${TABLE_ATTRS} width="560" bgcolor="${t.bg}" style="width:560px;background-color:${t.bg};border:1px solid #E5E7EB;border-radius:6px;font-family:${fonts(t)};color:${t.text};"><tr>${left}${right}</tr></table>`;
  },
};

/* ===== maroon-frame (Rosalina Josephine): dark editorial card, framed photo, small-caps labels ===== */
const maroonFrame: Skin = {
  block(b, t) {
    if (b.type === "avatar") {
      const photo = `<img src="${esc(b.src)}" width="${b.size}" height="${b.size}" alt="${esc(b.alt)}" style="display:block;border:0;width:${b.size}px;height:${b.size}px;" />`;
      return tbl(`<tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:4px;">${photo}</td></tr>`);
    }
    if (b.type === "identity") {
      const [f, r] = splitName(b.name);
      const serif = "Georgia,'Times New Roman',serif";
      return `<div style="font-family:${serif};font-size:36px;line-height:34px;color:${t.text};">${esc(f.toUpperCase())}</div>${r ? `<div style="font-family:${serif};font-size:36px;line-height:36px;font-style:italic;color:${t.text};">${esc(r.toUpperCase())}</div>` : ""}${b.title ? `<div style="padding-top:8px;font-size:9px;line-height:12px;letter-spacing:1px;text-transform:uppercase;color:${t.text};">${esc(b.title)}</div>` : ""}`;
    }
    if (b.type === "contact") return stackCols(items(b, t.text), { cols: 1, lfs: 8, lc: t.text, vfs: 9, vlh: 12, gap: 9, upper: true });
    if (b.type === "social") return `<div style="font-size:9px;line-height:14px;letter-spacing:1px;text-transform:uppercase;">${b.links.map((l) => `<a href="${esc(l.url)}" target="_blank" style="color:${t.text};text-decoration:none;">${esc(NETWORK_LABEL[l.network] ?? l.network)}</a>`).join(" &nbsp;/&nbsp; ")}</div>`;
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const brand = id?.b.company ? `<div style="font-size:8px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${t.text};">${esc(id.b.company)}</div>` : "";
    const orn = `<td valign="middle" width="40" align="center" style="width:40px;font-family:Georgia,serif;font-size:20px;color:${t.text};">(*)</td>`;
    const right = `${co?.html ?? ""}${so ? vsp(10) + so.html : ""}`;
    return `<table ${TABLE_ATTRS} width="600" bgcolor="${t.bg}" style="width:600px;background-color:${t.bg};font-family:${fonts(t)};color:${t.text};"><tr><td style="padding:22px 28px;"><table ${TABLE_ATTRS}><tr><td colspan="6" style="padding-bottom:14px;">${brand}</td></tr><tr>${td(av?.html, 'valign="middle"')}${av ? sp(22) : ""}${td(id?.html, 'valign="middle"')}${orn}<td valign="middle" style="padding-left:14px;">${right}</td></tr></table></td></tr></table>`;
  },
};

/* ===== spectrum (crkito): gradient edge made of cells, uppercase name with bold accent surname ===== */
const spectrum: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      const [f, r] = splitName(b.name);
      return `<div style="font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${t.text};">${esc(f)}</div><div style="font-size:30px;line-height:32px;font-weight:bold;letter-spacing:0;text-transform:uppercase;color:${t.primary};">${esc(r || f)}</div>${b.title ? `<div style="font-size:12px;line-height:18px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${t.muted};">${esc(b.title)}</div>` : ""}`;
    }
    if (b.type === "contact") return stackCols(items(b, t.text), { cols: 1, lfs: 9, lc: t.text, vfs: 10, vlh: 14, gap: 10 });
    if (b.type === "social") return socialBadges(b, { size: 20, bg: t.primary, fg: "#FFFFFF", gap: 6, fs: 8 });
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const logo = id?.b.company ? `<div style="font-size:16px;line-height:20px;font-weight:bold;color:${t.text};"><span style="color:${t.accent2};">&#9679;</span> ${esc(id.b.company)}</div>` : "";
    const left = `<td valign="top" width="10" style="width:10px;">${vStrip(t.primary, t.accent2, 10, 150)}</td>`;
    const nameCol = `<td valign="middle" style="padding:20px 18px 20px 20px;">${id?.html ?? ""}${so ? vsp(12) + so.html : ""}</td>`;
    const infoCol = `<td valign="middle" style="padding:20px 18px;border-left:1px solid #E5E7EB;">${logo ? logo + vsp(10) : ""}${co?.html ?? ""}</td>`;
    const photo = td(av?.html, 'valign="middle" style="padding:14px 18px 14px 6px;"');
    return `<table ${TABLE_ATTRS} width="640" bgcolor="${t.bg}" style="width:640px;background-color:${t.bg};border:1px solid #ECECEC;border-radius:4px;font-family:${fonts(t)};color:${t.text};"><tr>${left}${nameCol}${infoCol}${photo}</tr></table>`;
  },
};

/* ===== geometric (Angelina Cours): tile pattern drawn with coloured cells ===== */
function patternBlock(t: Theme) {
  const navy = t.text;
  const o = t.accent2;
  const cream = mix(t.bg, "#FFFFFF", 0.55);
  const tiles = ["o c w n", "c n o w", "w o c n", "n w n o"].map((r) => r.split(" "));
  const T = 38;
  const cellOf = (k: string) => {
    const base = `width:${T}px;height:${T}px;font-size:1px;line-height:1px;`;
    if (k === "o") return `<td width="${T}" height="${T}" bgcolor="${o}" style="${base}background-color:${o};">&nbsp;</td>`;
    if (k === "n") return `<td width="${T}" height="${T}" bgcolor="${navy}" style="${base}background-color:${navy};">&nbsp;</td>`;
    if (k === "w") return `<td width="${T}" height="${T}" bgcolor="${cream}" style="${base}background-color:${cream};">&nbsp;</td>`;
    return `<td width="${T}" height="${T}" style="${base}">${tbl(`<tr><td width="${T - 6}" height="${T - 6}" bgcolor="${navy}" style="width:${T - 6}px;height:${T - 6}px;background-color:${navy};border-radius:${(T - 6) / 2}px;font-size:1px;line-height:1px;">&nbsp;</td></tr>`, 'style="margin:3px;"')}</td>`;
  };
  return tbl(tiles.map((r) => `<tr>${r.map(cellOf).join("")}</tr>`).join(""));
}
const geometric: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      const [f, r] = splitName(b.name);
      return `<div style="font-size:32px;line-height:36px;color:${t.text};">${esc(f)}</div>${r ? `<div style="font-size:32px;line-height:36px;color:${t.text};">${esc(r)}</div>` : ""}${b.title ? `<div style="padding-top:4px;font-size:14px;line-height:20px;color:${t.text};">${esc(b.title)}</div>` : ""}`;
    }
    if (b.type === "contact") return badgeRows(items(b, t.text), { fs: 12, lh: 16, gap: 9, size: 16, bg: t.text, fg: t.bg, tc: t.text, round: false });
    if (b.type === "social") return socialBadges(b, { size: 20, bg: t.text, fg: t.bg, gap: 6, round: false, fs: 8 });
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const company = id?.b.company ? `<div style="padding-top:12px;font-size:10px;line-height:14px;color:${t.text};">${esc(id.b.company)}</div>` : "";
    const mid = `<td valign="middle" style="padding:18px 20px;">${id?.html ?? ""}${vsp(12)}${co?.html ?? ""}${so ? vsp(10) + so.html : ""}${company}</td>`;
    return `<table ${TABLE_ATTRS} width="620" bgcolor="${t.bg}" style="width:620px;background-color:${t.bg};border-radius:4px;font-family:${fonts(t)};color:${t.text};"><tr><td valign="top" width="152" style="width:152px;">${patternBlock(t)}</td>${mid}${td(av?.html, 'valign="middle" style="padding-right:22px;"')}</tr></table>`;
  },
};

/* ===== noir-agent (Emily Hansen / Moira Mundy): high-contrast realtor card with a footer bar ===== */
const noirAgent: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      return `<div style="font-size:24px;line-height:28px;letter-spacing:2px;text-transform:uppercase;color:${t.text};">${esc(b.name)}</div>${b.title ? `<div style="padding-top:2px;font-size:10px;line-height:14px;letter-spacing:2px;text-transform:uppercase;color:${t.muted};">${esc(b.title)}</div>` : ""}`;
    }
    if (b.type === "contact") return badgeRows(items(b, t.text), { fs: 11, lh: 15, gap: 7, size: 16, bg: t.primary, fg: t.bg, tc: t.text });
    if (b.type === "social") return socialBadges(b, { size: 20, bg: t.bg, fg: t.primary, gap: 8, fs: 8 });
    if (b.type === "disclaimer") return `<div style="font-size:9px;line-height:13px;color:${mix(t.primary, "#FFFFFF", 0.7)};">${esc(b.text)}</div>`;
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const di = s.get("disclaimer");
    const company = id?.b.company ? `<div style="padding-top:12px;font-size:13px;line-height:18px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${t.text};">${esc(id.b.company)}</div>` : "";
    const rule = `<table ${TABLE_ATTRS} width="100%"><tr><td height="1" style="height:1px;line-height:1px;font-size:1px;border-top:1px solid ${t.primary};">&nbsp;</td></tr></table>`;
    const text = `<td valign="middle" style="padding:24px 10px 20px 28px;">${id?.html ?? ""}${vsp(10)}${rule}${company}${vsp(10)}${co?.html ?? ""}</td>`;
    const photo = td(av?.html, 'valign="middle" style="padding:20px 28px 16px 10px;"');
    const footer = `<tr><td colspan="2" bgcolor="${t.primary}" style="background-color:${t.primary};padding:10px 28px;"><table ${TABLE_ATTRS} width="100%"><tr><td valign="middle">${di?.html ?? ""}</td>${so ? `<td valign="middle" align="right">${so.html}</td>` : ""}</tr></table></td></tr>`;
    return `<table ${TABLE_ATTRS} width="620" bgcolor="${t.bg}" style="width:620px;background-color:${t.bg};font-family:${fonts(t)};color:${t.text};"><tr>${text}${photo}</tr>${footer}</table>`;
  },
};

/* ===== orange-logo (John Zarranger): compact agent line with logo at the right ===== */
const orangeLogo: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      const sub = [b.title, b.company].filter(Boolean).map((x) => esc(x as string)).join(" | ");
      return `<div style="font-size:15px;line-height:20px;font-weight:bold;color:${t.primary};">${esc(b.name)}</div>${sub ? `<div style="font-size:11px;line-height:16px;font-weight:bold;color:${t.text};">${sub}</div>` : ""}`;
    }
    if (b.type === "contact") return letterRows(items(b, t.text, t.primary), { fs: 10, lh: 15, gap: 4, lw: 18, lc: t.muted, tc: t.text, label: { phone: "Tel:", email: "@", website: "", address: "A:" } as Record<Key, string> });
    if (b.type === "social") return socialBadges(b, { size: 17, bg: "#2563EB", fg: "#FFFFFF", gap: 6, round: false, fs: 8 });
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const rule = `<table ${TABLE_ATTRS}><tr><td width="34" height="2" bgcolor="${t.primary}" style="width:34px;height:2px;line-height:2px;font-size:1px;background-color:${t.primary};">&nbsp;</td></tr></table>`;
    const text = `<td valign="top" style="padding-right:30px;">${id?.html ?? ""}${vsp(6)}${rule}${vsp(6)}${co?.html ?? ""}${so ? vsp(8) + so.html : ""}</td>`;
    return `<table ${TABLE_ATTRS} bgcolor="${t.bg}" style="background-color:${t.bg};font-family:${fonts(t)};color:${t.text};"><tr>${text}${td(av?.html, 'valign="middle"')}</tr></table>`;
  },
};

/* ===== ticket (museum ticket): cream body, accent band, black stub with barcode ===== */
function barcode(fg: string, bg: string) {
  const widths = [2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 2, 1, 1, 2];
  const cells = widths.map((w, i) => `<td width="${w * 2}" height="44" bgcolor="${i % 2 ? bg : fg}" style="width:${w * 2}px;height:44px;font-size:1px;line-height:1px;background-color:${i % 2 ? bg : fg};">&nbsp;</td>`).join("");
  return tbl(`<tr>${cells}</tr>`);
}
const ticket: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      return `<div style="font-size:14px;line-height:18px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${t.text};">${esc(b.company ?? b.name)}</div>${b.company ? `<div style="font-size:12px;line-height:18px;color:${t.text};">${esc(b.name)}${b.title ? ` &middot; ${esc(b.title)}` : ""}</div>` : b.title ? `<div style="font-size:12px;line-height:18px;color:${t.text};">${esc(b.title)}</div>` : ""}`;
    }
    if (b.type === "contact") {
      const it = items(b, t.text);
      return tbl(`<tr>${it.map((x, i) => `${i ? sp(26) : ""}<td valign="middle" style="font-size:12px;line-height:18px;color:${t.text};">${x.html}</td>`).join("")}</tr>`);
    }
    if (b.type === "social") return socialBadges(b, { size: 20, bg: t.bg, fg: t.text, gap: 6, round: false, fs: 8 });
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const stripe = `<table ${TABLE_ATTRS} width="100%"><tr><td align="right"><table ${TABLE_ATTRS}><tr><td width="64" height="10" bgcolor="${t.primary}" style="width:64px;height:10px;background-color:${t.primary};font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td></tr></table>`;
    const number = co ? `<div style="padding-top:6px;text-align:right;font-family:'Courier New',monospace;font-size:13px;letter-spacing:1px;color:${t.text};">${esc(((s.doc.blocks.find((x) => x.type === "contact") as B<"contact">).phone ?? "").replace(/[^\d]/g, "") || "000000114351")}</div>` : "";
    const head = `<table ${TABLE_ATTRS} width="100%"><tr>${td(av?.html, 'valign="top" width="84" style="width:84px;"')}<td valign="top" style="padding-left:14px;">${id?.html ?? ""}</td><td valign="bottom" align="right" width="150" style="width:150px;">${stripe}${number}</td></tr></table>`;
    const band = co ? `<tr><td bgcolor="${t.primary}" style="background-color:${t.primary};padding:10px 22px;">${co.html}</td></tr>` : "";
    const main = `<table ${TABLE_ATTRS} width="480" bgcolor="${t.bg}" style="width:480px;background-color:${t.bg};border-radius:10px 0 0 10px;"><tr><td style="padding:20px 22px 18px 22px;">${head}</td></tr>${band}</table>`;
    const stub = `<table ${TABLE_ATTRS} width="130" bgcolor="${t.text}" style="width:130px;background-color:${t.text};border-radius:0 10px 10px 0;"><tr><td valign="middle" align="center" style="padding:16px 12px;border-left:2px dashed ${t.bg};">${barcode(t.bg, t.text)}${so ? vsp(10) + `<div style="text-align:center;">${tbl(`<tr><td>${so.html}</td></tr>`, 'align="center"')}</div>` : ""}</td></tr></table>`;
    return `<table ${TABLE_ATTRS} style="font-family:${fonts(t)};color:${t.text};"><tr><td valign="top">${main}</td><td valign="top">${stub}</td></tr></table>`;
  },
};

/* ===== listing-banner (Jason Roberts): headshot, icon rows, promo banner, social ===== */
const listingBanner: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      return `<div style="font-size:18px;line-height:22px;font-weight:bold;color:${t.text};">${esc(b.name)}</div>${b.title || b.company ? `<div style="font-size:13px;line-height:18px;color:${t.muted};">${[b.title, b.company].filter(Boolean).map((x) => esc(x as string)).join(" &middot; ")}</div>` : ""}`;
    }
    if (b.type === "contact") return badgeRows(items(b, t.text), { fs: 12, lh: 16, gap: 7, size: 15, bg: t.text, fg: "#FFFFFF", tc: t.text, round: false });
    if (b.type === "social") return socialBadges(b, { size: 22, bg: t.primary, fg: "#FFFFFF", gap: 8, round: false, fs: 9 });
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const ba = s.get("banner");
    const so = s.get("social");
    const rule = `<table ${TABLE_ATTRS} width="100%"><tr><td height="1" style="height:1px;line-height:1px;font-size:1px;border-top:1px solid #D1D5DB;">&nbsp;</td></tr></table>`;
    const top = `<table ${TABLE_ATTRS}><tr>${td(av?.html, 'valign="top" style="padding-right:14px;"')}<td valign="top" width="300" style="width:300px;">${id?.html ?? ""}${vsp(8)}${rule}${vsp(8)}${co?.html ?? ""}</td></tr></table>`;
    const inner = [top, ba ? `<div style="padding-top:12px;">${ba.html}</div>` : "", so ? `<div style="padding-top:12px;">${so.html}</div>` : ""].join("");
    return `<table ${TABLE_ATTRS} width="480" bgcolor="${t.bg}" style="width:480px;background-color:${t.bg};border:1px solid #E5E7EB;border-radius:8px;font-family:${fonts(t)};color:${t.text};"><tr><td style="padding:14px;">${inner}</td></tr></table>`;
  },
};

/* ===== soft-card (Beth McMillan): rounded white card, pastel accents, follow-us badges ===== */
const softCard: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      return `<div style="font-size:15px;line-height:20px;font-weight:bold;color:${t.primary};">${esc(b.name)}</div>${b.title ? `<div style="font-size:13px;line-height:18px;color:${t.text};">${esc(b.title)}</div>` : ""}${b.company ? `<div style="padding-top:12px;font-size:13px;line-height:18px;font-weight:bold;color:${t.text};">${esc(b.company)}</div>` : ""}`;
    }
    if (b.type === "contact") return letterRows(items(b, t.text), { fs: 12, lh: 17, gap: 3, lw: 26, lc: t.primary, tc: t.text, label: { phone: "+ t", email: "+ e", website: "+ w", address: "+ a" } as Record<Key, string> });
    if (b.type === "social") return `<table ${TABLE_ATTRS}><tr><td valign="middle" style="font-size:12px;font-weight:bold;color:${t.text};padding-right:10px;">Follow us:</td><td valign="middle">${socialBadges(b, { size: 19, bg: mix(t.primary, "#FFFFFF", 0.35), fg: "#FFFFFF", gap: 6, fs: 8 })}</td></tr></table>`;
    if (b.type === "disclaimer") return `<div style="font-size:11px;line-height:16px;color:${t.text};">${esc(b.text)}</div>`;
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const di = s.get("disclaimer");
    const right = `${co?.html ?? ""}${so ? vsp(10) + so.html : ""}`;
    const rows = `<tr>${td(av?.html, 'valign="top" style="padding-right:20px;"')}<td valign="top">${right}</td></tr>`;
    const head = `<div style="padding-bottom:14px;">${id?.html ?? ""}</div>`;
    return `<table ${TABLE_ATTRS} width="540" bgcolor="${t.bg}" style="width:540px;background-color:${t.bg};border:1px solid ${mix(t.primary, "#FFFFFF", 0.7)};border-radius:28px;font-family:${fonts(t)};color:${t.text};"><tr><td style="padding:22px 28px;">${head}<table ${TABLE_ATTRS}>${rows}</table>${di ? vsp(12) + di.html : ""}</td></tr></table>`;
  },
};

/* ===== consultant-blue (Aura Salsabila): white head with serif name, solid contact bar ===== */
const consultantBlue: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      return `<div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:32px;font-weight:bold;color:${t.primary};">${esc(b.name)}</div>${b.title ? `<div style="font-size:15px;line-height:22px;font-weight:bold;color:${t.accent2};">${esc(b.title)}</div>` : ""}`;
    }
    if (b.type === "contact") {
      const it = items(b, "#FFFFFF");
      return tbl(`<tr>${it.map((x, i) => `${i ? sp(22) : ""}<td valign="middle" width="${22}" style="width:22px;">${badge(ICON[x.k], { size: 18, bg: "#FFFFFF", fg: t.primary, fs: 8 })}</td><td valign="middle" style="font-size:11px;line-height:15px;color:#FFFFFF;">${x.html}</td>`).join("")}</tr>`);
    }
    if (b.type === "social") return socialBadges(b, { size: 22, bg: t.primary, fg: "#FFFFFF", gap: 6, fs: 8 });
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const company = id?.b.company ? `<div style="font-size:10px;line-height:14px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${t.text};padding-bottom:12px;">${esc(id.b.company)}</div>` : "";
    const head = `<table ${TABLE_ATTRS} width="100%"><tr>${td(av?.html, 'valign="middle" width="130" style="width:130px;padding-right:20px;"')}<td valign="middle">${company}${id?.html ?? ""}${so ? vsp(10) + so.html : ""}</td></tr></table>`;
    const bar = co ? `<tr><td bgcolor="${t.primary}" style="background-color:${t.primary};padding:14px 28px;border-radius:0 0 14px 14px;">${co.html}</td></tr>` : "";
    return `<table ${TABLE_ATTRS} width="620" bgcolor="${t.bg}" style="width:620px;background-color:${t.bg};border-radius:14px;font-family:${fonts(t)};color:${t.text};"><tr><td style="padding:22px 28px;">${head}</td></tr>${bar}</table>`;
  },
};

/* ===== executive-navy: navy side panel with portrait + socials, gold rule, icon rows ===== */
const executiveNavy: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      return `<div style="font-size:22px;line-height:28px;font-weight:bold;color:${t.primary};">${esc(b.name)}</div>${b.title ? `<div style="font-size:11px;line-height:16px;letter-spacing:2px;text-transform:uppercase;color:${t.muted};">${esc(b.title)}</div>` : ""}${b.company ? `<div style="padding-top:2px;font-size:13px;line-height:18px;font-weight:bold;color:${t.text};">${esc(b.company)}</div>` : ""}`;
    }
    if (b.type === "contact") return badgeRows(items(b, t.text), { fs: 12, lh: 16, gap: 8, size: 16, bg: t.primary, fg: "#FFFFFF", tc: t.text });
    if (b.type === "social") return socialBadges(b, { size: 22, bg: t.accent2, fg: t.primary, gap: 8, fs: 9 });
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const gold = `<table ${TABLE_ATTRS}><tr><td width="44" height="3" bgcolor="${t.accent2}" style="width:44px;height:3px;line-height:3px;font-size:1px;background-color:${t.accent2};">&nbsp;</td></tr></table>`;
    const left = `<td valign="middle" align="center" width="170" bgcolor="${t.primary}" style="width:170px;background-color:${t.primary};padding:24px 18px;border-radius:8px 0 0 8px;">${av ? `<table ${TABLE_ATTRS} align="center"><tr><td>${av.html}</td></tr></table>` : ""}${so ? vsp(14) + `<table ${TABLE_ATTRS} align="center"><tr><td>${so.html}</td></tr></table>` : ""}</td>`;
    const right = `<td valign="middle" style="padding:24px 28px;">${id?.html ?? ""}${vsp(10)}${gold}${vsp(12)}${co?.html ?? ""}</td>`;
    return `<table ${TABLE_ATTRS} width="600" bgcolor="${t.bg}" style="width:600px;background-color:${t.bg};border:1px solid #E5E7EB;border-radius:8px;font-family:${fonts(t)};color:${t.text};"><tr>${left}${right}</tr></table>`;
  },
};

/* ===== minimal-line: thin accent line on top, small portrait, inline contact ===== */
const minimalLine: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      const sub = [b.title, b.company].filter(Boolean).map((x) => esc(x as string)).join(" &middot; ");
      return `<div style="font-size:20px;line-height:26px;font-weight:bold;color:${t.text};">${esc(b.name)}</div>${sub ? `<div style="font-size:13px;line-height:18px;color:${t.muted};">${sub}</div>` : ""}`;
    }
    if (b.type === "contact") return `<div style="font-size:12px;line-height:19px;color:${t.text};">${items(b, t.text, t.primary).map((x) => x.html).join(`<span style="color:${t.muted};"> &nbsp;|&nbsp; </span>`)}</div>`;
    if (b.type === "social") return `<div style="font-size:12px;line-height:18px;font-weight:bold;">${b.links.map((l) => `<a href="${esc(l.url)}" target="_blank" style="color:${t.primary};text-decoration:none;">${esc(NETWORK_LABEL[l.network] ?? l.network)}</a>`).join(`<span style="color:${t.muted};"> &nbsp;/&nbsp; </span>`)}</div>`;
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const bar = `<tr><td colspan="2" height="3" bgcolor="${t.primary}" style="height:3px;line-height:3px;font-size:1px;background-color:${t.primary};">&nbsp;</td></tr>`;
    const text = `<td valign="middle" style="padding:18px 0 18px 0;">${id?.html ?? ""}${co ? vsp(8) + co.html : ""}${so ? vsp(6) + so.html : ""}</td>`;
    return `<table ${TABLE_ATTRS} width="560" bgcolor="${t.bg}" style="width:560px;background-color:${t.bg};font-family:${fonts(t)};color:${t.text};">${bar}<tr>${td(av?.html, 'valign="middle" width="96" style="width:96px;padding:18px 18px 18px 0;"')}${text}</tr></table>`;
  },
};

/* ===== dark-luxe: black card, gold hairlines, serif caps name ===== */
const darkLuxe: Skin = {
  block(b, t) {
    const serif = "Georgia,'Times New Roman',serif";
    if (b.type === "avatar") {
      const img = `<img src="${esc(b.src)}" width="${b.size}" height="${b.size}" alt="${esc(b.alt)}" style="display:block;border:0;width:${b.size}px;height:${b.size}px;" />`;
      return tbl(`<tr><td style="border:1px solid ${t.primary};padding:4px;">${img}</td></tr>`);
    }
    if (b.type === "identity") {
      return `<div style="font-family:${serif};font-size:30px;line-height:34px;letter-spacing:3px;text-transform:uppercase;color:${t.text};">${esc(b.name)}</div>${b.title ? `<div style="padding-top:4px;font-size:11px;line-height:16px;letter-spacing:3px;text-transform:uppercase;color:${t.primary};">${esc(b.title)}${b.company ? ` &nbsp;&middot;&nbsp; ${esc(b.company)}` : ""}</div>` : ""}`;
    }
    if (b.type === "contact") {
      const it = items(b, t.text);
      return tbl(`<tr>${it.map((x, i) => `${i ? sp(26) : ""}<td valign="top"><div style="font-size:8px;line-height:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${t.primary};">${WORD[x.k]}</div><div style="font-size:11px;line-height:16px;color:${t.text};">${x.html}</div></td>`).join("")}</tr>`);
    }
    if (b.type === "social") return `<div style="font-size:10px;line-height:14px;letter-spacing:2px;text-transform:uppercase;">${b.links.map((l) => `<a href="${esc(l.url)}" target="_blank" style="color:${t.primary};text-decoration:none;">${esc(NETWORK_LABEL[l.network] ?? l.network)}</a>`).join(" &nbsp;&middot;&nbsp; ")}</div>`;
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const line = `<table ${TABLE_ATTRS} width="100%"><tr><td height="1" style="height:1px;line-height:1px;font-size:1px;border-top:1px solid ${t.primary};">&nbsp;</td></tr></table>`;
    const top = `<table ${TABLE_ATTRS} width="100%"><tr><td valign="middle">${id?.html ?? ""}</td>${td(av?.html, 'valign="middle" align="right" style="padding-left:20px;"')}</tr></table>`;
    const bottom = `<table ${TABLE_ATTRS} width="100%"><tr><td valign="middle">${co?.html ?? ""}</td>${so ? `<td valign="bottom" align="right">${so.html}</td>` : ""}</tr></table>`;
    return `<table ${TABLE_ATTRS} width="620" bgcolor="${t.bg}" style="width:620px;background-color:${t.bg};font-family:${fonts(t)};color:${t.text};"><tr><td style="padding:28px 30px;">${top}${vsp(16)}${line}${vsp(16)}${bottom}</td></tr></table>`;
  },
};

/* ===== pastel-pill: soft tinted card, ringed portrait, title pill ===== */
const pastelPill: Skin = {
  block(b, t) {
    if (b.type === "avatar") {
      const img = `<img src="${esc(b.src)}" width="${b.size}" height="${b.size}" alt="${esc(b.alt)}" style="display:block;border:0;width:${b.size}px;height:${b.size}px;border-radius:50%;" />`;
      return tbl(`<tr><td bgcolor="${t.primary}" style="background-color:${t.primary};border-radius:50%;padding:4px;">${img}</td></tr>`);
    }
    if (b.type === "identity") {
      return `<div style="font-size:22px;line-height:28px;font-weight:bold;color:${t.text};">${esc(b.name)}</div>${b.title ? `<div style="padding-top:6px;"><table ${TABLE_ATTRS}><tr><td bgcolor="${t.primary}" style="background-color:${t.primary};border-radius:12px;padding:3px 12px;font-size:11px;line-height:16px;font-weight:bold;color:#FFFFFF;">${esc(b.title)}</td></tr></table></div>` : ""}${b.company ? `<div style="padding-top:6px;font-size:13px;line-height:18px;font-weight:bold;color:${t.muted};">${esc(b.company)}</div>` : ""}`;
    }
    if (b.type === "contact") return badgeRows(items(b, t.text), { fs: 12, lh: 16, gap: 7, size: 17, bg: t.primary, fg: "#FFFFFF", tc: t.text });
    if (b.type === "social") return socialBadges(b, { size: 22, bg: t.primary, fg: "#FFFFFF", gap: 8, fs: 9 });
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const right = `${id?.html ?? ""}${vsp(10)}${co?.html ?? ""}${so ? vsp(10) + so.html : ""}`;
    return `<table ${TABLE_ATTRS} width="540" bgcolor="${t.bg}" style="width:540px;background-color:${t.bg};border-radius:26px;font-family:${fonts(t)};color:${t.text};"><tr><td style="padding:24px 28px;"><table ${TABLE_ATTRS}><tr>${td(av?.html, 'valign="top" style="padding-right:22px;"')}<td valign="middle">${right}</td></tr></table></td></tr></table>`;
  },
};

/* ===== split-color: solid colour panel with name, white panel with contact ===== */
const splitColor: Skin = {
  block(b, t) {
    if (b.type === "identity") {
      return `<div style="font-size:22px;line-height:27px;font-weight:bold;color:#FFFFFF;">${esc(b.name)}</div>${b.title ? `<div style="font-size:12px;line-height:18px;color:#FFFFFF;">${esc(b.title)}</div>` : ""}${b.company ? `<div style="padding-top:8px;font-size:10px;line-height:14px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${t.accent2};">${esc(b.company)}</div>` : ""}`;
    }
    if (b.type === "contact") return stackCols(items(b, t.text), { cols: 1, lfs: 9, lc: t.primary, vfs: 12, vlh: 17, gap: 10, upper: true });
    if (b.type === "social") return socialBadges(b, { size: 22, bg: t.primary, fg: "#FFFFFF", gap: 8, fs: 9 });
  },
  layout(s, t) {
    const av = s.get("avatar");
    const id = s.get("identity");
    const co = s.get("contact");
    const so = s.get("social");
    const left = `<td valign="middle" width="230" bgcolor="${t.primary}" style="width:230px;background-color:${t.primary};padding:24px;border-radius:10px 0 0 10px;">${av?.html ?? ""}${av ? vsp(14) : ""}${id?.html ?? ""}</td>`;
    const right = `<td valign="middle" style="padding:24px 28px;">${co?.html ?? ""}${so ? vsp(14) + so.html : ""}</td>`;
    return `<table ${TABLE_ATTRS} width="600" bgcolor="${t.bg}" style="width:600px;background-color:${t.bg};border:1px solid #E5E7EB;border-radius:10px;font-family:${fonts(t)};color:${t.text};"><tr>${left}${right}</tr></table>`;
  },
};

const SKINS: Record<Exclude<CardId, "studio">, Skin> = {
  "executive-navy": executiveNavy,
  "minimal-line": minimalLine,
  "dark-luxe": darkLuxe,
  "pastel-pill": pastelPill,
  "split-color": splitColor,
  "editorial-arch": editorialArch,
  "bold-letter": boldLetter,
  "circle-accent": circleAccent,
  "green-sidebar": greenSidebar,
  "maroon-frame": maroonFrame,
  spectrum,
  geometric,
  "noir-agent": noirAgent,
  "orange-logo": orangeLogo,
  ticket,
  "listing-banner": listingBanner,
  "soft-card": softCard,
  "consultant-blue": consultantBlue,
};

/** HTML for one block under a card template (used by click-to-edit to match preview cells back to blocks). */
function skinFor(doc: SignatureDoc): Skin {
  return doc.template_id === "studio" ? composeSkin(doc.variant ?? "s001") : SKINS[doc.template_id as Exclude<CardId, "studio">];
}

export function renderCardBlock(b: Block, doc: SignatureDoc): string {
  return new Slots(doc, skinFor(doc)).html(b);
}

export function renderCardTemplate(doc: SignatureDoc): string {
  const skin = skinFor(doc);
  const slots = new Slots(doc, skin);
  const card = skin.layout(slots, doc.theme);
  const extras = slots.leftover();
  if (!extras.length) return card;
  const gap = GAP[doc.theme.spacing];
  const rows = [card, ...extras].map((h, i) => `<tr><td style="padding-top:${i === 0 ? 0 : gap}px;">${h}</td></tr>`).join("");
  return tbl(rows, `style="font-family:${fonts(doc.theme)};color:${doc.theme.text};"`);
}
