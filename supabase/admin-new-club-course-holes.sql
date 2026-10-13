-- Private grids only. Apply once AFTER admin-new-club-courses.sql and the
-- existing live hole-grid migrations. No live writes, backfill or publication.
begin;

alter table public.admin_catalog_drafts drop constraint admin_catalog_drafts_entity_type_check;
alter table public.admin_catalog_drafts add constraint admin_catalog_drafts_entity_type_check
  check(entity_type in ('club','course','route','route_combination','hole','combination_hole',
    'route_tee','combination_tee','combination_holes_grid','route_holes_grid','new_course_holes_grid'));
-- Deliberately do NOT extend published-version types: this grid has no publisher.
create unique index admin_new_course_holes_open_idx on public.admin_catalog_drafts(parent_draft_id)
  where entity_type='new_course_holes_grid' and workflow_status='draft';

create function public.admin_new_course_holes_parent(p_course_draft_id uuid,p_lock boolean default false)
returns public.admin_catalog_drafts language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; course public.admin_catalog_drafts; root_id uuid;
begin
  actor := public.admin_catalog_require_admin();
  select d.* into course from public.admin_catalog_drafts d where d.draft_id=p_course_draft_id;
  if course.draft_id is null or course.entity_type<>'route' or course.created_by is distinct from actor
    or course.live_entity_id is not null or course.parent_draft_id is null
    or course.base_snapshot is not null or course.base_version_id is not null
    or course.base_live_updated_at is not null or course.schema_version<>1 then
    raise exception 'Owned private Percorso required' using errcode='42501';
  end if;
  root_id := course.parent_draft_id;
  perform public.admin_new_club_course_parent(root_id,p_lock);
  if p_lock then
    select d.* into course from public.admin_catalog_drafts d where d.draft_id=p_course_draft_id for update nowait;
  end if;
  if course.workflow_status<>'draft' or course.parent_draft_id is distinct from root_id then
    raise exception 'Private Percorso closed or changed' using errcode='40001';
  end if;
  perform public.admin_new_club_course_snapshot(course.snapshot);
  return course;
end;
$$;

