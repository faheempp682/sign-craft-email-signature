# Deploy and rules: Gmail bulk deploy, Microsoft 365 script, signature rules

Migration: `supabase/migrations/0010_deploy_and_rules.sql` (needs 0009; independent of 0011 and 0013). Screen: `/team/deploy` (admins, flag `team_deploy`). Code: `lib/deploy/*`, `lib/rules/*`, `app/api/deploy/*`, `app/(app)/team/deploy/*`.

> **Status: BUILT, NOT VERIFIED against a real Google Workspace or a real Microsoft 365 tenant.** Everything is tested with fakes (a fake Google token endpoint and Gmail API, a real Postgres engine for the database, mocked Supabase for the routes, jsdom and a real browser for the screens). Nothing here has written a signature to a real mailbox. Read "What is unverified" and "Verification steps for the owner" before relying on it.

## What it does

| Target | What SignCraft does | Who runs it |
|---|---|---|
| Gmail | Plans, then (after explicit confirmation) writes each person's APPROVED signature to their primary Gmail address with a service account that has domain-wide delegation. Keeps a backup of every previous signature. Rollback restores them. | SignCraft, on the server |
| Microsoft 365 / Outlook | Generates a PowerShell script (New-TransportRule / Set-TransportRule) for an Exchange Online mail flow rule that appends the signature. Also a removal script and a read-only directory export helper. | **The admin**, in their own PowerShell session. SignCraft never connects to the tenant |
| Rules | Which brand template applies for which message kind, audience and department. Evaluated by a pure, tested function. | Used by both targets within what each can really do |

## 1. Gmail: Workspace setup (exact steps)

SignCraft cannot do these for you. Until they are done, the Gmail tab shows the same list ("not set up yet") and no plan can run.

1. **Google Cloud project.** In the Google Cloud Console pick or create a project. Enable the **Gmail API** (APIs and Services, Library).
2. **Service account.** IAM and Admin, Service accounts, Create. It needs **no project roles**. Open it, Keys, Add key, Create new key, JSON. Keep that file secret.
3. **Server setting.** Set `GOOGLE_SERVICE_ACCOUNT_JSON` on the server to the contents of the JSON file (or the same text base64-encoded if your host dislikes JSON in a setting). Restart. It is read on the server only and never sent to the browser. It is separate from the per-person Gmail push credentials (`lib/google`).
4. **Domain-wide delegation.** In the Google Admin console (admin.google.com) as a super admin: Security, Access and data control, API controls, **Manage domain-wide delegation**, Add new.
   - **Client ID:** the service account's numeric *Unique ID / client ID* (shown on the Deploy screen's setup card once the JSON is set, and in the JSON as `client_id`).
   - **OAuth scopes:** exactly `https://www.googleapis.com/auth/gmail.settings.basic`
   - This scope lets the service account read and change basic Gmail settings (including the signature) for users it acts as. It does not allow reading mail.
5. Wait a few minutes (Google says delegation changes can take time), open **Team, Deploy, Gmail** and make a plan. A "not authorised" message means step 4 is wrong or has not propagated.

The people must exist in the directory (Team) with their **Workspace primary address** as `email`. The service account acts as that address.

### How a Gmail deployment works

1. **Plan (dry run).** `POST /api/deploy/gmail/plan`. For every targeted person (all, or one department) SignCraft takes their newest *approved* version, renders it with the real renderer (`renderVersion`, current directory data), reads their live Gmail signature with the delegated token and decides:
   - **Will be set**: no signature there now.
   - **Will replace**: a different signature exists (shown as such).
   - **Already up to date**: same after whitespace normalisation.
   - **Skipped, with a reason**: inactive; no approved version; the rules choose a different template than their approved version was made from; the signature cannot be built; over Gmail's 10,000 character limit; no Gmail mailbox; could not act as that user; could not read it (rate limited, try again).
   The plan writes nothing, in Gmail or in the database. It is capped at 1,000 people (use a department or a person list for more).
