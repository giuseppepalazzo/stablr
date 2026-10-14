-- Single-course tees only. Apply ONCE after admin-course-tee-editor.sql.
-- Reuses drafts, versions and publishers. No backfill, index changes or remote execution.
begin;
alter table public.route_tees add column display_order integer;

create function public.admin_course_tee_fields(p_tee jsonb)
returns jsonb language sql immutable set search_path=pg_catalog as $$
  select jsonb_build_object('tee_name',btrim(p_tee->>'tee_name'),'tee_color',nullif(btrim(p_tee->>'tee_color'),''),'gender',p_tee->'gender',
    'display_order',coalesce(nullif(p_tee->'display_order','null'::jsonb),case
      when jsonb_typeof(p_tee#>'{source_payload,admin_display_order}')='number'
        and (p_tee#>>'{source_payload,admin_display_order}')::numeric=trunc((p_tee#>>'{source_payload,admin_display_order}')::numeric)
        and (p_tee#>>'{source_payload,admin_display_order}')::numeric between -2147483648 and 2147483647
      then p_tee#>'{source_payload,admin_display_order}' else 'null'::jsonb end),
    'course_rating',p_tee->'course_rating','slope_rating',p_tee->'slope_rating','is_active',p_tee->'is_active');
$$;

create function public.admin_course_tee_full_snapshot(p_snapshot jsonb,p_empty_name boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare name text; color text; ordering numeric; ratings jsonb;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
    or not(p_snapshot ?& array['tee_name','tee_color','gender','display_order','course_rating','slope_rating','is_active'])
    or (p_snapshot-array['tee_name','tee_color','gender','display_order','course_rating','slope_rating','is_active'])<>'{}'
    or jsonb_typeof(p_snapshot->'tee_name')<>'string' or jsonb_typeof(p_snapshot->'tee_color') not in ('string','null')
    or jsonb_typeof(p_snapshot->'gender') not in ('string','null') or jsonb_typeof(p_snapshot->'display_order') not in ('number','null') then
    raise exception 'Only allowed tee metadata and ratings are editable' using errcode='22023';end if;
  name:=btrim(p_snapshot->>'tee_name');color:=nullif(btrim(p_snapshot->>'tee_color'),'');ordering:=(p_snapshot->>'display_order')::numeric;
  if (name='' and not p_empty_name) or char_length(name)>200 or char_length(color)>100
    or char_length(p_snapshot->>'gender')>100 or (ordering is not null and (ordering<>trunc(ordering) or ordering not between -2147483648 and 2147483647)) then
    raise exception 'Valid tee name, color, category and integer order required' using errcode='22023';end if;
  ratings:=p_snapshot-array['tee_name','tee_color','gender','display_order'];
  if jsonb_typeof(ratings->'course_rating') not in ('number','null') or jsonb_typeof(ratings->'slope_rating') not in ('number','null')
    or jsonb_typeof(ratings->'is_active')<>'boolean' then raise exception 'Typed ratings required' using errcode='22023';end if;
  if (ratings->>'course_rating')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'Finite CR required' using errcode='23514';end if;
  if ratings->>'slope_rating' is not null and ((ratings->>'slope_rating')::numeric<>trunc((ratings->>'slope_rating')::numeric)
    or (ratings->>'slope_rating')::numeric not between 55 and 155) then raise exception 'Integer Slope 55..155 required' using errcode='23514';end if;
  return jsonb_build_object('tee_name',name,'tee_color',color,'gender',p_snapshot->'gender','display_order',ordering::integer,
    'course_rating',(ratings->>'course_rating')::numeric,'slope_rating',(ratings->>'slope_rating')::integer,'is_active',(ratings->>'is_active')::boolean);
end;
$$;

-- Preserve the old three-field contract for existing saved drafts/callers.
create or replace function public.admin_course_tee_validate_snapshot(p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare expanded jsonb;
begin
  if p_snapshot ? 'tee_name' then return public.admin_course_tee_full_snapshot(p_snapshot);end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or not(p_snapshot ?& array['course_rating','slope_rating','is_active'])
    or (p_snapshot-array['course_rating','slope_rating','is_active'])<>'{}' then raise exception 'Invalid tee fields' using errcode='22023';end if;
  expanded:=public.admin_course_tee_full_snapshot(p_snapshot||jsonb_build_object('tee_name','Legacy','tee_color',null,'gender',null,'display_order',null));
  return expanded-array['tee_name','tee_color','gender','display_order'];
end;
$$;

create function public.admin_course_tee_editable(p_snapshot jsonb,p_base jsonb)
returns jsonb language sql immutable set search_path=pg_catalog as $$
  select case when p_snapshot ? 'tee_name' then p_snapshot else
    public.admin_course_tee_fields(p_base#>'{_context,tee}')||p_snapshot end;
$$;

-- Expose the effective explicit order to Admin without changing the raw base.
-- Otherwise tees created by the private Club flow would show a false badge.
create or replace function public.admin_course_tee_context(p_tee_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog as $$
  select jsonb_build_object('tee',(to_jsonb(t)-'source_payload')||jsonb_build_object(
    'display_order',public.admin_course_tee_fields(to_jsonb(t))->'display_order','effective_holes_count',coalesce(t.holes_count,r.holes_count)),
    'course',jsonb_build_object('id',r.id,'club_id',r.club_id,'name',r.name,'holes_count',r.holes_count,'total_par',r.total_par),
    'base',jsonb_build_object('tee',to_jsonb(t),'course',to_jsonb(r),'club',jsonb_build_object('id',c.id,'is_active',c.is_active)))
    from public.route_tees t join public.course_routes r on r.id=t.route_id join public.clubs c on c.id=r.club_id and c.is_active where t.id=p_tee_id;
$$;

create function public.admin_course_tee_new_context(p_course_id uuid,p_lock boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.course_routes; c public.clubs; grid jsonb; n integer; distinct_n integer; total integer; valid boolean;
begin
  if p_lock then select * into r from public.course_routes where id=p_course_id for share nowait;
  else select * into r from public.course_routes where id=p_course_id;end if;
  if r.id is null then raise exception 'Existing course required' using errcode='22023';end if;
  if p_lock then select * into c from public.clubs where id=r.club_id and is_active for share nowait;
  else select * into c from public.clubs where id=r.club_id and is_active;end if;
  if c.id is null then raise exception 'Active Club required' using errcode='22023';end if;
  select count(*),count(distinct h.physical_hole_number),sum(h.par),
    coalesce(bool_and(h.par is not null and h.physical_hole_number between 1 and r.holes_count),false),
    coalesce(jsonb_agg(jsonb_build_object('id',h.id,'number',h.physical_hole_number,'par',h.par,'si',h.stroke_index) order by h.physical_hole_number),'[]')
    into n,distinct_n,total,valid,grid from public.route_holes h where h.route_id=r.id;
  return jsonb_build_object('tee',jsonb_build_object('tee_name','Nuovo tee','holes_count',r.holes_count,'effective_holes_count',r.holes_count,'par_total',total),
    'course',jsonb_build_object('id',r.id,'club_id',r.club_id,'name',r.name,'holes_count',r.holes_count,'total_par',r.total_par,'is_active',r.is_active),
    'can_create',r.is_active and valid and n=r.holes_count and distinct_n=n and r.total_par is not null and r.total_par=total,
    'base',jsonb_build_object('tee',null,'course',to_jsonb(r),'club',jsonb_build_object('id',c.id,'is_active',c.is_active),
      'new_tee',true,'grid_hash',encode(sha256(convert_to(grid::text,'UTF8')),'hex')));
end;
$$;

create or replace function public.admin_course_tee_guard_draft()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; ctx jsonb; course_id uuid;
begin
  if tg_op='INSERT' then if new.entity_type<>'route_tee' then return new;end if;
  elsif old.entity_type<>'route_tee' and new.entity_type<>'route_tee' then return new;end if;
  actor:=public.admin_catalog_require_admin();
  if new.entity_type<>'route_tee' or new.parent_draft_id is not null or new.schema_version<>1 or new.base_snapshot is null
    or jsonb_typeof(new.base_snapshot->'_context') is distinct from 'object' or new.created_by<>actor or new.updated_by<>actor
    or (new.live_entity_id is not null and new.entity_key is distinct from new.live_entity_id) then
    raise exception 'Owned course tee draft required' using errcode='42501';end if;
  if new.live_entity_id is null then
    course_id:=(new.base_snapshot#>>'{_context,course,id}')::uuid;
    if new.base_snapshot#>'{_context,new_tee}' is distinct from 'true'::jsonb or new.base_version_id is not null or course_id is null then
      raise exception 'Server base for new tee required' using errcode='42501';end if;
    if tg_op='INSERT' then
      ctx:=public.admin_course_tee_new_context(course_id,true);
      if new.base_snapshot->'_context' is distinct from ctx->'base' then raise exception 'Invalid new tee base' using errcode='40001';end if;
    end if;
  end if;
  if tg_op='UPDATE' then
    if old.created_by<>actor then raise exception 'Tee draft belongs to another Admin' using errcode='42501';end if;
    if row(new.draft_id,new.entity_type,new.entity_key,new.live_entity_id,new.parent_draft_id,new.base_version_id,new.base_snapshot,new.base_live_updated_at,new.created_by,new.created_at)
      is distinct from row(old.draft_id,old.entity_type,old.entity_key,old.live_entity_id,old.parent_draft_id,old.base_version_id,old.base_snapshot,old.base_live_updated_at,old.created_by,old.created_at)
      then raise exception 'Tee identity and base immutable' using errcode='22023';end if;
    if old.workflow_status<>'draft' or new.revision<>old.revision+1 then raise exception 'Tee draft changed or closed' using errcode='40001';end if;
    if new.workflow_status='archived' and new.snapshot is distinct from old.snapshot then raise exception 'Archival preserves values' using errcode='22023';end if;
    if new.workflow_status='published' and (new.snapshot is distinct from old.snapshot or not exists(select 1 from public.admin_catalog_versions v
      where v.source_draft_id=old.draft_id and v.entity_type='route_tee' and v.entity_key=old.entity_key
        and v.live_entity_id=coalesce(old.live_entity_id,old.entity_key) and v.published_by=actor)) then
      raise exception 'Atomic tee version required' using errcode='42501';end if;
  elsif new.workflow_status<>'draft' or new.revision<>1 then raise exception 'New tee draft must be open' using errcode='22023';end if;
  if new.live_entity_id is null and new.snapshot->>'tee_name'='' and
    (tg_op='INSERT' or (new.workflow_status='archived' and new.snapshot=old.snapshot)) then
    new.snapshot:=public.admin_course_tee_full_snapshot(new.snapshot,true);
  else new.snapshot:=public.admin_course_tee_validate_snapshot(new.snapshot);end if;
  return new;
end;
$$;

create function public.admin_course_tee_open_new_draft(p_course_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); ctx jsonb; d public.admin_catalog_drafts; fields jsonb;
begin
  ctx:=public.admin_course_tee_new_context(p_course_id,true);
  fields:=jsonb_build_object('tee_name','','tee_color',null,'gender',null,'display_order',0,'course_rating',null,'slope_rating',null,'is_active',true);
  insert into public.admin_catalog_drafts(entity_type,entity_key,snapshot,base_snapshot,base_live_updated_at,created_by,updated_by)
    values('route_tee',gen_random_uuid(),fields,fields||jsonb_build_object('_context',ctx->'base'),(ctx#>>'{base,course,updated_at}')::timestamptz,actor,actor) returning * into d;
  return jsonb_build_object('draft',to_jsonb(d),'context',ctx);
end;
$$;

create function public.admin_course_tee_resume_new_draft(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); d public.admin_catalog_drafts; ctx jsonb;
begin
  select * into d from public.admin_catalog_drafts where draft_id=p_draft_id and entity_type='route_tee' and live_entity_id is null
    and created_by=actor and workflow_status='draft';
  if d.draft_id is null then raise exception 'Owned new tee draft required' using errcode='42501';end if;
  ctx:=public.admin_course_tee_new_context((d.base_snapshot#>>'{_context,course,id}')::uuid);
  return jsonb_build_object('draft',to_jsonb(d),'context',ctx);
end;
$$;

create or replace function public.admin_course_tee_list(p_course_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); ctx jsonb; tees jsonb; drafts jsonb;
begin
  ctx:=public.admin_course_tee_new_context(p_course_id);
  select coalesce(jsonb_agg((to_jsonb(t)-'source_payload')||jsonb_build_object('display_order',public.admin_course_tee_fields(to_jsonb(t))->'display_order',
    'effective_holes_count',coalesce(t.holes_count,(ctx#>>'{course,holes_count}')::integer),
    'has_draft_changes',exists(select 1 from public.admin_catalog_drafts d where d.entity_type='route_tee' and d.live_entity_id=t.id
      and d.created_by=actor and d.workflow_status='draft' and public.admin_course_tee_editable(d.snapshot,d.base_snapshot) is distinct from public.admin_course_tee_fields(to_jsonb(t))))
    order by (public.admin_course_tee_fields(to_jsonb(t))->>'display_order')::integer nulls last,lower(t.tee_name),t.holes_count,t.gender,t.id),'[]')
    into tees from public.route_tees t where t.route_id=p_course_id;
  select coalesce(jsonb_agg(jsonb_build_object('draft_id',d.draft_id,'snapshot',d.snapshot,'revision',d.revision) order by d.created_at,d.draft_id),'[]')
    into drafts from public.admin_catalog_drafts d where d.entity_type='route_tee' and d.live_entity_id is null and d.workflow_status='draft'
      and d.created_by=actor and d.base_snapshot#>>'{_context,course,id}'=p_course_id::text and d.base_snapshot#>'{_context,new_tee}'='true'::jsonb;
  return jsonb_build_object('course',ctx->'course','tees',tees,'new_drafts',drafts);
end;
$$;

-- Existing entry point now captures all editable fields; already-saved drafts
-- are resumed unchanged. No automatic rebase or version/draft migration.
create or replace function public.admin_course_tee_open_draft(p_tee_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); live public.route_tees; ctx jsonb; d public.admin_catalog_drafts; latest uuid; fields jsonb;
begin
  live:=public.admin_course_tee_lock_target(p_tee_id);ctx:=public.admin_course_tee_context(live.id);
  select * into d from public.admin_catalog_drafts where entity_type='route_tee' and live_entity_id=live.id and created_by=actor and workflow_status='draft';
  if d.draft_id is null then
    fields:=public.admin_course_tee_fields(to_jsonb(live));
    select v.version_id into latest from public.admin_catalog_versions v where v.entity_type='route_tee' and v.live_entity_id=live.id order by v.version_number desc limit 1;
    insert into public.admin_catalog_drafts(entity_type,entity_key,live_entity_id,base_version_id,snapshot,base_snapshot,base_live_updated_at,created_by,updated_by)
      values('route_tee',live.id,live.id,latest,fields,fields||jsonb_build_object('_context',ctx->'base'),live.updated_at,actor,actor) returning * into d;
  end if;
  return jsonb_build_object('draft',to_jsonb(d),'context',ctx);
end;
$$;

create function public.admin_course_tee_preview_draft(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); d public.admin_catalog_drafts; live public.route_tees; ctx jsonb; actual jsonb;
  fields jsonb; original jsonb; scope integer; parent_id uuid; latest uuid; before jsonb; changed jsonb:='{}'; blocks jsonb:='[]'; k text;
begin
  select * into d from public.admin_catalog_drafts where draft_id=p_draft_id and entity_type='route_tee' and created_by=actor and workflow_status='draft';
  if d.draft_id is null or d.base_snapshot is null then raise exception 'Owned open tee draft required' using errcode='42501';end if;
  fields:=public.admin_course_tee_full_snapshot(public.admin_course_tee_editable(d.snapshot,d.base_snapshot),d.live_entity_id is null);
  if d.live_entity_id is null then
    parent_id:=(d.base_snapshot#>>'{_context,course,id}')::uuid;ctx:=public.admin_course_tee_new_context(parent_id);scope:=(ctx#>>'{course,holes_count}')::integer;
    if d.base_snapshot->'_context' is distinct from ctx->'base' then blocks:=blocks||jsonb_build_array('Il Percorso o le buche sono cambiati rispetto alla base della bozza.');end if;
    if (ctx->>'can_create')::boolean is distinct from true then blocks:=blocks||jsonb_build_array('Il Percorso deve essere attivo, con griglia completa e Totale Par coerente.');end if;
    if fields->>'tee_name'='' then blocks:=blocks||jsonb_build_array('Nome tee obbligatorio.');end if;
    if (fields->>'is_active')::boolean and (fields->'course_rating'='null'::jsonb or fields->'slope_rating'='null'::jsonb) then
      blocks:=blocks||jsonb_build_array('Un nuovo tee attivo richiede CR e Slope validi.');end if;
    before:=jsonb_build_object('tee_name',null,'tee_color',null,'gender',null,'display_order',null,'course_rating',null,'slope_rating',null,'is_active',null);
  else
    select * into live from public.route_tees where id=d.live_entity_id;
    if live.id is null then raise exception 'Live tee no longer available' using errcode='40001';end if;
    ctx:=public.admin_course_tee_context(live.id);if ctx is null then raise exception 'Active Club required' using errcode='40001';end if;
    parent_id:=live.route_id;scope:=coalesce(live.holes_count,(ctx#>>'{course,holes_count}')::integer);before:=public.admin_course_tee_fields(to_jsonb(live));
    select v.version_id into latest from public.admin_catalog_versions v where v.entity_type='route_tee' and v.live_entity_id=live.id order by v.version_number desc limit 1;
    actual:=ctx->'base';original:=d.base_snapshot->'_context';
    -- The additive NULL order column must not invalidate a pre-migration base.
    -- An actual order written since that base is still a real conflict.
    if not(original->'tee' ? 'display_order') and live.display_order is null then actual:=jsonb_set(actual,'{tee}',(actual->'tee')-'display_order');end if;
    if actual is distinct from original or live.updated_at is distinct from d.base_live_updated_at or latest is distinct from d.base_version_id then
      blocks:=blocks||jsonb_build_array('Il tee o il Percorso sono cambiati rispetto alla base della bozza.');end if;
  end if;
  if fields->>'gender' is not null and fields->>'gender' not in ('men','women')
    and (d.live_entity_id is null or fields->'gender' is distinct from before->'gender') then
    blocks:=blocks||jsonb_build_array('Categoria richiesta: Uomini, Donne o Non specificata.');end if;
  if exists(select 1 from public.route_tees t where t.route_id=parent_id and t.id is distinct from d.live_entity_id
    and t.tee_name=fields->>'tee_name' and coalesce(t.holes_count,(ctx#>>'{course,holes_count}')::integer)=scope) then
    blocks:=blocks||jsonb_build_array('Nome tee già presente nello stesso ambito, anche in un’altra categoria o se disattivato.');end if;
  foreach k in array array['tee_name','tee_color','gender','display_order','course_rating','slope_rating','is_active'] loop
    if before->k is distinct from fields->k then changed:=changed||jsonb_build_object(k,jsonb_build_object('before',before->k,'after',fields->k));end if;
  end loop;
  if changed='{}' then blocks:=blocks||jsonb_build_array('Nessuna modifica da pubblicare.');end if;
  return jsonb_build_object('draft_id',d.draft_id,'revision',d.revision,'is_new',d.live_entity_id is null,'fields',fields,'diff',changed,
    'context',ctx-'base','can_publish',jsonb_array_length(blocks)=0,'blockers',blocks);
end;
$$;

create or replace function public.admin_course_tee_publish_draft(p_draft_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); d public.admin_catalog_drafts; plan jsonb; fields jsonb; live public.route_tees; v public.admin_catalog_versions;
  parent_id uuid; number bigint; initial public.admin_catalog_drafts;
begin
  select * into initial from public.admin_catalog_drafts where draft_id=p_draft_id and entity_type='route_tee' and created_by=actor and base_snapshot is not null;
  if initial.draft_id is null then raise exception 'Owned tee draft required' using errcode='42501';end if;
  -- Reserve the existing live uniqueness domain against legacy writers/phantoms.
  lock table public.route_tees in share row exclusive mode nowait;
  if initial.live_entity_id is null then
    parent_id:=(initial.base_snapshot#>>'{_context,course,id}')::uuid;
    perform public.admin_course_tee_new_context(parent_id,true);
    lock table public.route_holes in share mode nowait;
  else live:=public.admin_course_tee_lock_target(initial.live_entity_id);parent_id:=live.route_id;end if;
  select * into d from public.admin_catalog_drafts where draft_id=p_draft_id for update nowait;
  if d.workflow_status<>'draft' or p_expected_revision is null or d.revision<>p_expected_revision then raise exception 'Tee draft changed or closed' using errcode='40001';end if;
  plan:=public.admin_course_tee_preview_draft(p_draft_id);
  if (plan->>'can_publish')::boolean is distinct from true then
    if exists(select 1 from jsonb_array_elements_text(plan->'blockers') b where b like '%rispetto alla base%') then raise exception 'Tee/course base changed' using errcode='40001';end if;
    if exists(select 1 from jsonb_array_elements_text(plan->'blockers') b where b like 'Nome tee già%') then raise exception 'Duplicate name/scope' using errcode='23505';end if;
    raise exception 'Tee not publishable' using errcode='22023';end if;
  fields:=plan->'fields';
  if d.live_entity_id is null then
    insert into public.route_tees(id,route_id,tee_name,tee_color,gender,display_order,holes_count,par_total,course_rating,slope_rating,is_active,estimated,source_system)
      values(d.entity_key,parent_id,fields->>'tee_name',fields->>'tee_color',fields->>'gender',(fields->>'display_order')::integer,
        (plan#>>'{context,course,holes_count}')::integer,(plan#>>'{context,course,total_par}')::integer,
        (fields->>'course_rating')::numeric,(fields->>'slope_rating')::integer,(fields->>'is_active')::boolean,false,'stablr') returning * into live;
  else
    update public.route_tees set
      tee_name=case when public.admin_course_tee_fields(to_jsonb(live))->'tee_name' is not distinct from fields->'tee_name' then live.tee_name else fields->>'tee_name' end,
      tee_color=case when public.admin_course_tee_fields(to_jsonb(live))->'tee_color' is not distinct from fields->'tee_color' then live.tee_color else fields->>'tee_color' end,
      gender=fields->>'gender',
      display_order=case when public.admin_course_tee_fields(to_jsonb(live))->'display_order' is not distinct from fields->'display_order' then live.display_order else (fields->>'display_order')::integer end,
      course_rating=(fields->>'course_rating')::numeric,slope_rating=(fields->>'slope_rating')::integer,is_active=(fields->>'is_active')::boolean,
      updated_at=clock_timestamp() where id=d.live_entity_id returning * into live;
  end if;
  select coalesce(max(version_number),0)+1 into number from public.admin_catalog_versions where entity_type='route_tee' and entity_key=d.entity_key;
  insert into public.admin_catalog_versions(entity_type,entity_key,live_entity_id,source_draft_id,version_number,schema_version,snapshot,diff,published_by,published_at)
    values('route_tee',d.entity_key,live.id,d.draft_id,number,1,fields,(plan->'diff')||case when d.live_entity_id is null then jsonb_build_object('creation',true) else '{}'::jsonb end,
      actor,clock_timestamp()) returning * into v;
  update public.admin_catalog_drafts set workflow_status='published',revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where draft_id=d.draft_id;
  return jsonb_build_object('draft_id',d.draft_id,'version_id',v.version_id,'version_number',v.version_number,'diff',v.diff,'context',public.admin_course_tee_context(live.id));
end;
$$;

-- Existing Par conflict check must compare the newly editable metadata too.
-- This does not change Par rules or rebase any stored draft. Fail closed if an
-- unexpected existing contract is installed; absent optional Par feature is OK.
do $$
declare body text; old_current text;
begin
  if to_regprocedure('public.admin_catalog_par_overlapping_drafts(uuid,jsonb,jsonb,jsonb)') is not null then
    select pg_get_functiondef('public.admin_catalog_par_overlapping_drafts(uuid,jsonb,jsonb,jsonb)'::regprocedure) into body;
    old_current:=$q$select jsonb_build_object('course_rating',t.course_rating,'slope_rating',t.slope_rating,'is_active',t.is_active) into current_values from public.route_tees$q$;
    if strpos(body,old_current)=0 or strpos(body,'requested:=public.admin_course_tee_validate_snapshot(d.snapshot);')=0 then raise exception 'Unsupported Par tee comparison';end if;
    body:=replace(body,'requested:=public.admin_course_tee_validate_snapshot(d.snapshot);','requested:=public.admin_course_tee_editable(d.snapshot,d.base_snapshot);');
    body:=replace(body,old_current,'select public.admin_course_tee_fields(to_jsonb(t)) into current_values from public.route_tees');
    if strpos(body,$q$elsif d.entity_type='route_tee' then base_values:=public.admin_course_tee_validate_snapshot(base_values);end if;$q$)=0 then
      raise exception 'Unsupported Par tee base comparison';end if;
    body:=replace(body,$q$elsif d.entity_type='route_tee' then base_values:=public.admin_course_tee_validate_snapshot(base_values);end if;$q$,
      $q$elsif d.entity_type='route_tee' then base_values:=public.admin_course_tee_editable(base_values,d.base_snapshot);end if;$q$);
    execute body;
  end if;
end $$;

revoke all on function public.admin_course_tee_fields(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_editable(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_full_snapshot(jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_new_context(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_open_new_draft(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_resume_new_draft(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_tee_preview_draft(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_course_tee_open_new_draft(uuid) to authenticated;
grant execute on function public.admin_course_tee_resume_new_draft(uuid) to authenticated;
grant execute on function public.admin_course_tee_preview_draft(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
