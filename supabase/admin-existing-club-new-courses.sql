-- New, private Percorsi for existing Clubs. Apply ONCE after admin-new-club-publish.sql.
-- No backfill or catalog writes during migration; existing Club fields are never updated.
begin;

create table public.admin_existing_club_course_contexts (
  draft_id uuid primary key references public.admin_catalog_drafts(draft_id) on delete restrict,
  club_id uuid not null references public.clubs(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(club_id,created_by)
);
create table public.admin_existing_club_course_publications (
  publication_id uuid primary key default gen_random_uuid(),
  source_draft_id uuid not null unique references public.admin_catalog_drafts(draft_id) on delete restrict,
  club_id uuid not null references public.clubs(id) on delete restrict,
  course_id uuid not null unique references public.course_routes(id) on delete restrict,
  version_id uuid not null unique references public.admin_catalog_versions(version_id) on delete restrict,
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default now(),
  note text not null check(char_length(btrim(note)) between 1 and 500),
  confirmation_hash text not null check(confirmation_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  created_records jsonb not null check(jsonb_typeof(created_records)='object')
);
alter table public.admin_existing_club_course_contexts enable row level security;
alter table public.admin_existing_club_course_publications enable row level security;
revoke all on public.admin_existing_club_course_contexts,public.admin_existing_club_course_publications from public,anon,authenticated,service_role;
grant select on public.admin_existing_club_course_contexts,public.admin_existing_club_course_publications to authenticated;
create policy admin_existing_course_context_read on public.admin_existing_club_course_contexts for select to authenticated
  using(auth.role()='authenticated' and public.is_admin() and created_by=auth.uid());
create policy admin_existing_course_publication_read on public.admin_existing_club_course_publications for select to authenticated
  using(auth.role()='authenticated' and public.is_admin() and published_by=auth.uid());
create trigger admin_existing_course_context_immutable before update or delete on public.admin_existing_club_course_contexts
  for each row execute function public.admin_catalog_reject_removal();
create trigger admin_existing_course_context_no_truncate before truncate on public.admin_existing_club_course_contexts
  for each statement execute function public.admin_catalog_reject_removal();
create trigger admin_existing_course_publication_immutable before update or delete on public.admin_existing_club_course_publications
  for each row execute function public.admin_catalog_reject_removal();
create trigger admin_existing_course_publication_no_truncate before truncate on public.admin_existing_club_course_publications
  for each statement execute function public.admin_catalog_reject_removal();

-- Reuse the existing private grid/tee contracts. A registered `course` context
-- is an immutable container, NOT an editable Club draft or a live course.
create or replace function public.admin_new_club_course_parent(p_club_draft_id uuid,p_lock boolean default false)
returns public.admin_catalog_drafts language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; result public.admin_catalog_drafts;
begin
  actor:=public.admin_catalog_require_admin();
  if p_lock then select * into result from public.admin_catalog_drafts where draft_id=p_club_draft_id for update nowait;
  else select * into result from public.admin_catalog_drafts where draft_id=p_club_draft_id;end if;
  if result.draft_id is null or result.created_by is distinct from actor or result.live_entity_id is not null
    or result.parent_draft_id is not null or result.base_version_id is not null or result.base_snapshot is not null
    or result.base_live_updated_at is not null or result.schema_version<>1 then
    raise exception 'Owned private course container required' using errcode='42501';end if;
  if result.entity_type='club' then null;
  elsif result.entity_type='course' and exists(select 1 from public.admin_existing_club_course_contexts x
    join public.clubs c on c.id=x.club_id where x.draft_id=result.draft_id and x.created_by=actor
      and c.is_active and result.snapshot=jsonb_build_object('club_id',x.club_id)) then null;
  else raise exception 'Owned private course container required' using errcode='42501';end if;
  if result.workflow_status<>'draft' then raise exception 'Private course container closed' using errcode='40001';end if;
  return result;
end;
$$;

create function public.admin_existing_course_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; ctx public.admin_existing_club_course_contexts;
begin
  if tg_op='UPDATE' and exists(select 1 from public.admin_existing_club_course_contexts where draft_id=old.draft_id) then
    raise exception 'Course container is immutable; archive individual courses' using errcode='42501';
  end if;
  select * into ctx from public.admin_existing_club_course_contexts
    where draft_id=case when tg_op='UPDATE' then old.parent_draft_id else new.parent_draft_id end;
  if ctx.draft_id is null then return new;end if;
  actor:=public.admin_catalog_require_admin();
  perform public.admin_new_club_course_parent(ctx.draft_id,true);
  if ctx.created_by is distinct from actor or new.created_by is distinct from actor or new.updated_by is distinct from actor
    then raise exception 'Private course belongs to another Admin' using errcode='42501';end if;
  if new.entity_type<>'route' or new.live_entity_id is not null or new.base_version_id is not null
    or new.base_snapshot is not null or new.base_live_updated_at is not null or new.schema_version<>1
    then raise exception 'Only a private new course is allowed' using errcode='22023';end if;
  if tg_op='UPDATE' then
    if row(new.draft_id,new.entity_type,new.entity_key,new.live_entity_id,new.parent_draft_id,new.base_version_id,
      new.base_snapshot,new.base_live_updated_at,new.created_by,new.created_at) is distinct from
      row(old.draft_id,old.entity_type,old.entity_key,old.live_entity_id,old.parent_draft_id,old.base_version_id,
      old.base_snapshot,old.base_live_updated_at,old.created_by,old.created_at)
      then raise exception 'Private course identity is immutable' using errcode='22023';end if;
    if old.workflow_status<>'draft' or new.revision<>old.revision+1 then
      raise exception 'Private course changed or closed' using errcode='40001';end if;
    if new.workflow_status='published' and (new.snapshot is distinct from old.snapshot or not exists(
      select 1 from public.admin_existing_club_course_publications p join public.admin_catalog_versions v on v.version_id=p.version_id
      where p.source_draft_id=old.draft_id and p.club_id=ctx.club_id and p.published_by=actor
        and v.source_draft_id=old.draft_id and v.live_entity_id=p.course_id and v.entity_type='route')) then
      raise exception 'Atomic course publication receipt required' using errcode='42501';end if;
  elsif new.workflow_status<>'draft' or new.revision<>1 then
    raise exception 'New course must start as draft' using errcode='22023';end if;
  if new.workflow_status not in ('draft','archived','published') then raise exception 'Invalid private course state' using errcode='22023';end if;
  new.snapshot:=public.admin_new_club_course_snapshot(new.snapshot);
  return new;
end;
$$;
create trigger admin_existing_course_guard before insert or update on public.admin_catalog_drafts
  for each row execute function public.admin_existing_course_guard();

create function public.admin_existing_club_courses(p_club_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); ctx uuid; items jsonb; summaries jsonb; club public.clubs;
begin
  select * into club from public.clubs where id=p_club_id and is_active;
  if not found then raise exception 'Active Club required' using errcode='22023';end if;
  select draft_id into ctx from public.admin_existing_club_course_contexts where club_id=p_club_id and created_by=actor;
  items:='[]';summaries:='[]';
  if ctx is not null then
    select coalesce(jsonb_agg(jsonb_build_object('draft_id',d.draft_id,'entity_type',d.entity_type,'parent_draft_id',d.parent_draft_id,
      'live_entity_id',d.live_entity_id,'created_by',d.created_by,'workflow_status',d.workflow_status,'revision',d.revision,
      'schema_version',d.schema_version,'snapshot',d.snapshot,'created_at',d.created_at,'updated_at',d.updated_at)),'[]')
      into items from public.admin_new_club_courses(ctx) d;
    summaries:=public.admin_new_course_holes_summaries(ctx);
  end if;
  return jsonb_build_object('club_id',club.id,'club_name',club.name,'courses',items,'grid_summaries',summaries);
end;
$$;

create function public.admin_existing_club_course_save(p_club_id uuid,p_snapshot jsonb,p_draft_id uuid default null,p_expected_revision bigint default null)
returns public.admin_catalog_drafts language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); ctx uuid; parent public.admin_catalog_drafts; fields jsonb;
begin
  fields:=public.admin_new_club_course_snapshot(p_snapshot);
  if not pg_try_advisory_xact_lock(hashtextextended('stablr:new-courses:'||p_club_id::text,0)) then
    raise exception 'Club course creation busy' using errcode='55P03';end if;
  perform 1 from public.clubs where id=p_club_id and is_active for share nowait;
  if not found then raise exception 'Active Club required' using errcode='22023';end if;
  select draft_id into ctx from public.admin_existing_club_course_contexts where club_id=p_club_id and created_by=actor;
  if ctx is null then
    if p_draft_id is not null or p_expected_revision is not null then raise exception 'Private course target missing' using errcode='42501';end if;
    parent:=public.admin_catalog_create_draft('course',jsonb_build_object('club_id',p_club_id));ctx:=parent.draft_id;
    insert into public.admin_existing_club_course_contexts(draft_id,club_id,created_by) values(ctx,p_club_id,actor);
  end if;
  return public.admin_new_club_course_save(ctx,fields,p_draft_id,p_expected_revision);
end;
$$;

create function public.admin_existing_club_course_archive(p_club_id uuid,p_draft_id uuid,p_expected_revision bigint)
returns public.admin_catalog_drafts language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); ctx uuid;
begin
  select draft_id into ctx from public.admin_existing_club_course_contexts where club_id=p_club_id and created_by=actor;
  if ctx is null then raise exception 'Owned private course required' using errcode='42501';end if;
  return public.admin_new_club_course_archive(ctx,p_draft_id,p_expected_revision);
