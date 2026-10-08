-- Phase 1: isolated Admin proposals, not a new live catalog or publication API.
-- Apply manually ONCE after the shared catalog, FIG/WHS and Admin workflow.
-- Empty tables only: no backfill, source inference, live writes or consumers.
begin;

create table public.admin_catalog_physical_structures (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  label text not null check (btrim(label) <> '' and char_length(label) <= 200),
  classification text not null default 'non_classificato'
    check (classification in ('fisico_9','fisico_18','multi_9','non_classificato')),
  review_status text not null default 'needs_review' check (review_status in ('needs_review','verified')),
  source_system text not null check (source_system in ('fig','gesgolf','stablr','other')),
  source_reference text not null check (btrim(source_reference) <> ''),
  reason text not null check (btrim(reason) <> ''),
  revision bigint not null default 1 check (revision > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (id,club_id), unique (club_id,label),
  check (classification <> 'non_classificato' or review_status = 'needs_review')
);

create table public.admin_catalog_physical_holes (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null,
  club_id uuid not null,
  physical_number integer not null check (physical_number > 0),
  label text not null check (btrim(label) <> '' and char_length(label) <= 200),
  base_par integer check (base_par between 3 and 6),
  review_status text not null default 'needs_review' check (review_status in ('needs_review','verified')),
  source_system text not null check (source_system in ('fig','gesgolf','stablr','other')),
  source_reference text not null check (btrim(source_reference) <> ''),
  reason text not null check (btrim(reason) <> ''),
  revision bigint not null default 1 check (revision > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (id,structure_id,club_id), unique (structure_id,physical_number),
  foreign key (structure_id,club_id) references public.admin_catalog_physical_structures(id,club_id) on delete restrict,
  check (review_status <> 'verified' or base_par is not null)
  -- SI intentionally does not belong to the physical identity.
);

create table public.admin_catalog_playable_configurations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  label text not null check (btrim(label) <> '' and char_length(label) <= 200),
  holes_count integer not null check (holes_count in (9,18)),
  structure_id uuid,
  relationship_kind text not null default 'unresolved' check (relationship_kind in ('unresolved','derived','autonomous')),
  parent_configuration_id uuid,
  parent_configuration_revision bigint check (parent_configuration_revision > 0),
  derivation_rule text,
  review_status text not null default 'needs_review' check (review_status in ('needs_review','verified')),
  -- Explicit legacy provenance, never inferred from a name or hole position.
  legacy_course_route_id uuid references public.course_routes(id) on delete restrict,
  legacy_combination_id uuid references public.route_combinations(id) on delete restrict,
  source_system text not null check (source_system in ('fig','gesgolf','stablr','other')),
  source_reference text not null check (btrim(source_reference) <> ''),
  reason text not null check (btrim(reason) <> ''),
  revision bigint not null default 1 check (revision > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (id,club_id), unique (id,structure_id,club_id),
  foreign key (structure_id,club_id) references public.admin_catalog_physical_structures(id,club_id) on delete restrict,
  foreign key (parent_configuration_id,club_id) references public.admin_catalog_playable_configurations(id,club_id) on delete restrict,
  check (num_nonnulls(legacy_course_route_id,legacy_combination_id) <= 1),
  check (parent_configuration_id is null or parent_configuration_id <> id),
  check ((relationship_kind = 'derived' and parent_configuration_id is not null and parent_configuration_revision is not null
      and nullif(btrim(derivation_rule),'') is not null)
    or (relationship_kind <> 'derived' and parent_configuration_id is null and parent_configuration_revision is null and derivation_rule is null)),
  check (review_status <> 'verified' or (relationship_kind <> 'unresolved' and structure_id is not null))
);

create table public.admin_catalog_configuration_holes (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null,
  club_id uuid not null,
  structure_id uuid,
  physical_hole_id uuid,
  position integer not null check (position between 1 and 18),
  occurrence integer not null check (occurrence between 1 and 18),
  par_mode text check (par_mode in ('inherited','override')),
  par_override integer check (par_override between 3 and 6),
  stroke_index integer check (stroke_index between 1 and 18),
  review_status text not null default 'needs_review' check (review_status in ('needs_review','verified')),
  legacy_route_hole_id uuid references public.route_holes(id) on delete restrict,
  legacy_combination_hole_id uuid references public.route_combination_holes(id) on delete restrict,
  source_system text not null check (source_system in ('fig','gesgolf','stablr','other')),
  source_reference text not null check (btrim(source_reference) <> ''),
  reason text not null check (btrim(reason) <> ''),
  revision bigint not null default 1 check (revision > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (configuration_id,position), unique (configuration_id,physical_hole_id,occurrence),
  unique (id,configuration_id),
  foreign key (configuration_id,club_id) references public.admin_catalog_playable_configurations(id,club_id) on delete restrict,
  foreign key (configuration_id,structure_id,club_id) references public.admin_catalog_playable_configurations(id,structure_id,club_id) on delete restrict,
  foreign key (physical_hole_id,structure_id,club_id) references public.admin_catalog_physical_holes(id,structure_id,club_id) on delete restrict,
  check ((physical_hole_id is null and structure_id is null and review_status = 'needs_review')
    or (physical_hole_id is not null and structure_id is not null and review_status = 'verified')),
  check ((par_mode is null and par_override is null) or (par_mode is not distinct from 'inherited' and par_override is null)
    or (par_mode is not distinct from 'override' and par_override is not null)),
  check (review_status <> 'verified' or (par_mode is not null and stroke_index is not null)),
  check (num_nonnulls(legacy_route_hole_id,legacy_combination_hole_id) <= 1)
);

-- Representation reserved for a future dedicated contract. No RPC can insert
-- or edit these rows in Phase 1, including SI overrides already used by player.
create table public.admin_catalog_tee_overrides (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null references public.admin_catalog_playable_configurations(id) on delete restrict,
  configuration_hole_id uuid not null,
  route_tee_id uuid references public.route_tees(id) on delete restrict,
  combination_tee_id uuid references public.combination_tees(id) on delete restrict,
  par_override integer check (par_override between 3 and 6),
  stroke_index_override integer check (stroke_index_override between 1 and 18),
  review_status text not null default 'needs_review' check (review_status in ('needs_review','verified')),
  source_system text not null check (source_system in ('fig','gesgolf','stablr','other')),
  source_reference text not null check (btrim(source_reference) <> ''),
  reason text not null check (btrim(reason) <> ''),
  revision bigint not null default 1 check (revision > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (configuration_hole_id,configuration_id) references public.admin_catalog_configuration_holes(id,configuration_id) on delete restrict,
  check (num_nonnulls(route_tee_id,combination_tee_id) = 1),
  check (num_nonnulls(par_override,stroke_index_override) >= 1)
);
create unique index admin_catalog_tee_override_route_key
  on public.admin_catalog_tee_overrides(configuration_hole_id,route_tee_id) where route_tee_id is not null;
create unique index admin_catalog_tee_override_combination_key
  on public.admin_catalog_tee_overrides(configuration_hole_id,combination_tee_id) where combination_tee_id is not null;
create index admin_catalog_configuration_parent_idx on public.admin_catalog_playable_configurations(parent_configuration_id);
create index admin_catalog_configuration_physical_idx on public.admin_catalog_configuration_holes(physical_hole_id);

create table public.admin_catalog_foundation_events (
  id uuid primary key default gen_random_uuid(),
  entity_table text not null check (entity_table in ('admin_catalog_physical_structures','admin_catalog_physical_holes',
    'admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_tee_overrides')),
  entity_id uuid not null,
  revision bigint not null check (revision > 0),
  operation text not null check (operation in ('INSERT','UPDATE')),
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (entity_table,entity_id,revision)
);

create function public.admin_catalog_foundation_no_removal()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'Foundation proposals and evidence cannot be deleted or rewritten as history' using errcode = '55000';
end;
$$;

create function public.admin_catalog_foundation_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid; cfg public.admin_catalog_playable_configurations;
begin
  actor := public.admin_catalog_require_admin();
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.created_by <> old.created_by or new.created_at <> old.created_at then
      raise exception 'Foundation identity and author are immutable' using errcode = '22023';
    end if;
    if old.review_status = 'verified' and tg_table_name <> 'admin_catalog_configuration_holes' then
      raise exception 'Verified proposal is sealed; changing published dependencies is outside Phase 1' using errcode = '55000';
    end if;
    new.revision := old.revision + 1;
  else
    new.created_by := actor; new.created_at := clock_timestamp(); new.revision := 1;
  end if;
  new.updated_by := actor; new.updated_at := clock_timestamp();
  if tg_table_name = 'admin_catalog_tee_overrides' then
    select c.* into cfg from public.admin_catalog_playable_configurations c where c.id = new.configuration_id;
    if (new.route_tee_id is not null and not exists (select 1 from public.route_tees t
      where t.id = new.route_tee_id and t.route_id = cfg.legacy_course_route_id))
      or (new.combination_tee_id is not null and not exists (select 1 from public.combination_tees t
      where t.id = new.combination_tee_id and t.route_combination_id = cfg.legacy_combination_id)) then
      raise exception 'Tee must belong to the explicitly identified configuration source' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create function public.admin_catalog_foundation_audit()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  insert into public.admin_catalog_foundation_events(entity_table,entity_id,revision,operation,before_snapshot,after_snapshot,actor_id)
    values(tg_table_name,new.id,new.revision,tg_op,case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
      to_jsonb(new),public.admin_catalog_require_admin());
  return new;
end;
$$;

-- Only NEW tables receive policies/triggers/grants. No existing API is replaced.
do $$
declare name text;
begin
  foreach name in array array['admin_catalog_physical_structures','admin_catalog_physical_holes',
    'admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_tee_overrides','admin_catalog_foundation_events'] loop
    execute format('alter table public.%I enable row level security',name);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
    execute format('grant select on public.%I to authenticated',name);
    execute format('create policy %I on public.%I for select to authenticated using
      (auth.uid() is not null and auth.role() = ''authenticated'' and public.is_admin())',name || '_admin_read',name);
    execute format('create trigger %I before delete on public.%I for each row execute function public.admin_catalog_foundation_no_removal()',name || '_no_delete',name);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.admin_catalog_foundation_no_removal()',name || '_no_truncate',name);
    if name = 'admin_catalog_foundation_events' then
      execute format('create trigger %I before update on public.%I for each row execute function public.admin_catalog_foundation_no_removal()',name || '_immutable',name);
    else
      execute format('create trigger %I before insert or update on public.%I for each row execute function public.admin_catalog_foundation_guard()',name || '_guard',name);
      execute format('create trigger %I after insert or update on public.%I for each row execute function public.admin_catalog_foundation_audit()',name || '_audit',name);
    end if;
  end loop;
end;
$$;

create function public.admin_catalog_foundation_create_structure(
  p_club_id uuid,p_label text,p_source_system text,p_source_reference text,p_reason text
)
returns public.admin_catalog_physical_structures language plpgsql security definer set search_path = pg_catalog as $$
declare result public.admin_catalog_physical_structures;
begin
  perform public.admin_catalog_require_admin();
  insert into public.admin_catalog_physical_structures(club_id,label,source_system,source_reference,reason)
    values(p_club_id,btrim(p_label),p_source_system,btrim(p_source_reference),btrim(p_reason)) returning * into result;
  return result;
end;
$$;

create function public.admin_catalog_foundation_review_structure(
  p_structure_id uuid,p_expected_revision bigint,p_classification text,
  p_source_system text,p_source_reference text,p_reason text,p_confirm_verified boolean default false
)
returns public.admin_catalog_physical_structures language plpgsql security definer set search_path = pg_catalog as $$
declare result public.admin_catalog_physical_structures;
begin
  perform public.admin_catalog_require_admin();
  if p_confirm_verified is null then raise exception 'Explicit review confirmation required' using errcode = '22023'; end if;
  select s.* into result from public.admin_catalog_physical_structures s where s.id = p_structure_id for update;
  if not found or p_expected_revision is null or result.revision <> p_expected_revision then
    raise exception 'Structure missing or revision changed' using errcode = '40001';
  end if;
  if p_confirm_verified and p_classification = 'non_classificato' then
    raise exception 'Unclassified structure cannot be verified' using errcode = '22023';
  end if;
  update public.admin_catalog_physical_structures set classification = p_classification,
    review_status = case when p_confirm_verified then 'verified' else 'needs_review' end,
    source_system = p_source_system,source_reference = btrim(p_source_reference),reason = btrim(p_reason)
    where id = p_structure_id returning * into result;
  return result;
end;
$$;

create function public.admin_catalog_foundation_create_physical_hole(
  p_structure_id uuid,p_physical_number integer,p_label text,p_base_par integer,
  p_source_system text,p_source_reference text,p_reason text,p_confirm_verified boolean default false
)
returns public.admin_catalog_physical_holes language plpgsql security definer set search_path = pg_catalog as $$
declare s public.admin_catalog_physical_structures; result public.admin_catalog_physical_holes;
begin
  perform public.admin_catalog_require_admin();
  select * into s from public.admin_catalog_physical_structures where id = p_structure_id for share;
  if not found or s.review_status <> 'verified' then
    raise exception 'Explicitly verified physical structure required' using errcode = '22023';
  end if;
  if p_confirm_verified is null or (s.classification = 'fisico_9' and p_physical_number > 9)
    or (s.classification = 'fisico_18' and p_physical_number > 18) then
    raise exception 'Physical number inconsistent with reviewed classification' using errcode = '22023';
  end if;
  insert into public.admin_catalog_physical_holes(structure_id,club_id,physical_number,label,base_par,
    review_status,source_system,source_reference,reason)
    values(s.id,s.club_id,p_physical_number,btrim(p_label),p_base_par,
      case when p_confirm_verified then 'verified' else 'needs_review' end,p_source_system,btrim(p_source_reference),btrim(p_reason))
    returning * into result;
  return result;
end;
$$;

create function public.admin_catalog_foundation_review_physical_hole(
  p_hole_id uuid,p_expected_revision bigint,p_base_par integer,
  p_source_system text,p_source_reference text,p_reason text,p_confirm_verified boolean default false
)
returns public.admin_catalog_physical_holes language plpgsql security definer set search_path = pg_catalog as $$
declare result public.admin_catalog_physical_holes;
begin
  perform public.admin_catalog_require_admin();
  select * into result from public.admin_catalog_physical_holes where id = p_hole_id for update;
  if not found or p_expected_revision is null or result.revision <> p_expected_revision then
    raise exception 'Physical hole missing or revision changed' using errcode = '40001';
  end if;
  if p_confirm_verified is null then raise exception 'Explicit confirmation required' using errcode = '22023'; end if;
  update public.admin_catalog_physical_holes set base_par = p_base_par,
    review_status = case when p_confirm_verified then 'verified' else 'needs_review' end,
    source_system = p_source_system,source_reference = btrim(p_source_reference),reason = btrim(p_reason)
    where id = p_hole_id returning * into result;
  return result;
end;
$$;

create function public.admin_catalog_foundation_create_configuration(
  p_club_id uuid,p_label text,p_holes_count integer,p_source_system text,p_source_reference text,p_reason text,
  p_legacy_course_route_id uuid default null,p_legacy_combination_id uuid default null
)
returns public.admin_catalog_playable_configurations language plpgsql security definer set search_path = pg_catalog as $$
declare result public.admin_catalog_playable_configurations;
begin
  perform public.admin_catalog_require_admin();
  if (p_legacy_course_route_id is not null and not exists(select 1 from public.course_routes r
      where r.id = p_legacy_course_route_id and r.club_id = p_club_id))
    or (p_legacy_combination_id is not null and not exists(select 1 from public.route_combinations c
      where c.id = p_legacy_combination_id and c.club_id = p_club_id)) then
    raise exception 'Legacy source must belong to the same club' using errcode = '22023';
  end if;
  insert into public.admin_catalog_playable_configurations(club_id,label,holes_count,legacy_course_route_id,
    legacy_combination_id,source_system,source_reference,reason)
    values(p_club_id,btrim(p_label),p_holes_count,p_legacy_course_route_id,p_legacy_combination_id,
      p_source_system,btrim(p_source_reference),btrim(p_reason)) returning * into result;
  return result;
end;
$$;

create function public.admin_catalog_foundation_review_configuration(
  p_configuration_id uuid,p_expected_revision bigint,p_structure_id uuid,p_relationship_kind text,
  p_parent_configuration_id uuid,p_derivation_rule text,p_source_system text,p_source_reference text,
  p_reason text,p_confirm_verified boolean default false
)
returns public.admin_catalog_playable_configurations language plpgsql security definer set search_path = pg_catalog as $$
declare result public.admin_catalog_playable_configurations; s public.admin_catalog_physical_structures;
  parent public.admin_catalog_playable_configurations; complete boolean;
begin
  perform public.admin_catalog_require_admin();
  select c.* into result from public.admin_catalog_playable_configurations c where c.id = p_configuration_id for update;
  if not found or p_expected_revision is null or result.revision <> p_expected_revision then
    raise exception 'Configuration missing or revision changed' using errcode = '40001';
  end if;
  if p_confirm_verified is null then raise exception 'Explicit confirmation required' using errcode = '22023'; end if;
  if p_structure_id is not null then
    select * into s from public.admin_catalog_physical_structures where id = p_structure_id for share;
    if not found or s.club_id <> result.club_id or s.review_status <> 'verified' then
      raise exception 'Verified structure in the same club required' using errcode = '22023';
    end if;
  end if;
  if p_relationship_kind = 'derived' then
    -- Only sealed verified parents are admissible. They cannot later point back
    -- to this proposal, so cycles cannot be introduced by concurrent reviews.
    select * into parent from public.admin_catalog_playable_configurations where id = p_parent_configuration_id for share;
    if not found or parent.id = result.id or parent.review_status <> 'verified'
      or parent.club_id <> result.club_id or parent.structure_id is distinct from p_structure_id then
      raise exception 'Verified parent in the same physical structure required' using errcode = '22023';
    end if;
  end if;
  if p_confirm_verified then
    select count(*) = result.holes_count and count(distinct h.stroke_index) = result.holes_count
      and coalesce(bool_and(h.review_status = 'verified' and h.physical_hole_id is not null
        and h.structure_id = p_structure_id and h.position between 1 and result.holes_count),false)
      into complete from public.admin_catalog_configuration_holes h where h.configuration_id = result.id;
    if p_structure_id is null or p_relationship_kind = 'unresolved' or complete is distinct from true then
      raise exception 'Complete verified physical mapping and configuration SI required' using errcode = '23514';
    end if;
    if exists(select 1 from public.admin_catalog_configuration_holes h where h.configuration_id = result.id
      group by h.physical_hole_id having min(h.occurrence) <> 1 or max(h.occurrence) <> count(*)) then
      raise exception 'Physical occurrences must be explicit and consecutive from one' using errcode = '23514';
    end if;
    if p_relationship_kind = 'derived' and exists(select 1 from public.admin_catalog_configuration_holes h
      where h.configuration_id = result.id and not exists(select 1 from public.admin_catalog_configuration_holes p
        where p.configuration_id = parent.id and p.physical_hole_id = h.physical_hole_id)) then
      raise exception 'Derived configuration must reuse verified parent physical identities' using errcode = '23514';
    end if;
  end if;
  update public.admin_catalog_playable_configurations set structure_id = p_structure_id,
    relationship_kind = p_relationship_kind,parent_configuration_id = p_parent_configuration_id,
    parent_configuration_revision = parent.revision,
    derivation_rule = p_derivation_rule,review_status = case when p_confirm_verified then 'verified' else 'needs_review' end,
    source_system = p_source_system,source_reference = btrim(p_source_reference),reason = btrim(p_reason)
    where id = p_configuration_id returning * into result;
  return result;
end;
$$;

create function public.admin_catalog_foundation_record_configuration_hole(
  p_configuration_id uuid,p_expected_revision bigint,p_position integer,p_occurrence integer,
  p_physical_hole_id uuid,p_par_mode text,p_par_override integer,p_stroke_index integer,
  p_source_system text,p_source_reference text,p_reason text,p_confirm_verified boolean default false,
  p_legacy_route_hole_id uuid default null,p_legacy_combination_hole_id uuid default null
)
returns public.admin_catalog_configuration_holes language plpgsql security definer set search_path = pg_catalog as $$
declare cfg public.admin_catalog_playable_configurations; h public.admin_catalog_physical_holes;
  result public.admin_catalog_configuration_holes;
begin
  perform public.admin_catalog_require_admin();
  select * into cfg from public.admin_catalog_playable_configurations where id = p_configuration_id for update;
  if not found or p_expected_revision is null or cfg.revision <> p_expected_revision then
    raise exception 'Configuration missing or revision changed' using errcode = '40001';
  end if;
  if cfg.review_status = 'verified' or p_confirm_verified is null or p_position > cfg.holes_count then
    raise exception 'Only pending configurations and valid positions are writable' using errcode = '22023';
  end if;
  if p_physical_hole_id is not null then
    if not p_confirm_verified then raise exception 'Physical link requires explicit verified confirmation' using errcode = '22023'; end if;
    select * into h from public.admin_catalog_physical_holes where id = p_physical_hole_id for share;
    if not found or h.review_status <> 'verified' or h.club_id <> cfg.club_id
      or cfg.structure_id is null or h.structure_id <> cfg.structure_id then
      raise exception 'Verified physical hole in the same reviewed structure required' using errcode = '22023';
    end if;
  elsif p_confirm_verified then
    raise exception 'Unresolved slot cannot be verified' using errcode = '22023';
  end if;
  if (p_legacy_route_hole_id is not null and not exists(select 1 from public.route_holes x
      join public.course_routes r on r.id = x.route_id where x.id = p_legacy_route_hole_id
      and r.club_id = cfg.club_id and r.id = cfg.legacy_course_route_id))
    or (p_legacy_combination_hole_id is not null and not exists(select 1 from public.route_combination_holes x
      where x.id = p_legacy_combination_hole_id and x.route_combination_id = cfg.legacy_combination_id)) then
    raise exception 'Legacy hole must belong to the explicit configuration source' using errcode = '22023';
  end if;
  insert into public.admin_catalog_configuration_holes(configuration_id,club_id,structure_id,physical_hole_id,
    position,occurrence,par_mode,par_override,stroke_index,review_status,legacy_route_hole_id,legacy_combination_hole_id,
    source_system,source_reference,reason)
    values(cfg.id,cfg.club_id,h.structure_id,h.id,p_position,p_occurrence,p_par_mode,p_par_override,p_stroke_index,
      case when p_confirm_verified then 'verified' else 'needs_review' end,p_legacy_route_hole_id,p_legacy_combination_hole_id,
      p_source_system,btrim(p_source_reference),btrim(p_reason))
    on conflict (configuration_id,position) do update set structure_id = excluded.structure_id,physical_hole_id = excluded.physical_hole_id,
      occurrence = excluded.occurrence,par_mode = excluded.par_mode,par_override = excluded.par_override,
      stroke_index = excluded.stroke_index,review_status = excluded.review_status,
      legacy_route_hole_id = excluded.legacy_route_hole_id,legacy_combination_hole_id = excluded.legacy_combination_hole_id,
      source_system = excluded.source_system,source_reference = excluded.source_reference,reason = excluded.reason
    returning * into result;
  -- The configuration revision covers ALL slot changes, including pending ones.
  update public.admin_catalog_playable_configurations set revision = revision + 1 where id = cfg.id;
  return result;
end;
$$;

-- Explicit signatures: no generic JSON updater, publication or tee override RPC.
revoke all on function public.admin_catalog_foundation_no_removal() from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_foundation_guard() from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_foundation_audit() from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_foundation_create_structure(uuid,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_foundation_review_structure(uuid,bigint,text,text,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_foundation_create_physical_hole(uuid,integer,text,integer,text,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_foundation_review_physical_hole(uuid,bigint,integer,text,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_foundation_create_configuration(uuid,text,integer,text,text,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_foundation_review_configuration(uuid,bigint,uuid,text,uuid,text,text,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_foundation_record_configuration_hole(uuid,bigint,integer,integer,uuid,text,integer,integer,text,text,text,boolean,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_catalog_foundation_create_structure(uuid,text,text,text,text) to authenticated;
grant execute on function public.admin_catalog_foundation_review_structure(uuid,bigint,text,text,text,text,boolean) to authenticated;
grant execute on function public.admin_catalog_foundation_create_physical_hole(uuid,integer,text,integer,text,text,text,boolean) to authenticated;
grant execute on function public.admin_catalog_foundation_review_physical_hole(uuid,bigint,integer,text,text,text,boolean) to authenticated;
grant execute on function public.admin_catalog_foundation_create_configuration(uuid,text,integer,text,text,text,uuid,uuid) to authenticated;
grant execute on function public.admin_catalog_foundation_review_configuration(uuid,bigint,uuid,text,uuid,text,text,text,text,boolean) to authenticated;
grant execute on function public.admin_catalog_foundation_record_configuration_hole(uuid,bigint,integer,integer,uuid,text,integer,integer,text,text,text,boolean,uuid,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
