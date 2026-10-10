-- Safe physical Par publication. Apply ONCE after tee classifications/evidence.
-- No backfill. No migration-time live writes. No player/import changes.
begin;

create table public.admin_catalog_par_drafts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  physical_hole_id uuid not null references public.admin_catalog_physical_holes(id) on delete restrict,
  new_par integer not null check(new_par between 3 and 6),
  base_hash text not null check(base_hash ~ '^[0-9a-f]{64}$'),
  revision bigint not null default 1 check(revision>0),
  status text not null default 'draft' check(status in ('draft','publishing','published','archived')),
  publication_xid bigint,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check((status='publishing')=(publication_xid is not null))
);
create unique index admin_catalog_par_personal_draft on public.admin_catalog_par_drafts(physical_hole_id,actor_id) where status='draft';
create table public.admin_catalog_par_versions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  physical_hole_id uuid not null references public.admin_catalog_physical_holes(id) on delete restrict,
  draft_id uuid not null unique references public.admin_catalog_par_drafts(id) on delete restrict,
  before_values jsonb not null,
  after_values jsonb not null,
  diff jsonb not null,
  origin_after_hash text not null check(origin_after_hash ~ '^[0-9a-f]{64}$'),
  verified_link_ids uuid[] not null,
  verified_configuration_ids uuid[] not null,
  note text not null check(length(btrim(note)) between 1 and 2000),
  actor_id uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default clock_timestamp()
);
create table public.admin_catalog_par_tee_batches (
  id uuid primary key default gen_random_uuid(), club_id uuid not null,
  proposal_hash text not null check(proposal_hash ~ '^[0-9a-f]{64}$'), note text not null,
  summary jsonb not null, actor_id uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default clock_timestamp(),
  unique(club_id,proposal_hash)
);
do $$ declare n text; begin
  foreach n in array array['admin_catalog_par_drafts','admin_catalog_par_versions','admin_catalog_par_tee_batches'] loop
    execute format('alter table public.%I enable row level security',n);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
    -- RPC-only reads: no private baseline/publication capability is exposed directly.
    execute format('create trigger %I before delete on public.%I for each row execute function public.admin_catalog_foundation_no_removal()',n||'_no_delete',n);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.admin_catalog_foundation_no_removal()',n||'_no_truncate',n);
    if n<>'admin_catalog_par_drafts' then
      execute format('create trigger %I before update on public.%I for each row execute function public.admin_catalog_foundation_no_removal()',n||'_immutable',n);
    end if;
  end loop;
end $$;

create function public.admin_catalog_par_hash(p_value jsonb)
returns text language sql immutable set search_path=pg_catalog as $$
  select encode(sha256(convert_to(p_value::text,'UTF8')),'hex');
$$;

