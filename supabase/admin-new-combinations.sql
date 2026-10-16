-- Apply ONCE after admin-existing-club-new-courses.sql and the verified multi9 foundation.
-- No backfill, live writes or consumer changes during installation.
begin;
do $$begin
  if to_regprocedure('public.admin_combination_tee_list(uuid)') is null
    or to_regprocedure('public.admin_new_course_tee_snapshot(jsonb)') is null
    or to_regprocedure('public.admin_catalog_multi9_complete(uuid)') is null
    or to_regprocedure('public.admin_route_get_draft(uuid)') is null then
    raise exception 'Installare CRUD tee combinazioni, tee privati e fondazione multi9 prima di questo script' using errcode='55000';
  end if;
end $$;

create table public.admin_new_combination_publications (
  publication_id uuid primary key default gen_random_uuid(),
  source_draft_id uuid not null unique references public.admin_catalog_drafts(draft_id) on delete restrict,
  combination_id uuid not null unique references public.route_combinations(id) on delete restrict,
  configuration_id uuid not null unique references public.admin_catalog_playable_configurations(id) on delete restrict,
  version_id uuid not null unique references public.admin_catalog_versions(version_id) on delete restrict,
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default clock_timestamp(),
  note text not null check(char_length(btrim(note)) between 1 and 500),
  confirmation_hash text not null check(confirmation_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object')
);
alter table public.admin_new_combination_publications enable row level security;
revoke all on public.admin_new_combination_publications from public,anon,authenticated,service_role;
grant select on public.admin_new_combination_publications to authenticated;
create policy admin_new_combination_publication_read on public.admin_new_combination_publications for select to authenticated
  using(auth.role()='authenticated' and auth.uid() is not null and public.is_admin());
create trigger admin_new_combination_publication_immutable before update or delete on public.admin_new_combination_publications
  for each row execute function public.admin_catalog_reject_removal();
create trigger admin_new_combination_publication_no_truncate before truncate on public.admin_new_combination_publications
  for each statement execute function public.admin_catalog_reject_removal();

-- Uses the existing exact multi9 component contract; no source inference, new physical
-- identities, 9-hole combinations or repeated-nine combinations.
create function public.admin_new_combination_section(p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.admin_catalog_playable_configurations; s public.admin_catalog_physical_structures;
  l public.admin_catalog_physical_course_links; r public.course_routes; holes jsonb; baseline jsonb;
begin
  perform public.admin_catalog_require_admin();
  select * into c from public.admin_catalog_playable_configurations where id=p_id;
  select * into s from public.admin_catalog_physical_structures where id=c.structure_id;
  select * into l from public.admin_catalog_physical_course_links where id=c.physical_source_link_id;
  select * into r from public.course_routes where id=c.legacy_course_route_id;
  if c.id is null or c.registration_kind is distinct from 'multi9_9' or c.holes_count<>9 or c.review_status<>'verified'
    or s.review_status is distinct from 'verified' or s.classification is distinct from 'multi_9'
    or l.review_status is distinct from 'verified' or l.course_id is distinct from r.id or l.holes_count<>9
    or l.structure_id is distinct from s.id or l.club_id is distinct from c.club_id
    or r.club_id is distinct from c.club_id or not r.is_active or r.holes_count<>9 then
    raise exception 'Sezione fisica 9 multi-9 verificata e Percorso attivo richiesti' using errcode='23514';end if;
  perform public.admin_catalog_multi9_complete(c.id);
  select jsonb_agg(jsonb_build_object('position',h.position,'physical_hole_id',p.id,'source_hole_id',rh.id,
    'physical_hole_number',rh.physical_hole_number,'par',p.base_par,'source_si',rh.stroke_index,
    'physical_revision',p.revision,'slot_revision',h.revision) order by h.position) into holes
    from public.admin_catalog_configuration_holes h
    join public.admin_catalog_physical_holes p on p.id=h.physical_hole_id and p.review_status='verified'
    join public.route_holes rh on rh.id=h.legacy_route_hole_id and rh.id=p.source_route_hole_id and rh.route_id=r.id
    where h.configuration_id=c.id and h.review_status='verified' and h.par_mode='inherited' and h.par_override is null
      and h.occurrence=1 and p.source_course_link_id=l.id and h.position=rh.physical_hole_number and p.base_par=rh.par;
  if coalesce(jsonb_array_length(holes),0)<>9 or exists(select 1 from jsonb_array_elements(holes)x where (x->>'par')::integer not between 3 and 5)
    then raise exception 'Nove collegamenti esatti con Par 3..5 richiesti' using errcode='23514';end if;
  baseline:=jsonb_build_object('configuration',to_jsonb(c),'structure',to_jsonb(s),'link',to_jsonb(l),
    'source',public.admin_catalog_physical_course_source(r.id),'holes',holes);
  return jsonb_build_object('id',c.id,'label',r.name,'course_id',r.id,'club_id',c.club_id,'structure_id',s.id,
    'revision',c.revision,'link_id',l.id,'link_revision',l.revision,'holes',holes,
    'source_hash',encode(sha256(convert_to(baseline::text,'UTF8')),'hex'));
end $$;

create function public.admin_new_combination_fields(p jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare x jsonb; h jsonb; tees jsonb:='[]'; holes jsonb:='[]'; i integer:=0;
begin
  if p is null or jsonb_typeof(p) is distinct from 'object'
    or not(p ?& array['club_id','name','front_configuration_id','back_configuration_id','source_hash','holes','tees'])
    or (p-array['club_id','name','front_configuration_id','back_configuration_id','source_hash','holes','tees'])<>'{}'
    or jsonb_typeof(p->'name') is distinct from 'string' or char_length(btrim(p->>'name')) not between 1 and 200
    or (p->>'club_id')::uuid is null or (p->>'front_configuration_id')::uuid is null or (p->>'back_configuration_id')::uuid is null
    or p->>'front_configuration_id'=p->>'back_configuration_id'
    or coalesce(p->>'source_hash','')!~'^[0-9a-f]{128}$'
    or jsonb_typeof(p->'holes') is distinct from 'array' or jsonb_array_length(p->'holes')<>18
    or jsonb_typeof(p->'tees') is distinct from 'array' or jsonb_array_length(p->'tees')>40 then
    raise exception 'Campi nuova combinazione non validi' using errcode='22023';end if;
  for h in select value from jsonb_array_elements(p->'holes') loop
    i:=i+1;
    if jsonb_typeof(h) is distinct from 'object' or not(h ?& array['position','si']) or (h-array['position','si'])<>'{}'
      or h->'position' is distinct from to_jsonb(i) or jsonb_typeof(h->'si') not in ('number','null')
      or (h->>'si' is not null and ((h->>'si')::numeric<>trunc((h->>'si')::numeric) or (h->>'si')::numeric not between 1 and 18)) then
      raise exception 'Posizioni 1..18 e SI interi 1..18 richiesti' using errcode='22023';end if;
    holes:=holes||jsonb_build_array(h);
  end loop;
  for x in select value from jsonb_array_elements(p->'tees') loop
    tees:=tees||jsonb_build_array(public.admin_new_course_tee_snapshot(x));
  end loop;
  if exists(select 1 from jsonb_array_elements(tees) entry group by lower(btrim(entry->>'name')) having count(*)>1) then
    raise exception 'Nomi tee distinti richiesti dal vincolo live, anche fra categorie' using errcode='23505';end if;
  return p||jsonb_build_object('name',btrim(p->>'name'),'holes',holes,'tees',tees);
end $$;

create function public.admin_new_combination_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid;
begin
  if (new.entity_type='route_combination' and new.live_entity_id is null)
    or (tg_op='UPDATE' and old.entity_type='route_combination' and old.live_entity_id is null) then
    actor:=public.admin_catalog_require_admin();
    if new.created_by is distinct from actor or new.updated_by is distinct from actor or new.live_entity_id is not null
      or new.entity_type<>'route_combination' or new.parent_draft_id is not null or new.base_snapshot is not null
      or new.base_version_id is not null or new.base_live_updated_at is not null or new.schema_version<>1 then
      raise exception 'Bozza privata combinazione richiesta' using errcode='42501';end if;
    new.snapshot:=public.admin_new_combination_fields(new.snapshot);
    if tg_op='UPDATE' then
      if row(new.draft_id,new.entity_type,new.entity_key,new.live_entity_id,new.parent_draft_id,new.base_snapshot,
        new.base_version_id,new.base_live_updated_at,new.created_by,new.created_at) is distinct from
        row(old.draft_id,old.entity_type,old.entity_key,old.live_entity_id,old.parent_draft_id,old.base_snapshot,
        old.base_version_id,old.base_live_updated_at,old.created_by,old.created_at)
        or old.workflow_status<>'draft' or new.revision<>old.revision+1
        or new.snapshot->'club_id' is distinct from old.snapshot->'club_id' then
        raise exception 'Identità o revisione bozza non valida' using errcode='40001';end if;
      if new.workflow_status in ('archived','published') and new.snapshot is distinct from old.snapshot then
        raise exception 'La chiusura conserva la bozza' using errcode='22023';end if;
      if new.snapshot->'front_configuration_id'=old.snapshot->'front_configuration_id'
        and new.snapshot->'back_configuration_id'=old.snapshot->'back_configuration_id'
        and new.snapshot->'source_hash' is distinct from old.snapshot->'source_hash' then
        raise exception 'Base sorgente immutabile: nessun rebase automatico' using errcode='40001';end if;
      if new.workflow_status='published' and not exists(select 1 from public.admin_new_combination_publications p
        join public.admin_catalog_versions v on v.version_id=p.version_id where p.source_draft_id=old.draft_id
          and v.source_draft_id=old.draft_id and v.entity_type='route_combination' and v.live_entity_id=p.combination_id) then
        raise exception 'Ricevuta atomica richiesta' using errcode='42501';end if;
    elsif new.workflow_status<>'draft' or new.revision<>1 then raise exception 'Nuova bozza richiesta' using errcode='22023';end if;
  end if;
  return new;
end $$;
create trigger admin_new_combination_guard before insert or update on public.admin_catalog_drafts
  for each row execute function public.admin_new_combination_guard();

create function public.admin_new_combinations(p_club_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); c public.clubs; r record; section jsonb;
  sections jsonb:='[]'; excluded jsonb:='[]'; drafts jsonb;
begin
  select * into c from public.clubs where id=p_club_id and is_active;
  if c.id is null then raise exception 'Club attivo richiesto' using errcode='22023';end if;
  for r in select id,label from public.admin_catalog_playable_configurations where club_id=c.id and holes_count=9 order by label,id loop
    begin
      section:=public.admin_new_combination_section(r.id);sections:=sections||jsonb_build_array(section);
    exception when sqlstate '23514' or sqlstate '40001' then
      excluded:=excluded||jsonb_build_array(jsonb_build_object('label',r.label,'reason','Sezione non verificata, non compatibile o base fisica cambiata.'));
    end;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.updated_at desc),'[]') into drafts from public.admin_catalog_drafts d
    where d.entity_type='route_combination' and d.live_entity_id is null and d.workflow_status='draft'
      and d.created_by=actor and d.snapshot->>'club_id'=c.id::text;
  return jsonb_build_object('club_id',c.id,'club_name',c.name,'sections',sections,'excluded',excluded,'drafts',drafts);
end $$;

create function public.admin_new_combination_save(p_snapshot jsonb,p_draft_id uuid default null,p_expected_revision bigint default null)
returns public.admin_catalog_drafts language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); fields jsonb; f jsonb; b jsonb; result public.admin_catalog_drafts; expected text;
begin
  fields:=public.admin_new_combination_fields(p_snapshot);
  f:=public.admin_new_combination_section((fields->>'front_configuration_id')::uuid);
  b:=public.admin_new_combination_section((fields->>'back_configuration_id')::uuid);
  -- Ordered, fixed-length server hashes; no client-side inference or cryptography.
  expected:=(f->>'source_hash')||(b->>'source_hash');
  if f->>'club_id' is distinct from fields->>'club_id' or b->>'club_id' is distinct from fields->>'club_id'
    or f->>'structure_id' is distinct from b->>'structure_id' or f->>'course_id'=b->>'course_id' then
    raise exception 'Due Percorsi distinti nella stessa struttura verificata richiesti' using errcode='23514';end if;
  if fields->>'source_hash' is distinct from expected then raise exception 'Sorgenti cambiate' using errcode='40001';end if;
  perform 1 from public.clubs where id=(fields->>'club_id')::uuid and is_active;
  if not found then raise exception 'Club attivo richiesto' using errcode='22023';end if;
  if p_draft_id is null then
    if p_expected_revision is not null then raise exception 'Nuova bozza senza revisione' using errcode='22023';end if;
    insert into public.admin_catalog_drafts(entity_type,entity_key,snapshot,created_by,updated_by)
      values('route_combination',gen_random_uuid(),fields,actor,actor) returning * into result;
  else
    select * into result from public.admin_catalog_drafts where draft_id=p_draft_id for update nowait;
    if result.created_by is distinct from actor or result.entity_type is distinct from 'route_combination' or result.live_entity_id is not null
      or result.snapshot->'club_id' is distinct from fields->'club_id' then raise exception 'Bozza personale richiesta' using errcode='42501';end if;
    if p_expected_revision is null or result.revision<>p_expected_revision or result.workflow_status<>'draft' then
      raise exception 'Bozza cambiata o chiusa' using errcode='40001';end if;
    update public.admin_catalog_drafts set snapshot=fields,revision=revision+1,updated_by=actor,updated_at=clock_timestamp()
      where draft_id=p_draft_id returning * into result;
  end if;
  return result;
