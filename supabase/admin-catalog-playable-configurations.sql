-- Phase 3b: apply ONCE after admin-catalog-physical-course-links.sql.
-- No backfill, live publication, tee override writes or consumer changes.
begin;

alter table public.admin_catalog_playable_configurations
  add column physical_source_link_id uuid references public.admin_catalog_physical_course_links(id) on delete restrict,
  add column registration_kind text check (registration_kind in ('autonomous_9','repeated_18')),
  add column registration_snapshot jsonb,
  add constraint admin_catalog_configuration_registration_complete check (
    num_nonnulls(physical_source_link_id,registration_kind,registration_snapshot) in (0,3)
    and (registration_snapshot is null or jsonb_typeof(registration_snapshot)='object'));
create unique index admin_catalog_configuration_registration_key
  on public.admin_catalog_playable_configurations(physical_source_link_id,registration_kind)
  where registration_kind is not null;

-- Internal context builder. All proposed values come from verified identities
-- and exact source IDs, never client JSON or name/Par/offset matching.
create function public.admin_catalog_playable_inspect(p_structure_id uuid,p_source_link_id uuid,p_kind text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare s public.admin_catalog_physical_structures; l public.admin_catalog_physical_course_links;
  cfg public.admin_catalog_playable_configurations; parent public.admin_catalog_playable_configurations;
  physical jsonb; source jsonb; baseline jsonb; sequence jsonb:='[]'; saved jsonb:='[]';
  parent_holes jsonb:='[]'; tees jsonb:='[]'; tee_overrides jsonb:='[]';
  reasons text[]:='{}'; n integer; proposed_label text; valid_si boolean; parent_valid boolean;
begin
  perform public.admin_catalog_require_admin();
  select * into s from public.admin_catalog_physical_structures where id=p_structure_id;
  if not found then raise exception 'Existing physical structure required' using errcode='22023'; end if;
  if s.review_status<>'verified' or s.classification<>'fisico_9' then reasons:=array_append(reasons,'verified_nine_required'); end if;
  if p_kind is not null and p_kind not in('autonomous_9','repeated_18') then
    raise exception 'Unsupported explicit configuration kind' using errcode='22023'; end if;
  if p_source_link_id is not null then
    select * into l from public.admin_catalog_physical_course_links where id=p_source_link_id;
    if not found or l.structure_id<>s.id or l.club_id<>s.club_id then
      raise exception 'Source link must belong to the selected structure' using errcode='22023'; end if;
    if l.review_status<>'verified' or l.holes_count<>9 then reasons:=array_append(reasons,'verified_source_required'); end if;
    physical:=public.admin_catalog_physical_course_inspect(s.id,l.course_id);
    source:=physical->'source';
    if jsonb_array_length(physical->'reasons')<>0 or jsonb_array_length(physical->'mapping')<>9
      or jsonb_array_length(physical->'physical_holes')<>9 then reasons:=array_append(reasons,'physical_source_changed'); end if;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) into tees from public.route_tees t where t.route_id=l.course_id;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) into tee_overrides
      from public.admin_catalog_tee_overrides t join public.admin_catalog_playable_configurations c on c.id=t.configuration_id
      where c.legacy_course_route_id=l.course_id;
    if p_kind is not null then
      n:=case p_kind when 'autonomous_9' then 9 else 18 end;
      proposed_label:=left(source->'course'->>'name',150)||case p_kind when 'autonomous_9' then ' · 9 autonoma' else ' · 18 derivata (9 × 2)' end;
      select coalesce(jsonb_agg(jsonb_build_object('position',pos,'occurrence',1+(pos-1)/9,
        'physical_hole_id',h.id,'physical_number',h.physical_number,'physical_label',h.label,
        'physical_revision',h.revision,'legacy_route_hole_id',rh.id,'base_par',h.base_par,
        'par_mode','inherited','par_override',null,'effective_par',h.base_par,'source_stroke_index',rh.stroke_index,
        'stroke_index',case when rh.stroke_index is null then null when pos>9 then least(18,rh.stroke_index+1) else rh.stroke_index end)
        order by pos),'[]'::jsonb) into sequence
        from generate_series(1,n) pos join public.admin_catalog_physical_holes h
          on h.source_course_link_id=l.id and h.source_position=1+(pos-1)%9
        join public.route_holes rh on rh.id=h.source_route_hole_id and rh.route_id=l.course_id;
      if jsonb_array_length(sequence)<>n then reasons:=array_append(reasons,'incomplete_sequence'); end if;
      select count(*)=n and count(distinct (x->>'stroke_index')::integer)=n
        and coalesce(bool_and((x->>'stroke_index')::integer between 1 and 18),false)
        into valid_si from jsonb_array_elements(sequence) x;
      if valid_si is distinct from true then reasons:=array_append(reasons,'invalid_configuration_si'); end if;
      select * into cfg from public.admin_catalog_playable_configurations
        where physical_source_link_id=l.id and registration_kind=p_kind;
      if exists(select 1 from public.admin_catalog_playable_configurations c
        where c.id is distinct from cfg.id and
          ((c.legacy_course_route_id=l.course_id and c.holes_count=n) or (c.club_id=s.club_id and c.label=proposed_label))) then
        reasons:=array_append(reasons,'configuration_collision'); end if;
      if p_kind='repeated_18' then
        select * into parent from public.admin_catalog_playable_configurations
          where physical_source_link_id=l.id and registration_kind='autonomous_9';
        if parent.id is null or parent.review_status<>'verified' then reasons:=array_append(reasons,'verified_parent_required');
        else
          select coalesce(jsonb_agg(to_jsonb(h) order by h.position),'[]'::jsonb) into parent_holes
            from public.admin_catalog_configuration_holes h where h.configuration_id=parent.id;
          select count(*)=9 and coalesce(bool_and(h.review_status='verified' and h.position between 1 and 9
            and h.occurrence=1 and h.par_mode='inherited' and h.par_override is null
            and h.physical_hole_id=(sequence->(h.position-1)->>'physical_hole_id')::uuid
            and h.legacy_route_hole_id=(sequence->(h.position-1)->>'legacy_route_hole_id')::uuid
            and h.stroke_index=(sequence->(h.position-1)->>'stroke_index')::integer),false)
            into parent_valid from public.admin_catalog_configuration_holes h where h.configuration_id=parent.id;
          if parent_valid is distinct from true then reasons:=array_append(reasons,'parent_changed'); end if;
        end if;
      end if;
      baseline:=jsonb_build_object('structure',to_jsonb(s),'physical_link',to_jsonb(l),'source',source,
        'physical_holes',physical->'physical_holes','physical_mapping',physical->'mapping',
        'route_tees',tees,'foundation_tee_overrides',tee_overrides,
        'parent',case when parent.id is null then null else to_jsonb(parent) end,'parent_holes',parent_holes);
      if cfg.id is not null then
        select coalesce(jsonb_agg(to_jsonb(h) order by h.position),'[]'::jsonb) into saved
          from public.admin_catalog_configuration_holes h where h.configuration_id=cfg.id;
        if cfg.registration_snapshot is distinct from baseline then reasons:=array_append(reasons,'registration_base_changed'); end if;
        if cfg.structure_id is distinct from s.id or cfg.club_id<>s.club_id or cfg.holes_count<>n
          or cfg.legacy_course_route_id is distinct from l.course_id or cfg.legacy_combination_id is not null
          or cfg.relationship_kind<>(case p_kind when 'autonomous_9' then 'autonomous' else 'derived' end)
          or cfg.parent_configuration_id is distinct from parent.id
          or cfg.parent_configuration_revision is distinct from parent.revision
          or cfg.derivation_rule is distinct from (case when p_kind='repeated_18' then 'repeat_same_9_si_base_then_plus_1_cap_18' else null end)
          or jsonb_array_length(saved)<>n or exists(select 1 from jsonb_array_elements(saved) x
            where (x->>'position')::integer not between 1 and n
              or x->>'review_status'<>'verified' or x->>'par_mode'<>'inherited' or x->>'par_override' is not null
              or x->>'legacy_combination_hole_id' is not null
              or x->>'structure_id' is distinct from s.id::text or x->>'club_id' is distinct from s.club_id::text
              or x->>'physical_hole_id' is distinct from sequence->((x->>'position')::integer-1)->>'physical_hole_id'
              or x->>'legacy_route_hole_id' is distinct from sequence->((x->>'position')::integer-1)->>'legacy_route_hole_id'
              or x->>'occurrence' is distinct from sequence->((x->>'position')::integer-1)->>'occurrence'
              or x->>'stroke_index' is distinct from sequence->((x->>'position')::integer-1)->>'stroke_index') then
          reasons:=array_append(reasons,'invalid_saved_configuration'); end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('structure',to_jsonb(s),'source_link_id',p_source_link_id,'kind',p_kind,'label',proposed_label,
    'source_name',source->'course'->>'name','baseline',baseline,'sequence',sequence,'saved_holes',saved,
    'configuration',case when cfg.id is null then null else to_jsonb(cfg) end,
    'parent_label',parent.label,'reasons',to_jsonb(reasons),
    'tee_matrix',source->'course'->'source_payload'->'tee_specific_hole_matrix',
    'tee_overrides',tee_overrides,
    'can_register',p_source_link_id is not null and p_kind is not null and cardinality(reasons)=0 and cfg.id is null,
    'can_verify',p_source_link_id is not null and p_kind is not null and cardinality(reasons)=0 and cfg.id is not null and cfg.review_status='needs_review',
    'source_links',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',r.name,'review_status',x.review_status,'holes_count',x.holes_count) order by r.name,x.id)
      from public.admin_catalog_physical_course_links x join public.course_routes r on r.id=x.course_id
      where x.structure_id=s.id and x.review_status='verified' and x.holes_count=9),'[]'::jsonb),
    'configurations',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from public.admin_catalog_playable_configurations c
      where c.structure_id=s.id and c.registration_kind is not null),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id) from public.admin_catalog_foundation_events e
      where (e.entity_table='admin_catalog_playable_configurations' and exists(select 1 from public.admin_catalog_playable_configurations c where c.id=e.entity_id and c.structure_id=s.id))
        or (e.entity_table='admin_catalog_configuration_holes' and exists(select 1 from public.admin_catalog_configuration_holes h
          join public.admin_catalog_playable_configurations c on c.id=h.configuration_id where h.id=e.entity_id and c.structure_id=s.id))),'[]'::jsonb));
