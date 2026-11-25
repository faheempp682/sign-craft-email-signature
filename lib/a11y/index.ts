/**
 * Accessibility rules for signatures, drawn from WCAG 2.2 where it applies to email. Each rule explains the problem
 * in plain language and offers a fix only when one is safe. Fixes change fields inside existing blocks or the theme,
 * never the block list (the editor keeps a parallel array of block ids). Contrast and alt-text presence rules live in
 * lib/linter/index.ts; this adds the rest. Rule-based checks, not an audit by a person using a screen reader.
 */
import type { Block, SignatureDoc } from "@/lib/schema/document";
import type { AssetMap, Issue } from "@/lib/linter";
import { adjustToContrast, contrast } from "@/lib/linter/contrast";
import { lightSurface } from "@/lib/linter/surface";
import { safeHttpsUrl, telHref } from "@/lib/renderer/shared";

const withBlock = (doc: SignatureDoc, i: number, patch: Record<string, unknown>): SignatureDoc => ({
  ...doc,
  blocks: doc.blocks.map((b, j) => (j === i ? ({ ...b, ...patch } as Block) : b)),
});

/** Minimum sizes. WCAG 2.5.8 sets 24 px as the smallest comfortable touch target; email has no hard rule for photos. */
export const MIN = { avatarError: 32, avatarComfort: 48, bannerWidth: 200, bannerHeight: 40 } as const;

const GENERIC_ALT = /^(image|img|photo|picture|pic|logo|banner|avatar|graphic|icon|link|click here|click|here|untitled|image\d*|img\d*)$/i;
const FILENAME_ALT = /(\.(png|jpe?g|gif|webp|svg)$)|^(img|image|dsc|screenshot|untitled)[-_ ]?\d+/i;
const REDUNDANT_ALT = /^(an? )?(image|picture|photo|graphic|screenshot|logo) of\s+/i;
const VAGUE_LINK_TEXT = /^(click here|here|link|read more|more|this)$/i;

