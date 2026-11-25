-- SignCraft deploy and rules: bulk deployment of approved signatures (Gmail), a record of generated Exchange scripts,
-- and signature rules (which brand template applies when). Run after 0009 (uses people, brand_templates,
-- signature_versions and the is_org_admin helper from 0006). See docs/deploy-and-rules.md.
--
-- Access model
--   * Only org admins can read these tables. Nothing here is readable across organizations.
--   * deployments and deployment_items have NO insert/update/delete privilege for the browser roles. Rows appear and
--     change only through the functions below, and triggers enforce the state machine and what can never change:
--       - an item is only ever for a person that was in the confirmed plan (people are looked up in the database, not taken from the caller)
--       - the first recorded copy of the previous signature (the backup used for rollback) never changes
--       - an item cannot be marked done without that backup; done and skipped are final
--       - a finished deployment can only be re-opened by retrying its failed items; one running deployment per organization and target
--       - a deployment can be rolled back once, and only after it has finished
--   * signature_rules is plain admin CRUD (row-level security) with a trigger that keeps the template in the same organization.

/* --------------------------------------------------------------------------- tables */

create table public.signature_rules (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  message_kind text not null default 'any' check (message_kind in ('any', 'new', 'reply', 'forward')),
  audience     text not null default 'any' check (audience in ('any', 'internal', 'external')),
  departments  text[] not null default '{}' check (cardinality(departments) <= 20),   -- empty: any department
  priority     integer not null default 100 check (priority between 0 and 1000),       -- higher wins
  template_id  uuid not null references public.brand_templates (id) on delete cascade,
  is_active    boolean not null default true,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index signature_rules_org_idx on public.signature_rules (org_id, priority desc, created_at);
create trigger signature_rules_touch before update on public.signature_rules for each row execute function public.touch_updated_at();

create function public.signature_rules_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.brand_templates t where t.id = new.template_id and t.org_id = new.org_id) then
    raise exception 'That template does not belong to this organization.' using errcode = 'DP003';
  end if;
  return new;
end $$;
create trigger signature_rules_guard before insert or update on public.signature_rules for each row execute function public.signature_rules_guard();

create table public.deployments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  target        text not null check (target in ('gmail', 'exchange')),
  -- deploy: write signatures. rollback: restore the previous ones of rollback_of. script: a generated Exchange script (nothing is run by SignCraft).
  kind          text not null default 'deploy' check (kind in ('deploy', 'rollback', 'script')),
  rollback_of   uuid references public.deployments (id) on delete restrict,
  status        text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed', 'cancelled', 'generated')),
  fingerprint   text not null check (char_length(fingerprint) between 8 and 200),   -- of the confirmed plan (or of the generated script)
  note          text not null default '' check (char_length(note) <= 300),
  total         integer not null default 0 check (total >= 0),
  done          integer not null default 0 check (done >= 0),
  failed        integer not null default 0 check (failed >= 0),
  skipped       integer not null default 0 check (skipped >= 0),
  pending       integer not null default 0 check (pending >= 0),   -- waiting or in flight
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  finished_at   timestamptz,
  updated_at    timestamptz not null default now(),
  check ((kind = 'rollback') = (rollback_of is not null)),
  check ((kind = 'script') = (status = 'generated')),
  check (kind <> 'script' or target = 'exchange')
);
create unique index deployments_one_running on public.deployments (org_id, target) where status = 'running';
create unique index deployments_one_rollback on public.deployments (rollback_of) where kind = 'rollback' and status <> 'cancelled';
create index deployments_org_idx on public.deployments (org_id, created_at desc);
create trigger deployments_touch before update on public.deployments for each row execute function public.touch_updated_at();

