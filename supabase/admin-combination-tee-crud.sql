-- Published combination tees. Incremental, transactional, one-shot.
-- Requires course tee CRUD + foundation impact, route editor, physical foundation
-- and existing tee classifications. No backfill/index replacement/live data DML.
begin;
do $$begin
  if to_regprocedure('public.admin_course_tee_full_snapshot(jsonb,boolean)') is null
    or to_regprocedure('public.admin_course_tee_preview_without_impact(uuid)') is null
    or to_regprocedure('public.admin_route_context(uuid)') is null
    or to_regprocedure('public.admin_catalog_data_origin(uuid)') is null
    or to_regclass('public.admin_catalog_tee_classifications') is null
    or to_regclass('public.admin_catalog_configuration_components') is null then
    raise exception 'Course tee CRUD/impact, Route editor and physical foundation/classifications must already be installed' using errcode='55000';
  end if;
end $$;
alter table public.combination_tees add column display_order integer;
create unique index admin_combination_tee_open_owner_idx on public.admin_catalog_drafts(live_entity_id,created_by)
  where entity_type='combination_tee' and workflow_status='draft';

-- One read-only impact contract shared by course and combination tee previews.
create function public.admin_catalog_tee_editor_impact(p_kind text,p_parent_id uuid,p_live_id uuid,p_fields jsonb,p_new boolean,p_changing boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare club uuid; scope integer; g jsonb; configs jsonb; verified integer; incomplete integer; n integer; snapshot_key text;
begin
  perform public.admin_catalog_require_admin();
  if p_kind='route_tee' then select c.club_id,c.holes_count into club,scope from public.course_routes c where c.id=p_parent_id;snapshot_key:='route_tees';
  elsif p_kind='combination_tee' then select c.club_id,c.holes_count into club,scope from public.route_combinations c where c.id=p_parent_id;snapshot_key:='combination_tees';
  else raise exception 'Specific tee type required' using errcode='22023';end if;
  if club is null then raise exception 'Existing parent required' using errcode='22023';end if;
  if p_live_id is not null then
    if p_kind='route_tee' then select coalesce(t.holes_count,scope) into scope from public.route_tees t where t.id=p_live_id and t.route_id=p_parent_id;
    else select coalesce(t.holes_count,scope) into scope from public.combination_tees t where t.id=p_live_id and t.route_combination_id=p_parent_id;end if;
    if scope is null then raise exception 'Exact live tee/parent relationship required' using errcode='40001';end if;
  end if;
  g:=public.admin_catalog_data_origin(club);
  select count(*) filter(where c.review_status='verified' and c.holes_count=scope),count(*) filter(where c.review_status<>'verified') into verified,incomplete
    from public.admin_catalog_playable_configurations c where c.club_id=club
      and (case p_kind when 'route_tee' then c.legacy_course_route_id else c.legacy_combination_id end)=p_parent_id;
  with recursive affected(id) as (
    select c.id from public.admin_catalog_playable_configurations c where p_changing and c.club_id=club and c.review_status='verified'
      and (case p_kind when 'route_tee' then c.legacy_course_route_id else c.legacy_combination_id end)=p_parent_id and (
        c.registration_snapshot ? snapshot_key or (p_new and c.holes_count=scope)
        or exists(select 1 from public.admin_catalog_tee_classifications cl where cl.configuration_id=c.id and cl.entity_type=p_kind and cl.live_tee_id=p_live_id and (
          cl.baseline->'course_rating' is distinct from p_fields->'course_rating' or cl.baseline->'slope_rating' is distinct from p_fields->'slope_rating'
          or cl.baseline->'applicability' is distinct from p_fields->'gender' or cl.baseline->'is_active' is distinct from p_fields->'is_active')))
    union
    select c.id from public.admin_catalog_playable_configurations c join affected a on (
      c.parent_configuration_id=a.id or exists(select 1 from public.admin_catalog_configuration_components cp
        where cp.configuration_id=c.id and cp.parent_configuration_id=a.id and cp.review_status='verified')) where c.club_id=club and c.review_status='verified'
  ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'label',c.label,'holes_count',c.holes_count,'revision',c.revision,'relationship_kind',c.relationship_kind,
    'source_state',x->'source_state','tee_state',x->'tee_state','reason',case
      when (case p_kind when 'route_tee' then c.legacy_course_route_id else c.legacy_combination_id end)=p_parent_id and c.registration_snapshot ? snapshot_key then 'recorded_tee_baseline'
      when (case p_kind when 'route_tee' then c.legacy_course_route_id else c.legacy_combination_id end)=p_parent_id and p_new then 'new_tee_unclassified'
      when (case p_kind when 'route_tee' then c.legacy_course_route_id else c.legacy_combination_id end)=p_parent_id then 'tee_classification_baseline' else 'verified_dependency_baseline' end)
      order by c.holes_count,c.label,c.id),'[]') into configs from affected a join public.admin_catalog_playable_configurations c on c.id=a.id
    left join lateral(select value from jsonb_array_elements(g->'configurations') where value->>'id'=c.id::text) states(x) on true;
  select count(*) into n from public.admin_catalog_tee_classifications cl where cl.club_id=club
    and exists(select 1 from jsonb_array_elements(configs) x where x->>'id'=cl.configuration_id::text);
  return jsonb_build_object('may_block_par',p_changing and jsonb_array_length(configs)>0,'configurations',configs,'classification_count',n,
    'coverage',case when verified=0 or incomplete>0 then 'incomplete' else 'verified_links' end,'unverified_configuration_count',incomplete,'baselines_updated',false);