end $$;

create function public.admin_new_combination_preview(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); d public.admin_catalog_drafts; c public.clubs;
  f jsonb; b jsonb; source jsonb; h jsonb; fields jsonb; holes jsonb:='[]'; blocks jsonb:='[]'; plan jsonb; i integer:=0;
begin
  select * into d from public.admin_catalog_drafts where draft_id=p_draft_id;
  if d.created_by is distinct from actor or d.entity_type is distinct from 'route_combination' or d.live_entity_id is not null
    or d.workflow_status<>'draft' then raise exception 'Bozza personale aperta richiesta' using errcode='42501';end if;
  fields:=public.admin_new_combination_fields(d.snapshot);
  f:=public.admin_new_combination_section((fields->>'front_configuration_id')::uuid);
  b:=public.admin_new_combination_section((fields->>'back_configuration_id')::uuid);
  if f->>'club_id' is distinct from fields->>'club_id' or b->>'club_id' is distinct from fields->>'club_id'
    or f->>'structure_id' is distinct from b->>'structure_id' or f->>'course_id'=b->>'course_id'
    or fields->>'source_hash' is distinct from (f->>'source_hash')||(b->>'source_hash') then
    raise exception 'Base fisica cambiata o origini incompatibili' using errcode='40001';end if;
  select * into c from public.clubs where id=(fields->>'club_id')::uuid;
  if c.is_active is distinct from true or c.playable is distinct from true then blocks:=blocks||'"Club attivo e giocabile richiesto."'::jsonb;end if;
  if exists(select 1 from public.route_combinations where club_id=c.id
    and public.admin_new_club_name_key(name)=public.admin_new_club_name_key(fields->>'name')) then
    blocks:=blocks||'"Una combinazione con questo nome esiste già nel Club."'::jsonb;end if;
  if exists(select 1 from public.route_combinations where club_id=c.id
    and front_route_id=(f->>'course_id')::uuid and back_route_id=(b->>'course_id')::uuid) then
    blocks:=blocks||'"Questa coppia ordinata di Percorsi è già presente: il vincolo live non consente duplicati."'::jsonb;end if;
  if (select count(distinct x->>'si') from jsonb_array_elements(fields->'holes')x where x->>'si' is not null)<>18 then
    blocks:=blocks||'"Completa SI univoci da 1 a 18; nessun SI è dedotto dalle origini."'::jsonb;end if;
  if not exists(select 1 from jsonb_array_elements(fields->'tees')x where (x->>'is_active')::boolean
    and x->>'course_rating' is not null and x->>'slope_rating' is not null) or exists(
    select 1 from jsonb_array_elements(fields->'tees')x where (x->>'is_active')::boolean
      and (x->>'course_rating' is null or x->>'slope_rating' is null)) then
    blocks:=blocks||'"Almeno un tee attivo e rating completi per tutti i tee attivi richiesti."'::jsonb;end if;
  for source in select value from jsonb_array_elements(f->'holes'||(b->'holes')) loop
    i:=i+1;h:=fields->'holes'->(i-1);
    holes:=holes||jsonb_build_array(source||jsonb_build_object('position',i,'occurrence',1,'si',h->'si',
      'course_id',case when i<=9 then f->'course_id' else b->'course_id' end,'component_position',case when i<=9 then 1 else 2 end));
  end loop;
  plan:=jsonb_build_object('draft_id',d.draft_id,'revision',d.revision,'club',jsonb_build_object('id',c.id,'name',c.name,'updated_at',c.updated_at),
    'name',fields->>'name','holes_count',18,'front',f,'back',b,'holes',holes,'tees',fields->'tees',
    'total_par',(select sum((x->>'par')::integer) from jsonb_array_elements(holes)x),'can_publish',jsonb_array_length(blocks)=0,'blockers',blocks,
    'impact',jsonb_build_object('new_combinations',1,'new_holes',18,'new_tees',jsonb_array_length(fields->'tees'),'existing_records_updated',0));
  return plan||jsonb_build_object('confirmation_hash',encode(sha256(convert_to(plan::text,'UTF8')),'hex'));
