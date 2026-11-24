import type { Block, Theme } from "@/lib/schema/document";

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

// Text links for now: icon PNGs need hosted URLs, which arrive with the image-upload step.
function renderSocial(b: Extract<Block, { type: "social" }>, { theme }: Ctx): string {
  const items = b.links.map((l) => link(l.url, NETWORK_LABEL[l.network] ?? l.network, theme, "font-weight:bold;"));
  if (!items.length) return "";
  return `<div style="font-size:12px;line-height:18px;">${items.join(` <span style="color:${theme.muted};">|</span> `)}</div>`;
}

export function renderBanner(b: Extract<Block, { type: "banner" }>): string {
  const img = `<img src="${esc(b.src)}" width="${b.width}" height="${b.height}" alt="${esc(b.alt)}" style="display:block;border:0;width:${b.width}px;height:${b.height}px;" />`;
  return b.href ? `<a href="${esc(b.href)}" target="_blank" style="text-decoration:none;">${img}</a>` : img;
}

function renderDivider({ theme }: Ctx): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td height="1" style="height:1px;line-height:1px;font-size:1px;border-top:1px solid ${theme.primary};">&nbsp;</td></tr></table>`;
}

function renderDisclaimer(b: Extract<Block, { type: "disclaimer" }>, { theme }: Ctx): string {
  return `<div style="font-size:11px;line-height:15px;color:${theme.muted};max-width:500px;">${esc(b.text)}</div>`;
}

export function renderBlock(b: Block, ctx: Ctx): string {
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
  }
}
