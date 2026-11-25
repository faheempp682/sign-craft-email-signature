# Team foundation: people, brand lock, approvals, CSV import

Migration: `supabase/migrations/0009_team_core.sql` (needs 0003 to 0007; does not depend on 0008). Screens: `/team` (admins, flag `team_deploy`) and `/team/mine` (any signed-in member). Code: `lib/team/*`, `app/api/team/*`, `app/(app)/team/*`. Later work builds on these tables: H2 (deploy, rules, health monitor) and H3 (Google/Microsoft directory sync, CRM sync).

## Data model

| Table | What it holds | Who can read | Who can write |
|---|---|---|---|
| `org_settings` (`org_id`, `require_approval`) | One row per organization, created on first save. No row means approval is off. | members of the organization | org admins |
| `people` | The directory. `email` (stored trimmed and lower case), `full_name`, `first_name`, `last_name`, `title`, `department`, `phone`, `mobile`, `location`, `custom` (jsonb, up to 10 key/value pairs of text), `source` (`manual` `csv` `google` `microsoft` `crm`), `external_id`, `status` (`active` `inactive`), `user_id` (nullable link to an account). Unique on (`org_id`, `email`) and on (`org_id`, `source`, `external_id`) when there is an external id. | org admins; a member reads only the row linked to them | org admins |
| `brand_templates` | `doc_json` (a SignatureDoc), `lock_json` (`{"editable": ["1.title", ...]}`), `field_map` (`{"1.name": "full_name", ...}`), `departments` (text[]; empty means everyone), `is_active`. | org admins; a member reads only the ONE template that applies to them | org admins |
| `signature_versions` | History of every submission: `person_id`, `template_id`, `template_snapshot` (copy of doc, lock and map taken inside the database), `values_json` (the employee's overrides), `version_no`, `status` (`draft` `pending` `approved` `rejected`), `submitted_by`, `reviewed_by`, `reviewed_at`, `review_note`. | org admins; the person it belongs to | nobody directly (functions only) |
| `people_imports` | One row per import: filename, source, total, created, updated, skipped. | org admins | `import_people()` only |
| `signatures.org_id` (new nullable column) | Tags a saved signature with an organization. | owner (as before) plus admins of that organization (read only) | owner |

People do not need an account. `user_id` is filled when a member opens `/team/mine`: the database function `claim_my_person(org)` links the directory entry whose email equals the signed-in account's email (profile email, which only changes once Supabase has confirmed it; keep email confirmation switched on, see [access-control.md](access-control.md)). A trigger refuses a `user_id` that is not a member of the same organization.

### Field keys

Brand-lock keys are `"<blockIndex>.<field>"`, for example `1.title` is the `title` of block 1 of the template's document. Only plain text fields can ever be unlocked (identity name, title, company; contact phone, email, website, address; photo and banner alt text; the disclaimer text). Images, links, shapes, colours, fonts, social links and the layout can never be unlocked. `field_map` values are `full_name`, `first_name`, `last_name`, `email`, `title`, `department`, `phone`, `mobile`, `location` or `custom.<key>`.

If an admin replaces a template's document, check the lock and map afterwards: indexes refer to the document's block order. The API revalidates every key against the stored document on each change.

### What an employee's signature is made of

`lib/team/render.ts` builds the document for one person: the template's document, then for each editable text field (1) the employee's value, else (2) the directory value the field is mapped to, else (3) the template's own text. A mapped field with an empty directory value is removed (so an example phone number in the design never ends up in a real signature); an empty required name is an error. The result is validated with `SignatureDocSchema` and rendered with the real renderer (`renderToEmailHtml`). HTML never travels from the browser: the server rebuilds the document from the stored template, the directory entry and plain text values.

`lib/team/brand-lock.ts` is the policy: `checkValues(spec, values)` (only unlocked keys, strings, field length, no control characters or line breaks) and `checkEditedDoc(spec, person, editedDoc, currentValues)` (an edited document may differ from what the template produces only in unlocked fields). The editor is not changed here; see "Integration" below.

## Where each rule is enforced

| Rule | Server (TypeScript) | Database |
|---|---|---|
| Employee may change only unlocked fields | `POST /api/team/mine` rebuilds the document and rejects locked keys with 400 | `submit_signature()` raises `TM003` for a key not in the template's `editable` list, so a crafted request through PostgREST fails too |
| Values are text, short, single line | `checkValues` | `submit_signature()` checks type and length (1,500) |
| Nothing leaks across organizations | every query is scoped to the admin's organization | row-level security on every table; tested with two organizations |
| Status moves only forward | `POST /api/team/approvals/:id` | `signature_versions_guard` trigger: content columns never change; only pending to approved or rejected (and draft to pending) |
| Only org admins review, never their own, reject needs a reason, once only | route returns the mapped error | `review_signature()` (`TM005`, `TM006`, `TM007`) |
| One waiting change per person | 409 | partial unique index and `TM004` |
| History is append-only | no update or delete route | no insert, update or delete privilege for browser roles; trigger on update; versions are deleted only when the person is deleted (mark people inactive to keep history) |

## Approval workflow

Setting (`/team`, Settings): "Require approval for employee changes", default off.

- Off: a saved change becomes an `approved` version at once (`review_note` "Approved automatically.", no reviewer).
- On: the version is `pending`; the employee keeps their previous approved signature; admins see it in Approvals with the changed fields and a preview, then approve or reject (reason required). A rejected employee can submit again.
- An admin's own change is always approved at once (they are the reviewers), and an admin can never review their own submission.
- The version to deploy is the newest `approved` row per person: `select ... from signature_versions where person_id = $1 and status = 'approved' order by version_no desc limit 1`. Render it with `renderVersion({ template_snapshot, values_json }, person)` from `lib/team/render.ts`; it uses the template copy stored with the version and the person's CURRENT directory data (so directory updates, for example a new job title, flow through without a new approval).

## CSV import

Admin tab Import, `POST /api/team/import` with `mode` `preview`, `dry-run` or `commit`; every step re-reads and re-validates the file text on the server.

- Limits: 2 MB, 5,000 people, 60 columns. Delimiter (comma, semicolon, tab) is detected; a byte-order mark is stripped; quoted fields with commas, doubled quotes and line breaks work (hand-written RFC 4180 reader, `lib/team/csv.ts`).
- Mapping: auto-guessed from header names (English synonyms such as "E-mail", "Surname", "Dept", "Cell"), editable per column; unmapped columns can become custom fields (max 10). An email column and a name (full name, or first and last) are required.
- Dry run checks every row (email format, lengths, status values, duplicates inside the file, who already exists) and lists row-level errors with spreadsheet row numbers (row 1 is the header). Nothing is written.
- Commit sends only valid rows to `import_people()`, one transaction: create or update by email, then an `people_imports` row. A file with errors is refused unless the admin ticks "skip rows with errors". Existing people keep their source and external id; a blank cell never erases a value; custom fields are merged; `status` is applied.
- Nothing in a file is ever fetched, executed or rendered as HTML; cell values are stored as text and escaped by the renderer.
- Export (`GET /api/team/people/export`): CSV with a byte-order mark. Cells that begin with `= + - @`, a tab or a carriage return get a leading apostrophe so spreadsheets do not run them as formulas. The importer removes that apostrophe again (`'=`, `'+`, `'-`, `'@` at the start), so an export re-imports cleanly. In a spreadsheet the apostrophe is hidden and the cell shows as text.

## Routes

| Route | Who | Notes |
|---|---|---|
| `GET/POST /api/team/people`, `PATCH/DELETE /api/team/people/:id`, `GET /api/team/people/export` | admin + `team_deploy` | search (`q`), `department`, `source`, `status`, paging, counts |
| `POST /api/team/import`, `GET /api/team/imports` | admin + `team_deploy` | see above |
| `GET/POST /api/team/templates`, `PATCH/DELETE /api/team/templates/:id`, `GET /api/team/signatures` | admin + `team_deploy` | create from a preset or a saved signature the admin can read |
| `GET /api/team/approvals?status=pending|approved|rejected|all`, `POST /api/team/approvals/:id` | admin + `team_deploy` | body `{decision, note}` |
| `GET/PUT /api/team/settings` | admin + `team_deploy` | `{require_approval}` |
| `GET/POST /api/team/mine` | any signed-in person | needs a directory entry and an applicable template; writes need a same-origin request |
| `/api/signatures` (existing) | owner | optional `org_id` (an organization the caller belongs to); the 100-signature quota now counts only the caller's own rows |

Writes always check `sameOrigin`; admin routes also check the feature and the role, and take the organization from the caller's own admin membership (a body `org_id` is honoured only if they administer it).

## For H2 and H3

- Directory sync (H3): write `people` with `source` (`google` or `microsoft` or `crm`) and `external_id`. The service role bypasses row-level security; lower-case the email (a trigger does it anyway). `people_org_external_idx` lets you match by external id. To record a sync run use `import_people(org, rows, source, filename)` only when called as an admin user; a service-role job should insert into `people_imports` directly.
- Deploy (H2): per person, take the newest approved version (above) and `renderVersion`. Only `status = 'active'` people. `signature_versions.template_snapshot` is a stable copy; `brand_templates` may change later.
- Rules by department can use `people.department` (indexed on lower case) and `brand_templates.departments`. `template_for_person(person)` returns the applicable template id (a department match beats "everyone", oldest first).

## Integration (not done here, files owned by others)

- Nav: link `/team` (admins with `team_deploy`) and `/team/mine` (everyone; the page explains when there is no entry or template yet).
- Editor: honour brand locks with `checkEditedDoc` from `lib/team/brand-lock.ts`, and send `org_id` when saving a signature that should be visible to the organization's admins.
- Existing pages that list `signatures` without an owner filter will now also return signatures tagged with an organization to that organization's admins (policy "signatures: org admin read"). Add `.eq("owner_id", user.id)` wherever "my signatures" are listed.

## Built, not verified against the real service

Tested with a real Postgres engine (PGlite) and mocked Supabase clients, and in a real browser with mocked APIs, but not against a live Supabase project. To verify: apply 0009; as an admin with `team_deploy` open `/team`, add yourself to the directory with your sign-in email, create a template, switch approval on, then sign in as a second account whose email is in the directory and open `/team/mine`, change the title, and approve it as the admin. Check that a crafted request cannot change a locked field: `select public.submit_signature('<org>', '{"1.company":"x"}')` as that user must fail with "locked by your brand template".

Known limits: one directory entry per account per organization; an employee in several organizations sees the first; there is no email notification for approvals; the template editor does not reorder blocks or edit the design (use the main editor, then "create from a saved signature"); the import does not deactivate people missing from a file.
