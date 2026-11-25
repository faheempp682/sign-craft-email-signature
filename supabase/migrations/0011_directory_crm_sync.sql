-- SignCraft directory sync (Google Workspace, Microsoft 365) and CRM sync (HubSpot, a generic REST CRM).
-- Run after 0009 (people, people_imports) and 0006 (is_org_admin / is_org_member). Independent of 0010 and 0013.
-- See docs/directory-and-crm-sync.md.
--
-- Access model
--   * Everything here is for organization admins only (RLS on every table, no policy for members).
--   * Settings (sync_settings, sync_sources) are plain admin-writable tables.
--   * sync_previews and sync_runs have NO insert/update/delete privilege for the browser roles. Rows appear and change only
--     through the functions below, so a crafted PostgREST request cannot fake a preview, apply one that was never made,
--     or edit history. sync_runs is append-only (a trigger refuses updates).
--   * Applying a confirmed preview is ONE function call = ONE transaction. The safety cap and "nothing fetched" rules are
--     enforced inside that function, so an API route that forgets them (or a direct call) still cannot wipe a directory.
--   * Unattended runs (cron) use the service role. Each operation has an *_admin entry point (checks auth.uid() is an admin of the
--     organization) and a *_service entry point (no user; execute is granted to service_role only). Both call the same
--     internal function, which is not executable by any browser role.

/* -------------------------------------------------------------------------- tables */

-- One row per organization (created on first save). The safety cap is shared by every source.
create table public.sync_settings (
  org_id             uuid primary key references public.organizations (id) on delete cascade,
  safety_cap_percent integer not null default 20 check (safety_cap_percent between 1 and 100),
  schedule_note      text not null default '' check (char_length(schedule_note) <= 200),
  updated_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now()
);

-- One row per organization and source. `config` never holds a secret (secrets live in server environment variables).
create table public.sync_sources (
  org_id               uuid not null references public.organizations (id) on delete cascade,
  source               text not null check (source in ('google', 'microsoft', 'hubspot', 'generic')),
  enabled              boolean not null default false,   -- cron only touches enabled sources
  auto_apply           boolean not null default false,   -- cron applies by itself only when true AND the safety cap passes
  allow_blank_overwrite boolean not null default false,  -- an empty source value may erase a directory value (only for fields the source wins)
  field_policy         jsonb not null default '{}'::jsonb check (jsonb_typeof(field_policy) = 'object' and char_length(field_policy::text) <= 2000),  -- {"title": "source" | "directory", ...}
  config               jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and char_length(config::text) <= 6000),  -- CRM mapping, base url, path template ... (no secrets)
  updated_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now(),
  primary key (org_id, source)
);

-- A computed diff waiting for an admin to confirm. At most one pending preview per organization and source.
create table public.sync_previews (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  source        text not null check (source in ('google', 'microsoft', 'hubspot', 'generic')),
  status        text not null default 'pending' check (status in ('pending', 'applied', 'superseded')),
  trigger       text not null check (trigger in ('manual', 'cron')),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '24 hours',   -- an old diff is never applied: run a new preview
  fetched_count integer not null check (fetched_count >= 0),               -- users the source returned (directory) or records matched (CRM)
  stats         jsonb not null default '{}'::jsonb,
  errors        jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array' and jsonb_array_length(errors) <= 100),
  plan          jsonb not null check (jsonb_typeof(plan) = 'object' and jsonb_typeof(plan -> 'creates') = 'array' and jsonb_typeof(plan -> 'updates') = 'array' and jsonb_typeof(plan -> 'deactivates') = 'array'),
  applied_at    timestamptz,
  applied_by    uuid references auth.users (id) on delete set null
);
create unique index sync_previews_one_pending on public.sync_previews (org_id, source) where status = 'pending';
create index sync_previews_org_idx on public.sync_previews (org_id, created_at desc);

