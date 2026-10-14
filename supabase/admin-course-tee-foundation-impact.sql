-- Incremental, one-shot. Requires admin-course-tee-crud.sql and the existing
-- physical foundation/data-origin/tee-classification contracts. No data DML.
begin;

-- Keep the exact existing preview/publisher validations; add information only.
alter function public.admin_course_tee_preview_draft(uuid) rename to admin_course_tee_preview_without_impact;
revoke all on function public.admin_course_tee_preview_without_impact(uuid) from public,anon,authenticated,service_role;

create function public.admin_course_tee_preview_draft(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); plan jsonb; d public.admin_catalog_drafts;
  target_course_id uuid; target_club_id uuid; g jsonb; configs jsonb; changing boolean; incomplete integer; verified integer; classification_count integer;
begin
  plan:=public.admin_course_tee_preview_without_impact(p_draft_id);
  select * into d from public.admin_catalog_drafts where draft_id=p_draft_id and created_by=actor and workflow_status='draft' and entity_type='route_tee';
  if d.draft_id is null then raise exception 'Owned open tee draft required' using errcode='42501';end if;
  target_course_id:=(plan#>>'{context,course,id}')::uuid;target_club_id:=(plan#>>'{context,course,club_id}')::uuid;
  changing:=(plan->>'is_new')::boolean or plan->'diff'<>'{}'::jsonb;
  g:=public.admin_catalog_data_origin(target_club_id);
  select count(*) filter(where c.review_status='verified'),count(*) filter(where c.review_status<>'verified') into verified,incomplete
    from public.admin_catalog_playable_configurations c where c.club_id=target_club_id and c.legacy_course_route_id=target_course_id;

  -- Exact live FK and verified parent/component IDs only. A tee snapshot stores
  -- ALL scopes on a course, so changing a nine tee also affects that recorded
  -- eighteen configuration baseline. Descendants can depend on the parent's
  -- verification fingerprint. This is not a tee-to-tee metadata relationship.
  with recursive affected(id) as (
    select c.id from public.admin_catalog_playable_configurations c
      where changing and c.club_id=target_club_id and c.review_status='verified' and c.legacy_course_route_id=target_course_id and (
        c.registration_snapshot ? 'route_tees'
        or ((plan->>'is_new')::boolean and c.holes_count=(plan#>>'{context,course,holes_count}')::integer)
        or exists(select 1 from public.admin_catalog_tee_classifications cl where cl.configuration_id=c.id
          and cl.entity_type='route_tee' and cl.live_tee_id=d.live_entity_id and (
            cl.baseline->'course_rating' is distinct from plan#>'{fields,course_rating}'
            or cl.baseline->'slope_rating' is distinct from plan#>'{fields,slope_rating}'
            or cl.baseline->'applicability' is distinct from plan#>'{fields,gender}'
            or cl.baseline->'is_active' is distinct from plan#>'{fields,is_active}')))
    union
    select c.id from public.admin_catalog_playable_configurations c join affected a on (
      c.parent_configuration_id=a.id or exists(select 1 from public.admin_catalog_configuration_components cp
        where cp.configuration_id=c.id and cp.parent_configuration_id=a.id and cp.review_status='verified'))
      where c.club_id=target_club_id and c.review_status='verified'
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'label',c.label,'holes_count',c.holes_count,'revision',c.revision,
    'relationship_kind',c.relationship_kind,'source_state',x->'source_state','tee_state',x->'tee_state',
    'reason',case when c.legacy_course_route_id=target_course_id and c.registration_snapshot ? 'route_tees' then 'recorded_tee_baseline'
      when c.legacy_course_route_id=target_course_id and (plan->>'is_new')::boolean then 'new_tee_unclassified'
      when c.legacy_course_route_id=target_course_id then 'tee_classification_baseline' else 'verified_dependency_baseline' end)
      order by c.holes_count,c.label,c.id),'[]') into configs
    from affected a join public.admin_catalog_playable_configurations c on c.id=a.id
      left join lateral (select value from jsonb_array_elements(g->'configurations') where value->>'id'=c.id::text) states(x) on true;
  select count(*) into classification_count from public.admin_catalog_tee_classifications cl
    where cl.club_id=target_club_id and exists(select 1 from jsonb_array_elements(configs) x where x->>'id'=cl.configuration_id::text);
  return plan||jsonb_build_object('foundation_impact',jsonb_build_object(
    'may_block_par',changing and jsonb_array_length(configs)>0,'configurations',configs,'classification_count',classification_count,
    'coverage',case when verified=0 or incomplete>0 then 'incomplete' else 'verified_links' end,
    'unverified_configuration_count',incomplete,'baselines_updated',false));
end;
$$;

revoke all on function public.admin_course_tee_preview_draft(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_course_tee_preview_draft(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
