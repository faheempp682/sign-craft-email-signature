# Image crop and animated GIF maker

Two editor features: a crop dialog that opens before a photo, logo or banner is uploaded, and a maker that builds an animated banner GIF from 2 to 6 still frames.

## 1. Crop before upload

**Flow.** In the editor, an image field on an Avatar ("Photo / logo") or Banner block has an "Upload image" button. Picking a PNG or JPEG opens `components/image-cropper.tsx`. Confirming produces a cropped file that goes through the existing `uploadImage()` and `/api/upload` unchanged (the server still validates, strips metadata and optimizes). Nothing is uploaded until the person confirms.

- GIF files skip the cropper (they may be animated and a canvas would keep one frame). Cancel closes the dialog without uploading.
- "Use the whole image" uploads the original file unchanged.
- "Re-crop last image" appears under the field while the picked file is still in memory (kept in a module-level map for the page session, at most 6 files). A page reload clears it.
- Avatar: aspect 1:1, mask previews the block's shape (circle 50%, rounded 15%, arch 50% 50% 0 0, square). The output is the full square; the renderer applies the shape, so the shape can still be changed later.
- Banner: aspect is the block's own width/height.

**Controls.** Drag (mouse or one finger), pinch (two fingers), wheel, zoom slider, minus/plus buttons. With the crop area focused: arrow keys pan (Shift = 5x), plus/minus zoom, 0 resets, Enter confirms, Esc cancels. Esc works even when focus fell to the page (the listener is on `window`).

**Accessibility.** Modal dialog with `aria-modal`, label and description, focus moves in and is restored on close, Tab is trapped, page scroll locked, every control labelled, all buttons 44 px, readout in a live region, light and dark tokens, checkerboard behind transparent PNGs. Bottom sheet layout on phones.

**Image handling.** `lib/editor/crop-canvas.ts`: the file header is sniffed first and images over `LIMITS.maxPixels` (50 MP, same as the server) are refused. Decoding uses `createImageBitmap(..., {imageOrientation: "from-image"})` so EXIF rotation is applied, with an `<img>` fallback. Images whose longest side exceeds 4096 px are drawn once onto a smaller canvas and the full-size pixels are released. Output: PNG stays PNG (transparency kept), everything else becomes JPEG quality 0.92 on white. Output size never enlarges and is capped at `LIMITS.maxSide` (avatar 400, banner 1200).

**Math** is pure and unit tested in `lib/editor/crop.ts`: crop rectangle, clamping (the region never leaves the image), zoom limits (1 to 8, and never below 24 source px), pan, zoom about a focus point, output size, working scale.

## 2. Animated GIF maker

Banner blocks show "Make animated GIF" (`components/gif-maker.tsx`). The person adds 2 to 6 PNG/JPEG/GIF frames (each under 2 MB; a GIF contributes its first frame), reorders them with up/down buttons, sets a delay per frame (100 to 10000 ms), repeat count (forever, 1 to 10) and size (default: the banner's size; width 100-600, height 20-300). "Build preview" posts to the server; the preview and a size meter against the 300 KB guideline and 1 MB error line are shown. Changing any setting marks the preview stale. "Use this GIF" is disabled when stale or over 1 MB, and uploads through the normal `/api/upload` flow (which re-checks the `animated_gif` flag and size rules). The dialog always states that Outlook on Windows shows only the first frame, and frame 1 is labelled as such.

**Route** `POST /api/media/gif` (`app/api/media/gif/route.ts`): `sameOrigin` check, `requireFeature("animated_gif")` (403 `feature_disabled` when off, 401 signed out, 503 when access control is unavailable), declared body size cap, frame count 2-6, each frame under 2 MB and a PNG/JPEG/GIF by magic bytes (not by browser MIME), under 12 megapixels decoded, options validated by a strict zod schema. `lib/gif/build.ts` normalises each frame (EXIF rotate, letterbox `contain` on white, flatten transparency onto white), joins them with sharp and encodes with the 256-colour palette, stepping down 128/64/32/16 colours only while over 300 KB. Over 3 MB after that: 422 `output_too_large`. The GIF is returned, not stored. Errors never echo file content.

When the flag is off the route's 403 makes the dialog explain it. The editor also takes a `gifEnabled` prop (default true); when false the button is replaced by an explanation. See Integration requests in the report: `app/(app)/editor/page.tsx` should pass it.

## Limits

| Thing | Limit |
| --- | --- |
| Crop source pixels | 50 MP (header check), drawn at max 4096 px longest side |
| Crop output longest side | avatar 400, banner 1200 |
| GIF frames | 2 to 6, each under 2 MB and 12 MP |
| GIF delay / repeat | 100-10000 ms / forever or 1-10 |
| GIF size | 100-600 by 20-300 px; warn over 300 KB, block "Use" over 1 MB; server refuses over 3 MB |

## What was verified

- Unit and component tests: `lib/editor/crop.test.ts` (28), `lib/gif/build.test.ts` (12, real sharp), `app/api/media/gif/gif.test.ts` (13, mocked Supabase), `components/image-cropper.test.tsx` (14, jsdom, crop-canvas mocked), `components/gif-maker.test.tsx` (16, jsdom, fetch mocked).
- Real Chrome with a real canvas (temporary page, since deleted), desktop 1280 and phone 375, light and dark: a JPEG with EXIF orientation 6 comes out upright; a transparent PNG stays PNG with transparent corners; a 35 MP PNG opens in about 1.5 s and crops to 400x400; banner crop outputs 1200x300; keyboard zoom/pan/Enter/Esc, Tab trap and focus restore; mouse drag and touch drag (CDP touch events) pan the picture; all dialog buttons are at least 44 px; the dialog does not overflow at 375 px.
- Editor integration (with `/api/upload` and `/api/media/gif` mocked): picking a file on a Banner block uploads nothing until confirm, then uploads the cropped PNG (600x150, not the 600x600 original); Re-crop reopens; the GIF maker lists, reorders, builds, shows OK and over-300 KB meter states and the stale notice.

## Not verified

- Real `/api/upload` and Bunny storage with a cropped file or the built GIF (needs BUNNY_* and sign-in). The server path was tested only in unit tests with real sharp.
- The feature flag against a real database (mocked `feature_enabled` rpc).
- Pinch zoom on a physical touch device (single-finger touch drag was verified via emulated touch events; the two-pointer code path has no automated test).
- Real GIF playback in Outlook, Gmail and Apple Mail.
