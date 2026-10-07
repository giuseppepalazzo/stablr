-- Existing single-course tee/rating editor only. Apply manually, once.
-- Requires fig-whs-extension.sql, admin-catalog-workflow.sql,
-- admin-club-editor.sql and admin-catalog-abandon-draft.sql.
-- No live schema/policy/grant changes, backfill, combination tees or distances.
begin;

create unique index admin_course_tee_open_owner_idx
  on public.admin_catalog_drafts(live_entity_id,created_by)
  where entity_type = 'route_tee' and workflow_status = 'draft';

create function public.admin_course_tee_validate_snapshot(p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare cr numeric; slope numeric;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or not (p_snapshot ?& array['course_rating','slope_rating','is_active'])
    or (p_snapshot - array['course_rating','slope_rating','is_active']) <> '{}'::jsonb
    or jsonb_typeof(p_snapshot -> 'course_rating') not in ('number','null')
    or jsonb_typeof(p_snapshot -> 'slope_rating') not in ('number','null')
    or jsonb_typeof(p_snapshot -> 'is_active') is distinct from 'boolean' then
    raise exception 'Only numeric/null CR, integer/null Slope and boolean active state are allowed' using errcode = '22023';
  end if;
  cr := (p_snapshot ->> 'course_rating')::numeric;
  slope := (p_snapshot ->> 'slope_rating')::numeric;
  -- JSON numeric values are finite. Preserve nullable ratings and the existing
  -- live Slope constraint; do not introduce a new CR range or decimal precision.
  if slope is not null and (slope <> trunc(slope) or slope not between 55 and 155) then
    raise exception 'Slope must be an integer between 55 and 155, or null' using errcode = '23514';
  end if;
  return jsonb_build_object('course_rating',cr,'slope_rating',slope::integer,
    'is_active',(p_snapshot ->> 'is_active')::boolean);
end;
$$;

create function public.admin_course_tee_context(p_tee_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'tee',to_jsonb(t) - 'source_payload' || jsonb_build_object('effective_holes_count',coalesce(t.holes_count,r.holes_count)),
    'course',jsonb_build_object('id',r.id,'club_id',r.club_id,'name',r.name,'holes_count',r.holes_count,'total_par',r.total_par),
    'base',jsonb_build_object('tee',to_jsonb(t),'course',to_jsonb(r),'club',jsonb_build_object('id',c.id,'is_active',c.is_active)))
  from public.route_tees t join public.course_routes r on r.id = t.route_id
    join public.clubs c on c.id = r.club_id and c.is_active
  where t.id = p_tee_id;
$$;

create function public.admin_course_tee_lock_target(p_tee_id uuid)
returns public.route_tees language plpgsql security definer set search_path = pg_catalog
as $$
declare parent_id uuid; club_id uuid; result public.route_tees;
begin
  select t.route_id into parent_id from public.route_tees t where t.id = p_tee_id;
  if not found then raise exception 'Existing course tee required' using errcode = '22023'; end if;
  -- Match parent-before-child ordering. NOWAIT avoids waiting in a lock cycle
  -- with existing catalog editors. Protect the parent/context during publication.
  select r.club_id into club_id from public.course_routes r where r.id = parent_id for share nowait;
  if not found then raise exception 'Existing course required' using errcode = '22023'; end if;
  perform c.id from public.clubs c where c.id = club_id and c.is_active for share nowait;
  if not found then raise exception 'Active Club required' using errcode = '22023'; end if;
  select t.* into result from public.route_tees t where t.id = p_tee_id for update nowait;
  if not found or result.route_id is distinct from parent_id then
    raise exception 'Tee target changed' using errcode = '40001';
  end if;
  return result;
end;
$$;

create function public.admin_course_tee_guard_draft()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid;
begin
  if tg_op = 'INSERT' then
    if new.entity_type <> 'route_tee' then return new; end if;
  elsif old.entity_type <> 'route_tee' and new.entity_type <> 'route_tee' then
    return new;
  end if;
  actor := public.admin_catalog_require_admin();
  if new.entity_type <> 'route_tee' or new.live_entity_id is null
    or new.entity_key is distinct from new.live_entity_id
    or new.parent_draft_id is not null or new.schema_version <> 1
    or new.base_snapshot is null or jsonb_typeof(new.base_snapshot -> '_context') is distinct from 'object'
    or new.created_by <> actor or new.updated_by <> actor then
    raise exception 'Owned existing course tee editor draft required' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.created_by <> actor then raise exception 'Tee draft belongs to another Admin' using errcode = '42501'; end if;
    if row(new.draft_id,new.entity_type,new.entity_key,new.live_entity_id,new.parent_draft_id,
      new.base_version_id,new.base_snapshot,new.base_live_updated_at,new.created_by,new.created_at)
      is distinct from row(old.draft_id,old.entity_type,old.entity_key,old.live_entity_id,old.parent_draft_id,
      old.base_version_id,old.base_snapshot,old.base_live_updated_at,old.created_by,old.created_at) then
      raise exception 'Tee draft identity and base are immutable' using errcode = '22023';
    end if;
    if old.workflow_status <> 'draft' or new.revision <> old.revision + 1 then
      raise exception 'Tee draft closed or changed' using errcode = '40001';
    end if;
  elsif new.workflow_status <> 'draft' or new.revision <> 1 then
    raise exception 'New tee draft must be open' using errcode = '22023';
  end if;
  new.snapshot := public.admin_course_tee_validate_snapshot(new.snapshot);
  return new;
end;
$$;
create trigger admin_course_tee_guard_draft before insert or update on public.admin_catalog_drafts
  for each row execute function public.admin_course_tee_guard_draft();

create function public.admin_course_tee_list(p_course_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; course public.course_routes; result jsonb;
begin
  actor := public.admin_catalog_require_admin();
  select r.* into course from public.course_routes r join public.clubs c on c.id = r.club_id and c.is_active where r.id = p_course_id;
  if not found then raise exception 'Existing course in active Club required' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) - 'source_payload' || jsonb_build_object(
    'effective_holes_count',coalesce(t.holes_count,course.holes_count),
    'has_draft_changes',exists(select 1 from public.admin_catalog_drafts d where d.entity_type = 'route_tee'
      and d.live_entity_id = t.id and d.created_by = actor and d.workflow_status = 'draft'
      and d.snapshot is distinct from jsonb_build_object('course_rating',t.course_rating,'slope_rating',t.slope_rating,'is_active',t.is_active)))
    order by lower(t.tee_name),coalesce(t.holes_count,course.holes_count),t.gender,t.id),'[]'::jsonb)
    into result from public.route_tees t where t.route_id = course.id;
  return jsonb_build_object('course',jsonb_build_object('id',course.id,'name',course.name,'holes_count',course.holes_count),'tees',result);
