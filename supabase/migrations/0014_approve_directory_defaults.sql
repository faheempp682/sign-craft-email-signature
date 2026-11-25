-- Directory people (from CSV or a directory sync) often have no SignCraft account, so they can never submit their own
-- signature, and bulk deploy only ever deploys APPROVED signatures. This lets an organization admin approve the brand
-- template's signature for people who have none yet.
--
-- Deliberately narrow:
--   * admins of that organization only;
--   * only ACTIVE people with NO approved version at all: it never replaces a signature someone already has approved;
--   * only people a brand template applies to (department targeting is respected);
--   * no per-person overrides: the result is exactly the template filled from the person's directory data;
--   * at most 1000 people per call.
-- Each approval is recorded like any other (who approved it, when, and a note saying it was a directory default).

create function public.approve_directory_defaults(p_org uuid, p_person_ids uuid[] default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r record;
  v_tpl public.brand_templates;
  v_created integer := 0;
  v_already integer := 0;
  v_no_template integer := 0;
begin
  if auth.uid() is null or not public.is_org_admin(p_org) then
    raise exception 'You do not have permission to do that.' using errcode = 'TM006';
  end if;
  if p_person_ids is not null and cardinality(p_person_ids) > 1000 then
    raise exception 'Choose at most 1000 people at a time.' using errcode = 'TM007';
  end if;

  for r in
    select id from public.people
     where org_id = p_org and status = 'active' and (p_person_ids is null or id = any (p_person_ids))
     order by id
       for update
  loop
    if exists (select 1 from public.signature_versions where person_id = r.id and status = 'approved') then
      v_already := v_already + 1;
      continue;
    end if;
    select * into v_tpl from public.brand_templates where id = public.template_for_person(r.id);
    if not found then
      v_no_template := v_no_template + 1;
      continue;
    end if;
    insert into public.signature_versions (org_id, person_id, template_id, template_snapshot, values_json, version_no, status, submitted_by, reviewed_by, reviewed_at, review_note)
    values (
      p_org, r.id, v_tpl.id,
      jsonb_build_object('name', v_tpl.name, 'doc', v_tpl.doc_json, 'lock', v_tpl.lock_json, 'field_map', v_tpl.field_map),
      '{}'::jsonb,
      coalesce((select max(version_no) from public.signature_versions where person_id = r.id), 0) + 1,
      'approved', auth.uid(), auth.uid(), now(), 'Approved by an administrator (directory default).'
    );
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('created', v_created, 'already_approved', v_already, 'no_template', v_no_template);
end $$;

revoke execute on function public.approve_directory_defaults(uuid, uuid[]) from public, anon;
grant execute on function public.approve_directory_defaults(uuid, uuid[]) to authenticated;
