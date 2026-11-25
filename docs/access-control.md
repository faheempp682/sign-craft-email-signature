# Access control, feature flags and AI limits

Phase 2 foundation. Everything here is enforced on the server (API routes and the database), not just hidden in the UI.

## Setup (once per Supabase project)

1. Run the migrations in order in the Supabase SQL editor (or `supabase db push`): `0001_init.sql`, `0002_asset_metadata.sql`, `0003_access_control.sql`.
   `0003` creates the tables, seeds the default organization ("Kimp"), the feature flags and the AI limits, and gives every existing user a profile and a Member role.
2. In `.env.local` (never in `.env.example`):
   - `ADMIN_EMAILS=you@company.com` (comma-separated). These people become admins the first time they use the app.
   - `SUPABASE_SERVICE_ROLE_KEY=...` (Project Settings > API > `service_role`). **Server only, never prefix with `NEXT_PUBLIC_`.** It is used for one thing: promoting the `ADMIN_EMAILS` people, which cannot be done as the user themselves.
3. Keep **email confirmation switched on** in Supabase (Auth settings). Only a *confirmed* email is promoted, so this is what stops a stranger from signing up with an admin's address first.
4. Sign in with an `ADMIN_EMAILS` account. An **Admin** link appears in the sidebar.

No service-role key? Promote the first admin by hand instead, in the SQL editor:

```sql
update public.memberships set role = 'admin'
 where user_id = (select id from auth.users where email = 'you@company.com');
```

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

- `lib/authz/db.test.ts` runs the real migrations in an in-process Postgres (PGlite) and tests the actual RLS policies and SQL functions: roles, flag resolution, limits, windows, refunds, last-admin protection.
- `lib/authz/authz.test.ts`, `app/api/**/*.test.ts`: guards, bootstrap, route enforcement, admin API validation.
- `app/(app)/admin/admin-ui.test.tsx`: the admin screens (jsdom).

**Not covered by automated tests:** behaviour against a live Supabase project (PostgREST, real auth cookies, the `auth.users` trigger on a hosted project) and true concurrent requests (PGlite is single-connection; the advisory lock is in the SQL but not stress-tested). Check these once on your project after applying the migration.
