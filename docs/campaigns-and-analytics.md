# Banner campaigns, click tracking and legal disclaimers

Migration: `supabase/migrations/0006_campaigns.sql`. Screens: `/admin/campaigns` (flag `campaigns`), `/admin/analytics` (flag `analytics`), `/admin/disclaimers` (admins). All three are admin-only.

## Environment variables

| Variable | Needed for | Notes |
|---|---|---|
| `CAMPAIGN_TOKEN_SECRET` | Signing and verifying tracked links | **Required.** 32 characters or more, server only. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Without it nothing is signed, tracked banners render as ordinary banners, and `/b` and `/r` answer 404 to everything (fail closed). Rotating it invalidates every tracked link already sent in e-mails, so treat it like a permanent key. |
| `CAMPAIGN_BASE_URL` | The public address put in links | e.g. `https://sign.yourcompany.com`, no trailing slash. Must be reachable by recipients' mail apps. Defaults to the request's own origin, which is wrong on localhost (the admin screen warns). |
| `SUPABASE_SERVICE_ROLE_KEY` | Counting clicks and image loads | Already used elsewhere. Without it the endpoints still redirect (to the signed targets) but record nothing. |

## How the tokens work

A tracked banner in a signature contains two kinds of link:

- `/r/<token>` wraps the banner's link. Clicking it logs the click, then answers `302` to the destination.
- `/b/<token>` (only when a campaign is attached) is the image source. It answers `302` to the image of the variant this signature should see.

A token is `base64url(JSON) . base64url(HMAC-SHA256(secret, "sc-token-v1:" + first part))`. The JSON holds the kind (`r` or `b`), the campaign id, the signature id and, signed in, the fallback destination (`h`, a link) or fallback image (`f`). Because the whole thing is signed, anyone holding a link can read it but cannot change it. Consequences:

- **No open redirect.** The redirect target is never taken from the query string or path. It is either the `href` stored on the campaign by an admin, or the `h` value that was signed into the token. Both must be plain `https://` URLs without credentials, re-checked at redirect time.
- Forged, truncated, oversized, wrongly encoded or wrong-kind tokens (a banner token used on `/r`) all get the same empty `404`, with no hint why.
- A deleted campaign, a paused one and an unknown id are indistinguishable to the caller: `/b` always answers `302` to the signed fallback image, `/r` goes to the signed destination (or `404` if none). Nothing reveals whether a campaign exists.
- Tokens are minted only on the server: `POST /api/campaigns/render` (for the signature's owner, and only for campaigns the owner's organization can see) and `POST /api/campaigns/:id/link` (admins).

The image is a redirect rather than a proxy, so the server never fetches a URL on a caller's behalf (no SSRF) and the image comes from your CDN at full speed. Cache headers on `/b`: `public, max-age=300, s-maxage=300`, so a schedule change reaches signatures within about five minutes (Gmail's image proxy may cache longer). `/r` is `no-store`.

Abuse handling: both endpoints are rate limited in memory (120 requests per minute per address, per server instance; not shared between serverless instances, so it is a brake rather than an exact quota). When limited, a click is still sent to its signed destination (real people are never blocked) but nothing is logged and the database is not touched; if there is no signed destination the answer is `429`. `HEAD` requests are never counted. Database failures never stop a redirect.

## Privacy stance

- No IP address, user agent, e-mail address, location or cookie is stored. The IP is used in memory only, for the rate limiter and to build a hash.
- `click_events` keeps: campaign, variant, day, time, a coarse device class (`desktop`, `mobile`, `tablet`, `other`) and a **visitor hash** = first 128 bits of SHA-256(daily salt, IP, first 300 characters of the user agent). The daily salt is HMAC(secret, UTC date) and is never stored, so a hash cannot be matched against an address afterwards, and the same person has a different hash every day. The only thing it supports is "unique clicks per day".
- Image loads are only counted (one counter row per campaign, variant and day), never logged one by one.
- Event tables have no insert/update/delete privilege for the browser-facing roles and no write policy; rows appear only through `record_click()` and `record_image_load()`, which only the service role can execute. Admins read only their own organization's events (row-level security).
- You still need a privacy notice that mentions click measurement, and in some jurisdictions a legal basis for it. This is not legal advice.

