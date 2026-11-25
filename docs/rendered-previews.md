# Rendered previews: what is real, what is simulated

PROJECT.md asks for a "compatibility confidence score: real rendered previews". This is the honest version of that. Nothing here
replaces testing in a real Outlook and a real Gmail account (see [client-testing.md](client-testing.md)).

## The three kinds of preview

| Kind | Where | What it is |
| --- | --- | --- |
| **Real engine** | "Render in all engines" (server, PNG images) | The signature HTML, untouched, drawn by a real browser engine: **Chromium** (Blink), **WebKit**, **Firefox** (Gecko). |
| **Simulation** | Gmail and Outlook Win tabs, and the same two in "Render in all engines" | The HTML is first rewritten to mimic a client's documented behaviour, then drawn by Chromium. Always labelled "Simulation". Never called real Outlook or real Gmail. |
| **Approximation in Chrome** | Outlook web, Apple Mail, Thunderbird, Mobile tabs | The live frame on the page is always Chrome. These tabs only change the pane colour, font and width. For Apple Mail and Thunderbird the real engine is available through "Render in all engines". |

### Which real engine stands for which client

| Engine | Stands for | Caveat |
| --- | --- | --- |
| Chromium | Gmail on the web and Outlook.com (Blink), Chrome, Edge | Those clients clean the HTML before drawing it. Use the Gmail simulation for that part. |
| WebKit | Apple Mail (macOS) and Mail on iPhone/iPad | Pane colours, default font and the phone zoom are ours, not Apple's. |
| Firefox (Gecko) | Thunderbird | Same caveat. |

**Classic Outlook for Windows is not a browser.** It lays HTML out with Microsoft Word. No browser can show it for real. The
"Outlook for Windows (simulation)" is our reading of Microsoft's own documentation, applied to the HTML and then drawn by Chrome.
It reliably shows which features disappear (rounded corners, background images, `max-width`, CSS sizes on images). It does not
reproduce Word's exact spacing, font fallback, line-height rounding or DPI scaling.

## The simulations and their sources

Every rule is in code with a comment naming its source. Rules without a source were not written.

### Outlook for Windows, Word engine (`lib/render/outlook-word.ts`)

- Microsoft, [Word 2007 HTML and CSS Rendering Capabilities in Outlook 2007](https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2007/aa338201(v=office.12)):
  the list of CSS properties Word supports per element (`span` and `body` get a small set, `div` and `p` add margin and text-indent,
  tables, cells and images get width, height, padding and per-side borders) and the statement that unsupported properties are
  treated as unknown. The list has no `border-radius`, `box-shadow`, `opacity`, gradients, flex, grid, `max-width`, `overflow-wrap`.
  It names `background-image`, `float`, `position`, `overflow`, `max-width`, `min-width` as unsupported, says the HTML `background`
  attribute with a URL is unsupported, and says animated GIFs show only a static image.
  *This page documents Outlook 2007. Outlook 2010 to 2021 use the same Word-based engine and vendor guides describe the same limits,
  but Microsoft has not republished the list for them.*
