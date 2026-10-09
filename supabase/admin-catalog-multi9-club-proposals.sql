-- Multi-9 club proposals: apply ONCE after structure-club-lock and multi9.
-- No seeds, backfill, live DML, policy changes or player consumers.
begin;

do $$ begin
  if to_regprocedure('public.admin_catalog_structure_club_lock(uuid)') is null
    or to_regprocedure('public.admin_catalog_multi9_apply(uuid,jsonb,text)') is null then
    raise exception 'Applied club lock and multi9 foundation required';
  end if;
end $$;

-- Private inspector: a proposed classification is JSON, never a persistent row.
-- Identity validation is the existing exact-reference contract, with mandatory Par.
create function public.admin_catalog_multi9_club_inspect(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare s public.admin_catalog_physical_structures; club public.clubs; c record; b record; rh record; l record;
  courses jsonb:='[]'; combinations jsonb:='[]'; excluded jsonb:='[]'; reasons text[]:='{}'; why text[];
  source jsonb; seq jsonb; valid boolean; baseline jsonb; n integer; origin_ids uuid[];
  structures jsonb; proposal jsonb; action text;
begin
  perform public.admin_catalog_require_admin();
  select * into club from public.clubs where id=p_club_id;
  if not found then raise exception 'Existing club required' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into structures
    from public.admin_catalog_physical_structures x where club_id=p_club_id;
  if jsonb_array_length(structures)>1 then reasons:=array_append(reasons,'ambiguous_structure'); end if;
  select * into s from public.admin_catalog_physical_structures where club_id=p_club_id order by id limit 1;
  if s.id is null then
    s.club_id:=p_club_id; action:='create';
  elsif s.classification='multi_9' and s.review_status='verified' then action:='reuse';
  elsif s.review_status='needs_review' and s.classification in ('multi_9','non_classificato') then
    action:='review';
    if exists(select 1 from public.admin_catalog_physical_holes where structure_id=s.id)
      or exists(select 1 from public.admin_catalog_playable_configurations where structure_id=s.id)
      or exists(select 1 from public.admin_catalog_physical_course_links where structure_id=s.id) then
      reasons:=array_append(reasons,'unreviewed_structure_dependencies');
    end if;
  else action:='blocked'; reasons:=array_append(reasons,'conflicting_classification'); end if;
  proposal:=jsonb_build_object('classification','multi_9','action',action,
    'label',coalesce(s.label,'Struttura multi-9'),'source_system','stablr',
    'source_reference','clubs:'||p_club_id::text||'/official-route-references');
  if not club.is_active then reasons:=array_append(reasons,'inactive_club'); end if;
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
    select count(par)=9 and count(*)=9 and count(distinct physical_hole_number)=9 and min(physical_hole_number)=1 and max(physical_hole_number)=9
      and count(distinct stroke_index)=9 and bool_and(stroke_index between 1 and 18 and par between 3 and 6)
      and sum(par)=c.total_par into valid from public.route_holes where route_id=c.id;
    if valid is distinct from true then why:=array_append(why,'invalid_nine_grid'); end if;
    select * into l from public.admin_catalog_physical_course_links where course_id=c.id;
    if l.id is not null and (l.structure_id is distinct from s.id or l.review_status<>'verified' or l.holes_count<>9
      or l.source_snapshot is distinct from source) then why:=array_append(why,'physical_link_unusable'); end if;
    if exists(select 1 from public.admin_catalog_physical_holes h join public.route_holes r on r.id=h.source_route_hole_id
      where r.route_id=c.id and (h.structure_id is distinct from s.id or h.source_course_link_id is distinct from l.id)) then why:=array_append(why,'physical_collision'); end if;
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
    select count(par)=18 and count(*)=18 and count(distinct round_hole_number)=18 and min(round_hole_number)=1 and max(round_hole_number)=18
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
  baseline:=jsonb_build_object('contract',2,'proposal',proposal,'structures',structures,'structure',case when s.id is null then null else to_jsonb(s) end,'club',to_jsonb(club),'courses',courses,'combinations',combinations,
    'physical_holes',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]') from public.admin_catalog_physical_holes h where club_id=club.id),
    'physical_links',(select coalesce(jsonb_agg(to_jsonb(pl) order by pl.id),'[]') from public.admin_catalog_physical_course_links pl where club_id=club.id),
    'configurations',(select coalesce(jsonb_agg(to_jsonb(pcfg) order by pcfg.id),'[]') from public.admin_catalog_playable_configurations pcfg where club_id=s.club_id),
    'slots',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]') from public.admin_catalog_configuration_holes h where club_id=s.club_id));
  return jsonb_build_object('structure_id',s.id,'structure_label',proposal->>'label','classification_proposal','multi_9','structure_proposal',proposal,'club_id',club.id,'club_name',club.name,
    'baseline',baseline,'courses',courses,'combinations',combinations,'excluded',excluded,'reasons',to_jsonb(reasons),
    'can_register',cardinality(reasons)=0,'configuration_count',jsonb_array_length(courses)+jsonb_array_length(combinations),
    'physical_hole_count',9*jsonb_array_length(courses),
    'new_physical_hole_count',(select 9*count(*) from jsonb_array_elements(courses) x where x->'link'='null'::jsonb),
    'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id),'[]')
      from public.admin_catalog_foundation_events e where e.after_snapshot->>'club_id'=s.club_id::text));
