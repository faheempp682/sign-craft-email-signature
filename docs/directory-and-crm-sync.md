# Directory sync (Google Workspace, Microsoft 365) and CRM sync (HubSpot, generic REST)

Migration: `supabase/migrations/0011_directory_crm_sync.sql` (needs 0003, 0006 and 0009; independent of 0010 and 0013). Screen: `/team/sync` (admins; flags `directory_sync` for Google and Microsoft, `crm_sync` for HubSpot and the generic CRM). Code: `lib/sync/*`, `app/api/sync/*`, `app/(app)/team/sync/*`. It builds on the people directory in [team.md](team.md) and the domain-wide-delegation helper `lib/google-dwd/token.ts`.

**Status: built, NOT verified against the real services.** Everything that talks to Google, Microsoft, HubSpot or a CRM was written from the vendors' documentation (cited in the code comments) and tested against fakes that follow the documented response shapes. Nobody has run it with real credentials. The owner steps and a verification checklist are at the end of this file.

## What it does

1. **Preview.** Fetch the source, map it, compare it with the people table, and show N to create, M to update (with each changed field, old value and new value), K to deactivate, and how many are unchanged or skipped. The people table is not touched. The preview itself is stored (table `sync_previews`) so the confirm step applies exactly what the admin saw; a preview is valid for 24 hours and a newer preview for the same source replaces it.
2. **Confirm.** One database function (`apply_sync_preview`) applies the stored preview in one transaction, then records a `people_imports` row and a `sync_runs` history row. If anything fails, nothing is applied.
3. **Never hard-delete.** People missing from the source are set to `inactive`. Only people whose `source` is that same source (Google people for a Google sync, and so on) are ever deactivated; hand-added and CSV people are never touched.
4. **Safety cap.** A run is refused (with the reason shown) when it would deactivate more than a configurable share of the people the source manages (default 20 percent, setting 1 to 100), or when the source returned no users at all. For a CRM run the same cap counts people who would lose a value. The rule is enforced inside the database function, so the API, the cron path and a direct call all obey it. There is no "force" switch: raising the cap in Settings is the deliberate way to allow a larger run.
5. **Unattended runs.** `POST /api/sync/run` (below). It applies only when the organization turned on auto-apply for that source and the cap passes; otherwise it leaves a pending preview for an admin.

## Who wins per field (the rule)

Each field has a setting, stored per source in `sync_sources.field_policy`:

| Setting | Meaning |
|---|---|
| **Source wins** (`source`) | the sync overwrites the directory value whenever the source has a value |
| **SignCraft wins** (`directory`) | the sync only fills a field that is empty; anything typed by hand stays |

And one more option per source, **"Let an empty value erase what is in the directory"** (`allow_blank_overwrite`, default off): an empty value from the source never removes a directory value, unless this is ticked AND the field's setting is "source wins". The full name can never be blanked. Defaults: directory sources start as "source wins" for every field, CRM mappings start as "SignCraft wins" (fill empty only) so a CRM never overwrites by accident. The mapping screen says it in words for every row ("jobtitle overwrites the people field Job title" or "phone fills the people field Phone, only when it is empty").

The `status` field follows the account: a suspended or disabled account becomes inactive, an account that is enabled again becomes active again, and a person missing from the source becomes inactive. Setting `status` to "SignCraft wins" turns all automatic activation and deactivation off.

Matching: first by the source's id (`people.source` + `external_id`), then by email. A hand-added or CSV person without an external id is linked to the source the first time the email matches (the diff shows "Linked source"), after which they are managed by it. If an account keeps its id but gets a new address, the address follows, unless another person already has it (then the address is left alone and a note says so). Disabled accounts that were never in the directory are not added. Two source accounts with one email: only the first is used.

## Google Workspace

Admin SDK Directory API `users.list` ([reference](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/list), [User resource](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users)), `customer=my_customer`, 500 per page, `nextPageToken` until it is absent, `projection=basic`, `viewType=admin_view`. Auth: the service account in `GOOGLE_SERVICE_ACCOUNT_JSON` acts as the admin in `GOOGLE_DIRECTORY_ADMIN_EMAIL` with the scope `https://www.googleapis.com/auth/admin.directory.user.readonly`, through the shared `lib/google-dwd` helper.

Mapping: `name.fullName/givenName/familyName`; `primaryEmail`; `id` is the external id; title and department from the primary entry of `organizations`; phone from `phones` of type `work` (else `main`); mobile from type `mobile` (else `work_mobile`) (home and other numbers are never used on a company signature); location from the primary `organizations[].location`, else `locations[0]` as "building, floor N"; `suspended` or `archived` means inactive.

## Microsoft 365

Microsoft Graph `GET /v1.0/users?$select=...&$top=999` with `@odata.nextLink` paging ([reference](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0)), token from the client-credentials flow ([reference](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow)): `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` with scope `https://graph.microsoft.com/.default`. `MS_TENANT_ID` must be a GUID or a domain name (never `common`, slashes or other characters); every next-page link is checked to be `https://graph.microsoft.com/v1.0/users...` before it is followed.