/** What to put in an alt that is missing or useless: the same words the basic alt-text rule uses. */
function altFallback(b: Extract<Block, { type: "avatar" | "banner" }>, doc: SignatureDoc): string {
  const identity = doc.blocks.find((x): x is Extract<Block, { type: "identity" }> => x.type === "identity");
  return b.type === "avatar" ? (identity?.name ?? "Profile photo") : `${identity?.company ?? identity?.name ?? "Company"} banner`;
}

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export function accessibilityIssues(doc: SignatureDoc, assets: AssetMap = {}): Issue[] {
  const out: Issue[] = [];
  const add = (i: Omit<Issue, "category">) => out.push({ ...i, category: "accessibility" });
  const { blocks, theme } = doc;

  blocks.forEach((b, i) => {
    /* ---- images ---- */
    if (b.type === "avatar" || b.type === "banner") {
      const label = b.type === "avatar" ? "photo / logo" : "banner";
      const alt = (b.alt ?? "").trim();
      const animated = !!assets[b.src]?.animated;

      if (alt) {
        const fallback = altFallback(b, doc);
        if (GENERIC_ALT.test(alt) || FILENAME_ALT.test(alt) || /^https?:\/\//i.test(alt)) {
          add({
            id: `alt-generic:${i}`,
            severity: "warning",
            blockIndex: i,
            message: `The ${label} alt text "${alt}" says nothing useful. A screen reader will read it out and the person learns nothing. Describe what the image shows or what it links to.`,
            fixLabel: `Use "${fallback}"`,
            fix: (d) => withBlock(d, i, { alt: fallback }),
          });
        } else if (REDUNDANT_ALT.test(alt)) {
          const cleaned = alt.replace(REDUNDANT_ALT, "").replace(/^./, (c) => c.toUpperCase());
          add({
            id: `alt-wording:${i}`,
            severity: "info",
            blockIndex: i,
            message: `Screen readers already announce "image", so starting the ${label} alt text with "${alt.match(REDUNDANT_ALT)![0].trim()}" repeats it.`,
            fixLabel: `Use "${cleaned}"`,
            fix: (d) => withBlock(d, i, { alt: cleaned }),
          });
        } else if (alt.length > 125) {
          add({ id: `alt-long:${i}`, severity: "info", blockIndex: i, message: `The ${label} alt text is ${alt.length} characters. Many screen readers cut off or tire people at about 125. Keep the essential message first and shorten the rest.` });
        } else if (animated && alt.length < 8) {
          add({ id: `alt-animated:${i}`, severity: "info", blockIndex: i, message: `This ${label} is animated. Its alt text should describe the whole message, including any words that appear in later frames.` });
        }
      }

      if (b.type === "avatar") {
        const size = Number(b.size);
        if (!Number.isFinite(size) || size <= 0) {
          add({ id: `image-dimensions:${i}`, severity: "error", blockIndex: i, message: "The photo / logo has no valid size. Without an explicit width and height, email apps that block images show a collapsed gap and the layout jumps.", fixLabel: "Set the size to 80", fix: (d) => withBlock(d, i, { size: 80 }) });
        } else if (size < MIN.avatarError) {
          add({ id: `avatar-small:${i}`, severity: "warning", blockIndex: i, message: `The photo / logo is shown at ${size} px. Under ${MIN.avatarError} px a face or logo cannot be recognised.`, fixLabel: `Show at ${MIN.avatarError} px`, fix: (d) => withBlock(d, i, { size: MIN.avatarError }) });
        } else if (size < MIN.avatarComfort) {
          add({ id: `avatar-small:${i}`, severity: "info", blockIndex: i, message: `The photo / logo is shown at ${size} px. That is small: ${MIN.avatarComfort} px or more is easier to recognise, especially for low vision.`, fixLabel: `Show at ${MIN.avatarComfort} px`, fix: (d) => withBlock(d, i, { size: MIN.avatarComfort }) });
        }
      } else {
        const w = Number(b.width);
        const h = Number(b.height);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
          add({ id: `image-dimensions:${i}`, severity: "error", blockIndex: i, message: "The banner has no valid width and height. Without them, email apps that block images collapse the space and the layout jumps.", fixLabel: "Set 400×100", fix: (d) => withBlock(d, i, { width: 400, height: 100 }) });
        } else if (w < MIN.bannerWidth || h < MIN.bannerHeight) {
          add({ id: `banner-small:${i}`, severity: "warning", blockIndex: i, message: `The banner is shown at ${w}×${h}. Anything with words in it that small becomes unreadable on a phone. Make it at least ${MIN.bannerWidth}×${MIN.bannerHeight}, or use real text instead.` });
        }
      }

      const natural = assets[b.src];
      if (natural && natural.width > 0) {
        const shown = b.type === "avatar" ? Number(b.size) : Number(b.width);
        if (shown > 0 && natural.width < shown) {
          add({ id: `image-low-res:${i}`, severity: "info", blockIndex: i, message: `The ${label} image is ${natural.width} px wide but shown at ${shown} px, so it is stretched and looks soft. Upload a larger image (about twice the display size looks sharp on phones).` });
        }
      }
    }

    /* ---- links ---- */
    if (b.type === "banner" && b.href) {
      if (!/^https:\/\//i.test(b.href)) {
        const safe = safeHttpsUrl(b.href);
        add({
          id: `link-insecure:${i}`,
          severity: "error",
          blockIndex: i,
          message: "The banner link is not a secure https:// address. Many email apps block or warn about it.",
          fixLabel: safe ? `Use ${safe}` : "Remove the link",
          fix: (d) => withBlock(d, i, { href: safe ?? undefined }),
        });
      }
      const alt = (b.alt ?? "").trim();
      if (VAGUE_LINK_TEXT.test(alt)) {
        add({ id: `link-text:${i}`, severity: "warning", blockIndex: i, message: `The banner is a link whose alt text is "${alt}". Links should say where they go, because people using screen readers often hear links listed on their own.` });
      }
    }

    if (b.type === "social") {
      const bad = b.links.filter((l) => !/^https:\/\//i.test(l.url));
      if (bad.length) {
        add({
          id: `link-insecure:${i}`,
          severity: "error",
          blockIndex: i,
          message: `${bad.length === 1 ? "A social link is" : `${bad.length} social links are`} not a secure https:// address, so ${bad.length === 1 ? "it" : "they"} may be blocked or open the wrong place.`,
          fixLabel: "Fix addresses (remove any that cannot be fixed)",
          fix: (d) => {
            const cur = d.blocks[i] as Extract<Block, { type: "social" }>;
            const links = cur.links.flatMap((l) => {
              if (/^https:\/\//i.test(l.url)) return [l];
              const safe = safeHttpsUrl(l.url);
              return safe ? [{ ...l, url: safe }] : [];
            });
            return withBlock(d, i, { links });
          },
        });
      }
      if (b.links.length >= 3) {
        add({ id: `touch-spacing:${i}`, severity: "info", blockIndex: i, message: `${b.links.length} social links sit close together as small text. On a phone it is easy to tap the wrong one (WCAG 2.5.8 wants about 24 px of room). Keep only the networks that matter most.` });
      }
    }

    if (b.type === "contact") {
      if (b.phone && !telHref(b.phone)) {
        add({ id: `link-phone:${i}`, severity: "info", blockIndex: i, message: "The phone number is too short to become a tap-to-call link, so it shows as plain text. Include the full number with area code." });
      }
      if (b.email && !looksLikeEmail(b.email)) {
        add({ id: `link-email:${i}`, severity: "warning", blockIndex: i, message: "The email address does not look valid, so the mailto link will not work." });
      }
      if (b.website) {
        const safe = safeHttpsUrl(b.website);
        if (!safe) {
          add({ id: `link-website:${i}`, severity: "warning", blockIndex: i, message: "The website is not a valid web address, so it will not be a working link." });
        } else if (b.website.length > 60) {
          add({ id: `link-long:${i}`, severity: "info", blockIndex: i, message: "The website address shown is very long. Screen readers read links out character by character, and it wraps badly on phones. Use a short address." });
        }
      }
    }

    /* ---- text ---- */
    if (b.type === "disclaimer") {
      if (b.text.length > 300) {
        add({ id: `text-small:${i}`, severity: "info", blockIndex: i, message: "The disclaimer is set in small type (11 px). That is fine for a short note, but long text this small is hard for people with low vision. Shorten it." });
      }
      const letters = b.text.replace(/[^A-Za-z]/g, "");
      if (letters.length > 40 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.9) {
        add({ id: `text-caps:${i}`, severity: "info", blockIndex: i, message: "The disclaimer is in capital letters. Blocks of capitals are slower to read for everyone and some screen readers spell them out. Use normal sentence case." });
      }
    }
  });

  /* ---- colour as the only signal, and link colour ---- */
  const hasLinkText = blocks.some((b) => (b.type === "contact" && !!b.website) || (b.type === "social" && b.links.length > 0));
  // Social links are bold, so they have a second cue. The website link in the contact block is plain text in the accent colour.
  const hasPlainLink = blocks.some((b) => b.type === "contact" && !!b.website);
  if (hasLinkText) {
    const surface = lightSurface(doc);
    const onSurface = contrast(theme.primary, surface);
    if (onSurface >= 3 && onSurface < 4.5) {
      const primary = adjustToContrast(theme.primary.toUpperCase(), surface, 4.5);
      add({
        id: "contrast-link",
        severity: "warning",
        message: `Links use the accent colour, which is ${onSurface.toFixed(1)}:1 against the background. Small link text needs 4.5:1 to be readable.`,
        fixLabel: `Use ${primary}`,
        fix: (d) => ({ ...d, theme: { ...d.theme, primary } }),
      });
    }
    if (hasPlainLink && contrast(theme.primary, theme.text) < 3) {
      add({ id: "link-colour-only", severity: "info", message: "Links are told apart from the surrounding text only by colour, and the link colour is too close to the text colour. People who cannot see colour differences will not find the links. Pick an accent that contrasts with the text colour, or a bolder one (WCAG 1.4.1)." });
    }
  }

  return out;
}
