/**
 * Dark-mode helpers. Honest scope: email clients differ. Apple Mail mostly honours the colours you set, Gmail and
 * Outlook apps may invert or recolour them in ways no sender controls, and some do nothing. These functions check
 * and adjust the colours WE control against typical light and dark backgrounds. They do not replace testing in the
 * real apps. See docs/accessibility-and-dark-mode.md.
 */
import type { SignatureDoc, Theme } from "@/lib/schema/document";
import { adjustToContrast, contrast, luminance, mixHex } from "@/lib/linter/contrast";
import { isPlainTemplate, lightSurface, WHITE } from "@/lib/linter/surface";
import { renderToEmailHtml } from "@/lib/renderer/email-html";

/** Typical dark email backgrounds: true-ish black (Apple Mail, Outlook) and Gmail's dark grey. The worst of them counts. */
export const DARK_SURFACES = ["#121212", "#202124"] as const;

export type Role = "text" | "muted" | "primary";
export const ROLES: { role: Role; label: string; target: number }[] = [
  { role: "text", label: "Main text", target: 4.5 },
  { role: "muted", label: "Secondary text", target: 4.5 },
  // The accent is mostly decoration and bold links, which WCAG holds to 3:1.
  { role: "primary", label: "Accent / links", target: 3 },
];

export type RoleCheck = {
  role: Role;
  label: string;
  color: string;
  target: number;
  /** Worst contrast on the light surface and on the dark surfaces. For card templates both are the card colour. */
  lightRatio: number;
  darkRatio: number;
  lightOk: boolean;
  darkOk: boolean;
};

export type DarkReport = {
  /** Plain templates sit on the reader's own background, so dark mode changes what they sit on. Cards bring their own. */
  plain: boolean;
  lightSurface: string;
  darkSurfaces: string[];
  roles: RoleCheck[];
  ok: boolean;
};

const worst = (fg: string, surfaces: readonly string[]) => Math.min(...surfaces.map((s) => contrast(fg, s)));
const norm = (c: string) => c.toUpperCase();

/** Checks the theme colours against a light and a dark background and reports which fail. */
export function checkDarkMode(doc: Pick<SignatureDoc, "template_id" | "theme">): DarkReport {
  const plain = isPlainTemplate(doc);
  const light = lightSurface(doc);
  // A designed card paints its own background, so its colours meet the same surface in both modes.
  const darks: string[] = plain ? [...DARK_SURFACES] : [light];
  const roles = ROLES.map(({ role, label, target }) => {
    const color = norm(doc.theme[role]);
    const lightRatio = worst(color, [light]);
    const darkRatio = worst(color, darks);
    return { role, label, color, target, lightRatio, darkRatio, lightOk: lightRatio >= target, darkOk: darkRatio >= target };
  });
  return { plain, lightSurface: light, darkSurfaces: darks, roles, ok: roles.every((r) => r.lightOk && r.darkOk) };
}

export type SolveResult = {
  color: string;
  lightRatio: number;
  darkRatio: number;
  /** "ok": passes both. "fixed": changed and now passes both. "best-effort": no single colour passes both, this is the closest. */
  status: "ok" | "fixed" | "best-effort";
};

/**
 * The colour nearest to `color` (same hue, only lighter or darker) that meets `target` on the light surface AND on
 * every dark surface. When no colour can (for text this is the normal case on a #121212 or grey page: the best any
 * single colour does is about 4.3:1 on both), it keeps the light-mode ratio at the target, because light mode is
 * what most readers see, and gives dark mode as much contrast as that allows.
 */
export function solveBothModes(color: string, target: number, light: readonly string[], darks: readonly string[]): SolveResult {
  const c = norm(color);
  const rl = worst(c, light);
  const rd = worst(c, darks);
  if (rl >= target && rd >= target) return { color: c, lightRatio: rl, darkRatio: rd, status: "ok" };

  type Cand = { color: string; l: number; d: number; dist: number };
  const cands: Cand[] = [];
  for (const end of ["#000000", "#FFFFFF"]) {
    // Fine steps: for text the window where one colour passes both light and pure-black dark is under 1% of luminance wide.
    for (let i = 0; i <= 250; i++) {
      const t = i / 250;
      const col = mixHex(c, end, t);
      cands.push({ color: col, l: worst(col, light), d: worst(col, darks), dist: t });
    }
  }
  const both = cands.filter((x) => x.l >= target && x.d >= target).sort((a, b) => a.dist - b.dist)[0];
  if (both) return { color: both.color, lightRatio: both.l, darkRatio: both.d, status: "fixed" };

  const lightOk = cands.filter((x) => x.l >= target);
  const pool = lightOk.length ? lightOk : cands;
  const best = pool.sort((a, b) => b.d - a.d || a.dist - b.dist)[0];
  return { color: best.color, lightRatio: best.l, darkRatio: best.d, status: "best-effort" };
}

