-- SignCraft Gmail push: one Google connection per user (encrypted refresh token) and a log of signatures replaced.
-- Run after 0003. See docs/gmail-push.md.
--
-- The refresh token lets the server act on a person's Gmail settings, so it is protected twice:
--   1. it is stored ENCRYPTED (AES-256-GCM, key kept in the server environment, never in the database), and
--   2. the browser-facing roles cannot read the column at all. Only the server (service role) reads or writes it.

create table public.google_connections (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  google_sub        text not null,                       -- Google's stable account id
  google_email      text not null,
  hd                text not null,                       -- Workspace domain the account belongs to
  scope             text not null,
  refresh_token_enc text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_used_at      timestamptz
);

create table public.gmail_push_log (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  send_as_email      text not null,
  previous_signature text check (previous_signature is null or char_length(previous_signature) <= 200000),  -- what was replaced, so it can be restored
  new_signature_hash text not null,
  template_id        text,
  created_at         timestamptz not null default now()
);
create index gmail_push_log_user_idx on public.gmail_push_log (user_id, created_at desc);

alter table public.google_connections enable row level security;
alter table public.gmail_push_log     enable row level security;

-- Owners may see that they are connected, and disconnect. Nobody can insert or update through the API:
-- the server does that with the service role after the OAuth flow has been verified.
create policy "google_connections: owner read"   on public.google_connections for select to authenticated using (user_id = auth.uid());
create policy "google_connections: owner delete" on public.google_connections for delete to authenticated using (user_id = auth.uid());

create policy "gmail_push_log: owner read" on public.gmail_push_log for select to authenticated using (user_id = auth.uid());

-- Column-level lock: the ciphertext is not readable by the browser-facing roles, even for the owner.
revoke all on public.google_connections from anon, authenticated;
grant select (user_id, google_email, hd, scope, created_at, last_used_at) on public.google_connections to authenticated;
grant delete on public.google_connections to authenticated;

revoke all on public.gmail_push_log from anon, authenticated;
grant select on public.gmail_push_log to authenticated;
