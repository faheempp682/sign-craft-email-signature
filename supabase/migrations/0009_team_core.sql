-- SignCraft team foundation: people directory, brand templates with field locks, approval workflow,
-- CSV import history and organization-scoped signatures. Run after 0007 (does not depend on 0008).
-- See docs/team.md. H2 (deploy, rules) and H3 (directory and CRM sync) build on these tables.
--
-- Access model
--   * org admins manage everything in their organization (is_org_admin / is_org_member come from 0006).
--   * a member reads only: their own person record, the ONE brand template that applies to them, their own
--     signature versions, and their organization's settings.
--   * signature_versions has no insert/update/delete privilege for the browser roles. Rows appear and change only
--     through submit_signature() and review_signature(), and a trigger enforces what may change (append-only history).

/* ------------------------------------------------------ organization-scoped signatures */

alter table public.signatures add column org_id uuid references public.organizations (id) on delete set null;
create index signatures_org_idx on public.signatures (org_id, updated_at desc) where org_id is not null;

-- Owners still do everything with their own rows. They can only tag a signature with an organization they belong to.
drop policy "signatures: owner insert" on public.signatures;
drop policy "signatures: owner update" on public.signatures;
create policy "signatures: owner insert" on public.signatures for insert
  with check (owner_id = auth.uid() and (org_id is null or public.is_org_member(org_id)));
create policy "signatures: owner update" on public.signatures for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and (org_id is null or public.is_org_member(org_id)));
-- Org admins may READ (never change) the signatures tagged with their organization.
create policy "signatures: org admin read" on public.signatures for select
  using (org_id is not null and public.is_org_admin(org_id));

/* ------------------------------------------------------------------------- helpers */

create function public.valid_custom_fields(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p)) > 10 then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if k !~ '^[a-z][a-z0-9_]{0,29}$' then return false; end if;
    if jsonb_typeof(p -> k) <> 'string' or char_length(p ->> k) > 200 then return false; end if;
  end loop;
  return true;
end $$;

/* --------------------------------------------------------------------------- tables */

create table public.org_settings (
  org_id           uuid primary key references public.organizations (id) on delete cascade,
  require_approval boolean not null default false,   -- employee changes wait for an admin when true
  updated_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now()
);

