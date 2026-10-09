-- Apply ONCE, after admin-catalog-structure-club-lock.sql (Phases 1–3c required).
-- Empty additive structures; no backfill, live DML or consumer activation.
begin;

do $$ begin
  if to_regprocedure('public.admin_catalog_structure_club_lock(uuid)') is null then
    raise exception 'Apply admin-catalog-structure-club-lock.sql first';
  end if;
end $$;

-- A source link is the namespace of a physical nine. Older unscoped identities
-- retain their old uniqueness; a guard prevents mixing scopes or weakening 9/18.
alter table public.admin_catalog_physical_holes
  drop constraint admin_catalog_physical_holes_structure_id_physical_number_key;
create unique index admin_catalog_physical_holes_unscoped_number_key
  on public.admin_catalog_physical_holes(structure_id,physical_number) where source_course_link_id is null;
create unique index admin_catalog_physical_holes_scoped_number_key
  on public.admin_catalog_physical_holes(source_course_link_id,physical_number) where source_course_link_id is not null;

alter table public.admin_catalog_playable_configurations
  drop constraint admin_catalog_playable_configurations_registration_kind_check,
  add constraint admin_catalog_playable_configurations_registration_kind_check check
    (registration_kind in ('autonomous_9','repeated_18','autonomous_18','front_9','back_9','multi9_9','multi9_18')),
  drop constraint admin_catalog_configuration_registration_complete,
  add constraint admin_catalog_configuration_registration_complete check (
    (num_nonnulls(physical_source_link_id,registration_kind,registration_snapshot) in (0,3)
      or (registration_kind='multi9_18' and physical_source_link_id is null and registration_snapshot is not null))
    and (registration_snapshot is null or jsonb_typeof(registration_snapshot)='object')),
  add constraint admin_catalog_multi9_scope check (registration_kind not in ('multi9_9','multi9_18') or
    (structure_id is not null and parent_configuration_id is null and parent_configuration_revision is null and
      ((registration_kind='multi9_9' and holes_count=9 and relationship_kind='autonomous' and
        legacy_course_route_id is not null and legacy_combination_id is null and physical_source_link_id is not null)
      or (registration_kind='multi9_18' and holes_count=18 and relationship_kind='derived' and
        legacy_course_route_id is null and legacy_combination_id is not null and physical_source_link_id is null
        and derivation_rule is not distinct from 'multi9_exact_components'))));

-- Replace only the single-parent CHECK, preserving its legacy branch exactly.
do $$ declare constraint_name text; begin
  select conname into strict constraint_name from pg_constraint
    where conrelid='public.admin_catalog_playable_configurations'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%relationship_kind%'
      and pg_get_constraintdef(oid) like '%btrim(derivation_rule)%';
  execute format('alter table public.admin_catalog_playable_configurations drop constraint %I',constraint_name);
end $$;
alter table public.admin_catalog_playable_configurations add constraint admin_catalog_configuration_parent_contract check (
  (relationship_kind='derived' and parent_configuration_id is not null and parent_configuration_revision is not null
    and nullif(btrim(derivation_rule),'') is not null)
  or (relationship_kind<>'derived' and parent_configuration_id is null and parent_configuration_revision is null and derivation_rule is null)
  or (registration_kind='multi9_18' and relationship_kind='derived' and parent_configuration_id is null
    and parent_configuration_revision is null and derivation_rule is not distinct from 'multi9_exact_components'));
create unique index admin_catalog_multi9_combination_key on public.admin_catalog_playable_configurations(legacy_combination_id)
  where registration_kind='multi9_18';

create table public.admin_catalog_configuration_components (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null,
  structure_id uuid not null,
  club_id uuid not null,
  component_position integer not null check(component_position in (1,2)),
  occurrence integer not null default 1 check(occurrence=1),
  physical_course_link_id uuid not null,
  physical_course_link_revision bigint not null check(physical_course_link_revision>0),
  parent_configuration_id uuid not null,
  parent_configuration_revision bigint not null check(parent_configuration_revision>0),
  review_status text not null default 'verified' check(review_status='verified'),
  reason text not null check(btrim(reason)<>''),
  revision bigint not null default 1 check(revision=1),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(configuration_id,component_position), unique(configuration_id,physical_course_link_id),
  foreign key(configuration_id,structure_id,club_id) references public.admin_catalog_playable_configurations(id,structure_id,club_id) on delete restrict,
  foreign key(parent_configuration_id,structure_id,club_id) references public.admin_catalog_playable_configurations(id,structure_id,club_id) on delete restrict,
  foreign key(physical_course_link_id,structure_id,club_id) references public.admin_catalog_physical_course_links(id,structure_id,club_id) on delete restrict,
  check(parent_configuration_id<>configuration_id)
);