end $$;

create function public.admin_new_combination_publish(p_draft_id uuid,p_expected_revision bigint,p_confirmation_hash text,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); d public.admin_catalog_drafts; plan jsonb; h jsonb; t jsonb;
  live public.route_combinations; cfg public.admin_catalog_playable_configurations; v uuid; receipt uuid; hole_id uuid; component jsonb;
begin
  if p_note is null or char_length(btrim(p_note)) not between 1 and 500 then raise exception 'Motivazione obbligatoria' using errcode='22023';end if;
  select * into d from public.admin_catalog_drafts where draft_id=p_draft_id for update nowait;
  if d.created_by is distinct from actor or d.entity_type is distinct from 'route_combination' or d.live_entity_id is not null
    then raise exception 'Bozza personale richiesta' using errcode='42501';end if;
  if d.workflow_status<>'draft' or p_expected_revision is null or d.revision<>p_expected_revision then
    raise exception 'Bozza cambiata o chiusa' using errcode='40001';end if;
  perform public.admin_catalog_structure_club_lock((d.snapshot->>'club_id')::uuid);
  -- Protect exact sources AND insertion phantoms, including legacy import writers.
  lock table public.clubs,public.course_routes,public.route_holes,public.route_combinations,public.route_combination_holes,
    public.admin_catalog_physical_structures,public.admin_catalog_physical_course_links,public.admin_catalog_physical_holes,
    public.admin_catalog_playable_configurations,public.admin_catalog_configuration_holes,public.admin_catalog_configuration_components
    in share row exclusive mode nowait;
  plan:=public.admin_new_combination_preview(p_draft_id);
  if (plan->>'can_publish')::boolean is distinct from true then raise exception 'Combinazione incompleta: %',plan->'blockers' using errcode='23514';end if;
  if p_confirmation_hash is null or p_confirmation_hash is distinct from plan->>'confirmation_hash' then
    raise exception 'Anteprima cambiata: conferma nuovamente' using errcode='40001';end if;
  insert into public.route_combinations(club_id,name,front_route_id,back_route_id,holes_count,total_par,is_active,source_system,source_payload)
    values((d.snapshot->>'club_id')::uuid,plan->>'name',(plan#>>'{front,course_id}')::uuid,(plan#>>'{back,course_id}')::uuid,
      18,(plan->>'total_par')::integer,true,'stablr',jsonb_build_object('creation','admin_verified_sections','source_draft_id',d.draft_id)) returning * into live;
  for h in select value from jsonb_array_elements(plan->'holes') loop
    insert into public.route_combination_holes(route_combination_id,round_hole_number,route_id,route_position,physical_hole_number,par,stroke_index,source_stroke_index)
      values(live.id,(h->>'position')::integer,(h->>'course_id')::uuid,(h->>'component_position')::integer,
        (h->>'physical_hole_number')::integer,(h->>'par')::integer,(h->>'si')::integer,(h->>'source_si')::integer);
  end loop;
  for t in select value from jsonb_array_elements(plan->'tees') loop
    insert into public.combination_tees(route_combination_id,tee_name,tee_color,gender,holes_count,par_total,course_rating,slope_rating,is_active,display_order,source_system,source_payload)
      values(live.id,t->>'name',t->>'tee_color',case when t->>'rating_category'='unspecified' then null else t->>'rating_category' end,
        18,live.total_par,(t->>'course_rating')::numeric,(t->>'slope_rating')::integer,(t->>'is_active')::boolean,(t->>'display_order')::integer,'stablr',
        jsonb_build_object('source_draft_id',d.draft_id));
  end loop;
  insert into public.admin_catalog_playable_configurations(club_id,label,holes_count,structure_id,relationship_kind,derivation_rule,
    legacy_combination_id,source_system,source_reference,reason,registration_kind,registration_snapshot)
    values(live.club_id,left(live.name,150),18,(plan#>>'{front,structure_id}')::uuid,'derived','multi9_exact_components',live.id,
      'stablr','route_combinations:'||live.id,btrim(p_note),'multi9_18',jsonb_build_object('contract',1,'source',to_jsonb(live),
        'holes',(select jsonb_agg(to_jsonb(x) order by x.round_hole_number,x.id) from public.route_combination_holes x where route_combination_id=live.id))) returning * into cfg;
  for component in select value from jsonb_array_elements(jsonb_build_array(plan->'front',plan->'back')) loop
    insert into public.admin_catalog_configuration_components(configuration_id,structure_id,club_id,component_position,physical_course_link_id,
      physical_course_link_revision,parent_configuration_id,parent_configuration_revision,reason)
      values(cfg.id,cfg.structure_id,cfg.club_id,case when component->>'id'=plan#>>'{front,id}' then 1 else 2 end,
        (component->>'link_id')::uuid,(component->>'link_revision')::bigint,(component->>'id')::uuid,(component->>'revision')::bigint,btrim(p_note));
  end loop;
  for h in select value from jsonb_array_elements(plan->'holes') loop
    select id into hole_id from public.route_combination_holes where route_combination_id=live.id and round_hole_number=(h->>'position')::integer;
    insert into public.admin_catalog_configuration_holes(configuration_id,club_id,structure_id,physical_hole_id,position,occurrence,par_mode,
      stroke_index,review_status,legacy_combination_hole_id,source_system,source_reference,reason)
      values(cfg.id,cfg.club_id,cfg.structure_id,(h->>'physical_hole_id')::uuid,(h->>'position')::integer,1,'inherited',
        (h->>'si')::integer,'verified',hole_id,'stablr','route_combination_holes:'||hole_id,btrim(p_note));
  end loop;
  update public.admin_catalog_playable_configurations set review_status='verified',reason=btrim(p_note) where id=cfg.id;
  insert into public.admin_catalog_versions(entity_type,entity_key,live_entity_id,source_draft_id,version_number,schema_version,snapshot,diff,published_by,published_at)
    values('route_combination',d.entity_key,live.id,d.draft_id,1,1,jsonb_build_object('name',live.name,'is_active',true),
      jsonb_build_object('creation',plan->'impact','note',btrim(p_note)),actor,clock_timestamp()) returning version_id into v;
  insert into public.admin_new_combination_publications(source_draft_id,combination_id,configuration_id,version_id,published_by,note,confirmation_hash,snapshot)
    values(d.draft_id,live.id,cfg.id,v,actor,btrim(p_note),p_confirmation_hash,plan) returning publication_id into receipt;
  update public.admin_catalog_drafts set workflow_status='published',revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where draft_id=d.draft_id;
  return jsonb_build_object('draft_id',d.draft_id,'publication_id',receipt,'version_id',v,'configuration_id',cfg.id,
    'combination',to_jsonb(live)||jsonb_build_object('route_combination_holes',(select jsonb_agg(to_jsonb(x) order by round_hole_number) from public.route_combination_holes x where route_combination_id=live.id),
      'combination_tees',(select jsonb_agg(to_jsonb(x) order by tee_name) from public.combination_tees x where route_combination_id=live.id)));
end $$;

-- All helpers private. Existing workflow archival is reused; guard seals closure.
revoke all on function public.admin_new_combination_section(uuid),public.admin_new_combination_fields(jsonb),public.admin_new_combination_guard(),
  public.admin_new_combinations(uuid),public.admin_new_combination_save(jsonb,uuid,bigint),public.admin_new_combination_preview(uuid),
  public.admin_new_combination_publish(uuid,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_new_combinations(uuid),public.admin_new_combination_save(jsonb,uuid,bigint),
  public.admin_new_combination_preview(uuid),public.admin_new_combination_publish(uuid,bigint,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
