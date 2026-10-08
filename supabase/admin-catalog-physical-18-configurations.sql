-- Phase 3c. Apply ONCE after admin-catalog-playable-configurations.sql.
-- Foundation only: no backfill, catalog DML, tee writes or consumer changes.
begin;

alter table public.admin_catalog_playable_configurations
  drop constraint admin_catalog_playable_configurations_registration_kind_check,
  add constraint admin_catalog_playable_configurations_registration_kind_check
    check (registration_kind in ('autonomous_9','repeated_18','autonomous_18','front_9','back_9')),
  add constraint admin_catalog_configuration_physical18_scope check (
    registration_kind not in ('autonomous_18','front_9','back_9') or
    (legacy_course_route_id is not null and legacy_combination_id is null and
      holes_count=case registration_kind when 'autonomous_18' then 18 else 9 end and
      relationship_kind=case registration_kind when 'autonomous_18' then 'autonomous' else 'derived' end));

create function public.admin_catalog_physical18_inspect(p_structure_id uuid,p_link_id uuid,p_kind text,
  p_course_id uuid,p_par_selection text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare s public.admin_catalog_physical_structures; l public.admin_catalog_physical_course_links;
  c public.course_routes; cfg public.admin_catalog_playable_configurations; parent public.admin_catalog_playable_configurations;
  physical jsonb; source jsonb; baseline jsonb; sequence jsonb:='[]'; saved jsonb:='[]'; parent_holes jsonb:='[]';
  reasons text[]:='{}'; n integer; first_number integer; proposed_label text; valid boolean;
begin
  perform public.admin_catalog_require_admin();
  select * into s from public.admin_catalog_physical_structures where id=p_structure_id;
  if not found then raise exception 'Existing physical structure required' using errcode='22023'; end if;
  if s.review_status<>'verified' or s.classification<>'fisico_18' then reasons:=array_append(reasons,'verified_eighteen_required'); end if;
  if p_kind is not null and p_kind not in ('autonomous_18','front_9','back_9') then raise exception 'Explicit physical18 kind required' using errcode='22023'; end if;
  if p_par_selection is not null and p_par_selection not in ('source','inherited') then raise exception 'Explicit Par provenance required' using errcode='22023'; end if;
  if p_link_id is not null then
    select * into l from public.admin_catalog_physical_course_links where id=p_link_id;
    if not found or l.structure_id<>s.id or l.club_id<>s.club_id then raise exception 'Physical link outside structure' using errcode='22023'; end if;
    if l.review_status<>'verified' or l.holes_count<>18 then reasons:=array_append(reasons,'verified_eighteen_source_required'); end if;
    physical:=public.admin_catalog_physical_course_inspect(s.id,l.course_id);
    if jsonb_array_length(physical->'reasons')<>0 or jsonb_array_length(physical->'physical_holes')<>18
      or jsonb_array_length(physical->'mapping')<>18 then reasons:=array_append(reasons,'physical_source_changed'); end if;
  end if;
  if p_course_id is not null then
    select * into c from public.course_routes where id=p_course_id;
    if not found or c.club_id<>s.club_id then raise exception 'Source course outside club' using errcode='22023'; end if;
    source:=public.admin_catalog_physical_course_source(c.id);
    if not c.is_active or not exists(select 1 from public.clubs where id=s.club_id and is_active) then reasons:=array_append(reasons,'inactive_source'); end if;
  end if;
  if l.id is not null and p_kind is not null and c.id is not null and p_par_selection is not null then
    n:=case p_kind when 'autonomous_18' then 18 else 9 end;
    first_number:=case p_kind when 'back_9' then 10 else 1 end;
    proposed_label:=left(c.name,150)||case p_kind when 'autonomous_18' then ' · 18 autonoma' when 'front_9' then ' · derivata fisiche 1–9' else ' · derivata fisiche 10–18' end;
    if c.holes_count<>n or (p_kind='autonomous_18' and c.id<>l.course_id) then reasons:=array_append(reasons,'wrong_cardinality_or_source'); end if;
    select count(*)=n and count(distinct physical_hole_number)=n and min(physical_hole_number)=1 and max(physical_hole_number)=n
      and coalesce(bool_and(par between 3 and 6 and par is not null),false)
      and count(distinct stroke_index)=n and coalesce(bool_and(stroke_index between 1 and 18 and stroke_index is not null),false)
      and sum(par)=c.total_par into valid from public.route_holes where route_id=c.id;
    if valid is distinct from true then reasons:=array_append(reasons,'invalid_source_grid'); end if;
    -- This is the explicitly selected interval contract, not inferred matching.
    -- Source local number -> selected physical number. SI never comes from the physical parent.
    select coalesce(jsonb_agg(jsonb_build_object('position',rh.physical_hole_number,'occurrence',1,
      'source_number',rh.physical_hole_number,'legacy_route_hole_id',rh.id,
      'physical_hole_id',h.id,'physical_number',h.physical_number,'physical_label',h.label,'physical_revision',h.revision,
      'base_par',h.base_par,'source_par',rh.par,'source_stroke_index',rh.stroke_index,'stroke_index',rh.stroke_index,
      'par_mode',case p_par_selection when 'source' then 'override' else 'inherited' end,
      'par_override',case when p_par_selection='source' then rh.par else null end,
      'effective_par',case p_par_selection when 'source' then rh.par else h.base_par end) order by rh.physical_hole_number),'[]'::jsonb)
      into sequence from public.route_holes rh join public.admin_catalog_physical_holes h
        on h.source_course_link_id=l.id and h.source_position=first_number+rh.physical_hole_number-1
      where rh.route_id=c.id and rh.physical_hole_number between 1 and n;
    if jsonb_array_length(sequence)<>n then reasons:=array_append(reasons,'incomplete_sequence'); end if;
    if exists(select 1 from jsonb_array_elements(sequence) x where x->>'source_par' is distinct from x->>'base_par')
      or (select sum((x->>'effective_par')::integer) from jsonb_array_elements(sequence) x) is distinct from c.total_par then
      reasons:=array_append(reasons,'par_mismatch'); end if;
    select * into cfg from public.admin_catalog_playable_configurations where physical_source_link_id=l.id and registration_kind=p_kind;
    if exists(select 1 from public.admin_catalog_playable_configurations other where other.id is distinct from cfg.id
      and (other.legacy_course_route_id=c.id or (other.club_id=s.club_id and other.label=proposed_label)))
      or exists(select 1 from public.admin_catalog_configuration_holes h join public.route_holes rh on rh.id=h.legacy_route_hole_id
        where rh.route_id=c.id and h.configuration_id is distinct from cfg.id)
      or exists(select 1 from public.admin_catalog_physical_course_links other where other.course_id=c.id and other.id<>l.id) then
      reasons:=array_append(reasons,'configuration_collision'); end if;
    if p_kind<>'autonomous_18' then
      select * into parent from public.admin_catalog_playable_configurations where physical_source_link_id=l.id and registration_kind='autonomous_18';
      if parent.id is null or parent.review_status<>'verified' then reasons:=array_append(reasons,'verified_parent_required');
      else
        select coalesce(jsonb_agg(to_jsonb(h) order by h.position),'[]'::jsonb) into parent_holes from public.admin_catalog_configuration_holes h where h.configuration_id=parent.id;
        if jsonb_array_length(public.admin_catalog_physical18_inspect(s.id,l.id,'autonomous_18',parent.legacy_course_route_id,parent.registration_snapshot->>'par_selection')->'reasons')<>0
          then reasons:=array_append(reasons,'parent_changed'); end if;
      end if;
    end if;
    baseline:=jsonb_build_object('structure',to_jsonb(s),'physical_link',to_jsonb(l),
      'physical_source',physical->'source','physical_holes',physical->'physical_holes','physical_mapping',physical->'mapping',
      'source',source,'kind',p_kind,'interval_start',first_number,'interval_end',first_number+n-1,'par_selection',p_par_selection,
      'parent',case when parent.id is null then null else to_jsonb(parent) end,'parent_holes',parent_holes);
    if cfg.id is not null then
      select coalesce(jsonb_agg(to_jsonb(h) order by h.position),'[]'::jsonb) into saved from public.admin_catalog_configuration_holes h where h.configuration_id=cfg.id;
      if cfg.registration_snapshot is distinct from baseline then reasons:=array_append(reasons,'registration_base_changed'); end if;
      if cfg.structure_id is distinct from s.id or cfg.club_id<>s.club_id or cfg.holes_count<>n
        or cfg.legacy_course_route_id is distinct from c.id or cfg.legacy_combination_id is not null
        or cfg.parent_configuration_id is distinct from parent.id or cfg.parent_configuration_revision is distinct from parent.revision
        or cfg.derivation_rule is distinct from (case when p_kind<>'autonomous_18' then 'explicit_physical_interval_'||first_number||'_'||(first_number+n-1)||'_source_si' else null end)
        or jsonb_array_length(saved)<>n or exists(select 1 from jsonb_array_elements(saved) x where
          (x->>'position')::integer not between 1 and n or x->>'review_status'<>'verified'
          or x->>'club_id' is distinct from s.club_id::text or x->>'structure_id' is distinct from s.id::text
          or x->>'legacy_combination_hole_id' is not null or x->>'occurrence' is distinct from '1'
          or x->>'physical_hole_id' is distinct from sequence->((x->>'position')::integer-1)->>'physical_hole_id'
          or x->>'legacy_route_hole_id' is distinct from sequence->((x->>'position')::integer-1)->>'legacy_route_hole_id'
          or x->>'par_mode' is distinct from sequence->((x->>'position')::integer-1)->>'par_mode'
          or x->>'par_override' is distinct from sequence->((x->>'position')::integer-1)->>'par_override'
          or x->>'stroke_index' is distinct from sequence->((x->>'position')::integer-1)->>'stroke_index') then
        reasons:=array_append(reasons,'invalid_saved_configuration'); end if;
    end if;
  end if;
  return jsonb_build_object('structure',to_jsonb(s),'source_link_id',p_link_id,'kind',p_kind,'source_course_id',p_course_id,
    'par_selection',p_par_selection,'source_name',c.name,'label',proposed_label,'baseline',baseline,'sequence',sequence,'saved_holes',saved,
    'configuration',case when cfg.id is null then null else to_jsonb(cfg) end,'parent_label',parent.label,'reasons',to_jsonb(reasons),
    'can_register',baseline is not null and cardinality(reasons)=0 and cfg.id is null,
    'can_verify',baseline is not null and cardinality(reasons)=0 and cfg.id is not null and cfg.review_status='needs_review',
    'source_links',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',r.name,'holes_count',x.holes_count) order by r.name,x.id)
      from public.admin_catalog_physical_course_links x join public.course_routes r on r.id=x.course_id where x.structure_id=s.id and x.review_status='verified' and x.holes_count=18),'[]'::jsonb),
    'courses',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'holes_count',r.holes_count) order by r.name,r.id)
      from public.course_routes r where r.club_id=s.club_id and r.is_active),'[]'::jsonb),
    'configurations',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.admin_catalog_playable_configurations x
      where x.structure_id=s.id and x.registration_kind in ('autonomous_18','front_9','back_9')),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id) from public.admin_catalog_foundation_events e where
      (e.entity_table='admin_catalog_playable_configurations' and exists(select 1 from public.admin_catalog_playable_configurations x where x.id=e.entity_id and x.structure_id=s.id))
      or (e.entity_table='admin_catalog_configuration_holes' and exists(select 1 from public.admin_catalog_configuration_holes h join public.admin_catalog_playable_configurations x on x.id=h.configuration_id where h.id=e.entity_id and x.structure_id=s.id))),'[]'::jsonb));