end;
$$;

-- Lock table phantoms and rows before checking any baseline. NOWAIT makes an
-- overlapping source publisher/reviewer fail instead of waiting in a cycle.
create function public.admin_catalog_playable_lock(p_structure_id uuid,p_link_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare l public.admin_catalog_physical_course_links;
begin
  perform public.admin_catalog_require_admin();
  lock table public.route_holes,public.route_tees in share mode nowait;
  lock table public.admin_catalog_physical_holes,public.admin_catalog_playable_configurations,
    public.admin_catalog_configuration_holes,public.admin_catalog_tee_overrides in share row exclusive mode nowait;
  select * into l from public.admin_catalog_physical_course_links where id=p_link_id for share nowait;
  if not found or l.structure_id<>p_structure_id then raise exception 'Explicit source link required' using errcode='22023'; end if;
  perform id from public.course_routes where id=l.course_id for share nowait;
  perform id from public.clubs where id=l.club_id for share nowait;
  perform id from public.admin_catalog_physical_structures where id=p_structure_id for update nowait;
end;
$$;

create function public.admin_catalog_playable_preview(p_structure_id uuid,p_source_link_id uuid default null,p_kind text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  perform public.admin_catalog_require_admin();
  return public.admin_catalog_playable_inspect(p_structure_id,p_source_link_id,p_kind);
end;
$$;

create function public.admin_catalog_playable_register(p_structure_id uuid,p_source_link_id uuid,p_kind text,
  p_expected_baseline jsonb,p_reason text,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare context jsonb; cfg public.admin_catalog_playable_configurations; x jsonb;
begin
  perform public.admin_catalog_require_admin();
  if p_confirm is distinct from true or nullif(btrim(p_reason),'') is null or p_kind is null then
    raise exception 'Explicit kind, confirmation and note required' using errcode='22023'; end if;
  perform public.admin_catalog_playable_lock(p_structure_id,p_source_link_id);
  context:=public.admin_catalog_playable_inspect(p_structure_id,p_source_link_id,p_kind);
  if p_expected_baseline is null or context->'baseline' is distinct from p_expected_baseline then
    raise exception 'Configuration source baseline changed' using errcode='40001'; end if;
  if (context->>'can_register')::boolean is distinct from true then
    raise exception 'Incompatible playable configuration: %',context->'reasons' using errcode='23514'; end if;
  insert into public.admin_catalog_playable_configurations(club_id,label,holes_count,structure_id,relationship_kind,
    parent_configuration_id,parent_configuration_revision,derivation_rule,legacy_course_route_id,source_system,source_reference,
    reason,physical_source_link_id,registration_kind,registration_snapshot)
    values((context->'structure'->>'club_id')::uuid,context->>'label',jsonb_array_length(context->'sequence'),p_structure_id,
      case p_kind when 'autonomous_9' then 'autonomous' else 'derived' end,
      (context->'baseline'->'parent'->>'id')::uuid,(context->'baseline'->'parent'->>'revision')::bigint,
      case when p_kind='repeated_18' then 'repeat_same_9_si_base_then_plus_1_cap_18' else null end,
      (context->'baseline'->'physical_link'->>'course_id')::uuid,'stablr','physical_course_link:'||p_source_link_id::text,
      btrim(p_reason),p_source_link_id,p_kind,context->'baseline') returning * into cfg;
  for x in select value from jsonb_array_elements(context->'sequence') loop
    insert into public.admin_catalog_configuration_holes(configuration_id,club_id,structure_id,physical_hole_id,position,
      occurrence,par_mode,stroke_index,review_status,legacy_route_hole_id,source_system,source_reference,reason)
      values(cfg.id,cfg.club_id,p_structure_id,(x->>'physical_hole_id')::uuid,(x->>'position')::integer,
        (x->>'occurrence')::integer,'inherited',(x->>'stroke_index')::integer,'verified',(x->>'legacy_route_hole_id')::uuid,
        'stablr','physical_course_link:'||p_source_link_id::text||';position:'||(x->>'position'),btrim(p_reason));
  end loop;
  return public.admin_catalog_playable_inspect(p_structure_id,p_source_link_id,p_kind);
end;
$$;

create function public.admin_catalog_playable_verify(p_configuration_id uuid,p_expected_revision bigint,
  p_expected_baseline jsonb,p_expected_holes jsonb,p_reason text,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare cfg public.admin_catalog_playable_configurations; context jsonb;
begin
  perform public.admin_catalog_require_admin();
  if p_confirm is distinct from true or nullif(btrim(p_reason),'') is null then
    raise exception 'Explicit confirmation and note required' using errcode='22023'; end if;
  select * into cfg from public.admin_catalog_playable_configurations where id=p_configuration_id;
  if not found or cfg.registration_kind is null then raise exception 'Registered Phase 3b configuration required' using errcode='22023'; end if;
  perform public.admin_catalog_playable_lock(cfg.structure_id,cfg.physical_source_link_id);
  select * into cfg from public.admin_catalog_playable_configurations where id=p_configuration_id for update nowait;
  if p_expected_revision is null or cfg.revision<>p_expected_revision then raise exception 'Configuration revision changed' using errcode='40001'; end if;
  context:=public.admin_catalog_playable_inspect(cfg.structure_id,cfg.physical_source_link_id,cfg.registration_kind);
  if p_expected_baseline is null or context->'baseline' is distinct from p_expected_baseline
    or p_expected_holes is null or context->'saved_holes' is distinct from p_expected_holes then
    raise exception 'Configuration source or slots changed' using errcode='40001'; end if;
  if (context->>'can_verify')::boolean is distinct from true then
    raise exception 'Unverifiable playable configuration: %',context->'reasons' using errcode='23514'; end if;
  update public.admin_catalog_playable_configurations set review_status='verified',reason=btrim(p_reason) where id=cfg.id;
  return public.admin_catalog_playable_inspect(cfg.structure_id,cfg.physical_source_link_id,cfg.registration_kind);
end;
$$;

-- Existing generic foundation RPCs cannot edit Phase 3b sequences or change
-- their base. Only a complete, source-current review transition is admissible.
create function public.admin_catalog_playable_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare cfg public.admin_catalog_playable_configurations; context jsonb; slot jsonb;
begin
  perform public.admin_catalog_require_admin();
  if tg_table_name='admin_catalog_playable_configurations' then
    if old.registration_kind is null then
      if new.registration_kind is not null or new.physical_source_link_id is not null or new.registration_snapshot is not null then
        raise exception 'Existing proposals cannot be adopted implicitly' using errcode='55000'; end if;
      return new;
    end if;
    if old.review_status<>'needs_review' or new.review_status<>'verified' or nullif(btrim(new.reason),'') is null
      or (to_jsonb(new)-array['review_status','reason','revision','updated_by','updated_at'])
        is distinct from (to_jsonb(old)-array['review_status','reason','revision','updated_by','updated_at']) then
      raise exception 'Registered configuration is immutable except verified review' using errcode='55000'; end if;
    perform public.admin_catalog_playable_lock(old.structure_id,old.physical_source_link_id);
    context:=public.admin_catalog_playable_inspect(old.structure_id,old.physical_source_link_id,old.registration_kind);
    if (context->>'can_verify')::boolean is distinct from true then
      raise exception 'Complete source-current configuration required' using errcode='23514'; end if;
  else
    select * into cfg from public.admin_catalog_playable_configurations where id=new.configuration_id;
    if tg_op='UPDATE' then
      if cfg.registration_kind is not null or exists(select 1 from public.admin_catalog_playable_configurations c where c.id=old.configuration_id and c.registration_kind is not null) then
        raise exception 'Phase 3b slots are immutable' using errcode='55000'; end if;
      return new;
    end if;
    if cfg.registration_kind is null then return new; end if;
    context:=public.admin_catalog_playable_inspect(cfg.structure_id,cfg.physical_source_link_id,cfg.registration_kind);
    slot:=context->'sequence'->(new.position-1);
    if cfg.review_status<>'needs_review' or slot is null or new.review_status<>'verified'
      or new.physical_hole_id is distinct from (slot->>'physical_hole_id')::uuid
      or new.legacy_route_hole_id is distinct from (slot->>'legacy_route_hole_id')::uuid
      or new.legacy_combination_hole_id is not null or new.par_mode is distinct from 'inherited' or new.par_override is not null
      or new.occurrence is distinct from (slot->>'occurrence')::integer
      or new.stroke_index is distinct from (slot->>'stroke_index')::integer then
      raise exception 'Exact inherited configuration sequence required' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;
create trigger admin_catalog_playable_phase3b_guard before update on public.admin_catalog_playable_configurations
  for each row execute function public.admin_catalog_playable_guard();
create trigger admin_catalog_configuration_holes_phase3b_guard before insert or update on public.admin_catalog_configuration_holes
  for each row execute function public.admin_catalog_playable_guard();

revoke all on function public.admin_catalog_playable_inspect(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_playable_lock(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_playable_guard() from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_playable_preview(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_playable_register(uuid,uuid,text,jsonb,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_playable_verify(uuid,bigint,jsonb,jsonb,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_catalog_playable_preview(uuid,uuid,text) to authenticated;
grant execute on function public.admin_catalog_playable_register(uuid,uuid,text,jsonb,text,boolean) to authenticated;
grant execute on function public.admin_catalog_playable_verify(uuid,bigint,jsonb,jsonb,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
