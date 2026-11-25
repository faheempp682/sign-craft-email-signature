-- Saved AI design chats: the messages, the designs the AI produced, and small thumbnails of attached images.
-- Private to the person who had the chat. Nobody else (including organization admins) can read them.

create table public.ai_chats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'New chat' check (char_length(title) between 1 and 80),
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_chats_owner_recent on public.ai_chats (owner_id, updated_at desc);

alter table public.ai_chats enable row level security;

create policy "ai_chats: owner select" on public.ai_chats for select using (owner_id = auth.uid());
create policy "ai_chats: owner insert" on public.ai_chats for insert with check (owner_id = auth.uid());
create policy "ai_chats: owner update" on public.ai_chats for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "ai_chats: owner delete" on public.ai_chats for delete using (owner_id = auth.uid());

create or replace function public.ai_chats_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger ai_chats_touch before update on public.ai_chats for each row execute function public.ai_chats_touch();
