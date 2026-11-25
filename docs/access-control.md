# Access control, feature flags and AI limits

Phase 2 foundation. Everything here is enforced on the server (API routes and the database), not just hidden in the UI.

## Setup (once per Supabase project)

1. Run the migrations in order in the Supabase SQL editor (or `supabase db push`): `0001_init.sql`, `0002_asset_metadata.sql`, `0003_access_control.sql`, then every later one (including `0017_invite_only.sql` and `0018_protect_last_platform_admin.sql`).
   `0003` creates the tables, seeds the default organization ("Kimp"), the feature flags and the AI limits, and gives every existing user a profile and a Member role.
2. In `.env.local` (never in `.env.example`):
   - `ADMIN_EMAILS=you@company.com` (comma-separated). These people become admins the first time they use the app.
   - `SUPABASE_SERVICE_ROLE_KEY=...` (Project Settings > API > `service_role`). **Server only, never prefix with `NEXT_PUBLIC_`.** It is used for two things: promoting the `ADMIN_EMAILS` people (which cannot be done as the user themselves), and storing the encrypted Google tokens for Gmail push ([docs/gmail-push.md](gmail-push.md)).
3. Keep **email confirmation switched on** in Supabase (Auth settings). Only a *confirmed* email is promoted, so this is what stops a stranger from signing up with an admin's address first.
4. Sign in with an `ADMIN_EMAILS` account. An **Admin** link appears in the sidebar.

No service-role key? Promote the first admin by hand instead, in the SQL editor:

```sql
update public.memberships set role = 'admin'
 where user_id = (select id from auth.users where email = 'you@company.com');
```

## Sign-up is by invitation only

Nobody can create an account unless an admin has invited their email address first (migration `0017_invite_only.sql`).

- **Enforced in the database.** A trigger on `auth.users` refuses any address without an open invitation. Supabase's sign-up endpoint is public (it only needs the browser-safe key), so a check in our own form alone could be skipped by calling it directly. The trigger cannot be skipped.
- **How to invite:** an admin opens **/admin/invitations**, adds the email and the role. The person opens the login page, chooses "Invited? Create your account", and sets a password. Supabase emails a confirmation link, so only the owner of the inbox can use the invitation. They arrive with the invited role in the default organization.
- An invitation works once. Withdraw an unused one on the same page.
- **The first admin** has nobody to invite them. Once, in the SQL editor: `insert into public.invitations (email, role) values ('you@company.com', 'admin');` then sign up on the login page like anyone else (people who already have an account need nothing).
- Accounts added from the Supabase dashboard ("Add user" / "Invite user") or the admin API go through the same trigger, so add the invitation first or they are refused.
- Keep **email confirmation on**. With it off, anyone could claim an invited address before its owner does.
- `ALLOWED_EMAIL_DOMAINS` still works as an extra restriction in the sign-up form (invitations for other domains would be refused there).

## Production without Supabase fails closed

With no Supabase variables the app is a login-free, local-only editor. That is for a developer's machine. When `NODE_ENV=production` the private pages and APIs answer **503** until `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set, so a missing or misspelled variable can never publish the app without a login. A deployment that really wants the login-free editor sets `ALLOW_LOCAL_MODE=true`.

## Roles

`member` < `designer` < `admin`. A person's role is the highest across their memberships. New sign-ups join the default organization as members.

| | Member | Designer | Admin |
|---|---|---|---|
| Templates, editor, export | yes | yes | yes |
| AI | limited | higher | unlimited (by default) |
| Custom HTML | no | yes | yes |
| Analytics, team deploy | no | no | yes |
| Admin screens | no | no | yes |

These are the seeded defaults. Admins change them on `/admin`.

The last admin cannot be demoted or removed (the database refuses). People in `ADMIN_EMAILS` are always admins; remove them from the setting first to demote them.

## Feature flags

A feature is available to a person when, in this order:

1. they have a **personal exception** (on or off), else
2. their **organization** has an exception (if they are in several, any "off" wins), else
3. the flag is **on by default** *and* their role is at least the flag's **minimum role**.

Features: `ai_autofill`, `ai_design`, `ai_vision`, `gmail_push`, `animated_gif` (off by default), `custom_html`, `designer_polish`, `analytics`, `team_deploy`.

**Behaviour change:** uploading an animated GIF now needs `animated_gif`, which is off by default. Turn it on for everyone (Features tab) or for one client (add an exception).

To add a feature: add it to `FEATURES` in `lib/authz/roles.ts`, insert a row into `feature_flags` in a new migration, and guard the route with `requireFeature("name")`. A test fails if the two lists drift apart.

## AI limits

Per person, per role, per AI feature: a per-minute and a per-day limit, edited on **AI limits**. Blank means no limit, `0` blocks the feature. A role with no row uses the Member row. Changes apply on the next request.

How it works: every AI route calls `openAiGate()` (`lib/authz/ai-gate.ts`), which calls the database function `consume_ai_quota`. That checks the flag and both limits and records the use in **one atomic step**, so parallel requests cannot slip past a limit. Token counts are stored afterwards; a call that never reached the model is refunded, and so is a repeat answered from cache. Users cannot write usage rows directly.

It fails closed: if the check cannot run (for example migration `0003` was not applied), AI requests get a 503, never a free pass.

Without Supabase configured at all (local draft mode) there are no accounts, so AI falls back to simple in-memory limits per IP. This is never used when Supabase is configured.

## Using it in code

```ts
const g = await requireUser();              // 401 / 503
const g = await requireRole("admin");       // 403 unless admin
const g = await requireFeature("gmail_push"); // 403 if switched off for this person
const gate = await openAiGate("ai_design", req); // sign-in + flag + limits for AI routes
```

Routes do not do their own auth checks. Admin writes go through `adminRequest()` (`lib/admin/route.ts`), which also rejects cross-site requests.

## Tests

- `e2e/auth.e2e.mjs` signs up, confirms, signs in and out and checks route protection in a real browser against the real Supabase project. Part 1 (logged-out access, wrong password) needs nothing else. Part 2 creates real accounts and cleans up after itself, so it needs `SUPABASE_SERVICE_ROLE_KEY` and `E2E_EMAIL_BASE` (an inbox you own) and migrations `0017` and `0018` applied. Run it with `E2E_BASE_URL=http://localhost:3100 node --test e2e/auth.e2e.mjs`.
- `lib/authz/invite-only.db.test.ts`, `last-platform-admin.db.test.ts` and `rls-coverage.db.test.ts` (every table has row-level security, every definer function pins its search path and is closed to signed-out callers).
- `lib/authz/db.test.ts` runs the real migrations in an in-process Postgres (PGlite) and tests the actual RLS policies and SQL functions: roles, flag resolution, limits, windows, refunds, last-admin protection.
- `lib/authz/authz.test.ts`, `app/api/**/*.test.ts`: guards, bootstrap, route enforcement, admin API validation.
- `app/(app)/admin/admin-ui.test.tsx`: the admin screens (jsdom).

**Not covered by automated tests:** behaviour against a live Supabase project (PostgREST, real auth cookies, the `auth.users` trigger on a hosted project) and true concurrent requests (PGlite is single-connection; the advisory lock is in the SQL but not stress-tested). Check these once on your project after applying the migration.
