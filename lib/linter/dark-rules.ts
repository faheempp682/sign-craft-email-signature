import type { SignatureDoc } from "@/lib/schema/document";
import { bothModesSafe, checkDarkMode, DARK_SURFACES, solveBothModes, type Role } from "@/lib/dark";
import { luminance } from "./contrast";
import { WHITE } from "./surface";
import type { AssetMap, Issue } from "./index";

const ratio = (n: number) => `${n.toFixed(1)}:1`;

/**
 * Things that go wrong when a reader's email app is in dark mode. Honest scope: these are risks, not predictions.
 * Some apps invert colours, some recolour, some do nothing, so every message says "can" or "may".
 */
export function darkIssues(doc: SignatureDoc, assets: AssetMap = {}): Issue[] {
  const out: Issue[] = [];
  const add = (i: Omit<Issue, "category">) => out.push({ ...i, category: "dark" });
  const report = checkDarkMode(doc);

  for (const r of report.roles) {
    if (r.darkOk) continue;
    // Both modes are judged on the same surface for designed cards, so a failure there is the ordinary contrast rule's job.
    if (!report.plain) continue;
    const solved = solveBothModes(r.color, r.target, [WHITE], DARK_SURFACES);
    const nearBlack = luminance(r.color) < 0.03;
    const what = r.role === "text" ? "text colour" : r.role === "muted" ? "secondary text colour" : "accent colour";
    // Offer a fix only when it makes a real difference, so re-running it cannot keep nudging the colour.
    const canFix = solved.color !== r.color && (solved.status === "fixed" || solved.darkRatio - r.darkRatio > 0.05 || solved.lightRatio - r.lightRatio > 0.05);
    const exact = solved.status !== "best-effort";
    add({
      id: `dark-${r.role}`,
      severity: r.role === "text" ? "warning" : "info",
      optIn: true,
      message:
        `${nearBlack ? `The ${what} is almost black. ` : `The ${what} is dark. `}` +
        `On a dark email background that app does not recolour, it reads at only ${ratio(r.darkRatio)} (aim for ${r.target}:1). ` +
        (canFix
          ? exact
            ? "A slightly adjusted colour reads well in both light and dark."
            : `No single colour reaches ${r.target}:1 on both white and dark grey. The closest keeps light mode at ${ratio(solved.lightRatio)} and gives dark mode ${ratio(solved.darkRatio)}. A designed template with its own background avoids the problem.`
          : `No single colour can do better on both, so choose a designed template with its own background to be safe in dark mode.`),
      fixLabel: canFix ? `Use ${solved.color}${exact ? "" : " (closest possible)"}` : undefined,
      fix: canFix ? (d) => ({ ...d, theme: { ...d.theme, [r.role]: bothModesSafe(d).results.find((x) => x.role === (r.role as Role))!.to } }) : undefined,
    });
  }

  if (!report.plain && luminance(doc.theme.bg) > 0.8) {
    add({
      id: "dark-card-bright",
      severity: "info",
      message: "This design has a bright card. In dark mode some email apps leave it as a bright block on a dark page, and others invert its colours. Check it in a dark-mode app, or derive a dark variant for dark-mode readers.",
    });
  }

  /* ---- images: only metadata is known without pixels, so this is guidance, plus the upload's own measurement ---- */
  doc.blocks.forEach((b, i) => {
    if (b.type !== "avatar" && b.type !== "banner") return;
    const a = assets[b.src];
    if (a?.darkArtwork) return; // already reported as a warning by the upload findings ("dark-logo")
    if (a && (a.type === "image/jpeg" || a.hasTransparency === false)) return; // opaque: it keeps its own background
    const maybeTransparent = a ? a.type === "image/png" || a.type === "image/gif" : /\.png(\?|#|$)/i.test(b.src);
    if (maybeTransparent && !(a && a.hasTransparency === true && a.darkArtwork === false)) {
      add({
        id: `dark-png:${i}`,
        severity: "info",
        blockIndex: i,
        message: `If this ${b.type === "avatar" ? "logo" : "banner"} is a PNG with a transparent background and dark artwork, it can disappear on a dark background. We cannot see inside the image, so look at it in a dark-mode email app. Safer: a light outline, or a solid background colour.`,
      });
    }
  });

  return out;
}
