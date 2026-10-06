-- Existing Admin Percorso = course_routes, workflow entity_type = route.
-- Apply manually AFTER admin-catalog-workflow.sql and admin-club-editor.sql.
-- One-shot transaction. No backfill, new live entity, policy change or remote SQL.
begin;

create unique index admin_course_open_draft_owner_idx
  on public.admin_catalog_drafts(live_entity_id, created_by)
  where entity_type = 'route' and workflow_status = 'draft' and base_snapshot is not null;

create function public.admin_course_validate_snapshot(p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare
  display_name text;
  ordering numeric;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object' then
    raise exception 'Invalid Percorso snapshot' using errcode = '22023';
  end if;
  if not (p_snapshot ?& array['name', 'holes_count', 'display_order', 'is_active'])
    or (p_snapshot - array['name', 'holes_count', 'display_order', 'is_active']) <> '{}'::jsonb
    or jsonb_typeof(p_snapshot -> 'name') is distinct from 'string'
    or jsonb_typeof(p_snapshot -> 'holes_count') is distinct from 'number'
    or (p_snapshot ->> 'holes_count')::numeric not in (9, 18)
    or jsonb_typeof(p_snapshot -> 'display_order') not in ('number', 'null')
    or jsonb_typeof(p_snapshot -> 'is_active') is distinct from 'boolean' then
    raise exception 'Only name, 9/18 structure, order and active state are allowed' using errcode = '22023';
  end if;
  display_name := btrim(p_snapshot ->> 'name');
  ordering := (p_snapshot ->> 'display_order')::numeric;
  if display_name = '' or char_length(display_name) > 200
    or ordering <> trunc(ordering) or ordering not between -2147483648 and 2147483647 then
    raise exception 'Invalid Percorso name or integer order' using errcode = '22023';
  end if;
  return jsonb_build_object('name', display_name,
    'holes_count', ((p_snapshot ->> 'holes_count')::numeric)::integer,
    'display_order', ordering::integer, 'is_active', (p_snapshot ->> 'is_active')::boolean);
end;
$$;

-- A cardinality change is safe only on an unconfigured, unused record. Inactive
-- dependencies also count: deactivation must not make a structural change safe.
create function public.admin_course_structure_editable(p_course_id uuid)
returns boolean language sql security definer set search_path = pg_catalog
as $$
  select exists (select 1 from public.course_routes r where r.id = p_course_id
    and r.total_par is null
    and not (coalesce(r.source_payload, '{}'::jsonb) ?| array[
      'round_variant', 'physical_hole_count', 'product_simplification'])
    and not exists (select 1 from public.route_holes h where h.route_id = r.id)
    and not exists (select 1 from public.route_tees t where t.route_id = r.id)
    and not exists (select 1 from public.route_combinations c where c.front_route_id = r.id or c.back_route_id = r.id)
    and not exists (select 1 from public.route_combination_holes h where h.route_id = r.id)
    and not exists (select 1 from public.round_holes h where h.route_id = r.id)
    and not exists (select 1 from public.rounds g
      where g.selected_routes @> jsonb_build_array(jsonb_build_object('route_id', r.id::text))));
$$;

create function public.admin_course_guard_draft()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid;
begin
  if old.entity_type = 'route' and old.base_snapshot is not null then
    actor := public.admin_catalog_require_admin();
    if old.created_by <> actor or new.updated_by <> actor then
      raise exception 'Percorso draft belongs to another Admin' using errcode = '42501';
    end if;
    if row(new.draft_id, new.entity_type, new.entity_key, new.live_entity_id,
           new.parent_draft_id, new.base_version_id, new.base_snapshot,
           new.base_live_updated_at, new.created_by, new.created_at)
      is distinct from
       row(old.draft_id, old.entity_type, old.entity_key, old.live_entity_id,
           old.parent_draft_id, old.base_version_id, old.base_snapshot,
           old.base_live_updated_at, old.created_by, old.created_at) then
      raise exception 'Percorso draft identity and base are immutable' using errcode = '22023';
    end if;
    if old.workflow_status <> 'draft' or new.schema_version <> 1
      or new.revision <> old.revision + 1 then
      raise exception 'Percorso draft closed or revision invalid' using errcode = '40001';
    end if;
    new.snapshot := public.admin_course_validate_snapshot(new.snapshot);
  end if;
  return new;
end;
$$;
create trigger admin_course_guard_draft before update on public.admin_catalog_drafts
  for each row execute function public.admin_course_guard_draft();

create function public.admin_course_get_draft(p_course_id uuid)
returns public.admin_catalog_drafts
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; result public.admin_catalog_drafts;
begin
  actor := public.admin_catalog_require_admin();
  select d.* into result from public.admin_catalog_drafts d
    where d.entity_type = 'route' and d.live_entity_id = p_course_id
      and d.created_by = actor and d.workflow_status = 'draft' and d.base_snapshot is not null;
  return result;
end;
$$;

create function public.admin_course_open_draft(p_course_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid;
  live public.course_routes;
  result public.admin_catalog_drafts;
  latest public.admin_catalog_versions;
  snapshot jsonb;
begin
  actor := public.admin_catalog_require_admin();
  select r.* into live from public.course_routes r where r.id = p_course_id for update;
  if not found or not exists (select 1 from public.clubs c where c.id = live.club_id and c.is_active) then
    raise exception 'Existing Percorso in an active Club required' using errcode = '22023';
  end if;
  select d.* into result from public.admin_catalog_drafts d
    where d.entity_type = 'route' and d.live_entity_id = live.id and d.created_by = actor
      and d.workflow_status = 'draft' and d.base_snapshot is not null;
  if not found then
    snapshot := jsonb_build_object('name', live.name, 'holes_count', live.holes_count,
      'display_order', live.display_order, 'is_active', live.is_active);
    select v.* into latest from public.admin_catalog_versions v
      where v.entity_type = 'route' and v.live_entity_id = live.id order by v.version_number desc limit 1;
    insert into public.admin_catalog_drafts (
      entity_type, entity_key, live_entity_id, base_version_id, snapshot, base_snapshot,
      base_live_updated_at, created_by, updated_by
    ) values (
      'route', coalesce(latest.entity_key, live.id), live.id, latest.version_id, snapshot,
      snapshot || jsonb_build_object('_context', jsonb_build_object('club_id', live.club_id,
        'total_par', live.total_par, 'source_system', live.source_system,
        'source_external_id', live.source_external_id, 'source_payload', live.source_payload)),
      live.updated_at, actor, actor
    ) returning * into result;
  end if;
  return jsonb_build_object('draft', to_jsonb(result), 'context', jsonb_build_object(
    'can_edit_structure', public.admin_course_structure_editable(live.id),
    'source_system', live.source_system,
    'original_name', live.source_payload ->> 'fig_display_name',
    'gesgolf_name', live.source_payload #>> '{gesgolf,route_name}'));
end;
$$;

create function public.admin_course_save_draft(p_draft_id uuid, p_snapshot jsonb, p_expected_revision bigint)
returns public.admin_catalog_drafts
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid;
begin
  actor := public.admin_catalog_require_admin();
  if not exists (select 1 from public.admin_catalog_drafts d where d.draft_id = p_draft_id
    and d.entity_type = 'route' and d.created_by = actor and d.base_snapshot is not null) then
    raise exception 'Owned Percorso editor draft required' using errcode = '42501';
  end if;
  return public.admin_catalog_save_draft(p_draft_id,
    public.admin_course_validate_snapshot(p_snapshot), p_expected_revision, 1);
end;
$$;

create function public.admin_course_publish_draft(p_draft_id uuid, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid;
  draft public.admin_catalog_drafts;
  live public.course_routes;
  published public.admin_catalog_versions;
  requested jsonb;
  actual jsonb;
  context jsonb;
  changes jsonb := '{}'::jsonb;
  field text;
  latest_version_id uuid;
  next_number bigint;
  target_id uuid;
begin
  actor := public.admin_catalog_require_admin();
  select d.* into draft from public.admin_catalog_drafts d
    where d.draft_id = p_draft_id and d.entity_type = 'route' and d.created_by = actor;
  if not found or draft.live_entity_id is null or draft.base_snapshot is null then
    raise exception 'Owned existing Percorso editor draft required' using errcode = '42501';
  end if;
  if draft.workflow_status <> 'draft' or p_expected_revision is null or draft.revision <> p_expected_revision then
    raise exception 'Percorso draft closed or changed since confirmation' using errcode = '40001';
  end if;
  target_id := draft.live_entity_id;
  requested := public.admin_course_validate_snapshot(draft.snapshot);
  -- Only structural publication locks dependency writers, BEFORE the live row.
  -- Includes JSON-only round references, which have no FK to protect them.
  if requested -> 'holes_count' is distinct from draft.base_snapshot -> 'holes_count' then
    lock table public.rounds, public.round_holes, public.route_combinations,
      public.route_combination_holes, public.route_holes, public.route_tees in share mode;
  end if;
  select r.* into live from public.course_routes r where r.id = target_id for update;
  if not found or not exists (select 1 from public.clubs c where c.id = live.club_id and c.is_active) then
    raise exception 'Existing Percorso in an active Club required' using errcode = '22023';
  end if;
  select d.* into draft from public.admin_catalog_drafts d where d.draft_id = p_draft_id for update;
  if draft.entity_type <> 'route' or draft.live_entity_id <> live.id
    or draft.created_by <> actor or draft.updated_by <> actor or draft.schema_version <> 1
    or draft.base_snapshot is null or draft.parent_draft_id is not null then
    raise exception 'Invalid owned Percorso editor draft' using errcode = '22023';
  end if;
  if draft.workflow_status <> 'draft' or p_expected_revision is null or draft.revision <> p_expected_revision then
    raise exception 'Percorso draft closed or changed since confirmation' using errcode = '40001';
  end if;
  -- A save racing with the first read cannot change the confirmed revision.
  requested := public.admin_course_validate_snapshot(draft.snapshot);
  actual := jsonb_build_object('name', live.name, 'holes_count', live.holes_count,
    'display_order', live.display_order, 'is_active', live.is_active);
  context := jsonb_build_object('club_id', live.club_id, 'total_par', live.total_par,
    'source_system', live.source_system, 'source_external_id', live.source_external_id, 'source_payload', live.source_payload);
  select v.version_id into latest_version_id from public.admin_catalog_versions v
    where v.entity_type = 'route' and v.live_entity_id = live.id order by v.version_number desc limit 1;
  if live.updated_at is distinct from draft.base_live_updated_at
    or actual || jsonb_build_object('_context', context) is distinct from draft.base_snapshot
    or latest_version_id is distinct from draft.base_version_id then
    raise exception 'Percorso live data changed since draft base' using errcode = '40001';
  end if;
  if requested -> 'holes_count' is distinct from actual -> 'holes_count'
    and not public.admin_course_structure_editable(live.id) then
    raise exception 'Structure has dependent data and cannot be changed' using errcode = '23514';
  end if;
  foreach field in array array['name', 'holes_count', 'display_order', 'is_active'] loop
    if requested -> field is distinct from actual -> field then
      changes := changes || jsonb_build_object(field,
        jsonb_build_object('before', actual -> field, 'after', requested -> field));
    end if;
  end loop;
  if changes = '{}'::jsonb then raise exception 'No Percorso changes to publish' using errcode = '22023'; end if;
  -- Fixed assignments, never dynamic SQL or JSON-to-record live writes.
  update public.course_routes set name = requested ->> 'name',
    holes_count = (requested ->> 'holes_count')::integer,
    display_order = (requested ->> 'display_order')::integer,
    is_active = (requested ->> 'is_active')::boolean, updated_at = clock_timestamp()
    where id = live.id returning * into live;
  select coalesce(max(v.version_number), 0) + 1 into next_number from public.admin_catalog_versions v
    where v.entity_type = 'route' and v.entity_key = draft.entity_key;
  insert into public.admin_catalog_versions (
    entity_type, entity_key, live_entity_id, source_draft_id, version_number,
    schema_version, snapshot, diff, published_by, published_at
  ) values ('route', draft.entity_key, live.id, draft.draft_id, next_number,
    1, requested, changes, actor, clock_timestamp()) returning * into published;
  update public.admin_catalog_drafts set workflow_status = 'published', revision = revision + 1,
    updated_by = actor, updated_at = clock_timestamp() where draft_id = draft.draft_id;
  return jsonb_build_object('draft_id', draft.draft_id, 'version_id', published.version_id,
    'version_number', published.version_number, 'diff', published.diff,
    'course', jsonb_build_object('id', live.id, 'club_id', live.club_id, 'name', live.name,
      'holes_count', live.holes_count, 'display_order', live.display_order,
      'is_active', live.is_active, 'updated_at', live.updated_at));
end;
$$;

revoke all on function public.admin_course_validate_snapshot(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_course_structure_editable(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_course_guard_draft() from public, anon, authenticated, service_role;
revoke all on function public.admin_course_get_draft(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_course_open_draft(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_course_save_draft(uuid, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.admin_course_publish_draft(uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_course_get_draft(uuid) to authenticated;
grant execute on function public.admin_course_open_draft(uuid) to authenticated;
grant execute on function public.admin_course_save_draft(uuid, jsonb, bigint) to authenticated;
grant execute on function public.admin_course_publish_draft(uuid, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
