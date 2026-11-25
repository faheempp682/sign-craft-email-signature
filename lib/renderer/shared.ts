import type { Block, Theme } from "@/lib/schema/document";
import { applyBlockStyle } from "./block-style";
import { renderRow } from "./row";

/* ---------- escaping / sanitising (all user text passes through these) ---------- */

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Returns an https URL or null. Bare domains ("acme.com") get https:// prepended. */
export function safeHttpsUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.protocol = "https:";
    return u.toString();
  } catch {
    return null;
  }
}

export function telHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.length >= 5 ? `tel:${digits}` : null;
}

/* ---------- style helpers ---------- */

export const GAP = { compact: 4, normal: 8, airy: 12 } as const;

export const TABLE_ATTRS = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;

export function fontStack(theme: Theme): string {
  const generic = ["Georgia", "Times New Roman"].includes(theme.font) ? "serif" : theme.font === "Courier New" ? "monospace" : "sans-serif";
  return `${theme.font}, ${generic}`;
}

export function link(href: string, text: string, theme: Theme, extra = ""): string {
  return `<a href="${esc(href)}" target="_blank" style="color:${theme.primary};text-decoration:none;${extra}">${text}</a>`;
}

/* ---------- block renderers: each returns inner HTML for one <td> ---------- */

export type Ctx = { theme: Theme };

export function renderAvatar(b: Extract<Block, { type: "avatar" }>): string {
  const radius = b.shape === "circle" ? "50%" : b.shape === "rounded" ? "12px" : b.shape === "arch" ? `${Math.round(b.size / 2)}px ${Math.round(b.size / 2)}px 0 0` : "0";
  // border-radius is ignored by Outlook desktop, which falls back to a square. Acceptable degradation.
  return `<img src="${esc(b.src)}" width="${b.size}" height="${b.size}" alt="${esc(b.alt)}" style="display:block;border:0;width:${b.size}px;height:${b.size}px;border-radius:${radius};" />`;
}

function renderIdentity(b: Extract<Block, { type: "identity" }>, { theme }: Ctx): string {
  const parts = [`<div style="font-size:18px;font-weight:bold;line-height:22px;color:${theme.text};">${esc(b.name)}</div>`];
  const sub = [b.title, b.company].filter(Boolean).map((s) => esc(s as string));
  if (sub.length) {
    parts.push(`<div style="font-size:13px;line-height:18px;color:${theme.muted};">${sub.join(" &middot; ")}</div>`);
  }
  return parts.join("");
}

function renderContact(b: Extract<Block, { type: "contact" }>, { theme }: Ctx): string {
  const lines: string[] = [];
  if (b.phone) {
    const href = telHref(b.phone);
    lines.push(href ? link(href, esc(b.phone), theme, `color:${theme.text};`) : esc(b.phone));
  }
  if (b.email) lines.push(link(`mailto:${b.email}`, esc(b.email), theme, `color:${theme.text};`));
  if (b.website) {
    const href = safeHttpsUrl(b.website);
    const label = b.website.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    lines.push(href ? link(href, esc(label), theme) : esc(label));
  }
  if (b.address) lines.push(esc(b.address));
  if (!lines.length) return "";
  return `<div style="font-size:13px;line-height:20px;color:${theme.text};">${lines.join("<br />")}</div>`;
}

export const NETWORK_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  twitter: "X",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  github: "GitHub",
  tiktok: "TikTok",
};

/** Hosted PNG badges (brand colour, white glyph) on Bunny; built by scripts/build-social-icons.mjs. */
export const SOCIAL_ICON_BASE = (process.env.NEXT_PUBLIC_SOCIAL_ICON_BASE || "https://sign-craft.b-cdn.net/social-icons/v1").replace(/\/+$/, "");