## A/B method

Each campaign has up to 8 variants with integer weights. A signature always sees the same variant: take SHA-256 of `campaign id | signature id`, read 48 bits as a number in [0,1), multiply by the total weight and walk the variants (sorted by id, weight 0 skipped) until the cumulative weight passes it. There is no cookie and no stored assignment, so the same employee shows the same variant to every recipient and the split follows the weights across many signatures (tested to within a few percent).

Limits: with few signatures (a team of ten) the split can be uneven by chance. Changing weights, or adding or removing variants, can move a signature to a different variant, so edit weights before a test starts, not during. The click is attributed to the variant computed at click time, which matches what was shown unless weights changed in between. A/B results measure the audience that clicks, and there is no significance test; use the numbers as a guide.

Status and schedule: only `active` campaigns inside `starts_at` / `ends_at` run. Outside that, paused, draft, ended or deleted, signatures show their usual banner (the block's own `src`).

## The limits of impression counting

"Image loads" is **not** impressions. Apple Mail Privacy Protection downloads remote images in advance whether or not the message is opened, Gmail and some other clients load through proxies and cache, Outlook often blocks images until allowed, and one open can trigger several loads. The analytics screen therefore says "image loads", and **clicks are the primary metric**. "Clicks per image load" is shown as a rough guide, never as a true click-through rate. Link scanners (security gateways such as Microsoft Safe Links) can also follow links before a person does, so clicks can include a few automated ones; unique-per-day counts reduce but do not remove this.

## Using it in a signature

The banner block has two optional fields: `track: true` and `campaign_id`. Render with `renderToEmailHtml(doc, { tracking })` where `tracking = trackingOptions(signatureId, origin)` from `lib/campaigns/tracking.ts` (server only). Without that option, or with `track` off, output is byte-identical to before (the snapshot tests prove it). From the browser use `POST /api/campaigns/render { doc, signature_id }`.

## Legal disclaimer templates

`legal_disclaimers` holds global starting points (organization null) seeded by the migration, plus each organization's own. Every seeded text is marked `needs_review` and the screen says each is a starting point, not legal advice. Organizations copy one to their own list, edit it, and tick "a lawyer has reviewed this" themselves. Helpers for the editor are in `lib/disclaimers` (`listDisclaimers`, `toDisclaimerBlock`, `insertDisclaimer`); the text is copied into the signature's `disclaimer` block, so later edits to a template do not change signatures already made. Editor integration is not done here.

## API

All under admin + flag unless noted; writes need a same-origin request.

- `GET/POST /api/campaigns`, `PATCH/DELETE /api/campaigns/:id`, `PUT /api/campaigns/:id/variants`, `POST /api/campaigns/:id/link`, `POST /api/campaigns/:id/preview`
- `GET /api/campaigns/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=csv]` (flag `analytics`; ranges up to one year; CSV cells that start with `= + - @` are neutralised)
- `POST /api/campaigns/render` (any signed-in user, own signatures only)
- `GET/POST /api/disclaimers`, `PATCH/DELETE /api/disclaimers/:id` (read: any signed-in user; write: admin)

## Built, not verified against the real service

Everything is tested with fakes and a real Postgres engine (PGlite), but not against a live Supabase project or real mail clients. To verify: apply migration 0006; set `CAMPAIGN_TOKEN_SECRET`, `CAMPAIGN_BASE_URL` and the service role key; create a campaign with two variants and switch it on; copy the tracked link; open `/r/<token>` in a browser and confirm a click row appears and you land on the destination; send a signature with a tracked banner to Gmail and Apple Mail and check what loads. Not covered: how long each mail client caches `/b` images, and image-proxy behaviour with redirects (Gmail, Outlook.com and Apple Mail follow image redirects, but confirm with your own clients).
