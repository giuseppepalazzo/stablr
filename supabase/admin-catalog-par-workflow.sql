-- Safe Par workflow, incremental/one-shot AFTER physical-par-source-drafts.
-- No backfill. Preview and approval NEVER change the live catalog.
begin;

create table public.admin_catalog_par_targets (
  target_type text not null check(target_type in ('course','combination')),
  target_id uuid not null,
  club_id uuid not null,
  topology_hash text not null check(topology_hash ~ '^[a-f0-9]{64}$'),
  decision text not null check(decision in ('physical','local','override')),
  note text not null check(length(btrim(note)) between 1 and 2000),
  actor_id uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default clock_timestamp(),
  primary key(target_type,target_id,topology_hash)
);
create table public.admin_catalog_par_workflow_batches (
  id uuid primary key default gen_random_uuid(),
  proposal_hash text not null unique check(proposal_hash ~ '^[a-f0-9]{64}$'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  note text not null check(length(btrim(note)) between 1 and 2000),
  result jsonb not null,
  confirmed_at timestamptz not null default clock_timestamp()
);
create table public.admin_catalog_local_par_drafts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  target_type text not null check(target_type in ('course','combination')),
  target_id uuid not null,
  hole_id uuid not null,
  new_par integer not null check(new_par between 3 and 6),
  create_override boolean not null default false,
  base_hash text not null check(base_hash ~ '^[a-f0-9]{64}$'),
  revision bigint not null default 1 check(revision>0),
  status text not null default 'draft' check(status in ('draft','publishing','published','archived')),
  publication_xid bigint,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check((status='publishing')=(publication_xid is not null))
);
create unique index admin_catalog_local_par_owner on public.admin_catalog_local_par_drafts(target_type,hole_id,actor_id) where status='draft';
create table public.admin_catalog_local_par_versions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  draft_id uuid not null unique references public.admin_catalog_local_par_drafts(id) on delete restrict,
  target_type text not null check(target_type in ('course','combination')),
  target_id uuid not null,
  before_values jsonb not null,
  after_values jsonb not null,
  diff jsonb not null,
  origin_after_hash text not null check(origin_after_hash ~ '^[a-f0-9]{64}$'),
  verified_link_ids uuid[] not null,
  verified_configuration_ids uuid[] not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  note text not null check(length(btrim(note)) between 1 and 2000),
  published_at timestamptz not null default clock_timestamp()
);
do $$ declare n text;begin
  foreach n in array array['admin_catalog_par_targets','admin_catalog_par_workflow_batches','admin_catalog_local_par_drafts','admin_catalog_local_par_versions'] loop
    execute format('alter table public.%I enable row level security',n);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
    execute format('create trigger %I before delete on public.%I for each row execute function public.admin_catalog_foundation_no_removal()',n||'_no_delete',n);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.admin_catalog_foundation_no_removal()',n||'_no_truncate',n);
    if n<>'admin_catalog_local_par_drafts' then
      execute format('create trigger %I before update on public.%I for each row execute function public.admin_catalog_foundation_no_removal()',n||'_immutable',n);
    end if;
  end loop;
end $$;

