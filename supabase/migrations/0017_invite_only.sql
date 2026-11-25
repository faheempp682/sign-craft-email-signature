-- Invite-only sign-up. Only an email address an admin has invited can create an account.
--
-- Why in the database: Supabase Auth's sign-up endpoint is public (it only needs the anon key that ships in the browser), so a
-- check inside our own sign-up form could be skipped by calling the endpoint directly. A trigger on auth.users cannot be skipped.
--
--   * An admin adds an email (and the role it will get) on /admin/invitations.
--   * That person opens the login page, chooses "I have an invitation" and sets a password. Supabase still emails a
--     confirmation link, so only the owner of the inbox can use the invitation.
--   * handle_new_user() then gives them the invited role in the default organization and marks the invitation used.
--   * Everyone who already has an account is unaffected: this only runs when an account is created.
--
-- First admin (one-time, in the SQL editor), then they sign up like anyone invited:
--   insert into public.invitations (email, role) values ('you@your-company.com', 'admin');
--
-- Accounts made from the Supabase dashboard ("Add user" / "Invite user") or the admin API are checked too. Add the invitation
-- first, or they are refused.

create table public.invitations (
  email       text primary key check (email = lower(btrim(email)) and char_length(email) between 3 and 254 and position('@' in email) > 1),
  role        public.app_role not null default 'member',
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);

alter table public.invitations enable row level security;

-- Platform admins manage invitations. Nobody else can even see who was invited.
create policy "invitations: admin read"   on public.invitations for select to authenticated using (public.is_admin());
create policy "invitations: admin insert" on public.invitations for insert to authenticated with check (public.is_admin());
create policy "invitations: admin update" on public.invitations for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "invitations: admin delete" on public.invitations for delete to authenticated using (public.is_admin());

-- Refuse to create an account for an address that has no open invitation.
create function public.require_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.invitations i
     where i.email = lower(btrim(coalesce(new.email, ''))) and i.accepted_at is null
  ) then
    raise exception 'Sign-up is by invitation only. Ask an admin to invite you.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger on_auth_user_requires_invitation before insert on auth.users
  for each row execute function public.require_invitation();

-- New accounts: profile, default-organization membership with the INVITED role, and the invitation is used up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  invited public.app_role;
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
    on conflict (id) do update set email = excluded.email;

  update public.invitations set accepted_at = now()
   where email = lower(btrim(coalesce(new.email, ''))) and accepted_at is null
   returning role into invited;

  insert into public.memberships (org_id, user_id, role)
    select id, new.id, coalesce(invited, 'member') from public.organizations where is_default
    on conflict do nothing;
  return new;
end $$;

revoke execute on function public.require_invitation(), public.handle_new_user() from public, anon, authenticated;