export type BothModesResult = {
  role: Role;
  label: string;
  from: string;
  to: string;
  lightRatio: number;
  darkRatio: number;
  target: number;
  status: SolveResult["status"] | "skipped";
};

/**
 * Adjusts theme colours so they pass on light and dark where mathematically possible, and reports honestly where not.
 * Never touches blocks. Designed (card) templates are left alone: they paint their own background, so the
 * colours are already judged against it by the normal contrast rules.
 */
export function bothModesSafe(doc: SignatureDoc): { doc: SignatureDoc; results: BothModesResult[]; allPass: boolean } {
  const plain = isPlainTemplate(doc);
  const theme: Theme = { ...doc.theme };
  const results: BothModesResult[] = ROLES.map(({ role, label, target }) => {
    const from = norm(doc.theme[role]);
    if (!plain) {
      const r = worst(from, [lightSurface(doc)]);
      return { role, label, from, to: from, lightRatio: r, darkRatio: r, target, status: "skipped" as const };
    }
    const s = solveBothModes(from, target, [WHITE], DARK_SURFACES);
    theme[role] = s.color;
    return { role, label, from, to: s.color, lightRatio: s.lightRatio, darkRatio: s.darkRatio, target, status: s.status };
  });
  return { doc: { ...doc, theme }, results, allPass: results.every((r) => r.status !== "best-effort") };
}

export type DarkChange = { field: "theme.text" | "theme.muted" | "theme.primary" | "theme.bg" | "theme.accent2"; from: string; to: string; reason: string };

/** A dark-friendly background derived from a light card colour: same hue, about 12% of the brightness. */
export const deriveDarkBg = (bg: string) => mixHex(norm(bg), "#000000", 0.88);

/**
 * A derived document whose colours read on a dark background, plus what changed and why. The original is untouched.
 * Plain templates sit on the reader's dark page, so only the text colours lighten. Card templates also get a dark
 * card. Block content, order and images are never altered.
 */
export function darkVariant(doc: SignatureDoc): { doc: SignatureDoc; changes: DarkChange[]; surface: string } {
  const plain = isPlainTemplate(doc);
  const theme: Theme = { ...doc.theme };
  const changes: DarkChange[] = [];
  let surfaces: string[];

  if (plain) {
    surfaces = [...DARK_SURFACES];
  } else {
    const bg = norm(doc.theme.bg);
    if (luminance(bg) > 0.4) {
      theme.bg = deriveDarkBg(bg);
      changes.push({ field: "theme.bg", from: bg, to: theme.bg, reason: "The card background was light. It is darkened, keeping its tint, so the card does not glare on a dark screen." });
    }
    surfaces = [norm(theme.bg)];
  }

  const lighten = (field: "theme.text" | "theme.muted" | "theme.primary" | "theme.accent2", key: "text" | "muted" | "primary" | "accent2", target: number, why: string) => {
    const from = norm(doc.theme[key]);
    const to = surfaces.reduce((col, s) => adjustToContrast(col, s, target), from);
    if (to !== from) {
      theme[key] = to;
      changes.push({ field, from, to, reason: `${why} (now at least ${target}:1 on ${plain ? "dark backgrounds" : "the dark card"}).` });
    }
  };
  lighten("theme.text", "text", 4.5, "Main text was too dark to read on a dark background");
  lighten("theme.muted", "muted", 4.5, "Secondary text was too dim on a dark background");
  lighten("theme.primary", "primary", 3, "The accent colour was too dim on a dark background");
  if (!plain) lighten("theme.accent2", "accent2", 3, "The second accent colour was too dim on the dark card");

  return { doc: { ...doc, theme }, changes, surface: surfaces[surfaces.length - 1] };
}

/**
 * HTML for the dark variant, ready for another part of the app to offer as a download or preview.
 * `previewBackground` wraps it in a dark block so it can be viewed on its own; leave it off for the HTML you give out,
 * because the reader's own page provides the background. Validate `doc` with SignatureDocSchema first.
 */
export function darkVariantHtml(doc: SignatureDoc, opts: { previewBackground?: boolean } = {}): { html: string; changes: DarkChange[]; doc: SignatureDoc } {
  const v = darkVariant(doc);
  const inner = renderToEmailHtml(v.doc);
  const html = opts.previewBackground
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td bgcolor="${DARK_SURFACES[0]}" style="background-color:${DARK_SURFACES[0]};padding:16px;">${inner}</td></tr></table>`
    : inner;
  return { html, changes: v.changes, doc: v.doc };
}
