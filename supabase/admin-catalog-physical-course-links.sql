-- Phase 3a. Apply ONCE after the physical foundation and structure review.
-- No backfill or live writes. Registration and verification require separate RPCs.
begin;

create table public.admin_catalog_physical_course_links (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null,
  club_id uuid not null,
  course_id uuid not null unique references public.course_routes(id) on delete restrict,
  holes_count integer not null check (holes_count in (9,18)),
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot)='object'),
  review_status text not null default 'needs_review' check (review_status in ('needs_review','verified')),
  source_system text not null default 'stablr' check (source_system='stablr'),
  source_reference text not null check (btrim(source_reference)<>''),
  reason text not null check (btrim(reason)<>''),
  revision bigint not null default 1 check (revision>0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (id,structure_id,club_id),
  foreign key (structure_id,club_id) references public.admin_catalog_physical_structures(id,club_id) on delete restrict
);

-- Nullable on older proposals; existing rows are not populated or reclassified.
alter table public.admin_catalog_physical_holes
  add column source_course_link_id uuid,
  add column source_route_hole_id uuid references public.route_holes(id) on delete restrict,
  add column source_position integer check (source_position between 1 and 18),
  add constraint admin_catalog_physical_holes_origin_complete
    check (num_nonnulls(source_course_link_id,source_route_hole_id,source_position) in (0,3)),
  add constraint admin_catalog_physical_holes_origin_fk
    foreign key (source_course_link_id,structure_id,club_id)
    references public.admin_catalog_physical_course_links(id,structure_id,club_id) on delete restrict,
  add constraint admin_catalog_physical_holes_source_hole_key unique (source_route_hole_id),
  add constraint admin_catalog_physical_holes_source_position_key unique (source_course_link_id,source_position);

-- Extend only the foundation audit allowlist; old events are not rewritten.
alter table public.admin_catalog_foundation_events drop constraint admin_catalog_foundation_events_entity_table_check;
alter table public.admin_catalog_foundation_events add constraint admin_catalog_foundation_events_entity_table_check
  check(entity_table in ('admin_catalog_physical_structures','admin_catalog_physical_holes',
    'admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_tee_overrides',
    'admin_catalog_physical_course_links'));

alter table public.admin_catalog_physical_course_links enable row level security;
revoke all on public.admin_catalog_physical_course_links from public,anon,authenticated,service_role;
grant select on public.admin_catalog_physical_course_links to authenticated;
create policy admin_catalog_physical_course_links_admin_read on public.admin_catalog_physical_course_links
  for select to authenticated using(auth.uid() is not null and auth.role()='authenticated' and public.is_admin());
create trigger admin_catalog_physical_course_links_guard before insert or update on public.admin_catalog_physical_course_links
  for each row execute function public.admin_catalog_foundation_guard();
create trigger admin_catalog_physical_course_links_audit after insert or update on public.admin_catalog_physical_course_links
  for each row execute function public.admin_catalog_foundation_audit();
create trigger admin_catalog_physical_course_links_no_delete before delete on public.admin_catalog_physical_course_links
  for each row execute function public.admin_catalog_foundation_no_removal();
create trigger admin_catalog_physical_course_links_no_truncate before truncate on public.admin_catalog_physical_course_links
  for each statement execute function public.admin_catalog_foundation_no_removal();

