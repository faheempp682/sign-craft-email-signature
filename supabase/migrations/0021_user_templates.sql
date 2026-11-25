-- "My templates": complete signature designs a person saved from the AI chat (or anywhere else) to reuse later.
-- Private to the owner. Sharing templates with a team is a separate, later feature.

create table public.user_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  doc_json jsonb not null check (jsonb_typeof(doc_json) = 'object'),
  source text not null default 'ai-chat' check (source in ('ai-chat', 'editor')),
  created_at timestamptz not null default now()
);

create index user_templates_owner_recent on public.user_templates (owner_id, created_at desc);

alter table public.user_templates enable row level security;

create policy "user_templates: owner select" on public.user_templates for select using (owner_id = auth.uid());
create policy "user_templates: owner insert" on public.user_templates for insert with check (owner_id = auth.uid());
create policy "user_templates: owner update" on public.user_templates for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "user_templates: owner delete" on public.user_templates for delete using (owner_id = auth.uid());
