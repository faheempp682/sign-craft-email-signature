-- SignCraft signature health monitor: notices when a Gmail signature that SignCraft deployed was edited or removed.
-- Run after 0010 (uses deployments, deployment_items, people and public.is_org_admin). See docs/health-monitor.md.
--
-- Access model
--   * Only org admins can read these tables, and only their own organization's rows.
--   * NO insert/update/delete privilege for the browser roles on any table. Everything changes through the functions below.
--   * Every operation has an admin entry point (auth.uid() must be an admin of the organization) and, where the unattended run
--     needs it, a *_service entry point (no user; execute is granted to service_role only). Both call the same *_impl function.
--   * The *_impl functions are never granted to anyone.
--   * Nothing here stores a signature body: only hashes (sha256 of the normalised HTML and of the normalised text), a short
--     human reason and the person's e-mail and name copied from the directory so a finding stays readable if they are removed.
--   * Findings: at most ONE open-or-acknowledged finding per person (unique index). open -> resolved | acknowledged,
--     acknowledged -> resolved | open (when the problem gets worse), resolved is final.

/* --------------------------------------------------------------------------- tables */

create table public.health_settings (
  org_id                uuid primary key references public.organizations (id) on delete cascade,
  enabled               boolean not null default false,   -- unattended (cron) checks; "Run check now" always works
  webhook_url           text check (webhook_url is null or (char_length(webhook_url) <= 500 and webhook_url ~ '^https://[^\s]+$')),
  webhook_include_names boolean not null default false,
  max_people            integer not null default 1000 check (max_people between 1 and 1000),
  rotate_cursor         uuid,   -- where the next run continues when the last one stopped at the cap
  updated_by            uuid references auth.users (id) on delete set null,
  updated_at            timestamptz not null default now()
);

create table public.health_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  trigger       text not null check (trigger in ('manual', 'cron')),
  status        text not null default 'running' check (status in ('running', 'completed', 'failed', 'abandoned')),
  cursor        uuid,   -- the last person id handled: a run resumes after it
  checked       integer not null default 0 check (checked >= 0),
  ok            integer not null default 0 check (ok >= 0),
  edited        integer not null default 0 check (edited >= 0),
  removed       integer not null default 0 check (removed >= 0),
  unreachable   integer not null default 0 check (unreachable >= 0),
  reformatted   integer not null default 0 check (reformatted >= 0),
  new_findings  integer not null default 0 check (new_findings >= 0),
  resolved      integer not null default 0 check (resolved >= 0),
  capped        boolean not null default false,
  note          text not null default '' check (char_length(note) <= 300),
  notified_at   timestamptz,
  created_by    uuid references auth.users (id) on delete set null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  updated_at    timestamptz not null default now()
);
create unique index health_runs_one_running on public.health_runs (org_id) where status = 'running';
create index health_runs_org_idx on public.health_runs (org_id, started_at desc);

-- The last known state of each monitored person, including the BASELINE (the live signature as Gmail stored it).
create table public.health_people (
  person_id         uuid primary key references public.people (id) on delete cascade,
  org_id            uuid not null references public.organizations (id) on delete cascade,
  item_id           uuid not null references public.deployment_items (id) on delete cascade,   -- the deployment the baseline belongs to
  baseline_hash     text check (baseline_hash is null or char_length(baseline_hash) = 64),
  baseline_fp       text check (baseline_fp is null or char_length(baseline_fp) = 64),
  baseline_verified boolean not null default false,   -- true when the baseline text was checked equal to the approved text
  status            text not null check (status in ('ok', 'edited', 'removed', 'unreachable')),
  reformatted       boolean not null default false,
  reason            text not null default '' check (char_length(reason) <= 300),
  checked_at        timestamptz not null default now(),
  last_run_id       uuid references public.health_runs (id) on delete set null
);
create index health_people_org_idx on public.health_people (org_id, status);

