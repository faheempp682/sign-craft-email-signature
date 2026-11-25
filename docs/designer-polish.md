# Designer polish

"AI draft, Kimp designer polish." A person asks a Kimp designer to polish one of their saved signatures. The designer works on a **copy**, the person compares the two side by side and accepts or declines. Billing is out of scope: the paid add-on is simply an admin switching the `designer_polish` feature on for a person or organization.

Everything here is in migration `supabase/migrations/0008_designer_polish.sql` (apply it after 0003).

## Workflow

1. **Request.** Someone with the `designer_polish` feature presses **Request polish** on a saved signature and writes a note ("make the banner stand out"). The server copies the signature's document into the request (a snapshot) and records whether the draft was an AI draft or hand made. The origin is declared by the requester's screen; it is information for the designer, not something the system can prove.
2. **Queue and claim.** Designers and admins see the open requests on **Polish > Queue**. Claiming is atomic: the database locks the row, so exactly one designer wins and everyone else is told it was taken. A designer can give a request back (release), which returns it to the queue.
3. **Work on the copy.** **Open copy in the editor** writes the copy into the designer's own editor draft (`lib/editor/draft.ts`, browser storage) and opens `/editor?polish=<request id>`. The requester's saved signature is never opened, read or written by the designer.
4. **Deliver.** The designer delivers the polished document with a short change note, either from the editor banner (below) or from the request page (**Deliver my editor draft**, which previews the draft first).
5. **Review.** The requester sees the original and the polished version side by side, rendered by the real renderer (`lib/renderer/email-html.ts`), with the change note. They can:
   - **Accept as a new signature** (default; the original stays as it is), or
   - **Replace the original**, only after ticking an explicit confirmation (the database refuses otherwise), or
   - **Decline** with a reason, and choose to send it back to the queue (a new round) or close it.
6. Both sides can **comment** while the request is open. Requesters can **cancel** while it is open.

## Statuses

| Status | Meaning | Moves to |
|---|---|---|
| `requested` | Waiting in the queue | `in_progress` (claim), `cancelled` |
| `in_progress` | A designer holds it | `delivered`, `requested` (release), `cancelled` |
| `delivered` | Polished version ready to review | `accepted`, `requested` (declined and reopened), `declined` (declined and closed), `cancelled` |
| `accepted`, `declined`, `cancelled` | Final | nothing |

The table is enforced in the database by the trigger `polish_guard` (so even an update by the service role cannot skip a state or edit a finished request) and mirrored in `lib/polish/status.ts`; a test runs every pair of statuses against the database and fails if the two disagree.

## Permissions

| Who | Can |
|---|---|
| Requester (needs the `designer_polish` feature) | Create requests on their own saved signatures; see their own requests, comments and history; comment, cancel, accept, decline |
| Member without the feature | Read their own existing requests; cannot create new ones |
| Designer, admin | See the open queue and the requests they hold; claim, release, deliver, comment on requests they hold |
| Admin | Additionally release a request held by someone else (for a designer who is away). Admins do not see other people's requests beyond the queue and what they hold |

`designer_polish` is seeded with minimum role **designer**, so members cannot ask for polish until an admin enables the feature for them or their organization on `/admin/features` (a user or organization override). That is how the paid add-on will be granted later. Designers and admins have it by default and can always work the queue.

How it is enforced:

- The tables have **select policies only** and no insert/update/delete grants for `anon` or `authenticated`. Every write goes through a `security definer` function (`polish_create`, `polish_claim`, `polish_release`, `polish_deliver`, `polish_comment`, `polish_accept`, `polish_decline`, `polish_cancel`). Each function derives the caller from `auth.uid()` (there is no actor argument to forge), checks role, ownership and state, and writes an audit event.
- A stranger's request id behaves like a missing id (`not_found`), so ids reveal nothing.
- `polish_create` reads the document from the caller's own `signatures` row. The `signatures` table and its RLS are untouched; a designer cannot read or write any saved signature.
- The API (`app/api/polish/**`) adds `requireFeature` / `requireRole`, `sameOrigin` on writes, and zod validation (including the full signature schema on delivery).
- Limits: 5 open requests per person, one open request per saved signature, 300 comments per request, documents up to 200 KB.

