-- SignCraft banner campaigns, A/B variants, click tracking and legal disclaimer templates.
-- Run after 0005. See docs/campaigns-and-analytics.md.
--
-- Privacy by construction: no IP address, user agent, e-mail address or location is ever stored.
--   click_events keeps a coarse device class and a visitor hash that is salted with a secret that changes every day
--   (the salt is computed by the server and is never stored), so a hash cannot be linked across days.
--   image loads are only counted, never recorded one by one.
-- Event tables have NO insert/update/delete privilege for the browser-facing roles. Rows appear only through
-- record_click() / record_image_load(), which only the server (service role) may execute.

/* ------------------------------------------------------------------ helpers */

create function public.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships where org_id = p_org and user_id = auth.uid() and role = 'admin')
$$;

create function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships where org_id = p_org and user_id = auth.uid())
$$;

/* ------------------------------------------------------------------- tables */

create table public.banner_campaigns (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 120),
  status       text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  starts_at    timestamptz,
  ends_at      timestamptz,
  href         text not null check (href ~ '^https://' and char_length(href) <= 1000),        -- where a click goes (the caller never chooses this)
  fallback_src text not null check (fallback_src ~ '^https://' and char_length(fallback_src) <= 1000), -- shown when no campaign is running
  fallback_alt text not null default '' check (char_length(fallback_alt) <= 160),
  rules_json   jsonb not null default '{}'::jsonb,                                             -- reserved for later targeting rules
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);
create index banner_campaigns_org_idx on public.banner_campaigns (org_id, created_at desc);

create table public.campaign_variants (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.banner_campaigns (id) on delete cascade,
  label       text not null default '' check (char_length(label) <= 60),
  image_url   text not null check (image_url ~ '^https://' and char_length(image_url) <= 1000),
  alt_text    text not null default '' check (char_length(alt_text) <= 160),
  width       integer not null default 400 check (width between 100 and 600),
  height      integer not null default 100 check (height between 20 and 300),
  weight      integer not null default 1 check (weight between 0 and 1000),
  created_at  timestamptz not null default now()
);
create index campaign_variants_campaign_idx on public.campaign_variants (campaign_id);

create table public.click_events (
  id           bigint generated always as identity primary key,
  campaign_id  uuid not null references public.banner_campaigns (id) on delete cascade,
  variant_id   uuid references public.campaign_variants (id) on delete set null,   -- null: the fallback banner was showing
  org_id       uuid not null references public.organizations (id) on delete cascade,
  day          date not null,
  occurred_at  timestamptz not null default now(),
  device_class text not null default 'other' check (device_class in ('desktop', 'mobile', 'tablet', 'other')),
  visitor_hash text not null check (char_length(visitor_hash) between 8 and 64)    -- daily-salted; unique clicks per day only
);
create index click_events_org_day_idx on public.click_events (org_id, day);
create index click_events_campaign_day_idx on public.click_events (campaign_id, day);

-- "Image loads", NOT impressions: mail apps prefetch (Apple Mail Privacy Protection) and proxy images, so this over-counts.
create table public.campaign_image_loads (
  id          bigint generated always as identity primary key,
  campaign_id uuid not null references public.banner_campaigns (id) on delete cascade,
  variant_id  uuid references public.campaign_variants (id) on delete cascade,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  day         date not null,
  loads       bigint not null default 0 check (loads >= 0)
);
create unique index campaign_image_loads_key on public.campaign_image_loads (campaign_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), day);
create index campaign_image_loads_org_day_idx on public.campaign_image_loads (org_id, day);

