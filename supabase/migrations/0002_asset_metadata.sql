-- Remember what the optimizer did, so the editor's compatibility check can explain image problems on later visits.
alter table public.assets
  add column if not exists animated      boolean not null default false,
  add column if not exists original_size integer;   -- bytes as uploaded, when the image was optimized

-- The editor looks assets up by public URL.
create index if not exists assets_owner_url_idx on public.assets (owner_id, url);
