-- SignCraft plans (admin-assigned presets), agency mode (client organizations) and white-label branding.
-- Run after 0003 (feature flags, AI limits) and 0006 (is_org_admin / is_org_member). See docs/agency-and-plans.md.
--
-- NOTHING IN HERE CHARGES ANYONE. A plan is data on an organization (organizations.plan_id) that an admin assigns.
--
-- Backwards compatibility is the design rule of this file:
--   * organizations.plan_id and organizations.parent_id are NULL for every existing organization.
--   * feature_enabled_for(): the new plan step only runs for an organization that has a plan AND whose plan defines
--     the feature. With no plan anywhere, the function returns exactly what 0003 returned.
--   * consume_ai_quota(): plan limits are only used when the caller's organization has a plan with a row for their
--     role and feature. Otherwise the original ai_limits lookup runs unchanged.
--   * is_org_admin() / is_org_member(): "old rule OR agency rule". With no parent_id anywhere the second half is
--     always false, so every RLS policy in the schema behaves byte for byte as before.

/* ---------------------------------------------------------------- plans */

create table public.plans (
  id          text primary key check (id ~ '^[a-z][a-z0-9_]*$'),   -- adding a plan is an insert, not a schema change
  name        text not null check (char_length(name) between 1 and 40),
  description text not null default '',
  sort_order  integer not null default 0
);

-- A plan sets the DEFAULT for a feature (like feature_flags.default_enabled). A feature the plan does not list is left to the flag.
create table public.plan_features (
  plan    text not null references public.plans (id) on delete cascade,
  feature text not null references public.feature_flags (feature) on delete cascade,
  enabled boolean not null,
  primary key (plan, feature)
);

-- Per plan, role and AI feature. null = unlimited (same meaning as ai_limits).
create table public.plan_ai_limits (
  plan       text not null references public.plans (id) on delete cascade,
  role       public.app_role not null,
  feature    text not null references public.feature_flags (feature) on delete cascade,
  per_minute integer check (per_minute is null or per_minute >= 0),
  per_day    integer check (per_day is null or per_day >= 0),
  primary key (plan, role, feature)
);

alter table public.organizations add column plan_id text references public.plans (id);
alter table public.organizations add column parent_id uuid references public.organizations (id);
alter table public.organizations add constraint organizations_not_own_parent check (parent_id is null or parent_id <> id);
create index organizations_parent_idx on public.organizations (parent_id) where parent_id is not null;

/* ----------------------------------------------------- agency helper functions */

-- Is the caller an admin of THIS organization through their own membership (never through an agency)? Internal.
create function public.is_direct_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships where org_id = p_org and user_id = auth.uid() and role = 'admin')
$$;

-- The agency rule: the caller is an admin of the DIRECT parent of p_org. One level only: a parent of a parent grants nothing.
create function public.is_agency_admin_of(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.organizations c
      join public.memberships m on m.org_id = c.parent_id and m.user_id = auth.uid() and m.role = 'admin'
     where c.id = p_org
  )
$$;

-- Redefined with CREATE OR REPLACE (0006 created them): old rule OR agency rule. Nothing else changes: same name,
-- arguments, return type, security definer, search_path, and the grants made in 0006 are kept.
create or replace function public.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships where org_id = p_org and user_id = auth.uid() and role = 'admin')
      or public.is_agency_admin_of(p_org)
$$;

create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships where org_id = p_org and user_id = auth.uid())
      or public.is_agency_admin_of(p_org)
$$;

/* ----------------------------------------------- who may set parent_id / plan_id */
-- The organizations table can be written by any admin (policy from 0003), so these two columns are guarded here.
-- Callers with no JWT subject (the service role, the SQL editor, migrations, tests seeding data) are not restricted.
--   * A client is created under a parent only by a (direct) admin of that parent.
--   * An EXISTING organization can be attached to a parent only by someone who is a direct admin of BOTH
--     (otherwise "attach any organization to me" would be a way to take it over).
--   * A parent_id is never changed from one parent to another, and a client cannot choose its own parent.
--   * Only the parent's admin can detach a client (set parent_id back to null).
--   * Depth is one level: the parent must have no parent, and an organization that has clients cannot become one.
--   * A client's plan is changed only by the parent's admins; a top-level organization's plan by its own admins.

