-- Task 3. One-shot incremental migration, apply manually after the catalog
-- workflow, physical phases 1–3c/multi9 and published course/combination tee CRUD.
-- No backfill. No writes to tees, Par/SI grids, imports, ratings or rounds.
begin;

-- Extend the actual installed allowlists without removing previously added types.
do $$ declare tab text; definition text; begin
  foreach tab in array array['admin_catalog_drafts','admin_catalog_versions'] loop
    select pg_get_constraintdef(oid) into definition from pg_constraint
      where conrelid=('public.'||tab)::regclass and conname=tab||'_entity_type_check';
    if definition is null then raise exception 'Workflow type constraint required';end if;
    execute format('alter table public.%I drop constraint %I',tab,tab||'_entity_type_check');
    execute format('alter table public.%I add constraint %I check ((%s) or entity_type in (''route_tee_si'',''combination_tee_si''))',
      tab,tab||'_entity_type_check',substring(definition from 8 for char_length(definition)-8));
  end loop;
end $$;

-- Current player-safe projection only. Private drafts and immutable history stay
-- in the existing workflow tables. No author, payload or draft data here.
-- Deliberately no FK to imported tees: replaced UUIDs never inherit old overrides.
create table public.catalog_tee_si (
  tee_kind text not null check(tee_kind in ('route_tee','combination_tee')),
  tee_id uuid not null,
  configuration_id uuid not null references public.admin_catalog_playable_configurations(id) on delete restrict,
  contract jsonb not null check(jsonb_typeof(contract)='object'),
  revision bigint not null check(revision>0),
  version_id uuid not null references public.admin_catalog_versions(version_id) on delete restrict,
  primary key(tee_kind,tee_id)
);
alter table public.catalog_tee_si enable row level security;
revoke all on public.catalog_tee_si from public,anon,authenticated,service_role;
grant select on public.catalog_tee_si to authenticated;
create policy catalog_tee_si_read on public.catalog_tee_si for select to authenticated using (
  auth.uid() is not null and auth.role()='authenticated' and (public.is_admin() or
    (tee_kind='route_tee' and exists(select 1 from public.route_tees t join public.course_routes r on r.id=t.route_id
      join public.clubs c on c.id=r.club_id where t.id=tee_id and t.is_active and r.is_active and c.is_active and c.playable)) or
    (tee_kind='combination_tee' and exists(select 1 from public.combination_tees t join public.route_combinations r on r.id=t.route_combination_id
      join public.clubs c on c.id=r.club_id where t.id=tee_id and t.is_active and r.is_active and c.is_active and c.playable))));
create trigger catalog_tee_si_no_delete before delete on public.catalog_tee_si
  for each row execute function public.admin_catalog_reject_removal();
create trigger catalog_tee_si_no_truncate before truncate on public.catalog_tee_si
  for each statement execute function public.admin_catalog_reject_removal();
create unique index admin_tee_si_personal_draft on public.admin_catalog_drafts(entity_type,live_entity_id,created_by)
  where entity_type in ('route_tee_si','combination_tee_si') and workflow_status='draft';

