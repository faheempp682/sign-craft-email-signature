-- "Platform admin" means an admin of the DEFAULT organization (the one every sign-up joins and ADMIN_EMAILS promotes into).
--
-- Until now is_admin() meant "admin in ANY organization". That was harmless while there was one organization. With agency
-- mode (0015) there are client organizations with their own admins, and "admin anywhere" would let a client's admin:
--   * rewrite the global feature flags, plan-independent AI limits and per-person overrides,
--   * edit every membership, including promoting themselves to admin of the agency's own organization,
--   * read every profile (email addresses) and every AI usage row.
-- Those tables are guarded by is_admin(), which is the right guard for PLATFORM settings, so is_admin() itself is narrowed.
--
-- Organization-level admin power is unchanged: is_org_admin(org) still governs everything inside one organization (team,
-- campaigns, deployments, sync, cards...), including the agency rule from 0015.
--
-- Behaviour for a single-organization deployment is identical: its admins are admins of the default organization.
-- If no default organization exists at all, the old rule applies, so a deployment can never lock itself out.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select
    exists (
      select 1
        from public.memberships m
        join public.organizations o on o.id = m.org_id
       where m.user_id = auth.uid() and m.role = 'admin' and o.is_default
    )
    or (
      not exists (select 1 from public.organizations where is_default)
      and public.app_role_of(auth.uid()) = 'admin'
    )
$$;