create function public.organizations_agency_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  par public.organizations;
begin
  if auth.uid() is null then return new; end if;

  if tg_op = 'INSERT' then
    if new.parent_id is not null then
      select * into par from public.organizations where id = new.parent_id;
      if not found or par.parent_id is not null then
        raise exception 'A client organization needs a top-level organization as its agency.' using errcode = 'AG002';
      end if;
      if not public.is_direct_org_admin(new.parent_id) then
        raise exception 'Only an admin of the agency can add a client to it.' using errcode = '42501';
      end if;
    elsif new.plan_id is not null then
      raise exception 'A plan is assigned after the organization exists.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.parent_id is distinct from old.parent_id then
    if new.parent_id is null then
      if not public.is_direct_org_admin(old.parent_id) then
        raise exception 'Only an admin of the agency can release a client.' using errcode = '42501';
      end if;
    else
      if old.parent_id is not null then
        raise exception 'This organization already belongs to an agency. Release it first.' using errcode = 'AG002';
      end if;
      select * into par from public.organizations where id = new.parent_id;
      if not found or par.parent_id is not null or new.parent_id = new.id then
        raise exception 'A client organization needs a top-level organization as its agency.' using errcode = 'AG002';
      end if;
      if exists (select 1 from public.organizations where parent_id = new.id) then
        raise exception 'An organization with clients of its own cannot become a client.' using errcode = 'AG002';
      end if;
      if not (public.is_direct_org_admin(new.parent_id) and public.is_direct_org_admin(new.id)) then
        raise exception 'You must be an admin of both organizations to link them.' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.plan_id is distinct from old.plan_id then
    if not public.is_direct_org_admin(coalesce(old.parent_id, old.id)) then
      raise exception 'You do not have permission to change this plan.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger organizations_agency_guard before insert or update on public.organizations
  for each row execute function public.organizations_agency_guard();