create function public.admin_tee_si_context(p_kind text,p_tee uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare t jsonb; parent_id uuid; club_id uuid; n integer; parent_holes integer; actual_holes integer;
  cfg public.admin_catalog_playable_configurations;
  candidates integer; slots jsonb; allowed jsonb; live jsonb; item jsonb; h jsonb; problems text[]:='{}';
  state public.catalog_tee_si; structure public.admin_catalog_physical_structures;
  parent public.admin_catalog_playable_configurations;
  legacy boolean; latest uuid; overlap boolean;
begin
  if p_kind not in ('route_tee','combination_tee') or p_kind is null or p_tee is null then
    raise exception 'Exact tee kind/id required' using errcode='22023';end if;
  if p_kind='route_tee' then
    select to_jsonb(x),r.id,r.club_id,coalesce(x.holes_count,r.holes_count),r.holes_count,
      jsonb_typeof(r.source_payload->'tee_specific_hole_matrix')='object'
      into t,parent_id,club_id,n,parent_holes,legacy from public.route_tees x join public.course_routes r on r.id=x.route_id
      join public.clubs c on c.id=r.club_id and c.is_active where x.id=p_tee;
  else
    select to_jsonb(x),r.id,r.club_id,coalesce(x.holes_count,r.holes_count),r.holes_count,false
      into t,parent_id,club_id,n,parent_holes,legacy from public.combination_tees x join public.route_combinations r on r.id=x.route_combination_id
      join public.clubs c on c.id=r.club_id and c.is_active where x.id=p_tee;
  end if;
  if t is null then raise exception 'Existing tee in active Club required' using errcode='22023';end if;
  select count(*) into candidates from public.admin_catalog_playable_configurations c where c.review_status='verified'
    and c.holes_count=n and ((p_kind='route_tee' and c.legacy_course_route_id=parent_id)
      or(p_kind='combination_tee' and c.legacy_combination_id=parent_id));
  if candidates<>1 then problems:=array_append(problems,'Collegamento esatto a una sola configurazione verificata non disponibile.');
  else
    select * into cfg from public.admin_catalog_playable_configurations c where c.review_status='verified' and c.holes_count=n
      and ((p_kind='route_tee' and c.legacy_course_route_id=parent_id) or(p_kind='combination_tee' and c.legacy_combination_id=parent_id));
    select * into structure from public.admin_catalog_physical_structures s where s.id=cfg.structure_id;
    if structure.review_status is distinct from 'verified' or structure.classification='non_classificato' then
      problems:=array_append(problems,'Struttura fisica non verificata.');end if;
    if cfg.parent_configuration_id is not null then
      select * into parent from public.admin_catalog_playable_configurations c where c.id=cfg.parent_configuration_id;
      if parent.review_status is distinct from 'verified' or parent.revision is distinct from cfg.parent_configuration_revision then
        problems:=array_append(problems,'Configurazione padre non più allineata alla revisione verificata.');end if;
    end if;
    if p_kind='route_tee' then select count(*) into actual_holes from public.route_holes where route_id=parent_id;
    else select count(*) into actual_holes from public.route_combination_holes where route_combination_id=parent_id;end if;
    if actual_holes<>parent_holes or parent_holes<>(case cfg.registration_kind when 'repeated_18' then 9 else n end) then
      problems:=array_append(problems,'Cardinalità del Percorso/configurazione live cambiata.');end if;
  end if;
  select * into state from public.catalog_tee_si where tee_kind=p_kind and tee_id=p_tee;
  slots:='[]';
  for item in select jsonb_build_object('slot_id',s.id,'position',s.position,'occurrence',s.occurrence,
    'physical_hole_id',s.physical_hole_id,'live_hole_id',coalesce(s.legacy_route_hole_id,s.legacy_combination_hole_id),
    'standard_si',s.stroke_index,'slot_revision',s.revision,'review_status',s.review_status,
    'physical_verified',p.review_status='verified','physical_revision',p.revision,
    'source_hole_id',p.source_route_hole_id,'source_verified',l.review_status='verified','source_revision',l.revision)
    from public.admin_catalog_configuration_holes s left join public.admin_catalog_physical_holes p on p.id=s.physical_hole_id
    left join public.admin_catalog_physical_course_links l on l.id=p.source_course_link_id
    where s.configuration_id=cfg.id order by s.position loop
    if p_kind='route_tee' then
      select jsonb_build_object('si',r.stroke_index) into h from public.route_holes r where r.id=(item->>'live_hole_id')::uuid
        and r.route_id=parent_id and (r.id=(item->>'source_hole_id')::uuid
          -- Phase 3c persisted an EXPLICIT verified interval mapping to an
          -- independent live nine. Read that slot, never infer another offset.
          or (cfg.registration_kind in('front_9','back_9') and cfg.relationship_kind='derived' and parent.id is not null));
      if h is not null and cfg.registration_kind='repeated_18' and (item->>'occurrence')::integer=2 then
        h:=jsonb_build_object('si',least(18,(h->>'si')::integer+1));
      end if;
    else
      select jsonb_build_object('si',r.stroke_index) into h from public.route_combination_holes r
        join public.route_holes source on source.route_id=r.route_id and source.physical_hole_number=r.physical_hole_number
        where r.id=(item->>'live_hole_id')::uuid and r.route_combination_id=parent_id and r.round_hole_number=(item->>'position')::integer
        and source.id=(item->>'source_hole_id')::uuid;
    end if;
    if h is null or h->'si' is distinct from item->'standard_si' or item->>'review_status'<>'verified'
      or item->'physical_verified' is distinct from 'true'::jsonb or item->'source_verified' is distinct from 'true'::jsonb then
      problems:=array_append(problems,'Buche, SI o collegamenti fisici non più allineati alla configurazione verificata.');end if;
    slots:=slots||jsonb_build_array(item);
  end loop;
  select jsonb_agg((x->>'standard_si')::integer order by (x->>'standard_si')::integer) into allowed from jsonb_array_elements(slots)x;
  if jsonb_array_length(slots)<>n or n not in(9,18) or
    (select count(distinct x->>'position') from jsonb_array_elements(slots)x where (x->>'position')::integer between 1 and n)<>n or
    (select count(distinct x->>'standard_si') from jsonb_array_elements(slots)x where (x->>'standard_si')::integer between 1 and 18)<>n then
    problems:=array_append(problems,'Cardinalità, ordine o sequenza SI della configurazione incompleti.');end if;
  -- A real SI edit in an overlapping source-grid draft blocks; untouched drafts do not.
  select exists(select 1 from public.admin_catalog_drafts d where d.workflow_status='draft' and d.live_entity_id=parent_id
    and d.entity_type=case when p_kind='route_tee' then 'route_holes_grid' else 'combination_holes_grid' end
    and exists(select 1 from jsonb_array_elements(d.snapshot->'holes') x
      left join jsonb_array_elements(coalesce(d.base_snapshot#>'{_context,holes}',d.base_snapshot->'holes','[]')) b on b->>'id'=x->>'id'
      where x->'stroke_index' is distinct from b->'stroke_index')) into overlap;
  if overlap then problems:=array_append(problems,'Una bozza buche contiene modifiche SI sovrapposte.');end if;
  if exists(select 1 from public.admin_catalog_tee_overrides o where o.stroke_index_override is not null
    and ((p_kind='route_tee' and o.route_tee_id=p_tee) or(p_kind='combination_tee' and o.combination_tee_id=p_tee))) then
    problems:=array_append(problems,'Override SI presente nella fondazione: richiede revisione esplicita prima di usare questo contratto.');end if;
  select version_id into latest from public.admin_catalog_versions where entity_type=p_kind||'_si' and live_entity_id=p_tee order by version_number desc limit 1;
  return jsonb_build_object('tee',jsonb_build_object('id',p_tee,'name',t->'tee_name','kind',p_kind,'holes_count',n),
    'parent_id',parent_id,'configuration',jsonb_build_object('id',cfg.id,'label',cfg.label,'relationship_kind',cfg.relationship_kind,'rule',cfg.derivation_rule),
    'holes',slots,'allowed_si',coalesce(allowed,'[]'),'legacy_present',coalesce(legacy,false),'current',state.contract,
    'blockers',(select coalesce(jsonb_agg(distinct x),'[]') from unnest(problems)x),
    'base',jsonb_build_object('tee_fingerprint',md5(t::text),'parent_id',parent_id,'configuration_id',cfg.id,'configuration_revision',cfg.revision,
      'structure_revision',structure.revision,'parent_configuration_revision',parent.revision,
      'holes',slots,'allowed_si',coalesce(allowed,'[]'),'current_revision',coalesce(state.revision,0),'latest_version_id',latest));
end $$;

create function public.admin_tee_si_snapshot(p_snapshot jsonb,p_base jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare h jsonb; rows jsonb:='[]'; total integer:=jsonb_array_length(p_base->'holes');
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or not(p_snapshot?&array['mode','holes'])
    or(p_snapshot-array['mode','holes'])<>'{}' or jsonb_typeof(p_snapshot->'mode') is distinct from 'string'
    or p_snapshot->>'mode' not in('legacy','managed')
    or jsonb_typeof(p_snapshot->'holes')<>'array' or jsonb_array_length(p_snapshot->'holes')<>total then
    raise exception 'Typed SI grid required' using errcode='22023';end if;
  for h in select x from jsonb_array_elements(p_snapshot->'holes')x loop
    if jsonb_typeof(h)<>'object' or not(h?&array['slot_id','si']) or(h-array['slot_id','si'])<>'{}'
      or jsonb_typeof(h->'slot_id')<>'string' or jsonb_typeof(h->'si') not in('number','null')
      or not exists(select 1 from jsonb_array_elements(p_base->'holes')s where s->>'slot_id'=h->>'slot_id') then
      raise exception 'Only exact SI slot identities and values allowed' using errcode='22023';end if;
    if h->>'si' is not null and ((h->>'si')!~'^[0-9]{1,2}$' or(h->>'si')::integer not between 1 and 18 or p_snapshot->>'mode'='legacy') then
      raise exception 'SI must be 1..18 or inherited' using errcode='23514';end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('slot_id',(h->>'slot_id')::uuid,'si',(h->>'si')::integer));
  end loop;
  if(select count(distinct x->>'slot_id') from jsonb_array_elements(rows)x)<>total then raise exception 'Duplicate SI slots' using errcode='23514';end if;
  select jsonb_agg(entry order by(s->>'position')::integer) into rows from jsonb_array_elements(rows)entry
    join jsonb_array_elements(p_base->'holes')s on s->>'slot_id'=entry->>'slot_id';
  return jsonb_build_object('mode',p_snapshot->'mode','holes',coalesce(rows,'[]'));
end $$;

create function public.admin_tee_si_draft_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; ctx jsonb;
begin
  if new.entity_type not in('route_tee_si','combination_tee_si') and(tg_op='INSERT' or old.entity_type not in('route_tee_si','combination_tee_si')) then return new;end if;
  actor:=public.admin_catalog_require_admin();
  if new.entity_type not in('route_tee_si','combination_tee_si') or new.created_by<>actor or new.updated_by<>actor
    or new.live_entity_id is null or new.entity_key<>new.live_entity_id or new.parent_draft_id is not null or new.schema_version<>1 then
    raise exception 'Owned SI draft required' using errcode='42501';end if;
  if tg_op='INSERT' then
    ctx:=public.admin_tee_si_context(replace(new.entity_type,'_si',''),new.live_entity_id);
    if new.base_snapshot is distinct from ctx->'base' or jsonb_array_length(ctx->'blockers')>0 or new.revision<>1 or new.workflow_status<>'draft' then
      raise exception 'Exact verified SI base required' using errcode='40001';end if;
  else
    if old.created_by<>actor or old.workflow_status<>'draft' or new.revision<>old.revision+1
      or row(new.draft_id,new.entity_type,new.entity_key,new.live_entity_id,new.parent_draft_id,new.base_version_id,new.base_snapshot,new.created_by,new.created_at)
      is distinct from row(old.draft_id,old.entity_type,old.entity_key,old.live_entity_id,old.parent_draft_id,old.base_version_id,old.base_snapshot,old.created_by,old.created_at) then
      raise exception 'SI draft identity/base/revision immutable' using errcode='40001';end if;
    if new.workflow_status<>'draft' and new.snapshot is distinct from old.snapshot then raise exception 'Closing preserves draft' using errcode='22023';end if;
    if new.workflow_status='published' and not exists(select 1 from public.admin_catalog_versions v where v.source_draft_id=old.draft_id
      and v.entity_type=old.entity_type and v.published_by=actor) then raise exception 'Atomic SI version required' using errcode='42501';end if;
  end if;
  new.snapshot:=public.admin_tee_si_snapshot(new.snapshot,new.base_snapshot);return new;
end $$;
create trigger admin_tee_si_draft_guard before insert or update on public.admin_catalog_drafts
  for each row execute function public.admin_tee_si_draft_guard();

create function public.catalog_tee_si_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin();
begin
  if not exists(select 1 from public.admin_catalog_versions v join public.admin_catalog_drafts d on d.draft_id=v.source_draft_id
    where v.version_id=new.version_id and v.entity_type=new.tee_kind||'_si' and v.live_entity_id=new.tee_id and v.published_by=actor
      and d.workflow_status='draft' and d.created_by=actor and v.snapshot->'contract'=new.contract)
    or new.contract->>'configuration_id' is distinct from new.configuration_id::text
    or(tg_op='INSERT' and new.revision<>1) or(tg_op='UPDATE' and(new.revision<>old.revision+1 or row(new.tee_kind,new.tee_id) is distinct from row(old.tee_kind,old.tee_id))) then
    raise exception 'Only atomic SI publisher can update projection' using errcode='42501';end if;
  return new;
end $$;
create trigger catalog_tee_si_guard before insert or update on public.catalog_tee_si
  for each row execute function public.catalog_tee_si_guard();

-- Dedicated fixed SI operations, not a generic JSON-to-catalog publisher.
create function public.admin_tee_si(p_kind text,p_tee_id uuid,p_action text,p_draft_id uuid default null,
  p_revision bigint default null,p_snapshot jsonb default null,p_confirmation text default null,
  p_note text default null,p_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); ctx jsonb; d public.admin_catalog_drafts; snap jsonb; base_fields jsonb;
  history jsonb; blockers jsonb; changes jsonb; signature text; effective jsonb; contract jsonb; version uuid; number bigint; old_version public.admin_catalog_versions;
begin
  if p_action is null or p_action not in('detail','open','save','preview','publish','archive','restore') then raise exception 'Unknown SI action' using errcode='22023';end if;
  if p_action not in('detail','preview') then
    if not pg_try_advisory_xact_lock(hashtextextended('tee_si:'||coalesce(p_kind,'')||coalesce(p_tee_id::text,''),0)) then
      raise exception 'Tee SI busy' using errcode='55P03';end if;
  end if;
  if p_action='publish' then
    -- Shared source locks also cover insert/delete phantoms and legacy writers.
    lock table public.route_tees,public.combination_tees,public.course_routes,public.route_combinations,
      public.route_holes,public.route_combination_holes,public.admin_catalog_playable_configurations,
      public.admin_catalog_configuration_holes,public.admin_catalog_physical_holes,public.admin_catalog_tee_overrides,
      public.admin_catalog_physical_structures,public.admin_catalog_physical_course_links in share mode nowait;
    lock table public.admin_catalog_drafts in share row exclusive mode nowait;
  end if;
  ctx:=public.admin_tee_si_context(p_kind,p_tee_id);
  select coalesce(jsonb_agg(jsonb_build_object('version_id',v.version_id,'version_number',v.version_number,'published_at',v.published_at,
    'note',v.snapshot->'note','diff',v.diff) order by v.version_number desc),'[]') into history
    from public.admin_catalog_versions v where v.entity_type=p_kind||'_si' and v.live_entity_id=p_tee_id;
  if ctx->'current' is not null and ctx->'current'<>'null' then
    select jsonb_build_object('mode','managed','holes',jsonb_agg(jsonb_build_object('slot_id',x->'slot_id','si',x->'si') order by(x->>'position')::integer))
      into base_fields from jsonb_array_elements(ctx#>'{current,holes}')x;
  else select jsonb_build_object('mode','legacy','holes',coalesce(jsonb_agg(jsonb_build_object('slot_id',x->'slot_id','si',null) order by(x->>'position')::integer),'[]'))
    into base_fields from jsonb_array_elements(ctx->'holes')x;end if;
  if p_action in('detail','open','restore') then
    select * into d from public.admin_catalog_drafts where entity_type=p_kind||'_si' and live_entity_id=p_tee_id and created_by=actor and workflow_status='draft';
    if p_action='detail' then return jsonb_build_object('context',ctx,'draft',case when d.draft_id is not null then to_jsonb(d) end,'history',history);end if;
    if jsonb_array_length(ctx->'blockers')>0 then raise exception 'Verified unambiguous SI links required' using errcode='23514';end if;
    if p_action='restore' then
      if d.draft_id is not null then raise exception 'Abandon or publish existing draft before restoring' using errcode='40001';end if;
      select * into old_version from public.admin_catalog_versions where version_id=p_version_id and entity_type=p_kind||'_si' and live_entity_id=p_tee_id;
      if old_version.version_id is null then raise exception 'Exact tee SI version required' using errcode='22023';end if;
      snap:=public.admin_tee_si_snapshot(old_version.snapshot->'fields',ctx->'base');
    else snap:=base_fields;end if;
    if d.draft_id is null then
      insert into public.admin_catalog_drafts(entity_type,entity_key,live_entity_id,base_version_id,snapshot,base_snapshot,created_by,updated_by)
        values(p_kind||'_si',p_tee_id,p_tee_id,coalesce(old_version.version_id,(ctx#>>'{base,latest_version_id}')::uuid),snap,ctx->'base',actor,actor) returning * into d;
    end if;
    return jsonb_build_object('context',ctx,'draft',to_jsonb(d),'history',history);
  end if;
  if p_action='preview' then
    select * into d from public.admin_catalog_drafts where draft_id=p_draft_id and entity_type=p_kind||'_si' and live_entity_id=p_tee_id and created_by=actor and workflow_status='draft';
  else
    select * into d from public.admin_catalog_drafts where draft_id=p_draft_id and entity_type=p_kind||'_si' and live_entity_id=p_tee_id and created_by=actor and workflow_status='draft' for update nowait;
  end if;
  if d.draft_id is null then raise exception 'Owned open SI draft required' using errcode='42501';end if;
  if p_revision is distinct from d.revision then raise exception 'SI draft revision changed' using errcode='40001';end if;
  if p_action='archive' then
    update public.admin_catalog_drafts set workflow_status='archived',revision=revision+1,updated_by=actor,updated_at=clock_timestamp()
      where draft_id=d.draft_id returning * into d;return jsonb_build_object('draft',to_jsonb(d));
  end if;
  if p_action='save' then
    snap:=public.admin_tee_si_snapshot(p_snapshot,d.base_snapshot);
    update public.admin_catalog_drafts set snapshot=snap,revision=revision+1,updated_by=actor,updated_at=clock_timestamp()
      where draft_id=d.draft_id returning * into d;return jsonb_build_object('draft',to_jsonb(d));
  end if;
  snap:=public.admin_tee_si_snapshot(d.snapshot,d.base_snapshot);blockers:=ctx->'blockers';
  if d.base_snapshot is distinct from ctx->'base' then blockers:=blockers||'"La base, la configurazione o la pubblicazione SI sono cambiate."'::jsonb;end if;
  select jsonb_agg(coalesce((x->>'si')::integer,(s->>'standard_si')::integer) order by coalesce((x->>'si')::integer,(s->>'standard_si')::integer)) into effective
    from jsonb_array_elements(snap->'holes')x join jsonb_array_elements(d.base_snapshot->'holes')s on s->>'slot_id'=x->>'slot_id';
  if effective is distinct from d.base_snapshot->'allowed_si' then blockers:=blockers||'"Gli SI effettivi devono essere univoci e conservare la scala della configurazione."'::jsonb;end if;
  if snap->>'mode'<>'managed' or snap=base_fields then blockers:=blockers||'"Nessuna modifica SI esplicita da pubblicare."'::jsonb;end if;
  select coalesce(jsonb_agg(jsonb_build_object('position',s->'position','occurrence',s->'occurrence','before',b->'si','after',x->'si',
    'standard_si',s->'standard_si') order by(s->>'position')::integer),'[]') into changes
    from jsonb_array_elements(snap->'holes')x join jsonb_array_elements(d.base_snapshot->'holes')s on s->>'slot_id'=x->>'slot_id'
    left join jsonb_array_elements(base_fields->'holes')b on b->>'slot_id'=x->>'slot_id'
    where x->'si' is distinct from b->'si' or base_fields->>'mode'<>'managed';
  signature:=md5(jsonb_build_array(d.draft_id,d.revision,ctx->'base',snap,blockers)::text);
  if p_action='preview' then return jsonb_build_object('context',ctx,'changes',changes,'can_publish',jsonb_array_length(blockers)=0,
    'blockers',blockers,'confirmation_hash',signature,'revision',d.revision);end if;
  if jsonb_array_length(blockers)>0 then raise exception 'SI base/validation/publication blocked' using errcode='40001';end if;
  if p_confirmation is distinct from signature or nullif(btrim(p_note),'') is null or char_length(p_note)>1000 then
    raise exception 'Exact preview confirmation and note required' using errcode='22023';end if;
  select coalesce(max(version_number),0)+1 into number from public.admin_catalog_versions where entity_type=p_kind||'_si' and live_entity_id=p_tee_id;
  version:=gen_random_uuid();
  select jsonb_build_object('schema_version',1,'tee_kind',p_kind,'tee_id',p_tee_id,'parent_id',ctx->'parent_id','holes_count',ctx#>'{tee,holes_count}',
    'configuration_id',ctx#>'{configuration,id}','mode','managed','holes',jsonb_agg(
      jsonb_build_object('slot_id',s->'slot_id','position',s->'position','occurrence',s->'occurrence','physical_hole_id',s->'physical_hole_id',
        'live_hole_id',s->'live_hole_id','standard_si',s->'standard_si','si',x->'si') order by(s->>'position')::integer))
    into contract from jsonb_array_elements(ctx->'holes')s join jsonb_array_elements(snap->'holes')x on s->>'slot_id'=x->>'slot_id';
  insert into public.admin_catalog_versions(version_id,entity_type,entity_key,live_entity_id,source_draft_id,version_number,snapshot,diff,published_by)
    values(version,p_kind||'_si',p_tee_id,p_tee_id,d.draft_id,number,jsonb_build_object('fields',snap,'contract',contract,'note',btrim(p_note)),
      jsonb_build_object('holes',changes,'previous_mode',base_fields->'mode'),actor);
  insert into public.catalog_tee_si(tee_kind,tee_id,configuration_id,contract,revision,version_id)
    values(p_kind,p_tee_id,(ctx#>>'{configuration,id}')::uuid,contract,1,version)
    on conflict(tee_kind,tee_id) do update set contract=excluded.contract,configuration_id=excluded.configuration_id,
      revision=public.catalog_tee_si.revision+1,version_id=excluded.version_id;
  update public.admin_catalog_drafts set workflow_status='published',revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where draft_id=d.draft_id;
  return jsonb_build_object('version_id',version,'contract',contract);
end $$;

revoke all on function public.admin_tee_si_context(text,uuid),public.admin_tee_si_snapshot(jsonb,jsonb),
  public.admin_tee_si_draft_guard(),public.catalog_tee_si_guard() from public,anon,authenticated,service_role;
revoke all on function public.admin_tee_si(text,uuid,text,uuid,bigint,jsonb,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_tee_si(text,uuid,text,uuid,bigint,jsonb,text,text,uuid) to authenticated;
commit;
