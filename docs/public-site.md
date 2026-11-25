# Public marketing site and free generator

The public site is OFF by default. Nothing here is reachable without signing in unless `PUBLIC_SITE_ENABLED=true`. Which paths are public is decided only by `lib/public-routes.ts`: `/`, `/signature-generator`, `/for/*`, `/privacy`, `/terms`, `/sitemap.xml`, `/robots.txt`.

## Turning it on

| Env var | Purpose | Default |
|---|---|---|
| `PUBLIC_SITE_ENABLED` | `true` makes the site above public | off |
| `BRAND_NAME` | Product name in all copy and metadata | `SignCraft` |
| `BRAND_TAGLINE` | One-line description | built-in line |
| `BRAND_DOMAIN` | Host without scheme (for canonical URLs, Open Graph, sitemap) | unset: no canonical, empty sitemap |
| `BRAND_COMPANY` | Operator's legal name (legal pages, footer, Organization JSON-LD) | placeholder, shown as a to-do |
| `BRAND_CONTACT_EMAIL` | Privacy and support contact | unset: shown as a to-do |
| `BRAND_ADDRESS`, `BRAND_JURISDICTION` | Optional, legal pages | unset |
| `TRUST_PROXY_HEADERS`, `TRUSTED_PROXY_HOPS` | Client IP for rate limits, see below | untrusted, 1 |

The product name and domain are an open owner decision; no page copy hardcodes either (a test checks the niche copy). `app/page.tsx` shows the marketing home only when the site is on and nobody is signed in; otherwise it redirects to `/create` as before.

## Pages

- `/` home, `/signature-generator`, `/for/recruiters`, `/for/real-estate`, `/for/freelancers`, `/for/agencies` (content in `lib/site/niches.ts`), `/privacy`, `/terms`.
- Each page has a title, description, canonical, Open Graph, and JSON-LD (Organization everywhere; FAQPage where an FAQ exists; SoftwareApplication on home and generator). No ratings or reviews are ever emitted. The generator's SoftwareApplication states a price of 0, which is true; nothing else states a price.
- `robots.txt` disallows everything and `sitemap.xml` is empty when the site is off (and the sitemap is also empty with no `BRAND_DOMAIN`, because sitemap URLs must be absolute).
- Dark and light follow the system setting (tokens in `app/globals.css`).

## The free generator

Fully client side: no fetch, no server action, no upload, no AI, no cookies, no browser storage. Templates are the curated "Essentials" collection. Output goes through the shared `SignatureDocSchema` and the real renderer, and the preview runs in a script-less sandboxed iframe. Sample photos from templates are never included; a person may paste an https link to a photo they host. A jsdom test fails if the generator calls `fetch`.

## Usage limits for public users

The generator makes no requests, so it needs no limit. Any future endpoint under `/api/public` must rate limit itself with `lib/site/rate-limit.ts`:

| Profile | Limit | Window |
|---|---|---|
| `PUBLIC_LIMITS.read` | 60 requests | 1 minute |
| `PUBLIC_LIMITS.write` | 10 requests | 1 minute |
| `PUBLIC_LIMITS.expensive` | 5 requests | 1 hour |

AI is never public. Caveats: in-memory, per server instance (so the effective ceiling is limit x instances on serverless), reset on restart, memory bounded by `maxKeys` (default 10,000).

**Proxies.** Forwarding headers can be forged by clients. `clientIp()` ignores them unless `TRUST_PROXY_HEADERS=true`; then it reads `X-Forwarded-For` from the right, taking the entry `TRUSTED_PROXY_HOPS` from the end (default 1: the one your own proxy appended), falls back to `X-Real-IP`, and requires a valid IP. Untrusted or invalid means everyone shares one `unknown` bucket, which fails safe. Set the variables only when a proxy you control overwrites these headers.

## Honest claims

`lib/site/claims.ts` is the only place compatibility claims live. Every claim has `verified: false` and a design-intent wording ("Built to Outlook-safe rules..."). Pages use `claimText(id)`. `lib/site/claims.test.tsx` scans all page source and the rendered pages and fails if wording matching a strong claim whose switch is off appears. Flip a switch only after the real-client checklists in `docs/client-testing.md` and `docs/gmail-push.md` pass.

## Legal pages

Drafts, each with a visible "DRAFT: requires review by a qualified lawyer before public use" banner. Unknown operator decisions are shown as highlighted `[bracketed]` to-dos (company name, contact, retention periods, hosting provider, Anthropic data terms, recipient tracking, liability cap, minimum age, governing venue). They make no certification or compliance claims. Do not publish until a lawyer has reviewed them and the brackets are resolved.

## Pricing research

See `docs/pricing-research.md`. Research only; no billing exists.