2. **Confirm.** The admin ticks "I have read the plan" and presses the button whose text is the batch itself, for example **"Deploy to 37 people, replacing 12 existing signatures"**. `POST /api/deploy/gmail/deploy` re-plans from scratch and creates the deployment only if the new plan has the *same fingerprint* and counts. The fingerprint covers the organization, every person, what happens to them, which approved version, the hash of the new signature and the hash of the signature Gmail holds now. So any change since the review (a new approval, a directory edit, a person editing their own Gmail signature) means a refusal ("Nothing was written. Review the new plan"). The request carries person ids only; e-mail addresses come from the directory inside the database function, and a person from another organization is refused there.
3. **Run.** `POST /api/deploy/deployments/:id/run` works through the queue for about 25 seconds, 4 people at a time, then returns progress; the screen calls it again until done. State lives in the database, so closing the tab loses nothing: History shows "Resume". For every item, in this order:
   1. re-render the approved signature; refuse (skip) if its hash is no longer the confirmed one, or it is over the limit;
   2. read the live signature; refuse (skip, "left alone") if it is not what the plan saw (someone changed it);
   3. **save the live signature as the backup**, then write;
   4. mark done. A crash between 3 and 4 is repaired on the next run (live equals new and the backup exists, so it completes without writing again).
   Errors never abort the batch. Rate limits (HTTP 429) are retried with exponential backoff and jitter (4 tries); if Google keeps limiting, the item is handed back to the queue (not failed) and the screen waits 8 s; after 5 hand-backs it fails with a retryable error. A missing Workspace authorisation stops the run and says so.
4. **Retry.** "Retry the N that failed" puts only failed items back. Done and not-changed items are never touched again, so a second run is idempotent.
5. **Cancel.** Items not started are skipped; the one in flight finishes.
6. **Rollback.** "Roll back…" counts the items that were done and have a complete saved copy (copies over 10,000 characters are flagged truncated and are never restored), shows the number, needs a tick, and sends that number. The database refuses if the number is different now. The rollback is a new deployment (kind `rollback`) that writes the saved signatures back (an empty previous signature is restored as empty). A person who has changed their signature since the deployment is **left alone** ("changed since"). A deployment can be rolled back once, and only after it has finished.

**Tracked banners.** Gmail push is unchanged. Deployed signatures are rendered **plain** (no `tracking` option): click and image tracking in `lib/campaigns` is keyed to a saved `signatures` row and a signed token per signature, and directory people have none, so banners marked `track` render as ordinary links here.

### Database guarantees (migration 0010)

`deployments` and `deployment_items` have no insert, update or delete privilege for browser roles; only security-definer functions change them, and triggers enforce: items can only be for people named when the deployment was created (looked up in the directory of the same organization); the first saved previous signature never changes; an item cannot be marked done without that backup; `done` and `skipped` are final; one running deployment per organization and target; one rollback per deployment; finished deployments re-open only through "retry failed". Only org admins can read any of it. Tested against a real Postgres engine (PGlite), including a second organization.

## 2. Microsoft 365 / Exchange Online

**Why a script.** Microsoft has no API to set a user's Outlook signature, and Microsoft Graph cannot manage transport rules. The supported server-side route is a mail flow rule that appends HTML to outgoing mail ([1]). SignCraft turns your brand templates and rules into the PowerShell for it. It is labelled **"Generated, not run by SignCraft"** everywhere (on screen, in the script header, in the history).

### Using it

1. Team, Deploy, **Microsoft 365**. Choose the options (defaults are the safe ones) and **Generate script**. Read the plain-language "What this will do" list, the warnings and the "left out" list.
2. Copy or download `signcraft-exchange-rules.ps1`. Open it, read it.
3. In PowerShell: `Install-Module ExchangeOnlineManagement` if needed, then run the script (it calls `Connect-ExchangeOnline` itself; you sign in as someone who can manage mail flow rules, normally Organization Management).
4. The rules start in **Audit** mode: Exchange only logs what it would do. Check message trace, then regenerate with **Enforce** (or switch the rules in the Exchange admin center) once you are happy.
5. To undo everything: run `signcraft-exchange-remove.ps1`. It only touches rules whose name starts with `SignCraft - ` and asks before each removal.

### What the script contains

