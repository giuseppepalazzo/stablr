-- Apply once after admin-new-club-course-tees.sql. New private Clubs only.
begin;

create table public.admin_new_club_publications (
  publication_id uuid primary key default gen_random_uuid(),
  source_draft_id uuid not null unique references public.admin_catalog_drafts(draft_id) on delete restrict,
  club_id uuid not null references public.clubs(id) on delete restrict,
  version_id uuid not null unique references public.admin_catalog_versions(version_id) on delete restrict,
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default clock_timestamp(),
  note text not null check(char_length(btrim(note)) between 1 and 500),
  confirmation_hash text not null check(confirmation_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  created_records jsonb not null check(jsonb_typeof(created_records)='object')
);
alter table public.admin_new_club_publications enable row level security;
revoke all on public.admin_new_club_publications from public,anon,authenticated,service_role;
grant select on public.admin_new_club_publications to authenticated;
create policy admin_new_club_publications_select on public.admin_new_club_publications for select to authenticated
  using(auth.uid()=published_by and auth.role()='authenticated' and public.is_admin());
create trigger admin_new_club_publications_immutable before update or delete on public.admin_new_club_publications
  for each row execute function public.admin_catalog_reject_removal();
create trigger admin_new_club_publications_no_truncate before truncate on public.admin_new_club_publications
  for each statement execute function public.admin_catalog_reject_removal();

create function public.admin_new_club_name_key(p_name text)
returns text language sql immutable set search_path=pg_catalog as $$
  select btrim(regexp_replace(translate(lower(p_name), '.,/#!$%^&*;:{}=-_`~()''"', ''),'[[:space:]]+',' ','g'));
$$;

create function public.admin_new_club_snapshot(p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare source jsonb; result jsonb;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or jsonb_typeof(p_snapshot->'name') is distinct from 'string'
    or (p_snapshot-array['name','city','fig_code','fig_source'])<>'{}'::jsonb
    or (p_snapshot ? 'city' and jsonb_typeof(p_snapshot->'city') not in ('string','null'))
    or (p_snapshot ? 'fig_code' and jsonb_typeof(p_snapshot->'fig_code') not in ('string','null')) then
    raise exception 'Invalid private Club fields' using errcode='22023';
  end if;
  result:=jsonb_build_object('name',btrim(p_snapshot->>'name'),'city',nullif(btrim(p_snapshot->>'city'),''),
    'fig_code',nullif(btrim(p_snapshot->>'fig_code'),''));
  if char_length(result->>'name')>200 or char_length(result->>'city')>200 or char_length(result->>'fig_code')>200 then
    raise exception 'Private Club fields too long' using errcode='22023';
  end if;
  source:=p_snapshot->'fig_source';
  if source is not null then
    if jsonb_typeof(source) is distinct from 'object' or not(source ?& array['id','name','city','source_system','source_external_id'])
      or (source-array['id','name','city','source_system','source_external_id'])<>'{}'::jsonb
      or jsonb_typeof(source->'id') is distinct from 'string' or source->>'id' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      or jsonb_typeof(source->'name') is distinct from 'string' or btrim(source->>'name')=''
      or jsonb_typeof(source->'city') not in ('string','null')
      or source->>'source_system' is distinct from 'fig'
      or jsonb_typeof(source->'source_external_id') is distinct from 'string' or btrim(source->>'source_external_id')=''
      or char_length(source->>'name')>200 or char_length(source->>'city')>200 or char_length(source->>'source_external_id')>200 then
      raise exception 'Invalid selected FIG provenance' using errcode='22023';
    end if;
    result:=result||jsonb_build_object('fig_source',source);
  end if;
  return result;
end;
$$;

-- A pure read: no open/create RPC, locks, baseline update or publication.
create function public.admin_new_club_preview(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; root public.admin_catalog_drafts; course public.admin_catalog_drafts; grid public.admin_catalog_drafts;
  tee public.admin_catalog_drafts; club_fields jsonb; course_fields jsonb; holes jsonb; tee_fields jsonb;
  courses jsonb:='[]'; tees jsonb; blocks jsonb:='[]'; course_blocks jsonb; manifest jsonb;
  count_holes integer:=0; count_tees integer:=0; total integer; configured boolean; active_tees integer;
  source_id uuid; reference text; fig_valid boolean:=true; duplicates boolean; name_valid boolean;
begin
  actor:=public.admin_catalog_require_admin();root:=public.admin_new_club_course_parent(p_draft_id);
  club_fields:=public.admin_new_club_snapshot(root.snapshot);name_valid:=club_fields->>'name'<>'';
  if not name_valid then blocks:=blocks||jsonb_build_array('Nome Club obbligatorio.'); end if;
  duplicates:=exists(select 1 from public.clubs c where public.admin_new_club_name_key(c.name)=public.admin_new_club_name_key(club_fields->>'name')
    or public.admin_new_club_name_key(c.name_normalized)=public.admin_new_club_name_key(club_fields->>'name'));
  if duplicates then blocks:=blocks||jsonb_build_array('Un Club con questo nome è già presente nel catalogo.'); end if;
  if club_fields ? 'fig_source' then
    source_id:=(club_fields#>>'{fig_source,id}')::uuid;reference:=club_fields#>>'{fig_source,source_external_id}';
    fig_valid:=exists(select 1 from public.fig_clubs f where f.id=source_id and f.source_system='fig' and f.source_external_id=reference);
    if not fig_valid then blocks:=blocks||jsonb_build_array('Il record FIG selezionato non è più disponibile con la stessa identità.'); end if;
  end if;
  -- Explicit stored identity only; a manual FIG reference is never a match.
  if reference is not null and exists(select 1 from public.clubs c where c.fig_club_id=source_id
    or (c.source_system='fig' and c.source_external_id=reference)
    or c.source_payload->>'figClubCode'=reference or c.source_payload->>'fig_club_code'=reference
    or c.source_payload#>>'{new_club_provenance,fig_source,id}'=source_id::text) then
    blocks:=blocks||jsonb_build_array('Il record FIG selezionato è già presente in STABLR.');fig_valid:=false;
  end if;
  if club_fields->>'fig_code' is not null and exists(select 1 from public.clubs c
    where (c.source_system='fig' and c.source_external_id=club_fields->>'fig_code')
      or c.source_payload->>'figClubCode'=club_fields->>'fig_code' or c.source_payload->>'fig_club_code'=club_fields->>'fig_code'
      or c.fig_club_id in(select f.id from public.fig_clubs f where f.source_system='fig' and f.source_external_id=club_fields->>'fig_code')) then
    blocks:=blocks||jsonb_build_array('Il riferimento FIG è già collegato a un Club esistente.');fig_valid:=false;
  end if;
  if exists(select 1 from public.admin_catalog_drafts d where d.parent_draft_id=root.draft_id and d.workflow_status='draft'
    and (d.entity_type<>'route' or d.created_by<>actor or d.live_entity_id is not null)) then
    blocks:=blocks||jsonb_build_array('La bozza contiene entità non supportate o appartenenti a un altro Admin.');
  end if;
  for course in select d.* from public.admin_catalog_drafts d where d.parent_draft_id=root.draft_id
    and d.entity_type='route' and d.workflow_status='draft' and d.created_by=actor
    order by (d.snapshot->>'display_order')::integer,d.created_at,d.draft_id
  loop
    perform public.admin_new_course_holes_parent(course.draft_id);
    course_fields:=public.admin_new_club_course_snapshot(course.snapshot);course_blocks:='[]';
    holes:=null;total:=null;configured:=false;tees:='[]';active_tees:=0;
    if exists(select 1 from public.admin_catalog_drafts d where d.parent_draft_id=course.draft_id and d.workflow_status='draft'
      and (d.entity_type not in ('new_course_holes_grid','new_course_tee') or d.created_by<>actor or d.live_entity_id is not null)) then
      course_blocks:=course_blocks||jsonb_build_array('Entità figlie non supportate o non private.');
    end if;
    select d.* into grid from public.admin_catalog_drafts d where d.parent_draft_id=course.draft_id
      and d.entity_type='new_course_holes_grid' and d.workflow_status='draft' and d.created_by=actor;
    if grid.draft_id is not null then
      holes:=public.admin_new_course_holes_snapshot(grid.snapshot,(course_fields->>'holes_count')::integer);
      configured:=public.admin_new_course_holes_complete(holes);
      if configured then select sum((h->>'par')::integer) into total from jsonb_array_elements(holes->'holes') h; end if;
    end if;
    if not configured then course_blocks:=course_blocks||jsonb_build_array('Griglia buche incompleta: Par 3–5 e SI univoci 1–9/18 richiesti.'); end if;
    for tee in select d.* from public.admin_catalog_drafts d where d.parent_draft_id=course.draft_id
      and d.entity_type='new_course_tee' and d.workflow_status='draft' and d.created_by=actor
      order by (d.snapshot->>'display_order')::integer,d.created_at,d.draft_id
    loop
      tee_fields:=public.admin_new_course_tee_snapshot(tee.snapshot);
      if (tee_fields->>'is_active')::boolean then
        if tee_fields->'course_rating'='null'::jsonb or tee_fields->'slope_rating'='null'::jsonb then
          course_blocks:=course_blocks||jsonb_build_array('Tee attivo «'||(tee_fields->>'name')||'»: CR e Slope 55–155 obbligatori.');
        else active_tees:=active_tees+1; end if;
      end if;
      tees:=tees||jsonb_build_array(jsonb_build_object('draft_id',tee.draft_id,'revision',tee.revision,'fields',tee_fields,
        'holes_count',(course_fields->>'holes_count')::integer,'par_total',total));
    end loop;
    if active_tees=0 then course_blocks:=course_blocks||jsonb_build_array('Almeno un tee attivo con nome, CR e Slope validi richiesto.'); end if;
    -- Current live uniqueness is name + scope, WITHOUT category. Do not rename,
    -- merge tees or alter constraints on existing catalog records implicitly.
    if exists(select 1 from jsonb_array_elements(tees) t group by t#>>'{fields,name}' having count(*)>1) then
      course_blocks:=course_blocks||jsonb_build_array('Il catalogo live richiede nomi tee distinti nello stesso ambito, anche tra categorie diverse.');
    end if;
    if jsonb_array_length(course_blocks)>0 then blocks:=blocks||jsonb_build_array('Percorso «'||(course_fields->>'name')||'» da completare.'); end if;
    courses:=courses||jsonb_build_array(jsonb_build_object('draft_id',course.draft_id,'revision',course.revision,'fields',course_fields,
      'grid_draft_id',grid.draft_id,'grid_revision',grid.revision,'holes',holes->'holes','total_par',total,'configured',configured,
      'active_tees',active_tees,'tees',tees,'blockers',course_blocks));
    count_holes:=count_holes+coalesce(jsonb_array_length(holes->'holes'),0);count_tees:=count_tees+jsonb_array_length(tees);
  end loop;
  if jsonb_array_length(courses)=0 then blocks:=blocks||jsonb_build_array('Almeno un Percorso attivo richiesto: aggiungi un Percorso privato.'); end if;
  manifest:=jsonb_build_object('draft_id',root.draft_id,'revision',root.revision,'club',club_fields,'courses',courses);
  return manifest||jsonb_build_object('can_publish',jsonb_array_length(blocks)=0,'blockers',blocks,
    'checklist',jsonb_build_object('club_name',name_valid,'unique_name',not duplicates,'provenance',fig_valid,
      'courses',jsonb_array_length(courses)>0,'holes',jsonb_array_length(courses)>0 and not exists(select 1 from jsonb_array_elements(courses) c where (c->>'configured')::boolean is distinct from true),
      'tees',jsonb_array_length(courses)>0 and not exists(select 1 from jsonb_array_elements(courses) c where (c->>'active_tees')::integer=0 or jsonb_array_length(c->'blockers')>0)),
    'counts',jsonb_build_object('courses',jsonb_array_length(courses),'holes',count_holes,'tees',count_tees),
    'confirmation_hash',encode(sha256(convert_to(manifest::text,'UTF8')),'hex'));
end;
$$;

-- Root closure needs the immutable server receipt and version. It cannot be
-- manufactured through generic draft save/restore or client-set GUC values.
create function public.admin_new_club_publication_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if old.entity_type='club' and old.live_entity_id is null and old.parent_draft_id is null and old.base_snapshot is null then
    if old.workflow_status='published' then raise exception 'Published private Club is closed' using errcode='40001'; end if;
    if new.workflow_status='published' then
      if row(new.draft_id,new.entity_type,new.entity_key,new.live_entity_id,new.parent_draft_id,new.base_snapshot,new.base_version_id,
        new.base_live_updated_at,new.snapshot,new.created_by,new.created_at)
        is distinct from row(old.draft_id,old.entity_type,old.entity_key,old.live_entity_id,old.parent_draft_id,old.base_snapshot,old.base_version_id,
        old.base_live_updated_at,old.snapshot,old.created_by,old.created_at)
        or new.revision<>old.revision+1 or new.updated_by is distinct from public.admin_catalog_require_admin()
        or not exists(select 1 from public.admin_new_club_publications p join public.admin_catalog_versions v on v.version_id=p.version_id
          where p.source_draft_id=old.draft_id and p.published_by=old.created_by and v.source_draft_id=old.draft_id and v.live_entity_id=p.club_id) then
        raise exception 'Atomic new Club publication receipt required' using errcode='42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger admin_new_club_publication_guard before update on public.admin_catalog_drafts
  for each row execute function public.admin_new_club_publication_guard();

create function public.admin_new_club_publish(p_draft_id uuid,p_expected_revision bigint,p_confirmation_hash text,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; root public.admin_catalog_drafts; plan jsonb; c jsonb; h jsonb; t jsonb; fields jsonb;
  club public.clubs; live_course public.course_routes; live_hole public.route_holes; live_tee public.route_tees;
  version public.admin_catalog_versions; receipt public.admin_new_club_publications;
  created_courses jsonb:='[]'; created_holes jsonb; created_tees jsonb; mappings jsonb:='[]'; snapshot jsonb;
begin
  actor:=public.admin_catalog_require_admin();root:=public.admin_new_club_course_parent(p_draft_id,true);
  if p_expected_revision is null or root.revision<>p_expected_revision or p_confirmation_hash is null
    or p_confirmation_hash !~ '^[0-9a-f]{64}$' then raise exception 'Preview/revision required' using errcode='40001'; end if;
  if p_note is null or char_length(btrim(p_note)) not between 1 and 500 then raise exception 'Publication note required' using errcode='22023'; end if;
  -- All private writers share this root lock. Lock every open descendant in a
  -- stable order as well; unexpected children are rejected by the preview.
  perform 1 from public.admin_catalog_drafts d where d.parent_draft_id=root.draft_id and d.workflow_status='draft' order by d.draft_id for update nowait;
  perform 1 from public.admin_catalog_drafts d where d.workflow_status='draft' and d.parent_draft_id in
    (select c.draft_id from public.admin_catalog_drafts c where c.parent_draft_id=root.draft_id and c.workflow_status='draft') order by d.draft_id for update nowait;
  perform public.admin_new_club_snapshot(root.snapshot);
  perform 1 from public.fig_clubs f where f.id=(root.snapshot#>>'{fig_source,id}')::uuid
    or (f.source_system='fig' and f.source_external_id=root.snapshot->>'fig_code') order by f.id for share nowait;
  -- Covers duplicate-name and exact FIG identity INSERT/UPDATE phantoms from
  -- other publishers/imports/legacy writers. No global uniqueness/backfill.
  lock table public.clubs in share row exclusive mode nowait;
  plan:=public.admin_new_club_preview(p_draft_id);
  if plan->>'confirmation_hash' is distinct from p_confirmation_hash then raise exception 'Private publication preview changed' using errcode='40001'; end if;
  if (plan->>'can_publish')::boolean is distinct from true then raise exception 'Private Club is not complete/publishable' using errcode='22023'; end if;
  fields:=plan->'club';
  insert into public.clubs(name,name_normalized,city,created_by,data_status,source_type,is_complex,playable,is_active,source_system,source_payload)
    values(fields->>'name',public.admin_new_club_name_key(fields->>'name'),fields->>'city',actor,'verified','stablr',false,true,true,'stablr',
      jsonb_build_object('new_club_provenance',fields-array['name','city'])
        || case when fields ? 'fig_source' then jsonb_build_object('figClubCode',fields#>>'{fig_source,source_external_id}') else '{}'::jsonb end) returning * into club;
  for c in select value from jsonb_array_elements(plan->'courses') loop
    fields:=c->'fields';created_holes:='[]';created_tees:='[]';
    insert into public.course_routes(club_id,name,holes_count,total_par,display_order,is_active,source_system,source_payload)
      values(club.id,fields->>'name',(fields->>'holes_count')::integer,(c->>'total_par')::integer,(fields->>'display_order')::integer,true,'stablr',
        jsonb_build_object('admin_created',true)) returning * into live_course;
    for h in select value from jsonb_array_elements(c->'holes') loop
      insert into public.route_holes(route_id,physical_hole_number,par,stroke_index)
        values(live_course.id,(h->>'physical_hole_number')::integer,(h->>'par')::integer,(h->>'stroke_index')::integer) returning * into live_hole;
      created_holes:=created_holes||jsonb_build_array(jsonb_build_object('id',live_hole.id,'physical_hole_number',live_hole.physical_hole_number,'par',live_hole.par,'stroke_index',live_hole.stroke_index));
    end loop;
    for t in select value from jsonb_array_elements(c->'tees') loop
      fields:=t->'fields';
      insert into public.route_tees(route_id,tee_name,tee_color,gender,holes_count,course_rating,slope_rating,par_total,estimated,is_active,source_system,source_payload)
        values(live_course.id,fields->>'name',fields->>'tee_color',case fields->>'rating_category' when 'men' then 'men' when 'women' then 'women' else null end,
          live_course.holes_count,(fields->>'course_rating')::numeric,(fields->>'slope_rating')::integer,live_course.total_par,false,(fields->>'is_active')::boolean,'stablr',
          jsonb_build_object('admin_display_order',(fields->>'display_order')::integer)) returning * into live_tee;
      created_tees:=created_tees||jsonb_build_array(jsonb_build_object('id',live_tee.id,'draft_id',t->>'draft_id','tee_name',live_tee.tee_name,
        'tee_color',live_tee.tee_color,'gender',live_tee.gender,'holes_count',live_tee.holes_count,'course_rating',live_tee.course_rating,'slope_rating',live_tee.slope_rating,
        'par_total',live_tee.par_total,'is_active',live_tee.is_active));
    end loop;
    created_courses:=created_courses||jsonb_build_array(jsonb_build_object('id',live_course.id,'club_id',club.id,'name',live_course.name,'holes_count',live_course.holes_count,
      'total_par',live_course.total_par,'display_order',live_course.display_order,'is_active',true,'route_holes',created_holes,'route_tees',created_tees));
    mappings:=mappings||jsonb_build_array(jsonb_build_object('draft_id',c->>'draft_id','course_id',live_course.id,'grid_draft_id',c->>'grid_draft_id','tees',created_tees));
  end loop;
  snapshot:=plan-array['can_publish','blockers','checklist','counts','confirmation_hash'];
  insert into public.admin_catalog_versions(entity_type,entity_key,live_entity_id,source_draft_id,version_number,schema_version,snapshot,diff,published_by,published_at)
    values('club',root.entity_key,club.id,root.draft_id,1,1,jsonb_build_object('name',club.name,'city',club.city),
      jsonb_build_object('creation',plan->'counts','note',btrim(p_note)),actor,clock_timestamp()) returning * into version;
  insert into public.admin_new_club_publications(source_draft_id,club_id,version_id,published_by,note,confirmation_hash,snapshot,created_records)
    values(root.draft_id,club.id,version.version_id,actor,btrim(p_note),p_confirmation_hash,snapshot,jsonb_build_object('club_id',club.id,'courses',mappings)) returning * into receipt;
  -- Close children while their parents are still open. Their immutable private
  -- identity/snapshot remains intact; the receipt stores the live mapping.
  for c in select value from jsonb_array_elements(plan->'courses') loop
    for t in select value from jsonb_array_elements(c->'tees') loop
      perform public.admin_new_course_tee_archive((c->>'draft_id')::uuid,(t->>'draft_id')::uuid,(t->>'revision')::bigint);
    end loop;
    perform public.admin_new_course_holes_archive((c->>'grid_draft_id')::uuid,(c->>'grid_revision')::bigint,(c->>'revision')::bigint);
    perform public.admin_new_club_course_archive(root.draft_id,(c->>'draft_id')::uuid,(c->>'revision')::bigint);
  end loop;
  update public.admin_catalog_drafts set workflow_status='published',revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where draft_id=root.draft_id;
  return jsonb_build_object('draft_id',root.draft_id,'publication_id',receipt.publication_id,'version_id',version.version_id,'counts',plan->'counts',
    'club',jsonb_build_object('id',club.id,'name',club.name,'city',club.city,'data_status',club.data_status,'source_type',club.source_type,
      'source_payload',club.source_payload,'playable',true,'created_at',club.created_at,'updated_at',club.updated_at,'course_routes',created_courses,'route_combinations','[]'::jsonb));
end;
$$;
revoke all on function public.admin_new_club_name_key(text) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_club_snapshot(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_club_publication_guard() from public,anon,authenticated,service_role;
revoke all on function public.admin_new_club_preview(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_new_club_publish(uuid,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_new_club_preview(uuid) to authenticated;
grant execute on function public.admin_new_club_publish(uuid,bigint,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