Mapping: `displayName`, `givenName`, `surname`, `mail` (accounts without a mailbox address are skipped with a note), `jobTitle`, `department`, `businessPhones[0]`, `mobilePhone`, `officeLocation`, `accountEnabled=false` means inactive, guests (`userType=Guest`) are skipped. The `id` is the external id.

Limits for both: 5,000 users per run. A bigger directory is refused, never truncated (a partial list would deactivate people). A failed page fails the whole fetch.

## CRM sync

CRM sync fills fields of people who are **already in the directory**, matched by email. It never creates or deactivates people (the database refuses a CRM preview that tries).

**HubSpot** (`HUBSPOT_ACCESS_TOKEN`, a private app token): contacts batch read `POST https://api.hubapi.com/crm/v3/objects/contacts/batch/read` with `idProperty: "email"`, 100 emails per call ([reference](https://developers.hubspot.com/docs/api/crm/contacts)); owners `GET /crm/v3/owners` ([reference](https://developers.hubspot.com/docs/api/crm/owners)), only when `owner_name` or `owner_email` is mapped (resolved from the contact's `hubspot_owner_id`). The admin maps HubSpot internal property names (`phone`, `mobilephone`, `jobtitle`, or any custom property) onto people fields or `custom.<key>` (up to 10 custom fields per person). A contact is found by its primary email only.

**Generic REST adapter** (the "Kimp CRM", API unknown to us). The admin configures:
- **Base URL** (https, no port, no credentials, no query), **path** with `{email}` (for example `/contacts?email={email}`; the email is URL-encoded), **auth header name** (for example `Authorization` or `X-Api-Key`) and an optional **text before the secret** (for example `Bearer `).
- The **secret** is read from `KIMP_CRM_SECRET` in the server environment. It is never stored in the database or sent to the browser, and no error message contains it.
- **Mapping**: a JSON path per people field. Paths are `$.data.phone`, `data.items[0].title` or `$.fields["job-title"]` (no wildcards or filters; own properties only).
- A missing path leaves the field alone (a typo in the mapping can never erase anything); an empty or null value is "empty"; a value longer than the field allows is ignored with a note.
- **Test button**: fetches ONE record for an email the admin types, using the mapping on screen (saved or not), and lists exactly which value would fill which field, plus the paths found in the answer (values cut to 40 characters). It writes nothing.

SSRF protection for the adapter (`lib/sync/safe-fetch.ts`, same approach as `lib/render/safe-image.ts`, using `lib/ai/net-guard.ts`): https only on the default port; no `localhost`, `.local`, `.internal` or IP-with-credentials URLs; the host is resolved and EVERY address must be public (IPv4 and IPv6 ranges, including mapped and NAT64 forms); the connection is pinned to the address that was checked (DNS rebinding cannot swap it); a redirect is followed only to the same host, at most twice, and every hop is checked again (a different host is refused because the secret header would be sent to it); 8 second and 1 MB limits; JSON answers only. Up to 4 people are looked up in parallel and the run stops after about 4 minutes (the rest is noted as not looked up).

## Unattended runs

`POST /api/sync/run` with header `Authorization: Bearer <SYNC_CRON_SECRET>` and optional JSON `{ "org_id": "...", "source": "google" }`.

- The secret is compared in constant time (both sides are SHA-256 hashed, then `timingSafeEqual`). Without `SYNC_CRON_SECRET` set to at least 32 characters the endpoint answers 503 ("off"); a wrong or missing header is 401. There is no cookie or browser use.
- It needs `SUPABASE_SERVICE_ROLE_KEY` and calls the `*_service` database functions, which only the service role may execute. For each source with `enabled = true` of every organization whose feature flag (`directory_sync` / `crm_sync`) is on at organization level (per-user flag overrides cannot apply without a user) it computes a preview, then applies only if `auto_apply` is on and the cap passes. Otherwise the preview stays pending (history says "Preview computed", or "Refused by the safety rules" with the reason).
- The answer lists organization ids, sources and outcomes, never names or emails.
- SignCraft does not schedule itself. Call it from cron, a GitHub Actions schedule, or your host's cron, for example nightly: `curl -X POST -H "Authorization: Bearer $SYNC_CRON_SECRET" https://your-app/api/sync/run`. The path must be reachable without a browser session: it has to be listed in `lib/public-routes.ts` (an integration request, see the report).

## Database (0011)

| Table | Purpose | Access |
|---|---|---|
| `sync_settings` | per organization: `safety_cap_percent`, `schedule_note` | org admins read and write |
| `sync_sources` | per organization and source: `enabled`, `auto_apply`, `allow_blank_overwrite`, `field_policy`, `config` (mapping, base URL, path; no secrets) | org admins read and write |
| `sync_previews` | the stored diff (`plan`), `fetched_count`, `stats`, `status` pending/applied/superseded, `expires_at` (24 h) | org admins read; written only by the functions |
| `sync_runs` | append-only history: previewed, applied, blocked, failed, with stats and notes | org admins read; written only by the functions; a trigger refuses updates |

Functions (`security definer`, `set search_path = ''`): `save_sync_preview`, `apply_sync_preview`, `log_sync_event` (signed-in org admins) and `save_sync_preview_service`, `apply_sync_preview_service`, `log_sync_event_service`, `sync_feature_on` (service role only). They share internal implementations that no browser role can execute. The apply function takes a lock per organization and source, re-checks status, expiry, "source returned something" and the cap, applies creates, updates and deactivations only for rows of the preview's own organization (and, for deactivations, own source), writes `people_imports` (source `google`, `microsoft` or `crm`) and a `sync_runs` row. As documented in `0009_team_core.sql`, directory jobs running as the service role cannot use `import_people` (it needs an admin session), which is why the service path has its own function.

## Environment variables

| Variable | Used for |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the Workspace service account key (JSON, or the JSON base64-encoded); shared with other domain-wide-delegation features |
| `GOOGLE_DIRECTORY_ADMIN_EMAIL` | the Workspace admin the service account acts as for the directory read |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | the Azure app registration (client credentials) |
| `HUBSPOT_ACCESS_TOKEN` | HubSpot private app token |
| `KIMP_CRM_SECRET` | the secret for the generic CRM adapter |
| `SYNC_CRON_SECRET` | secret for `POST /api/sync/run` (at least 32 random characters) |
| `SUPABASE_SERVICE_ROLE_KEY` | already used elsewhere; needed by the cron endpoint |

The Sources tab lists which of these a source is still missing (names only, never values).

## Owner setup and verification

### Google Workspace
1. Google Cloud console: create (or reuse) a project, enable the **Admin SDK API**, create a **service account** and a JSON key. Put the key in `GOOGLE_SERVICE_ACCOUNT_JSON`.
2. Admin console, Security, Access and data control, API controls, **Domain-wide delegation**, Add new: the service account's numeric **client ID** with the scope `https://www.googleapis.com/auth/admin.directory.user.readonly` (add it to the existing entry if the service account already has other scopes).
3. Set `GOOGLE_DIRECTORY_ADMIN_EMAIL` to a super administrator (or a user with a role that can read users).
4. Verify: Sources tab shows "Connection set up", Run a preview. Expected errors and meaning: "has not been given domain-wide delegation" (step 2 missing or wrong client ID or scope), "Admin SDK API is not enabled" (step 1), "must be a super administrator" (step 3). Check that the number of users read matches the Admin console, that suspended users show as inactive, and that a person's phone and title match.

### Microsoft 365
1. Entra admin center, App registrations, **New registration** (single tenant). Copy the Application (client) ID and the Directory (tenant) ID.
2. API permissions, Add, Microsoft Graph, **Application permissions**, `User.Read.All`, then **Grant admin consent**.
3. Certificates and secrets, new client secret, copy the **Value** (not the ID). Set `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`. Secrets expire: put the expiry date in your calendar.
4. Verify as above. "rejected the client id or secret (AADSTS7000215)" means a wrong or expired secret; "refused to list users" means step 2's consent is missing.

### HubSpot
1. HubSpot, Settings, Integrations, **Private Apps**, create one with scopes `crm.objects.contacts.read` and (only if you map `owner_name` or `owner_email`) `crm.objects.owners.read`. Copy the token into `HUBSPOT_ACCESS_TOKEN`.
2. In the Rules and mapping tab choose HubSpot, add mappings (internal property names; find them under Settings, Properties), choose who wins, tick "Switch on", Save. Use **Test with one person** with an employee's email before running a preview.

### Generic REST CRM (Kimp CRM)
1. Ask the CRM team for: a read-only API credential, how to send it (header name and scheme), the URL that returns one person by email, and a sample answer.
2. Set `KIMP_CRM_SECRET`. In Rules and mapping choose the Kimp CRM, fill base URL, path (with `{email}`), header name and prefix, add mappings with JSON paths. Press **Test with one person**: the table shows what each path found, and the list of paths helps correct a mapping. The CRM host must be on the public internet over https; an internal CRM address is deliberately refused (see SSRF protection above), so reach it through a public API gateway.

### Cron
Set `SYNC_CRON_SECRET` (for example `openssl rand -hex 32`), make `/api/sync/run` reachable (integration request), call it from a scheduler, and keep auto-apply off at first: the next day the Review tab shows what the run found. Turn auto-apply on per source only after a few clean previews.

### Database and flags
Apply migration 0011. Turn on `directory_sync` and `crm_sync` for the organization (Admin, feature flags). Verify the safety rules once on purpose: lower the cap to 1 percent in Settings and see a preview that deactivates anybody refused; then restore it.

## Known gaps

- Single run size 5,000 users, one directory domain per Workspace customer (`my_customer`), no organizational-unit filter, no exclusion list (room and shared-mailbox accounts with a mailbox address appear in the preview; skip them by marking "SignCraft wins" for status, or deactivate once by hand).
- HubSpot contacts are matched by primary email only. No HubSpot meeting-links API (use a contact or owner property that holds the link).
- The unattended path honours organization-level feature flags only.
- Previews hold personal data (names, emails, phone numbers) in `sync_previews.plan` and, because applied and superseded previews stay in the table as an audit trail, for as long as the row exists; there is no purge job.
