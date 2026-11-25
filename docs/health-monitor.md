# Signature health monitor

Migration: `supabase/migrations/0012_health_monitor.sql` (needs 0010). Screen: `/team/health` (admins, flag `health_monitor`). Code: `lib/health/*`, `app/api/health/*`, `app/(app)/team/health/*`.

> **Status: BUILT, NOT VERIFIED against a real Google Workspace.** Tested with fakes (a fake mailbox that follows the documented Gmail `sendAs` shape, a real Postgres engine for the database, mocked Supabase for the routes, jsdom for the screen, and a real browser with mocked APIs for the layout). Nothing here has read a real mailbox. Everything about how Gmail stores HTML is an assumption.

## What it does

After the bulk Gmail deploy (`lib/deploy`) writes signatures, people can edit or delete them. The monitor reads each deployed person's live primary-address signature with the same domain-wide-delegation token and reports:

| State | Meaning | Certainty |
|---|---|---|
| ok | Live words equal the approved words (or, when the approved text cannot be rebuilt, equal the baseline) | See below |
| edited | The words differ | Reliable for changed words |
| removed | Empty (no text, no image) | Certain, given a successful read |
| unreachable | Could not read it (rate limit, Google error, no mailbox, delegation missing). The reason is stored. **Never a finding**; it neither opens nor closes one | Certain |
| not monitored | Never deployed, inactive, or the latest Gmail change to them was a rollback restore | By definition |

Who is monitored: each active person whose latest **done** Gmail deployment item is a set or replace. People SignCraft skipped (for example "already up to date": nothing was written) are not monitored.

## The reformatting problem, stated honestly

Gmail may store HTML differently from what was sent (attribute order, quotes, wrapper elements). Comparing HTML would report everyone as edited. Unverified against real Gmail, so the design does not depend on Gmail leaving HTML alone:

1. **Baseline.** The live signature as Gmail stored it, recorded at the first check after a deployment (the deploy runner is not edited, so there is no read-back right after the write). Stored as two hashes only: the whitespace-normalised HTML hash and a text fingerprint. No signature bodies are stored.
2. **Expected text.** The deployment kept only a hash of what it sent. The monitor rebuilds the approved signature from the planned version and the person's directory entry and **trusts it only if it hashes to exactly the deployed hash**. Otherwise (template or directory changed since) the expected text is unknown and the baseline is used.
3. **Text fingerprint.** Tags stripped (block tags become spaces, inline tags do not split words), entities decoded, NFKC, zero-width characters removed, whitespace collapsed, then sha256.

Decision order (`lib/health/classify.ts`):
- Empty: removed.
- Expected text known: live text equals it: ok (if the HTML differs from the baseline it is counted as "reformatted", a guess). Different: edited. The baseline cannot hide an edit: a baseline taken from an already edited signature is stored as "not verified" and the next check still says edited.
- Expected text unknown: no baseline yet: ok, baseline recorded, not verified (nothing to compare with). Baseline exists: same HTML: ok; same text: ok, reformatted; different text: edited.

**Known blind spot:** a change that only affects markup (a link address, an image address, a colour, a font) cannot be told from Gmail reformatting, so it is not reported. **Certain:** removal, and changed words. **Heuristic:** everything counted as "reformatted". If the first check happens after someone already edited the signature and the approved text cannot be rebuilt, that edit becomes the baseline and is not noticed.

## No alert storms

One finding per person while it is open or acknowledged (a unique index in the database, not just code). A person who fixes it resolves automatically at the next check ("The signature matches again"). Acknowledge needs a note and records who and when; an acknowledged finding stays quiet, unless the problem gets worse (edited then removed), which opens it again. People no longer monitored have their finding closed ("No longer monitored"). The webhook is claimed once per run in the database.

## Running it

**Run check now** (admins): `POST /api/health/check`. Works within a 40 second budget per request and returns `done: false` when it needs another call; the screen keeps calling. The run resumes from a saved cursor, so nobody is checked twice. Concurrency 5, backoff on 429 and 5xx (reused from lib/deploy). Hard cap 1000 people per run (`max_people` setting up to 1000); if more are monitored, each run continues where the last capped one stopped. If Google says the service account is not authorised, the run stops as failed with the reason instead of marking everyone unreachable. Reads signatures only; never writes to Gmail.

