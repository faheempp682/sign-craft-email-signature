-- SignCraft: auth-backed signature storage + uploaded-asset registry.
-- Run in the Supabase SQL editor (or `supabase db push`). Safe to run once on a fresh project.
-- Organizations, roles, feature flags and ai_usage (PROJECT.md section 11) arrive in later migrations.

create table public.signatures (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  template_id text not null,
  doc_json    jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index signatures_owner_updated_idx on public.signatures (owner_id, updated_at desc);

create table public.assets (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url        text not null,
  path       text not null,           -- storage path inside the Bunny zone
  type       text not null,           -- image/png | image/jpeg | image/gif
  size       integer not null,        -- bytes
  width      integer,
  height     integer,
  created_at timestamptz not null default now()
);
create index assets_owner_idx on public.assets (owner_id, created_at desc);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger signatures_touch before update on public.signatures
  for each row execute function public.touch_updated_at();

-- Row-level security: a user only ever sees and changes their own rows.
alter table public.signatures enable row level security;
alter table public.assets     enable row level security;

create policy "signatures: owner select" on public.signatures for select using (owner_id = auth.uid());
create policy "signatures: owner insert" on public.signatures for insert with check (owner_id = auth.uid());
create policy "signatures: owner update" on public.signatures for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "signatures: owner delete" on public.signatures for delete using (owner_id = auth.uid());

create policy "assets: owner select" on public.assets for select using (owner_id = auth.uid());
create policy "assets: owner insert" on public.assets for insert with check (owner_id = auth.uid());
create policy "assets: owner delete" on public.assets for delete using (owner_id = auth.uid());