create table public.health_findings (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  person_id        uuid not null references public.people (id) on delete cascade,
  email            text not null check (char_length(email) between 3 and 254),
  person_name      text not null default '' check (char_length(person_name) <= 120),
  kind             text not null check (kind in ('edited', 'removed')),
  status           text not null default 'open' check (status in ('open', 'resolved', 'acknowledged')),
  item_id          uuid references public.deployment_items (id) on delete set null,
  baseline_hash    text check (baseline_hash is null or char_length(baseline_hash) = 64),
  live_hash        text check (live_hash is null or char_length(live_hash) = 64),
  expected_fp      text check (expected_fp is null or char_length(expected_fp) = 64),
  live_fp          text check (live_fp is null or char_length(live_fp) = 64),
  detail           text not null default '' check (char_length(detail) <= 300),
  run_id           uuid references public.health_runs (id) on delete set null,
  opened_at        timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_reason  text not null default '' check (char_length(resolved_reason) <= 60),
  acknowledged_by  uuid references auth.users (id) on delete set null,
  acknowledged_at  timestamptz,
  ack_note         text not null default '' check (char_length(ack_note) <= 300),
  check (status <> 'resolved' or resolved_at is not null),
  check (status <> 'acknowledged' or (acknowledged_at is not null and char_length(ack_note) >= 1))
);
create unique index health_findings_one_active on public.health_findings (person_id) where status in ('open', 'acknowledged');
create index health_findings_org_idx on public.health_findings (org_id, status, opened_at desc);

/* ------------------------------------------------------------------------ triggers */

create function public.health_findings_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.org_id, new.person_id, new.opened_at) is distinct from (old.id, old.org_id, old.person_id, old.opened_at) then
    raise exception 'A finding cannot be edited.' using errcode = 'HM004';
  end if;
  if new.status <> old.status and not (
       (old.status = 'open' and new.status in ('resolved', 'acknowledged'))
    or (old.status = 'acknowledged' and new.status in ('resolved', 'open'))) then
    raise exception 'A % finding cannot become %.', old.status, new.status using errcode = 'HM004';
  end if;
  if old.status = 'resolved' and (new.kind, new.detail, new.ack_note, new.live_hash) is distinct from (old.kind, old.detail, old.ack_note, old.live_hash) then
    raise exception 'A resolved finding is final.' using errcode = 'HM004';
  end if;
  return new;
end $$;
create trigger health_findings_guard before update on public.health_findings for each row execute function public.health_findings_guard();

create function public.health_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger health_settings_touch before update on public.health_settings for each row execute function public.health_touch();
create trigger health_runs_touch before update on public.health_runs for each row execute function public.health_touch();

/* ----------------------------------------------------------------------- helpers */

-- Is the feature on for the organization as a whole? Cron has no signed-in user, so per-user overrides cannot apply.
create function public.health_feature_on(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select fo.enabled from public.feature_overrides fo where fo.subject_type = 'org' and fo.subject_id = p_org and fo.feature = 'health_monitor'),
    (select f.default_enabled and f.min_role <= 'admin' from public.feature_flags f where f.feature = 'health_monitor'),
    false)
$$;

-- Organizations the unattended run should visit.
create function public.health_enabled_orgs_service() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.org_id from public.health_settings s where s.enabled and public.health_feature_on(s.org_id) order by s.org_id limit 500
$$;

-- The people to monitor: the latest successful (done) Gmail write per active person, unless the latest is a rollback restore
-- (then the person is back to a signature SignCraft did not write). Includes the stored baseline when it belongs to that same item.
create function public.health_candidates_impl(p_org uuid, p_after uuid, p_limit integer) returns table (
  person_id uuid, email text, full_name text, item_id uuid, version_id uuid, new_hash text,
  baseline_hash text, baseline_fp text, baseline_verified boolean
)
language sql stable security definer set search_path = '' as $$
  select l.person_id, l.email, l.full_name, l.item_id, l.version_id, l.new_hash, hp.baseline_hash, hp.baseline_fp, coalesce(hp.baseline_verified, false)
    from (
      select distinct on (i.person_id) i.person_id, p.email, p.full_name, i.id as item_id, i.version_id, i.new_hash, i.action
        from public.deployment_items i
        join public.deployments d on d.id = i.deployment_id
        join public.people p on p.id = i.person_id and p.org_id = p_org
       where i.org_id = p_org and d.org_id = p_org and d.target = 'gmail' and d.kind in ('deploy', 'rollback')
         and i.status = 'done' and i.action in ('set', 'replace', 'restore') and p.status = 'active'
       order by i.person_id, i.finished_at desc nulls last, i.id
    ) l
    left join public.health_people hp on hp.person_id = l.person_id and hp.item_id = l.item_id
   where l.action <> 'restore' and (p_after is null or l.person_id > p_after)
   order by l.person_id
   limit greatest(1, least(coalesce(p_limit, 50), 1000))
