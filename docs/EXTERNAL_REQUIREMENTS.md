# What needs you: credentials, setup and real-world checks

Everything in the code is built and tested, but **only against test databases and fakes**. Nothing below has been run against a real Supabase project, Google Workspace, Microsoft 365, HubSpot, a CRM, Gmail, Outlook or Anthropic's API. This page is the single list of what only you can do, in a sensible order. Each item points at the detailed guide.

## 1. Database: apply the migrations, in order

In the Supabase SQL editor (or `supabase db push`), apply every file in `supabase/migrations/` in numeric order. If one fails, stop and send me the error.

| Migration | Adds |
|---|---|
| 0001, 0002 | Signatures, uploaded-image records |
| 0003 | Roles, feature flags, AI limits and usage |
| 0004 | Encrypted Google connections (Gmail push) |
| 0005 | Seven more feature flags |
| 0006 | Banner campaigns, click tracking, legal disclaimer templates |
| 0007 | Digital business cards |
| 0008 | Designer-polish workflow |
| 0009 | People directory, brand templates, approvals, CSV import |
| 0010 | Bulk deploy, signature rules |
| 0011 | Directory and CRM sync |
| 0012 | Signature health monitor |
| 0013 | GIF and dark-logo facts kept with each uploaded image |
| 0014 | Approving the template signature for directory people |
| 0015 | Agency mode, branding, plans |

After applying them, sign in once with an `ADMIN_EMAILS` account and open **Admin** to confirm the screens load.

## 2. Settings in `.env.local` (never commit these)

`.env.example` lists every setting with a comment. The groups:

| Group | Settings | Needed for |
|---|---|---|
| Core | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS` | Sign-in, admin bootstrap, everything server-side |
| Images | `BUNNY_*` | Uploads |
| AI | `ANTHROPIC_API_KEY` (and the model settings you already manage) | Autofill, design, screenshot-to-signature |
| Gmail push | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_WORKSPACE_DOMAINS`, `GOOGLE_REDIRECT_URI` | One-click install into your own Gmail |
| Bulk deploy, directory sync, health monitor | `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DIRECTORY_ADMIN_EMAIL` | Acting for many Workspace users |
| Microsoft 365 directory | `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | Directory sync |
| CRM | `HUBSPOT_ACCESS_TOKEN`, `KIMP_CRM_SECRET` | CRM sync |
| Scheduled runs | `SYNC_CRON_SECRET`, `HEALTH_CRON_SECRET` (each 32+ characters) | Unattended sync and health checks |
| Click tracking | `CAMPAIGN_TOKEN_SECRET`, `CAMPAIGN_BASE_URL` | Tracked banner links |
| Digital cards | `NEXT_PUBLIC_SITE_URL` | QR codes and vCard addresses |
| Rendered previews | `RENDER_ENABLED` and `RENDER_*` | Real-engine previews (not on serverless hosting) |
| Public site | `PUBLIC_SITE_ENABLED`, `BRAND_*`, `TRUST_PROXY_HEADERS`, `TRUSTED_PROXY_HOPS` | Marketing site and free generator |

Keep **email confirmation on** in Supabase: only confirmed emails are ever promoted to admin.

## 3. Google (Workspace admin, Cloud console)

| What | Guide |
|---|---|
| OAuth client for "Send to Gmail": Gmail API on, Internal consent screen, redirect URIs | `docs/gmail-push.md` |
| Service account with domain-wide delegation: scope `gmail.settings.basic` (bulk deploy, health monitor) and `admin.directory.user.readonly` (directory sync) | `docs/deploy-and-rules.md`, `docs/directory-and-crm-sync.md` |

## 4. Microsoft 365

| What | Guide |
|---|---|
| Azure app registration with `User.Read.All` and admin consent (directory sync) | `docs/directory-and-crm-sync.md` |
| Microsoft has no API for Outlook signatures. SignCraft **generates a PowerShell script** for an Exchange mail-flow rule. You or your Exchange admin review it and run it, first in audit mode. SignCraft never runs it. | `docs/deploy-and-rules.md` |

## 5. CRM

HubSpot private-app token, and for your own CRM: the credential, the header name, the URL and a sample response. The generic adapter has a Test button that shows exactly what would be mapped. See `docs/directory-and-crm-sync.md`.

## 6. Scheduling (optional)

Call `POST /api/sync/run` and `POST /api/health/run` on a schedule (Vercel Cron, GitHub Actions, any scheduler) with `Authorization: Bearer <the secret>`. Without a scheduler everything still works through the screens.

## 7. Real-world verification (nothing counts as verified until these pass)

| Area | Check | Guide |
|---|---|---|
| **MVP** | Paste the signatures into real Gmail and Outlook (`npm run client-pack`) | `docs/client-testing.md` |
| Rendered previews | Compare the Outlook and Gmail **simulations** with the real clients | `docs/rendered-previews.md` |
| Gmail push | The full real-account checklist | `docs/gmail-push.md` |
| Bulk deploy | A small test group first; confirm Gmail keeps the HTML as sent | `docs/deploy-and-rules.md` |
| Exchange script | Audit mode on a test mailbox | `docs/deploy-and-rules.md` |
| Directory and CRM sync | Preview against real data; lower the safety cap to 1% once to see it refuse | `docs/directory-and-crm-sync.md` |
| Health monitor | Edit a deployed signature in Gmail and watch it appear | `docs/health-monitor.md` |
| Click tracking | Send a tracked signature to Gmail and Apple Mail; check clicks land | `docs/campaigns-and-analytics.md` |
| Screenshot-to-signature | `npm run vision:smoke` with your API key | `docs/screenshot-to-signature.md` |
| Digital cards | Scan the QR with a phone; save the vCard on iOS and Android | `docs/digital-card.md` |
| GIF and crop | Upload through the real image host; play a GIF in real clients | `docs/crop-and-gif.md` |
| Concurrent use | Two people claiming the same polish request; two admins deploying | `docs/designer-polish.md` |

## 8. Decisions and reviews that are yours

- **Legal pages** (`/privacy`, `/terms`) and the disclaimer templates are **drafts** and say so on screen. A lawyer must review them before public use.
- **Product name and domain** are still open. Everything reads them from `BRAND_*`; nothing hardcodes them.
- **Opening to the public:** the marketing site and free generator stay off unless `PUBLIC_SITE_ENABLED=true`. Marketing copy deliberately makes **no** claim that signatures work in Outlook or Gmail, and a test fails if one is added before its claim is marked verified in `lib/site/claims.ts`.
- **Pricing research** (`docs/pricing-research.md`) was read by an automated page reader. Two figures looked wrong and one vendor's page could not be read. Re-check by hand before relying on it.
- **Gmail push and tracked banners:** tracked banners work for copy and download, but not for "Send to Gmail", because that would change the Gmail push code. Say if you want it.

## 9. Deliberately not built

Billing or any payment (Stripe, invoices, plan purchases); email notifications (there is no email service, so alerts are in the app plus an optional webhook); personal Gmail support (needs Google's app verification); a restore-previous-signature button for Gmail push; encryption-key rotation.