- One rule per active rule or implicit default (see rules below), in the evaluator's order, named `SignCraft - 01 ...`, created or updated (`Set-TransportRule` if it exists, `New-TransportRule` otherwise), so re-running is safe. Rules from an earlier run that are no longer part of the set are offered for removal with a confirmation.
- Every rule has `FromScope InOrganization`: only mail sent by people in your organization is touched, never mail you receive.
- `ApplyHtmlDisclaimerLocation Append`, and `ApplyHtmlDisclaimerFallbackAction` = your choice. **Default Ignore**: if Exchange cannot add the HTML (encrypted or signed mail) the mail still goes out unchanged, just without the signature. *Wrap* attaches the original to a new message (Microsoft says not to use it for incoming external mail [1]; these rules are outgoing only); *Reject* bounces the mail, which is rarely what you want.
- `Mode`: **Audit** by default. `Priority`: by default after every rule that already exists (`Get-TransportRule` count at run time, excluding SignCraft's own), so existing rules behave as before. Or a fixed starting number.
- `StopRuleProcessing $true`, so the first matching SignCraft rule wins. Because our rules sit last by default this only skips later SignCraft rules.
- The HTML is the real renderer's output for the template, with Exchange tokens in place of the person's data, written ASCII-only (non-ASCII characters become `&#NNN;` entities, so PowerShell 5.1 reads the file correctly) and in a verbatim here-string. The download has a UTF-8 byte-order mark too.

### Tokens, limits, images (from Microsoft's documentation)

Tokens used (sender's directory values, documented in [1]): `%%DisplayName%%` (full name), `%%FirstName%%`, `%%LastName%%`, `%%WindowsEmailAddress%%` (email), `%%Title%%`, `%%Department%%`, `%%Phone%%`, `%%MobilePhone%%`, `%%Office%%` (location). The documented list is: City, Company, CountryOrRegion, Department, DisplayName, Fax, FirstName, HomePhone, Initials, LastName, Manager, MobilePhone, Notes, Office, Pager, Phone, PostalCode, PostOfficeBox, StateOrProvince, StreetAddress, Title, UserPrincipalName, WindowsEmailAddress. (Note: the placeholders are `%%Phone%%` and `%%MobilePhone%%`, not PhoneNumber/MobileNumber; those are the names of the *conditions'* attributes.) A template field filled from a custom directory field has no token and is left out of the Exchange version, with a warning.

- **Size:** the disclaimer HTML is limited to **5,000 characters** ([2]). The generator measures the final HTML and refuses with a clear error above that; it warns within 300 characters of it. Whether Exchange counts the expanded values is not documented.
- **Images:** must be public **https** URLs (Exchange cannot embed files; `data:`, relative, http and private addresses are refused with an error). Recipients' mail clients must be able to load them.
- **Empty directory values:** the token becomes empty text, so a person without a phone gets an empty phone line. There is no per-person conditional.
- **Outlook's own signature:** people who also have a signature in Outlook get both; the rule appends after it.
- The rule text sits at the end of the message. In a reply, Exchange appends to the end of the whole thread unless you use "new messages only" (see rules).

### Directory export helper (read-only)

A second script, `signcraft-export-people.ps1`, runs `Get-User` and writes `signcraft-people.csv` with the headers the existing CSV import maps automatically (Email, Full name, First name, Last name, Job title, Department, Phone, Mobile, Location, Status). It only reads. Upload the file under Team, Import. Check the CSV first. (Untested: the property names follow `Get-User`'s output but the Microsoft page lists no property table.)

## 3. Rules

A rule: **message kind** (any, new, reply, forward), **audience** (any, internal, external), **departments** (empty = anyone), **priority** (0 to 1000, higher wins), **template**, on/off. Stored in `signature_rules` (org admins only; the template must belong to the same organization).

**Evaluation** (`lib/rules/evaluate.ts`, pure, 21 unit tests): the rules that match the context win in this order: higher priority, then more specific (more constrained dimensions), then older, then smaller id. Departments are compared case-insensitively and exactly (so "Sales" does not match "Sales Europe"); a person with no department never matches a department rule. **Default:** brand templates add implicit rules below every explicit rule: a template with departments applies to those departments, and the oldest template without departments is the default (the same order `template_for_person` uses in the database). No rule and no template means no winner (reported, not guessed).

**What each target can honour, honestly:**

| Dimension | Gmail | Microsoft 365 script |
|---|---|---|
| Department | **Followed** (decides which template a person gets) | **Followed**: `SenderADAttributeMatchesPatterns "Department:^Sales$"` (exact, anchored, escaped) |
| Internal / external | **Not applicable.** Gmail keeps one signature per address, whatever the message is. The rule is shown "not applied" and the person gets the default | **Followed**: `SentToScope InOrganization / NotInOrganization` |
| New vs reply | Not applicable | **Included, UNVERIFIED**: reply = `HeaderMatchesMessageHeader 'In-Reply-To'` with pattern `.+`; new = the same as an `ExceptIf`. Depends on the mail client setting In-Reply-To on replies and on how Exchange evaluates a header-exists test |
| Forward | Not applicable | **Not expressible**: no reliable condition. The rule is left out of the script and listed under "Left out" |

For Gmail, a person is also skipped with "template mismatch" when explicit rules exist and the rules choose a different template than the one their approved signature was made from (so a rule can never push unapproved content). With no explicit rules, the approved version is deployed as it is.

The **Test it** panel picks a person, a message kind and an audience and shows the winning rule and template, and separately what Gmail and the Exchange script would really use (with "cannot follow this rule" and "unverified" notes).

## Routes (all need the `team_deploy` flag and the admin role; writes need a same-origin request)

| Route | Purpose |
|---|---|
| `GET /api/deploy/status` | Is Gmail deployment set up, client ID, scope, the steps |
| `POST /api/deploy/gmail/plan` | Dry run |
| `POST /api/deploy/gmail/deploy` | Confirm (body needs `confirmed: true`, the fingerprint and counts) |
| `GET /api/deploy/deployments`, `GET /api/deploy/deployments/:id` | History and per-person results (no signature bodies) |
| `POST /api/deploy/deployments/:id/run`, `/retry`, `/cancel`, `/rollback` | Work the queue, retry failed, cancel, roll back (`{expected, confirmed: true}`) |
| `POST /api/deploy/exchange/script`, `GET /api/deploy/exchange/helper` | Generate the scripts (nothing is sent to Microsoft) |
| `GET/POST /api/deploy/rules`, `PATCH/DELETE /api/deploy/rules/:id`, `POST /api/deploy/rules/test` | Rules |

Environment: `GOOGLE_SERVICE_ACCOUNT_JSON` (server only, optional; without it the Gmail tab, plan, confirm and run answer 503 with the steps; Exchange and rules still work).

## What is unverified (needs a real tenant)

Gmail: that the delegated token works for your domain; that `sendAs.get/patch` with `gmail.settings.basic` behaves as the fake does; **whether Gmail returns the stored HTML unchanged** (it may sanitise or re-format it, in which case "already up to date" under-detects and a crash-recovery re-run may report "changed since the plan" instead of finishing; both are safe, they just skip); the Admin console wording and propagation time; real rate-limit behaviour; aliases (only the primary address is touched).

Exchange: the whole script against a tenant; the `Mode` values (Audit, AuditAndNotify, Enforce), `Priority` and `StopRuleProcessing` semantics (taken from the cmdlet's parameter set, the pages' descriptions were not all read); that tokens work inside HTML attributes (`href`, `mailto:`); the In-Reply-To new/reply test; how a message to both inside and outside recipients is split between rules; the duplicate-guard exception (`ExceptIfSubjectOrBodyContainsWords` is a whole-word match against subject and body); whether the 5,000 character limit counts expanded token values; the `Get-User` property names in the export helper.

Sources (read for this build; re-check before relying on a detail):
- [1] https://learn.microsoft.com/exchange/security-and-compliance/mail-flow-rules/disclaimers-signatures-footers-or-headers (tokens, fallback options, test advice, duplicate tip)
- [2] https://learn.microsoft.com/powershell/module/exchangepowershell/new-transportrule (5,000 character limit, Append/Prepend, fallback values, 1,024 character comments)
- [3] https://learn.microsoft.com/exchange/security-and-compliance/mail-flow-rules/conditions-and-exceptions (FromScope, SentToScope, sender AD attribute and header conditions, the attribute list)

## Verification steps for the owner

1. Apply migration 0010. As an admin with `team_deploy`, open `/team/deploy`: the Gmail tab must show the setup list when `GOOGLE_SERVICE_ACCOUNT_JSON` is unset.
2. Do the Workspace setup above with a **test organizational unit or two test users first**. Put those two users in the directory with their real addresses, give each an approved signature (sign in as them, `/team/mine`).
3. Make a plan scoped by department. Check each line (set/replace/skipped and reasons). Give one test user a hand-made signature in Gmail settings and re-plan: it must show "Will replace".
4. Confirm. After it finishes, open Gmail's settings for the test users and compare the signature, also an e-mail sent from each. Check Gmail did not alter the HTML noticeably, and re-plan: both should now be "Already up to date" (if not, Gmail re-formats the HTML: tell the developer).
5. While a deployment runs, edit one test user's signature in Gmail: that person must be reported "left alone".
6. Roll the deployment back and confirm the hand-made signature is restored exactly.
7. Remove the delegation or the scope in the Admin console and make a plan: it must show the "not authorised" blocker.
8. Exchange: generate the script in Audit mode, read it, run it in a **test tenant** (or with `-WhatIf`-style caution in production), send test mail inside and outside, check message trace for what would have happened, then Enforce on a test rule (restrict with a department) and check the real mail, including replies, a message to both inside and outside recipients, an encrypted message (fallback), and the image loading. Finally run the removal script.
9. Rules: create a department rule, use "Test it", deploy to Gmail and check the right template reaches the right test user.

## Known limits

- Gmail: primary address only, no aliases; one signature per address; up to 1,000 people per plan; a person without a Gmail mailbox or without an approved version is skipped.
- Someone without an account cannot have an approved version (versions are created by the person through `/team/mine`), so they are skipped as "no approved signature" until an approval path for account-less people exists.
- The run is driven by the open screen (a batch per request, resumable from History); there is no background scheduler.
- Exchange: forwards cannot be expressed; custom directory fields have no token; no per-person conditionals.
