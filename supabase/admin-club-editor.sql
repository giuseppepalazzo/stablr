-- Existing Club editor. Apply manually AFTER admin-catalog-workflow.sql.
-- Transactional one-shot migration. No backfill or remote execution.
begin;

alter table public.admin_catalog_drafts
  add column base_snapshot jsonb,
  add column base_live_updated_at timestamptz,
  add constraint admin_club_draft_base_object check (
    base_snapshot is null or jsonb_typeof(base_snapshot) = 'object'
  );
alter table public.admin_catalog_drafts
  drop constraint admin_catalog_drafts_workflow_status_check;
alter table public.admin_catalog_drafts
  add constraint admin_catalog_drafts_workflow_status_check
  check (workflow_status in ('draft', 'archived', 'published'));
alter table public.admin_catalog_versions
  add column diff jsonb not null default '{}'::jsonb check (jsonb_typeof(diff) = 'object');

create unique index admin_club_open_draft_owner_idx
  on public.admin_catalog_drafts(live_entity_id, created_by)
  where entity_type = 'club' and workflow_status = 'draft' and base_snapshot is not null;

-- Exact allowlist: no FIG keys, statuses, source metadata or relationships.
create function public.admin_club_validate_snapshot(p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare
  display_name text;
  locality text;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object' then
    raise exception 'Invalid Club snapshot' using errcode = '22023';
  end if;
  if not (p_snapshot ? 'name' and p_snapshot ? 'city')
    or (p_snapshot - array['name', 'city']::text[]) <> '{}'::jsonb
    or jsonb_typeof(p_snapshot -> 'name') is distinct from 'string'
    or jsonb_typeof(p_snapshot -> 'city') not in ('string', 'null') then
    raise exception 'Only Club name and city are allowed' using errcode = '22023';
  end if;
  display_name := btrim(p_snapshot ->> 'name');
  locality := nullif(btrim(p_snapshot ->> 'city'), '');
  if display_name = '' or char_length(display_name) > 200
    or char_length(locality) > 200 then
    raise exception 'Invalid Club name or city length' using errcode = '22023';
  end if;
  return jsonb_build_object('name', display_name, 'city', locality);
end;
$$;

-- A generic workflow save cannot replace a server-captured base, change the
-- Club identity/owner, or edit someone else's editor draft.
create function public.admin_club_guard_draft()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid;
begin
  if old.entity_type = 'club' and old.base_snapshot is not null then
    actor := public.admin_catalog_require_admin();
    if old.created_by <> actor or new.updated_by <> actor then
      raise exception 'Club draft belongs to another Admin' using errcode = '42501';
    end if;
    if row(new.draft_id, new.entity_type, new.entity_key, new.live_entity_id,
           new.parent_draft_id, new.base_version_id, new.base_snapshot,
           new.base_live_updated_at, new.created_by, new.created_at)
      is distinct from
       row(old.draft_id, old.entity_type, old.entity_key, old.live_entity_id,
           old.parent_draft_id, old.base_version_id, old.base_snapshot,
           old.base_live_updated_at, old.created_by, old.created_at) then
      raise exception 'Club draft identity and base are immutable' using errcode = '22023';
    end if;
    if old.workflow_status <> 'draft' or new.schema_version <> 1
      or new.revision <> old.revision + 1 then
      raise exception 'Club draft is closed or revision is invalid' using errcode = '40001';
    end if;
    new.snapshot := public.admin_club_validate_snapshot(new.snapshot);
  end if;
  return new;
end;
$$;
create trigger admin_club_guard_draft
  before update on public.admin_catalog_drafts
  for each row execute function public.admin_club_guard_draft();

create function public.admin_club_get_draft(p_club_id uuid)
returns public.admin_catalog_drafts
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid;
  result public.admin_catalog_drafts;
begin
  actor := public.admin_catalog_require_admin();
  select d.* into result from public.admin_catalog_drafts as d
    where d.entity_type = 'club' and d.live_entity_id = p_club_id
      and d.created_by = actor and d.workflow_status = 'draft'
      and d.base_snapshot is not null;
  return result;
end;
$$;

create function public.admin_club_open_draft(p_club_id uuid)
returns public.admin_catalog_drafts
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid;
  live public.clubs;
  result public.admin_catalog_drafts;
  latest_version public.admin_catalog_versions;
  live_snapshot jsonb;
begin
  actor := public.admin_catalog_require_admin();
  -- Serializes opens/publications for this Club, including concurrent tabs.
  select c.* into live from public.clubs as c where c.id = p_club_id for update;
  if not found or live.is_active is distinct from true then
    raise exception 'Active Club not found' using errcode = '22023';
  end if;
  select d.* into result from public.admin_catalog_drafts as d
    where d.entity_type = 'club' and d.live_entity_id = p_club_id
      and d.created_by = actor and d.workflow_status = 'draft'
      and d.base_snapshot is not null;
  if found then return result; end if;
  live_snapshot := jsonb_build_object('name', live.name, 'city', live.city);
  select v.* into latest_version from public.admin_catalog_versions as v
    where v.entity_type = 'club' and v.live_entity_id = p_club_id
    order by v.version_number desc limit 1;
  insert into public.admin_catalog_drafts (
    entity_type, entity_key, live_entity_id, base_version_id,
    snapshot, base_snapshot, base_live_updated_at, created_by, updated_by
  ) values (
    'club', coalesce(latest_version.entity_key, live.id), live.id, latest_version.version_id,
    live_snapshot, live_snapshot, live.updated_at, actor, actor
  ) returning * into result;
  return result;
end;
$$;

create function public.admin_club_save_draft(
  p_draft_id uuid, p_snapshot jsonb, p_expected_revision bigint
)
returns public.admin_catalog_drafts
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid;
begin
  actor := public.admin_catalog_require_admin();
  if not exists (select 1 from public.admin_catalog_drafts as d
    where d.draft_id = p_draft_id and d.entity_type = 'club'
      and d.created_by = actor and d.base_snapshot is not null) then
    raise exception 'Owned Club editor draft not found' using errcode = '42501';
  end if;
  return public.admin_catalog_save_draft(
    p_draft_id, public.admin_club_validate_snapshot(p_snapshot), p_expected_revision, 1
  );
end;
$$;

create function public.admin_club_publish_draft(p_draft_id uuid, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid;
  draft public.admin_catalog_drafts;
  live public.clubs;
  published public.admin_catalog_versions;
  latest_version_id uuid;
  next_number bigint;
  requested_snapshot jsonb;
  live_snapshot jsonb;
  changes jsonb := '{}'::jsonb;
  target_id uuid;
begin
  actor := public.admin_catalog_require_admin();
  select d.live_entity_id into target_id from public.admin_catalog_drafts as d
    where d.draft_id = p_draft_id and d.entity_type = 'club' and d.created_by = actor;
  if not found or target_id is null then
    raise exception 'Owned existing Club draft required' using errcode = '42501';
  end if;
  -- Same lock order as open: live row first, draft second.
  select c.* into live from public.clubs as c where c.id = target_id for update;
  if not found or live.is_active is distinct from true then
    raise exception 'Active Club not found' using errcode = '22023';
  end if;
  select d.* into draft from public.admin_catalog_drafts as d where d.draft_id = p_draft_id for update;
  if draft.entity_type <> 'club' or draft.live_entity_id <> live.id
    or draft.created_by <> actor or draft.updated_by <> actor
    or draft.schema_version <> 1 or draft.base_snapshot is null
    or draft.parent_draft_id is not null then
    raise exception 'Invalid owned Club editor draft' using errcode = '22023';
  end if;
  if draft.workflow_status <> 'draft' or p_expected_revision is null
    or draft.revision <> p_expected_revision then
    raise exception 'Club draft closed or changed since confirmation' using errcode = '40001';
  end if;
  requested_snapshot := public.admin_club_validate_snapshot(draft.snapshot);
  live_snapshot := jsonb_build_object('name', live.name, 'city', live.city);
  select v.version_id into latest_version_id from public.admin_catalog_versions as v
    where v.entity_type = 'club' and v.live_entity_id = live.id
    order by v.version_number desc limit 1;
  if live.updated_at is distinct from draft.base_live_updated_at
    or live_snapshot is distinct from draft.base_snapshot
    or latest_version_id is distinct from draft.base_version_id then
    raise exception 'Club live data changed since draft base' using errcode = '40001';
  end if;
  if requested_snapshot -> 'name' is distinct from live_snapshot -> 'name' then
    changes := changes || jsonb_build_object('name', jsonb_build_object('before', live.name, 'after', requested_snapshot ->> 'name'));
  end if;
  if requested_snapshot -> 'city' is distinct from live_snapshot -> 'city' then
    changes := changes || jsonb_build_object('city', jsonb_build_object('before', live.city, 'after', requested_snapshot ->> 'city'));
  end if;
  if changes = '{}'::jsonb then
    raise exception 'No Club changes to publish' using errcode = '22023';
  end if;

  -- Explicit assignment only. name_normalized (matching), FIG and source/status
  -- fields stay unchanged. updated_at is the existing catalog activity metadata.
  update public.clubs set name = requested_snapshot ->> 'name', city = requested_snapshot ->> 'city',
    updated_at = clock_timestamp() where id = live.id returning * into live;
  select coalesce(max(v.version_number), 0) + 1 into next_number
    from public.admin_catalog_versions as v where v.entity_type = 'club' and v.entity_key = draft.entity_key;
  insert into public.admin_catalog_versions (
    entity_type, entity_key, live_entity_id, source_draft_id, version_number,
    schema_version, snapshot, diff, published_by, published_at
  ) values (
    'club', draft.entity_key, live.id, draft.draft_id, next_number,
    1, requested_snapshot, changes, actor, clock_timestamp()
  ) returning * into published;
  update public.admin_catalog_drafts set workflow_status = 'published',
    revision = revision + 1, updated_by = actor, updated_at = clock_timestamp()
    where draft_id = draft.draft_id;
  return jsonb_build_object('draft_id', draft.draft_id, 'version_id', published.version_id,
    'version_number', published.version_number, 'diff', published.diff,
    'club', jsonb_build_object('id', live.id, 'name', live.name, 'city', live.city, 'updated_at', live.updated_at));
end;
$$;

revoke all on function public.admin_club_validate_snapshot(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_club_guard_draft() from public, anon, authenticated, service_role;
revoke all on function public.admin_club_get_draft(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_club_open_draft(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_club_save_draft(uuid, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.admin_club_publish_draft(uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_club_get_draft(uuid) to authenticated;
grant execute on function public.admin_club_open_draft(uuid) to authenticated;
grant execute on function public.admin_club_save_draft(uuid, jsonb, bigint) to authenticated;
grant execute on function public.admin_club_publish_draft(uuid, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