alter function public.admin_catalog_par_lock(uuid) rename to admin_catalog_par_lock_before_workflow;
create function public.admin_catalog_par_lock(p_club_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$ begin
  perform public.admin_catalog_require_admin();
  perform public.admin_catalog_par_lock_before_workflow(p_club_id);
  lock table public.clubs in share mode nowait;
  lock table public.admin_catalog_par_targets,public.admin_catalog_par_workflow_batches,
    public.admin_catalog_local_par_drafts,public.admin_catalog_local_par_versions in share row exclusive mode nowait;
end $$;
revoke all on function public.admin_catalog_par_lock_before_workflow(uuid),public.admin_catalog_par_lock(uuid) from public,anon,authenticated,service_role;

-- A publication anchor does not rewrite registration snapshots. Physical and
-- local publications use the SAME whole-graph seal, newest first.
create or replace function public.admin_catalog_data_origin(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare g jsonb; v record;
begin
  perform public.admin_catalog_require_admin();
  g:=public.admin_catalog_data_origin_registration(p_club_id);
  select * into v from (
    select origin_after_hash,verified_link_ids,verified_configuration_ids,published_at,id from public.admin_catalog_par_versions where club_id=p_club_id
    union all select origin_after_hash,verified_link_ids,verified_configuration_ids,published_at,id from public.admin_catalog_local_par_versions where club_id=p_club_id
  ) x order by published_at desc,id desc limit 1;
  if found and v.origin_after_hash=public.admin_catalog_par_hash(g-array['read_at','publication','drafts']) then
    g:=jsonb_set(g,'{physical_links}',(select coalesce(jsonb_agg(case when (x->>'id')::uuid=any(v.verified_link_ids) then x||jsonb_build_object('source_state','matched') else x end order by x->>'id'),'[]') from jsonb_array_elements(g->'physical_links') x));
    g:=jsonb_set(g,'{configurations}',(select coalesce(jsonb_agg(case when (x->>'id')::uuid=any(v.verified_configuration_ids) then x||jsonb_build_object('source_state','matched','tee_state','matched') else x end order by x->>'id'),'[]') from jsonb_array_elements(g->'configurations') x));
  end if;
  return g;
end $$;

-- Exact identities, not names/Par/offsets. This helper is private; public
-- results contain only the allowlisted grid, modes and a technical hash.
create function public.admin_catalog_par_graph_scope(p_g jsonb,p_configurations uuid[])
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare ids uuid[]:=p_configurations; expanded uuid[]; physical_ids uuid[]; link_ids uuid[]; courses uuid[]; combinations uuid[]; result jsonb:=p_g;
begin
  perform public.admin_catalog_require_admin();
  loop
    expanded:=array(select distinct id from (
      select unnest(ids) id
      union all select (c->>'parent_configuration_id')::uuid from jsonb_array_elements(p_g->'configurations') c where (c->>'id')::uuid=any(ids) and c->>'parent_configuration_id' is not null
      union all select (cp->>'parent_configuration_id')::uuid from jsonb_array_elements(p_g->'components') cp where (cp->>'configuration_id')::uuid=any(ids)
      union all select (c->>'id')::uuid from jsonb_array_elements(p_g->'configurations') c
        join jsonb_array_elements(p_g->'configuration_holes') s on (s->>'configuration_id')::uuid=any(ids)
        join jsonb_array_elements(p_g->'physical_holes') ph on ph->>'id'=s->>'physical_hole_id'
        join jsonb_array_elements(p_g->'physical_links') l on l->>'id'=ph->>'source_course_link_id'
        where c->>'legacy_course_route_id'=l->>'course_id'
    ) x where id is not null order by id);
    exit when expanded=ids;ids:=expanded;
  end loop;
  physical_ids:=array(select distinct (s->>'physical_hole_id')::uuid from jsonb_array_elements(p_g->'configuration_holes') s where (s->>'configuration_id')::uuid=any(ids));
  link_ids:=array(select distinct (h->>'source_course_link_id')::uuid from jsonb_array_elements(p_g->'physical_holes') h where (h->>'id')::uuid=any(physical_ids));
  courses:=array(select distinct id from (
    select (c->>'legacy_course_route_id')::uuid id from jsonb_array_elements(p_g->'configurations') c where (c->>'id')::uuid=any(ids)
    union all select (l->>'course_id')::uuid from jsonb_array_elements(p_g->'physical_links') l where (l->>'id')::uuid=any(link_ids)
  ) x where id is not null);
  combinations:=array(select (c->>'legacy_combination_id')::uuid from jsonb_array_elements(p_g->'configurations') c where (c->>'id')::uuid=any(ids) and c->>'legacy_combination_id' is not null);
  result:=result||jsonb_build_object(
    'structures',(select coalesce(jsonb_agg(c order by c->>'id'),'[]') from jsonb_array_elements(p_g->'structures') c where exists(select 1 from jsonb_array_elements(p_g->'configurations') cfg where (cfg->>'id')::uuid=any(ids) and cfg->>'structure_id'=c->>'id')),
    'configurations',(select coalesce(jsonb_agg(c order by c->>'id'),'[]') from jsonb_array_elements(p_g->'configurations') c where (c->>'id')::uuid=any(ids)),
    'configuration_holes',(select coalesce(jsonb_agg(c order by c->>'id'),'[]') from jsonb_array_elements(p_g->'configuration_holes') c where (c->>'configuration_id')::uuid=any(ids)),
    'components',(select coalesce(jsonb_agg(c order by c->>'id'),'[]') from jsonb_array_elements(p_g->'components') c where (c->>'configuration_id')::uuid=any(ids)),
    'physical_holes',(select coalesce(jsonb_agg(c order by c->>'id'),'[]') from jsonb_array_elements(p_g->'physical_holes') c where (c->>'id')::uuid=any(physical_ids)),
    'physical_links',(select coalesce(jsonb_agg(c order by c->>'id'),'[]') from jsonb_array_elements(p_g->'physical_links') c where (c->>'id')::uuid=any(link_ids)),
    'courses',(select coalesce(jsonb_agg(c order by c->>'id'),'[]') from jsonb_array_elements(p_g->'courses') c where (c->>'id')::uuid=any(courses)),
    'course_holes',(select coalesce(jsonb_agg(c order by c->>'id'),'[]') from jsonb_array_elements(p_g->'course_holes') c where (c->>'route_id')::uuid=any(courses)),
    'combinations',(select coalesce(jsonb_agg(c order by c->>'id'),'[]') from jsonb_array_elements(p_g->'combinations') c where (c->>'id')::uuid=any(combinations)),
    'combination_holes',(select coalesce(jsonb_agg(c order by c->>'id'),'[]') from jsonb_array_elements(p_g->'combination_holes') c where (c->>'route_combination_id')::uuid=any(combinations)),
    'route_tees',(select coalesce(jsonb_agg(c order by c->>'id'),'[]') from jsonb_array_elements(p_g->'route_tees') c where (c->>'route_id')::uuid=any(courses)),
    'combination_tees',(select coalesce(jsonb_agg(c order by c->>'id'),'[]') from jsonb_array_elements(p_g->'combination_tees') c where (c->>'route_combination_id')::uuid=any(combinations)),
    'tee_overrides',(select coalesce(jsonb_agg(c order by c->>'id'),'[]') from jsonb_array_elements(p_g->'tee_overrides') c where (c->>'configuration_id')::uuid=any(ids)));
  return result;
end $$;

create function public.admin_catalog_par_target(p_type text,p_target uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare r jsonb; holes jsonb; topology jsonb; cfgs jsonb; links jsonb; reasons text[]:='{}'; mode text:='local'; n integer; total integer; g jsonb;
begin
  perform public.admin_catalog_require_admin();
  if p_type='course' then
    select jsonb_build_object('id',id,'club_id',club_id,'label',name,'holes_count',holes_count,'total_par',total_par,'is_active',is_active,'updated_at',updated_at) into r from public.course_routes where id=p_target;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'number',physical_hole_number,'par',par,'si',stroke_index) order by physical_hole_number,id),'[]') into holes from public.route_holes where route_id=p_target;
  elsif p_type='combination' then
    select jsonb_build_object('id',id,'club_id',club_id,'label',name,'holes_count',holes_count,'total_par',total_par,'is_active',is_active,'updated_at',updated_at) into r from public.route_combinations where id=p_target;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'number',round_hole_number,'par',par,'si',stroke_index,'route_id',route_id,'physical_number',physical_hole_number,'route_position',route_position) order by round_hole_number,id),'[]') into holes from public.route_combination_holes where route_combination_id=p_target;
    if exists(select 1 from public.route_combination_holes h where h.route_combination_id=p_target and (select count(*) from public.route_holes rh where rh.route_id=h.route_id and rh.physical_hole_number=h.physical_hole_number)<>1) then reasons:=array_append(reasons,'non_unique_exact_reference');end if;
    if exists(select 1 from public.route_combinations c where c.id=p_target and (
      not exists(select 1 from public.course_routes f join public.course_routes b on b.id=c.back_route_id where f.id=c.front_route_id and f.club_id=c.club_id and b.club_id=c.club_id)
      or (select count(*) from public.route_combination_holes h where h.route_combination_id=c.id and h.route_position=1)<>9
      or (select count(*) from public.route_combination_holes h where h.route_combination_id=c.id and h.route_position=2)<>9
      or (select count(distinct (h.route_id,h.physical_hole_number)) from public.route_combination_holes h where h.route_combination_id=c.id)<>18
      or exists(select 1 from public.route_combination_holes h where h.route_combination_id=c.id and (h.route_position not in (1,2) or h.route_id is distinct from case h.route_position when 1 then c.front_route_id else c.back_route_id end)))) then reasons:=array_append(reasons,'non_unique_exact_reference');end if;
  else raise exception 'Exact target type required' using errcode='22023';end if;
  if r is null then raise exception 'Existing target required' using errcode='22023';end if;
  if p_type='course' and exists(select 1 from public.course_routes c where c.id=p_target and c.source_payload->'tee_specific_hole_matrix' is not null and c.source_payload->'tee_specific_hole_matrix'<>'null'::jsonb) then reasons:=array_append(reasons,'unverified_or_changed_dependencies');end if;
  n:=(r->>'holes_count')::integer;
  select sum((x->>'par')::integer) into total from jsonb_array_elements(holes) x;
  if n not in (9,18) or jsonb_array_length(holes)<>n
    or (select count(distinct x->>'number') from jsonb_array_elements(holes) x where (x->>'number')::integer between 1 and n)<>n
    or (select count(distinct x->>'si') from jsonb_array_elements(holes) x where (x->>'si')::integer between 1 and 18)<>n
    or exists(select 1 from jsonb_array_elements(holes) x where x->>'par' is null or (x->>'par')::integer not between 3 and 6)
    then reasons:=array_append(reasons,'incomplete_configuration_grid');end if;
  if total is distinct from (r->>'total_par')::integer then reasons:=array_append(reasons,'live_total_diverges');end if;
  if r->>'is_active'<>'true' or not exists(select 1 from public.clubs where id=(r->>'club_id')::uuid and is_active) then reasons:=array_append(reasons,'inactive_target');end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'review_status',c.review_status,'holes_count',c.holes_count) order by c.id),'[]') into cfgs
    from public.admin_catalog_playable_configurations c where (p_type='course' and c.legacy_course_route_id=p_target) or (p_type='combination' and c.legacy_combination_id=p_target);
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'configuration_id',h.configuration_id,'review_status',h.review_status,'physical_hole_id',h.physical_hole_id,'position',h.position,'occurrence',h.occurrence,'live_hole_id',coalesce(h.legacy_route_hole_id,h.legacy_combination_hole_id)) order by h.id),'[]') into links
    from public.admin_catalog_configuration_holes h where (p_type='course' and h.legacy_route_hole_id in(select id from public.route_holes where route_id=p_target)) or (p_type='combination' and h.legacy_combination_hole_id in(select id from public.route_combination_holes where route_combination_id=p_target));
  if jsonb_array_length(cfgs)>0 or jsonb_array_length(links)>0 or (p_type='course' and exists(select 1 from public.admin_catalog_physical_course_links where course_id=p_target)) then
    mode:='override';g:=public.admin_catalog_data_origin((r->>'club_id')::uuid);
    if exists(select 1 from public.admin_catalog_physical_holes ph where ph.source_route_hole_id in(select (x->>'id')::uuid from jsonb_array_elements(holes) x)) and p_type='course' then mode:='physical';end if;
    if not exists(select 1 from jsonb_array_elements(cfgs) c where (c->>'holes_count')::integer=n and c->>'review_status'='verified')
      or exists(select 1 from jsonb_array_elements(cfgs) c where c->>'review_status'<>'verified')
      or exists(select 1 from jsonb_array_elements(links) l where l->>'review_status'<>'verified') then reasons:=array_append(reasons,'configuration_not_verified');end if;
    if mode='override' and (jsonb_array_length(cfgs)<>1 or jsonb_array_length(links)<>n or
      (select count(distinct l->>'live_hole_id') from jsonb_array_elements(links) l)<>n) then reasons:=array_append(reasons,'shared_live_rows_no_local_override');end if;
    if exists(select 1 from jsonb_array_elements(g->'configurations') c join jsonb_array_elements(cfgs) t on t->>'id'=c->>'id' where c->>'source_state'<>'matched' or c->>'tee_state' not in ('matched','not_recorded')) then reasons:=array_append(reasons,'source_or_tee_base_changed');end if;
    reasons:=reasons||public.admin_catalog_par_graph_check(public.admin_catalog_par_graph_scope(g,array(select (c->>'id')::uuid from jsonb_array_elements(cfgs) c)));
  end if;
  topology:=jsonb_build_object('type',p_type,'id',p_target,'club',r->'club_id','holes_count',n,
    'holes',(select jsonb_agg(x-array['par','si'] order by x->>'id') from jsonb_array_elements(holes) x),'configurations',cfgs,'links',links,'mode',mode);
  return jsonb_build_object('type',p_type,'target',r,'holes',holes,'mode',mode,'reasons',to_jsonb(reasons),'topology_hash',public.admin_catalog_par_hash(topology),
    'approved',exists(select 1 from public.admin_catalog_par_targets t where t.target_type=p_type and t.target_id=p_target and t.topology_hash=public.admin_catalog_par_hash(topology)));