-- An agency admin creates a client organization. Needs the agency_mode feature.
create function public.create_client_organization(p_parent uuid, p_name text, p_plan text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.feature_enabled_for(auth.uid(), 'agency_mode') then
    raise exception 'Agency mode is not enabled for your account.' using errcode = '42501';
  end if;
  if not public.is_direct_org_admin(p_parent) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'The name must be 1 to 80 characters.' using errcode = '22023';
  end if;
  insert into public.organizations (name, parent_id, plan_id) values (v_name, p_parent, p_plan) returning id into v_id;
  return v_id;
end $$;

-- Client organizations of an agency, with counts, for the agency screen.
create function public.agency_clients(p_parent uuid)
returns table (id uuid, name text, plan_id text, created_at timestamptz, member_count bigint, people_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_direct_org_admin(p_parent) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return query
    select o.id, o.name, o.plan_id, o.created_at,
           (select count(*) from public.memberships m where m.org_id = o.id),
           (select count(*) from public.people p where p.org_id = o.id)
      from public.organizations o
     where o.parent_id = p_parent
     order by o.name, o.id;
end $$;

-- Every organization the caller may act in: their memberships, then the clients of agencies they administer.
create function public.my_orgs()
returns table (id uuid, name text, parent_id uuid, plan_id text, role public.app_role, via_agency boolean)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.parent_id, o.plan_id, m.role, false
    from public.memberships m join public.organizations o on o.id = m.org_id
   where m.user_id = auth.uid()
  union all
  select c.id, c.name, c.parent_id, c.plan_id, 'admin'::public.app_role, true
    from public.organizations c
    join public.memberships pm on pm.org_id = c.parent_id and pm.user_id = auth.uid() and pm.role = 'admin'
   where not exists (select 1 from public.memberships d where d.org_id = c.id and d.user_id = auth.uid())
$$;

/* ------------------------------------------------------ feature resolution */
-- Order: user override, organization override (any "off" wins), PLAN preset, flag default AND minimum role.
-- The plan preset replaces the flag's default_enabled; the minimum role still applies when the plan turns a feature on,
-- so a plan can never give a member an admin-only feature. A plan that turns a feature off turns it off for everyone.
-- A person in several organizations: organizations without a plan, or whose plan does not mention the feature, do not
-- take part; among the rest the MOST PERMISSIVE plan wins (bool_or). Overrides stay "any off wins" because they are
-- explicit exceptions; plans are entitlements, and being in one organization that includes a feature is enough.

create or replace function public.feature_enabled_for(p_user uuid, p_feature text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  f public.feature_flags;
  o boolean;
  pl boolean;
begin
  if p_user is distinct from auth.uid() and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into f from public.feature_flags where feature = p_feature;
  if not found then return false; end if;

  select enabled into o from public.feature_overrides
   where subject_type = 'user' and subject_id = p_user and feature = p_feature;
  if found then return o; end if;

  -- organization overrides: if the user is in several organizations, an explicit "off" wins
  select bool_and(fo.enabled) into o
    from public.feature_overrides fo
    join public.memberships m on m.org_id = fo.subject_id and m.user_id = p_user
   where fo.subject_type = 'org' and fo.feature = p_feature;
  if o is not null then return o; end if;

  -- plan presets (only organizations that have a plan which defines this feature take part)
  select bool_or(pf.enabled) into pl
    from public.plan_features pf
    join public.organizations org on org.plan_id = pf.plan
    join public.memberships m on m.org_id = org.id and m.user_id = p_user
   where pf.feature = p_feature;
  if pl is not null then
    return pl and public.app_role_of(p_user) >= f.min_role;
  end if;

  return f.default_enabled and public.app_role_of(p_user) >= f.min_role;
end $$;

/* ----------------------------------------------------------- AI quota */
-- Identical to 0003 except for where the limits come from: a plan row (most permissive across the caller's
-- organizations that have one) when there is one for the caller's role and feature, otherwise the ai_limits rows.

create or replace function public.consume_ai_quota(p_feature text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid      uuid := auth.uid();
  lim      public.ai_limits;
  lim_min  integer;
  lim_day  integer;
  my_role  public.app_role;
  used_min integer;
  used_day integer;
  new_id   uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Serialise concurrent calls from the same user for this feature, so two parallel requests cannot both slip under a limit.
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_feature, 0));

  if not public.feature_enabled_for(uid, p_feature) then
    return jsonb_build_object('allowed', false, 'reason', 'feature_disabled');
  end if;

  my_role := public.app_role_of(uid);

  select case when bool_or(pl.per_minute is null) then null else max(pl.per_minute) end,
         case when bool_or(pl.per_day is null) then null else max(pl.per_day) end
    into lim_min, lim_day
    from public.plan_ai_limits pl
    join public.organizations org on org.plan_id = pl.plan
    join public.memberships m on m.org_id = org.id and m.user_id = uid
   where pl.role = my_role and pl.feature = p_feature
  having count(*) > 0;

  if not found then
    select * into lim from public.ai_limits where role = my_role and feature = p_feature;
    if not found then
      select * into lim from public.ai_limits where role = 'member' and feature = p_feature;
    end if;
    lim_min := lim.per_minute;
    lim_day := lim.per_day;
  end if;

  select count(*) filter (where created_at > now() - interval '1 minute'), count(*)
    into used_min, used_day
    from public.ai_usage
   where user_id = uid and feature = p_feature and created_at > now() - interval '1 day';

  if lim_min is not null and used_min >= lim_min then
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited');
  end if;
  if lim_day is not null and used_day >= lim_day then
    return jsonb_build_object('allowed', false, 'reason', 'daily_limit');
  end if;

  insert into public.ai_usage (user_id, feature) values (uid, p_feature) returning id into new_id;
  return jsonb_build_object(
    'allowed', true,
    'usage_id', new_id,
    'remaining_day', case when lim_day is null then null else lim_day - used_day - 1 end
  );
end $$;

/* ------------------------------------------------------------- branding */

-- Contrast ratio of a colour on white is at least 4.5:1 (WCAG AA for text). Same maths as lib/linter/contrast.ts.
create function public.contrast_ok_on_white(p_hex text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  lum double precision := 0;
  w double precision[] := array[0.2126, 0.7152, 0.0722];
  i integer;
  v double precision;
begin
  if p_hex is null or p_hex !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
  for i in 1..3 loop
    v := (('x' || substr(p_hex, 2 * i, 2))::bit(8)::integer)::double precision / 255.0;
    v := case when v <= 0.03928 then v / 12.92 else power((v + 0.055) / 1.055, 2.4) end;
    lum := lum + w[i] * v;
  end loop;
  return 1.05 / (lum + 0.05) >= 4.5;
end $$;

create table public.organization_branding (
  org_id          uuid primary key references public.organizations (id) on delete cascade,
  brand_name      text check (brand_name is null or char_length(btrim(brand_name)) between 1 and 60),
  logo_url        text check (logo_url is null or (logo_url ~ '^https://[^[:space:]<>"]+$' and char_length(logo_url) <= 500)),
  logo_width      integer check (logo_width is null or logo_width between 16 and 400),
  logo_height     integer check (logo_height is null or logo_height between 16 and 200),
  accent          text check (accent is null or public.contrast_ok_on_white(accent)),
  show_powered_by boolean not null default true,
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  check ((logo_url is null) = (logo_width is null) and (logo_url is null) = (logo_height is null))   -- a logo always has explicit width and height
);

/* ------------------------------------------------------------ row security */

alter table public.plans               enable row level security;
alter table public.plan_features       enable row level security;
alter table public.plan_ai_limits      enable row level security;
alter table public.organization_branding enable row level security;

-- Plan presets are readable by every signed-in person and changed only by migrations or the service role (no write policy).
create policy "plans: read" on public.plans for select to authenticated using (true);
create policy "plan_features: read" on public.plan_features for select to authenticated using (true);
create policy "plan_ai_limits: read" on public.plan_ai_limits for select to authenticated using (true);

-- Members read their organization's branding; admins of the organization (and of its agency) write it.
create policy "organization_branding: member read" on public.organization_branding for select to authenticated using (public.is_org_member(org_id));
create policy "organization_branding: org admin insert" on public.organization_branding for insert to authenticated with check (public.is_org_admin(org_id));
create policy "organization_branding: org admin update" on public.organization_branding for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy "organization_branding: org admin delete" on public.organization_branding for delete to authenticated using (public.is_org_admin(org_id));

/* -------------------------------------------------------------- privileges */

revoke all on public.plans, public.plan_features, public.plan_ai_limits, public.organization_branding from anon, authenticated;
grant select on public.plans, public.plan_features, public.plan_ai_limits to authenticated;
grant select, insert, update, delete on public.organization_branding to authenticated;

revoke execute on function
  public.is_direct_org_admin(uuid), public.is_agency_admin_of(uuid), public.organizations_agency_guard(),
  public.create_client_organization(uuid, text, text), public.agency_clients(uuid), public.my_orgs(), public.contrast_ok_on_white(text)
  from public, anon;
-- is_agency_admin_of is called from is_org_admin / is_org_member, which run as the table owner, so it needs no grant.
-- contrast_ok_on_white is evaluated inside a CHECK constraint, which runs as the writer.
grant execute on function public.create_client_organization(uuid, text, text), public.agency_clients(uuid), public.my_orgs(), public.contrast_ok_on_white(text) to authenticated;

/* ------------------------------------------------------------------- seeds */
-- Starting presets, edited by a migration (or the service role), never by a customer.

insert into public.plans (id, name, description, sort_order) values
  ('free',     'Free',     'Signature builder with a few AI uses a day. No animated GIF, custom HTML, campaigns or team deployment.', 10),
  ('pro',      'Pro',      'Everything for one person or a small team: animated GIF, custom HTML, designer polish, campaigns and analytics.', 20),
  ('business', 'Business', 'Pro plus team deployment, directory and CRM sync and the signature health monitor.', 30),
  ('agency',   'Agency',   'Everything, including agency mode: client organizations, white-label branding and the highest AI limits.', 40);

insert into public.plan_features (plan, feature, enabled)
select p.id, f.feature,
       f.feature = any (case p.id
         when 'free' then array['ai_autofill', 'ai_design', 'ai_vision', 'gmail_push', 'digital_card', 'render_previews']
         when 'pro' then array['ai_autofill', 'ai_design', 'ai_vision', 'gmail_push', 'digital_card', 'render_previews',
                               'animated_gif', 'custom_html', 'designer_polish', 'analytics', 'campaigns']
         when 'business' then array['ai_autofill', 'ai_design', 'ai_vision', 'gmail_push', 'digital_card', 'render_previews',
                               'animated_gif', 'custom_html', 'designer_polish', 'analytics', 'campaigns',
                               'team_deploy', 'crm_sync', 'directory_sync', 'health_monitor']
         else (select array_agg(feature) from public.feature_flags)
       end)
  from public.plans p cross join public.feature_flags f;

-- null = unlimited.
insert into public.plan_ai_limits (plan, role, feature, per_minute, per_day) values
  ('free', 'member',   'ai_autofill', 2, 5), ('free', 'member',   'ai_design', 2, 3), ('free', 'member',   'ai_vision', 1, 3),
  ('free', 'designer', 'ai_autofill', 2, 5), ('free', 'designer', 'ai_design', 2, 3), ('free', 'designer', 'ai_vision', 1, 3),
  ('free', 'admin',    'ai_autofill', 2, 5), ('free', 'admin',    'ai_design', 2, 3), ('free', 'admin',    'ai_vision', 1, 3),

  ('pro', 'member',   'ai_autofill', 8, 100),  ('pro', 'member',   'ai_design', 8, 60),   ('pro', 'member',   'ai_vision', 3, 20),
  ('pro', 'designer', 'ai_autofill', 16, 300), ('pro', 'designer', 'ai_design', 16, 200), ('pro', 'designer', 'ai_vision', 6, 60),
  ('pro', 'admin',    'ai_autofill', 20, 300), ('pro', 'admin',    'ai_design', 20, 200), ('pro', 'admin',    'ai_vision', 8, 80),

  ('business', 'member',   'ai_autofill', 10, 200), ('business', 'member',   'ai_design', 10, 120), ('business', 'member',   'ai_vision', 4, 40),
  ('business', 'designer', 'ai_autofill', 20, 600), ('business', 'designer', 'ai_design', 20, 400), ('business', 'designer', 'ai_vision', 8, 120),
  ('business', 'admin',    'ai_autofill', null, null), ('business', 'admin', 'ai_design', null, null), ('business', 'admin', 'ai_vision', null, null),

  ('agency', 'member',   'ai_autofill', 30, null), ('agency', 'member',   'ai_design', 30, null), ('agency', 'member',   'ai_vision', 10, null),
  ('agency', 'designer', 'ai_autofill', 60, null), ('agency', 'designer', 'ai_design', 60, null), ('agency', 'designer', 'ai_vision', 20, null),
  ('agency', 'admin',    'ai_autofill', null, null), ('agency', 'admin',    'ai_design', null, null), ('agency', 'admin',    'ai_vision', null, null);