$$;

create function public.health_candidates(p_org uuid, p_after uuid, p_limit integer) returns table (
  person_id uuid, email text, full_name text, item_id uuid, version_id uuid, new_hash text,
  baseline_hash text, baseline_fp text, baseline_verified boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_org_admin(p_org) then raise exception 'You do not have permission to do that.' using errcode = 'HM006'; end if;
  return query select * from public.health_candidates_impl(p_org, p_after, p_limit);
end $$;
create function public.health_candidates_service(p_org uuid, p_after uuid, p_limit integer) returns table (
  person_id uuid, email text, full_name text, item_id uuid, version_id uuid, new_hash text,
  baseline_hash text, baseline_fp text, baseline_verified boolean
)
language sql stable security definer set search_path = '' as $$
  select * from public.health_candidates_impl(p_org, p_after, p_limit)
$$;

/* ------------------------------------------------------------------------------ runs */

-- Starts a run, or returns the one already running (a run is resumed, never doubled). A run left running for over 2 hours is abandoned.
create function public.health_start_run_impl(p_org uuid, p_trigger text, p_actor uuid) returns public.health_runs
language plpgsql volatile security definer set search_path = '' as $$
declare r public.health_runs; c uuid;
begin
  update public.health_runs set status = 'abandoned', finished_at = now(), note = 'Stopped: it did not finish within 2 hours.'
   where org_id = p_org and status = 'running' and updated_at < now() - interval '2 hours';
  select * into r from public.health_runs where org_id = p_org and status = 'running';
  if found then return r; end if;
  select s.rotate_cursor into c from public.health_settings s where s.org_id = p_org;
  insert into public.health_runs (org_id, trigger, cursor, created_by) values (p_org, p_trigger, c, p_actor) returning * into r;
  return r;
end $$;
create function public.health_start_run(p_org uuid) returns public.health_runs
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_org_admin(p_org) then raise exception 'You do not have permission to do that.' using errcode = 'HM006'; end if;
  return public.health_start_run_impl(p_org, 'manual', auth.uid());
end $$;
create function public.health_start_run_service(p_org uuid) returns public.health_runs
language sql volatile security definer set search_path = '' as $$
  select * from public.health_start_run_impl(p_org, 'cron', null)
$$;

-- Records a batch of results. p_results: [{person_id, item_id, status, baseline_hash, baseline_fp, baseline_verified, reformatted,
-- reason, live_hash, live_fp, expected_fp, detail}]. People and items are validated against the run's organization; the e-mail and
-- name on a finding come from the directory, never from the caller. Returns the number of NEW findings in this batch.
create function public.health_record_impl(p_run uuid, p_results jsonb, p_cursor uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  run public.health_runs;
  r record; f public.health_findings; pe record;
  n_new integer := 0; n_res integer := 0; n_ok integer := 0; n_ed integer := 0; n_rm integer := 0; n_un integer := 0; n_rf integer := 0; n_all integer := 0;
begin
  select * into run from public.health_runs where id = p_run for update;
  if not found then raise exception 'That run does not exist.' using errcode = 'HM001'; end if;
  if run.status <> 'running' then raise exception 'That run is not running.' using errcode = 'HM004'; end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 200 then raise exception 'Bad batch.' using errcode = 'HM003'; end if;

  for r in
    select * from jsonb_to_recordset(p_results) as x(person_id uuid, item_id uuid, status text, baseline_hash text, baseline_fp text, baseline_verified boolean, reformatted boolean,
                                                    reason text, live_hash text, live_fp text, expected_fp text, detail text)
  loop
    select p.email, p.full_name into pe from public.people p where p.id = r.person_id and p.org_id = run.org_id;
    if not found then raise exception 'The batch names someone who is not in this organization''s directory.' using errcode = 'HM003'; end if;
    if not exists (select 1 from public.deployment_items i where i.id = r.item_id and i.person_id = r.person_id and i.org_id = run.org_id) then
      raise exception 'The batch names a deployment item that is not that person''s.' using errcode = 'HM003';
    end if;
    if r.status not in ('ok', 'edited', 'removed', 'unreachable') then raise exception 'Unknown status.' using errcode = 'HM003'; end if;

    insert into public.health_people as hp (person_id, org_id, item_id, baseline_hash, baseline_fp, baseline_verified, status, reformatted, reason, checked_at, last_run_id)
    values (r.person_id, run.org_id, r.item_id, r.baseline_hash, r.baseline_fp, coalesce(r.baseline_verified, false), r.status, coalesce(r.reformatted, false), left(coalesce(r.reason, ''), 300), now(), p_run)
    on conflict (person_id) do update set
      baseline_hash = case when hp.item_id = excluded.item_id and hp.baseline_hash is not null and not (excluded.baseline_verified and not hp.baseline_verified) then hp.baseline_hash else excluded.baseline_hash end,
      baseline_fp = case when hp.item_id = excluded.item_id and hp.baseline_hash is not null and not (excluded.baseline_verified and not hp.baseline_verified) then hp.baseline_fp else excluded.baseline_fp end,
      baseline_verified = case when hp.item_id = excluded.item_id and hp.baseline_hash is not null and not (excluded.baseline_verified and not hp.baseline_verified) then hp.baseline_verified else excluded.baseline_verified end,
      item_id = excluded.item_id, status = excluded.status, reformatted = excluded.reformatted, reason = excluded.reason, checked_at = now(), last_run_id = p_run;

    n_all := n_all + 1;
    if r.status = 'ok' then
      n_ok := n_ok + 1;
      if coalesce(r.reformatted, false) then n_rf := n_rf + 1; end if;
      update public.health_findings set status = 'resolved', resolved_at = now(), resolved_reason = 'live_matches', last_seen_at = now()
       where person_id = r.person_id and status in ('open', 'acknowledged');
      get diagnostics n_res = row_count;
      run.resolved := run.resolved + n_res;
    elsif r.status = 'unreachable' then
      n_un := n_un + 1;
    else
      if r.status = 'edited' then n_ed := n_ed + 1; else n_rm := n_rm + 1; end if;
      select * into f from public.health_findings where person_id = r.person_id and status in ('open', 'acknowledged') for update;
      if not found then
        insert into public.health_findings (org_id, person_id, email, person_name, kind, item_id, baseline_hash, live_hash, expected_fp, live_fp, detail, run_id)
        values (run.org_id, r.person_id, pe.email, left(pe.full_name, 120), r.status, r.item_id, r.baseline_hash, r.live_hash, r.expected_fp, r.live_fp, left(coalesce(r.detail, ''), 300), p_run);
        n_new := n_new + 1;
      elsif f.status = 'acknowledged' and f.kind <> r.status then
        -- it got worse than what was acknowledged: open it again (counts as new)
        update public.health_findings set status = 'open', kind = r.status, acknowledged_by = null, acknowledged_at = null, ack_note = '',
               live_hash = r.live_hash, live_fp = r.live_fp, detail = left(coalesce(r.detail, ''), 300), last_seen_at = now(), run_id = p_run where id = f.id;
        n_new := n_new + 1;
      else
        update public.health_findings set live_hash = r.live_hash, live_fp = r.live_fp, detail = left(coalesce(r.detail, ''), 300), last_seen_at = now() where id = f.id;
      end if;
    end if;
  end loop;

  update public.health_runs set checked = checked + n_all, ok = ok + n_ok, edited = edited + n_ed, removed = removed + n_rm, unreachable = unreachable + n_un,
         reformatted = reformatted + n_rf, new_findings = new_findings + n_new, resolved = run.resolved, cursor = coalesce(p_cursor, cursor)
   where id = p_run;
  return n_new;
end $$;
create function public.health_record(p_run uuid, p_results jsonb, p_cursor uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v public.health_runs;
begin
  select * into v from public.health_runs where id = p_run;
  if not found then raise exception 'That run does not exist.' using errcode = 'HM001'; end if;
  if auth.uid() is null or not public.is_org_admin(v.org_id) then raise exception 'You do not have permission to do that.' using errcode = 'HM006'; end if;
  return public.health_record_impl(p_run, p_results, p_cursor);
end $$;
create function public.health_record_service(p_run uuid, p_results jsonb, p_cursor uuid) returns integer
language sql volatile security definer set search_path = '' as $$
  select public.health_record_impl(p_run, p_results, p_cursor)
$$;

-- Ends a run. A person who is no longer monitored (rolled back, made inactive, never deployed) cannot be checked, so their open
-- finding is closed as "not monitored" rather than left to hang around. capped: the run stopped at the per-run cap; the next run continues after p_cursor.
create function public.health_finish_impl(p_run uuid, p_status text, p_capped boolean, p_cursor uuid, p_note text) returns public.health_runs
language plpgsql volatile security definer set search_path = '' as $$
declare run public.health_runs; n integer;
begin
  select * into run from public.health_runs where id = p_run for update;
  if not found then raise exception 'That run does not exist.' using errcode = 'HM001'; end if;
  if run.status <> 'running' then return run; end if;
  if p_status not in ('completed', 'failed') then raise exception 'Unknown status.' using errcode = 'HM003'; end if;
  update public.health_findings f set status = 'resolved', resolved_at = now(), resolved_reason = 'not_monitored'
   where f.org_id = run.org_id and f.status in ('open', 'acknowledged')
     and not exists (select 1 from public.health_candidates_impl(run.org_id, null, 1000) c where c.person_id = f.person_id)
     and (select count(*) from public.health_candidates_impl(run.org_id, null, 1000)) < 1000;
  get diagnostics n = row_count;
  update public.health_runs set status = p_status, finished_at = now(), capped = coalesce(p_capped, false), resolved = resolved + n, note = left(coalesce(p_note, ''), 300)
   where id = p_run returning * into run;
  insert into public.health_settings (org_id, rotate_cursor) values (run.org_id, case when p_status = 'completed' and p_capped then p_cursor end)
  on conflict (org_id) do update set rotate_cursor = case when p_status = 'completed' and p_capped then p_cursor else null end;
  return run;
end $$;
create function public.health_finish(p_run uuid, p_status text, p_capped boolean, p_cursor uuid, p_note text) returns public.health_runs
language plpgsql volatile security definer set search_path = '' as $$
declare v public.health_runs;
begin
  select * into v from public.health_runs where id = p_run;
  if not found then raise exception 'That run does not exist.' using errcode = 'HM001'; end if;
  if auth.uid() is null or not public.is_org_admin(v.org_id) then raise exception 'You do not have permission to do that.' using errcode = 'HM006'; end if;
  return public.health_finish_impl(p_run, p_status, p_capped, p_cursor, p_note);
end $$;
create function public.health_finish_service(p_run uuid, p_status text, p_capped boolean, p_cursor uuid, p_note text) returns public.health_runs
language sql volatile security definer set search_path = '' as $$
  select * from public.health_finish_impl(p_run, p_status, p_capped, p_cursor, p_note)
$$;

-- True exactly once per run that found new findings: whoever gets true sends the webhook. A second caller gets false (no double alerts).
create function public.health_claim_notification_impl(p_run uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare n integer;
begin
  update public.health_runs set notified_at = now() where id = p_run and notified_at is null and new_findings > 0 and status <> 'running';
  get diagnostics n = row_count;
  return n = 1;
end $$;
create function public.health_claim_notification(p_run uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v public.health_runs;
begin
  select * into v from public.health_runs where id = p_run;
  if not found then raise exception 'That run does not exist.' using errcode = 'HM001'; end if;
  if auth.uid() is null or not public.is_org_admin(v.org_id) then raise exception 'You do not have permission to do that.' using errcode = 'HM006'; end if;
  return public.health_claim_notification_impl(p_run);
end $$;
create function public.health_claim_notification_service(p_run uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  select public.health_claim_notification_impl(p_run)
$$;

/* ------------------------------------------------------------ admin-only operations */

create function public.health_acknowledge(p_finding uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare f public.health_findings;
begin
  select * into f from public.health_findings where id = p_finding for update;
  if not found then raise exception 'That finding does not exist.' using errcode = 'HM001'; end if;
  if auth.uid() is null or not public.is_org_admin(f.org_id) then raise exception 'You do not have permission to do that.' using errcode = 'HM006'; end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 1 and 300 then raise exception 'Add a short note (1 to 300 characters) saying why.' using errcode = 'HM003'; end if;
  if f.status <> 'open' then raise exception 'Only an open finding can be acknowledged.' using errcode = 'HM004'; end if;
  update public.health_findings set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now(), ack_note = btrim(p_note) where id = p_finding;
end $$;

create function public.health_save_settings(p_org uuid, p_enabled boolean, p_webhook_url text, p_include_names boolean, p_max_people integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare u text := nullif(btrim(coalesce(p_webhook_url, '')), '');
begin
  if auth.uid() is null or not public.is_org_admin(p_org) then raise exception 'You do not have permission to do that.' using errcode = 'HM006'; end if;
  if u is not null and (char_length(u) > 500 or u !~ '^https://[^\s]+$') then raise exception 'The webhook address must be a full https address.' using errcode = 'HM003'; end if;
  if p_max_people not between 1 and 1000 then raise exception 'The cap must be between 1 and 1000.' using errcode = 'HM003'; end if;
  insert into public.health_settings (org_id, enabled, webhook_url, webhook_include_names, max_people, updated_by)
  values (p_org, coalesce(p_enabled, false), u, coalesce(p_include_names, false), p_max_people, auth.uid())
  on conflict (org_id) do update set enabled = coalesce(p_enabled, false), webhook_url = u, webhook_include_names = coalesce(p_include_names, false), max_people = p_max_people, updated_by = auth.uid();
end $$;

/* ------------------------------------------------------------------- row security */

alter table public.health_settings enable row level security;
alter table public.health_runs     enable row level security;
alter table public.health_people    enable row level security;
alter table public.health_findings enable row level security;

create policy "health_settings: org admin read" on public.health_settings for select to authenticated using (public.is_org_admin(org_id));
create policy "health_runs: org admin read" on public.health_runs for select to authenticated using (public.is_org_admin(org_id));
create policy "health_people: org admin read" on public.health_people for select to authenticated using (public.is_org_admin(org_id));
create policy "health_findings: org admin read" on public.health_findings for select to authenticated using (public.is_org_admin(org_id));

/* ------------------------------------------------------------------------ privileges */

revoke all on public.health_settings, public.health_runs, public.health_people, public.health_findings from anon, authenticated;
grant select on public.health_settings, public.health_runs, public.health_people, public.health_findings to authenticated;

revoke execute on function
  public.health_findings_guard(), public.health_touch(), public.health_feature_on(uuid), public.health_enabled_orgs_service(),
  public.health_candidates_impl(uuid, uuid, integer), public.health_candidates(uuid, uuid, integer), public.health_candidates_service(uuid, uuid, integer),
  public.health_start_run_impl(uuid, text, uuid), public.health_start_run(uuid), public.health_start_run_service(uuid),
  public.health_record_impl(uuid, jsonb, uuid), public.health_record(uuid, jsonb, uuid), public.health_record_service(uuid, jsonb, uuid),
  public.health_finish_impl(uuid, text, boolean, uuid, text), public.health_finish(uuid, text, boolean, uuid, text), public.health_finish_service(uuid, text, boolean, uuid, text),
  public.health_claim_notification_impl(uuid), public.health_claim_notification(uuid), public.health_claim_notification_service(uuid),
  public.health_acknowledge(uuid, text), public.health_save_settings(uuid, boolean, text, boolean, integer)
  from public, anon, authenticated;

grant execute on function
  public.health_candidates(uuid, uuid, integer), public.health_start_run(uuid), public.health_record(uuid, jsonb, uuid),
  public.health_finish(uuid, text, boolean, uuid, text), public.health_claim_notification(uuid),
  public.health_acknowledge(uuid, text), public.health_save_settings(uuid, boolean, text, boolean, integer)
  to authenticated;

-- The service role (used by the cron endpoint) gets exactly what the unattended run needs. The role exists on Supabase; the guard
-- lets this file also run on a plain Postgres (tests).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.health_settings, public.health_runs, public.health_findings to service_role;
    grant execute on function
      public.health_enabled_orgs_service(), public.health_candidates_service(uuid, uuid, integer), public.health_start_run_service(uuid),
      public.health_record_service(uuid, jsonb, uuid), public.health_finish_service(uuid, text, boolean, uuid, text), public.health_claim_notification_service(uuid)
      to service_role;
  end if;
end $$;