-- History: one row per event (previewed, applied, blocked, failed). Append-only.
create table public.sync_runs (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  source     text not null check (source in ('google', 'microsoft', 'hubspot', 'generic')),
  trigger    text not null check (trigger in ('manual', 'cron')),
  status     text not null check (status in ('previewed', 'applied', 'blocked', 'failed')),
  preview_id uuid references public.sync_previews (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  message    text not null default '' check (char_length(message) <= 500),
  stats      jsonb not null default '{}'::jsonb check (char_length(stats::text) <= 8000),
  errors     jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array' and jsonb_array_length(errors) <= 100)
);
create index sync_runs_org_idx on public.sync_runs (org_id, created_at desc);

create trigger sync_settings_touch before update on public.sync_settings for each row execute function public.touch_updated_at();
create trigger sync_sources_touch before update on public.sync_sources for each row execute function public.touch_updated_at();

create function public.sync_runs_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'The sync history cannot be changed.' using errcode = 'SY005';
end $$;
create trigger sync_runs_no_update before update on public.sync_runs for each row execute function public.sync_runs_append_only();

/* ------------------------------------------------------------------ internal functions */

-- Which organization+source previews/applies run on the same lock, so two overlapping runs cannot both pass the checks.
create function public.sync_lock(p_org uuid, p_source text) returns void
language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('sync:' || p_org::text || ':' || p_source, 0))
$$;