- Campaign Monitor, [Outlook 2007-16 CSS support](https://www.campaignmonitor.com/css/email-client/outlook-2007-16): `text-transform`
  works only for `uppercase`; `display` is only partly honoured; margin, padding, borders and `line-height` are buggy or partial.
- Email on Acid, [Outlook desktop tips](https://www.emailonacid.com/tip/outlook-desktop/): no margin or padding on images in Outlook
  2007/2010; width and height are taken from HTML attributes, with poor or no support for sizing images through CSS.

What it does: keeps only properties Word supports on that element; drops padding and width/height on `div`, `p`, `span`; keeps only the
colour of a `background` shorthand; drops gradients and background images; drops margin and padding on images; ignores CSS
width/height on images that lack width and height attributes (they show at natural size); keeps `text-transform` only for uppercase.
It never changes the table structure.

What it does **not** do (reported in "Known differences" instead): pick the first frame of an animated GIF, DPI scaling, line-height
rounding, VML fallbacks, Word's table-width algorithm.

### Gmail clean-up (`lib/render/gmail-sanitize.ts`)

Source: Google, [CSS support in Gmail](https://developers.google.com/workspace/gmail/design/css). Removes `position`, `z-index`, `flex*`,
`grid*`, `gap`, `box-shadow`, `transform`, `transition` and custom properties; negative margins and `text-indent`; turns
`white-space:pre` into `pre-wrap`; keeps `url()` only in background properties and blanks `data:` URLs; discards a whole style attribute
that uses a space-separated colour function; removes `<style>` blocks outside the head. `border-radius` is supported by Gmail and stays.
Images are proxied by Google and may stay hidden until allowed: reported, not simulated.

### Dark mode (`lib/render/dark.ts`)

Source: Litmus, [Dark mode for email guide](https://www.litmus.com/blog/the-ultimate-guide-to-dark-mode-for-email-marketers) (client chart,
Feb 2025) and Google's Gmail CSS page ("On the web, email bodies stay on a light background"). Three models: **none** (Apple Mail by
default, Gmail on the web), **partial** (Outlook.com, Outlook mobile, Gmail on Android: light backgrounds darkened, dark text on them lightened),
**full** (Outlook for Windows, Gmail on iOS: light and dark colours both inverted). The lightness mapping itself is ours: no client
publishes its algorithm, so treat colours as "what kind of change", not exact values. Images are never changed.

## Known differences report

`lib/render/differences.ts` reads the signature's own HTML and lists, per client, what will look different from the design, with counts
("7 rounded corners will be square", "2 images sized only by CSS will show at natural size", "the signature is 620px wide, a phone pane
is about 375px"). Shown under the preview in the exporter. It is a prediction from documented rules, not a measurement of the real client.

## Enabling the render service

The service launches real browsers on the server. It needs a **long-running Node server with browsers installed**. It will not run
on a serverless host (Vercel functions, Netlify functions, Cloudflare Workers): there is no browser binary and no persistent process.
Run it on a VM, a container or a Node host, or leave it off.

1. Chromium: install Chrome/Chromium (the service auto-detects common paths, or set `RENDER_CHROME_PATH`).
2. WebKit and Firefox: `npx playwright-core install webkit firefox` (add `--with-deps` on Linux; in a container also install the
   system libraries it lists). Downloads go to Playwright's cache, not `node_modules`.
3. Set `RENDER_ENABLED=true`.
4. Turn on the `render_previews` feature flag for the people who should use it (Admin, Features).

An engine that is missing is skipped with a reason shown in the UI; the others still render. When `RENDER_ENABLED` is not `true` the
button is disabled and says so, and `POST /api/render` answers `503 render_disabled`.

| Env var | Default | Meaning |
| --- | --- | --- |
| `RENDER_ENABLED` | off | Must be `true`. |
| `RENDER_CHROME_PATH` | auto | Chrome/Chromium executable. |
| `RENDER_CONCURRENCY` | 2 | Pages drawn at the same time. |
| `RENDER_QUEUE` | 12 | Waiting jobs allowed before answering 503 "busy". |
| `RENDER_TIMEOUT_MS` | 15000 | Per render. |
| `RENDER_RATE_PER_MINUTE` | 6 | Requests per user per minute (each request may draw up to 10 images). |
| `RENDER_NO_SANDBOX` | off | `true` only when Chromium runs as root in a container. |

Rate limit, cache and queue live in the memory of one process. Run one instance, or accept that limits are per instance.

### Safety model

- The route takes a **document**, not HTML. The server renders it with the project's own renderer, so the caller cannot inject markup.
- Sign-in, the `render_previews` flag, same-origin check, zod validation, body size cap (200 KB), per-user rate limit, bounded queue,
  hard timeout, results cached by content hash (10 minutes, 64 MB).
- JavaScript is off in the browser context, service workers and downloads are blocked, and a Content-Security-Policy allows only inline
  styles and https/data images.
- The browser never touches the network. Every request is intercepted; the page is served from memory and images are fetched by the server
  (`lib/render/safe-image.ts`): https and port 443 only, no credentials in the URL, the host is resolved first and every address must be
  public, the connection is pinned to the checked address (no DNS rebinding), at most 3 redirects each re-checked, 5 s and 4 MB limits, image
  content types only. Everything else is aborted.

## The render matrix

```
node scripts/render-matrix.mjs                         # all 121 templates, every available engine, desktop + phone
node scripts/render-matrix.mjs --ids=classic,studio-003 --dark --online
```

Writes `render-matrix/` (add it to `.gitignore`): `index.html` contact sheet, `report.json`, `img/`. Works offline (images become grey
placeholders unless `--online`). It flags, from measurement, templates where real engines disagree on size, content overflows the pane,
text is clipped, a word is broken across lines mid-word, or the Outlook simulation shifts the layout by more than 25%. Treat a flag as a
prompt to look at the sheet.

## What still needs your real Outlook and Gmail tests

Nothing here has been checked against real Outlook or real Gmail. Still to do by hand (procedure in [client-testing.md](client-testing.md)):

- Classic Outlook for Windows (Word): does the simulation match? Compare each template; note spacing, fonts, image sizes, rounded corners.
- New Outlook / Outlook on the web: their own HTML clean-up is not simulated at all.
- Gmail web and the Gmail apps: confirm the clean-up list, image proxying and dark-mode behaviour.
- Outlook mobile, Apple Mail on a real phone: confirm how wide signatures are scaled.
- Any mismatch found should be fed back into `lib/render/*` as a sourced rule.