-- The people directory. People need no account: user_id is filled when a person with that e-mail signs in and claims it.
create table public.people (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete set null,
  email       text not null check (email = lower(email) and char_length(email) between 3 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  full_name   text not null check (char_length(full_name) between 1 and 120),
  first_name  text not null default '' check (char_length(first_name) <= 60),
  last_name   text not null default '' check (char_length(last_name) <= 60),
  title       text not null default '' check (char_length(title) <= 100),
  department  text not null default '' check (char_length(department) <= 80),
  phone       text not null default '' check (char_length(phone) <= 40),
  mobile      text not null default '' check (char_length(mobile) <= 40),
  location    text not null default '' check (char_length(location) <= 120),
  custom      jsonb not null default '{}'::jsonb check (public.valid_custom_fields(custom)),  -- up to 10 key/value pairs
  source      text not null default 'manual' check (source in ('manual', 'csv', 'google', 'microsoft', 'crm')),
  external_id text check (external_id is null or char_length(external_id) between 1 and 200),  -- the id in the source system (H3 matches on it)
  status      text not null default 'active' check (status in ('active', 'inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, email)
);
create unique index people_org_user_idx on public.people (org_id, user_id) where user_id is not null;
create unique index people_org_external_idx on public.people (org_id, source, external_id) where external_id is not null;
create index people_org_department_idx on public.people (org_id, lower(department));
create index people_user_idx on public.people (user_id) where user_id is not null;

create table public.brand_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  doc_json    jsonb not null check (jsonb_typeof(doc_json) = 'object' and char_length(doc_json::text) <= 60000),  -- a SignatureDoc, validated by the app
  -- {"editable": ["<blockIndex>.<field>", ...]}: everything not listed is locked.
  lock_json   jsonb not null default '{"editable": []}'::jsonb check (jsonb_typeof(lock_json) = 'object' and jsonb_typeof(lock_json -> 'editable') = 'array' and jsonb_array_length(lock_json -> 'editable') <= 40),
  -- {"<blockIndex>.<field>": "full_name" | "title" | ... | "custom.<key>"}: which people field fills which block field.
  field_map   jsonb not null default '{}'::jsonb check (jsonb_typeof(field_map) = 'object' and char_length(field_map::text) <= 4000),
  departments text[] not null default '{}' check (cardinality(departments) <= 20),  -- empty: applies to everyone without a more specific template
  is_active   boolean not null default true,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index brand_templates_org_idx on public.brand_templates (org_id, created_at);

-- Every submission, kept forever. Content never changes; only the review fields move forward (see the trigger).
create table public.signature_versions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  person_id         uuid not null references public.people (id) on delete cascade,
  template_id       uuid references public.brand_templates (id) on delete set null,
  template_snapshot jsonb not null,   -- doc, lock and field map exactly as they were at submission (copied inside the database)
  values_json       jsonb not null default '{}'::jsonb,   -- the employee's overrides, keyed by "<blockIndex>.<field>"
  version_no        integer not null check (version_no >= 1),
  status            text not null default 'pending' check (status in ('draft', 'pending', 'approved', 'rejected')),
  submitted_by      uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  reviewed_by       uuid references auth.users (id) on delete set null,   -- null with status approved: approved automatically
  reviewed_at       timestamptz,
  review_note       text not null default '' check (char_length(review_note) <= 500),
  unique (person_id, version_no),
  check ((status in ('draft', 'pending') and reviewed_at is null) or (status in ('approved', 'rejected') and reviewed_at is not null)),
  check (status <> 'rejected' or char_length(btrim(review_note)) > 0)
);
create unique index signature_versions_one_pending on public.signature_versions (person_id) where status = 'pending';
create index signature_versions_org_status_idx on public.signature_versions (org_id, status, created_at desc);
create index signature_versions_person_idx on public.signature_versions (person_id, version_no desc);

create table public.people_imports (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  filename   text not null default '' check (char_length(filename) <= 200),
  source     text not null check (source in ('csv', 'google', 'microsoft', 'crm')),
  total_rows integer not null check (total_rows >= 0),
  created    integer not null check (created >= 0),
  updated    integer not null check (updated >= 0),
  skipped    integer not null default 0 check (skipped >= 0),   -- rows left out because they failed validation
  created_at timestamptz not null default now()
);
create index people_imports_org_idx on public.people_imports (org_id, created_at desc);

create trigger people_touch before update on public.people for each row execute function public.touch_updated_at();
create trigger brand_templates_touch before update on public.brand_templates for each row execute function public.touch_updated_at();
create trigger org_settings_touch before update on public.org_settings for each row execute function public.touch_updated_at();

/* --------------------------------------------------------------------------- triggers */

-- E-mail is stored trimmed and lower case (so the unique key is case-insensitive); full name falls back to first + last;
-- a linked account must belong to the same organization.
create function public.people_normalize() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.email := lower(btrim(new.email));
  if new.full_name is null or btrim(new.full_name) = '' then
    new.full_name := btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, ''));
  end if;
  if new.user_id is not null and not exists (select 1 from public.memberships m where m.org_id = new.org_id and m.user_id = new.user_id) then
    raise exception 'That account is not a member of this organization.' using errcode = 'TM008';
  end if;
  return new;
end $$;
create trigger people_normalize before insert or update on public.people for each row execute function public.people_normalize();