-- org_id null = a global template seeded by SignCraft; otherwise the organization's own.
create table public.legal_disclaimers (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid references public.organizations (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  category     text not null check (category in ('confidentiality', 'data_protection', 'financial', 'medical', 'legal', 'other')),
  jurisdiction text not null default '' check (char_length(jurisdiction) <= 60),
  body         text not null check (char_length(body) between 1 and 1500),  -- same limit as the disclaimer block
  needs_review boolean not null default true,                               -- true until a lawyer has approved the wording
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index legal_disclaimers_org_idx on public.legal_disclaimers (org_id);

create trigger banner_campaigns_touch before update on public.banner_campaigns for each row execute function public.touch_updated_at();
create trigger legal_disclaimers_touch before update on public.legal_disclaimers for each row execute function public.touch_updated_at();

/* ------------------------------------------------- server-only write functions */

create function public.record_click(p_campaign uuid, p_variant uuid, p_device text, p_visitor text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
  v_variant uuid := p_variant;
begin
  select org_id into v_org from public.banner_campaigns where id = p_campaign;
  if not found then return; end if;
  if v_variant is not null and not exists (select 1 from public.campaign_variants where id = v_variant and campaign_id = p_campaign) then
    v_variant := null;
  end if;
  insert into public.click_events (campaign_id, variant_id, org_id, day, device_class, visitor_hash)
  values (p_campaign, v_variant, v_org, (now() at time zone 'utc')::date,
          case when p_device in ('desktop', 'mobile', 'tablet') then p_device else 'other' end,
          left(coalesce(p_visitor, ''), 64));
end $$;

create function public.record_image_load(p_campaign uuid, p_variant uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
  v_variant uuid := p_variant;
begin
  select org_id into v_org from public.banner_campaigns where id = p_campaign;
  if not found then return; end if;
  if v_variant is not null and not exists (select 1 from public.campaign_variants where id = v_variant and campaign_id = p_campaign) then
    v_variant := null;
  end if;
  insert into public.campaign_image_loads (campaign_id, variant_id, org_id, day, loads)
  values (p_campaign, v_variant, v_org, (now() at time zone 'utc')::date, 1)
  on conflict (campaign_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), day)
  do update set loads = public.campaign_image_loads.loads + 1;
end $$;

-- Per campaign, variant and day. SECURITY INVOKER: row-level security applies, so only admins of the organization see rows.
create function public.campaign_stats(p_org uuid, p_from date, p_to date)
returns table (campaign_id uuid, variant_id uuid, day date, clicks bigint, unique_clicks bigint, image_loads bigint)
language plpgsql stable security invoker set search_path = '' as $$
declare z constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Date range must be between 0 and 400 days.' using errcode = '22023';
  end if;
  return query
    with c as (
      select e.campaign_id, coalesce(e.variant_id, z) v, e.day, count(*) n, count(distinct e.visitor_hash) u
        from public.click_events e where e.org_id = p_org and e.day between p_from and p_to group by 1, 2, 3
    ), l as (
      select i.campaign_id, coalesce(i.variant_id, z) v, i.day, sum(i.loads) n
        from public.campaign_image_loads i where i.org_id = p_org and i.day between p_from and p_to group by 1, 2, 3
    )
    select coalesce(c.campaign_id, l.campaign_id), nullif(coalesce(c.v, l.v), z), coalesce(c.day, l.day),
           coalesce(c.n, 0)::bigint, coalesce(c.u, 0)::bigint, coalesce(l.n, 0)::bigint
      from c full join l on c.campaign_id = l.campaign_id and c.v = l.v and c.day = l.day
     order by 3, 1;
end $$;

/* ------------------------------------------------------------- row security */

alter table public.banner_campaigns     enable row level security;
alter table public.campaign_variants    enable row level security;
alter table public.click_events         enable row level security;
alter table public.campaign_image_loads enable row level security;
alter table public.legal_disclaimers    enable row level security;

create function public.campaign_org(p_campaign uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select org_id from public.banner_campaigns where id = p_campaign
$$;

create policy "banner_campaigns: member read" on public.banner_campaigns for select to authenticated using (public.is_org_member(org_id));
create policy "banner_campaigns: org admin insert" on public.banner_campaigns for insert to authenticated with check (public.is_org_admin(org_id));
create policy "banner_campaigns: org admin update" on public.banner_campaigns for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy "banner_campaigns: org admin delete" on public.banner_campaigns for delete to authenticated using (public.is_org_admin(org_id));

create policy "campaign_variants: member read" on public.campaign_variants for select to authenticated using (public.is_org_member(public.campaign_org(campaign_id)));
create policy "campaign_variants: org admin insert" on public.campaign_variants for insert to authenticated with check (public.is_org_admin(public.campaign_org(campaign_id)));
create policy "campaign_variants: org admin update" on public.campaign_variants for update to authenticated using (public.is_org_admin(public.campaign_org(campaign_id))) with check (public.is_org_admin(public.campaign_org(campaign_id)));
create policy "campaign_variants: org admin delete" on public.campaign_variants for delete to authenticated using (public.is_org_admin(public.campaign_org(campaign_id)));

-- Events: readable by the organization's admins, with no write policy at all.
create policy "click_events: org admin read" on public.click_events for select to authenticated using (public.is_org_admin(org_id));
create policy "campaign_image_loads: org admin read" on public.campaign_image_loads for select to authenticated using (public.is_org_admin(org_id));

-- Disclaimers: everyone signed in reads the global templates and their own organization's; only org admins write their own.
create policy "legal_disclaimers: read" on public.legal_disclaimers for select to authenticated using (org_id is null or public.is_org_member(org_id));
create policy "legal_disclaimers: org admin insert" on public.legal_disclaimers for insert to authenticated with check (org_id is not null and public.is_org_admin(org_id));
create policy "legal_disclaimers: org admin update" on public.legal_disclaimers for update to authenticated using (org_id is not null and public.is_org_admin(org_id)) with check (org_id is not null and public.is_org_admin(org_id));
create policy "legal_disclaimers: org admin delete" on public.legal_disclaimers for delete to authenticated using (org_id is not null and public.is_org_admin(org_id));

/* --------------------------------------------------------------- privileges */

revoke all on public.banner_campaigns, public.campaign_variants, public.click_events, public.campaign_image_loads, public.legal_disclaimers from anon, authenticated;
grant select, insert, update, delete on public.banner_campaigns, public.campaign_variants, public.legal_disclaimers to authenticated;
grant select on public.click_events, public.campaign_image_loads to authenticated;

revoke execute on function
  public.is_org_admin(uuid), public.is_org_member(uuid), public.campaign_org(uuid), public.record_click(uuid, uuid, text, text),
  public.record_image_load(uuid, uuid), public.campaign_stats(uuid, date, date)
  from public, anon;
grant execute on function public.is_org_admin(uuid), public.is_org_member(uuid), public.campaign_org(uuid), public.campaign_stats(uuid, date, date) to authenticated;
-- record_click / record_image_load: no grant to the browser-facing roles. The server calls them with the service role.
revoke execute on function public.record_click(uuid, uuid, text, text), public.record_image_load(uuid, uuid) from authenticated;

/* -------------------------------------------------------------------- seeds */
-- Neutral starting points ONLY. None of this is legal advice; every one needs review by a lawyer for the organization
-- and jurisdiction in question before use (needs_review stays true until an admin copies and approves their own version).

insert into public.legal_disclaimers (org_id, title, category, jurisdiction, body, needs_review) values
  (null, 'Confidentiality notice (general)', 'confidentiality', 'General', $d$This email and any attachments are confidential and intended solely for the addressee. If you have received it in error, please notify the sender immediately and delete it. Any unauthorised use, disclosure or copying is not permitted.$d$, true),
  (null, 'Confidentiality notice (short)', 'confidentiality', 'General', $d$Confidential: intended for the named recipient only. If this reached you by mistake, please let the sender know and delete it.$d$, true),
  (null, 'Data protection (EU / GDPR)', 'data_protection', 'European Union', $d$This message may contain personal data. It is processed in accordance with the EU General Data Protection Regulation (GDPR). You may have rights to access, correct or erase your data; to exercise them, contact the sender or our data protection contact. If you are not the intended recipient, please delete this message and tell the sender.$d$, true),
  (null, 'Data protection (UK GDPR)', 'data_protection', 'United Kingdom', $d$This email may contain personal data and is handled in line with UK data protection law. If you are not the intended recipient, please delete it and notify the sender. Information on how we use personal data is available from us on request.$d$, true),
  (null, 'Financial communications (US)', 'financial', 'United States', $d$This message is for informational purposes only and is not an offer, solicitation or recommendation to buy or sell any security or financial product. Past performance is not a guarantee of future results. Investments involve risk, including possible loss of principal. Email is not secure; do not send confidential account information by email.$d$, true),
  (null, 'Medical privacy (US / HIPAA)', 'medical', 'United States', $d$This email may contain protected health information that is privileged and confidential under applicable law. It is intended only for the named recipient. If you are not the intended recipient, any review, use or disclosure is prohibited; please notify the sender immediately and delete this message.$d$, true),
  (null, 'Medical confidentiality (general)', 'medical', 'General', $d$This message may contain confidential health information intended only for the addressee. If you received it in error, please contact the sender and delete it. Please do not email urgent clinical concerns; contact your care provider directly.$d$, true),
  (null, 'Legal privilege (general)', 'legal', 'General', $d$This email may contain legally privileged and confidential information intended only for the addressee. Sending it to anyone else does not waive privilege. If you are not the intended recipient, please notify us and delete it; do not read, copy or distribute it.$d$, true),
  (null, 'No contract by email (general)', 'legal', 'General', $d$Unless expressly stated otherwise, nothing in this email creates a binding contract or commitment, and views expressed are the sender's own and not necessarily those of the company.$d$, true),
  (null, 'Virus and environment notice', 'other', 'General', $d$Please consider the environment before printing this email. We scan outgoing mail for viruses, but you should check attachments yourself; we accept no liability for damage caused by any virus transmitted by this email.$d$, true);
