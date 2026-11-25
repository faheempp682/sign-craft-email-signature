# Accessibility, animated GIF and dark-mode checks

Rule-based checks. They catch common problems early; they do not replace testing in real email apps or with a real screen reader.

## Issue categories and scores

Every issue from `lintDoc` (lib/linter) has a `category`: `compat`, `accessibility`, `dark` or `gif`. `scoresOf(issues)` returns `overall`, `compat` (compat + gif), `accessibility` and `dark`, each 100 minus 20 per error, 8 per warning, 2 per tip. `scoreOf` is unchanged (all categories). Issues marked `optIn` are excluded from `applyAllFixes` / "Fix all"; each has its own button. Fixes never add, remove or reorder blocks.

## Accessibility rules (lib/a11y, plus alt text and contrast in lib/linter)

Alt text missing (error when the banner is a link), generic or filename alt, "image of" wording, over 125 characters, thin alt on an animated GIF; avatar under 32 px (fix) or 48 px (tip), banner too small to read, missing width/height (fix); image shown larger than its real size; non-https links (fix), vague link text, invalid email/website, short phone, very long website text, crowded social links (WCAG 2.5.8); small or all-caps disclaimer; link colour under 4.5:1 (fix), link colour too close to text colour (WCAG 1.4.1); text, secondary text and accent contrast.

Not controllable from the document, so only reported: font sizes are fixed by the renderer (name 18, details 13, social 12, disclaimer 11 px).

## Animated GIF facts and rules

On upload, lib/storage/facts.ts measures the stored file and /api/upload returns extra, additive fields: `frames`, `durationMs` (browser delay clamping applied), `minDelayMs`, `loopCount`, `firstFrame` (`complete` | `sparse` | `blank`), `firstFrameCoverage`, `peakCoverage`, `flashesPerSecond`, `hasTransparency`, `darkArtwork`. They are advice: a failure to measure leaves them out and never fails an upload.

- First frame: each frame is reduced to 32x32; "content" is opaque pixels that differ from the frame's dominant colour. Frame 1 is blank when it has almost no content (or is over 90% transparent) while some frame has some, and sparse when it has under 35% of the fullest frame's content. Outlook on Windows shows only frame 1.
- Flashing (WCAG 2.3.1): whole-frame brightness changes of 10% or more, counted in any one second, including the loop seam. More than 3 is an error. Whole-frame brightness can miss a small flashing area, so this is a screen, not a certification. Without measurements, frames under 160 ms draw a warning.
- Size budget by purpose (from the block type): animated avatar over 100 KB warns; banner 300 KB warns, 1 MB errors. More than 40 frames warns. An endless loop longer than 5 s warns (WCAG 2.2.2); a shorter one is a tip.

The facts live only in the upload response. The `assets` table has no columns for them, so reloading a saved signature loses them until an integration adds storage (see the report).

## Dark mode (lib/dark)

- `checkDarkMode(doc)`: text, secondary text and accent against white and against dark surfaces #121212 and #202124 (worst counts). Designed card templates paint their own background, so both modes use the card.
- `bothModesSafe(doc)` / `solveBothModes`: moves each colour along its own hue toward black or white to the nearest value passing both. Honest limit: no single colour reaches 4.5:1 on white and on #121212 or #202124 (the best grey gets about 4.3:1 on #121212). Then light mode is protected first (4.5:1) and dark mode gets the most that leaves, and the message says so. A designed template with its own background avoids the problem. The accent targets 3:1.
- `darkVariant(doc)`: a derived document with a list of changes and reasons. Plain templates get lighter text colours; card templates also get a darkened card. `darkVariantHtml(doc, { previewBackground })` returns `{ html, changes, doc }` for other code to offer as a download. Leave `previewBackground` off for HTML you give out.
- Lint: near-black or dark text on a plain template, bright card guidance, PNG logo guidance (generic unless the upload showed the image is opaque or has light artwork), and a warning when the upload found dark artwork on a transparent background.

## What this cannot know

Real clients differ. Apple Mail mostly keeps your colours; Gmail and Outlook apps may invert or recolour; some do nothing. Images are not recoloured by any of this. A signature pasted into Gmail can lose a `<style>` block, so a single HTML file that adapts with `prefers-color-scheme` is not offered. Always send a test to light and dark versions of the apps your recipients use.
