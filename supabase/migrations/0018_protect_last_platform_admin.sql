-- The last PLATFORM admin cannot be demoted or removed.
--
-- 0003 refused to remove "the last admin" counting admins of ANY organization. Since 0016 a platform admin is an admin of the
-- DEFAULT organization only, so with a client organization's admin around, the last default-organization admin could be demoted
-- or removed, leaving nobody able to change feature flags, AI limits or memberships (only the ADMIN_EMAILS bootstrap could
-- recover that). The default organization's last admin is now protected on its own.
--
-- Admins of other organizations are not protected by this rule: an organization with no admin is repaired by a platform admin
-- (or its agency). With no default organization at all, the old rule applies (an admin anywhere counts), so a deployment can
-- never lock itself out.

create or replace function public.protect_last_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  default_org uuid;
begin
  if pg_trigger_depth() = 1 and old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.org_id <> old.org_id) then
    select id into default_org from public.organizations where is_default;
    if default_org is null then
      if not exists (select 1 from public.memberships where role = 'admin' and (org_id, user_id) <> (old.org_id, old.user_id)) then
        raise exception 'There must be at least one admin.' using errcode = 'P0001';
      end if;
    elsif old.org_id = default_org then
      if not exists (select 1 from public.memberships where role = 'admin' and org_id = default_org and user_id <> old.user_id) then
        raise exception 'There must be at least one admin.' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
