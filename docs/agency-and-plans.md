# Agency mode, plans and white-label branding

Migration: `supabase/migrations/0015_agency_and_plans.sql` (needs 0003 to 0006; 0009 for the client counts). Code: `lib/org/*`, `lib/plans/*`, `app/api/agency/*`, `app/api/plans/*`, `app/(app)/agency`, `app/(app)/admin/plans`, `components/org-switcher.tsx`.

**Nothing here charges anyone.** There is no payment, Stripe or billing code. A plan is data on an organization (`organizations.plan_id`) that an admin assigns. A later billing system would only have to set that one column.

## The model

| Thing | Where | Notes |
|---|---|---|
| `plans` | id (`free` `pro` `business` `agency`, any `[a-z][a-z0-9_]*`), name, description | Read-only from the browser. |
| `plan_features` | (plan, feature, enabled) | A plan sets the **default** for a feature, like `feature_flags.default_enabled`. A feature it does not list is left to the flag. |
| `plan_ai_limits` | (plan, role, feature, per_minute, per_day) | `null` is unlimited, same as `ai_limits`. |
| `organizations.plan_id` | nullable, default null | Null means "no plan": the app behaves exactly as before plans existed. |
| `organizations.parent_id` | nullable | Set on a client organization; points to its agency. One level only. |
| `organization_branding` | brand name, https logo with explicit width and height, accent colour, "Powered by" toggle | Members read their organization's row; admins of the organization and of its agency write it. |

Seeded presets (edit them in a migration; the browser cannot):

| | Free | Pro | Business | Agency |
|---|---|---|---|---|
| AI autofill / design / screenshot | on, 5 / 3 / 3 a day | on, 100 / 60 / 20 a day for members | on, 200 / 120 / 40 | on, unlimited for admins, very high for others |
| Gmail push, digital card, rendered previews | on | on | on | on |
| Animated GIF, custom HTML, designer polish, analytics, campaigns | off | on | on | on |
| Team deploy, CRM sync, directory sync, health monitor | off | off | on | on |
| Agency mode | off | off | off | on |

## How a feature is decided (plain language)

For one person and one feature, the first rule that applies wins:

1. a **personal exception** (on or off);
2. an **organization exception**. If the person is in several organizations, any "off" wins;
3. the **plan preset**, but only for organizations that have a plan **and** whose plan lists this feature. If the preset is "off" the answer is off. If it is "on" the answer is on **only if the person's role is at least the feature's minimum role** (so a plan can never give a member an admin-only feature);
4. the flag's default, and the minimum role (the rule before plans).

With no plan anywhere, step 3 never applies and the result is exactly what it was.

**A person in several organizations.** Organizations with no plan do not take part in step 3 (otherwise the default organization everybody joins would cancel every plan). Among the organizations that do take part, the **most permissive** wins: one organization whose plan includes a feature is enough. Exceptions (step 2) stay "any off wins" because they are deliberate restrictions; plans are entitlements. Both are tested.

**AI limits.** If the caller's organization has a plan with a `plan_ai_limits` row for their role and feature, that row replaces the `ai_limits` row. With several plans the most permissive is used, minute and day separately (`null` beats any number). No plan row for that role and feature: the old `ai_limits` lookup runs unchanged (role row, then member row). The feature check, the advisory lock, the refund functions and the return shape are unchanged.

## Agency mode

Needs the `agency_mode` feature (off by default; also in the Agency plan). An admin of a top-level organization (the agency) creates **client organizations** (`create_client_organization`) and acts for them.

`is_org_admin(org)` and `is_org_member(org)` (used by the row-level security of campaigns, team, deploy, sync, cards and more) are redefined as **old rule OR agency rule**. The agency rule is: the caller is an admin of the **direct parent** of `org`.

### Security argument