-- Immutable approval receipt, including per-club exclusions. Preview has no row.
create table public.admin_catalog_multi9_batches (
  id uuid primary key default gen_random_uuid(),
  expected_preview jsonb not null check(jsonb_typeof(expected_preview)='array'),
  result jsonb not null check(jsonb_typeof(result)='object'),
  reason text not null check(btrim(reason)<>''),
  review_status text not null default 'verified' check(review_status='verified'),
  revision bigint not null default 1 check(revision=1),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.admin_catalog_foundation_events drop constraint admin_catalog_foundation_events_entity_table_check;
alter table public.admin_catalog_foundation_events add constraint admin_catalog_foundation_events_entity_table_check check(entity_table in
  ('admin_catalog_physical_structures','admin_catalog_physical_holes','admin_catalog_playable_configurations',
   'admin_catalog_configuration_holes','admin_catalog_tee_overrides','admin_catalog_physical_course_links',
   'admin_catalog_configuration_components','admin_catalog_multi9_batches'));
do $$ declare n text; begin
  foreach n in array array['admin_catalog_configuration_components','admin_catalog_multi9_batches'] loop
    execute format('alter table public.%I enable row level security',n);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
    execute format('grant select on public.%I to authenticated',n);
    execute format('create policy %I on public.%I for select to authenticated using(auth.uid() is not null and auth.role()=''authenticated'' and public.is_admin())',n||'_admin_read',n);
    execute format('create trigger %I before insert on public.%I for each row execute function public.admin_catalog_foundation_guard()',n||'_guard',n);
    execute format('create trigger %I after insert on public.%I for each row execute function public.admin_catalog_foundation_audit()',n||'_audit',n);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.admin_catalog_foundation_no_removal()',n||'_immutable',n);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.admin_catalog_foundation_no_removal()',n||'_no_truncate',n);
  end loop;
end $$;

create function public.admin_catalog_multi9_identity_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare s public.admin_catalog_physical_structures; l public.admin_catalog_physical_course_links;
begin
  perform public.admin_catalog_require_admin();
  select * into s from public.admin_catalog_physical_structures where id=new.structure_id for update nowait;
  if new.source_course_link_id is not null then
    select * into l from public.admin_catalog_physical_course_links where id=new.source_course_link_id;
    if not found or l.structure_id<>s.id or l.club_id<>new.club_id then raise exception 'Invalid physical namespace' using errcode='23514'; end if;
    -- Keep Phase 3a's explicit 10..18 sources usable: no renumbering or offset.
    -- The new batch itself only accepts sources numbered 1..9.
    if s.classification='multi_9' and (l.holes_count<>9 or not exists(select 1 from public.route_holes r
      where r.id=new.source_route_hole_id and r.route_id=l.course_id and r.physical_hole_number=new.physical_number)) then
      raise exception 'Exact multi-nine source numbering required' using errcode='23514'; end if;
  end if;
  if exists(select 1 from public.admin_catalog_physical_holes h where h.structure_id=new.structure_id and h.id<>new.id
    and ((h.source_course_link_id is null)<>(new.source_course_link_id is null)
      or (s.classification<>'multi_9' and h.physical_number=new.physical_number)
      or (s.classification<>'multi_9' and h.source_course_link_id is distinct from new.source_course_link_id))) then
    raise exception 'Ambiguous scope or incompatible physical source' using errcode='23514'; end if;
  return new;
end $$;
create trigger admin_catalog_multi9_identity_guard before insert or update on public.admin_catalog_physical_holes
  for each row execute function public.admin_catalog_multi9_identity_guard();