-- Append-only history: content columns never change, the status only moves pending -> approved / rejected (or draft -> pending).
create function public.signature_versions_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.org_id, new.person_id, new.template_id, new.template_snapshot, new.values_json, new.version_no, new.submitted_by, new.created_at)
     is distinct from (old.id, old.org_id, old.person_id, old.template_id, old.template_snapshot, old.values_json, old.version_no, old.submitted_by, old.created_at) then
    raise exception 'A submitted signature version cannot be edited.' using errcode = 'TM005';
  end if;
  if new.status = old.status then
    if (new.reviewed_by, new.reviewed_at, new.review_note) is distinct from (old.reviewed_by, old.reviewed_at, old.review_note) then
      raise exception 'A review cannot be changed afterwards.' using errcode = 'TM005';
    end if;
  elsif not ((old.status = 'draft' and new.status = 'pending') or (old.status = 'pending' and new.status in ('approved', 'rejected'))) then
    raise exception 'A % version cannot become %.', old.status, new.status using errcode = 'TM005';
  end if;
  return new;
end $$;
create trigger signature_versions_guard before update on public.signature_versions for each row execute function public.signature_versions_guard();

/* ----------------------------------------------------------------------- functions */

-- Which active template applies to a person: a department match beats "everyone"; oldest first. Internal helper for policies.
create function public.template_for_person(p_person uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select t.id
    from public.people p
    join public.brand_templates t on t.org_id = p.org_id and t.is_active
   where p.id = p_person
     and (p.user_id = auth.uid() or public.is_org_admin(p.org_id))
     and (cardinality(t.departments) = 0 or exists (select 1 from unnest(t.departments) d where lower(btrim(d)) = lower(btrim(p.department)) and p.department <> ''))
   order by (cardinality(t.departments) = 0), t.created_at, t.id
   limit 1
$$;

-- A signed-in member links their account to the directory entry with the same e-mail. Returns the person id (or null).
create function public.claim_my_person(p_org uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.is_org_member(p_org) then return null; end if;
  select id into v_id from public.people where org_id = p_org and user_id = auth.uid();
  if v_id is not null then return v_id; end if;
  update public.people set user_id = auth.uid()
   where org_id = p_org and user_id is null and email = (select lower(btrim(email)) from public.profiles where id = auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Employee saves their allowed fields. Locked keys are refused here, whatever the client sent.
create function public.submit_signature(p_org uuid, p_values jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_person public.people;
  v_tpl public.brand_templates;
  v_key text;
  v_pending boolean;
  v_auto boolean;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'TM006'; end if;
  select * into v_person from public.people where org_id = p_org and user_id = auth.uid() and status = 'active' for update;
  if not found then raise exception 'You are not in this organization''s directory yet.' using errcode = 'TM001'; end if;
  select * into v_tpl from public.brand_templates where id = public.template_for_person(v_person.id);
  if not found then raise exception 'There is no brand template for you yet.' using errcode = 'TM002'; end if;

  if p_values is null or jsonb_typeof(p_values) <> 'object' or (select count(*) from jsonb_object_keys(p_values)) > 40 then
    raise exception 'The values must be an object.' using errcode = 'TM007';
  end if;
  for v_key in select jsonb_object_keys(p_values) loop
    if not jsonb_exists(v_tpl.lock_json -> 'editable', v_key) then
      raise exception 'The field % is locked by your brand template.', v_key using errcode = 'TM003';
    end if;
    if jsonb_typeof(p_values -> v_key) <> 'string' or char_length(p_values ->> v_key) > 1500 then
      raise exception 'The value for % is not valid.', v_key using errcode = 'TM007';
    end if;
  end loop;

  select exists (select 1 from public.signature_versions where person_id = v_person.id and status = 'pending') into v_pending;
  if v_pending then raise exception 'You already have a change waiting for review.' using errcode = 'TM004'; end if;

  -- Admins approve their own changes; everyone else waits when the organization asks for approval.
  v_auto := public.is_org_admin(p_org) or not coalesce((select require_approval from public.org_settings where org_id = p_org), false);

  insert into public.signature_versions (org_id, person_id, template_id, template_snapshot, values_json, version_no, status, submitted_by, reviewed_at, review_note)
  values (
    p_org, v_person.id, v_tpl.id,
    jsonb_build_object('name', v_tpl.name, 'doc', v_tpl.doc_json, 'lock', v_tpl.lock_json, 'field_map', v_tpl.field_map),
    p_values,
    coalesce((select max(version_no) from public.signature_versions where person_id = v_person.id), 0) + 1,
    case when v_auto then 'approved' else 'pending' end,
    auth.uid(),
    case when v_auto then now() end,
    case when v_auto then 'Approved automatically.' else '' end
  ) returning id into v_id;
  return v_id;
end $$;

-- An admin approves or rejects a pending version. Rejection needs a reason. Nobody reviews their own submission.
create function public.review_signature(p_id uuid, p_approve boolean, p_note text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.signature_versions;
begin
  select * into v from public.signature_versions where id = p_id for update;
  if not found then raise exception 'That submission does not exist.' using errcode = 'TM005'; end if;
  if auth.uid() is null or not public.is_org_admin(v.org_id) then raise exception 'You do not have permission to do that.' using errcode = 'TM006'; end if;
  if v.status <> 'pending' then raise exception 'That submission has already been reviewed.' using errcode = 'TM005'; end if;
  if v.submitted_by = auth.uid() then raise exception 'You cannot review your own submission.' using errcode = 'TM006'; end if;
  if not p_approve and btrim(coalesce(p_note, '')) = '' then raise exception 'Give a reason when you reject.' using errcode = 'TM007'; end if;
  update public.signature_versions
     set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(btrim(coalesce(p_note, '')), 500)
   where id = p_id;
end $$;

-- Create-or-update people by e-mail in ONE transaction (a function call is atomic), then record the import.
-- Existing people keep their source and external id; a blank cell never erases a value; custom fields are merged.
create function public.import_people(p_org uuid, p_rows jsonb, p_source text, p_filename text, p_skipped integer default 0) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_total integer;
  v_created integer;
  v_updated integer;
  v_id uuid;
begin
  if auth.uid() is null or not public.is_org_admin(p_org) then raise exception 'You do not have permission to do that.' using errcode = 'TM006'; end if;
  if p_source not in ('csv', 'google', 'microsoft', 'crm') then raise exception 'Unknown source.' using errcode = 'TM007'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'Send between 0 and 5000 rows.' using errcode = 'TM007'; end if;
  v_total := jsonb_array_length(p_rows);

  with src as (
    select distinct on (lower(btrim(r.email))) lower(btrim(r.email)) as email, r.full_name, r.first_name, r.last_name, r.title, r.department,
           r.phone, r.mobile, r.location, r.status, r.external_id, r.custom
      from jsonb_to_recordset(p_rows) as r(email text, full_name text, first_name text, last_name text, title text, department text,
                                           phone text, mobile text, location text, status text, external_id text, custom jsonb)
     order by lower(btrim(r.email))
  ), up as (
    insert into public.people as p (org_id, email, full_name, first_name, last_name, title, department, phone, mobile, location, status, external_id, custom, source)
    select p_org, s.email, coalesce(s.full_name, ''), coalesce(s.first_name, ''), coalesce(s.last_name, ''), coalesce(s.title, ''), coalesce(s.department, ''),
           coalesce(s.phone, ''), coalesce(s.mobile, ''), coalesce(s.location, ''), coalesce(nullif(s.status, ''), 'active'), nullif(s.external_id, ''),
           coalesce(s.custom, '{}'::jsonb), p_source
      from src s
    on conflict (org_id, email) do update set
      full_name   = coalesce(nullif(excluded.full_name, ''), p.full_name),
      first_name  = coalesce(nullif(excluded.first_name, ''), p.first_name),
      last_name   = coalesce(nullif(excluded.last_name, ''), p.last_name),
      title       = coalesce(nullif(excluded.title, ''), p.title),
      department  = coalesce(nullif(excluded.department, ''), p.department),
      phone       = coalesce(nullif(excluded.phone, ''), p.phone),
      mobile      = coalesce(nullif(excluded.mobile, ''), p.mobile),
      location    = coalesce(nullif(excluded.location, ''), p.location),
      status      = excluded.status,
      external_id = coalesce(p.external_id, excluded.external_id),
      custom      = p.custom || excluded.custom
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_created, v_updated from up;

  insert into public.people_imports (org_id, created_by, filename, source, total_rows, created, updated, skipped)
  values (p_org, auth.uid(), left(coalesce(p_filename, ''), 200), p_source, v_total, v_created, v_updated, greatest(coalesce(p_skipped, 0), 0))
  returning id into v_id;
  return jsonb_build_object('import_id', v_id, 'created', v_created, 'updated', v_updated);
end $$;

/* ------------------------------------------------------------------- row security */

alter table public.org_settings       enable row level security;
alter table public.people             enable row level security;
alter table public.brand_templates    enable row level security;
alter table public.signature_versions enable row level security;
alter table public.people_imports     enable row level security;

create policy "org_settings: member read" on public.org_settings for select to authenticated using (public.is_org_member(org_id));
create policy "org_settings: org admin insert" on public.org_settings for insert to authenticated with check (public.is_org_admin(org_id));
create policy "org_settings: org admin update" on public.org_settings for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create policy "people: admin or self read" on public.people for select to authenticated using (public.is_org_admin(org_id) or user_id = auth.uid());
create policy "people: org admin insert" on public.people for insert to authenticated with check (public.is_org_admin(org_id));
create policy "people: org admin update" on public.people for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy "people: org admin delete" on public.people for delete to authenticated using (public.is_org_admin(org_id));

create policy "brand_templates: admin or applicable read" on public.brand_templates for select to authenticated using (
  public.is_org_admin(org_id)
  or exists (select 1 from public.people p where p.user_id = auth.uid() and p.org_id = brand_templates.org_id and p.status = 'active' and public.template_for_person(p.id) = brand_templates.id)
);
create policy "brand_templates: org admin insert" on public.brand_templates for insert to authenticated with check (public.is_org_admin(org_id));
create policy "brand_templates: org admin update" on public.brand_templates for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy "brand_templates: org admin delete" on public.brand_templates for delete to authenticated using (public.is_org_admin(org_id));

create policy "signature_versions: admin or own read" on public.signature_versions for select to authenticated using (
  public.is_org_admin(org_id) or exists (select 1 from public.people p where p.id = person_id and p.user_id = auth.uid())
);
create policy "people_imports: org admin read" on public.people_imports for select to authenticated using (public.is_org_admin(org_id));

/* ------------------------------------------------------------------------ privileges */

revoke all on public.org_settings, public.people, public.brand_templates, public.signature_versions, public.people_imports from anon, authenticated;
grant select, insert, update on public.org_settings to authenticated;
grant select, insert, update, delete on public.people, public.brand_templates to authenticated;
grant select on public.signature_versions, public.people_imports to authenticated;

revoke execute on function
  public.valid_custom_fields(jsonb), public.people_normalize(), public.signature_versions_guard(), public.template_for_person(uuid),
  public.claim_my_person(uuid), public.submit_signature(uuid, jsonb), public.review_signature(uuid, boolean, text),
  public.import_people(uuid, jsonb, text, text, integer)
  from public, anon;
grant execute on function
  public.valid_custom_fields(jsonb), public.template_for_person(uuid), public.claim_my_person(uuid), public.submit_signature(uuid, jsonb),
  public.review_signature(uuid, boolean, text), public.import_people(uuid, jsonb, text, text, integer)
  to authenticated;
