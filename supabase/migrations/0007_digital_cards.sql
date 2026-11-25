-- SignCraft digital cards (Phase 4): a public landing page per person at /c/<slug>, with vCard download and QR code.
-- Run after 0005. See docs/digital-card.md.
--
-- Privacy model
--   * The table is NOT readable by anonymous visitors at all. They can only call public.get_public_card(slug), a
--     security definer function that returns the public columns of a PUBLISHED card (never owner_id, org_id or timestamps).
--   * Owners manage their own cards; admins can read and remove any card. Owners cannot transfer a card (owner_id is not updatable).
--   * Every URL stored is https, every field has a length cap, and each person may own at most 5 cards.

create table public.digital_cards (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  org_id       uuid references public.organizations (id) on delete set null,
  slug         text not null,
  display_name text not null check (char_length(display_name) between 1 and 100),
  title        text check (title is null or char_length(title) <= 100),
  company      text check (company is null or char_length(company) <= 100),
  bio          text check (bio is null or char_length(bio) <= 300),
  photo_url    text check (photo_url is null or (photo_url ~ '^https://[^\s]+$' and char_length(photo_url) <= 500)),
  phone        text check (phone is null or (phone ~ '^[0-9+()./ -]{3,30}$')),
  email        text check (email is null or (email ~ '^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$' and char_length(email) <= 200)),
  website      text check (website is null or (website ~ '^https://[^\s]+$' and char_length(website) <= 500)),
  address      text check (address is null or char_length(address) <= 200),
  social_links jsonb not null default '[]'::jsonb,
  booking_url  text check (booking_url is null or (booking_url ~ '^https://[^\s]+$' and char_length(booking_url) <= 500)),
  accent_color text not null default '#111111' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  published    boolean not null default false,
  indexable    boolean not null default false,   -- search engines may list the page only when the owner opts in
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint digital_cards_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  constraint digital_cards_slug_reserved check (slug <> all (array[
    'admin','api','app','auth','login','logout','signup','signin','c','b','r','card','cards','new','edit','settings','static',
    'public','assets','www','mail','help','support','about','terms','privacy','sitemap','robots','signatures','editor','create',
    'preview','guides','billing','null','undefined','vcard','qr'
  ]))
);

create unique index digital_cards_slug_key on public.digital_cards (slug);
create index digital_cards_owner_idx on public.digital_cards (owner_id, created_at desc);

/* ------------------------------------------------------------------ validation */

-- social_links must be an array of at most 10 {network, url} objects with a known network and an https url.
create function public.digital_card_socials_valid(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  item jsonb;
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) > 10 then return false; end if;
  for item in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(item) is distinct from 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(item)) <> 2 then return false; end if;
    if jsonb_typeof(item -> 'network') is distinct from 'string' or jsonb_typeof(item -> 'url') is distinct from 'string' then return false; end if;
    if (item ->> 'network') not in ('linkedin','twitter','facebook','instagram','youtube','github','tiktok') then return false; end if;
    if (item ->> 'url') !~ '^https://[^\s]+$' or char_length(item ->> 'url') > 500 then return false; end if;
  end loop;
  return true;
end $$;

alter table public.digital_cards add constraint digital_cards_socials_valid check (public.digital_card_socials_valid(social_links));

-- Keep updated_at honest.
create function public.digital_cards_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger digital_cards_touch before update on public.digital_cards
  for each row execute function public.digital_cards_touch();

-- At most 5 cards per person. Serialised per owner so two parallel inserts cannot both slip under the cap.
create function public.digital_cards_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('digital_cards:' || new.owner_id::text, 0));
  if (select count(*) from public.digital_cards where owner_id = new.owner_id) >= 5 then
    raise exception 'You can have at most 5 digital cards.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger digital_cards_cap before insert on public.digital_cards
  for each row execute function public.digital_cards_cap();

/* ----------------------------------------------------------------- row security */

alter table public.digital_cards enable row level security;

create policy "digital_cards: owner read" on public.digital_cards for select to authenticated using (owner_id = auth.uid());
create policy "digital_cards: admin read" on public.digital_cards for select to authenticated using (public.is_admin());

-- An owner may attach a card to an organization only if they belong to it.
create policy "digital_cards: owner insert" on public.digital_cards for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (org_id is null or exists (select 1 from public.memberships m where m.org_id = digital_cards.org_id and m.user_id = auth.uid()))
  );
create policy "digital_cards: owner update" on public.digital_cards for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and (org_id is null or exists (select 1 from public.memberships m where m.org_id = digital_cards.org_id and m.user_id = auth.uid()))
  );
create policy "digital_cards: owner delete" on public.digital_cards for delete to authenticated using (owner_id = auth.uid());
create policy "digital_cards: admin delete" on public.digital_cards for delete to authenticated using (public.is_admin());

/* ------------------------------------------------------------------ privileges */

revoke all on public.digital_cards from anon, authenticated;
grant select, delete on public.digital_cards to authenticated;
grant insert (owner_id, org_id, slug, display_name, title, company, bio, photo_url, phone, email, website, address, social_links, booking_url, accent_color, published, indexable)
  on public.digital_cards to authenticated;
-- owner_id and created_at are deliberately absent: a card cannot be handed to someone else.
grant update (org_id, slug, display_name, title, company, bio, photo_url, phone, email, website, address, social_links, booking_url, accent_color, published, indexable)
  on public.digital_cards to authenticated;

/* ------------------------------------------------------- the only anonymous door */

-- What a visitor may see of a published card. No owner_id, no org_id, no timestamps, nothing for unpublished cards.
create function public.get_public_card(p_slug text)
returns table (
  slug text, display_name text, title text, company text, bio text, photo_url text, phone text, email text,
  website text, address text, social_links jsonb, booking_url text, accent_color text, indexable boolean
)
language sql stable security definer set search_path = '' as $$
  select c.slug, c.display_name, c.title, c.company, c.bio, c.photo_url, c.phone, c.email,
         c.website, c.address, c.social_links, c.booking_url, c.accent_color, c.indexable
    from public.digital_cards c
   where c.slug = lower(p_slug) and c.published
$$;

-- For the editor: is this address free? (Reveals only whether the address is taken, which the unique index implies anyway.)
create function public.digital_card_slug_available(p_slug text, p_except uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.digital_cards where slug = lower(p_slug) and id is distinct from p_except)
$$;

revoke execute on function
  public.get_public_card(text), public.digital_card_slug_available(text, uuid), public.digital_cards_cap(), public.digital_cards_touch(),
  public.digital_card_socials_valid(jsonb)
  from public, anon, authenticated;
grant execute on function public.get_public_card(text) to anon, authenticated;
grant execute on function public.digital_card_slug_available(text, uuid) to authenticated;
-- The validation function is called by the table's own CHECK, which runs as the writer, so it must stay executable.
grant execute on function public.digital_card_socials_valid(jsonb) to authenticated;
