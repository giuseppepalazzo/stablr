-- Task 4: apply ONCE after admin-tee-si-overrides.sql and its prerequisites.
-- No backfill, legacy matrix attribution, rating/grid/round writes or propagation.
begin;
do $$ declare tab text; definition text; begin
  foreach tab in array array['admin_catalog_drafts','admin_catalog_versions'] loop
    select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid=('public.'||tab)::regclass
      and conname=tab||'_entity_type_check';
    if definition is null then raise exception 'Installed workflow constraint required';end if;
    execute format('alter table public.%I drop constraint %I',tab,tab||'_entity_type_check');
    execute format('alter table public.%I add constraint %I check ((%s) or entity_type in (''route_tee_distances'',''combination_tee_distances''))',
      tab,tab||'_entity_type_check',substring(definition from 8 for char_length(definition)-8));
  end loop;
end $$;

create table public.catalog_tee_distances (
  tee_kind text not null check(tee_kind in('route_tee','combination_tee')),
  tee_id uuid not null,
  configuration_id uuid not null references public.admin_catalog_playable_configurations(id) on delete restrict,
  contract jsonb not null check(jsonb_typeof(contract)='object'),
  revision bigint not null check(revision>0),
  version_id uuid not null references public.admin_catalog_versions(version_id) on delete restrict,
  primary key(tee_kind,tee_id)
);
alter table public.catalog_tee_distances enable row level security;
revoke all on public.catalog_tee_distances from public,anon,authenticated,service_role;
grant select on public.catalog_tee_distances to authenticated;
create policy catalog_tee_distances_read on public.catalog_tee_distances for select to authenticated using (
  auth.uid() is not null and auth.role()='authenticated' and (public.is_admin() or
    (tee_kind='route_tee' and exists(select 1 from public.route_tees t join public.course_routes r on r.id=t.route_id
      join public.clubs c on c.id=r.club_id where t.id=tee_id and t.is_active and r.is_active and c.is_active and c.playable)) or
    (tee_kind='combination_tee' and exists(select 1 from public.combination_tees t join public.route_combinations r on r.id=t.route_combination_id
      join public.clubs c on c.id=r.club_id where t.id=tee_id and t.is_active and r.is_active and c.is_active and c.playable))));
create trigger catalog_tee_distances_no_delete before delete on public.catalog_tee_distances
  for each row execute function public.admin_catalog_reject_removal();
create trigger catalog_tee_distances_no_truncate before truncate on public.catalog_tee_distances
  for each statement execute function public.admin_catalog_reject_removal();
create unique index admin_tee_distances_personal_draft on public.admin_catalog_drafts(entity_type,live_entity_id,created_by)
  where entity_type in('route_tee_distances','combination_tee_distances') and workflow_status='draft';

