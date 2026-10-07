-- Physical holes of an existing course_routes record, independent of combinations.
-- Apply manually AFTER admin-hole-grid-editor.sql. One-shot transaction.
-- No live schema/policy changes, backfill, combination writes or remote execution.
begin;

alter table public.admin_catalog_drafts drop constraint admin_catalog_drafts_entity_type_check;
alter table public.admin_catalog_drafts add constraint admin_catalog_drafts_entity_type_check
  check (entity_type in ('club','course','route','route_combination','hole','combination_hole',
    'route_tee','combination_tee','combination_holes_grid','route_holes_grid'));
alter table public.admin_catalog_versions drop constraint admin_catalog_versions_entity_type_check;
alter table public.admin_catalog_versions add constraint admin_catalog_versions_entity_type_check
  check (entity_type in ('club','course','route','route_combination','hole','combination_hole',
    'route_tee','combination_tee','combination_holes_grid','route_holes_grid'));

create unique index admin_course_hole_grid_open_owner_idx on public.admin_catalog_drafts(live_entity_id,created_by)
  where entity_type = 'route_holes_grid' and workflow_status = 'draft';

create function public.admin_course_hole_grid_context(p_course_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog
as $$
  with target as (select r.* from public.course_routes r where r.id = p_course_id),
  holes as (select h.* from public.route_holes h where h.route_id = p_course_id),
  metrics as (
    select count(*)::integer as actual_holes,
      (count(*) - count(distinct physical_hole_number))::integer as duplicate_numbers,
      count(stroke_index)::integer as si_count,count(distinct stroke_index)::integer as distinct_si,
      coalesce(bool_and(stroke_index between 1 and 18),false) as si_range_valid,
      coalesce(jsonb_agg(stroke_index order by stroke_index) filter(where stroke_index is not null),'[]'::jsonb) as live_si,
      sum(par)::integer as par_sum from holes
  )
  select jsonb_build_object(
    'base',jsonb_build_object('course',to_jsonb(t),'holes',
      coalesce((select jsonb_agg(to_jsonb(h) order by h.physical_hole_number,h.id) from holes h),'[]'::jsonb)),
    'course',jsonb_build_object('id',t.id,'name',t.name,'holes_count',t.holes_count,
      'total_par',t.total_par,'source_system',t.source_system),
    'holes',coalesce((select jsonb_agg(to_jsonb(h) order by h.physical_hole_number,h.id) from holes h),'[]'::jsonb),
    -- Actual 9-hole catalogs include 1..9, odd/even 18-hole indices, and other
    -- imported subsets. Preserve a complete valid live set as a permutation.
    -- When incomplete/duplicate, repair against 1..holes_count, never invent ranks.
    'si_sequence',case when t.holes_count = 9 and m.actual_holes = 9 and m.si_count = 9
      and m.distinct_si = 9 and m.si_range_valid then m.live_si
      else (select jsonb_agg(n order by n) from generate_series(1,t.holes_count) n) end,
    'checks',jsonb_build_object('expected_holes',t.holes_count,'actual_holes',m.actual_holes,
      'duplicate_numbers',m.duplicate_numbers,'par_sum',m.par_sum,
      'missing_numbers',coalesce((select jsonb_agg(n order by n) from generate_series(1,t.holes_count) n
        where not exists(select 1 from holes h where h.physical_hole_number = n)),'[]'::jsonb),
      'invalid_numbers',(select count(*) from holes h where h.physical_hole_number not between 1 and t.holes_count))
  ) from target t cross join metrics m;
$$;

create function public.admin_course_hole_grid_lock_target(p_course_id uuid)
returns public.course_routes language plpgsql security definer set search_path = pg_catalog
as $$
declare result public.course_routes;
begin
  -- Reserve write capacity BEFORE row locks. This prevents edits/inserts/deletes
  -- during base checking, publication and version creation, including phantoms.
  lock table public.route_holes in share row exclusive mode;
  select r.* into result from public.course_routes r where r.id = p_course_id for update nowait;
  if not found then raise exception 'Existing course required' using errcode = '22023'; end if;
  perform c.id from public.clubs c where c.id = result.club_id and c.is_active for share nowait;
  if not found then raise exception 'Active Club required' using errcode = '22023'; end if;
  return result;
end;
$$;

create function public.admin_course_hole_grid_validate_snapshot(p_snapshot jsonb,p_base jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare h jsonb; expected jsonb; items jsonb := '[]'::jsonb;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or not (p_snapshot ? 'holes') or (p_snapshot - 'holes') <> '{}'::jsonb
    or jsonb_typeof(p_snapshot -> 'holes') is distinct from 'array'
    or p_base is null or jsonb_typeof(p_base -> 'holes') is distinct from 'array' then
    raise exception 'Invalid physical hole grid snapshot' using errcode = '22023';
  end if;
  if jsonb_array_length(p_snapshot -> 'holes') <> jsonb_array_length(p_base -> 'holes')
    or jsonb_array_length(p_snapshot -> 'holes') > 18 then
    raise exception 'Cannot add or remove physical holes' using errcode = '22023';
  end if;
  for h in select value from jsonb_array_elements(p_snapshot -> 'holes') loop
    if jsonb_typeof(h) is distinct from 'object'
      or not (h ?& array['id','physical_hole_number','par','stroke_index'])
      or (h - array['id','physical_hole_number','par','stroke_index']) <> '{}'::jsonb
      or jsonb_typeof(h -> 'id') is distinct from 'string'
      or jsonb_typeof(h -> 'physical_hole_number') is distinct from 'number'
      or (h ->> 'physical_hole_number') !~ '^[0-9]+$'
      or jsonb_typeof(h -> 'par') not in ('number','null')
      or jsonb_typeof(h -> 'stroke_index') not in ('number','null') then
      raise exception 'Only existing physical hole identity, Par and SI are allowed' using errcode = '22023';
    end if;
    if (h -> 'par' <> 'null'::jsonb and (h ->> 'par') !~ '^[3-6]$')
      or (h -> 'stroke_index' <> 'null'::jsonb and ((h ->> 'stroke_index') !~ '^[0-9]{1,2}$'
        or (h ->> 'stroke_index')::integer not between 1 and 18)) then
      raise exception 'Invalid Par or SI' using errcode = '22023';
    end if;
    select value into expected from jsonb_array_elements(p_base -> 'holes') where value -> 'id' = h -> 'id';
    if not found or expected -> 'physical_hole_number' is distinct from h -> 'physical_hole_number'
      or exists(select 1 from jsonb_array_elements(items) x where x.value -> 'id' = h -> 'id') then
      raise exception 'Physical hole identity and order cannot change' using errcode = '22023';
    end if;
    items := items || jsonb_build_array(h);
  end loop;
  return jsonb_build_object('holes',coalesce((select jsonb_agg(value
    order by (value ->> 'physical_hole_number')::integer,value ->> 'id') from jsonb_array_elements(items)),'[]'::jsonb));
end;
$$;

create function public.admin_course_hole_grid_guard_draft()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid;
begin
  if old.entity_type = 'route_holes_grid' then
    actor := public.admin_catalog_require_admin();
    if old.created_by <> actor or new.updated_by <> actor then
      raise exception 'Physical hole draft belongs to another Admin' using errcode = '42501';
    end if;
    if row(new.draft_id,new.entity_type,new.entity_key,new.live_entity_id,new.parent_draft_id,
      new.base_version_id,new.base_snapshot,new.base_live_updated_at,new.created_by,new.created_at)
      is distinct from row(old.draft_id,old.entity_type,old.entity_key,old.live_entity_id,old.parent_draft_id,
      old.base_version_id,old.base_snapshot,old.base_live_updated_at,old.created_by,old.created_at) then
      raise exception 'Physical hole draft identity and base are immutable' using errcode = '22023';
    end if;
    if old.workflow_status <> 'draft' or new.schema_version <> 1 or new.revision <> old.revision + 1 then
      raise exception 'Physical hole draft closed or revision invalid' using errcode = '40001';
    end if;
    new.snapshot := public.admin_course_hole_grid_validate_snapshot(new.snapshot,old.base_snapshot);
  end if;
  return new;
end;
$$;
create trigger admin_course_hole_grid_guard_draft before update on public.admin_catalog_drafts
  for each row execute function public.admin_course_hole_grid_guard_draft();

create function public.admin_course_hole_grid_get_draft(p_course_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; draft public.admin_catalog_drafts; context jsonb;
begin
  actor := public.admin_catalog_require_admin();
  context := public.admin_course_hole_grid_context(p_course_id);
  if context is null then raise exception 'Existing course required' using errcode = '22023'; end if;
  select d.* into draft from public.admin_catalog_drafts d where d.entity_type = 'route_holes_grid'
    and d.live_entity_id = p_course_id and d.created_by = actor and d.workflow_status = 'draft';
  return jsonb_build_object('draft',case when draft.draft_id is null then null else to_jsonb(draft) end,'context',context);
end;
$$;

create function public.admin_course_hole_grid_open_draft(p_course_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; live public.course_routes; draft public.admin_catalog_drafts;
  context jsonb; snapshot jsonb; latest public.admin_catalog_versions;
begin
  actor := public.admin_catalog_require_admin();
  live := public.admin_course_hole_grid_lock_target(p_course_id);
  context := public.admin_course_hole_grid_context(live.id);
  if (context #>> '{checks,actual_holes}')::integer = 0 then
    raise exception 'Existing physical holes required' using errcode = '22023';
  end if;
  select d.* into draft from public.admin_catalog_drafts d where d.entity_type = 'route_holes_grid'
    and d.live_entity_id = live.id and d.created_by = actor and d.workflow_status = 'draft';
  if not found then
    snapshot := jsonb_build_object('holes',(select jsonb_agg(jsonb_build_object(
      'id',h -> 'id','physical_hole_number',h -> 'physical_hole_number','par',h -> 'par','stroke_index',h -> 'stroke_index')
      order by (h ->> 'physical_hole_number')::integer,h ->> 'id') from jsonb_array_elements(context -> 'holes') h));
    select v.* into latest from public.admin_catalog_versions v where v.entity_type = 'route_holes_grid'
      and v.live_entity_id = live.id order by v.version_number desc limit 1;
    insert into public.admin_catalog_drafts(entity_type,entity_key,live_entity_id,base_version_id,
      snapshot,base_snapshot,base_live_updated_at,created_by,updated_by)
      values('route_holes_grid',coalesce(latest.entity_key,live.id),live.id,latest.version_id,
        snapshot,snapshot || jsonb_build_object('_context',context -> 'base','_si_sequence',context -> 'si_sequence'),
        live.updated_at,actor,actor) returning * into draft;
  end if;
  -- A resumed draft keeps its original SI convention even after external changes.
  return jsonb_build_object('draft',to_jsonb(draft),'context',context || jsonb_build_object('si_sequence',draft.base_snapshot -> '_si_sequence'));
end;
$$;

create function public.admin_course_hole_grid_save_draft(p_draft_id uuid,p_snapshot jsonb,p_expected_revision bigint)
returns public.admin_catalog_drafts language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; draft public.admin_catalog_drafts;
begin
  actor := public.admin_catalog_require_admin();
  select d.* into draft from public.admin_catalog_drafts d where d.draft_id = p_draft_id
    and d.entity_type = 'route_holes_grid' and d.created_by = actor and d.base_snapshot is not null;
  if not found then raise exception 'Owned physical hole grid draft required' using errcode = '42501'; end if;
  return public.admin_catalog_save_draft(p_draft_id,
    public.admin_course_hole_grid_validate_snapshot(p_snapshot,draft.base_snapshot),p_expected_revision,1);
end;
$$;

create function public.admin_course_hole_grid_archive_draft(p_draft_id uuid,p_expected_revision bigint)
returns public.admin_catalog_drafts language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; result public.admin_catalog_drafts;
begin
  actor := public.admin_catalog_require_admin();
  update public.admin_catalog_drafts d set workflow_status = 'archived',revision = d.revision + 1,
    updated_by = actor,updated_at = clock_timestamp()
    where d.draft_id = p_draft_id and d.entity_type = 'route_holes_grid' and d.created_by = actor
      and d.workflow_status = 'draft' and d.revision = p_expected_revision returning d.* into result;
  if not found then raise exception 'Owned open physical hole grid draft changed or missing' using errcode = '40001'; end if;
  return result;
end;
$$;

create function public.admin_course_hole_grid_publish_draft(p_draft_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; draft public.admin_catalog_drafts; live public.course_routes;
  context jsonb; requested jsonb; changes jsonb; version public.admin_catalog_versions;
  latest_id uuid; next_number bigint; updated_count integer; sum_par integer; requested_si jsonb;
begin
  actor := public.admin_catalog_require_admin();
  select d.* into draft from public.admin_catalog_drafts d where d.draft_id = p_draft_id
    and d.entity_type = 'route_holes_grid' and d.created_by = actor and d.base_snapshot is not null;
  if not found then raise exception 'Owned physical hole grid draft required' using errcode = '42501'; end if;
  live := public.admin_course_hole_grid_lock_target(draft.live_entity_id);
  select d.* into draft from public.admin_catalog_drafts d where d.draft_id = p_draft_id for update;
  if draft.entity_type <> 'route_holes_grid' or draft.created_by <> actor or draft.updated_by <> actor
    or draft.live_entity_id <> live.id or draft.schema_version <> 1 or draft.base_snapshot is null
    or draft.parent_draft_id is not null then
    raise exception 'Invalid owned physical hole grid draft' using errcode = '22023';
  end if;
  if draft.workflow_status <> 'draft' or p_expected_revision is null or draft.revision <> p_expected_revision then
    raise exception 'Physical hole grid draft closed or changed since confirmation' using errcode = '40001';
  end if;
  requested := public.admin_course_hole_grid_validate_snapshot(draft.snapshot,draft.base_snapshot);
  context := public.admin_course_hole_grid_context(live.id);
  select v.version_id into latest_id from public.admin_catalog_versions v
    where v.entity_type = 'route_holes_grid' and v.live_entity_id = live.id order by v.version_number desc limit 1;
  if live.updated_at is distinct from draft.base_live_updated_at
    or context -> 'base' is distinct from draft.base_snapshot -> '_context'
    or latest_id is distinct from draft.base_version_id then
    raise exception 'Course or physical holes changed since base' using errcode = '40001';
  end if;
  if live.holes_count not in (9,18) or (context #>> '{checks,actual_holes}')::integer <> live.holes_count
    or jsonb_array_length(context #> '{checks,missing_numbers}') <> 0
    or (context #>> '{checks,duplicate_numbers}')::integer <> 0
    or (context #>> '{checks,invalid_numbers}')::integer <> 0 then
    raise exception 'Physical hole count or order inconsistent' using errcode = '23514';
  end if;
  select jsonb_agg((h ->> 'stroke_index')::integer order by (h ->> 'stroke_index')::integer),
    sum((h ->> 'par')::integer) into requested_si,sum_par from jsonb_array_elements(requested -> 'holes') h;
  if exists(select 1 from jsonb_array_elements(requested -> 'holes') h
      where h -> 'par' = 'null'::jsonb or h -> 'stroke_index' = 'null'::jsonb)
    or requested_si is distinct from draft.base_snapshot -> '_si_sequence' then
    raise exception 'Par/SI required; SI must match the captured complete course sequence without duplicates' using errcode = '23514';
  end if;
  if live.total_par is not null and sum_par <> live.total_par then
    raise exception 'Hole Par must match existing course total' using errcode = '23514';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',n -> 'id','physical_hole_number',n -> 'physical_hole_number',
    'changes',(case when n -> 'par' is distinct from b -> 'par' then
      jsonb_build_object('par',jsonb_build_object('before',b -> 'par','after',n -> 'par')) else '{}'::jsonb end) ||
      (case when n -> 'stroke_index' is distinct from b -> 'stroke_index' then
      jsonb_build_object('stroke_index',jsonb_build_object('before',b -> 'stroke_index','after',n -> 'stroke_index')) else '{}'::jsonb end)
    ) order by (n ->> 'physical_hole_number')::integer),'[]'::jsonb) into changes
    from jsonb_array_elements(requested -> 'holes') n
    join jsonb_array_elements(draft.base_snapshot -> 'holes') b on b -> 'id' = n -> 'id'
    where n -> 'par' is distinct from b -> 'par' or n -> 'stroke_index' is distinct from b -> 'stroke_index';
  if changes = '[]'::jsonb then raise exception 'No physical hole changes to publish' using errcode = '22023'; end if;
  update public.route_holes h set par = x.par,stroke_index = x.stroke_index
    from jsonb_to_recordset(requested -> 'holes') as x(id uuid,physical_hole_number integer,par integer,stroke_index integer)
    where h.id = x.id and h.route_id = live.id and h.physical_hole_number = x.physical_hole_number;
  get diagnostics updated_count = row_count;
  if updated_count <> live.holes_count then raise exception 'Physical hole set changed' using errcode = '40001'; end if;
  select coalesce(max(v.version_number),0) + 1 into next_number from public.admin_catalog_versions v
    where v.entity_type = 'route_holes_grid' and v.entity_key = draft.entity_key;
  insert into public.admin_catalog_versions(entity_type,entity_key,live_entity_id,source_draft_id,
    version_number,schema_version,snapshot,diff,published_by,published_at)
    values('route_holes_grid',draft.entity_key,live.id,draft.draft_id,next_number,1,requested,
      jsonb_build_object('holes',changes),actor,clock_timestamp()) returning * into version;
  update public.admin_catalog_drafts set workflow_status = 'published',revision = revision + 1,
    updated_by = actor,updated_at = clock_timestamp() where draft_id = draft.draft_id;
  return jsonb_build_object('version_id',version.version_id,'version_number',version.version_number,
    'diff',version.diff,'course_id',live.id,'context',public.admin_course_hole_grid_context(live.id));
end;
$$;

revoke all on function public.admin_course_hole_grid_context(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_hole_grid_lock_target(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_hole_grid_validate_snapshot(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_hole_grid_guard_draft() from public,anon,authenticated,service_role;
revoke all on function public.admin_course_hole_grid_get_draft(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_hole_grid_open_draft(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_hole_grid_save_draft(uuid,jsonb,bigint) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_hole_grid_archive_draft(uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_hole_grid_publish_draft(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.admin_course_hole_grid_get_draft(uuid) to authenticated;
grant execute on function public.admin_course_hole_grid_open_draft(uuid) to authenticated;
grant execute on function public.admin_course_hole_grid_save_draft(uuid,jsonb,bigint) to authenticated;
grant execute on function public.admin_course_hole_grid_archive_draft(uuid,bigint) to authenticated;
grant execute on function public.admin_course_hole_grid_publish_draft(uuid,bigint) to authenticated;

notify pgrst,'reload schema';
commit;
