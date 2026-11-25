-- SignCraft designer polish: a person asks a Kimp designer to polish a signature; the designer works on a COPY and delivers;
-- the requester accepts or declines. Run after 0003. See docs/designer-polish.md.
--
-- Security model
--   * The signatures table and its RLS are NOT touched. A request stores its own SNAPSHOT of the document, so a designer
--     reads the snapshot, never the requester's saved signature.
--   * The tables have SELECT policies only. Every write goes through a security definer function that works out the caller
--     from auth.uid() (never from an argument), checks role and ownership, and writes an audit event.
--   * Status changes are enforced twice: by the functions, and by a trigger that rejects any transition not in the table
--     below, whoever runs the update (even the service role).
--
-- Statuses and allowed transitions
--   requested   -> in_progress (designer claims) | cancelled (requester)
--   in_progress -> delivered (holder delivers) | requested (holder or admin releases) | cancelled (requester)
--   delivered   -> accepted (requester) | requested (requester declines and reopens) | declined (requester declines and closes) | cancelled (requester)
--   accepted, declined, cancelled are final.

create table public.polish_requests (
  id                    uuid primary key default gen_random_uuid(),
  requester_id          uuid not null references auth.users (id) on delete cascade,
  source_signature_id   uuid references public.signatures (id) on delete set null,
  signature_name        text not null check (char_length(signature_name) between 1 and 80),
  origin                text not null check (origin in ('ai', 'manual')),   -- declared by the requester: AI draft or hand made
  note                  text not null check (char_length(note) between 1 and 1000),
  status                text not null default 'requested'
                          check (status in ('requested', 'in_progress', 'delivered', 'accepted', 'declined', 'cancelled')),
  designer_id           uuid references auth.users (id) on delete set null,
  round                 integer not null default 1,                          -- goes up each time a declined delivery is reopened
  original_doc          jsonb not null check (jsonb_typeof(original_doc) = 'object' and octet_length(original_doc::text) <= 200000),
  delivered_doc         jsonb check (delivered_doc is null or (jsonb_typeof(delivered_doc) = 'object' and octet_length(delivered_doc::text) <= 200000)),
  change_note           text check (change_note is null or char_length(change_note) between 1 and 1000),
  decline_reason        text check (decline_reason is null or char_length(decline_reason) between 1 and 1000),
  accepted_signature_id uuid references public.signatures (id) on delete set null,
  accepted_mode         text check (accepted_mode is null or accepted_mode in ('new', 'replace')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  claimed_at            timestamptz,
  delivered_at          timestamptz,
  resolved_at           timestamptz
);
create index polish_requests_requester_idx on public.polish_requests (requester_id, created_at desc);
create index polish_requests_queue_idx     on public.polish_requests (status, created_at) where status = 'requested';
create index polish_requests_designer_idx  on public.polish_requests (designer_id, status) where designer_id is not null;
-- One open request per saved signature, so the same signature cannot be queued twice.
create unique index polish_requests_one_open on public.polish_requests (source_signature_id)
  where source_signature_id is not null and status in ('requested', 'in_progress', 'delivered');

create table public.polish_comments (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.polish_requests (id) on delete cascade,
  author_id   uuid references auth.users (id) on delete set null,
  author_role text not null check (author_role in ('requester', 'designer')),
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index polish_comments_request_idx on public.polish_comments (request_id, created_at);

-- Audit trail. Insert only, by the functions below.
create table public.polish_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.polish_requests (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,
  action      text not null check (action in ('requested', 'claimed', 'released', 'delivered', 'accepted', 'declined', 'reopened', 'cancelled')),
  from_status text,
  to_status   text not null,
  detail      text check (detail is null or char_length(detail) <= 1000),
  created_at  timestamptz not null default now()
);
create index polish_events_request_idx on public.polish_events (request_id, created_at);

/* ------------------------------------------------------------------ guard trigger */

create function public.polish_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.requester_id is distinct from old.requester_id
     or new.original_doc is distinct from old.original_doc
     or new.created_at is distinct from old.created_at then
    raise exception 'immutable' using errcode = 'P0001';
  end if;
  -- A final request is frozen. (Foreign-key clean-up, such as clearing designer_id when an account is deleted, is still allowed.)
  if old.status in ('accepted', 'declined', 'cancelled')
     and (new.status is distinct from old.status or new.delivered_doc is distinct from old.delivered_doc
          or new.change_note is distinct from old.change_note or new.decline_reason is distinct from old.decline_reason
          or new.note is distinct from old.note) then
    raise exception 'closed' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status
     and (old.status || '>' || new.status) <> all (array[
       'requested>in_progress', 'requested>cancelled',
       'in_progress>delivered', 'in_progress>requested', 'in_progress>cancelled',
       'delivered>accepted', 'delivered>requested', 'delivered>declined', 'delivered>cancelled'
     ]) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  new.updated_at = now();
  return new;
end $$;

create trigger polish_requests_guard before update on public.polish_requests
  for each row execute function public.polish_guard();

-- Comments and events are append-only for everyone, including the service role.
create function public.polish_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Foreign-key clean-up (a deleted request or account) runs at trigger depth 2 and is allowed; any direct change is not.
  if pg_trigger_depth() > 1 then return case when tg_op = 'DELETE' then old else new end; end if;
  raise exception 'append_only' using errcode = 'P0001';
end $$;
create trigger polish_comments_append_only before update or delete on public.polish_comments
  for each row execute function public.polish_append_only();
create trigger polish_events_append_only before update or delete on public.polish_events
  for each row execute function public.polish_append_only();

/* ------------------------------------------------------------------ row security */

alter table public.polish_requests enable row level security;
alter table public.polish_comments enable row level security;
alter table public.polish_events   enable row level security;

-- Requesters see their own. Designers and admins see the open queue and the requests they hold, never anyone else's.
create policy "polish_requests: requester, queue or holder read" on public.polish_requests for select to authenticated
  using (
    requester_id = auth.uid()
    or (public.current_app_role() >= 'designer' and (status = 'requested' or designer_id = auth.uid()))
  );

-- Comments and events: participants only (the requester and the designer who holds the request).
create policy "polish_comments: participants read" on public.polish_comments for select to authenticated
  using (exists (
    select 1 from public.polish_requests r
     where r.id = request_id
       and (r.requester_id = auth.uid() or (r.designer_id = auth.uid() and public.current_app_role() >= 'designer'))
  ));
create policy "polish_events: participants read" on public.polish_events for select to authenticated
  using (exists (
    select 1 from public.polish_requests r
     where r.id = request_id
       and (r.requester_id = auth.uid() or (r.designer_id = auth.uid() and public.current_app_role() >= 'designer'))
  ));

-- No insert, update or delete for the browser-facing roles. Writes go through the functions.
revoke all on public.polish_requests, public.polish_comments, public.polish_events from anon, authenticated;
grant select on public.polish_requests, public.polish_comments, public.polish_events to authenticated;

/* ------------------------------------------------------------------ internal helpers */

-- Lock one request for the rest of the transaction. This lock is what makes claiming race-safe: two designers
-- claiming the same request are serialised, and the second one sees it already in_progress.
create function public.polish_lock(p_id uuid) returns public.polish_requests
language plpgsql volatile security definer set search_path = '' as $$
declare r public.polish_requests;
begin
  select * into r from public.polish_requests where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  return r;
end $$;

create function public.polish_log(p_id uuid, p_action text, p_from text, p_to text, p_detail text) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.polish_events (request_id, actor_id, action, from_status, to_status, detail)
  values (p_id, auth.uid(), p_action, p_from, p_to, nullif(left(p_detail, 1000), ''))
$$;

create function public.polish_result(r public.polish_requests) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'status', r.status, 'round', r.round)
$$;

create function public.polish_uid() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return auth.uid();
end $$;

-- A document must at least look like a signature document; the API validates it fully with zod before it gets here.
create function public.polish_check_doc(p_doc jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if not coalesce(
       p_doc is not null and jsonb_typeof(p_doc) = 'object' and p_doc -> 'version' = '1'::jsonb
       and jsonb_typeof(p_doc -> 'blocks') = 'array' and jsonb_typeof(p_doc -> 'template_id') = 'string'
       and octet_length(p_doc::text) <= 200000, false) then
    raise exception 'invalid_doc' using errcode = 'P0001';
  end if;
end $$;

/* ------------------------------------------------------------------ requester functions */

-- Ask for polish on one of your own saved signatures. The snapshot is read here, from your own row, never from the client.
create function public.polish_create(p_signature_id uuid, p_note text, p_origin text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := public.polish_uid();
  sig public.signatures;
  r   public.polish_requests;
  n   text := btrim(coalesce(p_note, ''));
begin
  if not public.feature_enabled_for(uid, 'designer_polish') then
    raise exception 'feature_disabled' using errcode = '42501';
  end if;
  if char_length(n) not between 1 and 1000 or p_origin not in ('ai', 'manual') then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  select * into sig from public.signatures where id = p_signature_id and owner_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if (select count(*) from public.polish_requests where requester_id = uid and status in ('requested', 'in_progress', 'delivered')) >= 5 then
    raise exception 'too_many_open' using errcode = 'P0001';
  end if;
  begin
    insert into public.polish_requests (requester_id, source_signature_id, signature_name, origin, note, original_doc)
    values (uid, sig.id, sig.name, p_origin, n, sig.doc_json) returning * into r;
  exception when unique_violation then
    raise exception 'already_open' using errcode = 'P0001';
  end;
  perform public.polish_log(r.id, 'requested', null, 'requested', null);
  return public.polish_result(r);
end $$;

-- Accept the delivered version: save it as a NEW signature, or replace the original (only with explicit confirmation).
create function public.polish_accept(p_id uuid, p_mode text, p_name text, p_confirm_replace boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := public.polish_uid();
  r   public.polish_requests;
  sid uuid;
  nm  text;
begin
  r := public.polish_lock(p_id);
  if r.requester_id <> uid then raise exception 'not_found' using errcode = 'P0001'; end if;
  if r.status <> 'delivered' then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  if p_mode not in ('new', 'replace') then raise exception 'invalid' using errcode = 'P0001'; end if;
  perform public.polish_check_doc(r.delivered_doc);

  if p_mode = 'new' then
    nm := btrim(coalesce(nullif(btrim(p_name), ''), left(r.signature_name, 69) || ' (polished)'));
    if char_length(nm) not between 1 and 80 then raise exception 'invalid' using errcode = 'P0001'; end if;
    if (select count(*) from public.signatures where owner_id = uid) >= 100 then raise exception 'quota' using errcode = 'P0001'; end if;
    insert into public.signatures (owner_id, name, template_id, doc_json)
    values (uid, nm, r.delivered_doc ->> 'template_id', r.delivered_doc) returning id into sid;
  else
    if p_confirm_replace is not true then raise exception 'confirm_required' using errcode = 'P0001'; end if;
    update public.signatures set template_id = r.delivered_doc ->> 'template_id', doc_json = r.delivered_doc
     where id = r.source_signature_id and owner_id = uid returning id into sid;
    if sid is null then raise exception 'source_missing' using errcode = 'P0001'; end if;
  end if;

  update public.polish_requests
     set status = 'accepted', accepted_signature_id = sid, accepted_mode = p_mode, resolved_at = now()
   where id = r.id returning * into r;
  perform public.polish_log(r.id, 'accepted', 'delivered', 'accepted', p_mode);
  return public.polish_result(r) || jsonb_build_object('signature_id', sid);
end $$;

-- Decline the delivered version with a reason, and either send it back to the queue or close the request.
create function public.polish_decline(p_id uuid, p_reason text, p_reopen boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := public.polish_uid();
  r   public.polish_requests;
  why text := btrim(coalesce(p_reason, ''));
begin
  r := public.polish_lock(p_id);
  if r.requester_id <> uid then raise exception 'not_found' using errcode = 'P0001'; end if;
  if r.status <> 'delivered' then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  if char_length(why) not between 1 and 1000 then raise exception 'invalid' using errcode = 'P0001'; end if;

  if p_reopen is true then
    update public.polish_requests
       set status = 'requested', designer_id = null, claimed_at = null, round = round + 1, decline_reason = why
     where id = r.id returning * into r;
    perform public.polish_log(r.id, 'reopened', 'delivered', 'requested', why);
  else
    update public.polish_requests set status = 'declined', decline_reason = why, resolved_at = now()
     where id = r.id returning * into r;
    perform public.polish_log(r.id, 'declined', 'delivered', 'declined', why);
  end if;
  return public.polish_result(r);
end $$;

create function public.polish_cancel(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid  uuid := public.polish_uid();
  r    public.polish_requests;
  prev text;
begin
  r := public.polish_lock(p_id);
  if r.requester_id <> uid then raise exception 'not_found' using errcode = 'P0001'; end if;
  if r.status not in ('requested', 'in_progress', 'delivered') then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  prev := r.status;
  update public.polish_requests set status = 'cancelled', resolved_at = now() where id = r.id returning * into r;
  perform public.polish_log(r.id, 'cancelled', prev, 'cancelled', null);
  return public.polish_result(r);
end $$;

/* ------------------------------------------------------------------ designer functions */

-- Claim an open request. Race-safe: the row lock serialises claimers, so exactly one wins and the rest get not_available.
create function public.polish_claim(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := public.polish_uid();
  r   public.polish_requests;
begin
  if public.app_role_of(uid) < 'designer' then raise exception 'forbidden' using errcode = '42501'; end if;
  r := public.polish_lock(p_id);
  if r.status <> 'requested' then raise exception 'not_available' using errcode = 'P0001'; end if;
  update public.polish_requests set status = 'in_progress', designer_id = uid, claimed_at = now()
   where id = r.id and status = 'requested' returning * into r;
  perform public.polish_log(r.id, 'claimed', 'requested', 'in_progress', null);
  return public.polish_result(r);
end $$;

-- Give a claimed request back to the queue. The holder may; so may an admin (for example when a designer is away).
create function public.polish_release(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := public.polish_uid();
  r   public.polish_requests;
begin
  r := public.polish_lock(p_id);
  if r.status <> 'in_progress' then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  if not ((r.designer_id = uid and public.app_role_of(uid) >= 'designer') or public.app_role_of(uid) = 'admin') then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  update public.polish_requests set status = 'requested', designer_id = null, claimed_at = null
   where id = r.id returning * into r;
  perform public.polish_log(r.id, 'released', 'in_progress', 'requested', null);
  return public.polish_result(r);
end $$;

-- Deliver the polished document with a short change note. Only the designer holding the request.
create function public.polish_deliver(p_id uuid, p_doc jsonb, p_change_note text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := public.polish_uid();
  r   public.polish_requests;
  cn  text := btrim(coalesce(p_change_note, ''));
begin
  r := public.polish_lock(p_id);
  if r.designer_id is distinct from uid or public.app_role_of(uid) < 'designer' then raise exception 'not_found' using errcode = 'P0001'; end if;
  if r.status <> 'in_progress' then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  if char_length(cn) not between 1 and 1000 then raise exception 'invalid' using errcode = 'P0001'; end if;
  perform public.polish_check_doc(p_doc);
  update public.polish_requests set status = 'delivered', delivered_doc = p_doc, change_note = cn, delivered_at = now()
   where id = r.id returning * into r;
  perform public.polish_log(r.id, 'delivered', 'in_progress', 'delivered', cn);
  return public.polish_result(r);
end $$;

/* ------------------------------------------------------------------ comments */

-- The requester and the designer holding the request may comment, while the request is still open.
create function public.polish_comment(p_id uuid, p_body text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid  uuid := public.polish_uid();
  r    public.polish_requests;
  who  text;
  b    text := btrim(coalesce(p_body, ''));
  cid  uuid;
begin
  r := public.polish_lock(p_id);
  if r.requester_id = uid then who := 'requester';
  elsif r.designer_id = uid and public.app_role_of(uid) >= 'designer' then who := 'designer';
  else raise exception 'not_found' using errcode = 'P0001';
  end if;
  if r.status not in ('requested', 'in_progress', 'delivered') then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  if char_length(b) not between 1 and 2000 then raise exception 'invalid' using errcode = 'P0001'; end if;
  if (select count(*) from public.polish_comments where request_id = r.id) >= 300 then raise exception 'too_many_comments' using errcode = 'P0001'; end if;
  insert into public.polish_comments (request_id, author_id, author_role, body) values (r.id, uid, who, b) returning id into cid;
  return jsonb_build_object('id', cid);
end $$;

/* ------------------------------------------------------------------ function privileges */

revoke execute on function
  public.polish_guard(), public.polish_append_only(), public.polish_lock(uuid), public.polish_log(uuid, text, text, text, text),
  public.polish_result(public.polish_requests), public.polish_uid(), public.polish_check_doc(jsonb),
  public.polish_create(uuid, text, text), public.polish_accept(uuid, text, text, boolean), public.polish_decline(uuid, text, boolean),
  public.polish_cancel(uuid), public.polish_claim(uuid), public.polish_release(uuid), public.polish_deliver(uuid, jsonb, text),
  public.polish_comment(uuid, text)
  from public, anon;

grant execute on function
  public.polish_create(uuid, text, text), public.polish_accept(uuid, text, text, boolean), public.polish_decline(uuid, text, boolean),
  public.polish_cancel(uuid), public.polish_claim(uuid), public.polish_release(uuid), public.polish_deliver(uuid, jsonb, text),
  public.polish_comment(uuid, text)
  to authenticated;