-- Reuse the exact IDs/occurrences already exposed by the SI contract, not its
-- SI-specific validation or projection. SI changes must NOT affect distances.
create function public.admin_tee_distance_context(p_kind text,p_tee uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare original jsonb:=public.admin_tee_si_context(p_kind,p_tee); cfg public.admin_catalog_playable_configurations;
  s public.admin_catalog_physical_structures; parent public.admin_catalog_playable_configurations;
  slots jsonb; row_value jsonb; state public.catalog_tee_distances; problems text[]:='{}';
  n integer:=(original#>>'{tee,holes_count}')::integer; expected integer; count_live integer;
  parent_id uuid:=(original->>'parent_id')::uuid; latest uuid; found_live boolean; parent_fingerprint text;
begin
  select * into cfg from public.admin_catalog_playable_configurations where id=(original#>>'{configuration,id}')::uuid;
  select * into s from public.admin_catalog_physical_structures where id=cfg.structure_id;
  if cfg.id is null or cfg.review_status is distinct from 'verified' or s.review_status is distinct from 'verified'
    or s.classification='non_classificato' then problems:=array_append(problems,'Collegamento esatto a una configurazione e struttura verificate non disponibile.');end if;
  if cfg.parent_configuration_id is not null then
    select * into parent from public.admin_catalog_playable_configurations where id=cfg.parent_configuration_id;
    if parent.review_status is distinct from 'verified' or parent.revision is distinct from cfg.parent_configuration_revision then
      problems:=array_append(problems,'Revisione del padre verificato cambiata.');end if;
  end if;
  if p_kind='route_tee' then
    select r.holes_count,md5(to_jsonb(r)::text) into expected,parent_fingerprint from public.course_routes r where r.id=parent_id;
    select count(*) into count_live from public.route_holes where route_id=parent_id;
  else
    select r.holes_count,md5(to_jsonb(r)::text) into expected,parent_fingerprint from public.route_combinations r where r.id=parent_id;
    select count(*) into count_live from public.route_combination_holes where route_combination_id=parent_id;
  end if;
  if count_live<>expected or expected<>(case cfg.registration_kind when 'repeated_18' then 9 else n end) then
    problems:=array_append(problems,'Cardinalità live non coerente con la configurazione verificata.');end if;
  slots:='[]';
  for row_value in select x-array['standard_si'] from jsonb_array_elements(original->'holes')x loop
    if p_kind='route_tee' then
      select exists(select 1 from public.route_holes h where h.id=(row_value->>'live_hole_id')::uuid and h.route_id=parent_id
        and (h.id=(row_value->>'source_hole_id')::uuid or(cfg.registration_kind in('front_9','back_9') and parent.id is not null))) into found_live;
    else
      select exists(select 1 from public.route_combination_holes h join public.route_holes source
        on source.route_id=h.route_id and source.physical_hole_number=h.physical_hole_number
        where h.id=(row_value->>'live_hole_id')::uuid and h.route_combination_id=parent_id
          and h.round_hole_number=(row_value->>'position')::integer and source.id=(row_value->>'source_hole_id')::uuid) into found_live;
    end if;
    if not found_live or row_value->>'review_status' is distinct from 'verified'
      or row_value->'physical_verified' is distinct from 'true'::jsonb or row_value->'source_verified' is distinct from 'true'::jsonb then
      problems:=array_append(problems,'Buca, occorrenza o collegamento fisico non più verificabili.');end if;
    slots:=slots||jsonb_build_array(row_value);
  end loop;
  if n not in(9,18) or jsonb_array_length(slots)<>n
    or(select count(distinct x->>'position') from jsonb_array_elements(slots)x where(x->>'position')::integer between 1 and n)<>n
    or(select count(distinct(x->>'live_hole_id',x->>'occurrence')) from jsonb_array_elements(slots)x where(x->>'occurrence')::integer>0)<>n then
    problems:=array_append(problems,'Griglia o identità delle occorrenze incomplete/duplicate.');end if;
  select * into state from public.catalog_tee_distances where tee_kind=p_kind and tee_id=p_tee;
  select version_id into latest from public.admin_catalog_versions where entity_type=p_kind||'_distances' and live_entity_id=p_tee order by version_number desc limit 1;
  return jsonb_build_object('tee',original->'tee','parent_id',parent_id,'configuration',original->'configuration','holes',slots,
    'legacy_present',original->'legacy_present','current',state.contract,'blockers',(select coalesce(jsonb_agg(distinct x),'[]') from unnest(problems)x),
    'base',jsonb_build_object('tee_fingerprint',original#>'{base,tee_fingerprint}','parent_fingerprint',parent_fingerprint,'configuration_revision',cfg.revision,
      'configuration_id',cfg.id,'parent_id',parent_id,'structure_revision',s.revision,'parent_revision',parent.revision,
      'holes',slots,'current_revision',coalesce(state.revision,0),'latest_version_id',latest));
end $$;

create function public.admin_tee_distance_snapshot(p_snapshot jsonb,p_base jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare entry jsonb; rows jsonb:='[]'; n integer:=jsonb_array_length(p_base->'holes');
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object' or not(p_snapshot?&array['mode','holes'])
    or(p_snapshot-array['mode','holes'])<>'{}' or jsonb_typeof(p_snapshot->'mode') is distinct from 'string'
    or p_snapshot->>'mode' not in('legacy','managed') or jsonb_typeof(p_snapshot->'holes') is distinct from 'array'
    or jsonb_array_length(p_snapshot->'holes')<>n then raise exception 'Typed distance grid required' using errcode='22023';end if;
  for entry in select x from jsonb_array_elements(p_snapshot->'holes')x loop
    if jsonb_typeof(entry) is distinct from 'object' or not(entry?&array['slot_id','distance_m'])
      or(entry-array['slot_id','distance_m'])<>'{}' or jsonb_typeof(entry->'slot_id') is distinct from 'string'
      or jsonb_typeof(entry->'distance_m') not in('number','null')
      or not exists(select 1 from jsonb_array_elements(p_base->'holes')h where h->>'slot_id'=entry->>'slot_id') then
      raise exception 'Only exact slots and distance_m permitted' using errcode='22023';end if;
    if entry->>'distance_m' is not null and ((entry->>'distance_m')!~'^(0|[1-9][0-9]{0,9})$'
      or(entry->>'distance_m')::numeric>2147483647 or p_snapshot->>'mode'='legacy') then
      raise exception 'Metres must be null or nonnegative int32' using errcode='23514';end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('slot_id',(entry->>'slot_id')::uuid,'distance_m',(entry->>'distance_m')::integer));
  end loop;
  if(select count(distinct x->>'slot_id') from jsonb_array_elements(rows)x)<>n then raise exception 'Duplicate distance slots' using errcode='23514';end if;
  select jsonb_agg(x order by(h->>'position')::integer) into rows from jsonb_array_elements(rows)x
    join jsonb_array_elements(p_base->'holes')h on h->>'slot_id'=x->>'slot_id';
  return jsonb_build_object('mode',p_snapshot->'mode','holes',coalesce(rows,'[]'));
end $$;

-- Server-derived totals only. Partial sums are clearly separate from totals.
create function public.admin_tee_distance_totals(p_fields jsonb)
returns jsonb language sql immutable set search_path=pg_catalog as $$
  select jsonb_build_object('holes_count',count(*),'known_count',count(x->>'distance_m'),
    'known_sum_m',coalesce(sum((x->>'distance_m')::bigint),0),
    'total_m',case when count(x->>'distance_m')=count(*) then sum((x->>'distance_m')::bigint) end,
    'front_m',case when count(x->>'distance_m') filter(where ord<=9)=9 then sum((x->>'distance_m')::bigint) filter(where ord<=9) end,
    'back_m',case when count(x->>'distance_m') filter(where ord>9)=9 then sum((x->>'distance_m')::bigint) filter(where ord>9) end)
  from jsonb_array_elements(p_fields->'holes') with ordinality as rows(x,ord);
$$;

create function public.admin_tee_distance_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; ctx jsonb;
begin
  if tg_table_name='admin_catalog_drafts' then
    if new.entity_type not in('route_tee_distances','combination_tee_distances')
      and(tg_op='INSERT' or old.entity_type not in('route_tee_distances','combination_tee_distances')) then return new;end if;
  end if;
  actor:=public.admin_catalog_require_admin();
  if tg_table_name='catalog_tee_distances' then
    if not exists(select 1 from public.admin_catalog_versions v join public.admin_catalog_drafts d on d.draft_id=v.source_draft_id
      where v.version_id=new.version_id and v.entity_type=new.tee_kind||'_distances' and v.live_entity_id=new.tee_id
        and v.published_by=actor and d.created_by=actor and d.workflow_status='draft' and v.snapshot->'contract'=new.contract)
      or new.contract->>'configuration_id' is distinct from new.configuration_id::text
      or(tg_op='INSERT' and new.revision<>1) or(tg_op='UPDATE' and(new.revision<>old.revision+1
        or row(new.tee_kind,new.tee_id) is distinct from row(old.tee_kind,old.tee_id))) then
      raise exception 'Atomic distance publisher required' using errcode='42501';end if;
  else
    if new.entity_type not in('route_tee_distances','combination_tee_distances')
      and(tg_op='INSERT' or old.entity_type not in('route_tee_distances','combination_tee_distances')) then return new;end if;
    if new.entity_type not in('route_tee_distances','combination_tee_distances') or new.created_by<>actor or new.updated_by<>actor
      or new.entity_key is distinct from new.live_entity_id or new.live_entity_id is null or new.parent_draft_id is not null or new.schema_version<>1 then
      raise exception 'Owned distance draft required' using errcode='42501';end if;
    if tg_op='INSERT' then
      ctx:=public.admin_tee_distance_context(replace(new.entity_type,'_distances',''),new.live_entity_id);
      if new.base_snapshot is distinct from ctx->'base' or jsonb_array_length(ctx->'blockers')>0 or new.revision<>1 or new.workflow_status<>'draft' then
        raise exception 'Exact distance base required' using errcode='40001';end if;
    else
      if old.created_by<>actor or old.workflow_status<>'draft' or new.revision<>old.revision+1 or
        row(new.draft_id,new.entity_type,new.entity_key,new.live_entity_id,new.parent_draft_id,new.base_version_id,new.base_snapshot,new.created_by,new.created_at)
        is distinct from row(old.draft_id,old.entity_type,old.entity_key,old.live_entity_id,old.parent_draft_id,old.base_version_id,old.base_snapshot,old.created_by,old.created_at) then
        raise exception 'Distance draft identity/base/revision immutable' using errcode='40001';end if;
      if new.workflow_status<>'draft' and new.snapshot is distinct from old.snapshot then raise exception 'Closing preserves snapshot' using errcode='22023';end if;
      if new.workflow_status='published' and not exists(select 1 from public.admin_catalog_versions v where v.source_draft_id=old.draft_id
        and v.entity_type=old.entity_type and v.published_by=actor) then raise exception 'Immutable distance version required' using errcode='42501';end if;
    end if;
    new.snapshot:=public.admin_tee_distance_snapshot(new.snapshot,new.base_snapshot);
  end if;
  return new;
end $$;
create trigger catalog_tee_distances_guard before insert or update on public.catalog_tee_distances
  for each row execute function public.admin_tee_distance_guard();
create trigger admin_tee_distances_draft_guard before insert or update on public.admin_catalog_drafts
  for each row execute function public.admin_tee_distance_guard();

create function public.admin_tee_distances(p_kind text,p_tee_id uuid,p_action text,p_draft_id uuid default null,
  p_revision bigint default null,p_snapshot jsonb default null,p_confirmation text default null,p_note text default null,p_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); ctx jsonb; d public.admin_catalog_drafts; old_version public.admin_catalog_versions;
  fields jsonb; base_fields jsonb; history jsonb; blockers jsonb; changes jsonb; signature text; contract jsonb; totals jsonb; warnings jsonb;
  version uuid; number bigint;
begin
  if p_action is null or p_action not in('detail','open','save','preview','publish','archive','restore') then raise exception 'Unknown distance action' using errcode='22023';end if;
  if p_action not in('detail','preview') and not pg_try_advisory_xact_lock(hashtextextended('tee_distance:'||coalesce(p_kind,'')||coalesce(p_tee_id::text,''),0)) then
    raise exception 'Tee distance busy' using errcode='55P03';end if;
  if p_action='publish' then
    lock table public.clubs,public.route_tees,public.combination_tees,public.course_routes,public.route_combinations,public.route_holes,public.route_combination_holes,
      public.admin_catalog_physical_structures,public.admin_catalog_physical_course_links,public.admin_catalog_physical_holes,
      public.admin_catalog_playable_configurations,public.admin_catalog_configuration_holes in share mode nowait;
    lock table public.admin_catalog_drafts in share row exclusive mode nowait;
  end if;
  ctx:=public.admin_tee_distance_context(p_kind,p_tee_id);
  select coalesce(jsonb_agg(jsonb_build_object('version_id',v.version_id,'version_number',v.version_number,'published_at',v.published_at,
    'note',v.snapshot->'note','diff',v.diff) order by v.version_number desc),'[]') into history from public.admin_catalog_versions v
    where v.entity_type=p_kind||'_distances' and v.live_entity_id=p_tee_id;
  select jsonb_build_object('mode',case when ctx->'current' is distinct from 'null'::jsonb then 'managed' else 'legacy' end,
    'holes',coalesce(jsonb_agg(jsonb_build_object('slot_id',x->'slot_id','distance_m',x->'distance_m') order by(x->>'position')::integer),'[]')) into base_fields
    from jsonb_array_elements(case when ctx->'current' is distinct from 'null'::jsonb then ctx#>'{current,holes}' else ctx->'holes' end)x;
  if p_action in('detail','open','restore') then
    select * into d from public.admin_catalog_drafts where entity_type=p_kind||'_distances' and live_entity_id=p_tee_id and created_by=actor and workflow_status='draft';
    if p_action='detail' then return jsonb_build_object('context',ctx,'draft',case when d.draft_id is not null then to_jsonb(d) end,'history',history);end if;
    if jsonb_array_length(ctx->'blockers')>0 then raise exception 'Verified distance links required' using errcode='23514';end if;
    fields:=base_fields;
    if p_action='restore' then
      if d.draft_id is not null then raise exception 'Resolve existing draft explicitly before restore' using errcode='40001';end if;
      select * into old_version from public.admin_catalog_versions where version_id=p_version_id and entity_type=p_kind||'_distances' and live_entity_id=p_tee_id;
      if old_version.version_id is null then raise exception 'Exact distance version required' using errcode='22023';end if;
      fields:=public.admin_tee_distance_snapshot(old_version.snapshot->'fields',ctx->'base');
    end if;
    if d.draft_id is null then
      insert into public.admin_catalog_drafts(entity_type,entity_key,live_entity_id,base_version_id,snapshot,base_snapshot,created_by,updated_by)
        values(p_kind||'_distances',p_tee_id,p_tee_id,coalesce(old_version.version_id,(ctx#>>'{base,latest_version_id}')::uuid),fields,ctx->'base',actor,actor) returning * into d;
    end if;
    return jsonb_build_object('context',ctx,'draft',to_jsonb(d),'history',history);
  end if;
  if p_action='preview' then select * into d from public.admin_catalog_drafts where draft_id=p_draft_id and entity_type=p_kind||'_distances' and live_entity_id=p_tee_id and created_by=actor and workflow_status='draft';
  else select * into d from public.admin_catalog_drafts where draft_id=p_draft_id and entity_type=p_kind||'_distances' and live_entity_id=p_tee_id and created_by=actor and workflow_status='draft' for update nowait;end if;
  if d.draft_id is null then raise exception 'Owned open distance draft required' using errcode='42501';end if;
  if p_revision is distinct from d.revision then raise exception 'Distance revision changed' using errcode='40001';end if;
  if p_action='archive' then
    update public.admin_catalog_drafts set workflow_status='archived',revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where draft_id=d.draft_id returning * into d;
    return jsonb_build_object('draft',to_jsonb(d));
  end if;
  if p_action='save' then
    fields:=public.admin_tee_distance_snapshot(p_snapshot,d.base_snapshot);
    update public.admin_catalog_drafts set snapshot=fields,revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where draft_id=d.draft_id returning * into d;
    return jsonb_build_object('draft',to_jsonb(d));
  end if;
  fields:=public.admin_tee_distance_snapshot(d.snapshot,d.base_snapshot);blockers:=ctx->'blockers';
  if d.base_snapshot is distinct from ctx->'base' then blockers:=blockers||'"Base, identità o revisione distanze cambiate."'::jsonb;end if;
  if fields->>'mode'<>'managed' or fields=base_fields then blockers:=blockers||'"Nessuna modifica distanze esplicita da pubblicare."'::jsonb;end if;
  totals:=public.admin_tee_distance_totals(fields);warnings:='[]';
  if(totals->>'known_count')::integer<(totals->>'holes_count')::integer then warnings:=warnings||'"Distanze mancanti: totale completo non disponibile. Le celle vuote non diventano zero."'::jsonb;end if;
  if exists(select 1 from jsonb_array_elements(fields->'holes')x where x->>'distance_m'='0') then warnings:=warnings||'"Sono presenti distanze esplicitamente pari a zero: verificare la scelta."'::jsonb;end if;
  if(ctx->>'legacy_present')::boolean and ctx->'current'='null'::jsonb then warnings:=warnings||'"La griglia pubblicata sostituirà le distanze legacy non attribuite, solo per questo tee e ambito."'::jsonb;end if;
  select coalesce(jsonb_agg(jsonb_build_object('position',s->'position','occurrence',s->'occurrence','before',b->'distance_m','after',x->'distance_m')
    order by(s->>'position')::integer),'[]') into changes from jsonb_array_elements(fields->'holes')x
    join jsonb_array_elements(ctx->'holes')s on s->>'slot_id'=x->>'slot_id'
    left join jsonb_array_elements(base_fields->'holes')b on b->>'slot_id'=x->>'slot_id'
    where x->'distance_m' is distinct from b->'distance_m' or base_fields->>'mode'='legacy';
  signature:=md5(jsonb_build_array(d.draft_id,d.revision,ctx->'base',fields,blockers)::text);
  if p_action='preview' then return jsonb_build_object('context',ctx,'changes',changes,'blockers',blockers,'warnings',warnings,
    'totals_before',case when ctx->'current' is distinct from 'null'::jsonb then ctx#>'{current,totals}' end,'totals_after',totals,
    'can_publish',jsonb_array_length(blockers)=0,'confirmation_hash',signature,'revision',d.revision);end if;
  if jsonb_array_length(blockers)>0 then raise exception 'Distance source/publication blocked' using errcode='40001';end if;
  if p_confirmation is distinct from signature or nullif(btrim(p_note),'') is null or char_length(p_note)>1000 then raise exception 'Exact preview and note required' using errcode='22023';end if;
  select jsonb_build_object('schema_version',1,'mode','managed','tee_kind',p_kind,'tee_id',p_tee_id,'parent_id',ctx->'parent_id',
    'configuration_id',ctx#>'{configuration,id}','holes_count',ctx#>'{tee,holes_count}','totals',totals,'holes',jsonb_agg(jsonb_build_object(
      'slot_id',s->'slot_id','live_hole_id',s->'live_hole_id','physical_hole_id',s->'physical_hole_id','position',s->'position',
      'occurrence',s->'occurrence','distance_m',x->'distance_m') order by(s->>'position')::integer)) into contract
    from jsonb_array_elements(ctx->'holes')s join jsonb_array_elements(fields->'holes')x on s->>'slot_id'=x->>'slot_id';
  select coalesce(max(version_number),0)+1 into number from public.admin_catalog_versions where entity_type=p_kind||'_distances' and live_entity_id=p_tee_id;
  version:=gen_random_uuid();
  insert into public.admin_catalog_versions(version_id,entity_type,entity_key,live_entity_id,source_draft_id,version_number,snapshot,diff,published_by)
    values(version,p_kind||'_distances',p_tee_id,p_tee_id,d.draft_id,number,jsonb_build_object('fields',fields,'contract',contract,'note',btrim(p_note)),
      jsonb_build_object('holes',changes,'totals_before',ctx#>'{current,totals}','totals_after',totals),actor);
  insert into public.catalog_tee_distances(tee_kind,tee_id,configuration_id,contract,revision,version_id)
    values(p_kind,p_tee_id,(ctx#>>'{configuration,id}')::uuid,contract,1,version)
    on conflict(tee_kind,tee_id) do update set contract=excluded.contract,configuration_id=excluded.configuration_id,
      revision=public.catalog_tee_distances.revision+1,version_id=excluded.version_id;
  update public.admin_catalog_drafts set workflow_status='published',revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where draft_id=d.draft_id;
  return jsonb_build_object('version_id',version,'contract',contract);
end $$;
revoke all on function public.admin_tee_distance_context(text,uuid),public.admin_tee_distance_snapshot(jsonb,jsonb),
  public.admin_tee_distance_totals(jsonb),public.admin_tee_distance_guard() from public,anon,authenticated,service_role;
revoke all on function public.admin_tee_distances(text,uuid,text,uuid,bigint,jsonb,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_tee_distances(text,uuid,text,uuid,bigint,jsonb,text,text,uuid) to authenticated;
commit;