end;
$$;

create function public.admin_catalog_physical18_lock(p_structure_id uuid,p_link_id uuid,p_course_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform public.admin_catalog_require_admin();
  perform public.admin_catalog_playable_lock(p_structure_id,p_link_id);
  -- Protect the separately selected nine-hole source and course phantoms too.
  lock table public.course_routes in share mode nowait;
  perform id from public.course_routes where id=p_course_id for share nowait;
end;
$$;

create function public.admin_catalog_physical18_preview(p_structure_id uuid,p_source_link_id uuid default null,
  p_kind text default null,p_course_id uuid default null,p_par_selection text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  perform public.admin_catalog_require_admin();
  return public.admin_catalog_physical18_inspect(p_structure_id,p_source_link_id,p_kind,p_course_id,p_par_selection);
end;
$$;

create function public.admin_catalog_physical18_register(p_structure_id uuid,p_source_link_id uuid,p_kind text,
  p_course_id uuid,p_par_selection text,p_expected_baseline jsonb,p_reason text,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare context jsonb; cfg public.admin_catalog_playable_configurations; x jsonb;
begin
  perform public.admin_catalog_require_admin();
  if p_confirm is distinct from true or nullif(btrim(p_reason),'') is null or p_kind is null or p_course_id is null or p_par_selection is null then
    raise exception 'Explicit choices, confirmation and note required' using errcode='22023'; end if;
  perform public.admin_catalog_physical18_lock(p_structure_id,p_source_link_id,p_course_id);
  context:=public.admin_catalog_physical18_inspect(p_structure_id,p_source_link_id,p_kind,p_course_id,p_par_selection);
  if p_expected_baseline is null or context->'baseline' is distinct from p_expected_baseline then raise exception 'Configuration base changed' using errcode='40001'; end if;
  if (context->>'can_register')::boolean is distinct from true then raise exception 'Incompatible physical18 configuration: %',context->'reasons' using errcode='23514'; end if;
  insert into public.admin_catalog_playable_configurations(club_id,label,holes_count,structure_id,relationship_kind,
    parent_configuration_id,parent_configuration_revision,derivation_rule,legacy_course_route_id,source_system,source_reference,
    reason,physical_source_link_id,registration_kind,registration_snapshot)
    values((context->'structure'->>'club_id')::uuid,context->>'label',jsonb_array_length(context->'sequence'),p_structure_id,
      case p_kind when 'autonomous_18' then 'autonomous' else 'derived' end,
      (context->'baseline'->'parent'->>'id')::uuid,(context->'baseline'->'parent'->>'revision')::bigint,
      case when p_kind<>'autonomous_18' then 'explicit_physical_interval_'||(context->'baseline'->>'interval_start')||'_'||(context->'baseline'->>'interval_end')||'_source_si' else null end,
      p_course_id,'stablr','course_route:'||p_course_id::text,btrim(p_reason),p_source_link_id,p_kind,context->'baseline') returning * into cfg;
  for x in select value from jsonb_array_elements(context->'sequence') loop
    insert into public.admin_catalog_configuration_holes(configuration_id,club_id,structure_id,physical_hole_id,position,occurrence,
      par_mode,par_override,stroke_index,review_status,legacy_route_hole_id,source_system,source_reference,reason)
      values(cfg.id,cfg.club_id,p_structure_id,(x->>'physical_hole_id')::uuid,(x->>'position')::integer,1,
        x->>'par_mode',(x->>'par_override')::integer,(x->>'stroke_index')::integer,'verified',(x->>'legacy_route_hole_id')::uuid,
        'stablr','course_route:'||p_course_id::text||';source_hole:'||(x->>'legacy_route_hole_id'),btrim(p_reason));
  end loop;
  return public.admin_catalog_physical18_inspect(p_structure_id,p_source_link_id,p_kind,p_course_id,p_par_selection);
end;
$$;

create function public.admin_catalog_physical18_verify(p_configuration_id uuid,p_expected_revision bigint,
  p_expected_baseline jsonb,p_expected_holes jsonb,p_reason text,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare cfg public.admin_catalog_playable_configurations; context jsonb;
begin
  perform public.admin_catalog_require_admin();
  if p_confirm is distinct from true or nullif(btrim(p_reason),'') is null then raise exception 'Confirmation and note required' using errcode='22023'; end if;
  select * into cfg from public.admin_catalog_playable_configurations where id=p_configuration_id;
  if not found or cfg.registration_kind not in ('autonomous_18','front_9','back_9') or cfg.registration_kind is null then raise exception 'Phase 3c configuration required' using errcode='22023'; end if;
  perform public.admin_catalog_physical18_lock(cfg.structure_id,cfg.physical_source_link_id,cfg.legacy_course_route_id);
  select * into cfg from public.admin_catalog_playable_configurations where id=p_configuration_id for update nowait;
  if p_expected_revision is null or cfg.revision<>p_expected_revision then raise exception 'Configuration revision changed' using errcode='40001'; end if;
  context:=public.admin_catalog_physical18_inspect(cfg.structure_id,cfg.physical_source_link_id,cfg.registration_kind,cfg.legacy_course_route_id,cfg.registration_snapshot->>'par_selection');
  if p_expected_baseline is null or context->'baseline' is distinct from p_expected_baseline
    or p_expected_holes is null or context->'saved_holes' is distinct from p_expected_holes then raise exception 'Configuration source or slots changed' using errcode='40001'; end if;
  if (context->>'can_verify')::boolean is distinct from true then raise exception 'Unverifiable physical18 configuration: %',context->'reasons' using errcode='23514'; end if;
  update public.admin_catalog_playable_configurations set review_status='verified',reason=btrim(p_reason) where id=cfg.id;
  return public.admin_catalog_physical18_inspect(cfg.structure_id,cfg.physical_source_link_id,cfg.registration_kind,cfg.legacy_course_route_id,cfg.registration_snapshot->>'par_selection');
end;
$$;

-- Extend the existing sequence guard explicitly; Phase 3b keeps its old inspector
-- and exact snapshots. No registered proposal can be edited/rebased by generic RPCs.
create or replace function public.admin_catalog_playable_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare cfg public.admin_catalog_playable_configurations; context jsonb; slot jsonb; phase3c boolean;
begin
  perform public.admin_catalog_require_admin();
  if tg_table_name='admin_catalog_playable_configurations' then
    if old.registration_kind is null then
      if new.registration_kind is not null or new.physical_source_link_id is not null or new.registration_snapshot is not null then raise exception 'Existing proposals cannot be adopted implicitly' using errcode='55000'; end if;
      return new;
    end if;
    if old.review_status<>'needs_review' or new.review_status<>'verified' or nullif(btrim(new.reason),'') is null
      or (to_jsonb(new)-array['review_status','reason','revision','updated_by','updated_at']) is distinct from
        (to_jsonb(old)-array['review_status','reason','revision','updated_by','updated_at']) then raise exception 'Registered configuration is immutable except verified review' using errcode='55000'; end if;
    cfg:=old;
  else
    select * into cfg from public.admin_catalog_playable_configurations where id=new.configuration_id;
    if tg_op='UPDATE' then
      if cfg.registration_kind is not null or exists(select 1 from public.admin_catalog_playable_configurations c where c.id=old.configuration_id and c.registration_kind is not null) then raise exception 'Registered slots are immutable' using errcode='55000'; end if;
      return new;
    end if;
    if cfg.registration_kind is null then return new; end if;
  end if;
  phase3c:=cfg.registration_kind in ('autonomous_18','front_9','back_9');
  if phase3c then
    perform public.admin_catalog_physical18_lock(cfg.structure_id,cfg.physical_source_link_id,cfg.legacy_course_route_id);
    context:=public.admin_catalog_physical18_inspect(cfg.structure_id,cfg.physical_source_link_id,cfg.registration_kind,cfg.legacy_course_route_id,cfg.registration_snapshot->>'par_selection');
  else
    if tg_table_name='admin_catalog_playable_configurations' then perform public.admin_catalog_playable_lock(cfg.structure_id,cfg.physical_source_link_id); end if;
    context:=public.admin_catalog_playable_inspect(cfg.structure_id,cfg.physical_source_link_id,cfg.registration_kind);
  end if;
  if tg_table_name='admin_catalog_playable_configurations' then
    if (context->>'can_verify')::boolean is distinct from true then raise exception 'Complete source-current configuration required' using errcode='23514'; end if;
  else
    slot:=context->'sequence'->(new.position-1);
    if cfg.review_status<>'needs_review' or slot is null or new.review_status<>'verified'
      or new.physical_hole_id is distinct from (slot->>'physical_hole_id')::uuid
      or new.legacy_route_hole_id is distinct from (slot->>'legacy_route_hole_id')::uuid
      or new.legacy_combination_hole_id is not null or new.par_mode is distinct from slot->>'par_mode'
      or new.par_override is distinct from (slot->>'par_override')::integer
      or new.occurrence is distinct from (slot->>'occurrence')::integer
      or new.stroke_index is distinct from (slot->>'stroke_index')::integer then raise exception 'Exact explicit configuration sequence required' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;

revoke all on function public.admin_catalog_physical18_inspect(uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_physical18_lock(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_playable_guard() from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_physical18_preview(uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_physical18_register(uuid,uuid,text,uuid,text,jsonb,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_physical18_verify(uuid,bigint,jsonb,jsonb,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_catalog_physical18_preview(uuid,uuid,text,uuid,text) to authenticated;
grant execute on function public.admin_catalog_physical18_register(uuid,uuid,text,uuid,text,jsonb,text,boolean) to authenticated;
grant execute on function public.admin_catalog_physical18_verify(uuid,bigint,jsonb,jsonb,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