create table public.deployment_items (
  id                   uuid primary key default gen_random_uuid(),
  deployment_id        uuid not null references public.deployments (id) on delete cascade,
  org_id               uuid not null references public.organizations (id) on delete cascade,
  person_id            uuid references public.people (id) on delete set null,
  email                text not null check (char_length(email) between 3 and 254),   -- copied from the directory when the deployment was created
  person_name          text not null default '' check (char_length(person_name) <= 120),
  version_id           uuid references public.signature_versions (id) on delete set null,   -- the approved version that was planned
  action               text not null check (action in ('set', 'replace', 'restore', 'skip')),
  status               text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'skipped')),
  expect_hash          text check (expect_hash is null or char_length(expect_hash) = 64),   -- hash the live signature must have for the write to go ahead
  new_hash             text check (new_hash is null or char_length(new_hash) = 64),
  previous_hash        text check (previous_hash is null or char_length(previous_hash) = 64),
  previous_signature   text check (previous_signature is null or char_length(previous_signature) <= 10000),   -- the backup used by rollback
  previous_known       boolean not null default false,
  previous_truncated   boolean not null default false,
  new_signature        text check (new_signature is null or char_length(new_signature) <= 10000),   -- only for restore items
  error_code           text not null default '' check (char_length(error_code) <= 40),
  error                text not null default '' check (char_length(error) <= 300),
  attempts             integer not null default 0 check (attempts >= 0),
  started_at           timestamptz,
  finished_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (deployment_id, email),
  check (action <> 'restore' or new_signature is not null),
  check (status <> 'done' or action = 'skip' or previous_known)
);
create index deployment_items_dep_idx on public.deployment_items (deployment_id, status);
create index deployment_items_person_idx on public.deployment_items (person_id) where person_id is not null;
create trigger deployment_items_touch before update on public.deployment_items for each row execute function public.touch_updated_at();

/* ------------------------------------------------------------------------ triggers */

create function public.deployments_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.org_id, new.target, new.kind, new.rollback_of, new.fingerprint, new.created_by, new.created_at)
     is distinct from (old.id, old.org_id, old.target, old.kind, old.rollback_of, old.fingerprint, old.created_by, old.created_at) then
    raise exception 'A deployment record cannot be edited.' using errcode = 'DP004';
  end if;
  if new.status <> old.status then
    if old.status = 'running' and new.status in ('succeeded', 'partial', 'failed', 'cancelled') then null;
    elsif old.status in ('partial', 'failed') and new.status = 'running' then null;   -- retrying failed items
    else raise exception 'A % deployment cannot become %.', old.status, new.status using errcode = 'DP004';
    end if;
  end if;
  return new;
end $$;
create trigger deployments_guard before update on public.deployments for each row execute function public.deployments_guard();

create function public.deployment_items_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.deployment_id, new.org_id, new.person_id, new.email, new.person_name, new.version_id, new.action, new.expect_hash, new.new_hash, new.new_signature, new.created_at)
     is distinct from (old.id, old.deployment_id, old.org_id, old.person_id, old.email, old.person_name, old.version_id, old.action, old.expect_hash, old.new_hash, old.new_signature, old.created_at) then
    -- person_id may become null when the person is deleted from the directory; nothing else may change
    if not (new.person_id is null and old.person_id is not null and (new.id, new.deployment_id, new.org_id, new.email, new.person_name, new.version_id, new.action, new.expect_hash, new.new_hash, new.new_signature, new.created_at)
            is not distinct from (old.id, old.deployment_id, old.org_id, old.email, old.person_name, old.version_id, old.action, old.expect_hash, old.new_hash, old.new_signature, old.created_at)) then
      -- version_id is set null by the foreign key when a version is removed with its person
      if not (new.version_id is null and old.version_id is not null and (new.id, new.deployment_id, new.org_id, new.person_id, new.email, new.person_name, new.action, new.expect_hash, new.new_hash, new.new_signature, new.created_at)
              is not distinct from (old.id, old.deployment_id, old.org_id, old.person_id, old.email, old.person_name, old.action, old.expect_hash, old.new_hash, old.new_signature, old.created_at)) then
        raise exception 'A deployment item cannot be edited.' using errcode = 'DP004';
      end if;
    end if;
  end if;
  if old.previous_known and (new.previous_signature is distinct from old.previous_signature or new.previous_known is distinct from old.previous_known or new.previous_truncated is distinct from old.previous_truncated) then
    raise exception 'The backup of the previous signature cannot change.' using errcode = 'DP004';
  end if;
  if old.status in ('done', 'skipped') and (new.status <> old.status) then
    raise exception 'A % item is final.', old.status using errcode = 'DP004';
  end if;
  if new.status <> old.status and not (
       (old.status = 'pending' and new.status in ('running', 'skipped'))
    or (old.status = 'running' and new.status in ('done', 'failed', 'skipped', 'pending'))
    or (old.status = 'failed' and new.status = 'pending')) then
    raise exception 'A % item cannot become %.', old.status, new.status using errcode = 'DP004';
  end if;
  return new;