-- Store a computed preview (replacing any older pending one) and note it in the history.
create function public.sync_save_preview_impl(p_org uuid, p_source text, p_plan jsonb, p_stats jsonb, p_fetched integer, p_errors jsonb, p_trigger text, p_actor uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_source not in ('google', 'microsoft', 'hubspot', 'generic') then raise exception 'Unknown source.' using errcode = 'SY006'; end if;
  if p_trigger not in ('manual', 'cron') then raise exception 'Unknown trigger.' using errcode = 'SY006'; end if;
  if p_plan is null or jsonb_typeof(p_plan) is distinct from 'object' or jsonb_typeof(p_plan -> 'creates') is distinct from 'array'
     or jsonb_typeof(p_plan -> 'updates') is distinct from 'array' or jsonb_typeof(p_plan -> 'deactivates') is distinct from 'array' then
    raise exception 'The preview is malformed.' using errcode = 'SY006';
  end if;
  if jsonb_array_length(p_plan -> 'creates') + jsonb_array_length(p_plan -> 'updates') + jsonb_array_length(p_plan -> 'deactivates') > 10000 or octet_length(p_plan::text) > 12000000 then
    raise exception 'The preview is too large.' using errcode = 'SY006';
  end if;
  if p_source in ('hubspot', 'generic') and (jsonb_array_length(p_plan -> 'creates') > 0 or jsonb_array_length(p_plan -> 'deactivates') > 0) then
    raise exception 'A CRM sync can only update existing people.' using errcode = 'SY006';
  end if;
  perform public.sync_lock(p_org, p_source);
  update public.sync_previews set status = 'superseded' where org_id = p_org and source = p_source and status = 'pending';
  insert into public.sync_previews (org_id, source, trigger, created_by, fetched_count, stats, errors, plan)
  values (p_org, p_source, p_trigger, p_actor, greatest(coalesce(p_fetched, 0), 0), coalesce(p_stats, '{}'::jsonb), coalesce(p_errors, '[]'::jsonb), p_plan)
  returning id into v_id;
  insert into public.sync_runs (org_id, source, trigger, status, preview_id, created_by, stats, errors, message)
  values (p_org, p_source, p_trigger, 'previewed', v_id, p_actor, coalesce(p_stats, '{}'::jsonb), coalesce(p_errors, '[]'::jsonb), 'Preview computed. Nothing was changed.');
  return v_id;
end $$;

-- Apply a pending preview in one transaction. Refuses (with a reason an admin can read) when:
--   SY001 the preview does not exist, SY004 it is not pending or has expired,
--   SY003 the source returned nothing, SY002 it would deactivate (directory) or erase values of (CRM) more than the safety cap.
-- People are never deleted. Only people whose source is this source are ever deactivated.
create function public.sync_apply_impl(p_preview uuid, p_actor uuid, p_trigger text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.sync_previews;
  v_cap integer;
  v_base integer;
  v_risky integer;
  v_created integer := 0;
  v_updated integer := 0;
  v_deactivated integer := 0;
  v_skipped integer := 0;
  v_import_source text;
  v_stats jsonb;
begin
  select * into v from public.sync_previews where id = p_preview;
  if not found then raise exception 'That preview does not exist.' using errcode = 'SY001'; end if;
  perform public.sync_lock(v.org_id, v.source);
  select * into v from public.sync_previews where id = p_preview for update;
  if v.status <> 'pending' then raise exception 'That preview was already applied or replaced by a newer one. Run a new preview.' using errcode = 'SY004'; end if;
  if v.expires_at < now() then raise exception 'That preview is more than 24 hours old. Run a new preview so you apply current data.' using errcode = 'SY004'; end if;

  if v.fetched_count = 0 then
    raise exception 'Refused: the source returned no %. An empty answer is treated as a failure, never as "everyone left".', case when v.source in ('hubspot', 'generic') then 'matching records' else 'users' end using errcode = 'SY003';
  end if;

  v_cap := coalesce((select safety_cap_percent from public.sync_settings where org_id = v.org_id), 20);
  if v.source in ('hubspot', 'generic') then
    v_base := (select count(*) from public.people where org_id = v.org_id and status = 'active');
    -- people who would lose a value: some set value is empty, or a custom field is removed
    v_risky := (select count(*) from jsonb_array_elements(v.plan -> 'updates') u
                 where exists (select 1 from jsonb_each_text(coalesce(u -> 'set', '{}'::jsonb)) s where s.value = '')
                    or jsonb_array_length(coalesce(u -> 'custom_remove', '[]'::jsonb)) > 0);
  else
    v_base := (select count(*) from public.people where org_id = v.org_id and status = 'active' and source = v.source and external_id is not null);
    v_risky := jsonb_array_length(v.plan -> 'deactivates');
  end if;
  if v_risky > 0 and v_risky * 100 > v_cap * v_base then
    raise exception 'Refused by the safety cap: this would % % of % people (% percent), more than the allowed % percent. Check the source, or raise the cap in Settings if this is really intended.',
      case when v.source in ('hubspot', 'generic') then 'erase values for' else 'deactivate' end, v_risky, v_base, round(v_risky * 100.0 / greatest(v_base, 1)), v_cap using errcode = 'SY002';
  end if;

  if v.source in ('google', 'microsoft') then
    with ins as (
      insert into public.people (org_id, email, full_name, first_name, last_name, title, department, phone, mobile, location, status, source, external_id)
      select v.org_id, lower(btrim(r.email)), r.full_name, coalesce(r.first_name, ''), coalesce(r.last_name, ''), coalesce(r.title, ''), coalesce(r.department, ''),
             coalesce(r.phone, ''), coalesce(r.mobile, ''), coalesce(r.location, ''), 'active', v.source, nullif(r.external_id, '')
        from jsonb_to_recordset(v.plan -> 'creates') as r(email text, full_name text, first_name text, last_name text, title text, department text, phone text, mobile text, location text, external_id text)
      on conflict do nothing
      returning 1
    )
    select count(*) into v_created from ins;
    v_skipped := jsonb_array_length(v.plan -> 'creates') - v_created;   -- someone typed the same address in the meantime
  end if;

  with upd as (
    update public.people p set
      email       = case when u."set" ? 'email' then lower(btrim(u."set" ->> 'email')) else p.email end,
      full_name   = case when u."set" ? 'full_name' then u."set" ->> 'full_name' else p.full_name end,
      first_name  = case when u."set" ? 'first_name' then u."set" ->> 'first_name' else p.first_name end,
      last_name   = case when u."set" ? 'last_name' then u."set" ->> 'last_name' else p.last_name end,
      title       = case when u."set" ? 'title' then u."set" ->> 'title' else p.title end,
      department  = case when u."set" ? 'department' then u."set" ->> 'department' else p.department end,
      phone       = case when u."set" ? 'phone' then u."set" ->> 'phone' else p.phone end,
      mobile      = case when u."set" ? 'mobile' then u."set" ->> 'mobile' else p.mobile end,
      location    = case when u."set" ? 'location' then u."set" ->> 'location' else p.location end,
      status      = case when u."set" ? 'status' and u."set" ->> 'status' in ('active', 'inactive') then u."set" ->> 'status' else p.status end,
      source      = case when v.source in ('google', 'microsoft') and u."set" ? 'source' and u."set" ->> 'source' = v.source then v.source else p.source end,
      external_id = case when v.source in ('google', 'microsoft') and u."set" ? 'external_id' then nullif(u."set" ->> 'external_id', '') else p.external_id end,
      custom      = (p.custom - coalesce(array(select jsonb_array_elements_text(coalesce(u.custom_remove, '[]'::jsonb))), '{}'::text[])) || coalesce(u.custom_set, '{}'::jsonb)
    from jsonb_to_recordset(v.plan -> 'updates') as u(person_id uuid, "set" jsonb, custom_set jsonb, custom_remove jsonb)
    where p.id = u.person_id and p.org_id = v.org_id
    returning 1
  )
  select count(*) into v_updated from upd;
  v_skipped := v_skipped + (jsonb_array_length(v.plan -> 'updates') - v_updated);

  if v.source in ('google', 'microsoft') then
    with dea as (
      update public.people p set status = 'inactive'
       where p.org_id = v.org_id and p.source = v.source and p.status = 'active'
         and p.id in (select (d ->> 'person_id')::uuid from jsonb_array_elements(v.plan -> 'deactivates') d)
      returning 1
    )
    select count(*) into v_deactivated from dea;
  end if;

  update public.sync_previews set status = 'applied', applied_at = now(), applied_by = p_actor where id = v.id;

  v_import_source := case when v.source in ('hubspot', 'generic') then 'crm' else v.source end;
  insert into public.people_imports (org_id, created_by, filename, source, total_rows, created, updated, skipped)
  values (v.org_id, p_actor, left('sync:' || v.source, 200), v_import_source, v.fetched_count, v_created, v_updated + v_deactivated, v_skipped);

  v_stats := coalesce(v.stats, '{}'::jsonb) || jsonb_build_object('applied_created', v_created, 'applied_updated', v_updated, 'applied_deactivated', v_deactivated, 'applied_skipped', v_skipped);
  insert into public.sync_runs (org_id, source, trigger, status, preview_id, created_by, stats, errors, message)
  values (v.org_id, v.source, p_trigger, 'applied', v.id, p_actor, v_stats, v.errors,
          format('Applied: %s created, %s updated, %s deactivated.', v_created, v_updated, v_deactivated));
  return v_stats;
end $$;

-- A run that did not change anything: a fetch that failed, or an apply the safety rules refused.
create function public.sync_log_impl(p_org uuid, p_source text, p_status text, p_trigger text, p_message text, p_stats jsonb, p_errors jsonb, p_preview uuid, p_actor uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_source not in ('google', 'microsoft', 'hubspot', 'generic') or p_status not in ('blocked', 'failed') or p_trigger not in ('manual', 'cron') then
    raise exception 'Invalid history entry.' using errcode = 'SY006';
  end if;
  insert into public.sync_runs (org_id, source, trigger, status, preview_id, created_by, message, stats, errors)
  values (p_org, p_source, p_trigger, p_status, (select id from public.sync_previews where id = p_preview and org_id = p_org), p_actor,
          left(coalesce(p_message, ''), 500), coalesce(p_stats, '{}'::jsonb), coalesce(p_errors, '[]'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

/* ------------------------------------------------------------ entry points for admins */

create function public.save_sync_preview(p_org uuid, p_source text, p_plan jsonb, p_stats jsonb, p_fetched integer, p_errors jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_org_admin(p_org) then raise exception 'You do not have permission to do that.' using errcode = 'SY007'; end if;
  return public.sync_save_preview_impl(p_org, p_source, p_plan, p_stats, p_fetched, p_errors, 'manual', auth.uid());
end $$;

create function public.apply_sync_preview(p_preview uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.sync_previews where id = p_preview;
  if v_org is null or auth.uid() is null or not public.is_org_admin(v_org) then raise exception 'You do not have permission to do that.' using errcode = 'SY007'; end if;
  return public.sync_apply_impl(p_preview, auth.uid(), 'manual');
end $$;

create function public.log_sync_event(p_org uuid, p_source text, p_status text, p_message text, p_stats jsonb, p_errors jsonb, p_preview uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_org_admin(p_org) then raise exception 'You do not have permission to do that.' using errcode = 'SY007'; end if;
  return public.sync_log_impl(p_org, p_source, p_status, 'manual', p_message, p_stats, p_errors, p_preview, auth.uid());
end $$;

/* ------------------------------------------------- entry points for unattended runs (service role) */

create function public.save_sync_preview_service(p_org uuid, p_source text, p_plan jsonb, p_stats jsonb, p_fetched integer, p_errors jsonb) returns uuid
language sql volatile security definer set search_path = '' as $$
  select public.sync_save_preview_impl(p_org, p_source, p_plan, p_stats, p_fetched, p_errors, 'cron', null)
$$;

create function public.apply_sync_preview_service(p_preview uuid) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select public.sync_apply_impl(p_preview, null, 'cron')
$$;

create function public.log_sync_event_service(p_org uuid, p_source text, p_status text, p_message text, p_stats jsonb, p_errors jsonb, p_preview uuid) returns uuid
language sql volatile security definer set search_path = '' as $$
  select public.sync_log_impl(p_org, p_source, p_status, 'cron', p_message, p_stats, p_errors, p_preview, null)
$$;

-- Is a feature switched on for the organization as a whole? (An org override wins, otherwise the flag's default for admins.)
-- Cron has no signed-in user, so per-user overrides cannot apply there.
create function public.sync_feature_on(p_org uuid, p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select fo.enabled from public.feature_overrides fo where fo.subject_type = 'org' and fo.subject_id = p_org and fo.feature = p_feature),
    (select f.default_enabled and f.min_role <= 'admin' from public.feature_flags f where f.feature = p_feature),
    false)
$$;

/* ------------------------------------------------------------------------ row security */

alter table public.sync_settings enable row level security;
alter table public.sync_sources  enable row level security;
alter table public.sync_previews enable row level security;
alter table public.sync_runs     enable row level security;

create policy "sync_settings: org admin read" on public.sync_settings for select to authenticated using (public.is_org_admin(org_id));
create policy "sync_settings: org admin insert" on public.sync_settings for insert to authenticated with check (public.is_org_admin(org_id));
create policy "sync_settings: org admin update" on public.sync_settings for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create policy "sync_sources: org admin read" on public.sync_sources for select to authenticated using (public.is_org_admin(org_id));
create policy "sync_sources: org admin insert" on public.sync_sources for insert to authenticated with check (public.is_org_admin(org_id));
create policy "sync_sources: org admin update" on public.sync_sources for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create policy "sync_previews: org admin read" on public.sync_previews for select to authenticated using (public.is_org_admin(org_id));
create policy "sync_runs: org admin read" on public.sync_runs for select to authenticated using (public.is_org_admin(org_id));

/* -------------------------------------------------------------------------- privileges */

revoke all on public.sync_settings, public.sync_sources, public.sync_previews, public.sync_runs from anon, authenticated;
grant select, insert, update on public.sync_settings, public.sync_sources to authenticated;
grant select on public.sync_previews, public.sync_runs to authenticated;

revoke execute on function
  public.sync_runs_append_only(), public.sync_lock(uuid, text),
  public.sync_save_preview_impl(uuid, text, jsonb, jsonb, integer, jsonb, text, uuid), public.sync_apply_impl(uuid, uuid, text),
  public.sync_log_impl(uuid, text, text, text, text, jsonb, jsonb, uuid, uuid),
  public.save_sync_preview(uuid, text, jsonb, jsonb, integer, jsonb), public.apply_sync_preview(uuid), public.log_sync_event(uuid, text, text, text, jsonb, jsonb, uuid),
  public.save_sync_preview_service(uuid, text, jsonb, jsonb, integer, jsonb), public.apply_sync_preview_service(uuid),
  public.log_sync_event_service(uuid, text, text, text, jsonb, jsonb, uuid), public.sync_feature_on(uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.save_sync_preview(uuid, text, jsonb, jsonb, integer, jsonb), public.apply_sync_preview(uuid), public.log_sync_event(uuid, text, text, text, jsonb, jsonb, uuid)
  to authenticated;

-- The service role (Supabase's server-side key, used by the cron endpoint) gets exactly what cron needs. The role exists on
-- Supabase; the guard only lets this file also run on a plain Postgres (tests) where it does not.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.sync_settings, public.sync_sources, public.sync_previews to service_role;
    grant execute on function
      public.save_sync_preview_service(uuid, text, jsonb, jsonb, integer, jsonb), public.apply_sync_preview_service(uuid),
      public.log_sync_event_service(uuid, text, text, text, jsonb, jsonb, uuid), public.sync_feature_on(uuid, text)
      to service_role;
  end if;
end $$;
