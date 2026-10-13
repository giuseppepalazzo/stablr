-- Private Percorso drafts belonging to a private new Club draft.
-- Apply once, after admin-catalog-workflow.sql, admin-club-editor.sql and
-- admin-catalog-abandon-draft.sql. No live rows, versions or backfill.
begin;

create function public.admin_new_club_course_snapshot(p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare ordering numeric; display_name text;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or not (p_snapshot ?& array['name','holes_count','display_order'])
    or (p_snapshot - array['name','holes_count','display_order']) <> '{}'::jsonb
    or jsonb_typeof(p_snapshot->'name') is distinct from 'string'
    or jsonb_typeof(p_snapshot->'holes_count') is distinct from 'number'
    or jsonb_typeof(p_snapshot->'display_order') is distinct from 'number' then
    raise exception 'Only name, 9/18 structure and integer order are allowed' using errcode = '22023';
  end if;
  display_name := btrim(p_snapshot->>'name');
  ordering := (p_snapshot->>'display_order')::numeric;
  if display_name = '' or char_length(display_name) > 200
    or (p_snapshot->>'holes_count')::numeric not in (9,18)
    or ordering <> trunc(ordering) or ordering not between -2147483648 and 2147483647 then
    raise exception 'Invalid private Percorso fields' using errcode = '22023';
  end if;
  return jsonb_build_object('name',display_name,'holes_count',(p_snapshot->>'holes_count')::numeric::integer,
    'display_order',ordering::integer);
end;
$$;

create function public.admin_new_club_course_parent(p_club_draft_id uuid, p_lock boolean default false)
returns public.admin_catalog_drafts language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; result public.admin_catalog_drafts;
begin
  actor := public.admin_catalog_require_admin();
  if p_lock then
    select d.* into result from public.admin_catalog_drafts d where d.draft_id = p_club_draft_id for update nowait;
  else
    select d.* into result from public.admin_catalog_drafts d where d.draft_id = p_club_draft_id;
  end if;
  if result.draft_id is null or result.created_by is distinct from actor
    or result.entity_type <> 'club' or result.live_entity_id is not null
    or result.parent_draft_id is not null or result.base_version_id is not null
    or result.base_snapshot is not null or result.base_live_updated_at is not null
    or result.schema_version <> 1 then
    raise exception 'Owned private new Club draft required' using errcode = '42501';
  end if;
  if result.workflow_status <> 'draft' then
    raise exception 'Parent Club draft is closed' using errcode = '40001';
  end if;
  return result;
end;
$$;

-- Guard only route drafts under a private new Club. Existing live editors and
-- their triggers are untouched. Generic workflow RPCs cannot bypass ownership,
-- the field allowlist, or reparent this private child to another entity.
create function public.admin_new_club_course_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare parent_id uuid; parent public.admin_catalog_drafts; actor uuid;
begin
  if tg_op = 'UPDATE' and old.entity_type = 'route' and old.parent_draft_id is not null then
    parent_id := old.parent_draft_id;
  elsif new.entity_type = 'route' and new.parent_draft_id is not null then
    parent_id := new.parent_draft_id;
  else return new;
  end if;
  select d.* into parent from public.admin_catalog_drafts d where d.draft_id = parent_id;
  if parent.entity_type is distinct from 'club' or parent.live_entity_id is not null
    or parent.parent_draft_id is not null or parent.base_snapshot is not null then return new; end if;
  actor := public.admin_catalog_require_admin();
  -- Also serialize generic child writes with parent archival, without waiting.
  perform 1 from public.admin_catalog_drafts d where d.draft_id = parent_id for share nowait;
  perform public.admin_new_club_course_parent(parent_id);
  if new.created_by is distinct from actor or new.updated_by is distinct from actor then
    raise exception 'Private Percorso belongs to another Admin' using errcode = '42501';
  end if;
  if new.entity_type <> 'route' or new.live_entity_id is not null
    or new.base_snapshot is not null or new.base_version_id is not null
    or new.base_live_updated_at is not null or new.schema_version <> 1 then
    raise exception 'Private Percorso cannot reference live or published data' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if row(new.draft_id,new.entity_type,new.entity_key,new.live_entity_id,new.parent_draft_id,
      new.base_version_id,new.base_snapshot,new.base_live_updated_at,new.created_by,new.created_at)
      is distinct from row(old.draft_id,old.entity_type,old.entity_key,old.live_entity_id,old.parent_draft_id,
      old.base_version_id,old.base_snapshot,old.base_live_updated_at,old.created_by,old.created_at) then
      raise exception 'Private Percorso identity is immutable' using errcode = '22023';
    end if;
    if old.workflow_status <> 'draft' or new.revision <> old.revision + 1 then
      raise exception 'Private Percorso closed or revision changed' using errcode = '40001';
    end if;
  end if;
  if new.workflow_status not in ('draft','archived') then
    raise exception 'Private Percorso cannot be published' using errcode = '22023';
  end if;
  new.snapshot := public.admin_new_club_course_snapshot(new.snapshot);
  return new;
end;
$$;
create trigger admin_new_club_course_guard before insert or update on public.admin_catalog_drafts
  for each row execute function public.admin_new_club_course_guard();

create function public.admin_new_club_courses(p_club_draft_id uuid)
returns setof public.admin_catalog_drafts language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; child public.admin_catalog_drafts;
begin
  actor := public.admin_catalog_require_admin();
  perform public.admin_new_club_course_parent(p_club_draft_id);
  for child in select d.* from public.admin_catalog_drafts d
    where d.parent_draft_id = p_club_draft_id and d.entity_type = 'route'
      and d.created_by = actor and d.workflow_status = 'draft'
    order by (d.snapshot->>'display_order')::integer, d.created_at, d.draft_id
  loop
    if child.live_entity_id is not null or child.base_version_id is not null
      or child.base_snapshot is not null or child.schema_version <> 1 then
      raise exception 'Incompatible private Percorso draft' using errcode = '22023';
    end if;
    perform public.admin_new_club_course_snapshot(child.snapshot);
    return next child;
  end loop;
end;
$$;

create function public.admin_new_club_course_save(
  p_club_draft_id uuid, p_snapshot jsonb, p_draft_id uuid default null,
  p_expected_revision bigint default null
)
returns public.admin_catalog_drafts language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; normalized jsonb; child public.admin_catalog_drafts;
begin
  actor := public.admin_catalog_require_admin();
  perform public.admin_new_club_course_parent(p_club_draft_id,true);
  normalized := public.admin_new_club_course_snapshot(p_snapshot);
  if p_draft_id is null then
    if p_expected_revision is not null then raise exception 'New Percorso has no revision' using errcode = '22023'; end if;
    return public.admin_catalog_create_draft('route',normalized,null,p_club_draft_id,null,1);
  end if;
  select d.* into child from public.admin_catalog_drafts d where d.draft_id = p_draft_id for update nowait;
  if child.draft_id is null or child.created_by is distinct from actor
    or child.parent_draft_id is distinct from p_club_draft_id or child.entity_type <> 'route'
    or child.live_entity_id is not null or child.base_version_id is not null
    or child.base_snapshot is not null or child.schema_version <> 1 then
    raise exception 'Owned private Percorso required' using errcode = '42501';
  end if;
  return public.admin_catalog_save_draft(p_draft_id,normalized,p_expected_revision,1);
end;
$$;

create function public.admin_new_club_course_archive(
  p_club_draft_id uuid, p_draft_id uuid, p_expected_revision bigint
)
returns public.admin_catalog_drafts language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; child public.admin_catalog_drafts;
begin
  actor := public.admin_catalog_require_admin();
  perform public.admin_new_club_course_parent(p_club_draft_id,true);
  select d.* into child from public.admin_catalog_drafts d where d.draft_id = p_draft_id for update nowait;
  if child.draft_id is null or child.created_by is distinct from actor
    or child.parent_draft_id is distinct from p_club_draft_id or child.entity_type <> 'route'
    or child.live_entity_id is not null or child.base_version_id is not null
    or child.base_snapshot is not null or child.schema_version <> 1 then
    raise exception 'Owned private Percorso required' using errcode = '42501';
  end if;
  return public.admin_catalog_archive_draft(p_draft_id,'route',p_expected_revision);
end;
$$;

revoke all on function public.admin_new_club_course_snapshot(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_club_course_parent(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_club_course_guard() from public,anon,authenticated,service_role;
revoke all on function public.admin_new_club_courses(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_club_course_save(uuid,jsonb,uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_club_course_archive(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.admin_new_club_courses(uuid) to authenticated;
grant execute on function public.admin_new_club_course_save(uuid,jsonb,uuid,bigint) to authenticated;
grant execute on function public.admin_new_club_course_archive(uuid,uuid,bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
