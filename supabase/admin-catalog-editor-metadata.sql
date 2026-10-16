-- Apply ONCE after course/Route editors, workflow, abandon and physical foundation.
-- Separate published metadata avoids changing existing to_jsonb(live) baselines.
begin;
create table public.catalog_editor_metadata (
  entity_type text not null check(entity_type in ('route','route_combination')),
  live_entity_id uuid not null,
  aliases text[] not null default '{}',
  notes text check(notes is null or char_length(notes)<=5000),
  display_order integer,
  revision bigint not null check(revision>0),
  version_id uuid not null references public.admin_catalog_versions(version_id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(entity_type,live_entity_id),
  check(cardinality(aliases)<=20),
  check(entity_type<>'route' or display_order is null)
);
alter table public.catalog_editor_metadata enable row level security;
revoke all on public.catalog_editor_metadata from public,anon,authenticated,service_role;
-- Only public editorial values, never authors, private drafts or audit, reach the player.
grant select(entity_type,live_entity_id,aliases,notes,display_order) on public.catalog_editor_metadata to authenticated;
create policy catalog_editor_metadata_read on public.catalog_editor_metadata for select to authenticated using (
  auth.uid() is not null and auth.role()='authenticated' and (public.is_admin() or
  (entity_type='route' and exists(select 1 from public.course_routes r join public.clubs c on c.id=r.club_id
    where r.id=live_entity_id and r.is_active and c.is_active and c.playable)) or
  (entity_type='route_combination' and exists(select 1 from public.route_combinations r join public.clubs c on c.id=r.club_id
    where r.id=live_entity_id and r.is_active and c.is_active and c.playable))));
create function public.admin_catalog_metadata_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform public.admin_catalog_require_admin();
  if tg_op='UPDATE' and (row(new.entity_type,new.live_entity_id,new.created_by,new.created_at) is distinct from
    row(old.entity_type,old.live_entity_id,old.created_by,old.created_at) or new.revision<>old.revision+1) then
    raise exception 'Identità metadati immutabile o revisione non valida' using errcode='40001';end if;
  if not exists(select 1 from public.admin_catalog_versions v where v.version_id=new.version_id
    and v.entity_type=new.entity_type and v.live_entity_id=new.live_entity_id and v.published_by=auth.uid()) then
    raise exception 'Versione atomica del target richiesta' using errcode='42501';end if;
  return new;
end $$;
create trigger catalog_editor_metadata_guard before insert or update on public.catalog_editor_metadata
  for each row execute function public.admin_catalog_metadata_guard();
create trigger catalog_editor_metadata_no_delete before delete on public.catalog_editor_metadata
  for each row execute function public.admin_catalog_reject_removal();
create trigger catalog_editor_metadata_no_truncate before truncate on public.catalog_editor_metadata
  for each statement execute function public.admin_catalog_reject_removal();

-- Keep the original domain validators private and extend only curated fields.
alter function public.admin_course_validate_snapshot(jsonb) rename to admin_course_validate_snapshot_before_metadata;
alter function public.admin_route_validate_snapshot(jsonb) rename to admin_route_validate_snapshot_before_metadata;
create function public.admin_catalog_metadata_fields(p_kind text,p jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; alias_value jsonb; aliases jsonb:='[]'; note_value text; ordering numeric;
begin
  if p_kind='route' then result:=public.admin_course_validate_snapshot_before_metadata(p-array['aliases','notes']);
  elsif p_kind='route_combination' then result:=public.admin_route_validate_snapshot_before_metadata(p-array['aliases','notes','display_order']);
  else raise exception 'Tipo editor non consentito' using errcode='22023';end if;
  if p ? 'aliases' then
    if jsonb_typeof(p->'aliases') is distinct from 'array' or jsonb_array_length(p->'aliases')>20 then
      raise exception 'Massimo 20 alias testuali' using errcode='22023';end if;
    for alias_value in select value from jsonb_array_elements(p->'aliases') loop
      if jsonb_typeof(alias_value)<>'string' or char_length(btrim(alias_value#>>'{}')) not between 1 and 200
        or alias_value#>>'{}' ~ '[\r\n]' then raise exception 'Alias non valido' using errcode='22023';end if;
      aliases:=aliases||jsonb_build_array(btrim(alias_value#>>'{}'));
    end loop;
    if (select count(distinct lower(x#>>'{}')) from jsonb_array_elements(aliases)x)<>jsonb_array_length(aliases) then
      raise exception 'Alias duplicati' using errcode='22023';end if;
  end if;
  if p ? 'notes' and jsonb_typeof(p->'notes') not in ('string','null') then raise exception 'Note testuali richieste' using errcode='22023';end if;
  note_value:=nullif(btrim(p->>'notes'),'');
  if char_length(note_value)>5000 then raise exception 'Note troppo lunghe' using errcode='22023';end if;
  result:=result||jsonb_build_object('aliases',aliases,'notes',note_value);
  if p_kind='route_combination' then
    if p ? 'display_order' and jsonb_typeof(p->'display_order') not in ('number','null') then raise exception 'Ordine intero richiesto' using errcode='22023';end if;
    ordering:=(p->>'display_order')::numeric;
    if ordering<>trunc(ordering) or ordering not between -2147483648 and 2147483647 then raise exception 'Ordine non valido' using errcode='22023';end if;
    result:=result||jsonb_build_object('display_order',ordering::integer);
  end if;
  return result;
end $$;
create function public.admin_course_validate_snapshot(p_snapshot jsonb)
returns jsonb language sql security definer set search_path=pg_catalog as $$select public.admin_catalog_metadata_fields('route',p_snapshot)$$;
create function public.admin_route_validate_snapshot(p_snapshot jsonb)
returns jsonb language sql security definer set search_path=pg_catalog as $$select public.admin_catalog_metadata_fields('route_combination',p_snapshot)$$;

-- A legacy archive is explicit and preserves the exact original saved snapshot.
create function public.admin_catalog_metadata_archive_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if old.entity_type in ('route','route_combination') and old.base_snapshot is not null
    and new.workflow_status='archived' and old.workflow_status='draft' then
    if public.admin_catalog_metadata_fields(old.entity_type,new.snapshot) is distinct from
      public.admin_catalog_metadata_fields(old.entity_type,old.snapshot) then
      raise exception 'Abbandonare conserva i dati salvati' using errcode='22023';end if;
    new.snapshot:=old.snapshot;
  end if;
  return new;
end $$;
create trigger z_admin_metadata_archive_guard before update on public.admin_catalog_drafts
  for each row execute function public.admin_catalog_metadata_archive_guard();

create function public.admin_catalog_metadata_state(p_kind text,p_target uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); live jsonb; fields jsonb; ctx jsonb; legacy jsonb;
  meta public.catalog_editor_metadata; foundation jsonb; links jsonb; dependencies jsonb; latest public.admin_catalog_versions; club_id uuid;
begin
  if p_kind='route' then
    select to_jsonb(r) into live from public.course_routes r join public.clubs c on c.id=r.club_id and c.is_active where r.id=p_target;
    ctx:=jsonb_build_object('can_edit_structure',false,'source_system',live->'source_system',
      'original_name',live#>>'{source_payload,fig_display_name}','gesgolf_name',live#>>'{source_payload,gesgolf,route_name}');
    fields:=jsonb_build_object('name',live->'name','holes_count',live->'holes_count','display_order',live->'display_order','is_active',live->'is_active');
    legacy:=jsonb_build_object('club_id',live->'club_id','total_par',live->'total_par','source_system',live->'source_system',
      'source_external_id',live->'source_external_id','source_payload',live->'source_payload');
  elsif p_kind='route_combination' then
    select to_jsonb(r) into live from public.route_combinations r join public.clubs c on c.id=r.club_id and c.is_active where r.id=p_target;
    ctx:=public.admin_route_context(p_target);legacy:=ctx->'base';ctx:=ctx-'base';
    ctx:=ctx||jsonb_build_object('original_name',live#>>'{source_payload,fig_display_name}');
    fields:=jsonb_build_object('name',live->'name','is_active',live->'is_active');
  else raise exception 'Tipo editor non consentito' using errcode='22023';end if;
  if live is null then raise exception 'Record pubblicato in Club attivo richiesto' using errcode='22023';end if;
  club_id:=(live->>'club_id')::uuid;
  select * into meta from public.catalog_editor_metadata where entity_type=p_kind and live_entity_id=p_target;
  fields:=fields||jsonb_build_object('aliases',coalesce(to_jsonb(meta.aliases),'[]'),'notes',meta.notes);
  if p_kind='route_combination' then fields:=fields||jsonb_build_object('display_order',meta.display_order);end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'label',c.label,'revision',c.revision,'review_status',c.review_status) order by c.id),'[]') into foundation
    from public.admin_catalog_playable_configurations c where
      (p_kind='route' and (c.legacy_course_route_id=p_target or c.legacy_combination_id in
        (select id from public.route_combinations where front_route_id=p_target or back_route_id=p_target)))
      or (p_kind='route_combination' and c.legacy_combination_id=p_target);
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'revision',l.revision,'review_status',l.review_status) order by l.id),'[]') into links
    from public.admin_catalog_physical_course_links l where p_kind='route' and l.course_id=p_target;
  if p_kind='route' then
    select jsonb_build_object('holes',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]') from public.route_holes h where h.route_id=p_target),
      'tees',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.route_tees t where t.route_id=p_target),
      'combinations',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.route_combinations c where c.front_route_id=p_target or c.back_route_id=p_target)) into dependencies;
  else
    select jsonb_build_object('base',legacy,'tees',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.combination_tees t where t.route_combination_id=p_target)) into dependencies;
  end if;
  select * into latest from public.admin_catalog_versions where entity_type=p_kind and live_entity_id=p_target order by version_number desc limit 1;
  return jsonb_build_object('fields',fields,'context',ctx,'club_id',club_id,'legacy_context',legacy,'updated_at',live->'updated_at',
    'entity_key',coalesce(latest.entity_key,p_target),'base_version_id',latest.version_id,'foundation',foundation,
    'metadata_revision',coalesce(meta.revision,0),'source_links',links,
    'fingerprint',encode(sha256(convert_to(jsonb_build_object('live',live,'metadata',fields,'metadata_revision',coalesce(meta.revision,0),
      'dependencies',dependencies,'foundation',foundation,'links',links)::text,'UTF8')),'hex'));
end $$;

create function public.admin_catalog_metadata_plan(p_kind text,p_target uuid,p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); d public.admin_catalog_drafts; state jsonb; requested jsonb; base_fields jsonb;
  changes jsonb:='{}'; blocks jsonb:='[]'; warnings jsonb:='[]'; key text; live_changed boolean:=false; plan jsonb; other_drafts integer;
begin
  select * into d from public.admin_catalog_drafts where draft_id=p_draft_id;
  if d.created_by is distinct from actor or d.entity_type is distinct from p_kind or d.live_entity_id is distinct from p_target
    or d.parent_draft_id is not null or d.schema_version<>1 or d.base_snapshot is null or d.workflow_status<>'draft' then
    raise exception 'Bozza personale del record esistente richiesta' using errcode='42501';end if;
  state:=public.admin_catalog_metadata_state(p_kind,p_target);
  requested:=public.admin_catalog_metadata_fields(p_kind,d.snapshot);
  base_fields:=public.admin_catalog_metadata_fields(p_kind,d.base_snapshot-'_context');
  if state->'updated_at' is distinct from to_jsonb(d.base_live_updated_at)
    or state->'base_version_id' is distinct from coalesce(to_jsonb(d.base_version_id),'null')
    or state->'fields' is distinct from base_fields then raise exception 'Base live o versione cambiata' using errcode='40001';end if;
  if d.base_snapshot#>>'{_context,metadata_contract}'='1' then
    if d.base_snapshot#>'{_context,fingerprint}' is distinct from state->'fingerprint' then raise exception 'Dipendenze cambiate' using errcode='40001';end if;
  elsif d.base_snapshot->'_context' is distinct from state->'legacy_context' then
    raise exception 'Base precedente non più allineata' using errcode='40001';
  end if;
  if p_kind='route' and requested->'holes_count' is distinct from state#>'{fields,holes_count}' then
    blocks:=blocks||jsonb_build_array('Struttura Percorso in sola lettura: questo editor pubblica solo metadati.');end if;
  if p_kind='route_combination' and ((state#>>'{context,checks,coherent}')::boolean is distinct from true
    or ((requested->>'is_active')::boolean and (state#>>'{context,checks,origins_active}')::boolean is distinct from true)) then
    blocks:=blocks||jsonb_build_array('Struttura o origini della combinazione non coerenti.');end if;
  for key in select jsonb_object_keys(requested) loop
    if requested->key is distinct from state->'fields'->key then
      changes:=changes||jsonb_build_object(key,jsonb_build_object('before',state->'fields'->key,'after',requested->key));
      if key in ('name','is_active','holes_count') or (key='display_order' and p_kind='route') then live_changed:=true;end if;
    end if;
  end loop;
  if changes='{}' then blocks:=blocks||jsonb_build_array('Nessuna modifica da pubblicare.');end if;
  if live_changed and (jsonb_array_length(state->'foundation')>0 or jsonb_array_length(state->'source_links')>0) then
    warnings:=warnings||jsonb_build_array('Questa modifica live può invalidare baseline fisiche verificate e bloccare pubblicazioni Par successive. Nessuna baseline sarà aggiornata automaticamente.');end if;
  select count(*) into other_drafts from public.admin_catalog_drafts where draft_id<>d.draft_id and live_entity_id=p_target and workflow_status='draft';
  if other_drafts>0 then warnings:=warnings||jsonb_build_array('Sono presenti altre bozze sul record: le loro basi dovranno essere ricontrollate dopo la pubblicazione.');end if;
  plan:=jsonb_build_object('draft_id',d.draft_id,'revision',d.revision,'kind',p_kind,'target_id',p_target,'changes',changes,
    'fields',requested,'can_publish',jsonb_array_length(blocks)=0,'blockers',blocks,'warnings',warnings,
    'impact',jsonb_build_object('foundation',state->'foundation','source_links_count',jsonb_array_length(state->'source_links'),
      'other_drafts',other_drafts,'live_record_changes',live_changed,'metadata_only',not live_changed),
    'fingerprint',state->'fingerprint','restored_from_version_id',d.base_snapshot#>'{_context,restored_from_version_id}');
  return plan||jsonb_build_object('confirmation_hash',encode(sha256(convert_to(plan::text,'UTF8')),'hex'));
end $$;

create function public.admin_catalog_metadata(p_kind text,p_target uuid,p_action text,p_draft_id uuid default null,
  p_expected_revision bigint default null,p_snapshot jsonb default null,p_confirmation_hash text default null,p_note text default null,p_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); state jsonb; d public.admin_catalog_drafts; v public.admin_catalog_versions;
  fields jsonb; base jsonb; plan jsonb; key text; version_id uuid; next_number bigint; result jsonb; history jsonb; live_result jsonb;
begin
  if p_kind is null or p_kind not in ('route','route_combination') or p_target is null or p_action is null
    or p_action not in ('detail','open','save','preview','publish','restore','history') then raise exception 'Azione editor non valida' using errcode='22023';end if;
  if p_action in ('open','save','publish','restore') then
    -- Consistent live-table order, protect dependency phantoms; fail rather than wait.
    lock table public.course_routes,public.route_combinations in share row exclusive mode nowait;
    lock table public.route_holes,public.route_combination_holes,public.route_tees,public.combination_tees,
      public.admin_catalog_playable_configurations,public.admin_catalog_physical_course_links in share mode nowait;
    if p_kind='route' then perform 1 from public.course_routes where id=p_target for update nowait;
    else perform 1 from public.route_combinations where id=p_target for update nowait;end if;
    perform 1 from public.catalog_editor_metadata where entity_type=p_kind and live_entity_id=p_target for update nowait;
  end if;
  state:=public.admin_catalog_metadata_state(p_kind,p_target);
  if p_action in ('detail','history') then
    select coalesce(jsonb_agg(jsonb_build_object('version_id',x.version_id,'version_number',x.version_number,'published_at',x.published_at,
      'fields',x.snapshot-array(select k from jsonb_object_keys(x.snapshot)k where k not in ('name','holes_count','is_active','display_order','aliases','notes')),
      'changes',x.diff-array(select k from jsonb_object_keys(x.diff)k where k not in ('name','holes_count','is_active','display_order','aliases','notes')),
      'note',x.diff#>>'{_publication,note}') order by x.version_number desc),'[]') into history
      from public.admin_catalog_versions x where entity_type=p_kind and live_entity_id=p_target;
    return jsonb_build_object('kind',p_kind,'target_id',p_target,'fields',state->'fields','context',state->'context','history',history,
      'has_open_draft',exists(select 1 from public.admin_catalog_drafts where entity_type=p_kind and live_entity_id=p_target and created_by=actor and workflow_status='draft' and base_snapshot is not null));
  end if;
  if p_action in ('open','restore') then
    select * into d from public.admin_catalog_drafts where entity_type=p_kind and live_entity_id=p_target and created_by=actor
      and workflow_status='draft' and base_snapshot is not null for update nowait;
    if d.draft_id is not null then
      if p_action='restore' then raise exception 'Abbandonare esplicitamente la bozza corrente prima del ripristino' using errcode='40001';end if;
    else
      fields:=state->'fields';base:=fields||jsonb_build_object('_context',jsonb_build_object('metadata_contract',1,'fingerprint',state->'fingerprint'));
      if p_action='restore' then
        select history.* into v from public.admin_catalog_versions history where history.version_id=p_version_id and history.entity_type=p_kind and history.live_entity_id=p_target;
        if v.version_id is null or v.entity_key is distinct from (state->>'entity_key')::uuid then raise exception 'Versione dello stesso record richiesta' using errcode='22023';end if;
        -- Historical fields absent from an old version are unknown, not an instruction
        -- to erase newer metadata. Structural fields are NEVER restored here.
        for key in select jsonb_object_keys(fields) loop
          if key<>'holes_count' and v.snapshot ? key then fields:=fields||jsonb_build_object(key,v.snapshot->key);end if;
        end loop;
        fields:=public.admin_catalog_metadata_fields(p_kind,fields);
        base:=base||jsonb_build_object('_context',base->'_context'||jsonb_build_object('restored_from_version_id',v.version_id));
      end if;
      insert into public.admin_catalog_drafts(entity_type,entity_key,live_entity_id,base_version_id,snapshot,base_snapshot,base_live_updated_at,created_by,updated_by)
        values(p_kind,(state->>'entity_key')::uuid,p_target,(state->>'base_version_id')::uuid,fields,base,(state->>'updated_at')::timestamptz,actor,actor) returning * into d;
    end if;
    return jsonb_build_object('draft',to_jsonb(d),'context',state->'context');
  end if;
  if p_action='preview' then select * into d from public.admin_catalog_drafts where draft_id=p_draft_id;
  else select * into d from public.admin_catalog_drafts where draft_id=p_draft_id for update nowait;end if;
  if d.created_by is distinct from actor or d.entity_type is distinct from p_kind or d.live_entity_id is distinct from p_target or d.base_snapshot is null
    or d.parent_draft_id is not null then raise exception 'Bozza personale del record richiesta' using errcode='42501';end if;
  if d.workflow_status<>'draft' or p_expected_revision is null or d.revision<>p_expected_revision then raise exception 'Bozza cambiata o chiusa' using errcode='40001';end if;
  if p_action='save' then
    fields:=public.admin_catalog_metadata_fields(p_kind,p_snapshot);
    d:=public.admin_catalog_save_draft(d.draft_id,fields,p_expected_revision,1);
    return to_jsonb(d);
  end if;
  plan:=public.admin_catalog_metadata_plan(p_kind,p_target,p_draft_id);
  if p_action='preview' then return plan;end if;
  if p_note is null or char_length(btrim(p_note)) not between 1 and 500 or p_confirmation_hash is null then
    raise exception 'Anteprima e motivazione obbligatorie' using errcode='22023';end if;
  if plan->>'confirmation_hash' is distinct from p_confirmation_hash then raise exception 'Anteprima cambiata' using errcode='40001';end if;
  if (plan->>'can_publish')::boolean is distinct from true then raise exception 'Pubblicazione bloccata: %',plan->'blockers' using errcode='23514';end if;
  fields:=plan->'fields';
  if (plan#>>'{impact,live_record_changes}')::boolean then
    if p_kind='route' then
      update public.course_routes set name=fields->>'name',
        display_order=(fields->>'display_order')::integer,is_active=(fields->>'is_active')::boolean,updated_at=clock_timestamp() where id=p_target;
    else
      update public.route_combinations set name=fields->>'name',is_active=(fields->>'is_active')::boolean,updated_at=clock_timestamp() where id=p_target;
    end if;
  end if;
  select coalesce(max(version_number),0)+1 into next_number from public.admin_catalog_versions where entity_type=p_kind and entity_key=d.entity_key;
  insert into public.admin_catalog_versions(entity_type,entity_key,live_entity_id,source_draft_id,version_number,schema_version,snapshot,diff,published_by,published_at)
    values(p_kind,d.entity_key,p_target,d.draft_id,next_number,1,fields,plan->'changes'||jsonb_build_object('_publication',
      jsonb_build_object('note',btrim(p_note),'restored_from_version_id',plan->'restored_from_version_id')),actor,clock_timestamp()) returning admin_catalog_versions.version_id into version_id;
  if fields->'aliases' is distinct from state#>'{fields,aliases}' or fields->'notes' is distinct from state#>'{fields,notes}'
    or (p_kind='route_combination' and fields->'display_order' is distinct from state#>'{fields,display_order}') then
    insert into public.catalog_editor_metadata(entity_type,live_entity_id,aliases,notes,display_order,revision,version_id,created_by,updated_by)
      values(p_kind,p_target,array(select jsonb_array_elements_text(fields->'aliases')),fields->>'notes',
        case when p_kind='route_combination' then (fields->>'display_order')::integer else null end,1,version_id,actor,actor)
      on conflict(entity_type,live_entity_id) do update set aliases=excluded.aliases,notes=excluded.notes,display_order=excluded.display_order,
        revision=catalog_editor_metadata.revision+1,version_id=excluded.version_id,updated_by=actor,updated_at=clock_timestamp();
  end if;
  update public.admin_catalog_drafts set workflow_status='published',revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where draft_id=d.draft_id;
  if p_kind='route' then select jsonb_build_object('id',r.id,'club_id',r.club_id,'name',r.name,'holes_count',r.holes_count,'display_order',r.display_order,'is_active',r.is_active,'updated_at',r.updated_at) into live_result from public.course_routes r where id=p_target;
  else select jsonb_build_object('id',r.id,'club_id',r.club_id,'name',r.name,'is_active',r.is_active,'updated_at',r.updated_at) into live_result from public.route_combinations r where id=p_target;
    live_result:=live_result||jsonb_build_object('display_order',fields->'display_order');end if;
  live_result:=live_result||jsonb_build_object('aliases',fields->'aliases','notes',fields->'notes');
  result:=jsonb_build_object('draft_id',d.draft_id,'version_id',version_id,'version_number',next_number,'diff',plan->'changes');
  return result||jsonb_build_object(case when p_kind='route' then 'course' else 'route' end,live_result);
end $$;

-- Old two-argument publishers must not bypass the server preview/hash/note.
revoke all on function public.admin_course_publish_draft(uuid,bigint),public.admin_route_publish_draft(uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function public.admin_course_validate_snapshot_before_metadata(jsonb),public.admin_route_validate_snapshot_before_metadata(jsonb),
  public.admin_course_validate_snapshot(jsonb),public.admin_route_validate_snapshot(jsonb),public.admin_catalog_metadata_fields(text,jsonb),
  public.admin_catalog_metadata_state(text,uuid),public.admin_catalog_metadata_plan(text,uuid,uuid),public.admin_catalog_metadata_guard(),
  public.admin_catalog_metadata_archive_guard(),public.admin_catalog_metadata(text,uuid,text,uuid,bigint,jsonb,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_catalog_metadata(text,uuid,text,uuid,bigint,jsonb,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
