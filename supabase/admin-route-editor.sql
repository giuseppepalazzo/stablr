-- Existing Route/combinazione = route_combinations, workflow route_combination.
-- Apply manually after admin-catalog-workflow.sql, admin-club-editor.sql,
-- admin-course-editor.sql and admin-catalog-abandon-draft.sql. One-shot.
-- No live columns/policies/backfill; explicit name/is_active publication only.
begin;

create unique index admin_route_open_draft_owner_idx
  on public.admin_catalog_drafts(live_entity_id, created_by)
  where entity_type = 'route_combination' and workflow_status = 'draft' and base_snapshot is not null;

create function public.admin_route_validate_snapshot(p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare display_name text;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or not (p_snapshot ?& array['name', 'is_active'])
    or (p_snapshot - array['name', 'is_active']) <> '{}'::jsonb
    or jsonb_typeof(p_snapshot -> 'name') is distinct from 'string'
    or jsonb_typeof(p_snapshot -> 'is_active') is distinct from 'boolean' then
    raise exception 'Only Route name and active state are allowed' using errcode = '22023';
  end if;
  display_name := btrim(p_snapshot ->> 'name');
  if display_name = '' or char_length(display_name) > 200 then
    raise exception 'Invalid Route name length' using errcode = '22023';
  end if;
  return jsonb_build_object('name', display_name, 'is_active', (p_snapshot ->> 'is_active')::boolean);
end;
$$;

-- One SQL statement captures technical fields, origins, ordered sequence and
-- source holes from the same read snapshot. Publication locks their writers.
create function public.admin_route_context(p_route_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog
as $$
  with target as (
    select c.*, to_jsonb(c) - array['name','is_active','created_at','updated_at'] as technical,
      to_jsonb(f) as front, to_jsonb(b) as back
    from public.route_combinations c
    left join public.course_routes f on f.id = c.front_route_id
    left join public.course_routes b on b.id = c.back_route_id
    where c.id = p_route_id
  ), holes as (
    select h.* from public.route_combination_holes h where h.route_combination_id = p_route_id
  ), metrics as (
    select count(*)::integer as actual_holes,
      (count(*) - count(distinct round_hole_number))::integer as duplicate_round_numbers,
      (count(*) - count(distinct (route_id, physical_hole_number)))::integer as duplicate_physical_holes,
      count(*) filter (where route_position = 1)::integer as front_holes,
      count(*) filter (where route_position = 2)::integer as back_holes,
      sum(par)::integer as par_sum
    from holes
  ), checks as (
    select t.*, m.*,
      array(select n from generate_series(1, 18) as n
        where not exists (select 1 from holes h where h.round_hole_number = n)) as missing_round_numbers,
      (select count(*)::integer from holes h where
        h.route_position is distinct from (case when h.round_hole_number between 1 and 9 then 1 else 2 end)
        or h.route_id is distinct from (case when h.route_position = 1 then t.front_route_id else t.back_route_id end)
        or h.physical_hole_number not between 1 and
          (case when h.route_position = 1 then (t.front ->> 'holes_count')::integer else (t.back ->> 'holes_count')::integer end)
        or not exists (select 1 from public.route_holes s
          where s.route_id = h.route_id and s.physical_hole_number = h.physical_hole_number)
      ) as invalid_origin_holes,
      coalesce((t.front ->> 'is_active')::boolean and (t.back ->> 'is_active')::boolean, false) as origins_active,
      coalesce(t.front is not null and t.back is not null and t.front_route_id <> t.back_route_id
        and (t.front ->> 'club_id')::uuid = t.club_id and (t.back ->> 'club_id')::uuid = t.club_id
        and (t.front ->> 'holes_count')::integer in (9,18)
        and (t.back ->> 'holes_count')::integer in (9,18), false) as origins_valid
    from target t cross join metrics m
  )
  select jsonb_build_object(
    'base', jsonb_build_object('technical', technical, 'front', front, 'back', back,
      'holes', coalesce((select jsonb_agg(to_jsonb(h) order by h.round_hole_number,h.id) from holes h), '[]'::jsonb),
      'origin_holes', coalesce((select jsonb_agg(to_jsonb(s) order by s.route_id,s.physical_hole_number,s.id)
        from public.route_holes s where s.route_id in (front_route_id,back_route_id)), '[]'::jsonb)),
    'route', jsonb_build_object('holes_count', holes_count, 'total_par', total_par,
      'source_system', source_system, 'order', source_payload -> 'display_order',
      'notes', coalesce(source_payload ->> 'notes', source_payload ->> 'note')),
    'origins', jsonb_build_array(
      jsonb_build_object('position',1,'name',front ->> 'name','holes_count',front -> 'holes_count','is_active',front -> 'is_active'),
      jsonb_build_object('position',2,'name',back ->> 'name','holes_count',back -> 'holes_count','is_active',back -> 'is_active')),
    'holes', coalesce((select jsonb_agg(jsonb_build_object('round_hole_number',h.round_hole_number,
      'route_position',h.route_position,'physical_hole_number',h.physical_hole_number,
      'par',h.par,'stroke_index',h.stroke_index,'display_label',h.display_label)
      order by h.round_hole_number,h.id) from holes h), '[]'::jsonb),
    'checks', jsonb_build_object('expected_holes',holes_count,'actual_holes',actual_holes,
      'missing_round_numbers',to_jsonb(missing_round_numbers),
      'duplicate_round_numbers',duplicate_round_numbers,'duplicate_physical_holes',duplicate_physical_holes,
      'front_holes',front_holes,'back_holes',back_holes,'invalid_origin_holes',invalid_origin_holes,
      'origins_valid',origins_valid,'origins_active',origins_active,'par_sum',par_sum,
      'par_consistent',case when total_par is null then null else total_par = par_sum end,
      'coherent',coalesce(holes_count = 18 and origins_valid and actual_holes = 18
        and cardinality(missing_round_numbers) = 0 and duplicate_round_numbers = 0
        and duplicate_physical_holes = 0 and front_holes = 9 and back_holes = 9
        and invalid_origin_holes = 0 and (total_par is null or total_par = par_sum),false))
  ) from checks;
$$;

-- Same lock order for open/publish. Reserve the combination table's write lock
-- before origin rows, compatible with the existing Percorso structure contract.
-- SHARE on hole tables prevents phantoms and edits during validation/publication.
create function public.admin_route_lock_target(p_route_id uuid)
returns public.route_combinations
language plpgsql security definer set search_path = pg_catalog
as $$
declare initial public.route_combinations; result public.route_combinations;
begin
  lock table public.route_combinations in row exclusive mode;
  lock table public.route_combination_holes, public.route_holes in share mode;
  select c.* into initial from public.route_combinations c where c.id = p_route_id;
  if not found then raise exception 'Existing Route required' using errcode = '22023'; end if;
  perform r.id from public.course_routes r where r.id in (initial.front_route_id,initial.back_route_id)
    order by r.id for share;
  select c.* into result from public.route_combinations c where c.id = p_route_id for update;
  if not found or not exists (select 1 from public.clubs c where c.id = result.club_id and c.is_active) then
    raise exception 'Existing Route in an active Club required' using errcode = '22023';
  end if;
  if row(result.front_route_id,result.back_route_id,result.club_id) is distinct from
    row(initial.front_route_id,initial.back_route_id,initial.club_id) then
    raise exception 'Route origins changed during opening' using errcode = '40001';
  end if;
  return result;
end;
$$;

create function public.admin_route_guard_draft()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid;
begin
  if old.entity_type = 'route_combination' and old.base_snapshot is not null then
    actor := public.admin_catalog_require_admin();
    if old.created_by <> actor or new.updated_by <> actor then
      raise exception 'Route draft belongs to another Admin' using errcode = '42501';
    end if;
    if row(new.draft_id,new.entity_type,new.entity_key,new.live_entity_id,new.parent_draft_id,
      new.base_version_id,new.base_snapshot,new.base_live_updated_at,new.created_by,new.created_at)
      is distinct from row(old.draft_id,old.entity_type,old.entity_key,old.live_entity_id,old.parent_draft_id,
      old.base_version_id,old.base_snapshot,old.base_live_updated_at,old.created_by,old.created_at) then
      raise exception 'Route draft identity and base are immutable' using errcode = '22023';
    end if;
    if old.workflow_status <> 'draft' or new.schema_version <> 1 or new.revision <> old.revision + 1 then
      raise exception 'Route draft closed or revision invalid' using errcode = '40001';
    end if;
    new.snapshot := public.admin_route_validate_snapshot(new.snapshot);
  end if;
  return new;
end;
$$;
create trigger admin_route_guard_draft before update on public.admin_catalog_drafts
  for each row execute function public.admin_route_guard_draft();

create function public.admin_route_get_draft(p_route_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; result public.admin_catalog_drafts; context jsonb;
begin
  actor := public.admin_catalog_require_admin();
  context := public.admin_route_context(p_route_id);
  if context is null then raise exception 'Existing Route required' using errcode = '22023'; end if;
  select d.* into result from public.admin_catalog_drafts d
    where d.entity_type = 'route_combination' and d.live_entity_id = p_route_id
      and d.created_by = actor and d.workflow_status = 'draft' and d.base_snapshot is not null;
  return jsonb_build_object('draft',case when result.draft_id is null then null else to_jsonb(result) end,'context',context);
end;
$$;

create function public.admin_route_open_draft(p_route_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid; live public.route_combinations; result public.admin_catalog_drafts;
  latest public.admin_catalog_versions; snapshot jsonb; context jsonb;
begin
  actor := public.admin_catalog_require_admin();
  live := public.admin_route_lock_target(p_route_id);
  context := public.admin_route_context(live.id);
  select d.* into result from public.admin_catalog_drafts d
    where d.entity_type = 'route_combination' and d.live_entity_id = live.id and d.created_by = actor
      and d.workflow_status = 'draft' and d.base_snapshot is not null;
  if not found then
    snapshot := jsonb_build_object('name',live.name,'is_active',live.is_active);
    select v.* into latest from public.admin_catalog_versions v
      where v.entity_type = 'route_combination' and v.live_entity_id = live.id order by v.version_number desc limit 1;
    insert into public.admin_catalog_drafts (entity_type,entity_key,live_entity_id,base_version_id,
      snapshot,base_snapshot,base_live_updated_at,created_by,updated_by)
    values ('route_combination',coalesce(latest.entity_key,live.id),live.id,latest.version_id,snapshot,
      snapshot || jsonb_build_object('_context',context -> 'base'),live.updated_at,actor,actor)
      returning * into result;
  end if;
  return jsonb_build_object('draft',to_jsonb(result),'context',context);
end;
$$;

create function public.admin_route_save_draft(p_draft_id uuid,p_snapshot jsonb,p_expected_revision bigint)
returns public.admin_catalog_drafts
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid;
begin
  actor := public.admin_catalog_require_admin();
  if not exists (select 1 from public.admin_catalog_drafts d join public.route_combinations c on c.id = d.live_entity_id
    where d.draft_id = p_draft_id and d.entity_type = 'route_combination'
      and d.created_by = actor and d.base_snapshot is not null) then
    raise exception 'Owned existing Route editor draft required' using errcode = '42501';
  end if;
  return public.admin_catalog_save_draft(p_draft_id,public.admin_route_validate_snapshot(p_snapshot),p_expected_revision,1);
end;
$$;

create function public.admin_route_publish_draft(p_draft_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid; draft public.admin_catalog_drafts; live public.route_combinations;
  published public.admin_catalog_versions; context jsonb; requested jsonb; actual jsonb;
  changes jsonb := '{}'::jsonb; field text; latest_version_id uuid; next_number bigint;
begin
  actor := public.admin_catalog_require_admin();
  select d.* into draft from public.admin_catalog_drafts d
    where d.draft_id = p_draft_id and d.entity_type = 'route_combination' and d.created_by = actor;
  if not found or draft.live_entity_id is null or draft.base_snapshot is null then
    raise exception 'Owned existing Route editor draft required' using errcode = '42501';
  end if;
  live := public.admin_route_lock_target(draft.live_entity_id);
  select d.* into draft from public.admin_catalog_drafts d where d.draft_id = p_draft_id for update;
  if draft.entity_type <> 'route_combination' or draft.live_entity_id <> live.id
    or draft.created_by <> actor or draft.updated_by <> actor or draft.schema_version <> 1
    or draft.base_snapshot is null or draft.parent_draft_id is not null then
    raise exception 'Invalid owned Route editor draft' using errcode = '22023';
  end if;
  if draft.workflow_status <> 'draft' or p_expected_revision is null or draft.revision <> p_expected_revision then
    raise exception 'Route draft closed or changed since confirmation' using errcode = '40001';
  end if;
  requested := public.admin_route_validate_snapshot(draft.snapshot);
  actual := jsonb_build_object('name',live.name,'is_active',live.is_active);
  context := public.admin_route_context(live.id);
  select v.version_id into latest_version_id from public.admin_catalog_versions v
    where v.entity_type = 'route_combination' and v.live_entity_id = live.id order by v.version_number desc limit 1;
  if live.updated_at is distinct from draft.base_live_updated_at
    or actual || jsonb_build_object('_context',context -> 'base') is distinct from draft.base_snapshot
    or latest_version_id is distinct from draft.base_version_id then
    raise exception 'Route or dependent data changed since draft base' using errcode = '40001';
  end if;
  if (context #>> '{checks,coherent}')::boolean is distinct from true
    or ((requested ->> 'is_active')::boolean and ((context #>> '{checks,origins_active}')::boolean is distinct from true)) then
    raise exception 'Route hole structure or active origins are inconsistent' using errcode = '23514';
  end if;
  foreach field in array array['name','is_active'] loop
    if requested -> field is distinct from actual -> field then
      changes := changes || jsonb_build_object(field,jsonb_build_object('before',actual -> field,'after',requested -> field));
    end if;
  end loop;
  if changes = '{}'::jsonb then raise exception 'No Route changes to publish' using errcode = '22023'; end if;
  update public.route_combinations set name = requested ->> 'name',
    is_active = (requested ->> 'is_active')::boolean,updated_at = clock_timestamp()
    where id = live.id returning * into live;
  select coalesce(max(v.version_number),0) + 1 into next_number from public.admin_catalog_versions v
    where v.entity_type = 'route_combination' and v.entity_key = draft.entity_key;
  insert into public.admin_catalog_versions (entity_type,entity_key,live_entity_id,source_draft_id,
    version_number,schema_version,snapshot,diff,published_by,published_at)
  values ('route_combination',draft.entity_key,live.id,draft.draft_id,next_number,1,requested,changes,actor,clock_timestamp())
    returning * into published;
  update public.admin_catalog_drafts set workflow_status = 'published',revision = revision + 1,
    updated_by = actor,updated_at = clock_timestamp() where draft_id = draft.draft_id;
  return jsonb_build_object('draft_id',draft.draft_id,'version_id',published.version_id,
    'version_number',published.version_number,'diff',published.diff,
    'route',jsonb_build_object('id',live.id,'club_id',live.club_id,'name',live.name,
      'is_active',live.is_active,'updated_at',live.updated_at));
end;
$$;

revoke all on function public.admin_route_validate_snapshot(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_route_context(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_route_lock_target(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_route_guard_draft() from public,anon,authenticated,service_role;
revoke all on function public.admin_route_get_draft(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_route_open_draft(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_route_save_draft(uuid,jsonb,bigint) from public,anon,authenticated,service_role;
revoke all on function public.admin_route_publish_draft(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.admin_route_get_draft(uuid) to authenticated;
grant execute on function public.admin_route_open_draft(uuid) to authenticated;
grant execute on function public.admin_route_save_draft(uuid,jsonb,bigint) to authenticated;
grant execute on function public.admin_route_publish_draft(uuid,bigint) to authenticated;

notify pgrst,'reload schema';
commit;