/** badge = full-colour round icon; glyph = white glyph on transparent; knock = 88% white tile with the glyph cut out (both sit on a coloured cell). */
export function socialIconUrl(network: string, variant: "badge" | "glyph" | "knock" = "badge"): string {
  return `${SOCIAL_ICON_BASE}/${variant === "badge" ? "" : `${variant}/`}${network}.png`;
}

type SocialBlock = Extract<Block, { type: "social" }>;

/**
 * Social links in the client's chosen display: icon only, icon + name, or name only.
 * `dir: "col"` stacks them (for side strips); `size` is the icon edge in px.
 */
export function socialDisplay(
  b: SocialBlock,
  theme: Pick<Theme, "text">,
  o: { size?: number; gap?: number; dir?: "row" | "col"; fs?: number; color?: string } = {},
): string {
  if (!b.links.length) return "";
  const mode = b.display ?? "text";
  const size = o.size ?? 24;
  const gap = o.gap ?? 8;
  const fs = o.fs ?? 12;
  const color = o.color ?? theme.text;
  const cell = (l: SocialBlock["links"][number]) => {
    const label = NETWORK_LABEL[l.network] ?? l.network;
    const href = esc(l.url);
    const icon = `<a href="${href}" target="_blank" style="text-decoration:none;"><img src="${esc(l.icon ?? socialIconUrl(l.network))}" width="${size}" height="${size}" alt="${esc(label)}" style="display:block;border:0;width:${size}px;height:${size}px;" /></a>`;
    const text = `<a href="${href}" target="_blank" style="color:${color};text-decoration:none;font-size:${fs}px;line-height:${size}px;font-weight:bold;">${esc(label)}</a>`;
    if (mode === "icon") return icon;
    if (mode === "text") return text;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td valign="middle" width="${size}" style="width:${size}px;">${icon}</td><td valign="middle" style="padding-left:6px;">${text}</td></tr></table>`;
  };
  const wrap = (inner: string) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${inner}</table>`;
  const sepRow = `<td width="${gap}" style="width:${gap}px;font-size:1px;line-height:1px;">&nbsp;</td>`;
  if (o.dir === "col") return wrap(b.links.map((l, i) => `${i ? `<tr><td height="${gap}" style="height:${gap}px;font-size:1px;line-height:1px;">&nbsp;</td></tr>` : ""}<tr><td valign="middle">${cell(l)}</td></tr>`).join(""));
  return wrap(`<tr>${b.links.map((l, i) => `${i ? sepRow : ""}<td valign="middle">${cell(l)}</td>`).join("")}</tr>`);
}

function renderSocial(b: SocialBlock, { theme }: Ctx): string {
  if (b.display) return socialDisplay(b, theme);
  const items = b.links.map((l) => link(l.url, NETWORK_LABEL[l.network] ?? l.network, theme, "font-weight:bold;"));
  if (!items.length) return "";
  return `<div style="font-size:12px;line-height:18px;">${items.join(` <span style="color:${theme.muted};">|</span> `)}</div>`;
}

/**
 * What a banner needs to become a tracked link. `sign` turns a payload into an opaque token (HMAC; the secret lives on
 * the server, never in the renderer). Without these options, or with `track` false, banners render exactly as before.
 */
export type TrackPayload = { t: "r" | "b"; c?: string; s: string; h?: string; f?: string };
export type TrackOptions = { baseUrl: string; signatureId: string; sign: (payload: TrackPayload) => string };

// Rendering is fully synchronous, so a scoped module variable is safe and avoids threading options through every skin.
let activeTrack: TrackOptions | undefined;

/** Run `fn` with tracking options in force (restored afterwards, even on error). */
export function withTracking<T>(opts: TrackOptions | undefined, fn: () => T): T {
  const prev = activeTrack;
  activeTrack = opts;
  try {
    return fn();
  } finally {
    activeTrack = prev;
  }
}

export function renderBanner(b: Extract<Block, { type: "banner" }>): string {
  const t = b.track && activeTrack ? activeTrack : undefined;
  let src = b.src;
  let href = b.href;
  if (t) {
    const base = t.baseUrl.replace(/\/+$/, "");
    if (b.campaign_id) src = `${base}/b/${t.sign({ t: "b", c: b.campaign_id, s: t.signatureId, f: b.src })}`;
    if (b.campaign_id || b.href) href = `${base}/r/${t.sign({ t: "r", c: b.campaign_id, s: t.signatureId, h: b.href })}`;
  }
  const img = `<img src="${esc(src)}" width="${b.width}" height="${b.height}" alt="${esc(b.alt)}" style="display:block;border:0;width:${b.width}px;height:${b.height}px;" />`;
  return href ? `<a href="${esc(href)}" target="_blank" style="text-decoration:none;">${img}</a>` : img;
}

function renderDivider({ theme }: Ctx): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td height="1" style="height:1px;line-height:1px;font-size:1px;border-top:1px solid ${theme.primary};">&nbsp;</td></tr></table>`;
}

function renderDisclaimer(b: Extract<Block, { type: "disclaimer" }>, { theme }: Ctx): string {
  return `<div style="font-size:11px;line-height:15px;color:${theme.muted};max-width:500px;">${esc(b.text)}</div>`;
}

function renderText(b: Extract<Block, { type: "text" }>, { theme }: Ctx): string {
  if (!b.text) return "";
  const body = b.text.split(/\r?\n/).map(esc).join("<br />");
  return b.variant === "heading"
    ? `<div style="font-size:18px;font-weight:bold;line-height:24px;color:${theme.text};">${body}</div>`
    : `<div style="font-size:13px;line-height:20px;color:${theme.text};">${body}</div>`;
}

function renderButton(b: Extract<Block, { type: "button" }>, { theme }: Ctx): string {
  const s = b.style;
  const bg = s?.bg ?? s?.gradient?.from ?? theme.primary;
  const fg = s?.color ?? "#FFFFFF";
  const radius = s?.borderRadius ?? 6;
  const border = s?.borderWidth ? `border:${s.borderWidth}px solid ${s.borderColor ?? bg};` : "";
  const size = s?.fontSize ?? 13;
  return `<table ${TABLE_ATTRS}><tr><td bgcolor="${bg}" style="background-color:${bg};border-radius:${radius}px;${border}padding:8px 16px;"><a href="${esc(b.href)}" target="_blank" style="display:inline-block;color:${fg};font-size:${size}px;font-weight:bold;line-height:${size + 5}px;text-decoration:none;">${esc(b.label)}</a></td></tr></table>`;
}

function renderSpacer(b: Extract<Block, { type: "spacer" }>): string {
  return `<table ${TABLE_ATTRS}><tr><td height="${b.height}" style="height:${b.height}px;line-height:${b.height}px;font-size:1px;">&nbsp;</td></tr></table>`;
}

function renderBlockBase(b: Block, ctx: Ctx): string {
  switch (b.type) {
    case "avatar":
      return renderAvatar(b);
    case "identity":
      return renderIdentity(b, ctx);
    case "contact":
      return renderContact(b, ctx);
    case "social":
      return renderSocial(b, ctx);
    case "banner":
      return renderBanner(b);
    case "divider":
      return renderDivider(ctx);
    case "disclaimer":
      return renderDisclaimer(b, ctx);
    case "text":
      return renderText(b, ctx);
    case "button":
      return renderButton(b, ctx);
    case "spacer":
      return renderSpacer(b);
    case "row":
      // Children render through renderBlock, so every block (and nested row) works inside a column.
      return renderRow(b, (child) => renderBlock(child, ctx), GAP[ctx.theme.spacing]);
  }
}

/** Block HTML with the block's own design applied. Hidden blocks render nothing. */
export function renderBlock(b: Block, ctx: Ctx): string {
  return applyBlockStyle(b, renderBlockBase(b, ctx), ctx.theme);
}