end;
$$;

create function public.admin_existing_club_course_preview(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); d public.admin_catalog_drafts; club public.clubs;
  fields jsonb; grid public.admin_catalog_drafts; holes jsonb; tees jsonb:='[]'; t public.admin_catalog_drafts;
  tf jsonb; total integer; complete boolean:=false; active_tees integer:=0; blocks jsonb:='[]'; manifest jsonb; duplicate boolean;
begin
  d:=public.admin_new_course_holes_parent(p_draft_id);
  select c.* into club from public.clubs c join public.admin_existing_club_course_contexts x on x.club_id=c.id
    where x.draft_id=d.parent_draft_id and x.created_by=actor;
  if club.id is null then raise exception 'Owned existing Club course required' using errcode='42501';end if;
  fields:=public.admin_new_club_course_snapshot(d.snapshot);
  duplicate:=exists(select 1 from public.course_routes r where r.club_id=club.id
    and public.admin_new_club_name_key(r.name)=public.admin_new_club_name_key(fields->>'name'));
  if duplicate then blocks:=blocks||jsonb_build_array('Un Percorso con questo nome è già presente nel Club.');end if;
  if club.playable is not true then blocks:=blocks||jsonb_build_array('Il Club non è giocabile: la sua abilitazione richiede una decisione separata.');end if;
  if exists(select 1 from public.admin_catalog_drafts c where c.parent_draft_id=d.draft_id and c.workflow_status='draft'
    and (c.entity_type not in ('new_course_holes_grid','new_course_tee') or c.created_by<>actor or c.live_entity_id is not null))
    then blocks:=blocks||jsonb_build_array('La bozza contiene entità figlie non supportate.');end if;
  select * into grid from public.admin_catalog_drafts where parent_draft_id=d.draft_id and entity_type='new_course_holes_grid' and workflow_status='draft';
  if grid.draft_id is not null then
    if grid.created_by<>actor then raise exception 'Private grid owner mismatch' using errcode='42501';end if;
    holes:=public.admin_new_course_holes_snapshot(grid.snapshot,(fields->>'holes_count')::integer);
    complete:=public.admin_new_course_holes_complete(holes);
    if complete then select sum((h->>'par')::integer) into total from jsonb_array_elements(holes->'holes') h;end if;
  end if;
  if not complete then blocks:=blocks||jsonb_build_array('Completa la griglia: Par 3–5 e SI univoci 1–9/18.');end if;
  for t in select * from public.admin_catalog_drafts where parent_draft_id=d.draft_id and entity_type='new_course_tee'
    and workflow_status='draft' and created_by=actor order by (snapshot->>'display_order')::integer,created_at,draft_id loop
    tf:=public.admin_new_course_tee_snapshot(t.snapshot);
    if (tf->>'is_active')::boolean then
      if tf->'course_rating'='null'::jsonb or tf->'slope_rating'='null'::jsonb then
        blocks:=blocks||jsonb_build_array('Tee attivo «'||(tf->>'name')||'»: CR e Slope 55–155 obbligatori.');
      else active_tees:=active_tees+1;end if;
    end if;
    tees:=tees||jsonb_build_array(jsonb_build_object('draft_id',t.draft_id,'revision',t.revision,'fields',tf,
      'holes_count',(fields->>'holes_count')::integer,'par_total',total));
  end loop;
  if active_tees=0 then blocks:=blocks||jsonb_build_array('Almeno un tee attivo con rating validi richiesto.');end if;
  if exists(select 1 from jsonb_array_elements(tees) j(value) group by j.value#>>'{fields,name}' having count(*)>1) then
    blocks:=blocks||jsonb_build_array('I nomi tee devono essere distinti nello stesso ambito, anche tra categorie.');end if;
  manifest:=jsonb_build_object('draft_id',d.draft_id,'revision',d.revision,
    'club',jsonb_build_object('id',club.id,'name',club.name,'is_active',club.is_active,'playable',club.playable,'updated_at',club.updated_at),
    'course',jsonb_build_object('fields',fields,'grid_draft_id',grid.draft_id,'grid_revision',grid.revision,'holes',holes->'holes','total_par',total,'tees',tees));
  return manifest||jsonb_build_object('can_publish',jsonb_array_length(blocks)=0,'blockers',blocks,
    'checklist',jsonb_build_object('unique_name',not duplicate,'club_playable',club.playable,'holes',complete,'tees',active_tees>0),
    'counts',jsonb_build_object('holes',coalesce(jsonb_array_length(holes->'holes'),0),'tees',jsonb_array_length(tees)),
    'confirmation_hash',encode(sha256(convert_to(manifest::text,'UTF8')),'hex'));
end;
$$;

create function public.admin_existing_club_course_publish(p_draft_id uuid,p_expected_revision bigint,p_confirmation_hash text,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); d public.admin_catalog_drafts; club_id uuid; plan jsonb;
  fields jsonb; h jsonb; t jsonb; live public.course_routes; hole public.route_holes; tee public.route_tees;
  holes jsonb:='[]'; tees jsonb:='[]'; v public.admin_catalog_versions; receipt public.admin_existing_club_course_publications;
begin
  d:=public.admin_new_course_holes_parent(p_draft_id,true);
  select x.club_id into club_id from public.admin_existing_club_course_contexts x where x.draft_id=d.parent_draft_id and x.created_by=actor;
  if club_id is null then raise exception 'Owned existing Club course required' using errcode='42501';end if;
  if p_expected_revision is null or d.revision<>p_expected_revision or p_confirmation_hash is null
    or p_confirmation_hash !~ '^[0-9a-f]{64}$' then raise exception 'Current preview/revision required' using errcode='40001';end if;
  if p_note is null or char_length(btrim(p_note)) not between 1 and 500 then raise exception 'Publication note required' using errcode='22023';end if;
  if not pg_try_advisory_xact_lock(hashtextextended('stablr:new-courses:'||club_id::text,0)) then
    raise exception 'Club course publication busy' using errcode='55P03';end if;
  perform 1 from public.clubs c where c.id=club_id for share nowait;
  lock table public.course_routes in share row exclusive mode nowait;
  perform 1 from public.admin_catalog_drafts where parent_draft_id=d.draft_id and workflow_status='draft' order by draft_id for update nowait;
  plan:=public.admin_existing_club_course_preview(p_draft_id);
  if plan->>'confirmation_hash' is distinct from p_confirmation_hash then raise exception 'Private course preview changed' using errcode='40001';end if;
  if (plan->>'can_publish')::boolean is distinct from true then raise exception 'Private course is incomplete or blocked' using errcode='22023';end if;
  fields:=plan#>'{course,fields}';
  insert into public.course_routes(club_id,name,holes_count,total_par,display_order,is_active,source_system,source_payload)
    values(club_id,fields->>'name',(fields->>'holes_count')::integer,(plan#>>'{course,total_par}')::integer,
      (fields->>'display_order')::integer,true,'stablr',jsonb_build_object('admin_created',true)) returning * into live;
  for h in select value from jsonb_array_elements(plan#>'{course,holes}') loop
    insert into public.route_holes(route_id,physical_hole_number,par,stroke_index)
      values(live.id,(h->>'physical_hole_number')::integer,(h->>'par')::integer,(h->>'stroke_index')::integer) returning * into hole;
    holes:=holes||jsonb_build_array(jsonb_build_object('id',hole.id,'physical_hole_number',hole.physical_hole_number,'par',hole.par,'stroke_index',hole.stroke_index));
  end loop;
  for t in select value from jsonb_array_elements(plan#>'{course,tees}') loop
    fields:=t->'fields';
    insert into public.route_tees(route_id,tee_name,tee_color,gender,holes_count,course_rating,slope_rating,par_total,estimated,is_active,source_system,source_payload)
      values(live.id,fields->>'name',fields->>'tee_color',case fields->>'rating_category' when 'men' then 'men' when 'women' then 'women' else null end,
        live.holes_count,(fields->>'course_rating')::numeric,(fields->>'slope_rating')::integer,live.total_par,false,
        (fields->>'is_active')::boolean,'stablr',jsonb_build_object('admin_display_order',(fields->>'display_order')::integer)) returning * into tee;
    tees:=tees||jsonb_build_array(jsonb_build_object('id',tee.id,'draft_id',t->>'draft_id','tee_name',tee.tee_name,'tee_color',tee.tee_color,
      'gender',tee.gender,'holes_count',tee.holes_count,'course_rating',tee.course_rating,'slope_rating',tee.slope_rating,'par_total',tee.par_total,'is_active',tee.is_active));
  end loop;
  insert into public.admin_catalog_versions(entity_type,entity_key,live_entity_id,source_draft_id,version_number,schema_version,snapshot,diff,published_by,published_at)
    values('route',d.entity_key,live.id,d.draft_id,1,1,jsonb_build_object('name',live.name,'holes_count',live.holes_count,'display_order',live.display_order,'is_active',true),
      jsonb_build_object('creation',plan->'counts','note',btrim(p_note)),actor,clock_timestamp()) returning * into v;
  insert into public.admin_existing_club_course_publications(source_draft_id,club_id,course_id,version_id,published_by,note,confirmation_hash,snapshot,created_records)
    values(d.draft_id,club_id,live.id,v.version_id,actor,btrim(p_note),p_confirmation_hash,plan-array['can_publish','blockers','checklist','counts','confirmation_hash'],
      jsonb_build_object('course_id',live.id,'holes',holes,'tees',tees)) returning * into receipt;
  for t in select value from jsonb_array_elements(plan#>'{course,tees}') loop
    perform public.admin_new_course_tee_archive(d.draft_id,(t->>'draft_id')::uuid,(t->>'revision')::bigint);
  end loop;
  perform public.admin_new_course_holes_archive((plan#>>'{course,grid_draft_id}')::uuid,(plan#>>'{course,grid_revision}')::bigint,d.revision);
  update public.admin_catalog_drafts set workflow_status='published',revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where draft_id=d.draft_id;
  return jsonb_build_object('draft_id',d.draft_id,'publication_id',receipt.publication_id,'version_id',v.version_id,
    'course',jsonb_build_object('id',live.id,'club_id',live.club_id,'name',live.name,'holes_count',live.holes_count,'total_par',live.total_par,
      'display_order',live.display_order,'is_active',true,'source_system',live.source_system,'source_payload',live.source_payload,
      'created_at',live.created_at,'updated_at',live.updated_at,'route_holes',holes,'route_tees',tees));
end;
$$;

revoke all on function public.admin_existing_course_guard() from public,anon,authenticated,service_role;
revoke all on function public.admin_new_club_course_parent(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_existing_club_courses(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_existing_club_course_save(uuid,jsonb,uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function public.admin_existing_club_course_archive(uuid,uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function public.admin_existing_club_course_preview(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_existing_club_course_publish(uuid,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_existing_club_courses(uuid) to authenticated;
grant execute on function public.admin_existing_club_course_save(uuid,jsonb,uuid,bigint) to authenticated;
grant execute on function public.admin_existing_club_course_archive(uuid,uuid,bigint) to authenticated;
grant execute on function public.admin_existing_club_course_preview(uuid) to authenticated;
grant execute on function public.admin_existing_club_course_publish(uuid,bigint,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