## Audit

`polish_events` records every transition (requested, claimed, released, delivered, accepted, declined, reopened, cancelled) with the actor, the from and to status, a short detail (the change note, the decline reason, or the accept mode) and a timestamp. Comments carry their author, role and timestamp. Both tables are append-only (a trigger rejects update and delete, even for the service role). The history is shown on each request page to the requester and the holding designer.

## Privacy

- A designer sees the snapshot of a request only while it is in the queue or after claiming it, and keeps read access to requests they held. They never get access to the requester's other signatures, email address or account.
- The queue list shows only the signature name, origin, note and date; documents are loaded only on a request's own page.
- Deleting an account removes that person's requests, comments and history. Deleting a designer's account leaves the requests in place.
- A designer's working copy lives only in their own browser (editor draft) until they deliver it.

## Pages and API

| Path | Who |
|---|---|
| `/polish` | Everyone signed in: **My requests** |
| `/polish/queue` | Designers and admins (404 for others): working on, and waiting |
| `/polish/<id>` | The requester, any designer for a queued request, the holding designer |
| `GET /api/polish?scope=mine|queue|held` | `mine`: signed in. `queue`, `held`: designer or admin |
| `POST /api/polish` | `designer_polish` feature. `{ signatureId, note, origin: "ai"|"manual" }` |
| `GET /api/polish/status?signatureId=` | `designer_polish` feature; 403 hides the Request polish button |
| `GET /api/polish/<id>` | Participants (and designers for queued requests); documents are re-validated before they are returned |
| `POST /api/polish/<id>/claim`, `/release` | Designer or admin |
| `POST /api/polish/<id>/deliver` | Designer holding it. `{ doc, changeNote }` |
| `POST /api/polish/<id>/comments` | Requester or holding designer. `{ body }` |
| `POST /api/polish/<id>/accept` | Requester. `{ mode: "new", name? }` or `{ mode: "replace", confirmReplace: true }` |
| `POST /api/polish/<id>/decline` | Requester. `{ reason, reopen }` |
| `POST /api/polish/<id>/cancel` | Requester |

## Wiring it in (for the integrator)

1. **Nav.** Add a link to `/polish` (label "Polish"), visible to people who have the feature or are designers; a link to the queue appears automatically as a tab for designers.
2. **Request button.** `components/request-polish.tsx`: `<RequestPolish signatureId={saved.id} origin="manual" />` beside each saved signature (for example in `app/(app)/signatures/my-signatures.tsx`), and `origin="ai"` beside an AI result once it has been saved (it needs a saved signature id; with `signatureId={null}` it tells the person to save first). It renders nothing when the feature is off, so it can be placed unconditionally.
3. **Editor banner.** In the editor, read the `polish` search parameter (a UUID). When present, render above the editor:
   ```tsx
   import { PolishDeliverBanner } from "@/app/(app)/polish/deliver-banner";
   <PolishDeliverBanner requestId={polishId} doc={currentDocument} />
   ```
   `currentDocument` is the editor's current `SignatureDoc` (or `null` while it is not ready). The banner looks the request up, shows nothing useful unless the signed-in person is the designer holding it, asks for a change note, and calls `POST /api/polish/<id>/deliver` with `{ doc, changeNote }`. The editor restores the draft the request page staged, so no other editor change is needed.

## Not built

- **Email notifications.** There is no email service, so status is shown in the app only (My requests, Queue, the request page). Nobody is emailed when a request is claimed, delivered or commented on.
- **Billing.** The paid add-on is only the feature flag.
- Saving a designer's work-in-progress on the server (the working copy lives in the designer's browser until delivered), file attachments on comments, assigning a request to a named designer, and SLA timers.
- Real-concurrency testing of claims: the tests run on PGlite (a single connection), so they prove the outcome of back-to-back claims and the guards, while the race safety itself comes from the row lock (`select ... for update` in `polish_lock`).

## Setup

Apply `supabase/migrations/0008_designer_polish.sql` in the Supabase SQL editor (or `supabase db push`). No environment variables. To let a member request polish, enable `designer_polish` for them on `/admin/features`. To make someone a designer, set their role on `/admin/users`.