end $$;


create function public.admin_catalog_multi9_club_preview(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  perform public.admin_catalog_require_admin();
  return public.admin_catalog_multi9_club_inspect(p_club_id);
end $$;

-- Preserve the old optional structure selection. The default now discovers
-- clubs with actual combination records, including those with NO foundation.
create or replace function public.admin_catalog_multi9_batch_preview(p_structure_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare r record; c jsonb; candidates jsonb:='[]'; excluded jsonb:='[]'; missing uuid;
begin
  perform public.admin_catalog_require_admin();
  if p_structure_ids is not null and (cardinality(p_structure_ids)=0 or cardinality(p_structure_ids)>50) then
    raise exception 'Select 1..50 structures' using errcode='22023';
  end if;
  for r in select distinct cl.id from public.clubs cl where
    (p_structure_ids is null and (exists(select 1 from public.route_combinations rc where rc.club_id=cl.id)
      or exists(select 1 from public.admin_catalog_physical_structures s where s.club_id=cl.id and s.classification='multi_9')))
    or (p_structure_ids is not null and exists(select 1 from public.admin_catalog_physical_structures s
      where s.club_id=cl.id and s.id=any(p_structure_ids))) order by cl.id loop
    c:=public.admin_catalog_multi9_club_inspect(r.id);
    if (c->>'can_register')::boolean then candidates:=candidates||jsonb_build_array(c);
    else excluded:=excluded||jsonb_build_array(c); end if;
  end loop;
  if p_structure_ids is not null then
    for missing in select distinct x from unnest(p_structure_ids) x
      where not exists(select 1 from public.admin_catalog_physical_structures where id=x) loop
      excluded:=excluded||jsonb_build_array(jsonb_build_object('structure_id',missing,'club_id',null,
        'club_name','Struttura non disponibile','reasons',jsonb_build_array('unknown_structure')));
    end loop;
  end if;
  -- Preview can show every real exclusion; each confirmation is still capped.
  return jsonb_build_object('candidates',candidates,'excluded',excluded,'club_count',jsonb_array_length(candidates),
    'max_batch_size',50,'configuration_count',(select coalesce(sum((x->>'configuration_count')::integer),0)
      from jsonb_array_elements(candidates) x));
end $$;

-- Called within the endpoint's per-club exception block. All structure creation,
-- classification, identities/configurations AND their audit share that rollback.
create function public.admin_catalog_multi9_club_apply(p_club_id uuid,p_expected_baseline jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare ctx jsonb; legacy_ctx jsonb; result jsonb; s public.admin_catalog_physical_structures;
begin
  perform public.admin_catalog_require_admin();
  perform public.admin_catalog_structure_club_lock(p_club_id);
  lock table public.course_routes,public.route_holes,public.route_combinations,public.route_combination_holes in share mode nowait;
  lock table public.admin_catalog_physical_holes,public.admin_catalog_physical_course_links,
    public.admin_catalog_playable_configurations,public.admin_catalog_configuration_holes,
    public.admin_catalog_configuration_components in share row exclusive mode nowait;
  ctx:=public.admin_catalog_multi9_club_inspect(p_club_id);
  if p_expected_baseline is null or ctx->'baseline' is distinct from p_expected_baseline then
    raise exception 'Club proposal changed' using errcode='40001';
  end if;
  if (ctx->>'can_register')::boolean is distinct from true then
    raise exception 'Incompatible multi9 club: %',ctx->'reasons' using errcode='23514';
  end if;
  if ctx->'structure_proposal'->>'action'='create' then
    s:=public.admin_catalog_foundation_create_structure(p_club_id,ctx->'structure_proposal'->>'label',
      'stablr',ctx->'structure_proposal'->>'source_reference',p_reason);
  else
    select * into s from public.admin_catalog_physical_structures where id=(ctx->>'structure_id')::uuid for update nowait;
  end if;
  if s.review_status<>'verified' then
    s:=public.admin_catalog_foundation_review_structure(s.id,s.revision,'multi_9',
      'stablr',ctx->'structure_proposal'->>'source_reference',p_reason,true);
  end if;
  -- Reuse the applied registration implementation under the SAME club lock.
  -- Its inspectors/guards independently revalidate the newly approved structure.
  legacy_ctx:=public.admin_catalog_multi9_inspect(s.id);
  result:=public.admin_catalog_multi9_apply(s.id,legacy_ctx->'baseline',p_reason);
  return result||jsonb_build_object('structure_action',ctx->'structure_proposal'->>'action',
    'classification','multi_9');
end $$;

create or replace function public.admin_catalog_multi9_batch_register(p_candidates jsonb,p_reason text,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare candidate jsonb; current_ctx jsonb; registered jsonb:='[]'; excluded jsonb:='[]';
  result jsonb; receipt uuid; sid uuid; cid uuid; seen uuid[]:='{}'; code text; legacy boolean;
begin
  perform public.admin_catalog_require_admin();
  if p_confirm is distinct from true or nullif(btrim(p_reason),'') is null
    or jsonb_typeof(p_candidates) is distinct from 'array' then
    raise exception 'Confirmation, note and 1..50 candidates required' using errcode='22023';
  end if;
  if jsonb_array_length(p_candidates) not between 1 and 50 then
    raise exception 'Select 1..50 clubs' using errcode='22023';
  end if;
  for candidate in select value from jsonb_array_elements(p_candidates) loop
    begin
      cid:=null; sid:=null;
      if jsonb_typeof(candidate) is distinct from 'object' then raise exception 'Invalid candidate' using errcode='22023'; end if;
      legacy:=(candidate->'baseline'->>'contract') is not distinct from '1';
      if legacy then
        sid:=(candidate->>'structure_id')::uuid;
        select club_id into cid from public.admin_catalog_physical_structures where id=sid;
      elsif (candidate->'baseline'->>'contract') is not distinct from '2' then
        cid:=(candidate->>'club_id')::uuid;
      else raise exception 'Unknown proposal contract' using errcode='22023'; end if;
      if cid is null or cid=any(seen) then raise exception 'Invalid or duplicate club' using errcode='22023'; end if;
      seen:=array_append(seen,cid);
      if legacy then
        current_ctx:=public.admin_catalog_multi9_apply(sid,candidate->'baseline',btrim(p_reason));
      else
        current_ctx:=public.admin_catalog_multi9_club_apply(cid,candidate->'baseline',btrim(p_reason));
      end if;
      registered:=registered||jsonb_build_array(current_ctx);
    exception when others then
      get stacked diagnostics code=returned_sqlstate;
      excluded:=excluded||jsonb_build_array(jsonb_build_object('structure_id',candidate->>'structure_id',
        'club_id',cid,'club_name',candidate->>'club_name','code',code,
        'reason',case code when '40001' then 'source_or_revision_changed' when '55P03' then 'source_busy'
          when '23505' then 'collision' when '22023' then 'invalid_candidate' else 'club_validation_failed' end));
    end;
  end loop;
  result:=jsonb_build_object('registered',registered,'excluded',excluded);
  insert into public.admin_catalog_multi9_batches(expected_preview,result,reason) values(p_candidates,result,btrim(p_reason)) returning id into receipt;
  return result||jsonb_build_object('batch_id',receipt);
end $$;

revoke all on function public.admin_catalog_multi9_club_inspect(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_multi9_club_apply(uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_multi9_club_preview(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_multi9_batch_preview(uuid[]) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_multi9_batch_register(jsonb,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_catalog_multi9_club_preview(uuid) to authenticated;
grant execute on function public.admin_catalog_multi9_batch_preview(uuid[]) to authenticated;
grant execute on function public.admin_catalog_multi9_batch_register(jsonb,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