end;
$$;

create function public.admin_course_tee_get_draft(p_tee_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; context jsonb; draft public.admin_catalog_drafts;
begin
  actor := public.admin_catalog_require_admin();
  context := public.admin_course_tee_context(p_tee_id);
  if context is null then raise exception 'Existing course tee in active Club required' using errcode = '22023'; end if;
  select d.* into draft from public.admin_catalog_drafts d where d.entity_type = 'route_tee'
    and d.live_entity_id = p_tee_id and d.created_by = actor and d.workflow_status = 'draft';
  return jsonb_build_object('draft',case when draft.draft_id is null then null else to_jsonb(draft) end,'context',context);
end;
$$;

create function public.admin_course_tee_open_draft(p_tee_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; live public.route_tees; context jsonb; draft public.admin_catalog_drafts;
  latest public.admin_catalog_versions; snapshot jsonb;
begin
  actor := public.admin_catalog_require_admin();
  live := public.admin_course_tee_lock_target(p_tee_id);
  context := public.admin_course_tee_context(live.id);
  select d.* into draft from public.admin_catalog_drafts d where d.entity_type = 'route_tee'
    and d.live_entity_id = live.id and d.created_by = actor and d.workflow_status = 'draft';
  if not found then
    snapshot := jsonb_build_object('course_rating',live.course_rating,'slope_rating',live.slope_rating,'is_active',live.is_active);
    select v.* into latest from public.admin_catalog_versions v where v.entity_type = 'route_tee'
      and v.live_entity_id = live.id order by v.version_number desc limit 1;
    insert into public.admin_catalog_drafts(entity_type,entity_key,live_entity_id,base_version_id,
      snapshot,base_snapshot,base_live_updated_at,created_by,updated_by)
      values('route_tee',live.id,live.id,latest.version_id,snapshot,
        snapshot || jsonb_build_object('_context',context -> 'base'),live.updated_at,actor,actor) returning * into draft;
  end if;
  return jsonb_build_object('draft',to_jsonb(draft),'context',context);
end;
$$;

create function public.admin_course_tee_save_draft(p_draft_id uuid,p_snapshot jsonb,p_expected_revision bigint)
returns public.admin_catalog_drafts language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid;
begin
  actor := public.admin_catalog_require_admin();
  if not exists(select 1 from public.admin_catalog_drafts d where d.draft_id = p_draft_id
    and d.entity_type = 'route_tee' and d.created_by = actor and d.base_snapshot is not null) then
    raise exception 'Owned course tee draft required' using errcode = '42501';
  end if;
  return public.admin_catalog_save_draft(p_draft_id,public.admin_course_tee_validate_snapshot(p_snapshot),p_expected_revision,1);
end;
$$;

create function public.admin_course_tee_archive_draft(p_draft_id uuid,p_expected_revision bigint)
returns public.admin_catalog_drafts language plpgsql security definer set search_path = pg_catalog
as $$
begin
  perform public.admin_catalog_require_admin();
  return public.admin_catalog_archive_draft(p_draft_id,'route_tee',p_expected_revision);
end;
$$;

create function public.admin_course_tee_publish_draft(p_draft_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; draft public.admin_catalog_drafts; live public.route_tees;
  context jsonb; requested jsonb; actual jsonb; changes jsonb := '{}'::jsonb;
  field text; latest_id uuid; version public.admin_catalog_versions; next_number bigint;
begin
  actor := public.admin_catalog_require_admin();
  select d.* into draft from public.admin_catalog_drafts d where d.draft_id = p_draft_id
    and d.entity_type = 'route_tee' and d.created_by = actor and d.base_snapshot is not null;
  if not found then raise exception 'Owned existing course tee draft required' using errcode = '42501'; end if;
  live := public.admin_course_tee_lock_target(draft.live_entity_id);
  select d.* into draft from public.admin_catalog_drafts d where d.draft_id = p_draft_id for update;
  if draft.entity_type <> 'route_tee' or draft.live_entity_id <> live.id or draft.entity_key <> live.id
    or draft.created_by <> actor or draft.updated_by <> actor or draft.schema_version <> 1
    or draft.parent_draft_id is not null or draft.base_snapshot is null then
    raise exception 'Invalid owned tee draft' using errcode = '22023';
  end if;
  if draft.workflow_status <> 'draft' or p_expected_revision is null or draft.revision <> p_expected_revision then
    raise exception 'Tee draft closed or changed since confirmation' using errcode = '40001';
  end if;
  requested := public.admin_course_tee_validate_snapshot(draft.snapshot);
  context := public.admin_course_tee_context(live.id);
  select v.version_id into latest_id from public.admin_catalog_versions v where v.entity_type = 'route_tee'
    and v.live_entity_id = live.id order by v.version_number desc limit 1;
  actual := jsonb_build_object('course_rating',live.course_rating,'slope_rating',live.slope_rating,'is_active',live.is_active);
  if live.updated_at is distinct from draft.base_live_updated_at
    or actual || jsonb_build_object('_context',context -> 'base') is distinct from draft.base_snapshot
    or latest_id is distinct from draft.base_version_id then
    raise exception 'Tee or parent course changed since base' using errcode = '40001';
  end if;
  foreach field in array array['course_rating','slope_rating','is_active'] loop
    if actual -> field is distinct from requested -> field then
      changes := changes || jsonb_build_object(field,jsonb_build_object('before',actual -> field,'after',requested -> field));
    end if;
  end loop;
  if changes = '{}'::jsonb then raise exception 'No tee changes to publish' using errcode = '22023'; end if;
  update public.route_tees set course_rating = (requested ->> 'course_rating')::numeric,
    slope_rating = (requested ->> 'slope_rating')::integer,is_active = (requested ->> 'is_active')::boolean,
    updated_at = clock_timestamp() where id = live.id returning * into live;
  select coalesce(max(v.version_number),0) + 1 into next_number from public.admin_catalog_versions v
    where v.entity_type = 'route_tee' and v.entity_key = draft.entity_key;
  insert into public.admin_catalog_versions(entity_type,entity_key,live_entity_id,source_draft_id,
    version_number,schema_version,snapshot,diff,published_by,published_at)
    values('route_tee',draft.entity_key,live.id,draft.draft_id,next_number,1,requested,changes,actor,clock_timestamp()) returning * into version;
  update public.admin_catalog_drafts set workflow_status = 'published',revision = revision + 1,
    updated_by = actor,updated_at = clock_timestamp() where draft_id = draft.draft_id;
  return jsonb_build_object('version_id',version.version_id,'version_number',version.version_number,
    'draft_id',draft.draft_id,'diff',changes,'context',public.admin_course_tee_context(live.id));
end;
$$;

revoke all on function public.admin_course_tee_validate_snapshot(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_context(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_lock_target(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_guard_draft() from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_list(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_get_draft(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_open_draft(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_save_draft(uuid,jsonb,bigint) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_archive_draft(uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_publish_draft(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.admin_course_tee_list(uuid) to authenticated;
grant execute on function public.admin_course_tee_get_draft(uuid) to authenticated;
grant execute on function public.admin_course_tee_open_draft(uuid) to authenticated;
grant execute on function public.admin_course_tee_save_draft(uuid,jsonb,bigint) to authenticated;
grant execute on function public.admin_course_tee_archive_draft(uuid,bigint) to authenticated;
grant execute on function public.admin_course_tee_publish_draft(uuid,bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