-- Read-only deterministic candidate. A manually VERIFIED multi_9 structure is
-- mandatory. Only exact FK origins of official active combinations are used.
create function public.admin_catalog_multi9_inspect(p_structure_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare s public.admin_catalog_physical_structures; club public.clubs; c record; b record; rh record; l record;
  courses jsonb:='[]'; combinations jsonb:='[]'; excluded jsonb:='[]'; reasons text[]:='{}'; why text[];
  source jsonb; seq jsonb; valid boolean; baseline jsonb; n integer; origin_ids uuid[];
begin
  perform public.admin_catalog_require_admin();
  select * into s from public.admin_catalog_physical_structures where id=p_structure_id;
  if not found then raise exception 'Existing structure required' using errcode='22023'; end if;
  select * into club from public.clubs where id=s.club_id;
  if s.classification<>'multi_9' or s.review_status<>'verified' then reasons:=array_append(reasons,'verified_multi9_required'); end if;
  if not club.is_active then reasons:=array_append(reasons,'inactive_club'); end if;
  if (select count(*) from public.admin_catalog_physical_structures where club_id=s.club_id and classification='multi_9' and review_status='verified')<>1
    then reasons:=array_append(reasons,'ambiguous_structure'); end if;
  select array_agg(distinct origin) into origin_ids from public.route_combinations rc
    cross join lateral (values(rc.front_route_id),(rc.back_route_id)) origins(origin) where rc.club_id=s.club_id and rc.is_active;
  if coalesce(cardinality(origin_ids),0)<2 then reasons:=array_append(reasons,'official_components_required'); end if;
  if exists(select 1 from public.admin_catalog_physical_holes where structure_id=s.id and source_course_link_id is null)
    then reasons:=array_append(reasons,'unscoped_physical_holes'); end if;
  for c in select * from public.course_routes where id=any(origin_ids) order by id loop
    why:='{}'; source:=public.admin_catalog_physical_course_source(c.id);
    if c.club_id<>s.club_id or not c.is_active or c.holes_count<>9 then why:=array_append(why,'active_nine_source_required'); end if;
    if c.source_payload->'gesgolf'->'derived_segment' is not null or coalesce(c.source_payload,'{}') ? 'physical_hole_sequence'
      or c.source_payload->>'family'='repeat' or c.source_payload->>'product_simplification'='physical_9_official_18_variant'
      or (c.source_payload->>'physical_hole_count' in ('9','18') and c.source_payload->>'physical_hole_count'<>'9') then why:=array_append(why,'derived_source'); end if;
    select count(*)=9 and count(distinct physical_hole_number)=9 and min(physical_hole_number)=1 and max(physical_hole_number)=9
      and count(distinct stroke_index)=9 and bool_and(stroke_index between 1 and 18 and par between 3 and 6)
      and sum(par)=c.total_par into valid from public.route_holes where route_id=c.id;
    if valid is distinct from true then why:=array_append(why,'invalid_nine_grid'); end if;
    select * into l from public.admin_catalog_physical_course_links where course_id=c.id;
    if l.id is not null and (l.structure_id<>s.id or l.review_status<>'verified' or l.holes_count<>9
      or l.source_snapshot is distinct from source) then why:=array_append(why,'physical_link_unusable'); end if;
    if exists(select 1 from public.admin_catalog_physical_holes h join public.route_holes r on r.id=h.source_route_hole_id
      where r.route_id=c.id and (h.structure_id<>s.id or h.source_course_link_id is distinct from l.id)) then why:=array_append(why,'physical_collision'); end if;
    if l.id is not null then
      select count(*)=9 and count(r.id)=9 and count(distinct h.source_route_hole_id)=9 and bool_and(h.review_status='verified'
        and h.base_par=r.par and h.physical_number=r.physical_hole_number and h.source_position=r.physical_hole_number
        and h.club_id=s.club_id and h.structure_id=s.id) into valid
        from public.admin_catalog_physical_holes h left join public.route_holes r on r.id=h.source_route_hole_id and r.route_id=c.id
        where h.source_course_link_id=l.id;
      if valid is distinct from true then why:=array_append(why,'physical_mapping_changed'); end if;
    end if;
    if cardinality(why)>0 then reasons:=array_append(reasons,'invalid_component'); end if;
    courses:=courses||jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name,'source',source,'reasons',to_jsonb(why),
      'link',case when l.id is null then null else to_jsonb(l) end,'holes_count',9,'total_par',c.total_par));
  end loop;
  for c in select * from public.course_routes where club_id=s.club_id and is_active and not(id=any(coalesce(origin_ids,'{}'))) order by id loop
    excluded:=excluded||jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name,'reason',case when c.holes_count=18 then 'repeated_or_other_18_out_of_scope' else 'no_exact_official_component_reference' end));
  end loop;
  for b in select * from public.route_combinations where club_id=s.club_id and is_active order by id loop
    why:='{}';
    select count(*)=18 and count(distinct round_hole_number)=18 and min(round_hole_number)=1 and max(round_hole_number)=18
      and count(distinct stroke_index)=18 and bool_and(stroke_index between 1 and 18 and par between 3 and 6)
      and sum(par)=b.total_par into valid from public.route_combination_holes where route_combination_id=b.id;
    if valid is distinct from true or b.holes_count<>18 or b.front_route_id=b.back_route_id then why:=array_append(why,'invalid_combination_grid'); end if;
    -- Exact references only. round_hole_number supplies playing order, NEVER
    -- the identity of the physical hole. No offsets, labels or Par matching.
    for rh in select * from public.route_combination_holes where route_combination_id=b.id order by round_hole_number loop
      select count(*) into n from public.route_holes where route_id=rh.route_id and physical_hole_number=rh.physical_hole_number;
      if n<>1 then why:=array_append(why,'non_unique_exact_reference'); end if;
      if rh.route_id is distinct from (case rh.route_position when 1 then b.front_route_id else b.back_route_id end)
        or rh.route_position is distinct from (case when rh.round_hole_number<=9 then 1 else 2 end) then why:=array_append(why,'component_order_mismatch'); end if;
      if n=1 and rh.par is distinct from (select par from public.route_holes where route_id=rh.route_id and physical_hole_number=rh.physical_hole_number)
        then why:=array_append(why,'explicit_par_override_required'); end if;
    end loop;
    if exists(select 1 from public.route_combination_holes where route_combination_id=b.id
      group by route_id,physical_hole_number having count(*)<>1) then why:=array_append(why,'duplicate_physical_reference'); end if;
    select coalesce(jsonb_agg(jsonb_build_object('position',h.round_hole_number,'component_position',h.route_position,
      'course_id',h.route_id,'course_name',r.name,'physical_number',h.physical_hole_number,'occurrence',1,
      'source_hole_id',(select (array_agg(id))[1] from public.route_holes where route_id=h.route_id and physical_hole_number=h.physical_hole_number having count(*)=1),
      'legacy_combination_hole_id',h.id,'effective_par',h.par,'stroke_index',h.stroke_index,'par_mode','inherited') order by h.round_hole_number),'[]')
      into seq from public.route_combination_holes h left join public.course_routes r on r.id=h.route_id where h.route_combination_id=b.id;
    if cardinality(why)>0 then reasons:=array_append(reasons,'invalid_combination'); end if;
    combinations:=combinations||jsonb_build_array(jsonb_build_object('id',b.id,'name',b.name,'source',to_jsonb(b),
      'holes',(select coalesce(jsonb_agg(to_jsonb(h) order by h.round_hole_number,h.id),'[]') from public.route_combination_holes h where route_combination_id=b.id),
      'sequence',seq,'total_par',b.total_par,'reasons',to_jsonb(why)));
  end loop;
  if exists(select 1 from public.admin_catalog_playable_configurations where club_id=s.club_id and
    (legacy_course_route_id=any(origin_ids) or legacy_combination_id in(select id from public.route_combinations where club_id=s.club_id and is_active)))
    then reasons:=array_append(reasons,'configuration_already_registered'); end if;
  if exists(select 1 from public.admin_catalog_physical_course_links where structure_id=s.id and not(course_id=any(coalesce(origin_ids,'{}'))))
    then reasons:=array_append(reasons,'uncovered_physical_source'); end if;
  baseline:=jsonb_build_object('contract',1,'structure',to_jsonb(s),'club',to_jsonb(club),'courses',courses,'combinations',combinations,
    'physical_holes',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]') from public.admin_catalog_physical_holes h where structure_id=s.id),
    'configurations',(select coalesce(jsonb_agg(to_jsonb(pcfg) order by pcfg.id),'[]') from public.admin_catalog_playable_configurations pcfg where club_id=s.club_id),
    'slots',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]') from public.admin_catalog_configuration_holes h where club_id=s.club_id));
  return jsonb_build_object('structure_id',s.id,'structure_label',s.label,'club_id',club.id,'club_name',club.name,
    'baseline',baseline,'courses',courses,'combinations',combinations,'excluded',excluded,'reasons',to_jsonb(reasons),
    'can_register',cardinality(reasons)=0,'configuration_count',jsonb_array_length(courses)+jsonb_array_length(combinations),
    'physical_hole_count',9*jsonb_array_length(courses),
    'new_physical_hole_count',(select 9*count(*) from jsonb_array_elements(courses) x where x->'link'='null'::jsonb),
    'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id),'[]')
      from public.admin_catalog_foundation_events e where e.after_snapshot->>'club_id'=s.club_id::text));
