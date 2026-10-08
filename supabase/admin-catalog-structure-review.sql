-- Phase 2. Apply ONCE, after admin-catalog-physical-foundation.sql.
-- Read-only Admin queue and evidence; no backfill, grants on tables or writes.
begin;

create function public.admin_catalog_structure_review_queue()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare result jsonb;
begin
  perform public.admin_catalog_require_admin();
  with candidates as (
    select 'structure'::text target_type,c.id target_id,c.id club_id,c.name club_name,c.name title,
      case when exists(select 1 from public.admin_catalog_physical_structures s
        where s.club_id=c.id and s.review_status='verified' and s.classification<>'non_classificato')
        then 'verified' else 'needs_review' end status,
      (select s.classification from public.admin_catalog_physical_structures s where s.club_id=c.id
        order by (s.review_status='verified') desc,s.updated_at desc,s.id limit 1) classification,
      c.source_system, null::integer verified_hole_count,null::integer holes_count
    from public.clubs c where c.is_active
    union all
    select 'hole_links',r.id,c.id,c.name,r.name,
      case when exists(select 1 from public.admin_catalog_playable_configurations cfg
        where cfg.legacy_combination_id=r.id and cfg.club_id=c.id and cfg.review_status='verified'
          and cfg.holes_count=r.holes_count
          and (select count(*) from public.admin_catalog_configuration_holes h
            join public.admin_catalog_physical_holes p on p.id=h.physical_hole_id
              and p.structure_id=h.structure_id and p.club_id=h.club_id and p.review_status='verified'
            where h.configuration_id=cfg.id and h.structure_id=cfg.structure_id
              and h.review_status='verified' and h.position between 1 and cfg.holes_count)=cfg.holes_count)
        then 'verified' else 'needs_review' end,
      null,r.source_system,
      coalesce((select max(n.linked)::integer from (
        select count(h.id) filter(where h.review_status='verified' and p.review_status='verified'
          and h.structure_id=cfg.structure_id and p.structure_id=h.structure_id
          and p.club_id=h.club_id and h.position between 1 and cfg.holes_count) linked
        from public.admin_catalog_playable_configurations cfg
        left join public.admin_catalog_configuration_holes h on h.configuration_id=cfg.id
        left join public.admin_catalog_physical_holes p on p.id=h.physical_hole_id
        where cfg.legacy_combination_id=r.id and cfg.club_id=c.id
        group by cfg.id) n),0),r.holes_count
    from public.route_combinations r join public.clubs c on c.id=r.club_id
    where c.is_active and r.is_active
  )
  select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(q)
    order by q.club_name,q.target_type,q.title,q.target_id),'[]'::jsonb)) into result from candidates q;
  return result;
end;
$$;

create function public.admin_catalog_structure_review_detail(p_target_type text,p_target_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare c public.clubs; r public.route_combinations; result jsonb;
begin
  perform public.admin_catalog_require_admin();
  if p_target_type='structure' then
    select * into c from public.clubs where id=p_target_id and is_active;
    if not found then raise exception 'Club unavailable' using errcode='22023'; end if;
  elsif p_target_type='hole_links' then
    select * into r from public.route_combinations where id=p_target_id and is_active;
    if not found then raise exception 'Combination unavailable' using errcode='22023'; end if;
    select * into c from public.clubs where id=r.club_id and is_active;
    if not found then raise exception 'Club unavailable' using errcode='22023'; end if;
  else raise exception 'Unsupported review target' using errcode='22023';
  end if;

  select jsonb_build_object(
    'target_type',p_target_type,'target_id',p_target_id,
    'club',to_jsonb(c),'combination',case when p_target_type='hole_links' then to_jsonb(r) else null end,
    'structures',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at,s.id)
      from public.admin_catalog_physical_structures s where s.club_id=c.id),'[]'::jsonb),
    'configurations',coalesce((select jsonb_agg(to_jsonb(cfg) || jsonb_build_object('holes',
      coalesce((select jsonb_agg(to_jsonb(h) order by h.position)
        from public.admin_catalog_configuration_holes h where h.configuration_id=cfg.id),'[]'::jsonb))
      order by cfg.created_at,cfg.id) from public.admin_catalog_playable_configurations cfg
      where cfg.club_id=c.id and (p_target_type='structure' or cfg.legacy_combination_id=r.id)),'[]'::jsonb),
    'courses',coalesce((select jsonb_agg(to_jsonb(cr) || jsonb_build_object('holes',
      coalesce((select jsonb_agg(to_jsonb(h) order by h.physical_hole_number)
        from public.route_holes h where h.route_id=cr.id),'[]'::jsonb)) order by cr.name,cr.id)
      from public.course_routes cr where cr.club_id=c.id),'[]'::jsonb),
    'combinations',coalesce((select jsonb_agg(to_jsonb(rc) || jsonb_build_object('holes',
      coalesce((select jsonb_agg(to_jsonb(h) || jsonb_build_object('exact_legacy_reference_exists',
        exists(select 1 from public.route_holes ph join public.course_routes origin on origin.id=ph.route_id
          where ph.route_id=h.route_id and ph.physical_hole_number=h.physical_hole_number and origin.club_id=c.id))
        order by h.round_hole_number) from public.route_combination_holes h
        where h.route_combination_id=rc.id),'[]'::jsonb)) order by rc.name,rc.id)
      from public.route_combinations rc where rc.club_id=c.id
      and (p_target_type='structure' or rc.id=r.id)),'[]'::jsonb),
    -- Only the existing FIG foreign key is followed. No name/Par/position match.
    'fig', (select to_jsonb(fc) || jsonb_build_object(
      'courses',coalesce((select jsonb_agg(to_jsonb(fpc) order by fpc.name,fpc.id)
        from public.fig_playable_courses fpc where fpc.fig_club_id=fc.id),'[]'::jsonb),
      'import_batch',(select to_jsonb(b) from public.fig_import_batches b where b.id=fc.import_batch_id))
      from public.fig_clubs fc where fc.id=c.fig_club_id),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id)
      from public.admin_catalog_foundation_events e where
      (e.entity_table='admin_catalog_physical_structures' and exists(select 1 from public.admin_catalog_physical_structures s
        where s.id=e.entity_id and s.club_id=c.id))
      or (e.entity_table='admin_catalog_physical_holes' and exists(select 1 from public.admin_catalog_physical_holes h
        where h.id=e.entity_id and h.club_id=c.id))
      or (e.entity_table='admin_catalog_playable_configurations' and exists(select 1 from public.admin_catalog_playable_configurations cfg
        where cfg.id=e.entity_id and cfg.club_id=c.id and (p_target_type='structure' or cfg.legacy_combination_id=r.id)))
      or (e.entity_table='admin_catalog_configuration_holes' and exists(select 1 from public.admin_catalog_configuration_holes h
        join public.admin_catalog_playable_configurations cfg on cfg.id=h.configuration_id
        where h.id=e.entity_id and cfg.club_id=c.id and (p_target_type='structure' or cfg.legacy_combination_id=r.id)))
      or (e.entity_table='admin_catalog_tee_overrides' and exists(select 1 from public.admin_catalog_tee_overrides t
        join public.admin_catalog_playable_configurations cfg on cfg.id=t.configuration_id
        where t.id=e.entity_id and cfg.club_id=c.id and (p_target_type='structure' or cfg.legacy_combination_id=r.id)))),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.admin_catalog_structure_review_queue() from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_structure_review_detail(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_catalog_structure_review_queue() to authenticated;
grant execute on function public.admin_catalog_structure_review_detail(text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
