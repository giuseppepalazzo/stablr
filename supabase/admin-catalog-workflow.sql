-- STABLR Admin catalog workflow foundation. Apply manually in the SQL Editor.
-- Prerequisites: shared-catalog-schema.sql, fig-whs-extension.sql, admin-access.sql.
-- No live writes, backfill, publication RPC, or player-facing integration.
-- Transactional, intentionally one-shot: existing objects cause a rollback.
begin;

create table public.admin_catalog_drafts (
  draft_id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in (
    'club', 'course', 'route', 'route_combination', 'hole',
    'combination_hole', 'route_tee', 'combination_tee'
  )),
  -- Stable identity for a version lineage, even before a live record exists.
  entity_key uuid not null,
  live_entity_id uuid,
  parent_draft_id uuid references public.admin_catalog_drafts(draft_id) on delete restrict,
  base_version_id uuid,
  schema_version integer not null default 1 check (schema_version = 1),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  workflow_status text not null default 'draft' check (workflow_status in ('draft', 'archived')),
  revision bigint not null default 1 check (revision > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (draft_id, entity_type, entity_key),
  check (parent_draft_id is null or parent_draft_id <> draft_id)
);

-- Reserved for future, validated entity-specific publication transactions.
-- There is deliberately no client/RPC INSERT permission or version generator.
create table public.admin_catalog_versions (
  version_id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in (
    'club', 'course', 'route', 'route_combination', 'hole',
    'combination_hole', 'route_tee', 'combination_tee'
  )),
  entity_key uuid not null,
  live_entity_id uuid not null,
  source_draft_id uuid not null,
  version_number bigint not null check (version_number > 0),
  schema_version integer not null default 1 check (schema_version = 1),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default now(),
  unique (version_id, entity_type, entity_key),
  unique (entity_type, entity_key, version_number),
  foreign key (source_draft_id, entity_type, entity_key)
    references public.admin_catalog_drafts(draft_id, entity_type, entity_key) on delete restrict
);

alter table public.admin_catalog_drafts
  add constraint admin_catalog_drafts_base_version_fk
  foreign key (base_version_id, entity_type, entity_key)
  references public.admin_catalog_versions(version_id, entity_type, entity_key) on delete restrict;

create index admin_catalog_drafts_live_idx
  on public.admin_catalog_drafts(entity_type, live_entity_id);
create index admin_catalog_drafts_parent_idx on public.admin_catalog_drafts(parent_draft_id);
create index admin_catalog_drafts_base_idx on public.admin_catalog_drafts(base_version_id);
create index admin_catalog_drafts_status_idx
  on public.admin_catalog_drafts(workflow_status, updated_at desc);

alter table public.admin_catalog_drafts enable row level security;
alter table public.admin_catalog_versions enable row level security;
revoke all on public.admin_catalog_drafts, public.admin_catalog_versions
  from public, anon, authenticated, service_role;
grant select on public.admin_catalog_drafts, public.admin_catalog_versions to authenticated;

create policy admin_catalog_drafts_select_admin on public.admin_catalog_drafts
  for select to authenticated
  using (auth.uid() is not null and public.is_admin());
create policy admin_catalog_versions_select_admin on public.admin_catalog_versions
  for select to authenticated
  using (auth.uid() is not null and public.is_admin());

-- Fixed search_path and qualified object names for every definer function.
-- Helpers have no API execution grant; only the three guarded RPCs call them.
create function public.admin_catalog_require_admin()
returns uuid language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated'
    or public.is_admin() is distinct from true then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