-- Preserve the original sealed registration evidence. A publication establishes
-- a NEW audited current read anchor, never rewrites its historical snapshots.
alter function public.admin_catalog_data_origin(uuid) rename to admin_catalog_data_origin_registration;
revoke all on function public.admin_catalog_data_origin_registration(uuid) from public,anon,authenticated,service_role;
create function public.admin_catalog_data_origin(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare g jsonb; v public.admin_catalog_par_versions;
begin
  perform public.admin_catalog_require_admin();
  g:=public.admin_catalog_data_origin_registration(p_club_id);
  select * into v from public.admin_catalog_par_versions where club_id=p_club_id order by published_at desc,id desc limit 1;
  if v.id is not null and v.origin_after_hash=public.admin_catalog_par_hash(g-array['read_at','publication','drafts']) then
    g:=jsonb_set(g,'{physical_links}',(select coalesce(jsonb_agg(case when (l->>'id')::uuid=any(v.verified_link_ids)
      then jsonb_set(l,'{source_state}','"matched"') else l end order by l->>'id'),'[]') from jsonb_array_elements(g->'physical_links') l));
    g:=jsonb_set(g,'{configurations}',(select coalesce(jsonb_agg(case when (c->>'id')::uuid=any(v.verified_configuration_ids)
      then jsonb_set(jsonb_set(c,'{source_state}','"matched"'),'{tee_state}','"matched"') else c end order by c->>'id'),'[]') from jsonb_array_elements(g->'configurations') c));
  end if;
  return g;
end $$;

-- The private transaction capability permits ONLY this publisher's exact Par
-- UPDATE. API roles cannot forge it, set it with a GUC or write the draft table.
do $$ declare body text; needle text:='actor := public.admin_catalog_require_admin();'; begin
  select pg_get_functiondef('public.admin_catalog_foundation_guard()'::regprocedure) into body;
  if strpos(body,needle)=0 then raise exception 'Unsupported foundation guard'; end if;
  body:=replace(body,needle,needle||$branch$
  if tg_op='UPDATE' and tg_table_name='admin_catalog_physical_holes' then
    if exists(select 1 from public.admin_catalog_par_drafts d where d.physical_hole_id=old.id
      and d.actor_id=actor and d.status='publishing' and d.publication_xid=txid_current()
      and d.new_par=(to_jsonb(new)->>'base_par')::integer)
      and old.review_status='verified' and new.review_status='verified'
      and (to_jsonb(new)-array['base_par','revision','updated_by','updated_at'])
        is not distinct from (to_jsonb(old)-array['base_par','revision','updated_by','updated_at']) then
      new.revision:=old.revision+1;new.updated_by:=actor;new.updated_at:=clock_timestamp();return new;
    end if;
  end if;
$branch$);
  execute body;
end $$;

create function public.admin_catalog_par_lock(p_club_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform public.admin_catalog_require_admin();
  perform public.admin_catalog_structure_club_lock(p_club_id);
  -- Includes phantoms and writers not using the advisory club lock (imports,
  -- old editors, new tees/drafts). NOWAIT fails before publication writes.
  lock table public.profiles in share mode nowait;
  lock table public.route_holes,public.course_routes,public.route_combination_holes,public.route_combinations,
    public.route_tees,public.combination_tees,public.admin_catalog_physical_structures,
    public.admin_catalog_physical_course_links,public.admin_catalog_physical_holes,
    public.admin_catalog_playable_configurations,public.admin_catalog_configuration_holes,
    public.admin_catalog_configuration_components,public.admin_catalog_tee_overrides,
    public.admin_catalog_tee_classifications,public.admin_catalog_par_drafts,
    public.admin_catalog_par_versions,public.admin_catalog_par_tee_batches in share row exclusive mode nowait;
  lock table public.admin_catalog_drafts,public.admin_catalog_versions in share mode nowait;
end $$;

create function public.admin_catalog_par_tee_proposal(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare t record; ctx jsonb; cfg_ids uuid[]; decision jsonb; items jsonb:='[]'; excluded jsonb:='[]'; why text;
begin
  perform public.admin_catalog_require_admin();
  if not exists(select 1 from public.clubs where id=p_club_id) then raise exception 'Existing club required' using errcode='22023'; end if;
  for t in
    select 'route_tee'::text kind,lt.id,lt.tee_name name,r.id parent,r.name parent_name,coalesce(lt.holes_count,r.holes_count) scope
      from public.route_tees lt join public.course_routes r on r.id=lt.route_id where r.club_id=p_club_id
    union all select 'combination_tee',lt.id,lt.tee_name,r.id,r.name,coalesce(lt.holes_count,r.holes_count)
      from public.combination_tees lt join public.route_combinations r on r.id=lt.route_combination_id where r.club_id=p_club_id
    order by 1,2
  loop
    why:=null;
    select array_agg(c.id order by c.id) into cfg_ids from public.admin_catalog_playable_configurations c
      where c.club_id=p_club_id and c.review_status='verified' and c.holes_count=t.scope
        and (case t.kind when 'route_tee' then c.legacy_course_route_id else c.legacy_combination_id end)=t.parent;
    if exists(select 1 from public.admin_catalog_tee_classifications c where c.entity_type=t.kind and c.live_tee_id=t.id) then why:='existing_classification_preserved';
    elsif coalesce(cardinality(cfg_ids),0)<>1 then why:='exact_verified_scope_missing_or_ambiguous';
    else
      ctx:=public.admin_catalog_tee_classification_context(p_club_id,t.kind,t.id,cfg_ids[1]);
      if ctx#>>'{configuration,valid}' is distinct from 'true' then why:='unverified_or_changed_dependencies';
      elsif ctx#>>'{tee,par_total}' is null then why:='missing_live_par';
      elsif ctx#>>'{tee,par_total}' is distinct from ctx#>>'{configuration,total_par}' then why:='live_par_diverges_from_verified_rule';
      else
        decision:=jsonb_build_object('attestation','curato','par_behavior','derivato','provenance','stablr',
          'evidence',jsonb_build_object('kind','admin_review','reference','verified_configuration:'||cfg_ids[1]::text,
            'par_total',ctx#>'{tee,par_total}','holes_count',t.scope,'applicability',ctx#>'{tee,applicability}'),
          'note','Proposta: somma del Par effettivo della configurazione verificata; decisione Admin richiesta.',
          'configuration_id',cfg_ids[1],'derivation_rule','sum_configuration_effective_par',
          'declared_holes_count',t.scope,'declared_applicability',ctx#>'{tee,applicability}');
        decision:=public.admin_catalog_tee_classification_validate(decision,ctx);
        items:=items||jsonb_build_array(jsonb_build_object('entity_type',t.kind,'tee_id',t.id,'tee_name',t.name,
          'parent_name',t.parent_name,'configuration_id',cfg_ids[1],'configuration_label',ctx#>>'{configuration,label}',
          'scope',t.scope,'par_total',ctx#>'{tee,par_total}','decision',decision,'baseline',ctx->'baseline'));
      end if;
    end if;
    if why is not null then excluded:=excluded||jsonb_build_array(jsonb_build_object('entity_type',t.kind,'tee_id',t.id,'tee_name',t.name,'parent_name',t.parent_name,'reason',why)); end if;
  end loop;
  return jsonb_build_object('club_id',p_club_id,'items',items,'excluded',excluded,
    'tee_count',jsonb_array_length(items),'configuration_count',(select count(distinct x->>'configuration_id') from jsonb_array_elements(items) x),
    'proposal_hash',public.admin_catalog_par_hash(jsonb_build_array(p_club_id,items,excluded)));
end $$;

create function public.admin_catalog_par_tee_confirm(p_club_id uuid,p_proposal_hash text,p_note text,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; p jsonb; x jsonb; d jsonb; receipt public.admin_catalog_par_tee_batches;
begin
  actor:=public.admin_catalog_require_admin();
  if p_confirm is distinct from true or p_note is null or length(btrim(p_note)) not between 1 and 2000 then raise exception 'Explicit batch confirmation and note required' using errcode='22023'; end if;
  perform public.admin_catalog_par_lock(p_club_id);
  select * into receipt from public.admin_catalog_par_tee_batches where club_id=p_club_id and proposal_hash=p_proposal_hash;
  if found then
    if receipt.actor_id<>actor or receipt.note<>btrim(p_note) then raise exception 'Approval cannot be reused' using errcode='40001'; end if;
    return receipt.summary||jsonb_build_object('batch_id',receipt.id);
  end if;
  p:=public.admin_catalog_par_tee_proposal(p_club_id);
  if p_proposal_hash is null or p_proposal_hash is distinct from p->>'proposal_hash' then raise exception 'Proposal source changed' using errcode='40001'; end if;
  if jsonb_array_length(p->'items')=0 then raise exception 'No safe tee proposal' using errcode='23514'; end if;
  for x in select value from jsonb_array_elements(p->'items') loop
    d:=jsonb_set(x->'decision','{note}',to_jsonb(btrim(p_note)));
    perform public.admin_catalog_tee_classification_confirm(p_club_id,x->>'entity_type',(x->>'tee_id')::uuid,d,0,x->'baseline',true);
  end loop;
  insert into public.admin_catalog_par_tee_batches(club_id,proposal_hash,note,summary,actor_id)
    values(p_club_id,p_proposal_hash,btrim(p_note),jsonb_build_object('tee_count',p->'tee_count','configuration_count',p->'configuration_count'),actor)
    returning * into receipt;
  return receipt.summary||jsonb_build_object('batch_id',receipt.id);
end $$;

-- A private complete graph validator. Exact UUIDs and recorded occurrences are
-- the only mapping; number/offset/name/Par equality never creates a link.
create function public.admin_catalog_par_graph_check(p_g jsonb)
returns text[] language plpgsql stable security definer set search_path=pg_catalog as $$
#variable_conflict use_column
declare c jsonb; h jsonb; p jsonb; l jsonb; live jsonb; parent jsonb; why text[]:='{}'; n integer; total integer;
begin
  perform public.admin_catalog_require_admin();
  if exists(select 1 from jsonb_array_elements(p_g->'configurations') c group by c->>'legacy_course_route_id',c->>'legacy_combination_id',c->>'holes_count' having count(*)>1) then why:=array_append(why,'ambiguous_configuration_live_source');end if;
  for c in select value from jsonb_array_elements(p_g->'configurations') loop
    if c->>'review_status'<>'verified' then why:=array_append(why,'configuration_not_verified');continue;end if;
    n:=(c->>'holes_count')::integer;total:=0;
    if c->>'source_state'<>'matched' or c->>'tee_state' not in ('matched','not_recorded') then why:=array_append(why,'source_or_tee_base_changed'); end if;
    if not exists(select 1 from jsonb_array_elements(p_g->'structures') st where st->>'id'=c->>'structure_id' and st->>'review_status'='verified') then why:=array_append(why,'structure_not_verified'); end if;
    if (select count(*) from jsonb_array_elements(p_g->'configuration_holes') s where s->>'configuration_id'=c->>'id')<>n
      or (select count(distinct (s->>'position')::integer) from jsonb_array_elements(p_g->'configuration_holes') s where s->>'configuration_id'=c->>'id' and (s->>'position')::integer between 1 and n)<>n
      or (select count(distinct s->>'stroke_index') from jsonb_array_elements(p_g->'configuration_holes') s where s->>'configuration_id'=c->>'id' and (s->>'stroke_index')::integer between 1 and 18)<>n then why:=array_append(why,'incomplete_configuration_grid'); end if;
    if c->>'parent_configuration_id' is not null and not exists(select 1 from jsonb_array_elements(p_g->'configurations') pc
      where pc->>'id'=c->>'parent_configuration_id' and pc->>'revision'=c->>'parent_configuration_revision' and pc->>'review_status'='verified') then why:=array_append(why,'parent_revision_changed'); end if;
    if c->>'registration_kind'='multi9_18' and (select count(*) from jsonb_array_elements(p_g->'components') cp where cp->>'configuration_id'=c->>'id')<>2 then why:=array_append(why,'components_incomplete'); end if;
    for h in select value from jsonb_array_elements(p_g->'configuration_holes') where value->>'configuration_id'=c->>'id' loop
      select value into p from jsonb_array_elements(p_g->'physical_holes') where value->>'id'=h->>'physical_hole_id';
      select value into l from jsonb_array_elements(p_g->'physical_links') where value->>'id'=p->>'source_course_link_id';
      if h->>'review_status'<>'verified' or p is null or p->>'review_status'<>'verified' or h->>'structure_id' is distinct from c->>'structure_id'
        or p->>'structure_id' is distinct from c->>'structure_id' or l is null or l->>'review_status'<>'verified' or l->>'source_state'<>'matched'
        or not exists(select 1 from jsonb_array_elements(p_g->'course_holes') rh where rh->>'id'=p->>'source_route_hole_id'
          and rh->>'route_id'=l->>'course_id' and rh->>'physical_hole_number'=p->>'physical_number' and rh->>'par'=p->>'base_par') then why:=array_append(why,'physical_link_not_current'); end if;
      if h->>'legacy_route_hole_id' is not null then
        select value into live from jsonb_array_elements(p_g->'course_holes') where value->>'id'=h->>'legacy_route_hole_id' and value->>'route_id'=c->>'legacy_course_route_id';
        if live is null or (c->>'registration_kind'<>'repeated_18' and live->>'physical_hole_number'<>h->>'position')
          or (case when c->>'registration_kind'='repeated_18' and (h->>'occurrence')::integer=2 then least(18,(live->>'stroke_index')::integer+1)::text else live->>'stroke_index' end) is distinct from h->>'stroke_index' then why:=array_append(why,'exact_live_link_or_si_changed'); end if;
      else
        select value into live from jsonb_array_elements(p_g->'combination_holes') where value->>'id'=h->>'legacy_combination_hole_id'
          and value->>'route_combination_id'=c->>'legacy_combination_id' and value->>'route_id'=l->>'course_id' and value->>'physical_hole_number'=p->>'physical_number';
        if live is null or live->>'round_hole_number' is distinct from h->>'position' or live->>'stroke_index' is distinct from h->>'stroke_index' then why:=array_append(why,'exact_live_link_or_si_changed'); end if;
      end if;
      if (h->>'occurrence')::integer<>(select count(*) from jsonb_array_elements(p_g->'configuration_holes') s where s->>'configuration_id'=c->>'id' and s->>'physical_hole_id'=h->>'physical_hole_id' and (s->>'position')::integer<=(h->>'position')::integer) then why:=array_append(why,'occurrence_invalid'); end if;
      if h->>'par_mode' not in ('inherited','override') or live->>'par' is distinct from (case h->>'par_mode' when 'inherited' then p->>'base_par' else h->>'par_override' end) then why:=array_append(why,'par_base_diverges'); end if;
      total:=total+coalesce((case h->>'par_mode' when 'inherited' then p->>'base_par' else h->>'par_override' end)::integer,0);
    end loop;
    if c->>'registration_kind'<>'repeated_18' then
      if c->>'legacy_course_route_id' is not null then select value into parent from jsonb_array_elements(p_g->'courses') where value->>'id'=c->>'legacy_course_route_id';
      else select value into parent from jsonb_array_elements(p_g->'combinations') where value->>'id'=c->>'legacy_combination_id'; end if;
      if total is distinct from (parent->>'total_par')::integer then why:=array_append(why,'live_total_diverges'); end if;
    end if;
  end loop;
  -- A missing configuration is UNKNOWN impact, never absence of impact.
  if exists(select 1 from jsonb_array_elements(p_g->'course_holes') r where not exists(select 1 from jsonb_array_elements(p_g->'configuration_holes') h where h->>'legacy_route_hole_id'=r->>'id' and h->>'review_status'='verified'))
    or exists(select 1 from jsonb_array_elements(p_g->'combination_holes') r where not exists(select 1 from jsonb_array_elements(p_g->'configuration_holes') h where h->>'legacy_combination_hole_id'=r->>'id' and h->>'review_status'='verified'))
    or exists(select 1 from jsonb_array_elements(p_g->'courses') r where not exists(select 1 from jsonb_array_elements(p_g->'configurations') c where c->>'legacy_course_route_id'=r->>'id' and c->>'review_status'='verified'))
    or exists(select 1 from jsonb_array_elements(p_g->'combinations') r where not exists(select 1 from jsonb_array_elements(p_g->'configurations') c where c->>'legacy_combination_id'=r->>'id' and c->>'review_status'='verified')) then why:=array_append(why,'incomplete_club_coverage'); end if;
  if exists(select 1 from jsonb_array_elements(p_g->'components') cp where cp->>'review_status'<>'verified'
    or not exists(select 1 from jsonb_array_elements(p_g->'physical_links') l where l->>'id'=cp->>'physical_course_link_id' and l->>'review_status'='verified' and l->>'revision'=cp->>'physical_course_link_revision')
    or not exists(select 1 from jsonb_array_elements(p_g->'configurations') c where c->>'id'=cp->>'parent_configuration_id' and c->>'review_status'='verified' and c->>'revision'=cp->>'parent_configuration_revision')) then why:=array_append(why,'components_revision_changed'); end if;
  return array(select distinct x from unnest(why) x order by x);
end $$;

create function public.admin_catalog_par_plan(p_physical_hole_id uuid,p_new_par integer,p_draft_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
#variable_conflict use_column
declare ph public.admin_catalog_physical_holes; g jsonb; c jsonb; t record; s public.admin_catalog_tee_classifications;
  ctx jsonb; changes jsonb:='[]'; exclusions jsonb:='[]'; tees jsonb:='[]'; rows_changed jsonb:='[]'; why text[];
  before_total integer; delta integer; total integer; scope integer; ids uuid[]; origin_hash text; source_hash text; classifications_hash text; draft_hash text;
begin
  perform public.admin_catalog_require_admin();
  if p_new_par is null or p_new_par not between 3 and 6 then raise exception 'Par must be an integer from 3 to 6' using errcode='22023'; end if;
  select * into ph from public.admin_catalog_physical_holes where id=p_physical_hole_id;
  if not found then raise exception 'Existing physical hole required' using errcode='22023'; end if;
  g:=public.admin_catalog_data_origin(ph.club_id);why:=public.admin_catalog_par_graph_check(g);
  if ph.review_status<>'verified' then why:=array_append(why,'physical_hole_not_verified');end if;
  if p_new_par=ph.base_par then why:=array_append(why,'no_par_change');end if;
  for c in select value from jsonb_array_elements(g->'configurations') loop
    select coalesce(sum(case h->>'par_mode' when 'inherited' then (p->>'base_par')::integer else (h->>'par_override')::integer end),0),
      count(*) filter(where h->>'physical_hole_id'=ph.id::text and h->>'par_mode'='inherited')*(p_new_par-ph.base_par)
      into before_total,delta from jsonb_array_elements(g->'configuration_holes') h left join jsonb_array_elements(g->'physical_holes') p on p->>'id'=h->>'physical_hole_id' where h->>'configuration_id'=c->>'id';
    if delta<>0 then
      changes:=changes||jsonb_build_array(jsonb_build_object('id',c->>'id','label',c->>'label','holes_count',c->'holes_count',
        'before_total',before_total,'after_total',before_total+delta,'course_id',c->'legacy_course_route_id','combination_id',c->'legacy_combination_id',
        'registration_kind',c->'registration_kind','occurrences',(select jsonb_agg(jsonb_build_object('position',h->'position','occurrence',h->'occurrence')) from jsonb_array_elements(g->'configuration_holes') h where h->>'configuration_id'=c->>'id' and h->>'physical_hole_id'=ph.id::text and h->>'par_mode'='inherited')));
    end if;
    exclusions:=exclusions||coalesce((select jsonb_agg(jsonb_build_object('configuration_label',c->>'label','position',h->'position','par_override',h->'par_override')) from jsonb_array_elements(g->'configuration_holes') h where h->>'configuration_id'=c->>'id' and h->>'physical_hole_id'=ph.id::text and h->>'par_mode'='override'),'[]');
  end loop;
  if jsonb_array_length(changes)=0 then why:=array_append(why,'no_verified_inherited_configuration');end if;
  select coalesce(jsonb_agg(distinct jsonb_build_object('kind',case when h->>'legacy_route_hole_id' is not null then 'course_hole' else 'combination_hole' end,
    'id',coalesce(h->>'legacy_route_hole_id',h->>'legacy_combination_hole_id'),'before',ph.base_par,'after',p_new_par)),'[]') into rows_changed
    from jsonb_array_elements(g->'configuration_holes') h where h->>'physical_hole_id'=ph.id::text and h->>'par_mode'='inherited';
  if not exists(select 1 from jsonb_array_elements(rows_changed) r where r->>'kind'='course_hole' and r->>'id'=ph.source_route_hole_id::text)
    or exists(select 1 from jsonb_array_elements(g->'configuration_holes') h join jsonb_array_elements(rows_changed) r
      on r->>'id'=coalesce(h->>'legacy_route_hole_id',h->>'legacy_combination_hole_id') where h->>'physical_hole_id'<>ph.id::text or h->>'par_mode'<>'inherited')
    or exists(select 1 from jsonb_array_elements(g->'combination_holes') r where r->>'route_id'=(select l->>'course_id' from jsonb_array_elements(g->'physical_links') l where l->>'id'=ph.source_course_link_id::text)
      and r->>'physical_hole_number'=ph.physical_number::text and not exists(select 1 from jsonb_array_elements(g->'configuration_holes') h where h->>'legacy_combination_hole_id'=r->>'id' and h->>'physical_hole_id'=ph.id::text and h->>'review_status'='verified')) then why:=array_append(why,'ambiguous_or_uncovered_live_row');end if;
  for t in
    select 'route_tee'::text kind,lt.id,r.id parent,coalesce(lt.holes_count,r.holes_count) scope,lt.tee_name name from public.route_tees lt join public.course_routes r on r.id=lt.route_id where r.club_id=ph.club_id
    union all select 'combination_tee',lt.id,r.id,coalesce(lt.holes_count,r.holes_count),lt.tee_name from public.combination_tees lt join public.route_combinations r on r.id=lt.route_combination_id where r.club_id=ph.club_id order by 1,2
  loop
    select array_agg((x->>'id')::uuid) into ids from jsonb_array_elements(changes) x where
      (case t.kind when 'route_tee' then x->>'course_id' else x->>'combination_id' end)=t.parent::text and (x->>'holes_count')::integer=t.scope;
    if coalesce(cardinality(ids),0)=0 then
      if exists(select 1 from jsonb_array_elements(changes) x where (case t.kind when 'route_tee' then x->>'course_id' else x->>'combination_id' end)=t.parent::text) and not exists(select 1 from jsonb_array_elements(g->'configurations') x where (case t.kind when 'route_tee' then x->>'legacy_course_route_id' else x->>'legacy_combination_id' end)=t.parent::text and (x->>'holes_count')::integer=t.scope and x->>'review_status'='verified') then why:=array_append(why,'tee_scope_uncovered');end if;
      continue;
    end if;
    if cardinality(ids)<>1 then why:=array_append(why,'tee_scope_ambiguous');continue;end if;
    select * into s from public.admin_catalog_tee_classifications where entity_type=t.kind and live_tee_id=t.id;
    ctx:=public.admin_catalog_tee_classification_context(ph.club_id,t.kind,t.id,ids[1]);
    -- A verified explicit tee Par override on EVERY affected occurrence shields
    -- this tee completely. Partial/unverified overrides remain blocking. No
    -- raw matrix is associated with a tee by name/color, even in this branch.
    if ctx#>>'{baseline,tee_matrix_present}'='false' and not exists(
      select 1 from public.admin_catalog_configuration_holes ch where ch.configuration_id=ids[1]
        and ch.physical_hole_id=ph.id and ch.par_mode='inherited' and not exists(
          select 1 from public.admin_catalog_tee_overrides o where o.configuration_id=ch.configuration_id
            and o.configuration_hole_id=ch.id and o.review_status='verified' and o.par_override is not null
            and (case t.kind when 'route_tee' then o.route_tee_id else o.combination_tee_id end)=t.id)) then
      exclusions:=exclusions||jsonb_build_array(jsonb_build_object('configuration_label','Tee '||t.name,
        'position','tutte le occorrenze impattate','par_override',ctx#>'{tee,par_total}'));
      continue;
    end if;
    if s.id is null or s.par_behavior<>'derivato' or s.attestation<>'curato' or s.configuration_id<>ids[1]
      or s.baseline is distinct from ctx->'baseline' or ctx#>>'{configuration,valid}' is distinct from 'true'
      or ctx#>>'{tee,par_total}' is null then
      why:=array_append(why,'tee_unknown_review_obsolete_or_override');
    end if;
    select (x->>'after_total')::integer into total from jsonb_array_elements(changes) x where x->>'id'=ids[1]::text;
    tees:=tees||jsonb_build_array(jsonb_build_object('entity_type',t.kind,'tee_id',t.id,'name',t.name,'scope',t.scope,
      'configuration_id',ids[1],'before',ctx#>'{tee,par_total}','after',total,'classification_revision',s.revision,
      'eligible',s.id is not null and s.par_behavior='derivato' and s.attestation='curato' and s.baseline=ctx->'baseline' and ctx#>>'{configuration,valid}'='true'));
  end loop;
  -- Strict overlap policy: even an unchanged saved live draft must be explicitly
  -- resolved by its owner; this feature never archives somebody else's work.
  if jsonb_array_length(g->'drafts')>0 then why:=array_append(why,'overlapping_live_draft');end if;
  if exists(select 1 from public.admin_catalog_par_drafts d where d.club_id=ph.club_id and d.status in ('draft','publishing') and d.id is distinct from p_draft_id) then why:=array_append(why,'overlapping_physical_par_draft');end if;
  origin_hash:=public.admin_catalog_par_hash(g-array['read_at','publication','drafts']);
  select public.admin_catalog_par_hash(coalesce(jsonb_agg(jsonb_build_array(c.id,c.revision,c.baseline) order by c.id),'[]')) into classifications_hash from public.admin_catalog_tee_classifications c where c.club_id=ph.club_id;
  select public.admin_catalog_par_hash(coalesce(jsonb_agg(jsonb_build_array(d.draft_id,d.revision,d.entity_type,d.live_entity_id) order by d.draft_id),'[]')) into draft_hash from public.admin_catalog_drafts d where d.workflow_status='draft' and d.draft_id::text in (select x->>'draft_id' from jsonb_array_elements(g->'drafts') x);
  select public.admin_catalog_par_hash(jsonb_build_array(
    (select jsonb_agg(jsonb_build_array(r.id,r.source_system,r.source_external_id,r.source_payload) order by r.id) from public.course_routes r where r.club_id=ph.club_id),
    (select jsonb_agg(jsonb_build_array(r.id,r.source_system,r.source_external_id,r.source_payload) order by r.id) from public.route_combinations r where r.club_id=ph.club_id),
    (select jsonb_agg(jsonb_build_array(lt.id,lt.source_payload) order by lt.id) from public.route_tees lt join public.course_routes r on r.id=lt.route_id where r.club_id=ph.club_id),
    (select jsonb_agg(jsonb_build_array(lt.id,lt.source_payload) order by lt.id) from public.combination_tees lt join public.route_combinations r on r.id=lt.route_combination_id where r.club_id=ph.club_id))) into source_hash;
  return jsonb_build_object('club_id',ph.club_id,'physical_hole',jsonb_build_object('id',ph.id,'number',ph.physical_number,'label',ph.label,'revision',ph.revision,'before',ph.base_par,'after',p_new_par,
    'course_name',(select r.name from public.course_routes r join public.admin_catalog_physical_course_links l on l.course_id=r.id where l.id=ph.source_course_link_id)),
    'configurations',changes,'live_rows',rows_changed,'tees',tees,'overrides_excluded',exclusions,
    'blockers',to_jsonb(array(select distinct x from unnest(why) x order by x)),'can_publish',cardinality(why)=0,
    'baseline_hash',public.admin_catalog_par_hash(jsonb_build_array(origin_hash,classifications_hash,draft_hash,source_hash)));
end $$;

create function public.admin_catalog_par_list(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  perform public.admin_catalog_require_admin();
  if not exists(select 1 from public.clubs where id=p_club_id) then raise exception 'Existing club required' using errcode='22023';end if;
  return jsonb_build_object('holes',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'number',h.physical_number,'par',h.base_par,'course_name',r.name,'review_status',h.review_status) order by r.name,h.physical_number) from public.admin_catalog_physical_holes h join public.admin_catalog_physical_course_links l on l.id=h.source_course_link_id join public.course_routes r on r.id=l.course_id where h.club_id=p_club_id),'[]'),
    'history',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'physical_hole_id',v.physical_hole_id,'before',v.before_values,'after',v.after_values,'diff',v.diff,'note',v.note,'published_at',v.published_at,'own',v.actor_id=auth.uid()) order by v.published_at desc,v.id) from public.admin_catalog_par_versions v where v.club_id=p_club_id),'[]'));
end $$;

create function public.admin_catalog_par_open(p_physical_hole_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; h public.admin_catalog_physical_holes; d public.admin_catalog_par_drafts; p jsonb;
begin
  actor:=public.admin_catalog_require_admin();select * into h from public.admin_catalog_physical_holes where id=p_physical_hole_id;
  if not found or h.review_status<>'verified' then raise exception 'Verified physical hole required' using errcode='23514';end if;
  perform public.admin_catalog_par_lock(h.club_id);
  -- Re-read after the lock: a publication committed between the preliminary
  -- lookup and lock acquisition must not initialise a reverse-change draft.
  select * into h from public.admin_catalog_physical_holes where id=p_physical_hole_id;
  if not found or h.review_status<>'verified' then raise exception 'Verified physical hole required' using errcode='23514';end if;
  select * into d from public.admin_catalog_par_drafts where physical_hole_id=h.id and actor_id=actor and status='draft' for update nowait;
  if not found then
    p:=public.admin_catalog_par_plan(h.id,h.base_par,null);
    insert into public.admin_catalog_par_drafts(club_id,physical_hole_id,new_par,base_hash,actor_id) values(h.club_id,h.id,h.base_par,p->>'baseline_hash',actor) returning * into d;
  end if;
  p:=public.admin_catalog_par_plan(h.id,d.new_par,d.id);
  return p||jsonb_build_object('draft',jsonb_build_object('id',d.id,'revision',d.revision,'par',d.new_par,'status',d.status),'base_changed',d.base_hash is distinct from p->>'baseline_hash');
end $$;

create function public.admin_catalog_par_save(p_draft_id uuid,p_revision bigint,p_new_par integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d public.admin_catalog_par_drafts;p jsonb;
begin
  perform public.admin_catalog_require_admin();select * into d from public.admin_catalog_par_drafts where id=p_draft_id and actor_id=auth.uid() and status='draft';
  if not found then raise exception 'Own active draft required' using errcode='42501';end if;
  perform public.admin_catalog_par_lock(d.club_id);
  select * into d from public.admin_catalog_par_drafts where id=p_draft_id for update nowait;
  if p_revision is null or d.revision<>p_revision or d.status<>'draft' then raise exception 'Draft revision changed' using errcode='40001';end if;
  p:=public.admin_catalog_par_plan(d.physical_hole_id,p_new_par,d.id);
  if d.base_hash is distinct from p->>'baseline_hash' then raise exception 'Publication base changed: do not rebase implicitly' using errcode='40001';end if;
  update public.admin_catalog_par_drafts set new_par=p_new_par,revision=revision+1,updated_at=clock_timestamp() where id=d.id returning * into d;
  return p||jsonb_build_object('draft',jsonb_build_object('id',d.id,'revision',d.revision,'par',d.new_par,'status',d.status),'base_changed',false);
end $$;

create function public.admin_catalog_par_abandon(p_draft_id uuid,p_revision bigint,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d public.admin_catalog_par_drafts;
begin
  perform public.admin_catalog_require_admin();select * into d from public.admin_catalog_par_drafts where id=p_draft_id and actor_id=auth.uid();
  if not found then raise exception 'Own draft required' using errcode='42501';end if;
  perform public.admin_catalog_par_lock(d.club_id);
  if p_confirm is distinct from true then raise exception 'Explicit abandonment required' using errcode='22023';end if;
  update public.admin_catalog_par_drafts set status='archived',revision=revision+1,updated_at=clock_timestamp() where id=d.id and revision=p_revision and status='draft';
  if not found then raise exception 'Draft changed or closed' using errcode='40001';end if;
  return jsonb_build_object('archived',true);
end $$;

create function public.admin_catalog_par_publish(p_draft_id uuid,p_revision bigint,p_expected_hash text,p_note text,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
#variable_conflict use_column
declare actor uuid;d public.admin_catalog_par_drafts;p jsonb;x jsonb;g jsonb;v public.admin_catalog_par_versions;
  ctx jsonb;c public.admin_catalog_tee_classifications;current_classifications uuid[];links uuid[];cfgs uuid[];
begin
  actor:=public.admin_catalog_require_admin();
  if p_confirm is distinct from true or p_note is null or length(btrim(p_note)) not between 1 and 2000 then raise exception 'Explicit publication and note required' using errcode='22023';end if;
  select * into d from public.admin_catalog_par_drafts where id=p_draft_id and actor_id=actor;
  if not found then raise exception 'Own publication draft required' using errcode='42501';end if;
  perform public.admin_catalog_par_lock(d.club_id);
  select * into d from public.admin_catalog_par_drafts where id=p_draft_id for update nowait;
  if d.status<>'draft' or p_revision is null or d.revision<>p_revision then raise exception 'Draft changed or published' using errcode='40001';end if;
  p:=public.admin_catalog_par_plan(d.physical_hole_id,d.new_par,d.id);
  if p_expected_hash is null or d.base_hash is distinct from p->>'baseline_hash' or p_expected_hash is distinct from p->>'baseline_hash' then raise exception 'Impact/source/classification/draft base changed' using errcode='40001';end if;
  if p->>'can_publish' is distinct from 'true' then raise exception 'Publication blocked: %',p->'blockers' using errcode='23514';end if;
  g:=public.admin_catalog_data_origin(d.club_id);
  select array_agg((x->>'id')::uuid) into links from jsonb_array_elements(g->'physical_links') x where x->>'review_status'='verified' and x->>'source_state'='matched';
  select array_agg((x->>'id')::uuid) into cfgs from jsonb_array_elements(g->'configurations') x where x->>'review_status'='verified' and x->>'source_state'='matched';
  -- Track only CURRENT derived curated decisions; unknown/stale/non-derived
  -- classifications and their evidence are never silently adopted or rewritten.
  for c in select * from public.admin_catalog_tee_classifications where club_id=d.club_id and par_behavior='derivato' and attestation='curato' loop
    ctx:=public.admin_catalog_tee_classification_context(d.club_id,c.entity_type,c.live_tee_id,c.configuration_id);
    if c.baseline=ctx->'baseline' then current_classifications:=array_append(current_classifications,c.id);end if;
  end loop;
  update public.admin_catalog_par_drafts set status='publishing',publication_xid=txid_current() where id=d.id;
  update public.admin_catalog_physical_holes set base_par=d.new_par where id=d.physical_hole_id;
  for x in select value from jsonb_array_elements(p->'live_rows') loop
    if x->>'kind'='course_hole' then update public.route_holes set par=d.new_par where id=(x->>'id')::uuid and par=(x->>'before')::integer;
    else update public.route_combination_holes set par=d.new_par where id=(x->>'id')::uuid and par=(x->>'before')::integer;end if;
    if not found then raise exception 'Exact live hole base changed' using errcode='40001';end if;
  end loop;
  for x in select value from jsonb_array_elements(p->'configurations') loop
    if x->>'course_id' is not null and x->>'registration_kind'<>'repeated_18' then
      update public.course_routes set total_par=(x->>'after_total')::integer,updated_at=clock_timestamp() where id=(x->>'course_id')::uuid and total_par=(x->>'before_total')::integer;
      if not found then raise exception 'Course total base changed' using errcode='40001';end if;
    elsif x->>'combination_id' is not null then
      update public.route_combinations set total_par=(x->>'after_total')::integer,updated_at=clock_timestamp() where id=(x->>'combination_id')::uuid and total_par=(x->>'before_total')::integer;
      if not found then raise exception 'Combination total base changed' using errcode='40001';end if;
    end if;
  end loop;
  for x in select value from jsonb_array_elements(p->'tees') loop
    if x->>'entity_type'='route_tee' then update public.route_tees set par_total=(x->>'after')::integer,updated_at=clock_timestamp() where id=(x->>'tee_id')::uuid and par_total=(x->>'before')::integer;
    else update public.combination_tees set par_total=(x->>'after')::integer,updated_at=clock_timestamp() where id=(x->>'tee_id')::uuid and par_total=(x->>'before')::integer;end if;
    if not found then raise exception 'Tee Par base changed' using errcode='40001';end if;
  end loop;
  g:=public.admin_catalog_data_origin_registration(d.club_id);
  insert into public.admin_catalog_par_versions(club_id,physical_hole_id,draft_id,before_values,after_values,diff,origin_after_hash,verified_link_ids,verified_configuration_ids,note,actor_id)
    values(d.club_id,d.physical_hole_id,d.id,jsonb_build_object('par',p#>'{physical_hole,before}'),jsonb_build_object('par',d.new_par),
      jsonb_build_object('physical_hole',p->'physical_hole','configurations',p->'configurations','live_rows',p->'live_rows','tees',p->'tees','overrides_excluded',p->'overrides_excluded'),
      public.admin_catalog_par_hash(g-array['read_at','publication','drafts']),coalesce(links,'{}'),coalesce(cfgs,'{}'),btrim(p_note),actor) returning * into v;
  -- Derived baseline/evidence maintenance is part of the SAME publication and
  -- generates the existing immutable classification audit. CR/Slope unchanged.
  for c in select * from public.admin_catalog_tee_classifications where id=any(coalesce(current_classifications,'{}')) loop
    ctx:=public.admin_catalog_tee_classification_context(d.club_id,c.entity_type,c.live_tee_id,c.configuration_id);
    if ctx#>>'{configuration,valid}' is distinct from 'true' then raise exception 'Post-publication derivation not coherent' using errcode='23514';end if;
    update public.admin_catalog_tee_classifications set baseline=ctx->'baseline',
      evidence=jsonb_set(evidence,'{par_total}',ctx#>'{tee,par_total}'),note=btrim(p_note) where id=c.id and baseline is distinct from ctx->'baseline';
  end loop;
  update public.admin_catalog_par_drafts set status='published',publication_xid=null,revision=revision+1,updated_at=clock_timestamp() where id=d.id;
  return jsonb_build_object('version_id',v.id,'published',true,'par',d.new_par,'configuration_count',jsonb_array_length(p->'configurations'),'tee_count',jsonb_array_length(p->'tees'));
end $$;

do $$ declare f record;begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'admin_catalog_par_%' or p.proname='admin_catalog_data_origin') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
  end loop;
end $$;
grant execute on function public.admin_catalog_data_origin(uuid),
  public.admin_catalog_par_tee_proposal(uuid),public.admin_catalog_par_tee_confirm(uuid,text,text,boolean),
  public.admin_catalog_par_list(uuid),public.admin_catalog_par_open(uuid),
  public.admin_catalog_par_save(uuid,bigint,integer),public.admin_catalog_par_abandon(uuid,bigint,boolean),
  public.admin_catalog_par_publish(uuid,bigint,text,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
