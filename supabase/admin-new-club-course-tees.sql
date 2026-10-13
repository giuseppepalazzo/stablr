-- Private new Club tee drafts only. Apply once AFTER admin-new-club-course-holes.sql.
-- No live writes, published versions, backfill, distances or player integration.
begin;
alter table public.admin_catalog_drafts drop constraint admin_catalog_drafts_entity_type_check;
alter table public.admin_catalog_drafts add constraint admin_catalog_drafts_entity_type_check
  check(entity_type in ('club','course','route','route_combination','hole','combination_hole',
    'route_tee','combination_tee','combination_holes_grid','route_holes_grid','new_course_holes_grid','new_course_tee'));

create unique index admin_new_course_tee_identity_idx on public.admin_catalog_drafts
  (parent_draft_id,lower(btrim(snapshot->>'name')), (snapshot->>'rating_category'))
  where entity_type='new_course_tee' and workflow_status='draft';

create function public.admin_new_course_tee_snapshot(p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare display_name text; color text; ordering numeric; cr numeric; slope numeric;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or not(p_snapshot ?& array['name','tee_color','rating_category','course_rating','slope_rating','is_active','display_order'])
    or (p_snapshot-array['name','tee_color','rating_category','course_rating','slope_rating','is_active','display_order'])<>'{}'::jsonb
    or jsonb_typeof(p_snapshot->'name') is distinct from 'string'
    or jsonb_typeof(p_snapshot->'tee_color') not in ('string','null')
    or jsonb_typeof(p_snapshot->'rating_category') is distinct from 'string'
    or jsonb_typeof(p_snapshot->'course_rating') not in ('number','null')
    or jsonb_typeof(p_snapshot->'slope_rating') not in ('number','null')
    or jsonb_typeof(p_snapshot->'is_active') is distinct from 'boolean'
    or jsonb_typeof(p_snapshot->'display_order') is distinct from 'number' then
    raise exception 'Invalid private tee fields' using errcode='22023';
  end if;
  display_name:=btrim(p_snapshot->>'name'); color:=nullif(btrim(p_snapshot->>'tee_color'),'');
  ordering:=(p_snapshot->>'display_order')::numeric;
  cr:=(p_snapshot->>'course_rating')::numeric; slope:=(p_snapshot->>'slope_rating')::numeric;
  if display_name='' or char_length(display_name)>200 or char_length(color)>100
    or p_snapshot->>'rating_category' not in ('men','women','unspecified')
    or ordering<>trunc(ordering) or ordering not between -2147483648 and 2147483647
    or (cr is not null and cr::text in ('NaN','Infinity','-Infinity'))
    or (slope is not null and (slope<>trunc(slope) or slope not between 55 and 155)) then
    raise exception 'Name, category, numeric CR, integer Slope 55..155 and order required' using errcode='22023';
  end if;
  return jsonb_build_object('name',display_name,'tee_color',color,'rating_category',p_snapshot->>'rating_category',
    'course_rating',cr,'slope_rating',slope::integer,'is_active',(p_snapshot->>'is_active')::boolean,'display_order',ordering::integer);
end;
$$;

-- Read context never creates a hole grid; mutators lock Club -> Course -> Grid.
create function public.admin_new_course_tee_context(p_course_draft_id uuid,p_lock boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare course public.admin_catalog_drafts; grid public.admin_catalog_drafts; normalized jsonb; complete boolean:=false; total integer;
begin
  course:=public.admin_new_course_holes_parent(p_course_draft_id,p_lock);
  if p_lock then
    select d.* into grid from public.admin_catalog_drafts d where d.parent_draft_id=course.draft_id
      and d.entity_type='new_course_holes_grid' and d.workflow_status='draft' for update nowait;
  else
    select d.* into grid from public.admin_catalog_drafts d where d.parent_draft_id=course.draft_id
      and d.entity_type='new_course_holes_grid' and d.workflow_status='draft';
  end if;
  if grid.draft_id is not null then
    if grid.created_by is distinct from course.created_by then raise exception 'Private grid owner mismatch' using errcode='42501'; end if;
    normalized:=public.admin_new_course_holes_snapshot(grid.snapshot,(course.snapshot->>'holes_count')::integer);
    complete:=public.admin_new_course_holes_complete(normalized);
    if complete then select sum((h->>'par')::integer) into total from jsonb_array_elements(normalized->'holes') h; end if;
  end if;
  return jsonb_build_object('course_draft_id',course.draft_id,'course_name',course.snapshot->>'name','course_revision',course.revision,
    'holes_count',(course.snapshot->>'holes_count')::integer,'grid_draft_id',grid.draft_id,'grid_revision',grid.revision,
    'configured',complete,'par_total',total);
end;
$$;

create function public.admin_new_course_tee_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; context jsonb;
begin
  if new.entity_type='new_course_tee' or (tg_op='UPDATE' and old.entity_type='new_course_tee') then
    actor:=public.admin_catalog_require_admin();
    context:=public.admin_new_course_tee_context(case when tg_op='UPDATE' then old.parent_draft_id else new.parent_draft_id end,true);
    if new.created_by is distinct from actor or new.updated_by is distinct from actor then
      raise exception 'Private tee belongs to another Admin' using errcode='42501';
    end if;
    if new.entity_type<>'new_course_tee' or new.live_entity_id is not null or new.base_snapshot is not null
      or new.base_version_id is not null or new.base_live_updated_at is not null or new.schema_version<>1
      or new.workflow_status not in ('draft','archived') then
      raise exception 'Private tee cannot reference or publish live data' using errcode='22023';
    end if;
    if tg_op='UPDATE' then
      if row(new.draft_id,new.entity_type,new.entity_key,new.parent_draft_id,new.created_by,new.created_at)
        is distinct from row(old.draft_id,old.entity_type,old.entity_key,old.parent_draft_id,old.created_by,old.created_at) then
        raise exception 'Private tee identity is immutable' using errcode='22023';
      end if;
      if old.workflow_status<>'draft' or new.revision<>old.revision+1 then raise exception 'Private tee changed or closed' using errcode='40001'; end if;
      if new.workflow_status='archived' and new.snapshot is distinct from old.snapshot then raise exception 'Archival preserves tee data' using errcode='22023'; end if;
    end if;
    if new.workflow_status='draft' and (context->>'configured')::boolean is distinct from true then
      raise exception 'Complete valid private hole grid required' using errcode='22023';
    end if;
    new.snapshot:=public.admin_new_course_tee_snapshot(new.snapshot);
  elsif tg_op='UPDATE' and old.entity_type='route' and old.live_entity_id is null
    and old.snapshot->'holes_count' is distinct from new.snapshot->'holes_count'
    and exists(select 1 from public.admin_catalog_drafts d where d.parent_draft_id=old.draft_id
      and d.entity_type='new_course_tee' and d.workflow_status='draft') then
    raise exception 'Abandon private tees before changing 9/18 scope' using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger admin_new_course_tee_guard before insert or update on public.admin_catalog_drafts
  for each row execute function public.admin_new_course_tee_guard();

create function public.admin_new_course_tees(p_course_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; context jsonb; items jsonb;
begin
  actor:=public.admin_catalog_require_admin();context:=public.admin_new_course_tee_context(p_course_draft_id);
  select coalesce(jsonb_agg(jsonb_build_object('draft_id',d.draft_id,'entity_type',d.entity_type,'parent_draft_id',d.parent_draft_id,
    'live_entity_id',d.live_entity_id,'schema_version',d.schema_version,'workflow_status',d.workflow_status,
    'revision',d.revision,'created_by',d.created_by,'created_at',d.created_at,'updated_at',d.updated_at,
    'snapshot',public.admin_new_course_tee_snapshot(d.snapshot)) order by (d.snapshot->>'display_order')::integer,d.created_at,d.draft_id),'[]'::jsonb)
    into items from public.admin_catalog_drafts d where d.parent_draft_id=p_course_draft_id
      and d.entity_type='new_course_tee' and d.workflow_status='draft' and d.created_by=actor;
  return jsonb_build_object('context',context,'tees',items);
end;
$$;

create function public.admin_new_course_tee_save(p_course_draft_id uuid,p_snapshot jsonb,p_course_revision bigint,
  p_grid_draft_id uuid,p_grid_revision bigint,p_draft_id uuid default null,p_expected_revision bigint default null)
returns public.admin_catalog_drafts language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; context jsonb; normalized jsonb; result public.admin_catalog_drafts;
begin
  actor:=public.admin_catalog_require_admin();context:=public.admin_new_course_tee_context(p_course_draft_id,true);
  if (context->>'configured')::boolean is distinct from true then raise exception 'Complete valid private hole grid required' using errcode='22023'; end if;
  if p_course_revision is null or p_grid_draft_id is null or p_grid_revision is null
    or (context->>'course_revision')::bigint<>p_course_revision or (context->>'grid_draft_id')::uuid is distinct from p_grid_draft_id
    or (context->>'grid_revision')::bigint<>p_grid_revision then raise exception 'Private course/grid changed' using errcode='40001'; end if;
  normalized:=public.admin_new_course_tee_snapshot(p_snapshot);
  if p_draft_id is null then
    if p_expected_revision is not null then raise exception 'New tee has no revision' using errcode='22023'; end if;
    insert into public.admin_catalog_drafts(entity_type,entity_key,parent_draft_id,snapshot,created_by,updated_by)
      values('new_course_tee',gen_random_uuid(),p_course_draft_id,normalized,actor,actor) returning * into result;
  else
    select d.* into result from public.admin_catalog_drafts d where d.draft_id=p_draft_id for update nowait;
    if result.draft_id is null or result.entity_type<>'new_course_tee' or result.parent_draft_id is distinct from p_course_draft_id
      or result.created_by is distinct from actor then raise exception 'Owned private tee required' using errcode='42501'; end if;
    if p_expected_revision is null or result.workflow_status<>'draft' or result.revision<>p_expected_revision then
      raise exception 'Private tee changed or closed' using errcode='40001'; end if;
    update public.admin_catalog_drafts set snapshot=normalized,revision=revision+1,updated_by=actor,updated_at=clock_timestamp()
      where draft_id=p_draft_id returning * into result;
  end if;
  return result;
end;
$$;

create function public.admin_new_course_tee_archive(p_course_draft_id uuid,p_draft_id uuid,p_expected_revision bigint)
returns public.admin_catalog_drafts language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; result public.admin_catalog_drafts;
begin
  actor:=public.admin_catalog_require_admin();perform public.admin_new_course_tee_context(p_course_draft_id,true);
  select d.* into result from public.admin_catalog_drafts d where d.draft_id=p_draft_id for update nowait;
  if result.draft_id is null or result.entity_type<>'new_course_tee' or result.parent_draft_id is distinct from p_course_draft_id
    or result.created_by is distinct from actor then raise exception 'Owned private tee required' using errcode='42501'; end if;
  if p_expected_revision is null or result.workflow_status<>'draft' or result.revision<>p_expected_revision then
    raise exception 'Private tee changed or closed' using errcode='40001'; end if;
  update public.admin_catalog_drafts set workflow_status='archived',revision=revision+1,updated_by=actor,updated_at=clock_timestamp()
    where draft_id=p_draft_id returning * into result;
  return result;
end;
$$;

revoke all on function public.admin_new_course_tee_snapshot(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_course_tee_context(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_course_tee_guard() from public,anon,authenticated,service_role;
revoke all on function public.admin_new_course_tees(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_course_tee_save(uuid,jsonb,bigint,uuid,bigint,uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_course_tee_archive(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.admin_new_course_tees(uuid) to authenticated;
grant execute on function public.admin_new_course_tee_save(uuid,jsonb,bigint,uuid,bigint,uuid,bigint) to authenticated;
grant execute on function public.admin_new_course_tee_archive(uuid,uuid,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