**Unattended:** `POST /api/health/run` with `Authorization: Bearer <HEALTH_CRON_SECRET>`. No browser session, no cookie, no same-origin check. Reuses the comparison from `lib/sync/route.ts` (both sides hashed, constant time) fed from `HEALTH_CRON_SECRET`; under 32 characters means 503 (off); a wrong or missing secret is 401. `SYNC_CRON_SECRET` does not open it. It visits every organization that switched "Check automatically" on and has the `health_monitor` feature, within 240 seconds; a run that does not finish continues on the next call. The answer holds counts and run ids only, no names, emails or organization names. Needs `SUPABASE_SERVICE_ROLE_KEY` and `GOOGLE_SERVICE_ACCOUNT_JSON`. Example (every hour):

```
curl -X POST https://YOUR-HOST/api/health/run -H "Authorization: Bearer $HEALTH_CRON_SECRET"
```

## Alerts

There is **no email service**. Alerts are the findings list, the open count (`GET /api/health/summary` returns `{ "open": n }`, `0` for anyone who is not an admin of an organization with the feature on) and an optional Slack-compatible webhook (`{ "text": "..." }`). The webhook is one message per run when new findings appeared: counts and a link to `/team/health` only, unless the admin ticks "Include people's names" (names are escaped for Slack markup, at most 20 shown). The address goes through the same SSRF defence as `lib/sync/safe-fetch.ts` (reused: its resolver and address check, plus `checkUrl`): https only, normal port, no credentials, no internal names, every resolved address public, connection pinned to the address checked, no redirects, 8 second timeout. `safe-fetch` itself is GET-only, so the POST transport is a small sibling in `lib/health/webhook.ts`. A failed delivery is shown, never fails the check. The saved address is never sent back to the browser (it is masked, as it normally holds a secret token).

## Restore

"Restore the approved signature" (one person, or several selected) calls the **existing deploy routes** with those people: `POST /api/deploy/gmail/plan` (a dry run), then, after the admin ticks the review box and presses the exact button ("Deploy to 1 person, replacing 1 existing signature"), `POST /api/deploy/gmail/deploy` with `confirmed: true` and the plan fingerprint, then `/api/deploy/deployments/{id}/run`. So all deploy rules apply: the plan, explicit confirmation, a stale plan refused, a backup of what is replaced, rollback from Deploy, History. The monitor never writes a signature itself. It needs the `team_deploy` feature as well.

## Microsoft 365 (Exchange)

A transport rule appends the signature on the server; there is nothing stored per person to edit, so there is nothing per person to monitor. The screen says so. If the rule is changed in Exchange, SignCraft cannot see it.

## Database (0012)

Tables `health_settings`, `health_runs`, `health_people` (the last known state and the baseline hashes per person), `health_findings` (hashes, a short reason, e-mail and name copied from the directory; no signature bodies). RLS: org admins read their own organization only. No insert, update or delete privilege for browser roles on any table. Changes go through security-definer functions with `set search_path = ''`: admin entry points check `is_org_admin`; `*_service` entry points have no user and are granted to `service_role` only (the `*_impl` functions to nobody). A batch is validated: people and deployment items must belong to the run's organization, and e-mail and name come from the directory. A trigger enforces open to resolved or acknowledged, acknowledged to resolved or open, resolved is final.

## Environment variables

| Name | For |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Reading signatures (the same setup as Gmail deploy, scope `gmail.settings.basic`) |
| `HEALTH_CRON_SECRET` (32+ characters) | Unattended checks |
| `SUPABASE_SERVICE_ROLE_KEY` | Unattended checks |
| `NEXT_PUBLIC_SITE_URL` (optional) | The link inside the webhook message |

## Verification steps for the owner (needs a real Workspace)

1. Complete the Gmail deploy setup (docs/deploy-and-rules.md) and deploy to two test people. Apply migration 0012 and give the organization the `health_monitor` feature.
2. Open `/team/health`, press **Run check now**. Expect both people "fine". Look at "stored differently by Gmail": if it is high, Gmail does rewrite markup, and the text comparison is doing its job.
3. In one test account change a word in the signature (Gmail settings), run the check: one finding "Edited". Delete the other's signature: "Removed". Run again: no new findings, no second alert.
4. Put the first signature back by hand: the next check resolves it by itself.
5. Acknowledge the second with a note, then Restore: review the plan, confirm, and check the signature in Gmail and the backup in Deploy, History.
6. Set `HEALTH_CRON_SECRET`, tick "Check automatically", call the curl command above. Try a wrong secret (401) and unset the variable (503).
7. Add a Slack webhook, create a finding, run a check: one message with counts. Try a private address (refused).
8. Suspend one test user in Workspace: they show as "could not be read" with a reason, and no finding appears.

## Known gaps

Baseline is taken at the first check, not at deployment time. Markup-only edits are invisible. Only the primary send-as address is read. People whose deployment was skipped are not monitored. No email. Exchange is not monitored.