end $$;

create function public.admin_catalog_multi9_preview(p_structure_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin perform public.admin_catalog_require_admin(); return public.admin_catalog_multi9_inspect(p_structure_id); end $$;

create function public.admin_catalog_multi9_batch_preview(p_structure_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare s record; c jsonb; candidates jsonb:='[]'; excluded jsonb:='[]'; missing uuid;
begin
  perform public.admin_catalog_require_admin();
  if p_structure_ids is not null and (cardinality(p_structure_ids)=0 or cardinality(p_structure_ids)>50) then
    raise exception 'Select 1..50 structures' using errcode='22023'; end if;
  for s in select id from public.admin_catalog_physical_structures
    where (p_structure_ids is null and classification='multi_9') or id=any(p_structure_ids) order by id limit 51 loop
    c:=public.admin_catalog_multi9_inspect(s.id);
    if (c->>'can_register')::boolean then candidates:=candidates||jsonb_build_array(c);
    else excluded:=excluded||jsonb_build_array(c); end if;
  end loop;
  if p_structure_ids is not null then
    for missing in select distinct x from unnest(p_structure_ids) x where not exists(select 1 from public.admin_catalog_physical_structures where id=x) loop
      excluded:=excluded||jsonb_build_array(jsonb_build_object('structure_id',missing,'club_name','Struttura non disponibile','reasons',jsonb_build_array('unknown_structure')));
    end loop;
  end if;
  if jsonb_array_length(candidates)+jsonb_array_length(excluded)>50 then raise exception 'Select at most 50 structures' using errcode='22023'; end if;
  return jsonb_build_object('candidates',candidates,'excluded',excluded,'club_count',jsonb_array_length(candidates),
    'configuration_count',(select coalesce(sum((x->>'configuration_count')::integer),0) from jsonb_array_elements(candidates) x));
end $$;

create function public.admin_catalog_multi9_lock(p_structure_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare target_club_id uuid;
begin
  perform public.admin_catalog_require_admin();
  select club_id into target_club_id from public.admin_catalog_physical_structures where id=p_structure_id;
  if not found then raise exception 'Existing structure required' using errcode='22023'; end if;
  -- Same club-wide lock used by BOTH structure creation and classification.
  -- Acquired before inspecting/counting structures; held until transaction end.
  perform public.admin_catalog_structure_club_lock(target_club_id);
  lock table public.course_routes,public.route_holes,public.route_combinations,public.route_combination_holes in share mode nowait;
  lock table public.admin_catalog_physical_holes,public.admin_catalog_physical_course_links,
    public.admin_catalog_playable_configurations,public.admin_catalog_configuration_holes,
    public.admin_catalog_configuration_components in share row exclusive mode nowait;
  perform id from public.admin_catalog_physical_structures where id=p_structure_id for update nowait;
  perform c.id from public.clubs c join public.admin_catalog_physical_structures s on s.club_id=c.id where s.id=p_structure_id for share of c nowait;
end $$;

-- Guard new registered rows without changing old 3b/3c snapshot shapes.
-- Preserve the existing function identity and its legacy dispatch.
drop trigger admin_catalog_playable_phase3b_guard on public.admin_catalog_playable_configurations;

create function public.admin_catalog_multi9_registered_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare cfg public.admin_catalog_playable_configurations; h public.admin_catalog_physical_holes; r record;
begin
  perform public.admin_catalog_require_admin();
  if tg_table_name='admin_catalog_playable_configurations' then
    if tg_op='UPDATE' then
      if old.registration_kind in ('multi9_9','multi9_18') or new.registration_kind in ('multi9_9','multi9_18') then
        if old.review_status<>'needs_review' or new.review_status<>'verified' or
          (to_jsonb(new)-array['review_status','reason','revision','updated_by','updated_at']) is distinct from
          (to_jsonb(old)-array['review_status','reason','revision','updated_by','updated_at']) then raise exception 'Multi9 registration is sealed' using errcode='55000'; end if;
      end if;
    end if;
    return new;
  end if;
  select * into cfg from public.admin_catalog_playable_configurations where id=new.configuration_id;
  if tg_op='UPDATE' then
    if cfg.registration_kind in ('multi9_9','multi9_18') or exists(select 1 from public.admin_catalog_playable_configurations c where c.id=old.configuration_id and c.registration_kind in ('multi9_9','multi9_18')) then
      raise exception 'Multi9 slots are immutable' using errcode='55000'; end if;
    return new;
  end if;
  if cfg.registration_kind not in ('multi9_9','multi9_18') or cfg.registration_kind is null then return new; end if;
  select * into h from public.admin_catalog_physical_holes where id=new.physical_hole_id;
  if h.review_status is distinct from 'verified' or cfg.review_status<>'needs_review' or new.par_mode<>'inherited'
    or new.par_override is not null or new.occurrence<>1 or new.review_status<>'verified' then raise exception 'Invalid multi9 physical inheritance' using errcode='23514'; end if;
  if cfg.registration_kind='multi9_9' then
    select * into r from public.route_holes where id=new.legacy_route_hole_id and route_id=cfg.legacy_course_route_id;
    if not found or new.legacy_combination_hole_id is not null or h.source_route_hole_id is distinct from r.id
      or h.source_course_link_id is distinct from cfg.physical_source_link_id or new.position is distinct from r.physical_hole_number
      or new.stroke_index is distinct from r.stroke_index then raise exception 'Exact nine reference required' using errcode='23514'; end if;
  else
    select * into r from public.route_combination_holes where id=new.legacy_combination_hole_id and route_combination_id=cfg.legacy_combination_id;
    if not found or new.legacy_route_hole_id is not null or new.position is distinct from r.round_hole_number
      or new.stroke_index is distinct from r.stroke_index or h.source_route_hole_id is distinct from
        (select id from public.route_holes where route_id=r.route_id and physical_hole_number=r.physical_hole_number)
      or not exists(select 1 from public.admin_catalog_configuration_components cp where cp.configuration_id=cfg.id
        and cp.component_position=r.route_position and cp.physical_course_link_id=h.source_course_link_id) then
      raise exception 'Exact official combination reference required' using errcode='23514'; end if;
  end if;
  if h.base_par is distinct from r.par then raise exception 'Explicit Par override needed; outside batch' using errcode='23514'; end if;
  return new;
end $$;
-- WHEN keeps the legacy trigger code AND execution semantics unchanged.
create trigger admin_catalog_playable_phase3b_guard before update on public.admin_catalog_playable_configurations
  for each row when (old.registration_kind is distinct from 'multi9_9' and old.registration_kind is distinct from 'multi9_18'
    and new.registration_kind is distinct from 'multi9_9' and new.registration_kind is distinct from 'multi9_18')
  execute function public.admin_catalog_playable_guard();
-- A trigger WHEN cannot look up a parent. Retain the previous implementation
-- with one explicit early branch; registered multi9 slots have their own guard.
do $$ declare body text; begin
  select pg_get_functiondef('public.admin_catalog_playable_guard()'::regprocedure) into body;
  body:=replace(body,'phase3c:=cfg.registration_kind in',
    'if cfg.registration_kind in (''multi9_9'',''multi9_18'') then return new; end if; phase3c:=cfg.registration_kind in');
  if body not like '%then return new; end if; phase3c:=%' then raise exception 'Unsupported legacy guard; migration rolled back'; end if;
  execute body;
end $$;
create trigger admin_catalog_multi9_registered_guard before insert or update on public.admin_catalog_configuration_holes
  for each row execute function public.admin_catalog_multi9_registered_guard();
create trigger admin_catalog_multi9_configuration_guard before update on public.admin_catalog_playable_configurations
  for each row execute function public.admin_catalog_multi9_registered_guard();

create function public.admin_catalog_multi9_complete(p_configuration_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare c public.admin_catalog_playable_configurations; valid boolean; total integer; source jsonb;
begin
  perform public.admin_catalog_require_admin();
  select * into c from public.admin_catalog_playable_configurations where id=p_configuration_id;
  if c.registration_kind not in ('multi9_9','multi9_18') or c.id is null then raise exception 'Multi9 configuration required' using errcode='23514'; end if;
  select count(*)=c.holes_count and count(distinct position)=c.holes_count and min(position)=1 and max(position)=c.holes_count
    and count(distinct h.stroke_index)=c.holes_count and bool_and(h.review_status='verified' and h.par_mode='inherited'
      and h.par_override is null and h.stroke_index between 1 and 18 and p.review_status='verified'),sum(p.base_par) into valid,total
    from public.admin_catalog_configuration_holes h join public.admin_catalog_physical_holes p on p.id=h.physical_hole_id where h.configuration_id=c.id;
  if valid is distinct from true then raise exception 'Incomplete multi9 configuration' using errcode='23514'; end if;
  if c.registration_kind='multi9_18' and (select count(*) from public.admin_catalog_configuration_components where configuration_id=c.id)<>2 then
    raise exception 'Two verified components required' using errcode='23514'; end if;
  if c.registration_kind='multi9_9' then
    source:=public.admin_catalog_physical_course_source(c.legacy_course_route_id);
    if c.registration_snapshot->'source' is distinct from source or total is distinct from (source->'course'->>'total_par')::integer
      then raise exception 'Nine source changed' using errcode='40001'; end if;
  else
    select to_jsonb(b) into source from public.route_combinations b where id=c.legacy_combination_id;
    if c.registration_snapshot->'source' is distinct from source or total is distinct from (source->>'total_par')::integer
      or c.registration_snapshot->'holes' is distinct from (select coalesce(jsonb_agg(to_jsonb(h) order by h.round_hole_number,h.id),'[]')
        from public.route_combination_holes h where route_combination_id=c.legacy_combination_id)
      or exists(select 1 from public.admin_catalog_configuration_components cp
        join public.admin_catalog_physical_course_links l on l.id=cp.physical_course_link_id
        join public.admin_catalog_playable_configurations p on p.id=cp.parent_configuration_id
        where cp.configuration_id=c.id and (l.review_status<>'verified' or p.review_status<>'verified'
          or l.revision<>cp.physical_course_link_revision or p.revision<>cp.parent_configuration_revision)) then
      raise exception 'Official source or verified parent changed' using errcode='40001'; end if;
  end if;
end $$;

create function public.admin_catalog_multi9_component_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare c public.admin_catalog_playable_configurations; p public.admin_catalog_playable_configurations;
  l public.admin_catalog_physical_course_links; b public.route_combinations;
begin
  perform public.admin_catalog_require_admin();
  select * into c from public.admin_catalog_playable_configurations where id=new.configuration_id;
  select * into p from public.admin_catalog_playable_configurations where id=new.parent_configuration_id;
  select * into l from public.admin_catalog_physical_course_links where id=new.physical_course_link_id;
  select * into b from public.route_combinations where id=c.legacy_combination_id;
  if c.registration_kind is distinct from 'multi9_18' or c.review_status<>'needs_review'
    or p.registration_kind is distinct from 'multi9_9' or p.review_status<>'verified' or l.review_status<>'verified'
    or new.parent_configuration_revision is distinct from p.revision or new.physical_course_link_revision is distinct from l.revision
    or p.physical_source_link_id is distinct from l.id or p.legacy_course_route_id is distinct from l.course_id
    or l.course_id is distinct from (case new.component_position when 1 then b.front_route_id else b.back_route_id end) then
    raise exception 'Exact verified component and revisions required' using errcode='23514'; end if;
  return new;
end $$;
create trigger admin_catalog_multi9_component_guard before insert on public.admin_catalog_configuration_components
  for each row execute function public.admin_catalog_multi9_component_guard();

create function public.admin_catalog_multi9_verify_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform public.admin_catalog_require_admin();
  if new.registration_kind in ('multi9_9','multi9_18') and new.review_status='verified' then perform public.admin_catalog_multi9_complete(new.id); end if;
  return new;
end $$;
create trigger admin_catalog_multi9_verify_guard before update on public.admin_catalog_playable_configurations
  for each row execute function public.admin_catalog_multi9_verify_guard();

-- Private per-club transaction body. Called inside a PL/pgSQL subtransaction by
-- the batch endpoint: any failure rolls back this club and its audit in full.
create function public.admin_catalog_multi9_apply(p_structure_id uuid,p_expected_baseline jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare ctx jsonb; s public.admin_catalog_physical_structures; c jsonb; b jsonb; x jsonb; r record;
  l public.admin_catalog_physical_course_links; cfg public.admin_catalog_playable_configurations; parent public.admin_catalog_playable_configurations;
  ph public.admin_catalog_physical_holes; ids jsonb:='[]';
begin
  perform public.admin_catalog_require_admin();
  perform public.admin_catalog_multi9_lock(p_structure_id);
  ctx:=public.admin_catalog_multi9_inspect(p_structure_id);
  if p_expected_baseline is null or ctx->'baseline' is distinct from p_expected_baseline then raise exception 'Club baseline changed' using errcode='40001'; end if;
  if (ctx->>'can_register')::boolean is distinct from true then raise exception 'Incompatible multi9 club: %',ctx->'reasons' using errcode='23514'; end if;
  select * into s from public.admin_catalog_physical_structures where id=p_structure_id;
  for c in select value from jsonb_array_elements(ctx->'courses') loop
    select * into l from public.admin_catalog_physical_course_links where course_id=(c->>'id')::uuid;
    if l.id is null then
      insert into public.admin_catalog_physical_course_links(structure_id,club_id,course_id,holes_count,source_snapshot,source_reference,reason)
        values(s.id,s.club_id,(c->>'id')::uuid,9,c->'source','course_routes:'||(c->>'id'),p_reason) returning * into l;
      for r in select * from public.route_holes where route_id=l.course_id order by physical_hole_number loop
        insert into public.admin_catalog_physical_holes(structure_id,club_id,physical_number,label,base_par,review_status,
          source_system,source_reference,reason,source_course_link_id,source_route_hole_id,source_position)
          values(s.id,s.club_id,r.physical_hole_number,'Buca '||r.physical_hole_number,r.par,'verified','stablr',
            'route_holes:'||r.id,p_reason,l.id,r.id,r.physical_hole_number);
      end loop;
      update public.admin_catalog_physical_course_links set review_status='verified',reason=p_reason where id=l.id returning * into l;
    end if;
    insert into public.admin_catalog_playable_configurations(club_id,label,holes_count,structure_id,relationship_kind,
      legacy_course_route_id,source_system,source_reference,reason,physical_source_link_id,registration_kind,registration_snapshot)
      values(s.club_id,left(c->>'name',150)||' · 9 autonoma',9,s.id,'autonomous',(c->>'id')::uuid,'stablr',
        'course_routes:'||(c->>'id'),p_reason,l.id,'multi9_9',jsonb_build_object('contract',1,'source',c->'source','physical_link',to_jsonb(l))) returning * into cfg;
    for r in select rh.*,h.id physical_id from public.route_holes rh join public.admin_catalog_physical_holes h on h.source_route_hole_id=rh.id and h.source_course_link_id=l.id where rh.route_id=l.course_id order by rh.physical_hole_number loop
      insert into public.admin_catalog_configuration_holes(configuration_id,club_id,structure_id,physical_hole_id,position,occurrence,
        par_mode,stroke_index,review_status,legacy_route_hole_id,source_system,source_reference,reason)
        values(cfg.id,s.club_id,s.id,r.physical_id,r.physical_hole_number,1,'inherited',r.stroke_index,'verified',r.id,'stablr','route_holes:'||r.id,p_reason);
    end loop;
    update public.admin_catalog_playable_configurations set review_status='verified',reason=p_reason where id=cfg.id returning * into cfg;
    ids:=ids||jsonb_build_array(jsonb_build_object('id',cfg.id,'label',cfg.label));
  end loop;
  for b in select value from jsonb_array_elements(ctx->'combinations') loop
    insert into public.admin_catalog_playable_configurations(club_id,label,holes_count,structure_id,relationship_kind,derivation_rule,
      legacy_combination_id,source_system,source_reference,reason,registration_kind,registration_snapshot)
      values(s.club_id,left(b->>'name',150)||' · 18 ufficiale',18,s.id,'derived','multi9_exact_components',(b->>'id')::uuid,
        'stablr','route_combinations:'||(b->>'id'),p_reason,'multi9_18',jsonb_build_object('contract',1,'source',b->'source','holes',b->'holes')) returning * into cfg;
    for r in select * from (values(1,(b->'source'->>'front_route_id')::uuid),(2,(b->'source'->>'back_route_id')::uuid)) origins(pos,course_id) loop
      select * into l from public.admin_catalog_physical_course_links where course_id=r.course_id and structure_id=s.id and review_status='verified';
      select * into parent from public.admin_catalog_playable_configurations where physical_source_link_id=l.id and registration_kind='multi9_9' and review_status='verified';
      if parent.id is null then raise exception 'Verified nine parent required' using errcode='23514'; end if;
      insert into public.admin_catalog_configuration_components(configuration_id,structure_id,club_id,component_position,
        physical_course_link_id,physical_course_link_revision,parent_configuration_id,parent_configuration_revision,reason)
        values(cfg.id,s.id,s.club_id,r.pos,l.id,l.revision,parent.id,parent.revision,p_reason);
    end loop;
    for x in select value from jsonb_array_elements(b->'sequence') loop
      select * into ph from public.admin_catalog_physical_holes where source_route_hole_id=(x->>'source_hole_id')::uuid and structure_id=s.id;
      insert into public.admin_catalog_configuration_holes(configuration_id,club_id,structure_id,physical_hole_id,position,occurrence,
        par_mode,stroke_index,review_status,legacy_combination_hole_id,source_system,source_reference,reason)
        values(cfg.id,s.club_id,s.id,ph.id,(x->>'position')::integer,1,'inherited',(x->>'stroke_index')::integer,'verified',
          (x->>'legacy_combination_hole_id')::uuid,'stablr','route_combination_holes:'||(x->>'legacy_combination_hole_id'),p_reason);
    end loop;
    update public.admin_catalog_playable_configurations set review_status='verified',reason=p_reason where id=cfg.id returning * into cfg;
    ids:=ids||jsonb_build_array(jsonb_build_object('id',cfg.id,'label',cfg.label));
  end loop;
  return jsonb_build_object('structure_id',s.id,'club_id',s.club_id,'club_name',ctx->>'club_name','configurations',ids,
    'physical_hole_count',ctx->'physical_hole_count','status','verified');
end $$;

create function public.admin_catalog_multi9_batch_register(p_candidates jsonb,p_reason text,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare candidate jsonb; current_ctx jsonb; registered jsonb:='[]'; excluded jsonb:='[]'; result jsonb; receipt uuid; sid uuid; seen uuid[]:='{}'; code text;
begin
  perform public.admin_catalog_require_admin();
  if p_confirm is distinct from true or nullif(btrim(p_reason),'') is null or jsonb_typeof(p_candidates) is distinct from 'array'
    or jsonb_array_length(p_candidates) not between 1 and 50 then raise exception 'Confirmation, note and 1..50 candidates required' using errcode='22023'; end if;
  for candidate in select value from jsonb_array_elements(p_candidates) loop
    -- Subtransaction includes locks, all foundation rows and all audit events.
    begin
      sid:=(candidate->>'structure_id')::uuid;
      if sid is null or sid=any(seen) then raise exception 'Invalid or duplicate structure' using errcode='22023'; end if;
      seen:=array_append(seen,sid);
      current_ctx:=public.admin_catalog_multi9_apply(sid,candidate->'baseline',btrim(p_reason));
      registered:=registered||jsonb_build_array(current_ctx);
    exception when others then
      get stacked diagnostics code=returned_sqlstate;
      excluded:=excluded||jsonb_build_array(jsonb_build_object('structure_id',candidate->>'structure_id',
        'club_name',candidate->>'club_name','code',code,'reason',case code when '40001' then 'source_or_revision_changed'
          when '55P03' then 'source_busy' when '23505' then 'collision' when '22023' then 'invalid_candidate' else 'club_validation_failed' end));
    end;
  end loop;
  result:=jsonb_build_object('registered',registered,'excluded',excluded);
  insert into public.admin_catalog_multi9_batches(expected_preview,result,reason) values(p_candidates,result,btrim(p_reason)) returning id into receipt;
  return result||jsonb_build_object('batch_id',receipt);
end $$;

-- Inspectors/helpers are private; only three read/approval endpoints are granted.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'admin_catalog_multi9_%' or p.proname='admin_catalog_playable_guard') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
grant execute on function public.admin_catalog_multi9_preview(uuid) to authenticated;
grant execute on function public.admin_catalog_multi9_batch_preview(uuid[]) to authenticated;
grant execute on function public.admin_catalog_multi9_batch_register(jsonb,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