create function public.admin_catalog_physical_course_source(p_course_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('course',to_jsonb(c),'holes',coalesce((select jsonb_agg(to_jsonb(h)
    order by h.physical_hole_number,h.id) from public.route_holes h where h.route_id=c.id),'[]'::jsonb))
  from public.course_routes c where c.id=p_course_id;
$$;

create function public.admin_catalog_physical_course_inspect(p_structure_id uuid,p_course_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare s public.admin_catalog_physical_structures; c public.course_routes;
  link public.admin_catalog_physical_course_links; source jsonb; mapping jsonb;
  reasons text[]:='{}'; n integer; distinct_n integer; low_n integer; high_n integer; par_ok boolean;
begin
  perform public.admin_catalog_require_admin();
  select * into s from public.admin_catalog_physical_structures where id=p_structure_id;
  if not found then raise exception 'Existing physical structure required' using errcode='22023'; end if;
  if s.review_status<>'verified' or s.classification='non_classificato' then reasons:=array_append(reasons,'unclassified_structure'); end if;
  if p_course_id is not null then
    select * into c from public.course_routes where id=p_course_id;
    if not found or c.club_id<>s.club_id then raise exception 'Source course must belong to the structure club' using errcode='22023'; end if;
    if not c.is_active or not exists(select 1 from public.clubs where id=c.club_id and is_active)
      then reasons:=array_append(reasons,'inactive_source'); end if;
    source:=public.admin_catalog_physical_course_source(c.id);
    if c.source_payload->'gesgolf'->'derived_segment' is not null
      or coalesce(c.source_payload,'{}'::jsonb) ? 'physical_hole_sequence'
      or c.source_payload->>'product_simplification'='physical_9_official_18_variant'
      or (c.source_payload->>'physical_hole_count' in('9','18')
        and c.source_payload->>'physical_hole_count'<>c.holes_count::text) then
      reasons:=array_append(reasons,'derived_source'); end if;
    select count(*),count(distinct physical_hole_number),min(physical_hole_number),max(physical_hole_number),
      coalesce(bool_and(par is not null and par between 3 and 6),false)
      into n,distinct_n,low_n,high_n,par_ok from public.route_holes where route_id=c.id;
    if (s.classification='fisico_9' and c.holes_count<>9) or (s.classification='fisico_18' and c.holes_count<>18)
      or (s.classification='multi_9' and c.holes_count<>9) then reasons:=array_append(reasons,'wrong_cardinality'); end if;
    if n<>c.holes_count then reasons:=array_append(reasons,'incomplete_holes'); end if;
    if distinct_n<>n then reasons:=array_append(reasons,'duplicate_numbers'); end if;
    -- Preserve exact source numbers. A multi-nine may explicitly register 1..9
    -- or 10..18; never shift them to avoid collisions with another source.
    if low_n is null or (s.classification='multi_9' and not(low_n in(1,10) and high_n=low_n+8))
      or (s.classification<>'multi_9' and (low_n<>1 or high_n<>c.holes_count)) then
      reasons:=array_append(reasons,'incomplete_numbers'); end if;
    if not par_ok then reasons:=array_append(reasons,'missing_par'); end if;
    select * into link from public.admin_catalog_physical_course_links where course_id=c.id;
    if link.id is not null and link.structure_id<>s.id then reasons:=array_append(reasons,'already_linked_elsewhere'); end if;
    if link.id is null then
      if (s.classification<>'multi_9' and exists(select 1 from public.admin_catalog_physical_course_links where structure_id=s.id))
        or exists(select 1 from public.admin_catalog_playable_configurations cfg where cfg.legacy_course_route_id=c.id
          and (cfg.structure_id is distinct from s.id or cfg.relationship_kind='derived')) then
        reasons:=array_append(reasons,'already_linked_elsewhere'); end if;
      if exists(select 1 from public.admin_catalog_physical_holes h join public.route_holes rh
        on rh.route_id=c.id and (h.source_route_hole_id=rh.id or (h.structure_id=s.id and h.physical_number=rh.physical_hole_number)))
        then reasons:=array_append(reasons,'physical_numbers_in_use'); end if;
    else
      select coalesce(jsonb_agg(jsonb_build_object('position',h.source_position,'source_hole_id',h.source_route_hole_id,
        'physical_hole_id',h.id,'physical_number',h.physical_number,'base_par',h.base_par,'revision',h.revision)
        order by h.source_position),'[]'::jsonb) into mapping
        from public.admin_catalog_physical_holes h where h.source_course_link_id=link.id;
      if link.source_snapshot is distinct from source then reasons:=array_append(reasons,'source_changed'); end if;
      if jsonb_array_length(mapping)<>c.holes_count or exists(select 1 from public.admin_catalog_physical_holes h
        left join public.route_holes rh on rh.id=h.source_route_hole_id and rh.route_id=c.id
        where h.source_course_link_id=link.id and (h.structure_id<>s.id or h.club_id<>s.club_id
          or h.review_status<>'verified' or rh.id is null or h.physical_number<>rh.physical_hole_number or h.base_par<>rh.par
          or h.source_position<>(select count(*) from public.route_holes before_h where before_h.route_id=c.id
            and before_h.physical_hole_number<=rh.physical_hole_number))) then reasons:=array_append(reasons,'invalid_saved_mapping'); end if;
    end if;
  end if;
  return jsonb_build_object('structure',to_jsonb(s),'source',source,'link',case when link.id is not null then to_jsonb(link) else null end,
    'mapping',coalesce(mapping,'[]'::jsonb),'reasons',to_jsonb(reasons),
    'can_register',p_course_id is not null and cardinality(reasons)=0 and link.id is null,
    'can_verify',p_course_id is not null and cardinality(reasons)=0 and link.id is not null and link.review_status='needs_review',
    'courses',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'holes_count',r.holes_count,'source_system',r.source_system)
      order by r.name,r.id) from public.course_routes r where r.club_id=s.club_id and r.is_active),'[]'::jsonb),
    'physical_holes',coalesce((select jsonb_agg(to_jsonb(h) order by h.physical_number,h.id)
      from public.admin_catalog_physical_holes h where h.structure_id=s.id),'[]'::jsonb),
    'links',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at,l.id)
      from public.admin_catalog_physical_course_links l where l.structure_id=s.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id)
      from public.admin_catalog_foundation_events e where
      (e.entity_table='admin_catalog_physical_course_links' and exists(select 1 from public.admin_catalog_physical_course_links l
        where l.id=e.entity_id and l.structure_id=s.id))
      or (e.entity_table='admin_catalog_physical_holes' and exists(select 1 from public.admin_catalog_physical_holes h
        where h.id=e.entity_id and h.structure_id=s.id))),'[]'::jsonb));
end;
$$;