end;
$$;
create or replace function public.admin_course_tee_preview_draft(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p jsonb; d public.admin_catalog_drafts; actor uuid:=public.admin_catalog_require_admin();
begin
  p:=public.admin_course_tee_preview_without_impact(p_draft_id);
  select * into d from public.admin_catalog_drafts where draft_id=p_draft_id and entity_type='route_tee' and created_by=actor and workflow_status='draft';
  if d.draft_id is null then raise exception 'Owned course tee draft required' using errcode='42501';end if;
  return p||jsonb_build_object('foundation_impact',public.admin_catalog_tee_editor_impact('route_tee',(p#>>'{context,course,id}')::uuid,
    d.live_entity_id,p->'fields',(p->>'is_new')::boolean,(p->>'is_new')::boolean or p->'diff'<>'{}'::jsonb));
end;
$$;

-- Dedicated parent/source contract. Shared metadata validator remains the one
-- used by course tees; no generic JSON publisher or writable scope/Par.
create function public.admin_combination_tee_context(p_combination_id uuid,p_tee_id uuid default null,p_lock boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.route_combinations; c public.clubs; t public.combination_tees; technical jsonb; si_count integer; total integer; actual integer;
begin
  if p_lock then select * into r from public.route_combinations where id=p_combination_id for share nowait;
  else select * into r from public.route_combinations where id=p_combination_id;end if;
  if r.id is null then raise exception 'Existing combination required' using errcode='22023';end if;
  if p_lock then
    perform s.id from public.course_routes s where s.id in(r.front_route_id,r.back_route_id) order by s.id for share nowait;
    select * into c from public.clubs where id=r.club_id and is_active for share nowait;
  else select * into c from public.clubs where id=r.club_id and is_active;end if;
  if c.id is null then raise exception 'Active Club required' using errcode='22023';end if;
  if p_tee_id is not null then
    if p_lock then select * into t from public.combination_tees where id=p_tee_id and route_combination_id=r.id for update nowait;
    else select * into t from public.combination_tees where id=p_tee_id and route_combination_id=r.id;end if;
    if t.id is null then raise exception 'Existing tee of this combination required' using errcode='40001';end if;
  end if;
  technical:=public.admin_route_context(r.id);
  select count(*),count(distinct h.stroke_index) filter(where h.stroke_index between 1 and r.holes_count),sum(h.par) into actual,si_count,total
    from public.route_combination_holes h where h.route_combination_id=r.id;
  return jsonb_build_object('tee',case when t.id is null then jsonb_build_object('tee_name','Nuovo tee','holes_count',r.holes_count,'effective_holes_count',r.holes_count,'par_total',total)
    else (to_jsonb(t)-'source_payload')||jsonb_build_object('display_order',public.admin_course_tee_fields(to_jsonb(t))->'display_order','effective_holes_count',coalesce(t.holes_count,r.holes_count)) end,
    'combination',jsonb_build_object('id',r.id,'club_id',r.club_id,'name',r.name,'holes_count',r.holes_count,'total_par',r.total_par,'is_active',r.is_active),
    'can_create',r.is_active and technical#>>'{checks,coherent}'='true' and technical#>>'{checks,origins_active}'='true'
      and actual=r.holes_count and si_count=actual and r.total_par is not null and total=r.total_par,
    'base',jsonb_build_object('tee',case when t.id is null then null else to_jsonb(t) end,'combination',to_jsonb(r),
      'club',jsonb_build_object('id',c.id,'is_active',c.is_active),'structure',technical->'base','new_tee',t.id is null));
end;
$$;

create function public.admin_combination_tee_guard_draft()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; ctx jsonb; parent uuid;
begin
  if tg_op='INSERT' then if new.entity_type<>'combination_tee' then return new;end if;
  elsif old.entity_type<>'combination_tee' and new.entity_type<>'combination_tee' then return new;end if;
  actor:=public.admin_catalog_require_admin();parent:=(new.base_snapshot#>>'{_context,combination,id}')::uuid;
  if new.entity_type<>'combination_tee' or new.parent_draft_id is not null or new.schema_version<>1 or new.base_snapshot is null
    or parent is null or new.created_by<>actor or new.updated_by<>actor or (new.live_entity_id is not null and new.entity_key is distinct from new.live_entity_id) then
    raise exception 'Owned combination tee draft with server base required' using errcode='42501';end if;
  if tg_op='INSERT' then
    ctx:=public.admin_combination_tee_context(parent,new.live_entity_id,true);
    if new.base_snapshot->'_context' is distinct from ctx->'base' or (new.live_entity_id is null and new.base_version_id is not null) then
      raise exception 'Invalid combination tee base' using errcode='40001';end if;
    if new.workflow_status<>'draft' or new.revision<>1 then raise exception 'New draft must be open' using errcode='22023';end if;
  else
    if old.created_by<>actor then raise exception 'Draft belongs to another Admin' using errcode='42501';end if;
    if row(new.draft_id,new.entity_type,new.entity_key,new.live_entity_id,new.parent_draft_id,new.base_version_id,new.base_snapshot,new.base_live_updated_at,new.created_by,new.created_at)
      is distinct from row(old.draft_id,old.entity_type,old.entity_key,old.live_entity_id,old.parent_draft_id,old.base_version_id,old.base_snapshot,old.base_live_updated_at,old.created_by,old.created_at)
      then raise exception 'Draft identity/base immutable' using errcode='22023';end if;
    if old.workflow_status<>'draft' or new.revision<>old.revision+1 then raise exception 'Draft changed or closed' using errcode='40001';end if;
    if new.workflow_status in('archived','published') and new.snapshot is distinct from old.snapshot then raise exception 'Closing preserves snapshot' using errcode='22023';end if;
    if new.workflow_status='published' and not exists(select 1 from public.admin_catalog_versions v where v.source_draft_id=old.draft_id
      and v.entity_type='combination_tee' and v.entity_key=old.entity_key and v.live_entity_id=coalesce(old.live_entity_id,old.entity_key) and v.published_by=actor) then
      raise exception 'Atomic published version required' using errcode='42501';end if;
  end if;
  new.snapshot:=public.admin_course_tee_full_snapshot(new.snapshot,new.live_entity_id is null and
    (tg_op='INSERT' or (new.workflow_status='archived' and new.snapshot=old.snapshot)));
  return new;
end;
$$;
create trigger admin_combination_tee_guard_draft before insert or update on public.admin_catalog_drafts
  for each row execute function public.admin_combination_tee_guard_draft();

create function public.admin_combination_tee_list(p_combination_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin();ctx jsonb;tees jsonb;drafts jsonb;
begin
  ctx:=public.admin_combination_tee_context(p_combination_id);
  select coalesce(jsonb_agg((to_jsonb(t)-'source_payload')||jsonb_build_object('display_order',public.admin_course_tee_fields(to_jsonb(t))->'display_order',
    'effective_holes_count',coalesce(t.holes_count,(ctx#>>'{combination,holes_count}')::integer),
    'has_draft_changes',exists(select 1 from public.admin_catalog_drafts d where d.entity_type='combination_tee' and d.live_entity_id=t.id
      and d.created_by=actor and d.workflow_status='draft' and d.snapshot is distinct from public.admin_course_tee_fields(to_jsonb(t))))
    order by (public.admin_course_tee_fields(to_jsonb(t))->>'display_order')::integer nulls last,lower(t.tee_name),t.holes_count,t.gender,t.id),'[]')
    into tees from public.combination_tees t where t.route_combination_id=p_combination_id;
  select coalesce(jsonb_agg(jsonb_build_object('draft_id',d.draft_id,'revision',d.revision,'snapshot',d.snapshot) order by d.created_at,d.draft_id),'[]') into drafts
    from public.admin_catalog_drafts d where d.entity_type='combination_tee' and d.live_entity_id is null and d.created_by=actor and d.workflow_status='draft'
      and d.base_snapshot#>>'{_context,combination,id}'=p_combination_id::text;
  return jsonb_build_object('combination',ctx->'combination','tees',tees,'new_drafts',drafts);
end;
$$;
create function public.admin_combination_tee_get_draft(p_tee_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin();parent uuid;d public.admin_catalog_drafts;ctx jsonb;
begin
  select route_combination_id into parent from public.combination_tees where id=p_tee_id;
  if parent is null then raise exception 'Existing combination tee required' using errcode='22023';end if;
  ctx:=public.admin_combination_tee_context(parent,p_tee_id);
  select * into d from public.admin_catalog_drafts where entity_type='combination_tee' and live_entity_id=p_tee_id and created_by=actor and workflow_status='draft';
  return jsonb_build_object('draft',case when d.draft_id is null then null else to_jsonb(d) end,'context',ctx);
end;
$$;
create function public.admin_combination_tee_open_draft(p_tee_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin();parent uuid;ctx jsonb;d public.admin_catalog_drafts;fields jsonb;latest uuid;
begin
  select route_combination_id into parent from public.combination_tees where id=p_tee_id;
  if parent is null then raise exception 'Existing combination tee required' using errcode='22023';end if;
  ctx:=public.admin_combination_tee_context(parent,p_tee_id,true);
  select * into d from public.admin_catalog_drafts where entity_type='combination_tee' and live_entity_id=p_tee_id and created_by=actor and workflow_status='draft';
  if d.draft_id is null then
    fields:=public.admin_course_tee_fields(ctx#>'{base,tee}');
    select version_id into latest from public.admin_catalog_versions where entity_type='combination_tee' and live_entity_id=p_tee_id order by version_number desc limit 1;
    insert into public.admin_catalog_drafts(entity_type,entity_key,live_entity_id,base_version_id,snapshot,base_snapshot,base_live_updated_at,created_by,updated_by)
      values('combination_tee',p_tee_id,p_tee_id,latest,fields,fields||jsonb_build_object('_context',ctx->'base'),(ctx#>>'{base,tee,updated_at}')::timestamptz,actor,actor) returning * into d;
  elsif d.base_snapshot#>>'{_context,combination,id}' is distinct from parent::text then
    raise exception 'Existing draft has no usable combination base; no automatic rebase' using errcode='40001';end if;
  return jsonb_build_object('draft',to_jsonb(d),'context',ctx);
end;
$$;
create function public.admin_combination_tee_open_new_draft(p_combination_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin();ctx jsonb;d public.admin_catalog_drafts;fields jsonb;
begin
  ctx:=public.admin_combination_tee_context(p_combination_id,null,true);
  fields:=jsonb_build_object('tee_name','','tee_color',null,'gender',null,'display_order',0,'course_rating',null,'slope_rating',null,'is_active',true);
  insert into public.admin_catalog_drafts(entity_type,entity_key,snapshot,base_snapshot,base_live_updated_at,created_by,updated_by)
    values('combination_tee',gen_random_uuid(),fields,fields||jsonb_build_object('_context',ctx->'base'),(ctx#>>'{base,combination,updated_at}')::timestamptz,actor,actor) returning * into d;
  return jsonb_build_object('draft',to_jsonb(d),'context',ctx);
end;
$$;
create function public.admin_combination_tee_resume_new_draft(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin();d public.admin_catalog_drafts;
begin
  select * into d from public.admin_catalog_drafts where draft_id=p_draft_id and entity_type='combination_tee' and live_entity_id is null and created_by=actor and workflow_status='draft';
  if d.draft_id is null then raise exception 'Owned new combination tee draft required' using errcode='42501';end if;
  return jsonb_build_object('draft',to_jsonb(d),'context',public.admin_combination_tee_context((d.base_snapshot#>>'{_context,combination,id}')::uuid));
end;
$$;
create function public.admin_combination_tee_save_draft(p_draft_id uuid,p_snapshot jsonb,p_expected_revision bigint)
returns public.admin_catalog_drafts language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin();
begin
  if not exists(select 1 from public.admin_catalog_drafts where draft_id=p_draft_id and entity_type='combination_tee' and created_by=actor and base_snapshot is not null) then
    raise exception 'Owned combination tee draft required' using errcode='42501';end if;
  return public.admin_catalog_save_draft(p_draft_id,public.admin_course_tee_full_snapshot(p_snapshot),p_expected_revision,1);
end;
$$;
create function public.admin_combination_tee_archive_draft(p_draft_id uuid,p_expected_revision bigint)
returns public.admin_catalog_drafts language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform public.admin_catalog_require_admin();return public.admin_catalog_archive_draft(p_draft_id,'combination_tee',p_expected_revision);
end;
$$;
create function public.admin_combination_tee_preview_draft(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin();d public.admin_catalog_drafts;ctx jsonb;fields jsonb;before jsonb;diff jsonb:='{}';blocks jsonb:='[]';
  parent uuid;scope integer;latest uuid;k text;
begin
  select * into d from public.admin_catalog_drafts where draft_id=p_draft_id and entity_type='combination_tee' and created_by=actor and workflow_status='draft';
  if d.draft_id is null then raise exception 'Owned open combination tee draft required' using errcode='42501';end if;
  parent:=(d.base_snapshot#>>'{_context,combination,id}')::uuid;ctx:=public.admin_combination_tee_context(parent,d.live_entity_id);
  fields:=public.admin_course_tee_full_snapshot(d.snapshot,d.live_entity_id is null);
  scope:=coalesce((ctx#>>'{tee,holes_count}')::integer,(ctx#>>'{combination,holes_count}')::integer);
  if d.base_snapshot->'_context' is distinct from ctx->'base' then blocks:=blocks||jsonb_build_array('Il tee, la combinazione o le buche sono cambiati rispetto alla base della bozza.');end if;
  if d.live_entity_id is null then
    before:=jsonb_build_object('tee_name',null,'tee_color',null,'gender',null,'display_order',null,'course_rating',null,'slope_rating',null,'is_active',null);
    if ctx->>'can_create' is distinct from 'true' then blocks:=blocks||jsonb_build_array('Combinazione attiva, origini valide e griglia completa con Par/SI e totale coerenti richiesti.');end if;
    if fields->>'tee_name'='' then blocks:=blocks||jsonb_build_array('Nome tee obbligatorio.');end if;
    if fields->>'is_active'='true' and (fields->>'course_rating' is null or fields->>'slope_rating' is null) then blocks:=blocks||jsonb_build_array('Un nuovo tee attivo richiede CR e Slope validi.');end if;
  else
    before:=public.admin_course_tee_fields(ctx#>'{base,tee}');
    select version_id into latest from public.admin_catalog_versions where entity_type='combination_tee' and live_entity_id=d.live_entity_id order by version_number desc limit 1;
    if latest is distinct from d.base_version_id or (ctx#>>'{base,tee,updated_at}')::timestamptz is distinct from d.base_live_updated_at then
      blocks:=blocks||jsonb_build_array('La versione del tee è cambiata rispetto alla base della bozza.');end if;
  end if;
  if fields->>'gender' is not null and fields->>'gender' not in('men','women') and (d.live_entity_id is null or fields->'gender' is distinct from before->'gender') then
    blocks:=blocks||jsonb_build_array('Categoria richiesta: Uomini, Donne o Non specificata.');end if;
  if exists(select 1 from public.combination_tees t where t.route_combination_id=parent and t.id is distinct from d.live_entity_id
    and t.tee_name=fields->>'tee_name' and coalesce(t.holes_count,(ctx#>>'{combination,holes_count}')::integer)=scope) then
    blocks:=blocks||jsonb_build_array('Nome tee già presente nello stesso ambito, anche in un’altra categoria o se disattivato.');end if;
  foreach k in array array['tee_name','tee_color','gender','display_order','course_rating','slope_rating','is_active'] loop
    if before->k is distinct from fields->k then diff:=diff||jsonb_build_object(k,jsonb_build_object('before',before->k,'after',fields->k));end if;
  end loop;
  if diff='{}' then blocks:=blocks||jsonb_build_array('Nessuna modifica da pubblicare.');end if;
  return jsonb_build_object('draft_id',d.draft_id,'revision',d.revision,'is_new',d.live_entity_id is null,'fields',fields,'diff',diff,'context',ctx-'base',
    'can_publish',jsonb_array_length(blocks)=0,'blockers',blocks,'foundation_impact',public.admin_catalog_tee_editor_impact('combination_tee',parent,d.live_entity_id,fields,
      d.live_entity_id is null,d.live_entity_id is null or diff<>'{}'::jsonb));
end;
$$;
create function public.admin_combination_tee_publish_draft(p_draft_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin();d public.admin_catalog_drafts;ctx jsonb;plan jsonb;fields jsonb;parent uuid;t public.combination_tees;v public.admin_catalog_versions;n bigint;
begin
  select * into d from public.admin_catalog_drafts where draft_id=p_draft_id and entity_type='combination_tee' and created_by=actor and base_snapshot is not null;
  if d.draft_id is null then raise exception 'Owned combination tee draft required' using errcode='42501';end if;
  lock table public.combination_tees in share row exclusive mode nowait;
  parent:=(d.base_snapshot#>>'{_context,combination,id}')::uuid;ctx:=public.admin_combination_tee_context(parent,d.live_entity_id,true);
  lock table public.route_combination_holes,public.route_holes in share mode nowait;
  select * into d from public.admin_catalog_drafts where draft_id=p_draft_id for update nowait;
  if p_expected_revision is null or d.revision<>p_expected_revision or d.workflow_status<>'draft' then raise exception 'Draft changed or closed' using errcode='40001';end if;
  plan:=public.admin_combination_tee_preview_draft(p_draft_id);
  if plan->>'can_publish' is distinct from 'true' then
    if exists(select 1 from jsonb_array_elements_text(plan->'blockers') b where b like '%rispetto alla base%') then raise exception 'Combination tee/source base changed' using errcode='40001';end if;
    if exists(select 1 from jsonb_array_elements_text(plan->'blockers') b where b like 'Nome tee già%') then raise exception 'Duplicate name/scope' using errcode='23505';end if;
    raise exception 'Combination tee not publishable' using errcode='22023';end if;
  fields:=plan->'fields';
  if d.live_entity_id is null then
    insert into public.combination_tees(id,route_combination_id,tee_name,tee_color,gender,display_order,holes_count,par_total,course_rating,slope_rating,is_active,estimated,source_system)
      values(d.entity_key,parent,fields->>'tee_name',fields->>'tee_color',fields->>'gender',(fields->>'display_order')::integer,
        (ctx#>>'{combination,holes_count}')::integer,(ctx#>>'{combination,total_par}')::integer,(fields->>'course_rating')::numeric,
        (fields->>'slope_rating')::integer,(fields->>'is_active')::boolean,false,'stablr') returning * into t;
  else
    select * into t from public.combination_tees where id=d.live_entity_id;
    update public.combination_tees set tee_name=case when public.admin_course_tee_fields(to_jsonb(t))->'tee_name'=fields->'tee_name' then t.tee_name else fields->>'tee_name' end,
      tee_color=case when public.admin_course_tee_fields(to_jsonb(t))->'tee_color' is not distinct from fields->'tee_color' then t.tee_color else fields->>'tee_color' end,gender=fields->>'gender',
      display_order=case when public.admin_course_tee_fields(to_jsonb(t))->'display_order' is not distinct from fields->'display_order' then t.display_order else (fields->>'display_order')::integer end,
      course_rating=(fields->>'course_rating')::numeric,slope_rating=(fields->>'slope_rating')::integer,is_active=(fields->>'is_active')::boolean,updated_at=clock_timestamp()
      where id=d.live_entity_id returning * into t;
  end if;
  select coalesce(max(version_number),0)+1 into n from public.admin_catalog_versions where entity_type='combination_tee' and entity_key=d.entity_key;
  insert into public.admin_catalog_versions(entity_type,entity_key,live_entity_id,source_draft_id,version_number,schema_version,snapshot,diff,published_by,published_at)
    values('combination_tee',d.entity_key,t.id,d.draft_id,n,1,fields,(plan->'diff')||case when d.live_entity_id is null then '{"creation":true}'::jsonb else '{}'::jsonb end,actor,clock_timestamp()) returning * into v;
  update public.admin_catalog_drafts set workflow_status='published',revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where draft_id=d.draft_id;
  return jsonb_build_object('draft_id',d.draft_id,'version_id',v.version_id,'version_number',v.version_number,'diff',v.diff,'context',public.admin_combination_tee_context(parent,t.id));
end;
$$;

-- Align only the existing Par draft comparison. Unchanged combination tee drafts
-- are benign; real overlapping metadata/rating edits still block. No Par writes.
do $$ declare body text;needle text;begin
  if to_regprocedure('public.admin_catalog_par_overlapping_drafts(uuid,jsonb,jsonb,jsonb)') is not null then
    select pg_get_functiondef('public.admin_catalog_par_overlapping_drafts(uuid,jsonb,jsonb,jsonb)'::regprocedure) into body;
    needle:=$q$        when 'route_holes_grid' then$q$;
    if strpos(body,needle)=0 or strpos(body,$q$when 'combination_tee' then$q$)>0 then raise exception 'Unsupported Par draft comparison';end if;
    body:=replace(body,needle,$q$        when 'combination_tee' then
          requested:=public.admin_course_tee_full_snapshot(d.snapshot);
          select public.admin_course_tee_fields(to_jsonb(t)) into current_values from public.combination_tees t join public.route_combinations c on c.id=t.route_combination_id where t.id=d.live_entity_id and c.club_id=p_club_id;
$q$||needle);
    needle:=$q$elsif d.entity_type='route_tee' then base_values:=public.admin_course_tee_editable(base_values,d.base_snapshot);end if;$q$;
    if strpos(body,needle)=0 then raise exception 'Unsupported Par tee base comparison';end if;
    execute replace(body,needle,$q$elsif d.entity_type='route_tee' then base_values:=public.admin_course_tee_editable(base_values,d.base_snapshot);
        elsif d.entity_type='combination_tee' then base_values:=public.admin_course_tee_full_snapshot(base_values);end if;$q$);
  end if;
end $$;

revoke all on function public.admin_catalog_tee_editor_impact(text,uuid,uuid,jsonb,boolean,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_combination_tee_context(uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_combination_tee_guard_draft() from public,anon,authenticated,service_role;
revoke all on function public.admin_combination_tee_list(uuid),public.admin_combination_tee_get_draft(uuid),public.admin_combination_tee_open_draft(uuid),
  public.admin_combination_tee_open_new_draft(uuid),public.admin_combination_tee_resume_new_draft(uuid),public.admin_combination_tee_save_draft(uuid,jsonb,bigint),
  public.admin_combination_tee_archive_draft(uuid,bigint),public.admin_combination_tee_preview_draft(uuid),public.admin_combination_tee_publish_draft(uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_combination_tee_list(uuid),public.admin_combination_tee_get_draft(uuid),public.admin_combination_tee_open_draft(uuid),
  public.admin_combination_tee_open_new_draft(uuid),public.admin_combination_tee_resume_new_draft(uuid),public.admin_combination_tee_save_draft(uuid,jsonb,bigint),
  public.admin_combination_tee_archive_draft(uuid,bigint),public.admin_combination_tee_preview_draft(uuid),public.admin_combination_tee_publish_draft(uuid,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
