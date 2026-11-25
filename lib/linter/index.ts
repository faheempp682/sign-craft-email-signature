import type { Block, SignatureDoc } from "@/lib/schema/document";
import { adjustToContrast, contrast } from "./contrast";
import { aspectMismatch, assetWarnings, type AssetInfo } from "@/lib/storage/rules";

/** Facts about uploaded images, keyed by their public URL. Kept outside the document so the JSON model never changes. */
export type AssetMap = Record<string, AssetInfo>;

export type Severity = "error" | "warning" | "info";

export type Issue = {
  /** Stable rule id plus the block it applies to, e.g. "avatar-alt:2". */
  id: string;
  severity: Severity;
  message: string;
  blockIndex?: number;
  fixLabel?: string;
  /**
   * Returns a corrected document. Invariant: a fix never adds, removes or reorders blocks, because the editor keeps
   * a parallel array of block ids. Fixes only change fields inside existing blocks or the theme.
   */
  fix?: (doc: SignatureDoc) => SignatureDoc;
};

const PLACEHOLDER_HOSTS = ["placehold.co", "placeholder.com", "via.placeholder.com", "dummyimage.com", "picsum.photos", "example.com", "example.org"];
const BAD_IMAGE_EXT = /\.(svg|webp|avif|bmp|tiff?|ico|heic)(\?|#|$)/i;
const WHITE = "#FFFFFF";
/** Templates that ignore theme.bg (see ThemeSchema); everything else draws a card in that colour. */
const PLAIN_TEMPLATES = new Set<string>(["classic", "modern-split", "minimal"]);

const withBlock = (doc: SignatureDoc, i: number, patch: Record<string, unknown>): SignatureDoc => ({
  ...doc,
  blocks: doc.blocks.map((b, j) => (j === i ? ({ ...b, ...patch } as Block) : b)),
});

function host(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** A social link that is only the site's profile prefix, e.g. https://linkedin.com/in/ , is the editor's starter value, not a real profile. */
export function isBareProfile(url: string): boolean {
  try {
    const p = new URL(url).pathname.replace(/\/+$/, "");
    return p === "" || /^\/(in|company|user|channel|c|@)$/i.test(p);
  } catch {
    return false;
  }
}

export function lintDoc(doc: SignatureDoc, assets: AssetMap = {}): Issue[] {
  const issues: Issue[] = [];
  const add = (i: Issue) => issues.push(i);
  const { blocks, theme } = doc;

  const identityIdx = blocks.findIndex((b) => b.type === "identity");
  const identity = identityIdx >= 0 ? (blocks[identityIdx] as Extract<Block, { type: "identity" }>) : null;

  if (!identity) add({ id: "no-identity", severity: "error", message: "There is no Name & title block, so the signature does not say who it is from." });

  /* ---- placeholder content ---- */
  if (identity && (/^your name$/i.test(identity.name.trim()) || /^your title$/i.test((identity.title ?? "").trim()))) {
    add({ id: "placeholder-text", severity: "warning", blockIndex: identityIdx, message: "The name or title still has the starter text. Replace it with the real details." });
  }

  /* ---- images ---- */
  let imageCount = 0;
  blocks.forEach((b, i) => {
    if (b.type !== "avatar" && b.type !== "banner") return;
    imageCount++;
    const label = b.type === "avatar" ? "photo / logo" : "banner";
    const h = host(b.src);
    if (PLACEHOLDER_HOSTS.some((p) => h === p || h.endsWith(`.${p}`))) {
      add({ id: `placeholder-image:${i}`, severity: "error", blockIndex: i, message: `The ${label} is a placeholder image. Upload or paste your real image.` });
    }
    if (BAD_IMAGE_EXT.test(b.src)) {
      add({ id: `image-format:${i}`, severity: "error", blockIndex: i, message: `The ${label} uses a format that many email clients will not show. Use PNG, JPG or GIF.` });
    }
    if (!b.alt?.trim()) { // raw editor docs may omit alt (the schema default is applied only on parse)
      const fallback = b.type === "avatar" ? (identity?.name ?? "Profile photo") : `${identity?.company ?? identity?.name ?? "Company"} banner`;
      add({
        id: `alt-text:${i}`,
        severity: "warning",
        blockIndex: i,
        message: `The ${label} has no alt text. People with images blocked, and screen readers, get nothing.`,
        fixLabel: `Use "${fallback}"`,
        fix: (d) => withBlock(d, i, { alt: fallback }),
      });
    }
    if (b.type === "banner" && !b.href) {
      add({ id: `banner-link:${i}`, severity: "info", blockIndex: i, message: "The banner is not clickable. Add a link if it promotes something." });
    }

    /* Upload findings (size, animated GIF weight, tiny images) and shape checks, from what the upload recorded. */
    const asset = assets[b.src];
    if (asset) {
      for (const w of assetWarnings(asset)) add({ id: `asset-${w.code}:${i}`, severity: w.severity, blockIndex: i, message: `The ${label}: ${w.message}` });

      if (b.type === "banner" && aspectMismatch(asset.width, asset.height, b.width, b.height)) {
        const ratio = asset.width / asset.height;
        let w = b.width;
        let h = Math.round(w / ratio);
        if (h > 300) {
          h = 300;
          w = Math.max(100, Math.round(h * ratio));
        } else if (h < 20) {
          h = 20;
        }
        add({
          id: `asset-stretched:${i}`,
          severity: "warning",
          blockIndex: i,
          message: `The banner is shown at ${b.width}×${b.height} but the image is ${asset.width}×${asset.height}, so it will look stretched.`,
          fixLabel: `Show at ${w}×${h}`,
          fix: (d) => withBlock(d, i, { width: w, height: h }),
        });
      }
      if (b.type === "avatar" && aspectMismatch(asset.width, asset.height, 1, 1)) {
        add({ id: `asset-not-square:${i}`, severity: "warning", blockIndex: i, message: `The photo / logo is ${asset.width}×${asset.height}, not square, but it is shown in a square frame, so it will look squashed. Crop it to a square first.` });
      }
    }
  });
  if (imageCount > 4) add({ id: "many-images", severity: "warning", message: `${imageCount} images is a lot. Email clients often block images, and each one slows the message.` });

  /* ---- social links ---- */
  blocks.forEach((b, i) => {
    if (b.type !== "social") return;
    const bare = b.links.filter((l) => isBareProfile(l.url));
    if (bare.length) {
      add({
        id: `social-placeholder:${i}`,
        severity: "warning",
        blockIndex: i,
        message: `${bare.length === 1 ? "A social link points" : `${bare.length} social links point`} to a site's home page, not a profile.`,
        fixLabel: "Remove those links",
        fix: (d) => withBlock(d, i, { links: (d.blocks[i] as Extract<Block, { type: "social" }>).links.filter((l) => !isBareProfile(l.url)) }),
      });
    }
    const seen = new Set<string>();
    const dupes = b.links.filter((l) => (seen.has(l.network) ? true : (seen.add(l.network), false)));
    if (dupes.length) {
      add({
        id: `social-duplicate:${i}`,
        severity: "warning",
        blockIndex: i,
        message: "The same social network is listed more than once.",
        fixLabel: "Keep the first of each",
        fix: (d) => {
          const s = new Set<string>();
          return withBlock(d, i, { links: (d.blocks[i] as Extract<Block, { type: "social" }>).links.filter((l) => (s.has(l.network) ? false : (s.add(l.network), true))) });
        },
      });
    }
    if (b.links.length === 0) add({ id: `social-empty:${i}`, severity: "info", blockIndex: i, message: "The social block has no links, so nothing shows. Add a link or remove the block." });
  });

  /* ---- contact details ---- */
  const contacts = blocks.flatMap((b, i) => (b.type === "contact" ? [{ b, i }] : []));
  for (const { b, i } of contacts) {
    if (!b.phone && !b.email && !b.website && !b.address) add({ id: `contact-empty:${i}`, severity: "warning", blockIndex: i, message: "The contact block is empty. Fill it in or remove the block." });
  }
  if (contacts.length === 0 || contacts.every(({ b }) => !b.phone && !b.email && !b.website)) {
    add({ id: "no-contact", severity: "info", message: "No phone, email or website. Recipients have no easy way to reach you." });
  }

  /* ---- disclaimer ---- */
  blocks.forEach((b, i) => {
    if (b.type === "disclaimer" && b.text.length > 600) add({ id: `disclaimer-long:${i}`, severity: "info", blockIndex: i, message: "The disclaimer is long. Many clients will make the whole signature tall and slow to read." });
  });

  /* ---- colour contrast (WCAG AA, 4.5:1 for normal text) ---- */
  // Only the designed templates paint theme.bg as a card. The plain ones sit on the mail client's (white) page.
  const surfaces = [PLAIN_TEMPLATES.has(doc.template_id) ? WHITE : theme.bg.toUpperCase()];
  const worst = (fg: string) => Math.min(...surfaces.map((s) => contrast(fg, s)));
  if (worst(theme.text) < 4.5) {
    const text = surfaces.reduce((c, s) => adjustToContrast(c, s), theme.text.toUpperCase());
    add({
      id: "contrast-text",
      severity: worst(theme.text) < 3 ? "error" : "warning",
      message: `The text colour is hard to read (contrast ${worst(theme.text).toFixed(1)}:1, aim for 4.5:1 or more).`,
      fixLabel: `Use ${text}`,
      fix: (d) => ({ ...d, theme: { ...d.theme, text } }),
    });
  }
  if (worst(theme.muted) < 4.5) {
    const muted = surfaces.reduce((c, s) => adjustToContrast(c, s), theme.muted.toUpperCase());
    add({
      id: "contrast-muted",
      severity: "warning",
      message: `The secondary text colour is faint (contrast ${worst(theme.muted).toFixed(1)}:1, aim for 4.5:1 or more).`,
      fixLabel: `Use ${muted}`,
      fix: (d) => ({ ...d, theme: { ...d.theme, muted } }),
    });
  }
  if (worst(theme.primary) < 3) {
    const primary = surfaces.reduce((c, s) => adjustToContrast(c, s, 3), theme.primary.toUpperCase());
    add({
      id: "contrast-accent",
      severity: "info", // often a decorative fill, so a note rather than a warning
      message: `The accent colour is faint against the background (contrast ${worst(theme.primary).toFixed(1)}:1). Fine for decoration, but avoid it for text and links.`,
      fixLabel: `Use ${primary}`,
      fix: (d) => ({ ...d, theme: { ...d.theme, primary } }),
    });
  }

  return issues;
}

const PENALTY: Record<Severity, number> = { error: 20, warning: 8, info: 2 };

/** 0 to 100. A clean document is 100; each error costs 20, warning 8, info 2. */
export function scoreOf(issues: Issue[]): number {
  return Math.max(0, 100 - issues.reduce((sum, i) => sum + PENALTY[i.severity], 0));
}

/** Applies every available fix, re-linting between fixes so later ones see the earlier results. */
export function applyAllFixes(doc: SignatureDoc, assets: AssetMap = {}): SignatureDoc {
  let current = doc;
  for (let n = 0; n < 25; n++) {
    const next = lintDoc(current, assets).find((i) => i.fix);
    if (!next) break;
    current = next.fix!(current);
  }
  return current;
}