end $$;
create trigger deployment_items_guard before update on public.deployment_items for each row execute function public.deployment_items_guard();

/* ----------------------------------------------------------------------- functions */

-- Recounts the items and moves the deployment status. Internal: called only by the functions below.
create function public.refresh_deployment(p_dep uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  c record;
  v public.deployments;
begin
  select * into v from public.deployments where id = p_dep;
  select count(*) as total, count(*) filter (where status = 'done') as done, count(*) filter (where status = 'failed') as failed,
         count(*) filter (where status = 'skipped') as skipped, count(*) filter (where status in ('pending', 'running')) as pending
    into c from public.deployment_items where deployment_id = p_dep;
  update public.deployments d set
    total = c.total, done = c.done, failed = c.failed, skipped = c.skipped, pending = c.pending,
    status = case
      when c.pending > 0 and v.cancelled_at is null then 'running'
      when c.pending > 0 then 'running'
      when v.cancelled_at is not null then 'cancelled'
      when c.failed > 0 and c.done > 0 then 'partial'
      when c.failed > 0 then 'failed'
      else 'succeeded' end,
    finished_at = case when c.pending = 0 then coalesce(d.finished_at, now()) else null end
   where d.id = p_dep;
end $$;

-- Create a deployment from a confirmed plan. Items name people by id only; e-mail and name come from the directory and
-- every person must be an active member of the directory of THIS organization.
-- p_items: [{person_id, version_id, action: set|replace|skip, status: pending|skipped, expect_hash, new_hash, previous_hash, error_code, error}]
create function public.create_deployment(p_org uuid, p_target text, p_fingerprint text, p_items jsonb, p_note text default '') returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_n integer;
  v_found integer;
begin
  if auth.uid() is null or not public.is_org_admin(p_org) then raise exception 'You do not have permission to do that.' using errcode = 'DP006'; end if;
  if p_target <> 'gmail' then raise exception 'Unknown target.' using errcode = 'DP003'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 2000 then
    raise exception 'A deployment needs between 1 and 2000 people.' using errcode = 'DP003';
  end if;
  v_n := jsonb_array_length(p_items);

  create temporary table pg_temp.dep_items on commit drop as
    select r.person_id, r.version_id, r.action, r.status, r.expect_hash, r.new_hash, r.previous_hash, left(coalesce(r.error_code, ''), 40) as error_code, left(coalesce(r.error, ''), 300) as error
      from jsonb_to_recordset(p_items) as r(person_id uuid, version_id uuid, action text, status text, expect_hash text, new_hash text, previous_hash text, error_code text, error text);

  if exists (select 1 from pg_temp.dep_items where action not in ('set', 'replace', 'skip') or status not in ('pending', 'skipped') or (status = 'pending' and (action = 'skip' or new_hash is null or expect_hash is null)))
  then raise exception 'The plan contains an item that is not allowed.' using errcode = 'DP003'; end if;
  select count(*) into v_found from pg_temp.dep_items i join public.people p on p.id = i.person_id and p.org_id = p_org;
  if v_found <> v_n or (select count(distinct person_id) from pg_temp.dep_items) <> v_n then
    raise exception 'The plan names someone who is not in this organization''s directory (or names someone twice).' using errcode = 'DP003';
  end if;
  if exists (select 1 from pg_temp.dep_items i where i.version_id is not null and not exists (select 1 from public.signature_versions sv where sv.id = i.version_id and sv.person_id = i.person_id and sv.org_id = p_org and sv.status = 'approved')) then
    raise exception 'The plan names a version that is not an approved signature of that person.' using errcode = 'DP003';
  end if;

  insert into public.deployments (org_id, target, kind, status, fingerprint, note, created_by)
  values (p_org, p_target, 'deploy', 'running', p_fingerprint, left(coalesce(p_note, ''), 300), auth.uid())
  returning id into v_id;

  insert into public.deployment_items (deployment_id, org_id, person_id, email, person_name, version_id, action, status, expect_hash, new_hash, previous_hash, error_code, error, finished_at)
  select v_id, p_org, i.person_id, p.email, left(p.full_name, 120), i.version_id, i.action, i.status, i.expect_hash, i.new_hash, i.previous_hash, i.error_code, i.error,
         case when i.status = 'skipped' then now() end
    from pg_temp.dep_items i join public.people p on p.id = i.person_id;
  drop table pg_temp.dep_items;

  perform public.refresh_deployment(v_id);
  return v_id;
end $$;

-- Hands out the next items to work on (and takes back ones stuck "running" for over 5 minutes, e.g. after a crash).
create function public.claim_deployment_items(p_dep uuid, p_limit integer default 10) returns setof public.deployment_items
language plpgsql volatile security definer set search_path = '' as $$
declare v public.deployments;
begin
  select * into v from public.deployments where id = p_dep;
  if not found then raise exception 'That deployment does not exist.' using errcode = 'DP001'; end if;
  if auth.uid() is null or not public.is_org_admin(v.org_id) then raise exception 'You do not have permission to do that.' using errcode = 'DP006'; end if;
  if v.status <> 'running' or v.cancelled_at is not null then return; end if;
  return query
    with c as (
      select i.id from public.deployment_items i
       where i.deployment_id = p_dep and (i.status = 'pending' or (i.status = 'running' and i.started_at < now() - interval '5 minutes'))
       order by i.created_at, i.id
       limit greatest(1, least(coalesce(p_limit, 10), 50))
       for update skip locked
    )
    update public.deployment_items i set status = 'running', attempts = i.attempts + 1, started_at = now(), error_code = '', error = ''
      from c where i.id = c.id
    returning i.*;
end $$;

-- Saves the live signature BEFORE it is overwritten. Only the first copy counts (a retry after a crash must not replace the backup).
create function public.record_previous_signature(p_item uuid, p_signature text, p_truncated boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.deployment_items;
begin
  select * into v from public.deployment_items where id = p_item for update;
  if not found then raise exception 'That item does not exist.' using errcode = 'DP001'; end if;
  if auth.uid() is null or not public.is_org_admin(v.org_id) then raise exception 'You do not have permission to do that.' using errcode = 'DP006'; end if;
  if v.status <> 'running' then raise exception 'That item is not being worked on.' using errcode = 'DP004'; end if;
  if v.previous_known then return; end if;
  update public.deployment_items set previous_signature = left(coalesce(p_signature, ''), 10000), previous_known = true,
         previous_truncated = coalesce(p_truncated, false) or char_length(coalesce(p_signature, '')) > 10000
   where id = p_item;
end $$;

create function public.finish_deployment_item(p_item uuid, p_status text, p_error_code text, p_error text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.deployment_items;
begin
  select * into v from public.deployment_items where id = p_item for update;
  if not found then raise exception 'That item does not exist.' using errcode = 'DP001'; end if;
  if auth.uid() is null or not public.is_org_admin(v.org_id) then raise exception 'You do not have permission to do that.' using errcode = 'DP006'; end if;
  if p_status not in ('done', 'failed', 'skipped') then raise exception 'Unknown status.' using errcode = 'DP003'; end if;
  if v.status <> 'running' then raise exception 'That item is not being worked on.' using errcode = 'DP004'; end if;
  update public.deployment_items set status = p_status, error_code = left(coalesce(p_error_code, ''), 40), error = left(coalesce(p_error, ''), 300), finished_at = now()
   where id = p_item;
  perform public.refresh_deployment(v.deployment_id);
end $$;

-- Puts an item back in the queue without counting it as a failure (Google asked us to slow down).
create function public.release_deployment_item(p_item uuid, p_error_code text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.deployment_items;
begin
  select * into v from public.deployment_items where id = p_item for update;
  if not found then raise exception 'That item does not exist.' using errcode = 'DP001'; end if;
  if auth.uid() is null or not public.is_org_admin(v.org_id) then raise exception 'You do not have permission to do that.' using errcode = 'DP006'; end if;
  if v.status <> 'running' then raise exception 'That item is not being worked on.' using errcode = 'DP004'; end if;
  update public.deployment_items set status = 'pending', error_code = left(coalesce(p_error_code, ''), 40), started_at = null where id = p_item;
end $$;

-- Puts the failed items of a finished deployment back in the queue. Done and skipped items are never touched.
create function public.retry_failed_items(p_dep uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v public.deployments; n integer;
begin
  select * into v from public.deployments where id = p_dep for update;
  if not found then raise exception 'That deployment does not exist.' using errcode = 'DP001'; end if;
  if auth.uid() is null or not public.is_org_admin(v.org_id) then raise exception 'You do not have permission to do that.' using errcode = 'DP006'; end if;
  if v.status not in ('partial', 'failed') or v.cancelled_at is not null then raise exception 'There is nothing to retry.' using errcode = 'DP004'; end if;
  update public.deployment_items set status = 'pending', finished_at = null where deployment_id = p_dep and status = 'failed';
  get diagnostics n = row_count;
  perform public.refresh_deployment(p_dep);
  return n;
end $$;

-- Stops a running deployment: items not started yet are skipped; one already in flight finishes.
create function public.cancel_deployment(p_dep uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.deployments;
begin
  select * into v from public.deployments where id = p_dep for update;
  if not found then raise exception 'That deployment does not exist.' using errcode = 'DP001'; end if;
  if auth.uid() is null or not public.is_org_admin(v.org_id) then raise exception 'You do not have permission to do that.' using errcode = 'DP006'; end if;
  if v.status <> 'running' then raise exception 'Only a running deployment can be cancelled.' using errcode = 'DP004'; end if;
  update public.deployments set cancelled_at = now() where id = p_dep;
  update public.deployment_items set status = 'skipped', error_code = 'cancelled', error = 'The deployment was cancelled before this person was reached.', finished_at = now()
   where deployment_id = p_dep and status = 'pending';
  perform public.refresh_deployment(p_dep);
end $$;

-- Rollback: a NEW deployment (kind rollback) that restores the saved previous signature of every item that was done.
-- p_expected is the number the admin confirmed; a different number now means the situation changed and nothing is created.
-- The write itself is guarded at run time: a signature that is no longer the one we deployed (someone changed it) is left alone.
create function public.create_rollback(p_dep uuid, p_expected integer) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.deployments;
  v_id uuid;
  v_n integer;
begin
  select * into v from public.deployments where id = p_dep for update;
  if not found then raise exception 'That deployment does not exist.' using errcode = 'DP001'; end if;
  if auth.uid() is null or not public.is_org_admin(v.org_id) then raise exception 'You do not have permission to do that.' using errcode = 'DP006'; end if;
  if v.kind <> 'deploy' then raise exception 'Only a deployment can be rolled back.' using errcode = 'DP004'; end if;
  if v.status = 'running' then raise exception 'Wait for the deployment to finish (or cancel it) before rolling it back.' using errcode = 'DP004'; end if;
  if exists (select 1 from public.deployments r where r.rollback_of = p_dep and r.status <> 'cancelled') then raise exception 'This deployment was already rolled back.' using errcode = 'DP004'; end if;

  select count(*) into v_n from public.deployment_items where deployment_id = p_dep and status = 'done' and action in ('set', 'replace') and previous_known and not previous_truncated;
  if v_n = 0 then raise exception 'There is nothing to restore.' using errcode = 'DP005'; end if;
  if p_expected is distinct from v_n then raise exception 'The number of signatures to restore is now %, not %. Review it again.', v_n, p_expected using errcode = 'DP005'; end if;

  insert into public.deployments (org_id, target, kind, rollback_of, status, fingerprint, note, created_by)
  values (v.org_id, v.target, 'rollback', p_dep, 'running', 'rollback:' || p_dep::text, 'Restores the signatures replaced by deployment ' || left(p_dep::text, 8) || '.', auth.uid())
  returning id into v_id;

  insert into public.deployment_items (deployment_id, org_id, person_id, email, person_name, version_id, action, status, expect_hash, new_hash, new_signature, error_code, error, finished_at)
  select v_id, i.org_id, i.person_id, i.email, i.person_name, null, case when i.status = 'done' and i.previous_known and not i.previous_truncated and i.action in ('set', 'replace') then 'restore' else 'skip' end,
         case when i.status = 'done' and i.previous_known and not i.previous_truncated and i.action in ('set', 'replace') then 'pending' else 'skipped' end,
         case when i.status = 'done' and i.previous_known and not i.previous_truncated and i.action in ('set', 'replace') then i.new_hash end,
         case when i.status = 'done' and i.previous_known and not i.previous_truncated and i.action in ('set', 'replace') then i.previous_hash end,
         case when i.status = 'done' and i.previous_known and not i.previous_truncated and i.action in ('set', 'replace') then i.previous_signature end,
         case when i.status = 'done' and i.previous_known and not i.previous_truncated and i.action in ('set', 'replace') then ''
              when i.status = 'done' and i.previous_truncated then 'no_backup' else 'not_deployed' end,
         case when i.status = 'done' and i.previous_known and not i.previous_truncated and i.action in ('set', 'replace') then ''
              when i.status = 'done' and i.previous_truncated then 'The previous signature was too long to save, so it cannot be restored.' else 'This person was not changed by the deployment.' end,
         case when i.status = 'done' and i.previous_known and not i.previous_truncated and i.action in ('set', 'replace') then null else now() end
    from public.deployment_items i
   where i.deployment_id = p_dep;
  -- an item whose backup hash is missing cannot be verified; the check constraints above guard the rest
  perform public.refresh_deployment(v_id);
  return v_id;
end $$;

-- Remember that an Exchange script was generated (SignCraft never runs it).
create function public.record_script(p_org uuid, p_fingerprint text, p_note text default '') returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.is_org_admin(p_org) then raise exception 'You do not have permission to do that.' using errcode = 'DP006'; end if;
  insert into public.deployments (org_id, target, kind, status, fingerprint, note, created_by, finished_at)
  values (p_org, 'exchange', 'script', 'generated', p_fingerprint, left(coalesce(p_note, ''), 300), auth.uid(), now())
  returning id into v_id;
  return v_id;
end $$;

/* ------------------------------------------------------------------- row security */

alter table public.signature_rules   enable row level security;
alter table public.deployments       enable row level security;
alter table public.deployment_items  enable row level security;

create policy "signature_rules: org admin read" on public.signature_rules for select to authenticated using (public.is_org_admin(org_id));
create policy "signature_rules: org admin insert" on public.signature_rules for insert to authenticated with check (public.is_org_admin(org_id));
create policy "signature_rules: org admin update" on public.signature_rules for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy "signature_rules: org admin delete" on public.signature_rules for delete to authenticated using (public.is_org_admin(org_id));

create policy "deployments: org admin read" on public.deployments for select to authenticated using (public.is_org_admin(org_id));
create policy "deployment_items: org admin read" on public.deployment_items for select to authenticated using (public.is_org_admin(org_id));

/* ------------------------------------------------------------------------ privileges */

revoke all on public.signature_rules, public.deployments, public.deployment_items from anon, authenticated;
grant select, insert, update, delete on public.signature_rules to authenticated;
grant select on public.deployments, public.deployment_items to authenticated;

revoke execute on function
  public.signature_rules_guard(), public.deployments_guard(), public.deployment_items_guard(), public.refresh_deployment(uuid),
  public.create_deployment(uuid, text, text, jsonb, text), public.claim_deployment_items(uuid, integer), public.record_previous_signature(uuid, text, boolean),
  public.finish_deployment_item(uuid, text, text, text), public.release_deployment_item(uuid, text), public.retry_failed_items(uuid), public.cancel_deployment(uuid),
  public.create_rollback(uuid, integer), public.record_script(uuid, text, text)
  from public, anon;
grant execute on function
  public.create_deployment(uuid, text, text, jsonb, text), public.claim_deployment_items(uuid, integer), public.record_previous_signature(uuid, text, boolean),
  public.finish_deployment_item(uuid, text, text, text), public.release_deployment_item(uuid, text), public.retry_failed_items(uuid), public.cancel_deployment(uuid),
  public.create_rollback(uuid, integer), public.record_script(uuid, text, text)
  to authenticated;
