-- SignCraft Phase 2 foundation: organizations, roles, feature flags + overrides, AI limits and per-user AI usage.
-- Run after 0001 and 0002 (SQL editor or `supabase db push`). See docs/access-control.md.
--
-- Model
--   role        member < designer < admin (an ordered enum, so `role >= min_role` just works)
--   membership  (org, user, role). A user's effective role is the highest role across their memberships.
--   feature     available = user override, else org override (any "off" wins), else default_enabled AND role >= min_role
--   AI usage    one row per paid call, written ONLY through consume_ai_quota() so limits cannot be skipped or raced.

create type public.app_role as enum ('member', 'designer', 'admin');

/* ------------------------------------------------------------------ tables */

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  is_default boolean not null default false,   -- new sign-ups join the default organization as members
  owner_id   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index organizations_one_default on public.organizations (is_default) where is_default;

-- Mirror of auth.users that the admin UI can read (auth.users itself is not reachable from the browser client).
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);
create unique index profiles_email_idx on public.profiles (lower(email));

create table public.memberships (
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.app_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.feature_flags (
  feature         text primary key check (feature ~ '^[a-z][a-z0-9_]*$'),
  description     text not null default '',
  default_enabled boolean not null default true,
  min_role        public.app_role not null default 'member'
);

create table public.feature_overrides (
  subject_type text not null check (subject_type in ('user', 'org')),
  subject_id   uuid not null,                  -- profiles.id or organizations.id, depending on subject_type
  feature      text not null references public.feature_flags (feature) on delete cascade,
  enabled      boolean not null,
  updated_at   timestamptz not null default now(),
  primary key (subject_type, subject_id, feature)
);

-- Per role and feature. A null column means "no limit". A role with no row falls back to the member row.
create table public.ai_limits (
  role       public.app_role not null,
  feature    text not null references public.feature_flags (feature) on delete cascade,
  per_minute integer check (per_minute is null or per_minute >= 0),
  per_day    integer check (per_day is null or per_day >= 0),
  primary key (role, feature)
);

create table public.ai_usage (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  feature    text not null references public.feature_flags (feature) on delete cascade,
  tokens_in  integer,
  tokens_out integer,
  created_at timestamptz not null default now()
);
create index ai_usage_user_feature_time_idx on public.ai_usage (user_id, feature, created_at desc);

/* --------------------------------------------------------------- functions */
-- All SECURITY DEFINER functions pin search_path so they cannot be hijacked by a same-named object.

-- The user's effective role: the highest across their memberships, 'member' when they have none.
create function public.app_role_of(p_user uuid) returns public.app_role
language sql stable security definer set search_path = '' as $$
  select coalesce((select max(role) from public.memberships where user_id = p_user), 'member'::public.app_role)
$$;

create function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select public.app_role_of(auth.uid())
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.app_role_of(auth.uid()) = 'admin'
$$;

-- Can this user use this feature? Users may ask about themselves; admins about anyone.
create function public.feature_enabled_for(p_user uuid, p_feature text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  f public.feature_flags;
  o boolean;
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

  return f.default_enabled and public.app_role_of(p_user) >= f.min_role;
end $$;

create function public.feature_enabled(p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.feature_enabled_for(auth.uid(), p_feature)
$$;

-- Check the feature flag and the per-minute / per-day limits, and record the use, atomically.
-- Returns {allowed, reason, usage_id, remaining_day}. reason is feature_disabled | rate_limited | daily_limit.
create function public.consume_ai_quota(p_feature text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid      uuid := auth.uid();
  lim      public.ai_limits;
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

  select * into lim from public.ai_limits where role = public.app_role_of(uid) and feature = p_feature;
  if not found then
    select * into lim from public.ai_limits where role = 'member' and feature = p_feature;
  end if;

  select count(*) filter (where created_at > now() - interval '1 minute'), count(*)
    into used_min, used_day
    from public.ai_usage
   where user_id = uid and feature = p_feature and created_at > now() - interval '1 day';

  if lim.per_minute is not null and used_min >= lim.per_minute then
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited');
  end if;
  if lim.per_day is not null and used_day >= lim.per_day then
    return jsonb_build_object('allowed', false, 'reason', 'daily_limit');
  end if;

  insert into public.ai_usage (user_id, feature) values (uid, p_feature) returning id into new_id;
  return jsonb_build_object(
    'allowed', true,
    'usage_id', new_id,
    'remaining_day', case when lim.per_day is null then null else lim.per_day - used_day - 1 end
  );
end $$;

-- Record token counts on a use that just completed.
create function public.finish_ai_usage(p_id uuid, p_tokens_in integer, p_tokens_out integer) returns void
language sql volatile security definer set search_path = '' as $$
  update public.ai_usage set tokens_in = p_tokens_in, tokens_out = p_tokens_out
   where id = p_id and user_id = auth.uid()
$$;

-- Give back a use when the paid call failed before producing anything. Never after tokens were recorded.
create function public.refund_ai_usage(p_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  delete from public.ai_usage where id = p_id and user_id = auth.uid() and tokens_in is null
$$;

/* ---------------------------------------------------------------- triggers */

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
    on conflict (id) do update set email = excluded.email;
  insert into public.memberships (org_id, user_id)
    select id, new.id from public.organizations where is_default
    on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function public.sync_profile_email();

-- The last admin cannot be demoted or removed by hand. (Cascading deletes of an auth user run at trigger depth 2 and are left alone.)
create function public.protect_last_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 and old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    if not exists (select 1 from public.memberships where role = 'admin' and (org_id, user_id) <> (old.org_id, old.user_id)) then
      raise exception 'There must be at least one admin.' using errcode = 'P0001';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger memberships_protect_last_admin before update or delete on public.memberships
  for each row execute function public.protect_last_admin();

/* ------------------------------------------------------------ row security */

alter table public.organizations      enable row level security;
alter table public.profiles           enable row level security;
alter table public.memberships        enable row level security;
alter table public.feature_flags      enable row level security;
alter table public.feature_overrides  enable row level security;
alter table public.ai_limits          enable row level security;
alter table public.ai_usage           enable row level security;

create policy "organizations: member read" on public.organizations for select to authenticated
  using (public.is_admin() or exists (select 1 from public.memberships m where m.org_id = id and m.user_id = auth.uid()));
create policy "organizations: admin write" on public.organizations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "profiles: self or admin read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "memberships: self or admin read" on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "memberships: admin write" on public.memberships for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "feature_flags: read" on public.feature_flags for select to authenticated using (true);
create policy "feature_flags: admin write" on public.feature_flags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "feature_overrides: own or admin read" on public.feature_overrides for select to authenticated
  using (
    public.is_admin()
    or (subject_type = 'user' and subject_id = auth.uid())
    or (subject_type = 'org' and exists (select 1 from public.memberships m where m.org_id = subject_id and m.user_id = auth.uid()))
  );
create policy "feature_overrides: admin write" on public.feature_overrides for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "ai_limits: read" on public.ai_limits for select to authenticated using (true);
create policy "ai_limits: admin write" on public.ai_limits for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Usage is readable (own rows, or everything for admins) but has NO write policy: rows only appear through consume_ai_quota().
create policy "ai_usage: own or admin read" on public.ai_usage for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

/* ------------------------------------------------------ function privileges */

revoke execute on function
  public.app_role_of(uuid), public.current_app_role(), public.is_admin(), public.feature_enabled_for(uuid, text),
  public.feature_enabled(text), public.consume_ai_quota(text), public.finish_ai_usage(uuid, integer, integer),
  public.refund_ai_usage(uuid), public.handle_new_user(), public.sync_profile_email(), public.protect_last_admin()
  from public, anon;

grant execute on function
  public.current_app_role(), public.is_admin(), public.feature_enabled_for(uuid, text), public.feature_enabled(text),
  public.consume_ai_quota(text), public.finish_ai_usage(uuid, integer, integer), public.refund_ai_usage(uuid)
  to authenticated;
-- app_role_of(uuid) takes any user id, so it stays internal: only the other definer functions and policies call it.

/* ------------------------------------------------------------------- seeds */

insert into public.organizations (name, is_default) values ('Kimp', true);

insert into public.profiles (id, email) select id, coalesce(email, '') from auth.users on conflict do nothing;
insert into public.memberships (org_id, user_id)
  select o.id, u.id from auth.users u cross join public.organizations o where o.is_default
  on conflict do nothing;

insert into public.feature_flags (feature, description, default_enabled, min_role) values
  ('ai_autofill',     'Fill in details from pasted text or a website',            true,  'member'),
  ('ai_design',       'Design a signature from a text prompt',                    true,  'member'),
  ('ai_vision',       'Rebuild a signature from a screenshot',                    true,  'member'),
  ('gmail_push',      'Install a signature into Gmail with one click',            true,  'member'),
  ('animated_gif',    'Animated GIF signatures (enabled per customer)',           false, 'member'),
  ('custom_html',     'Hand-written HTML signatures',                             true,  'designer'),
  ('designer_polish', 'Send an AI draft to a Kimp designer to polish',            true,  'designer'),
  ('analytics',       'Banner click analytics',                                   true,  'admin'),
  ('team_deploy',     'Team deployment and brand lock',                           true,  'admin');

-- null = unlimited. Starting values, editable on /admin/limits.
insert into public.ai_limits (role, feature, per_minute, per_day) values
  ('member',   'ai_autofill', 8,  60),
  ('designer', 'ai_autofill', 16, 200),
  ('admin',    'ai_autofill', null, null),
  ('member',   'ai_design',   10, 40),
  ('designer', 'ai_design',   20, 150),
  ('admin',    'ai_design',   null, null),
  ('member',   'ai_vision',   3,  10),
  ('designer', 'ai_vision',   6,  40),
  ('admin',    'ai_vision',   null, null);