create function public.admin_catalog_validate_target(p_entity_type text, p_live_entity_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog
as $$
declare
  target_exists boolean := false;
begin
  if p_entity_type is null or p_entity_type not in (
    'club', 'course', 'route', 'route_combination', 'hole',
    'combination_hole', 'route_tee', 'combination_tee'
  ) then
    raise exception 'Unsupported catalog entity type' using errcode = '22023';
  end if;
  if p_live_entity_id is null then return; end if;
  -- Explicit mapping only. "course" is conceptual and currently has no live table.
  case p_entity_type
    when 'club' then select exists (select 1 from public.clubs where id = p_live_entity_id) into target_exists;
    when 'route' then select exists (select 1 from public.course_routes where id = p_live_entity_id) into target_exists;
    when 'route_combination' then select exists (select 1 from public.route_combinations where id = p_live_entity_id) into target_exists;
    when 'hole' then select exists (select 1 from public.route_holes where id = p_live_entity_id) into target_exists;
    when 'combination_hole' then select exists (select 1 from public.route_combination_holes where id = p_live_entity_id) into target_exists;
    when 'route_tee' then select exists (select 1 from public.route_tees where id = p_live_entity_id) into target_exists;
    when 'combination_tee' then select exists (select 1 from public.combination_tees where id = p_live_entity_id) into target_exists;
    else target_exists := false;
  end case;
  if not target_exists then
    raise exception 'Live catalog target not found for entity type' using errcode = '22023';
  end if;
end;
$$;

create function public.admin_catalog_validate_snapshot(p_snapshot jsonb, p_schema_version integer)
returns void language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if p_schema_version is distinct from 1 or p_snapshot is null
    or jsonb_typeof(p_snapshot) is distinct from 'object' then
    raise exception 'Snapshot must be a JSON object with schema_version 1' using errcode = '22023';
  end if;
end;
$$;

create function public.admin_catalog_validate_parent(p_entity_type text, p_parent_draft_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog
as $$
declare
  parent_type text;
begin
  if p_parent_draft_id is null then return; end if;
  select d.entity_type into parent_type from public.admin_catalog_drafts as d
    where d.draft_id = p_parent_draft_id and d.workflow_status = 'draft' for share;
  if not found or not (
    (p_entity_type = 'course' and parent_type = 'club') or
    (p_entity_type = 'route' and parent_type in ('club', 'course')) or
    (p_entity_type = 'route_combination' and parent_type = 'club') or
    (p_entity_type in ('hole', 'route_tee') and parent_type = 'route') or
    (p_entity_type in ('combination_hole', 'combination_tee') and parent_type = 'route_combination')
  ) then
    raise exception 'Invalid or archived parent draft' using errcode = '22023';
  end if;
end;
$$;

-- Published snapshots cannot be updated/deleted/truncated, even accidentally
-- by a future privileged publication implementation. Draft deletion is blocked
-- as well; archival remains a workflow state, without a callable action yet.
create function public.admin_catalog_reject_removal()
returns trigger language plpgsql set search_path = pg_catalog
as $$
begin
  raise exception 'Catalog workflow history is immutable; physical removal is forbidden'
    using errcode = '55000';
end;
$$;

create trigger admin_catalog_versions_immutable
  before update or delete on public.admin_catalog_versions
  for each row execute function public.admin_catalog_reject_removal();
create trigger admin_catalog_versions_no_truncate
  before truncate on public.admin_catalog_versions
  for each statement execute function public.admin_catalog_reject_removal();
create trigger admin_catalog_drafts_no_delete
  before delete on public.admin_catalog_drafts
  for each row execute function public.admin_catalog_reject_removal();
create trigger admin_catalog_drafts_no_truncate
  before truncate on public.admin_catalog_drafts
  for each statement execute function public.admin_catalog_reject_removal();

create function public.admin_catalog_create_draft(
  p_entity_type text,
  p_snapshot jsonb,
  p_live_entity_id uuid default null,
  p_parent_draft_id uuid default null,
  p_base_version_id uuid default null,
  p_schema_version integer default 1
)
returns public.admin_catalog_drafts
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid;
  identity_key uuid;
  base public.admin_catalog_versions;
  result public.admin_catalog_drafts;
begin
  actor := public.admin_catalog_require_admin();
  perform public.admin_catalog_validate_target(p_entity_type, p_live_entity_id);
  perform public.admin_catalog_validate_snapshot(p_snapshot, p_schema_version);
  perform public.admin_catalog_validate_parent(p_entity_type, p_parent_draft_id);
  identity_key := coalesce(p_live_entity_id, gen_random_uuid());
  if p_base_version_id is not null then
    select v.* into base from public.admin_catalog_versions as v where v.version_id = p_base_version_id;
    if not found or base.entity_type is distinct from p_entity_type
      or base.live_entity_id is distinct from p_live_entity_id then
      raise exception 'Base version does not match catalog target' using errcode = '22023';
    end if;
    identity_key := base.entity_key;
  end if;
  insert into public.admin_catalog_drafts (
    entity_type, entity_key, live_entity_id, parent_draft_id, base_version_id,
    schema_version, snapshot, created_by, updated_by
  ) values (
    p_entity_type, identity_key, p_live_entity_id, p_parent_draft_id, p_base_version_id,
    p_schema_version, p_snapshot, actor, actor
  ) returning * into result;
  return result;
end;
$$;

create function public.admin_catalog_save_draft(
  p_draft_id uuid, p_snapshot jsonb, p_expected_revision bigint,
  p_schema_version integer default 1
)
returns public.admin_catalog_drafts
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid;
  result public.admin_catalog_drafts;
begin
  actor := public.admin_catalog_require_admin();
  perform public.admin_catalog_validate_snapshot(p_snapshot, p_schema_version);
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'Expected draft revision is required' using errcode = '22023';
  end if;
  -- Atomic compare-and-swap: only one concurrent save of a revision succeeds.
  update public.admin_catalog_drafts as d
    set snapshot = p_snapshot, schema_version = p_schema_version,
        revision = d.revision + 1, updated_by = actor, updated_at = clock_timestamp()
    where d.draft_id = p_draft_id and d.workflow_status = 'draft'
      and d.revision = p_expected_revision
    returning d.* into result;
  if not found then
    raise exception 'Draft missing, archived, or changed by another save' using errcode = '40001';
  end if;
  return result;
end;
$$;

create function public.admin_catalog_restore_version(
  p_version_id uuid, p_parent_draft_id uuid default null
)
returns public.admin_catalog_drafts
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid;
  version public.admin_catalog_versions;
begin
  actor := public.admin_catalog_require_admin();
  select v.* into version from public.admin_catalog_versions as v where v.version_id = p_version_id;
  if not found then
    raise exception 'Catalog version not found' using errcode = '22023';
  end if;
  return public.admin_catalog_create_draft(
    version.entity_type, version.snapshot, version.live_entity_id,
    p_parent_draft_id, version.version_id, version.schema_version
  );
end;
$$;

revoke all on function public.admin_catalog_require_admin() from public, anon, authenticated, service_role;
revoke all on function public.admin_catalog_validate_target(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_catalog_validate_snapshot(jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.admin_catalog_validate_parent(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_catalog_reject_removal() from public, anon, authenticated, service_role;
revoke all on function public.admin_catalog_create_draft(text, jsonb, uuid, uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.admin_catalog_save_draft(uuid, jsonb, bigint, integer) from public, anon, authenticated, service_role;
revoke all on function public.admin_catalog_restore_version(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_catalog_create_draft(text, jsonb, uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.admin_catalog_save_draft(uuid, jsonb, bigint, integer) to authenticated;
grant execute on function public.admin_catalog_restore_version(uuid, uuid) to authenticated;

comment on table public.admin_catalog_drafts is 'Admin workflow only; snapshot v1 is a JSON object, with schema_version stored alongside it. No domain/publication validation yet.';
comment on table public.admin_catalog_versions is 'Immutable published snapshots. Future entity-specific publication only; no prefilled versions or client insertion.';
comment on column public.admin_catalog_drafts.workflow_status is 'Internal draft/archived state. Independent of catalog data_status, is_active, and player visibility.';

notify pgrst, 'reload schema';
commit;