create function public.admin_catalog_physical_course_preview(p_structure_id uuid,p_course_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  perform public.admin_catalog_require_admin();
  return public.admin_catalog_physical_course_inspect(p_structure_id,p_course_id);
end;
$$;

create function public.admin_catalog_physical_course_register(p_structure_id uuid,p_course_id uuid,
  p_expected_structure_revision bigint,p_expected_source jsonb,p_reason text,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.admin_catalog_physical_structures; context jsonb; link public.admin_catalog_physical_course_links;
  h record;
begin
  perform public.admin_catalog_require_admin();
  if p_confirm is distinct from true or nullif(btrim(p_reason),'') is null then
    raise exception 'Explicit confirmation and review note required' using errcode='22023'; end if;
  -- Lock before reading the source. Blocks inserts/deletes as well as updates,
  -- with the same live lock order as the existing hole publisher; no live DML.
  lock table public.route_holes in share mode nowait;
  lock table public.admin_catalog_physical_holes in share row exclusive mode nowait;
  perform id from public.course_routes where id=p_course_id for share nowait;
  perform c.id from public.clubs c join public.course_routes r on r.club_id=c.id where r.id=p_course_id for share of c nowait;
  select * into s from public.admin_catalog_physical_structures where id=p_structure_id for update nowait;
  if not found or p_expected_structure_revision is null or s.revision<>p_expected_structure_revision then
    raise exception 'Structure revision changed' using errcode='40001'; end if;
  context:=public.admin_catalog_physical_course_inspect(s.id,p_course_id);
  if p_expected_source is null or context->'source' is distinct from p_expected_source then
    raise exception 'Source changed since preview' using errcode='40001'; end if;
  if (context->>'can_register')::boolean is distinct from true then
    raise exception 'Incompatible physical source: %',context->'reasons' using errcode='23514'; end if;
  insert into public.admin_catalog_physical_course_links(structure_id,club_id,course_id,holes_count,source_snapshot,source_reference,reason)
    values(s.id,s.club_id,p_course_id,(context->'source'->'course'->>'holes_count')::integer,p_expected_source,
      'course_routes:'||p_course_id::text,btrim(p_reason)) returning * into link;
  for h in select rh.*,row_number() over(order by rh.physical_hole_number,rh.id)::integer position
    from public.route_holes rh where rh.route_id=p_course_id order by rh.physical_hole_number,rh.id loop
    insert into public.admin_catalog_physical_holes(structure_id,club_id,physical_number,label,base_par,review_status,
      source_system,source_reference,reason,source_course_link_id,source_route_hole_id,source_position)
      values(s.id,s.club_id,h.physical_hole_number,'Buca '||h.physical_hole_number::text,h.par,'verified','stablr',
        'course_routes:'||p_course_id::text||';route_holes:'||h.id::text,btrim(p_reason),link.id,h.id,h.position);
  end loop;
  return public.admin_catalog_physical_course_inspect(s.id,p_course_id);
end;
$$;

create function public.admin_catalog_physical_course_verify(p_link_id uuid,p_expected_revision bigint,
  p_expected_mapping jsonb,p_reason text,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare link public.admin_catalog_physical_course_links; context jsonb;
begin
  perform public.admin_catalog_require_admin();
  if p_confirm is distinct from true or nullif(btrim(p_reason),'') is null then
    raise exception 'Explicit confirmation and review note required' using errcode='22023'; end if;
  select * into link from public.admin_catalog_physical_course_links where id=p_link_id;
  if not found then raise exception 'Registered source required' using errcode='22023'; end if;
  lock table public.route_holes in share mode nowait;
  lock table public.admin_catalog_physical_holes in share row exclusive mode nowait;
  perform id from public.course_routes where id=link.course_id for share nowait;
  perform c.id from public.clubs c where c.id=link.club_id for share nowait;
  perform id from public.admin_catalog_physical_structures where id=link.structure_id for update nowait;
  select * into link from public.admin_catalog_physical_course_links where id=p_link_id for update nowait;
  if p_expected_revision is null or link.revision<>p_expected_revision then raise exception 'Link revision changed' using errcode='40001'; end if;
  context:=public.admin_catalog_physical_course_inspect(link.structure_id,link.course_id);
  if p_expected_mapping is null or context->'mapping' is distinct from p_expected_mapping then
    raise exception 'Mapping changed since preview' using errcode='40001'; end if;
  if (context->>'can_verify')::boolean is distinct from true then
    raise exception 'Unverifiable physical mapping: %',context->'reasons' using errcode='23514'; end if;
  update public.admin_catalog_physical_course_links set review_status='verified',reason=btrim(p_reason) where id=link.id;
  return public.admin_catalog_physical_course_inspect(link.structure_id,link.course_id);
end;
$$;

revoke all on function public.admin_catalog_physical_course_source(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_physical_course_inspect(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_physical_course_preview(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_physical_course_register(uuid,uuid,bigint,jsonb,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_physical_course_verify(uuid,bigint,jsonb,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_catalog_physical_course_preview(uuid,uuid) to authenticated;
grant execute on function public.admin_catalog_physical_course_register(uuid,uuid,bigint,jsonb,text,boolean) to authenticated;
grant execute on function public.admin_catalog_physical_course_verify(uuid,bigint,jsonb,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