create function public.admin_new_course_holes_snapshot(p_snapshot jsonb,p_count integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare h jsonb; position integer:=0; par_value numeric; si_value numeric; items jsonb:='[]';
begin
  if p_count is null or p_count not in (9,18) or p_snapshot is null
    or jsonb_typeof(p_snapshot) is distinct from 'object'
    or not(p_snapshot ?& array['holes_count','holes'])
    or (p_snapshot-array['holes_count','holes'])<>'{}'::jsonb
    or jsonb_typeof(p_snapshot->'holes_count') is distinct from 'number'
    or (p_snapshot->>'holes_count')::numeric<>p_count
    or jsonb_typeof(p_snapshot->'holes') is distinct from 'array' then
    raise exception 'Invalid private hole grid snapshot' using errcode='22023';
  end if;
  if jsonb_array_length(p_snapshot->'holes')<>p_count then
    raise exception 'The complete 9/18 grid is required' using errcode='22023';
  end if;
  for h in select value from jsonb_array_elements(p_snapshot->'holes') loop
    position:=position+1;
    if jsonb_typeof(h) is distinct from 'object'
      or not(h ?& array['physical_hole_number','par','stroke_index'])
      or (h-array['physical_hole_number','par','stroke_index'])<>'{}'::jsonb
      or jsonb_typeof(h->'physical_hole_number') is distinct from 'number'
      or (h->>'physical_hole_number')::numeric<>position
      or jsonb_typeof(h->'par') not in ('number','null')
      or jsonb_typeof(h->'stroke_index') not in ('number','null') then
      raise exception 'Private hole number/order is immutable; only Par/SI are editable' using errcode='22023';
    end if;
    par_value:=(h->>'par')::numeric; si_value:=(h->>'stroke_index')::numeric;
    if (par_value is not null and par_value not in (3,4,5))
      or (si_value is not null and (si_value<>trunc(si_value) or si_value not between 1 and p_count)) then
      raise exception 'Par must be 3/4/5 and SI within 1..hole count' using errcode='22023';
    end if;
    items:=items||jsonb_build_array(jsonb_build_object('physical_hole_number',position,
      'par',par_value::integer,'stroke_index',si_value::integer));
  end loop;
  return jsonb_build_object('holes_count',p_count,'holes',items);
end;
$$;

create function public.admin_new_course_holes_complete(p_snapshot jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
  select count(*)=(p_snapshot->>'holes_count')::integer
    and count(distinct h->>'stroke_index')=count(*)
    and coalesce(bool_and(h->'par'<>'null'::jsonb and h->'stroke_index'<>'null'::jsonb),false)
  from jsonb_array_elements(p_snapshot->'holes') h;
$$;

create function public.admin_new_course_holes_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; course public.admin_catalog_drafts;
begin
  if (tg_op='UPDATE' and old.entity_type='new_course_holes_grid') or new.entity_type='new_course_holes_grid' then
    actor:=public.admin_catalog_require_admin();
    course:=public.admin_new_course_holes_parent(case when tg_op='UPDATE' then old.parent_draft_id else new.parent_draft_id end,true);
    if new.created_by is distinct from actor or new.updated_by is distinct from actor then
      raise exception 'Private hole grid belongs to another Admin' using errcode='42501';
    end if;
    if new.entity_type<>'new_course_holes_grid' or new.live_entity_id is not null
      or new.base_snapshot is not null or new.base_live_updated_at is not null or new.base_version_id is not null
      or new.schema_version<>1 or new.workflow_status not in ('draft','archived') then
      raise exception 'Private hole grid cannot reference or publish live data' using errcode='22023';
    end if;
    if tg_op='UPDATE' then
      if row(new.draft_id,new.entity_type,new.entity_key,new.live_entity_id,new.parent_draft_id,new.base_version_id,
        new.base_snapshot,new.base_live_updated_at,new.created_by,new.created_at)
        is distinct from row(old.draft_id,old.entity_type,old.entity_key,old.live_entity_id,old.parent_draft_id,old.base_version_id,
        old.base_snapshot,old.base_live_updated_at,old.created_by,old.created_at) then
        raise exception 'Private grid identity is immutable' using errcode='22023';
      end if;
      if old.workflow_status<>'draft' or new.revision<>old.revision+1 then
        raise exception 'Private grid closed or revision changed' using errcode='40001';
      end if;
    end if;
    new.snapshot:=public.admin_new_course_holes_snapshot(new.snapshot,(course.snapshot->>'holes_count')::integer);
  elsif tg_op='UPDATE' and old.entity_type='route' and old.live_entity_id is null
    and old.parent_draft_id is not null and old.snapshot->'holes_count' is distinct from new.snapshot->'holes_count'
    and exists(select 1 from public.admin_catalog_drafts d where d.parent_draft_id=old.draft_id
      and d.entity_type='new_course_holes_grid' and d.workflow_status='draft') then
    raise exception 'Abandon the private hole grid before changing 9/18 structure' using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger admin_new_course_holes_guard before insert or update on public.admin_catalog_drafts
  for each row execute function public.admin_new_course_holes_guard();

create function public.admin_new_course_holes_summaries(p_club_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; d public.admin_catalog_drafts; course public.admin_catalog_drafts; normalized jsonb; result jsonb:='[]';
begin
  actor:=public.admin_catalog_require_admin();
  perform public.admin_new_club_course_parent(p_club_draft_id);
  for d in select g.* from public.admin_catalog_drafts g join public.admin_catalog_drafts c on c.draft_id=g.parent_draft_id
    where g.entity_type='new_course_holes_grid' and g.workflow_status='draft' and g.created_by=actor
      and c.parent_draft_id=p_club_draft_id and c.workflow_status='draft' and c.created_by=actor
  loop
    course:=public.admin_new_course_holes_parent(d.parent_draft_id);
    normalized:=public.admin_new_course_holes_snapshot(d.snapshot,(course.snapshot->>'holes_count')::integer);
    result:=result||jsonb_build_array(jsonb_build_object('course_draft_id',course.draft_id,'grid_draft_id',d.draft_id,
      'configured',public.admin_new_course_holes_complete(normalized),
      'total_par',(select sum((h->>'par')::integer) from jsonb_array_elements(normalized->'holes') h)));
  end loop;
  return result;
end;
$$;

create function public.admin_new_course_holes_open(p_course_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; course public.admin_catalog_drafts; grid public.admin_catalog_drafts; initial jsonb;
begin
  actor:=public.admin_catalog_require_admin(); course:=public.admin_new_course_holes_parent(p_course_draft_id,true);
  select d.* into grid from public.admin_catalog_drafts d where d.parent_draft_id=course.draft_id
    and d.entity_type='new_course_holes_grid' and d.workflow_status='draft' and d.created_by=actor for update nowait;
  if not found then
    select jsonb_build_object('holes_count',(course.snapshot->>'holes_count')::integer,'holes',jsonb_agg(
      jsonb_build_object('physical_hole_number',n,'par',null,'stroke_index',null) order by n)) into initial
      from generate_series(1,(course.snapshot->>'holes_count')::integer) n;
    insert into public.admin_catalog_drafts(entity_type,entity_key,parent_draft_id,snapshot,created_by,updated_by)
      values('new_course_holes_grid',gen_random_uuid(),course.draft_id,initial,actor,actor) returning * into grid;
  end if;
  perform public.admin_new_course_holes_snapshot(grid.snapshot,(course.snapshot->>'holes_count')::integer);
  return jsonb_build_object('course',course,'draft',grid,'configured',public.admin_new_course_holes_complete(grid.snapshot));
end;
$$;

create function public.admin_new_course_holes_save(p_draft_id uuid,p_snapshot jsonb,p_expected_revision bigint,p_course_revision bigint)
returns public.admin_catalog_drafts language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; grid public.admin_catalog_drafts; course public.admin_catalog_drafts;
begin
  actor:=public.admin_catalog_require_admin();
  select d.* into grid from public.admin_catalog_drafts d where d.draft_id=p_draft_id;
  if grid.draft_id is null or grid.entity_type<>'new_course_holes_grid' or grid.created_by is distinct from actor then
    raise exception 'Owned private hole grid required' using errcode='42501';
  end if;
  course:=public.admin_new_course_holes_parent(grid.parent_draft_id,true);
  if p_course_revision is null or course.revision<>p_course_revision then
    raise exception 'Private Percorso revision changed' using errcode='40001';
  end if;
  perform 1 from public.admin_catalog_drafts d where d.draft_id=p_draft_id for update nowait;
  return public.admin_catalog_save_draft(p_draft_id,
    public.admin_new_course_holes_snapshot(p_snapshot,(course.snapshot->>'holes_count')::integer),p_expected_revision,1);
end;
$$;

create function public.admin_new_course_holes_archive(p_draft_id uuid,p_expected_revision bigint,p_course_revision bigint)
returns public.admin_catalog_drafts language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; grid public.admin_catalog_drafts; course public.admin_catalog_drafts;
begin
  actor:=public.admin_catalog_require_admin();
  select d.* into grid from public.admin_catalog_drafts d where d.draft_id=p_draft_id;
  if grid.draft_id is null or grid.entity_type<>'new_course_holes_grid' or grid.created_by is distinct from actor then
    raise exception 'Owned private hole grid required' using errcode='42501';
  end if;
  course:=public.admin_new_course_holes_parent(grid.parent_draft_id,true);
  if p_course_revision is null or course.revision<>p_course_revision then
    raise exception 'Private Percorso revision changed' using errcode='40001';
  end if;
  if p_expected_revision is null or p_expected_revision<1 then raise exception 'Expected grid revision required' using errcode='22023'; end if;
  update public.admin_catalog_drafts d set workflow_status='archived',revision=d.revision+1,updated_by=actor,updated_at=clock_timestamp()
    where d.draft_id=p_draft_id and d.revision=p_expected_revision and d.workflow_status='draft' returning d.* into grid;
  if not found then raise exception 'Private grid changed or closed' using errcode='40001'; end if;
  return grid;
end;
$$;

revoke all on function public.admin_new_course_holes_parent(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_course_holes_snapshot(jsonb,integer) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_course_holes_complete(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_course_holes_guard() from public,anon,authenticated,service_role;
revoke all on function public.admin_new_course_holes_summaries(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_course_holes_open(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_course_holes_save(uuid,jsonb,bigint,bigint) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_course_holes_archive(uuid,bigint,bigint) from public,anon,authenticated,service_role;
grant execute on function public.admin_new_course_holes_summaries(uuid) to authenticated;
grant execute on function public.admin_new_course_holes_open(uuid) to authenticated;
grant execute on function public.admin_new_course_holes_save(uuid,jsonb,bigint,bigint) to authenticated;
grant execute on function public.admin_new_course_holes_archive(uuid,bigint,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