end $$;

create function public.admin_catalog_par_target_summary(p_target jsonb)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('type',p_target->'type','target',p_target->'target','mode',p_target->'mode',
    'approved',p_target->'approved','topology_hash',p_target->'topology_hash','baseline_hash',public.admin_catalog_par_hash(p_target));
$$;

create function public.admin_catalog_par_is_autonomous(p_type text,p_target uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
declare t jsonb;
begin
  perform public.admin_catalog_require_admin();t:=public.admin_catalog_par_target(p_type,p_target);
  return t->>'mode'='local' and t->>'approved'='true' and jsonb_array_length(t->'reasons')=0;
end $$;

create function public.admin_catalog_par_workflow_preview()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare club record; r record; t jsonb; p jsonb; clubs jsonb:='[]'; targets jsonb; excluded jsonb; count_targets integer:=0; count_excluded integer:=0; count_tees integer:=0; seal jsonb;
begin
  perform public.admin_catalog_require_admin();
  for club in select id,name from public.clubs order by id loop
    targets:='[]';excluded:='[]';
    for r in select 'course' kind,id from public.course_routes where club_id=club.id union all select 'combination',id from public.route_combinations where club_id=club.id order by kind,id loop
      t:=public.admin_catalog_par_target(r.kind,r.id);
      if jsonb_array_length(t->'reasons')=0 then targets:=targets||jsonb_build_array(public.admin_catalog_par_target_summary(t));else excluded:=excluded||jsonb_build_array(jsonb_build_object('type',r.kind,'target_id',r.id,'label',t#>>'{target,label}','reasons',t->'reasons'));end if;
    end loop;
    -- Existing exact verified tee proposal is a validation contract, not a
    -- certification inferred from matching numeric totals.
    p:=public.admin_catalog_par_tee_proposal(club.id);
    clubs:=clubs||jsonb_build_array(jsonb_build_object('club_id',club.id,'label',club.name,'targets',targets,'excluded',excluded,'tee_proposal',p,'reasons',case when jsonb_array_length(targets)+jsonb_array_length(excluded)=0 then jsonb_build_array('no_playable_configuration') else '[]'::jsonb end));
      count_targets:=count_targets+jsonb_array_length(targets);count_excluded:=count_excluded+jsonb_array_length(excluded);count_tees:=count_tees+(p->>'tee_count')::integer;
  end loop;
  seal:=jsonb_build_object('contract',1,'clubs',clubs);
  return seal||jsonb_build_object('proposal_hash',public.admin_catalog_par_hash(seal),'target_count',count_targets,'excluded_count',count_excluded,'tee_count',count_tees);
end $$;

create function public.admin_catalog_par_workflow_confirm(p_proposal jsonb,p_note text,p_confirm boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; b public.admin_catalog_par_workflow_batches; club jsonb; fresh jsonb; r record; t jsonb; targets jsonb; p jsonb; items jsonb:='[]'; failures jsonb:='[]'; result jsonb;
begin
  actor:=public.admin_catalog_require_admin();
  if p_confirm is distinct from true or p_note is null or length(btrim(p_note)) not between 1 and 2000
    or p_proposal->>'contract' is distinct from '1' or jsonb_typeof(p_proposal->'clubs') is distinct from 'array'
    or jsonb_array_length(p_proposal->'clubs')>1000 or p_proposal->>'proposal_hash' is distinct from public.admin_catalog_par_hash(jsonb_build_object('contract',1,'clubs',p_proposal->'clubs')) then raise exception 'Exact preview, explicit confirmation and note required' using errcode='22023';end if;
  -- One batch receipt even with two Admins/retries; failure is NOWAIT.
  if not pg_try_advisory_xact_lock(hashtextextended('stablr:par:batch:'||(p_proposal->>'proposal_hash'),0)) then raise exception 'Batch busy' using errcode='55P03';end if;
  select * into b from public.admin_catalog_par_workflow_batches where proposal_hash=p_proposal->>'proposal_hash';
  if found then
    if b.actor_id<>actor or b.note<>btrim(p_note) then raise exception 'Approval cannot be reused' using errcode='40001';end if;
    return b.result||jsonb_build_object('receipt_id',b.id);
  end if;
  if exists(select 1 from jsonb_array_elements(p_proposal->'clubs') c group by c->>'club_id' having count(*)>1) then raise exception 'Duplicate club' using errcode='22023';end if;
  for club in select value from jsonb_array_elements(p_proposal->'clubs') order by value->>'club_id' loop
    begin
      perform public.admin_catalog_par_lock((club->>'club_id')::uuid);
      if not exists(select 1 from public.clubs where id=(club->>'club_id')::uuid and is_active) then raise exception 'Active existing club required' using errcode='23514';end if;
      lock table public.admin_catalog_par_targets,public.admin_catalog_par_workflow_batches in share row exclusive mode nowait;
      targets:='[]';
      for r in select 'course' kind,id from public.course_routes where club_id=(club->>'club_id')::uuid union all select 'combination',id from public.route_combinations where club_id=(club->>'club_id')::uuid order by kind,id loop
        t:=public.admin_catalog_par_target(r.kind,r.id);
        if jsonb_array_length(t->'reasons')=0 then targets:=targets||jsonb_build_array(public.admin_catalog_par_target_summary(t));end if;
      end loop;
      p:=public.admin_catalog_par_tee_proposal((club->>'club_id')::uuid);
      if targets is distinct from club->'targets' or p is distinct from club->'tee_proposal' then raise exception 'Club preview changed' using errcode='40001';end if;
      if jsonb_array_length(targets)=0 and (p->>'tee_count')::integer=0 then
        failures:=failures||jsonb_build_array(jsonb_build_object('club_id',club->>'club_id','label',club->>'label','reason',case when jsonb_array_length(club->'excluded')=0 then 'no_playable_configuration' else 'no_safe_candidate' end));continue;
      end if;
      for t in select value from jsonb_array_elements(targets) loop
        insert into public.admin_catalog_par_targets(target_type,target_id,club_id,topology_hash,decision,note,actor_id)
          values(t->>'type',(t#>>'{target,id}')::uuid,(club->>'club_id')::uuid,t->>'topology_hash',t->>'mode',btrim(p_note),actor) on conflict do nothing;
      end loop;
      if (p->>'tee_count')::integer>0 then perform public.admin_catalog_par_tee_confirm((club->>'club_id')::uuid,p->>'proposal_hash',btrim(p_note),true);end if;
      items:=items||jsonb_build_array(jsonb_build_object('club_id',club->>'club_id','label',club->>'label','target_count',jsonb_array_length(targets),'tee_count',(p->>'tee_count')::integer));
    exception when others then
      -- PL/pgSQL exception subtransaction rolls back ALL of this club's
      -- approvals, tee classifications, events and receipts before continuing.
      failures:=failures||jsonb_build_array(jsonb_build_object('club_id',club->>'club_id','label',club->>'label','reason',case sqlstate when '55P03' then 'source_busy' when '40001' then 'source_or_revision_changed' else 'club_validation_failed' end,'error_code',sqlstate));
    end;
  end loop;
  result:=jsonb_build_object('confirmed',items,'excluded',failures,'live_unchanged',true);
  insert into public.admin_catalog_par_workflow_batches(proposal_hash,actor_id,note,result) values(p_proposal->>'proposal_hash',actor,btrim(p_note),result) returning * into b;
  return result||jsonb_build_object('receipt_id',b.id);
end $$;

create function public.admin_catalog_local_par_list(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare r record; result jsonb:='[]'; t jsonb;
begin
  perform public.admin_catalog_require_admin();
  for r in select 'course' kind,id from public.course_routes where club_id=p_club_id union all select 'combination',id from public.route_combinations where club_id=p_club_id order by kind,id loop
    t:=public.admin_catalog_par_target(r.kind,r.id);result:=result||jsonb_build_array(t);
  end loop;
  return jsonb_build_object('targets',result,'history',coalesce((select jsonb_agg(jsonb_build_object('id',id,'before',before_values,'after',after_values,'note',note,'published_at',published_at,'own',actor_id=auth.uid()) order by published_at desc,id) from public.admin_catalog_local_par_versions where club_id=p_club_id),'[]'));
end $$;

create function public.admin_catalog_local_par_plan(p_type text,p_target uuid,p_hole uuid,p_par integer,p_override boolean,p_draft uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare t jsonb; h jsonb; cfg public.admin_catalog_playable_configurations; slot public.admin_catalog_configuration_holes; g jsonb; ctx jsonb; cl public.admin_catalog_tee_classifications; tee record; reasons text[]; tees jsonb:='[]'; rows jsonb; configs jsonb; overlap jsonb; fingerprint jsonb; before_total integer; after_total integer; eligible boolean;
begin
  perform public.admin_catalog_require_admin();
  if p_par is null or p_par not between 3 and 6 or p_override is null then raise exception 'Par 3..6 and explicit override flag required' using errcode='22023';end if;
  t:=public.admin_catalog_par_target(p_type,p_target);reasons:=array(select jsonb_array_elements_text(t->'reasons'));
  select x into h from jsonb_array_elements(t->'holes') x where x->>'id'=p_hole::text;
  if h is null then raise exception 'Exact live hole required' using errcode='22023';end if;
  if t->>'approved'<>'true' then reasons:=array_append(reasons,'target_not_approved');end if;
  if t->>'mode'='physical' then reasons:=array_append(reasons,'physical_parent_required');end if;
  if t->>'mode'='override' then
    select * into cfg from public.admin_catalog_playable_configurations c where (p_type='course' and c.legacy_course_route_id=p_target) or (p_type='combination' and c.legacy_combination_id=p_target) order by id limit 1;
    select * into slot from public.admin_catalog_configuration_holes s where s.configuration_id=cfg.id and (s.legacy_route_hole_id=p_hole or s.legacy_combination_hole_id=p_hole);
    if slot.id is null or slot.review_status<>'verified' then reasons:=array_append(reasons,'exact_live_link_or_si_changed');
    elsif slot.par_mode='inherited' and p_override is distinct from true then reasons:=array_append(reasons,'explicit_local_override_required');end if;
  elsif p_override then reasons:=array_append(reasons,'no_verified_parent_for_override');end if;
  before_total:=(t#>>'{target,total_par}')::integer;after_total:=before_total+p_par-(h->>'par')::integer;
  for tee in select 'route_tee' kind,id,tee_name name,coalesce(holes_count,(t#>>'{target,holes_count}')::integer) scope,par_total from public.route_tees where p_type='course' and route_id=p_target
    union all select 'combination_tee',id,tee_name,coalesce(holes_count,(t#>>'{target,holes_count}')::integer),par_total from public.combination_tees where p_type='combination' and route_combination_id=p_target order by kind,id loop
    eligible:=false;ctx:=null;cl:=null;
    select * into cl from public.admin_catalog_tee_classifications where entity_type=tee.kind and live_tee_id=tee.id;
    if cfg.id is not null and tee.scope=cfg.holes_count and cl.par_behavior='derivato' and cl.configuration_id=cfg.id and cl.attestation='curato' then
      ctx:=public.admin_catalog_tee_classification_context((t#>>'{target,club_id}')::uuid,tee.kind,tee.id,cfg.id);
      eligible:=ctx->'baseline'=cl.baseline and ctx#>>'{configuration,valid}'='true' and tee.par_total=before_total;
    end if;
    -- Unknown/review tees cannot silently drift. Certified/non-derived values
    -- remain untouched and block this publication until explicitly resolved.
    if not coalesce(eligible,false) then reasons:=array_append(reasons,'tee_unknown_review_obsolete_or_override');end if;
    tees:=tees||jsonb_build_array(jsonb_build_object('entity_type',tee.kind,'tee_id',tee.id,'name',tee.name,'scope',tee.scope,'before',tee.par_total,'after',case when eligible then after_total else tee.par_total end,'eligible',coalesce(eligible,false),'classification_revision',cl.revision,'baseline',ctx->'baseline'));
  end loop;
  rows:=jsonb_build_array(jsonb_build_object('kind',case p_type when 'course' then 'course_hole' else 'combination_hole' end,'id',p_hole));
  configs:=jsonb_build_array(jsonb_build_object('course_id',case when p_type='course' then p_target end,'combination_id',case when p_type='combination' then p_target end));
  overlap:=public.admin_catalog_par_overlapping_drafts((t#>>'{target,club_id}')::uuid,configs,rows,tees);
  if jsonb_array_length(overlap)>0 then reasons:=array_append(reasons,'overlapping_live_draft');end if;
  if exists(select 1 from public.admin_catalog_local_par_drafts d where d.target_type=p_type and d.target_id=p_target and d.status='draft' and d.id is distinct from p_draft and d.new_par is distinct from (select (x->>'par')::integer from jsonb_array_elements(t->'holes') x where x->>'id'=d.hole_id::text)) then reasons:=array_append(reasons,'overlapping_local_par_draft');end if;
  if slot.physical_hole_id is not null and exists(select 1 from public.admin_catalog_par_drafts d join public.admin_catalog_physical_holes ph on ph.id=d.physical_hole_id where d.physical_hole_id in(select s.physical_hole_id from public.admin_catalog_configuration_holes s where s.configuration_id=cfg.id) and d.status='draft' and d.new_par is distinct from ph.base_par) then reasons:=array_append(reasons,'overlapping_physical_par_draft');end if;
  if (h->>'par')::integer=p_par then reasons:=array_append(reasons,'no_par_change');end if;
  g:=public.admin_catalog_data_origin((t#>>'{target,club_id}')::uuid);
  -- Private exact source hash, never return payloads. Only pertinent parent,
  -- grid, classification and overlapping draft baselines enter this seal.
  fingerprint:=jsonb_build_object('target',t,'slot',case when slot.id is not null then jsonb_build_object('id',slot.id,'revision',slot.revision,'par_mode',slot.par_mode,'par_override',slot.par_override,'physical_id',slot.physical_hole_id,'configuration_revision',cfg.revision,'configuration_source_state',(select c->>'source_state' from jsonb_array_elements(g->'configurations') c where c->>'id'=cfg.id::text)) end,'tees',tees,'overlap',overlap,
    'source_hash',case p_type when 'course' then (select public.admin_catalog_par_hash(jsonb_build_array(source_system,source_external_id,source_payload)) from public.course_routes where id=p_target) else (select public.admin_catalog_par_hash(jsonb_build_array(source_system,source_external_id,source_payload,front_route_id,back_route_id)) from public.route_combinations where id=p_target) end);
  -- Requested AFTER values must not affect the immutable BEFORE fingerprint.
  fingerprint:=jsonb_set(fingerprint,'{tees}',(select coalesce(jsonb_agg(x-'after' order by x->>'tee_id'),'[]') from jsonb_array_elements(tees) x));
  return jsonb_build_object('target',t->'target','type',p_type,'mode',t->>'mode','hole',h||jsonb_build_object('after',p_par),'before_total',before_total,'after_total',after_total,
    'parent',(select jsonb_build_object('course_name',r.name,'hole_number',ph.physical_number,'base_par',ph.base_par) from public.admin_catalog_physical_holes ph join public.admin_catalog_physical_course_links l on l.id=ph.source_course_link_id join public.course_routes r on r.id=l.course_id where ph.id=slot.physical_hole_id),
    'tees',(select coalesce(jsonb_agg(x-'baseline' order by x->>'tee_id'),'[]') from jsonb_array_elements(tees) x),'requires_override',slot.par_mode='inherited','blockers',to_jsonb(array(select distinct x from unnest(reasons) x order by x)),'can_publish',cardinality(reasons)=0,'baseline_hash',public.admin_catalog_par_hash(fingerprint));
end $$;

create function public.admin_catalog_local_par_open(p_type text,p_target uuid,p_hole uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; d public.admin_catalog_local_par_drafts; t jsonb; plan jsonb; par integer;
begin
  actor:=public.admin_catalog_require_admin();t:=public.admin_catalog_par_target(p_type,p_target);
  perform public.admin_catalog_par_lock((t#>>'{target,club_id}')::uuid);
  lock table public.admin_catalog_local_par_drafts,public.admin_catalog_par_targets,public.admin_catalog_local_par_versions in share row exclusive mode nowait;
  t:=public.admin_catalog_par_target(p_type,p_target);
  if t->>'mode'='physical' then raise exception 'Physical parent is the only Par editor; shared 9x2 cannot have local overrides' using errcode='23514';end if;
  if t->>'approved'<>'true' or jsonb_array_length(t->'reasons')>0 then raise exception 'Approved independent target required' using errcode='23514';end if;
  select (x->>'par')::integer into par from jsonb_array_elements(t->'holes') x where x->>'id'=p_hole::text;
  if par is null then raise exception 'Exact existing hole required' using errcode='22023';end if;
  select * into d from public.admin_catalog_local_par_drafts where actor_id=actor and target_type=p_type and target_id=p_target and hole_id=p_hole and status='draft' for update nowait;
  if not found then
    plan:=public.admin_catalog_local_par_plan(p_type,p_target,p_hole,par,false);
    insert into public.admin_catalog_local_par_drafts(club_id,target_type,target_id,hole_id,new_par,base_hash,actor_id) values((t#>>'{target,club_id}')::uuid,p_type,p_target,p_hole,par,plan->>'baseline_hash',actor) returning * into d;
  end if;
  plan:=public.admin_catalog_local_par_plan(p_type,p_target,p_hole,d.new_par,d.create_override,d.id);
  return plan||jsonb_build_object('draft',jsonb_build_object('id',d.id,'revision',d.revision,'par',d.new_par,'create_override',d.create_override),'base_changed',d.base_hash<>plan->>'baseline_hash');
end $$;

create function public.admin_catalog_local_par_save(p_draft uuid,p_revision bigint,p_par integer,p_override boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; d public.admin_catalog_local_par_drafts; plan jsonb;
begin
  actor:=public.admin_catalog_require_admin();
  select * into d from public.admin_catalog_local_par_drafts where id=p_draft and actor_id=actor and status='draft';
  if not found then raise exception 'Owned draft required' using errcode='42501';end if;
  perform public.admin_catalog_par_lock(d.club_id);lock table public.admin_catalog_local_par_drafts,public.admin_catalog_par_targets,public.admin_catalog_local_par_versions in share row exclusive mode nowait;
  select * into d from public.admin_catalog_local_par_drafts where id=p_draft for update nowait;
  if d.status<>'draft' or d.revision is distinct from p_revision then raise exception 'Draft changed' using errcode='40001';end if;
  plan:=public.admin_catalog_local_par_plan(d.target_type,d.target_id,d.hole_id,p_par,p_override,d.id);
  if d.base_hash is distinct from plan->>'baseline_hash' then raise exception 'Base changed; never rebase automatically' using errcode='40001';end if;
  update public.admin_catalog_local_par_drafts set new_par=p_par,create_override=p_override,revision=revision+1,updated_at=clock_timestamp() where id=d.id returning * into d;
  return plan||jsonb_build_object('draft',jsonb_build_object('id',d.id,'revision',d.revision,'par',d.new_par,'create_override',d.create_override),'base_changed',false);
end $$;

-- A capability is an unforgeable RPC-owned draft in THIS transaction, not a
-- browser-settable GUC. Only the Par/override fields of this exact slot change.
create function public.admin_catalog_local_par_slot_allowed(p_old public.admin_catalog_configuration_holes,p_new public.admin_catalog_configuration_holes)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid;
begin
  actor:=public.admin_catalog_require_admin();
  return p_old.review_status='verified' and p_new.review_status='verified' and p_new.par_mode='override'
    and (to_jsonb(p_new)-array['par_mode','par_override','reason','revision','updated_by','updated_at'])=(to_jsonb(p_old)-array['par_mode','par_override','reason','revision','updated_by','updated_at'])
    and exists(select 1 from public.admin_catalog_local_par_drafts d where d.actor_id=actor and d.status='publishing' and d.publication_xid=txid_current()
      and d.new_par=p_new.par_override and (p_old.par_mode='override' or d.create_override)
      and ((d.target_type='course' and d.hole_id=p_old.legacy_route_hole_id) or (d.target_type='combination' and d.hole_id=p_old.legacy_combination_hole_id)));
end $$;
do $$ declare n text; body text;needle text:='begin';begin
  foreach n in array array['admin_catalog_playable_guard','admin_catalog_multi9_registered_guard'] loop
    select pg_get_functiondef(('public.'||n||'()')::regprocedure) into body;
    if body is null or strpos(body,needle)=0 then raise exception 'Registered slot guard missing';end if;
    execute overlay(body placing 'begin
      if TG_OP=''UPDATE'' and TG_TABLE_NAME=''admin_catalog_configuration_holes'' then
        if public.admin_catalog_local_par_slot_allowed(old,new) then return new;end if;
      end if;' from strpos(body,needle) for length(needle));
  end loop;
end $$;

create function public.admin_catalog_local_par_publish(p_draft uuid,p_revision bigint,p_expected_hash text,p_note text,p_confirm boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; d public.admin_catalog_local_par_drafts; plan jsonb; g jsonb; after_graph jsonb; slot public.admin_catalog_configuration_holes; v public.admin_catalog_local_par_versions; t jsonb; ctx jsonb; n integer; ids uuid[]; cfgids uuid[]; keep_classifications uuid[];
begin
  actor:=public.admin_catalog_require_admin();
  if p_confirm is distinct from true or p_note is null or length(btrim(p_note)) not between 1 and 2000 then raise exception 'Explicit publication and note required' using errcode='22023';end if;
  select * into d from public.admin_catalog_local_par_drafts where id=p_draft and actor_id=actor;
  if not found then raise exception 'Owned draft required' using errcode='42501';end if;
  perform public.admin_catalog_par_lock(d.club_id);lock table public.admin_catalog_local_par_drafts,public.admin_catalog_par_targets,public.admin_catalog_local_par_versions in share row exclusive mode nowait;
  select * into d from public.admin_catalog_local_par_drafts where id=p_draft for update nowait;
  if d.status<>'draft' or d.revision is distinct from p_revision then raise exception 'Draft closed or changed' using errcode='40001';end if;
  plan:=public.admin_catalog_local_par_plan(d.target_type,d.target_id,d.hole_id,d.new_par,d.create_override,d.id);
  if d.base_hash is distinct from plan->>'baseline_hash' or p_expected_hash is distinct from plan->>'baseline_hash' then raise exception 'Publication baseline changed' using errcode='40001';end if;
  if plan->>'can_publish'<>'true' then raise exception 'Unsafe local Par publication' using errcode='23514';end if;
  g:=public.admin_catalog_data_origin(d.club_id);
  ids:=array(select (l->>'id')::uuid from jsonb_array_elements(g->'physical_links') l where l->>'source_state'='matched' and l->>'review_status'='verified');
  cfgids:=array(select (c->>'id')::uuid from jsonb_array_elements(g->'configurations') c where c->>'source_state'='matched' and c->>'tee_state' in ('matched','not_recorded') and c->>'review_status'='verified');
  keep_classifications:=array(select cl.id from public.admin_catalog_tee_classifications cl where cl.club_id=d.club_id and cl.attestation='curato' and cl.par_behavior='derivato'
    and cl.baseline=(public.admin_catalog_tee_classification_context(d.club_id,cl.entity_type,cl.live_tee_id,cl.configuration_id)->'baseline'));
  update public.admin_catalog_local_par_drafts set status='publishing',publication_xid=txid_current() where id=d.id;
  if plan->>'mode'='override' then
    select * into slot from public.admin_catalog_configuration_holes where (d.target_type='course' and legacy_route_hole_id=d.hole_id) or (d.target_type='combination' and legacy_combination_hole_id=d.hole_id);
    update public.admin_catalog_configuration_holes set par_mode='override',par_override=d.new_par,reason=btrim(p_note) where id=slot.id;
  end if;
  if d.target_type='course' then
    update public.route_holes set par=d.new_par where id=d.hole_id and route_id=d.target_id and par=(plan#>>'{hole,par}')::integer;
    get diagnostics n=row_count;if n<>1 then raise exception 'Live hole changed' using errcode='40001';end if;
    update public.course_routes set total_par=(plan->>'after_total')::integer,updated_at=clock_timestamp() where id=d.target_id and total_par=(plan->>'before_total')::integer;
  else
    update public.route_combination_holes set par=d.new_par where id=d.hole_id and route_combination_id=d.target_id and par=(plan#>>'{hole,par}')::integer;
    get diagnostics n=row_count;if n<>1 then raise exception 'Live hole changed' using errcode='40001';end if;
    update public.route_combinations set total_par=(plan->>'after_total')::integer,updated_at=clock_timestamp() where id=d.target_id and total_par=(plan->>'before_total')::integer;
  end if;
  get diagnostics n=row_count;if n<>1 then raise exception 'Live total changed' using errcode='40001';end if;
  for t in select value from jsonb_array_elements(plan->'tees') loop
    if t->>'entity_type'='route_tee' then update public.route_tees set par_total=(t->>'after')::integer,updated_at=clock_timestamp() where id=(t->>'tee_id')::uuid and par_total=(t->>'before')::integer;
    else update public.combination_tees set par_total=(t->>'after')::integer,updated_at=clock_timestamp() where id=(t->>'tee_id')::uuid and par_total=(t->>'before')::integer;end if;
    get diagnostics n=row_count;if n<>1 then raise exception 'Tee changed' using errcode='40001';end if;
  end loop;
  after_graph:=public.admin_catalog_data_origin_registration(d.club_id);
  insert into public.admin_catalog_local_par_versions(club_id,draft_id,target_type,target_id,before_values,after_values,diff,origin_after_hash,verified_link_ids,verified_configuration_ids,actor_id,note)
    values(d.club_id,d.id,d.target_type,d.target_id,jsonb_build_object('par',plan#>'{hole,par}','total',plan->'before_total'),jsonb_build_object('par',d.new_par,'total',plan->'after_total'),plan,
      public.admin_catalog_par_hash(after_graph-array['read_at','publication','drafts']),ids,cfgids,actor,btrim(p_note)) returning * into v;
  -- Only previously CURRENT derived classifications receive a new baseline,
  -- with their existing audit trigger. Obsolete decisions are never rebased.
  for t in select jsonb_build_object('id',cl.id,'entity_type',cl.entity_type,'tee_id',cl.live_tee_id,'configuration_id',cl.configuration_id) from public.admin_catalog_tee_classifications cl where cl.id=any(keep_classifications) loop
    ctx:=public.admin_catalog_tee_classification_context(d.club_id,t->>'entity_type',(t->>'tee_id')::uuid,(t->>'configuration_id')::uuid);
    if ctx#>>'{configuration,valid}'<>'true' then raise exception 'Derived tee context invalid after publication' using errcode='23514';end if;
    update public.admin_catalog_tee_classifications set baseline=ctx->'baseline',evidence=jsonb_set(evidence,'{par_total}',ctx#>'{tee,par_total}'),note=btrim(p_note) where id=(t->>'id')::uuid;
  end loop;
  update public.admin_catalog_local_par_drafts set status='published',publication_xid=null,revision=revision+1,updated_at=clock_timestamp() where id=d.id;
  return jsonb_build_object('version_id',v.id,'published',true,'par',d.new_par,'total',plan->'after_total','tee_count',jsonb_array_length(plan->'tees'));
end $$;

create function public.admin_catalog_local_par_abandon(p_draft uuid,p_revision bigint,p_confirm boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; d public.admin_catalog_local_par_drafts;
begin
  actor:=public.admin_catalog_require_admin();
  select * into d from public.admin_catalog_local_par_drafts where id=p_draft and actor_id=actor for update nowait;
  if not found then raise exception 'Owned draft required' using errcode='42501';end if;
  if p_confirm is distinct from true or d.status<>'draft' or d.revision is distinct from p_revision then raise exception 'Explicit current draft required' using errcode='40001';end if;
  update public.admin_catalog_local_par_drafts set status='archived',revision=revision+1,updated_at=clock_timestamp() where id=d.id;
  return jsonb_build_object('archived',true);
end $$;

-- Narrow physical impact checks to the exact dependency component. Keep the
-- previous algorithm privately ONLY to recognise an unchanged historical
-- draft base; it is never an alternate publication path.
alter function public.admin_catalog_par_plan(uuid,integer,uuid) rename to admin_catalog_par_plan_before_workflow;
do $$ declare body text; needle text; replacement text;begin
  select pg_get_functiondef('public.admin_catalog_par_plan_before_workflow(uuid,integer,uuid)'::regprocedure) into body;
  body:=replace(body,'FUNCTION public.admin_catalog_par_plan_before_workflow(','FUNCTION public.admin_catalog_par_plan(');
  needle:='g:=public.admin_catalog_data_origin(ph.club_id);why:=public.admin_catalog_par_graph_check(g);';
  if strpos(body,needle)=0 then raise exception 'Unexpected physical plan contract';end if;
  replacement:='g:=public.admin_catalog_data_origin(ph.club_id);
    g:=public.admin_catalog_par_graph_scope(g,array(select distinct (s->>''configuration_id'')::uuid from jsonb_array_elements(g->''configuration_holes'') s where s->>''physical_hole_id''=ph.id::text));
    why:=public.admin_catalog_par_graph_check(g);';
  body:=replace(body,needle,replacement);
  -- Scope filtering must NEVER hide an exact live reference absent from the
  -- foundation. Only an explicitly approved autonomous target is excluded.
  needle:='or exists(select 1 from jsonb_array_elements(g->''combination_holes'') r where r->>''route_id''=(select l->>''course_id'' from jsonb_array_elements(g->''physical_links'') l where l->>''id''=ph.source_course_link_id::text)
      and r->>''physical_hole_number''=ph.physical_number::text and not exists(select 1 from jsonb_array_elements(g->''configuration_holes'') h where h->>''legacy_combination_hole_id''=r->>''id'' and h->>''physical_hole_id''=ph.id::text and h->>''review_status''=''verified''))';
  if strpos(body,needle)=0 then raise exception 'Exact live coverage guard missing';end if;
  body:=replace(body,needle,'or exists(select 1 from public.route_combination_holes r
      where r.route_id=(select l.course_id from public.admin_catalog_physical_course_links l where l.id=ph.source_course_link_id)
      and r.physical_hole_number=ph.physical_number
      and not exists(select 1 from public.admin_catalog_configuration_holes h join public.admin_catalog_playable_configurations cfg on cfg.id=h.configuration_id
        where h.legacy_combination_hole_id=r.id and h.physical_hole_id=ph.id and h.review_status=''verified'' and cfg.review_status=''verified'')
      and not public.admin_catalog_par_is_autonomous(''combination'',r.route_combination_id))');
  needle:='or exists(select 1 from jsonb_array_elements(g->''configuration_holes'') h join jsonb_array_elements(rows_changed) r
      on r->>''id''=coalesce(h->>''legacy_route_hole_id'',h->>''legacy_combination_hole_id'') where h->>''physical_hole_id''<>ph.id::text or h->>''par_mode''<>''inherited'')';
  if strpos(body,needle)=0 then raise exception 'Shared row guard missing';end if;
  body:=replace(body,needle,'or exists(select 1 from public.admin_catalog_configuration_holes h join public.admin_catalog_playable_configurations cfg on cfg.id=h.configuration_id
      join jsonb_array_elements(rows_changed) r on r->>''id''=coalesce(h.legacy_route_hole_id,h.legacy_combination_hole_id)::text
      where h.physical_hole_id is distinct from ph.id or h.par_mode is distinct from ''inherited'' or h.review_status<>''verified'' or cfg.review_status<>''verified'')');
  needle:='if exists(select 1 from public.admin_catalog_par_drafts d where d.club_id=ph.club_id and d.status in (''draft'',''publishing'') and d.id is distinct from p_draft_id) then why:=array_append(why,''overlapping_physical_par_draft'');end if;';
  if strpos(body,needle)=0 then raise exception 'Unexpected draft conflict contract';end if;
  body:=replace(body,needle,'if exists(select 1 from public.admin_catalog_par_drafts d join public.admin_catalog_physical_holes q on q.id=d.physical_hole_id where d.club_id=ph.club_id and d.status in (''draft'',''publishing'') and d.id is distinct from p_draft_id and d.new_par is distinct from q.base_par and exists(select 1 from jsonb_array_elements(g->''configuration_holes'') s where s->>''physical_hole_id''=d.physical_hole_id::text and s->>''configuration_id'' in(select c->>''id'' from jsonb_array_elements(changes) c))) then why:=array_append(why,''overlapping_physical_par_draft'');end if;');
  body:=replace(body,'where c.club_id=ph.club_id;','where c.club_id=ph.club_id and exists(select 1 from jsonb_array_elements(tees) t where t->>''tee_id''=c.live_tee_id::text and t->>''entity_type''=c.entity_type);');
  body:=replace(body,'from public.course_routes r where r.club_id=ph.club_id),','from public.course_routes r where r.id::text in(select c->>''id'' from jsonb_array_elements(g->''courses'') c)),');
  body:=replace(body,'from public.route_combinations r where r.club_id=ph.club_id),','from public.route_combinations r where r.id::text in(select c->>''id'' from jsonb_array_elements(g->''combinations'') c)),');
  body:=replace(body,'from public.route_tees lt join public.course_routes r on r.id=lt.route_id where r.club_id=ph.club_id),','from public.route_tees lt join public.course_routes r on r.id=lt.route_id where r.id::text in(select c->>''id'' from jsonb_array_elements(g->''courses'') c)),');
  body:=replace(body,'from public.combination_tees lt join public.route_combinations r on r.id=lt.route_combination_id where r.club_id=ph.club_id)))','from public.combination_tees lt join public.route_combinations r on r.id=lt.route_combination_id where r.id::text in(select c->>''id'' from jsonb_array_elements(g->''combinations'') c))))');
  body:=replace(body,'public.admin_catalog_par_plan_legacy(p_physical_hole_id,p_new_par,p_draft_id)->>''baseline_hash''','public.admin_catalog_par_plan_before_workflow(p_physical_hole_id,p_new_par,p_draft_id)->>''baseline_hash''');
  execute body;
end $$;
alter function public.admin_catalog_par_plan(uuid,integer,uuid) rename to admin_catalog_par_plan_scoped;
create function public.admin_catalog_par_plan(p_physical_hole_id uuid,p_new_par integer,p_draft_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare p jsonb; conflicts jsonb; blockers text[]; autonomous jsonb; ph public.admin_catalog_physical_holes;
begin
  perform public.admin_catalog_require_admin();p:=public.admin_catalog_par_plan_scoped(p_physical_hole_id,p_new_par,p_draft_id);
  select * into ph from public.admin_catalog_physical_holes where id=p_physical_hole_id;
  select coalesce(jsonb_agg(jsonb_build_object('label',c.name,'total',c.total_par,'topology_hash',(public.admin_catalog_par_target('combination',c.id)->>'topology_hash')) order by c.id),'[]') into autonomous
    from public.route_combinations c where c.club_id=ph.club_id and public.admin_catalog_par_is_autonomous('combination',c.id)
      and exists(select 1 from public.route_combination_holes rh where rh.route_combination_id=c.id and rh.route_id=(select l.course_id from public.admin_catalog_physical_course_links l where l.id=ph.source_course_link_id) and rh.physical_hole_number=ph.physical_number);
  if jsonb_array_length(autonomous)>0 then
    p:=p||jsonb_build_object('autonomous_excluded',autonomous,'baseline_hash',public.admin_catalog_par_hash(jsonb_build_array(p->>'baseline_hash',(select jsonb_agg(x-'total' order by x->>'label') from jsonb_array_elements(autonomous) x))));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'revision',d.revision) order by d.id),'[]') into conflicts from public.admin_catalog_local_par_drafts d
    where d.club_id=(p->>'club_id')::uuid and d.status in ('draft','publishing')
      and exists(select 1 from jsonb_array_elements(p->'configurations') c where (d.target_type='course' and c->>'course_id'=d.target_id::text) or (d.target_type='combination' and c->>'combination_id'=d.target_id::text))
      and d.new_par is distinct from (case d.target_type when 'course' then (select par from public.route_holes where id=d.hole_id) else (select par from public.route_combination_holes where id=d.hole_id) end);
  if jsonb_array_length(conflicts)>0 then
    blockers:=array(select jsonb_array_elements_text(p->'blockers'))||array['overlapping_local_par_draft'];
    p:=p||jsonb_build_object('blockers',to_jsonb(blockers),'can_publish',false,'baseline_hash',public.admin_catalog_par_hash(jsonb_build_array(p->>'baseline_hash',conflicts)),'legacy_baseline_hash',null);
  end if;
  return p;
end $$;
revoke all on function public.admin_catalog_par_plan_before_workflow(uuid,integer,uuid),public.admin_catalog_par_plan_scoped(uuid,integer,uuid),public.admin_catalog_par_plan(uuid,integer,uuid) from public,anon,authenticated,service_role;

-- Old grid publishers remain valid for SI-only changes. Par changes must use
-- the explicit impact/override contract; sum-preserving edits cannot bypass it.
alter function public.admin_course_hole_grid_publish_draft(uuid,bigint) rename to admin_course_hole_grid_publish_before_par_workflow;
alter function public.admin_hole_grid_publish_draft(uuid,bigint) rename to admin_hole_grid_publish_before_par_workflow;
create function public.admin_catalog_par_guard_grid(p_draft uuid)
returns void language plpgsql stable security definer set search_path=pg_catalog as $$
declare d public.admin_catalog_drafts;
begin
  perform public.admin_catalog_require_admin();select * into d from public.admin_catalog_drafts where draft_id=p_draft and created_by=auth.uid();
  if not found then raise exception 'Owned draft required' using errcode='42501';end if;
  if exists(select 1 from jsonb_array_elements(d.snapshot->'holes') n join jsonb_array_elements(d.base_snapshot->'holes') b on n->>'id'=b->>'id' where n->'par' is distinct from b->'par') then raise exception 'Use the safe Par editor in Structure and links; inherited Par requires explicit parent or local override' using errcode='23514';end if;
end $$;
create function public.admin_course_hole_grid_publish_draft(p_draft_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$ begin
  perform public.admin_catalog_par_guard_grid(p_draft_id);return public.admin_course_hole_grid_publish_before_par_workflow(p_draft_id,p_expected_revision);end $$;
create function public.admin_hole_grid_publish_draft(p_draft_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$ begin
  perform public.admin_catalog_par_guard_grid(p_draft_id);return public.admin_hole_grid_publish_before_par_workflow(p_draft_id,p_expected_revision);end $$;

do $$ declare f record;begin
  for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'admin_catalog_local_par_%' or p.proname like 'admin_catalog_par_workflow_%' or p.proname in ('admin_catalog_par_is_autonomous','admin_catalog_par_graph_scope','admin_catalog_par_target_summary','admin_catalog_par_target','admin_catalog_par_guard_grid','admin_course_hole_grid_publish_before_par_workflow','admin_hole_grid_publish_before_par_workflow','admin_course_hole_grid_publish_draft','admin_hole_grid_publish_draft')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname in ('admin_catalog_par_workflow_preview','admin_catalog_par_workflow_confirm','admin_catalog_local_par_list','admin_catalog_local_par_open','admin_catalog_local_par_save','admin_catalog_local_par_publish','admin_catalog_local_par_abandon','admin_course_hole_grid_publish_draft','admin_hole_grid_publish_draft') then execute format('grant execute on function %s to authenticated',f.signature);end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
