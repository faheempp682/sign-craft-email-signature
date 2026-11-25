-- Platform-wide settings an admin can change without a redeploy. Today: how many saved signatures one account may keep.
--
-- Everyone signed in can read a setting (the app needs the limit to show "2 of 5"); only platform admins can change one.
-- When a key has no row, the app falls back to the MAX_SIGNATURES_PER_ACCOUNT environment variable, then to 5.

create table public.platform_settings (
  key        text primary key check (key ~ '^[a-z0-9_]{1,60}$'),
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

create policy "platform_settings: read"         on public.platform_settings for select to authenticated using (true);
create policy "platform_settings: admin insert" on public.platform_settings for insert to authenticated with check (public.is_admin());
create policy "platform_settings: admin update" on public.platform_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "platform_settings: admin delete" on public.platform_settings for delete to authenticated using (public.is_admin());