* The old rule is kept verbatim as the first half of an `or`. Where no organization has a `parent_id`, the second half is always false, so every policy behaves as before. `lib/org/db.test.ts` compares the new functions with a reference copy of the old definition for every (user, organization) pair without an agency.
* The agency rule joins `organizations.parent_id` to the caller's **admin** membership of that parent. It has no reverse direction: a client's admin is not an admin of the agency, nor of a sibling (tested; also tested by flipping the join on purpose). A plain member of the agency gets nothing. One level only: the rule looks at the direct parent, so a parent of a parent grants nothing.
* **Who can set `parent_id`** (trigger `organizations_agency_guard`; the organizations table can otherwise be written by any admin): a client is created under a parent only by a direct admin of that parent; an existing organization is attached only by someone who is a direct admin of **both**, so nobody can take over an organization by pointing it at themselves; a parent is never changed directly (release first); only the agency's admin can release a client; a client cannot choose or change its own parent; the parent must be top-level and an organization with clients cannot become a client (no cycles, depth one); a check constraint forbids an organization being its own parent.
* **Who can set `plan_id`**: a client's plan only by its agency's admins (a client cannot upgrade itself); a top-level organization's plan by its own admins; a top-level organization cannot be created with a plan from the browser.
* Callers with no sign-in context (service role, SQL editor, migrations) are not restricted by the guard.

### What an agency admin can now reach that they could not before

Only the direct client organizations of an agency they administer, and only what an **organization admin** of that client already reaches: its campaigns, variants, click statistics and disclaimers; people directory, brand templates, org settings, approvals and approving directory defaults; signature rules, deployments, bulk-deploy plans and rollback; sync settings, sources, previews and runs; read access to signatures tagged with the client organization; and the ability to tag their own signatures with it. Plus the client's branding and, through the new functions, its member and people counts. Nothing about other organizations, other agencies' clients, the agency's own data seen from a client, or sibling clients changes.

### Active organization

`resolveActiveOrg` (`lib/org/active.ts`) is the one place that decides which organization a request acts in: an explicit `org_id` in the request, else the `sc_active_org` cookie (httpOnly, SameSite=Lax, Secure in production), else the person's first own membership. The cookie is a request, not a grant: it is honoured only if the database says the person is a member (or, for admin screens, an admin directly or through the agency). Otherwise it is ignored silently. An explicit `org_id` that is not allowed is refused, never redirected. `POST /api/agency/switch` (same origin) validates against `my_orgs()` before setting the cookie; `org_id: null` clears it. A person in one organization with no cookie runs the same single memberships query as before.

`adminOrg()` in `lib/campaigns/route.ts` calls it, so every admin route (campaigns, disclaimers, team, deploy, sync) follows the active organization. `lib/team/route.ts` needed no change: `teamAdmin` goes through `campaignAdmin`.

## Branding

`lib/org/branding.ts` validates and resolves branding (https logo with explicit width 16 to 400 and height 16 to 200, accent colour with at least 4.5:1 contrast on white, checked in the database too by `contrast_ok_on_white`). `loadBranding(supabase, orgId)` returns name, logo, accent and the Powered-by flag for the app chrome; `BrandMark` (`lib/org/brand-mark.tsx`) renders it. The accent is drawn only as a decorative bar, not as text, because 4.5:1 on white says nothing about dark mode. Hiding "Powered by SignCraft" needs agency mode.

## Adding a plan

1. In a new migration: `insert into plans (id, name, description, sort_order)`, then `plan_features` rows (every feature you want the plan to decide) and `plan_ai_limits` rows (role by AI feature). No schema change.
2. Add it to the option list in `app/(app)/agency/agency-clients.tsx`. The plans screen reads the table.
3. Add it to the db test that counts the presets.

## What is NOT built

* **Billing of any kind**: no checkout, invoices, trials, usage metering for money or webhooks.
* Inviting or creating **client users**: the agency can create the organization, but putting people into it is still done through `memberships` (service role or SQL). A client's admin is also a global admin under the existing `is_admin()`, which already lets any admin write the organizations and overrides tables (guarded for `parent_id`/`plan_id` here). A separate platform-admin concept is the real fix and is outside this change.
* Releasing or re-attaching clients from the screens (the database supports it).
* Branding is not applied to the public card or marketing pages, or the global header (integration requests below in the report).
