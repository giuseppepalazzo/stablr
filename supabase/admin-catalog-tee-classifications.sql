-- Isolated classification of tee PAR TOTAL, not of CR/Slope. Apply ONCE.
-- Requires physical foundation through multi9, club lock and data-origin v2.
-- No backfill, live FK, live DML, batch, publication or player integration.
begin;

do $$ begin
  if to_regprocedure('public.admin_catalog_data_origin(uuid)') is null
    or to_regprocedure('public.admin_catalog_structure_club_lock(uuid)') is null then
    raise exception 'Apply minimized data-origin v2 and the structure club lock first';
  end if;
end $$;

create table public.admin_catalog_tee_classifications (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  entity_type text not null check(entity_type in ('route_tee','combination_tee')),
  live_tee_id uuid not null,
  attestation text not null check(attestation in ('certificato','curato','sconosciuto')),
  par_behavior text not null check(par_behavior in ('derivato','richiede_revisione','sconosciuto')),
  provenance text not null check(provenance in ('fig','gesgolf','stablr','official_club_site','other','unknown')),
  evidence jsonb not null check(jsonb_typeof(evidence)='object'
    and evidence ?& array['kind','reference','par_total','holes_count','applicability']
    and (evidence-array['kind','reference','par_total','holes_count','applicability'])='{}'::jsonb),
  note text not null check(length(btrim(note)) between 1 and 2000),
  configuration_id uuid,
  derivation_rule text,
  declared_holes_count integer not null check(declared_holes_count in (9,18)),
  declared_applicability text check(declared_applicability in ('men','women','mixed')),
  baseline jsonb not null check(jsonb_typeof(baseline)='object'
    and (baseline-array['entity_type','tee_id','parent_id','club_id','par_total','course_rating','slope_rating',
      'holes_count','applicability','is_active','parent_holes_count','parent_total_par','parent_active',
      'source_fingerprint','grid_fingerprint','configuration_id','configuration_revision',
      'configuration_fingerprint','configuration_valid','configuration_total_par','tee_matrix_present',
      'tee_par_override_present'])='{}'::jsonb),
  revision bigint not null check(revision>0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique(entity_type,live_tee_id),
  check((par_behavior='derivato' and configuration_id is not null
      and derivation_rule='sum_configuration_effective_par')
    or (par_behavior<>'derivato' and configuration_id is null and derivation_rule is null))
  -- Deliberately NO FK to catalog/configuration/source: imports may replace UUIDs.
);
create index admin_catalog_tee_classifications_club_idx on public.admin_catalog_tee_classifications(club_id);

create table public.admin_catalog_tee_classification_events (
  id uuid primary key default gen_random_uuid(),
  classification_id uuid not null references public.admin_catalog_tee_classifications(id) on delete restrict,
  revision bigint not null check(revision>0),
  operation text not null check(operation in ('INSERT','UPDATE')),
  before_values jsonb,
  after_values jsonb not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp(),
  unique(classification_id,revision)
);

-- Every object is reconstructed. No to_jsonb, raw payload or editor snapshot.
create function public.admin_catalog_tee_classification_values(p public.admin_catalog_tee_classifications)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('id',p.id,'entity_type',p.entity_type,'tee_id',p.live_tee_id,
    'attestation',p.attestation,'par_behavior',p.par_behavior,'provenance',p.provenance,
    'evidence',jsonb_build_object('kind',p.evidence->>'kind','reference',p.evidence->>'reference',
      'par_total',(p.evidence->>'par_total')::integer,'holes_count',(p.evidence->>'holes_count')::integer,
      'applicability',p.evidence->>'applicability'),
    'note',p.note,'configuration_id',p.configuration_id,'derivation_rule',p.derivation_rule,
    'declared_holes_count',p.declared_holes_count,'declared_applicability',p.declared_applicability,
    'revision',p.revision,'created_at',p.created_at,'updated_at',p.updated_at,
    'created_by_current_admin',p.created_by=auth.uid(),'updated_by_current_admin',p.updated_by=auth.uid());
$$;

create function public.admin_catalog_tee_classification_context(p_club_id uuid,p_entity_type text,p_tee_id uuid,p_configuration_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare tee jsonb; parent jsonb; payload_hash text; grid_hash text; g jsonb; cfg jsonb;
  slots jsonb; components jsonb; physical jsonb; links jsonb; parents jsonb; options jsonb;
  valid boolean:=false; total integer; matrix_present boolean:=false; override_present boolean:=false;
  config_hash text; baseline jsonb;
begin
  perform public.admin_catalog_require_admin();
  if p_entity_type not in ('route_tee','combination_tee') or p_entity_type is null or p_tee_id is null then
    raise exception 'Exact tee type and UUID required' using errcode='22023'; end if;
  if p_entity_type='route_tee' then
    select jsonb_build_object('id',t.id,'name',t.tee_name,'color',t.tee_color,'par_total',t.par_total,
      'course_rating',t.course_rating,'slope_rating',t.slope_rating,'holes_count',t.holes_count,
      'applicability',nullif(t.gender,''),'is_active',t.is_active),
      jsonb_build_object('id',r.id,'name',r.name,'club_id',r.club_id,'holes_count',r.holes_count,
        'total_par',r.total_par,'is_active',r.is_active),
      md5(jsonb_build_array(t.source_system,t.source_external_id,t.source_payload,r.source_payload)::text),
      r.source_payload->'tee_specific_hole_matrix' is not null and r.source_payload->'tee_specific_hole_matrix'<>'null'::jsonb
    into tee,parent,payload_hash,matrix_present from public.route_tees t join public.course_routes r on r.id=t.route_id
    where t.id=p_tee_id and r.club_id=p_club_id;
    select md5(coalesce(jsonb_agg(jsonb_build_array(h.id,h.physical_hole_number,h.par,h.stroke_index) order by h.id),'[]')::text)
      into grid_hash from public.route_holes h where h.route_id=(parent->>'id')::uuid;
  else
    select jsonb_build_object('id',t.id,'name',t.tee_name,'color',t.tee_color,'par_total',t.par_total,
      'course_rating',t.course_rating,'slope_rating',t.slope_rating,'holes_count',t.holes_count,
      'applicability',nullif(t.gender,''),'is_active',t.is_active),
      jsonb_build_object('id',r.id,'name',r.name,'club_id',r.club_id,'holes_count',r.holes_count,
        'total_par',r.total_par,'is_active',r.is_active),
      md5(jsonb_build_array(t.source_system,t.source_external_id,t.source_payload,r.source_payload,r.front_route_id,r.back_route_id)::text)
    into tee,parent,payload_hash from public.combination_tees t join public.route_combinations r on r.id=t.route_combination_id
    where t.id=p_tee_id and r.club_id=p_club_id;
    select md5(coalesce(jsonb_agg(jsonb_build_array(h.id,h.round_hole_number,h.route_id,h.route_position,h.physical_hole_number,h.par,h.stroke_index,h.source_stroke_index) order by h.id),'[]')::text)
      into grid_hash from public.route_combination_holes h where h.route_combination_id=(parent->>'id')::uuid;
  end if;
  if tee is null then return jsonb_build_object('exists',false,'baseline',null,'configurations','[]'::jsonb); end if;
  g:=public.admin_catalog_data_origin(p_club_id);
  if g->>'contract_version' is distinct from '2' then raise exception 'Minimized origin contract v2 required' using errcode='55000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c->>'id','label',c->>'label','holes_count',(c->>'holes_count')::integer,
    'review_status',c->>'review_status','revision',(c->>'revision')::bigint) order by c->>'label',c->>'id'),'[]') into options
    from jsonb_array_elements(g->'configurations') c where c->>'club_id'=p_club_id::text
      and (case p_entity_type when 'route_tee' then c->>'legacy_course_route_id' else c->>'legacy_combination_id' end)=parent->>'id'
      and (tee->>'holes_count' is null or c->>'holes_count'=tee->>'holes_count');
  if p_configuration_id is not null then
    select c into cfg from jsonb_array_elements(g->'configurations') c where c->>'id'=p_configuration_id::text
      and (case p_entity_type when 'route_tee' then c->>'legacy_course_route_id' else c->>'legacy_combination_id' end)=parent->>'id';
    if cfg is null then raise exception 'Configuration must reference this exact tee parent' using errcode='22023'; end if;
    select coalesce(jsonb_agg(s order by (s->>'position')::integer),'[]') into slots from jsonb_array_elements(g->'configuration_holes') s where s->>'configuration_id'=cfg->>'id';
    select coalesce(jsonb_agg(c order by c->>'id'),'[]') into components from jsonb_array_elements(g->'components') c where c->>'configuration_id'=cfg->>'id';
    select coalesce(jsonb_agg(h order by h->>'id'),'[]') into physical from jsonb_array_elements(g->'physical_holes') h
      where exists(select 1 from jsonb_array_elements(slots) s where s->>'physical_hole_id'=h->>'id');
    select coalesce(jsonb_agg(l order by l->>'id'),'[]') into links from jsonb_array_elements(g->'physical_links') l
      where exists(select 1 from jsonb_array_elements(physical) h where h->>'source_course_link_id'=l->>'id');
    -- A matrix on any explicitly linked physical component is not associated
    -- with this tee by name/color. Conservatively require a future contract.
    matrix_present:=coalesce(matrix_present,false) or exists(select 1 from jsonb_array_elements(g->'courses') c
      where c#>>'{tee_matrix,present}'='true' and exists(select 1 from jsonb_array_elements(links) l where l->>'course_id'=c->>'id'));
    select coalesce(jsonb_agg(c order by c->>'id'),'[]') into parents from jsonb_array_elements(g->'configurations') c
      where c->>'id'=cfg->>'parent_configuration_id' or exists(select 1 from jsonb_array_elements(components) cp where cp->>'parent_configuration_id'=c->>'id');
    select exists(select 1 from jsonb_array_elements(g->'tee_overrides') o
      where (case p_entity_type when 'route_tee' then o->>'route_tee_id' else o->>'combination_tee_id' end)=p_tee_id::text
        and o->>'par_override' is not null) into override_present;
    select count(*)=(cfg->>'holes_count')::integer and count(distinct s->>'position')=count(*)
      and min((s->>'position')::integer)=1 and max((s->>'position')::integer)=(cfg->>'holes_count')::integer
      and count(distinct s->>'stroke_index')=count(*)
      and coalesce(bool_and(s->>'review_status'='verified' and s->>'structure_id'=cfg->>'structure_id'
        and (s->>'stroke_index')::integer between 1 and 18
        and h->>'review_status'='verified' and h->>'structure_id'=cfg->>'structure_id'
        and l->>'review_status'='verified' and l->>'source_state'='matched'
        and (case s->>'par_mode' when 'inherited' then (h->>'base_par')::integer when 'override' then (s->>'par_override')::integer end) between 3 and 6
        and exists(select 1 from jsonb_array_elements(g->'structures') st where st->>'id'=cfg->>'structure_id' and st->>'review_status'='verified')
        and exists(select 1 from jsonb_array_elements(g->'course_holes') rh where rh->>'id'=h->>'source_route_hole_id'
          and rh->>'route_id'=l->>'course_id' and rh->>'physical_hole_number'=h->>'physical_number')
        and (case p_entity_type when 'route_tee' then exists(select 1 from jsonb_array_elements(g->'course_holes') rh
          where rh->>'id'=s->>'legacy_route_hole_id' and rh->>'route_id'=parent->>'id'
            and (rh->>'par')::integer=(case s->>'par_mode' when 'inherited' then (h->>'base_par')::integer else (s->>'par_override')::integer end))
          else exists(select 1 from jsonb_array_elements(g->'combination_holes') rh where rh->>'id'=s->>'legacy_combination_hole_id'
            and rh->>'route_combination_id'=parent->>'id' and rh->>'route_id'=l->>'course_id'
            and rh->>'physical_hole_number'=h->>'physical_number'
            and (rh->>'par')::integer=(case s->>'par_mode' when 'inherited' then (h->>'base_par')::integer else (s->>'par_override')::integer end)) end)),false),
      sum(case s->>'par_mode' when 'inherited' then (h->>'base_par')::integer when 'override' then (s->>'par_override')::integer end)
      into valid,total from jsonb_array_elements(slots) s
      left join jsonb_array_elements(physical) h on h->>'id'=s->>'physical_hole_id'
      left join jsonb_array_elements(links) l on l->>'id'=h->>'source_course_link_id';
    valid:=coalesce(valid,false) and cfg->>'review_status'='verified' and cfg->>'source_state'='matched'
      and cfg->>'tee_state' in ('matched','not_recorded')
      and not matrix_present and not override_present
      and not exists(select 1 from jsonb_array_elements(g->'configurations') c where c->>'id'<>cfg->>'id'
        and c->>'holes_count'=cfg->>'holes_count'
        and (case p_entity_type when 'route_tee' then c->>'legacy_course_route_id' else c->>'legacy_combination_id' end)=parent->>'id')
      and not exists(select 1 from jsonb_array_elements(slots) s group by s->>'physical_hole_id'
        having count(distinct s->>'occurrence')<>count(*) or min((s->>'occurrence')::integer)<>1 or max((s->>'occurrence')::integer)<>count(*))
      and (cfg->>'parent_configuration_id' is null or exists(select 1 from jsonb_array_elements(parents) p
        where p->>'id'=cfg->>'parent_configuration_id' and p->>'review_status'='verified' and p->>'revision'=cfg->>'parent_configuration_revision'))
      and (cfg->>'registration_kind'<>'multi9_18' or jsonb_array_length(components)=2)
      and not exists(select 1 from jsonb_array_elements(components) cp where cp->>'review_status'<>'verified'
        or not exists(select 1 from jsonb_array_elements(g->'physical_links') l where l->>'id'=cp->>'physical_course_link_id'
          and l->>'review_status'='verified' and l->>'revision'=cp->>'physical_course_link_revision' and l->>'source_state'='matched')
        or not exists(select 1 from jsonb_array_elements(parents) p where p->>'id'=cp->>'parent_configuration_id'
          and p->>'review_status'='verified' and p->>'revision'=cp->>'parent_configuration_revision' and p->>'source_state'='matched'));
    config_hash:=md5(jsonb_build_array(cfg,slots,physical,links,components,parents)::text);
  end if;
  baseline:=jsonb_build_object('entity_type',p_entity_type,'tee_id',p_tee_id,'parent_id',parent->>'id','club_id',p_club_id,
    'par_total',tee->'par_total','course_rating',tee->'course_rating','slope_rating',tee->'slope_rating',
    'holes_count',tee->'holes_count','applicability',tee->'applicability','is_active',tee->'is_active',
    'parent_holes_count',parent->'holes_count','parent_total_par',parent->'total_par','parent_active',parent->'is_active',
    'source_fingerprint',payload_hash,'grid_fingerprint',grid_hash,'configuration_id',p_configuration_id,
    'configuration_revision',cfg->'revision','configuration_fingerprint',config_hash,
    'configuration_valid',coalesce(valid,false),'configuration_total_par',total,
    'tee_matrix_present',coalesce(matrix_present,false),'tee_par_override_present',override_present);
  return jsonb_build_object('exists',true,'tee',tee,'parent',parent,'baseline',baseline,'configurations',options,
    'configuration',case when cfg is null then null else jsonb_build_object('id',cfg->>'id','label',cfg->>'label',
      'holes_count',cfg->'holes_count','revision',cfg->'revision','valid',coalesce(valid,false),'total_par',total) end);
end $$;

create function public.admin_catalog_tee_classification_validate(p_decision jsonb,p_context jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare e jsonb; a text; b text; scope integer; applicability text; cfg_id uuid; rule text;
begin
  perform public.admin_catalog_require_admin();
  if p_context->>'exists' is distinct from 'true' or jsonb_typeof(p_decision) is distinct from 'object'
    or not(p_decision ?& array['attestation','par_behavior','provenance','evidence','note','configuration_id','derivation_rule','declared_holes_count','declared_applicability'])
    or (p_decision-array['attestation','par_behavior','provenance','evidence','note','configuration_id','derivation_rule','declared_holes_count','declared_applicability'])<>'{}'::jsonb
    or jsonb_typeof(p_decision->'attestation') is distinct from 'string'
    or jsonb_typeof(p_decision->'par_behavior') is distinct from 'string'
    or jsonb_typeof(p_decision->'provenance') is distinct from 'string'
    or jsonb_typeof(p_decision->'note') is distinct from 'string'
    or jsonb_typeof(p_decision->'declared_holes_count') is distinct from 'number'
    or p_decision->>'declared_holes_count' not in ('9','18')
    or jsonb_typeof(p_decision->'declared_applicability') not in ('string','null')
    or jsonb_typeof(p_decision->'configuration_id') not in ('string','null')
    or jsonb_typeof(p_decision->'derivation_rule') not in ('string','null') then
    raise exception 'Invalid allowlisted tee Par decision' using errcode='22023'; end if;
  a:=p_decision->>'attestation'; b:=p_decision->>'par_behavior'; scope:=(p_decision->>'declared_holes_count')::integer;
  applicability:=p_decision->>'declared_applicability'; cfg_id:=(p_decision->>'configuration_id')::uuid; rule:=p_decision->>'derivation_rule';
  if a not in ('certificato','curato','sconosciuto') or b not in ('derivato','richiede_revisione','sconosciuto')
    or p_decision->>'provenance' not in ('fig','gesgolf','stablr','official_club_site','other','unknown')
    or length(btrim(p_decision->>'note')) not between 1 and 2000
    or (applicability is not null and applicability not in ('men','women','mixed'))
    or (p_context#>>'{tee,holes_count}' is not null and scope<>(p_context#>>'{tee,holes_count}')::integer)
    or (p_context#>>'{tee,applicability}' is not null and applicability is distinct from p_context#>>'{tee,applicability}') then
    raise exception 'Explicit scope, applicability and motivated decision required' using errcode='23514'; end if;
  e:=p_decision->'evidence';
  if jsonb_typeof(e) is distinct from 'object' or not(e ?& array['kind','reference','par_total','holes_count','applicability'])
    or (e-array['kind','reference','par_total','holes_count','applicability'])<>'{}'::jsonb
    or jsonb_typeof(e->'kind') is distinct from 'string' or jsonb_typeof(e->'reference') is distinct from 'string'
    or length(e->>'reference')>500 or jsonb_typeof(e->'par_total') not in ('number','null')
    or (e->>'par_total' is not null and e->>'par_total' !~ '^[0-9]{1,3}$')
    or jsonb_typeof(e->'holes_count') not in ('number','null') or (e->>'holes_count' is not null and e->>'holes_count' not in ('9','18'))
    or jsonb_typeof(e->'applicability') not in ('string','null') then
    raise exception 'Only targeted Par evidence fields are allowed' using errcode='22023'; end if;
  if a='sconosciuto' then
    if e is distinct from jsonb_build_object('kind','none','reference','','par_total',null,'holes_count',null,'applicability',null) then
      raise exception 'Unknown attestation cannot assert evidence' using errcode='23514'; end if;
  elsif length(btrim(e->>'reference'))=0 or e->>'holes_count' is distinct from scope::text
    or e->>'applicability' is distinct from applicability or e->'par_total' is distinct from p_context#>'{tee,par_total}'
    or (a='certificato' and (e->>'kind'<>'document' or e->>'par_total' is null or p_decision->>'provenance'='unknown'))
    or (a='curato' and e->>'kind'<>'admin_review') then
    raise exception 'Evidence must attest this tee Par, scope and applicability explicitly' using errcode='23514';
  end if;
  if b='derivato' then
    if cfg_id is null or rule is distinct from 'sum_configuration_effective_par'
      or p_context#>>'{configuration,valid}' is distinct from 'true'
      or p_context#>>'{configuration,id}' is distinct from cfg_id::text
      or (p_context#>>'{configuration,holes_count}')::integer<>scope
      or (p_context#>>'{tee,par_total}' is not null and (p_context#>>'{tee,par_total}')::integer<>(p_context#>>'{configuration,total_par}')::integer) then
      raise exception 'Verified exact configuration and explicit sum rule required' using errcode='23514'; end if;
  elsif cfg_id is not null or rule is not null then
    raise exception 'Configuration/rule only permitted for derived behavior' using errcode='23514'; end if;
  return jsonb_build_object('attestation',a,'par_behavior',b,'provenance',p_decision->>'provenance',
    'evidence',jsonb_build_object('kind',e->>'kind','reference',btrim(e->>'reference'),'par_total',(e->>'par_total')::integer,
      'holes_count',(e->>'holes_count')::integer,'applicability',e->>'applicability'),
    'note',btrim(p_decision->>'note'),'configuration_id',cfg_id,'derivation_rule',rule,
    'declared_holes_count',scope,'declared_applicability',applicability);
end $$;

create function public.admin_catalog_tee_classification_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; decision jsonb; context jsonb;
begin
  actor:=public.admin_catalog_require_admin();
  if tg_op='UPDATE' and row(new.id,new.club_id,new.entity_type,new.live_tee_id,new.created_by,new.created_at)
    is distinct from row(old.id,old.club_id,old.entity_type,old.live_tee_id,old.created_by,old.created_at) then
    raise exception 'Classification identity and initial author are immutable' using errcode='55000'; end if;
  context:=public.admin_catalog_tee_classification_context(new.club_id,new.entity_type,new.live_tee_id,new.configuration_id);
  decision:=public.admin_catalog_tee_classification_validate(jsonb_build_object('attestation',new.attestation,
    'par_behavior',new.par_behavior,'provenance',new.provenance,'evidence',new.evidence,'note',new.note,
    'configuration_id',new.configuration_id,'derivation_rule',new.derivation_rule,
    'declared_holes_count',new.declared_holes_count,'declared_applicability',new.declared_applicability),context);
  if new.baseline is distinct from context->'baseline' then raise exception 'Technical base changed' using errcode='40001'; end if;
  new.note:=decision->>'note'; new.evidence:=decision->'evidence';
  if tg_op='INSERT' then new.created_by:=actor;new.created_at:=clock_timestamp();new.revision:=1;
  else new.revision:=old.revision+1; end if;
  new.updated_by:=actor;new.updated_at:=clock_timestamp();return new;
end $$;

create function public.admin_catalog_tee_classification_audit()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  insert into public.admin_catalog_tee_classification_events(classification_id,revision,operation,before_values,after_values,actor_id)
    values(new.id,new.revision,tg_op,case when tg_op='UPDATE' then public.admin_catalog_tee_classification_values(old)-array['created_by_current_admin','updated_by_current_admin'] else null end,
      public.admin_catalog_tee_classification_values(new)-array['created_by_current_admin','updated_by_current_admin'],public.admin_catalog_require_admin());
  return new;
end $$;

-- Guard/audit only on the two NEW tables; existing tables/triggers untouched.
create trigger admin_catalog_tee_classifications_guard before insert or update on public.admin_catalog_tee_classifications
  for each row execute function public.admin_catalog_tee_classification_guard();
create trigger admin_catalog_tee_classifications_audit after insert or update on public.admin_catalog_tee_classifications
  for each row execute function public.admin_catalog_tee_classification_audit();
create trigger admin_catalog_tee_classifications_no_delete before delete on public.admin_catalog_tee_classifications
  for each row execute function public.admin_catalog_foundation_no_removal();
create trigger admin_catalog_tee_classifications_no_truncate before truncate on public.admin_catalog_tee_classifications
  for each statement execute function public.admin_catalog_foundation_no_removal();
create trigger admin_catalog_tee_classification_events_immutable before update or delete on public.admin_catalog_tee_classification_events
  for each row execute function public.admin_catalog_foundation_no_removal();
create trigger admin_catalog_tee_classification_events_no_truncate before truncate on public.admin_catalog_tee_classification_events
  for each statement execute function public.admin_catalog_foundation_no_removal();
alter table public.admin_catalog_tee_classifications enable row level security;
alter table public.admin_catalog_tee_classification_events enable row level security;
revoke all on public.admin_catalog_tee_classifications,public.admin_catalog_tee_classification_events from public,anon,authenticated,service_role;
grant select on public.admin_catalog_tee_classifications,public.admin_catalog_tee_classification_events to authenticated;
create policy admin_catalog_tee_classifications_admin_read on public.admin_catalog_tee_classifications for select to authenticated
  using(auth.uid() is not null and auth.role()='authenticated' and public.is_admin());
create policy admin_catalog_tee_classification_events_admin_read on public.admin_catalog_tee_classification_events for select to authenticated
  using(auth.uid() is not null and auth.role()='authenticated' and public.is_admin());

create function public.admin_catalog_tee_classification_detail(p_club_id uuid,p_entity_type text,p_tee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare saved public.admin_catalog_tee_classifications; context jsonb; state text; history jsonb;
begin
  perform public.admin_catalog_require_admin();
  select * into saved from public.admin_catalog_tee_classifications where entity_type=p_entity_type and live_tee_id=p_tee_id and club_id=p_club_id;
  -- A removed configuration makes a derived classification obsolete, not unreadable.
  begin context:=public.admin_catalog_tee_classification_context(p_club_id,p_entity_type,p_tee_id,saved.configuration_id);
  exception when sqlstate '22023' then
    if saved.id is null then raise; end if;
    context:=public.admin_catalog_tee_classification_context(p_club_id,p_entity_type,p_tee_id,null);
  end;
  if context->>'exists'='false' and saved.id is null then raise exception 'Tee outside club or missing' using errcode='22023'; end if;
  state:=case when context->>'exists'='false' then 'target_missing' when saved.id is null then 'unclassified'
    when saved.baseline is distinct from context->'baseline' then 'obsolete' else 'current' end;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'revision',e.revision,'operation',e.operation,
    'before',e.before_values,'after',e.after_values,'occurred_at',e.occurred_at,
    'actor_current_admin',e.actor_id=auth.uid()) order by e.revision desc),'[]') into history
    from public.admin_catalog_tee_classification_events e where e.classification_id=saved.id;
  return jsonb_build_object('contract_version',1,'entity_type',p_entity_type,'tee_id',p_tee_id,'club_id',p_club_id,
    'exists',context->'exists','tee',context->'tee','parent',context->'parent','state',state,
    'classification',case when saved.id is null then null else public.admin_catalog_tee_classification_values(saved) end,
    'effective_attestation',case when state='current' then saved.attestation else 'sconosciuto' end,
    'effective_behavior',case when state='current' then saved.par_behavior else 'sconosciuto' end,
    'revision',coalesce(saved.revision,0),'baseline',context->'baseline','recorded_baseline',saved.baseline,
    'configurations',coalesce(context->'configurations','[]'),'history',history);
end $$;

create function public.admin_catalog_tee_classification_list(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare target record; d jsonb; items jsonb:='[]'; club_name text;
begin
  perform public.admin_catalog_require_admin();
  select name into club_name from public.clubs where id=p_club_id;
  if not found then raise exception 'Existing club required' using errcode='22023'; end if;
  for target in
    select 'route_tee'::text kind,t.id from public.route_tees t join public.course_routes r on r.id=t.route_id where r.club_id=p_club_id
    union select 'combination_tee',t.id from public.combination_tees t join public.route_combinations r on r.id=t.route_combination_id where r.club_id=p_club_id
    union select c.entity_type,c.live_tee_id from public.admin_catalog_tee_classifications c where c.club_id=p_club_id
    order by 1,2
  loop
    d:=public.admin_catalog_tee_classification_detail(p_club_id,target.kind,target.id);
    items:=items||jsonb_build_array(jsonb_build_object('entity_type',target.kind,'tee_id',target.id,'tee_name',d#>>'{tee,name}',
      'tee_color',d#>>'{tee,color}','parent_name',d#>>'{parent,name}','holes_count',d#>'{tee,holes_count}',
      'declared_holes_count',d#>'{classification,declared_holes_count}','par_total',d#>'{tee,par_total}',
      'attestation',d->>'effective_attestation','par_behavior',d->>'effective_behavior','state',d->>'state','revision',d->'revision'));
  end loop;
  return jsonb_build_object('contract_version',1,'club',jsonb_build_object('id',p_club_id,'name',club_name),'items',items);
end $$;

create function public.admin_catalog_tee_classification_preview(p_club_id uuid,p_entity_type text,p_tee_id uuid,p_decision jsonb,p_expected_revision bigint)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare context jsonb; decision jsonb; saved public.admin_catalog_tee_classifications;
begin
  perform public.admin_catalog_require_admin();
  context:=public.admin_catalog_tee_classification_context(p_club_id,p_entity_type,p_tee_id,(p_decision->>'configuration_id')::uuid);
  decision:=public.admin_catalog_tee_classification_validate(p_decision,context);
  select * into saved from public.admin_catalog_tee_classifications where entity_type=p_entity_type and live_tee_id=p_tee_id;
  if p_expected_revision is null or p_expected_revision<>coalesce(saved.revision,0) or (saved.id is not null and saved.club_id<>p_club_id) then
    raise exception 'Classification changed; reload before preview' using errcode='40001'; end if;
  return jsonb_build_object('contract_version',1,'club_id',p_club_id,'entity_type',p_entity_type,'tee_id',p_tee_id,
    'revision',coalesce(saved.revision,0),'before',case when saved.id is null then null else public.admin_catalog_tee_classification_values(saved) end,
    'decision',decision,'baseline',context->'baseline','tee',context->'tee','parent',context->'parent','configuration',context->'configuration');
end $$;

create function public.admin_catalog_tee_classification_confirm(p_club_id uuid,p_entity_type text,p_tee_id uuid,
  p_decision jsonb,p_expected_revision bigint,p_expected_baseline jsonb,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; preview jsonb; saved public.admin_catalog_tee_classifications; decision jsonb;
begin
  actor:=public.admin_catalog_require_admin();
  if p_confirm is distinct from true then raise exception 'Explicit manual confirmation required' using errcode='22023'; end if;
  perform public.admin_catalog_structure_club_lock(p_club_id);
  -- Also cover writers that do not use the club lock: live editors/import and
  -- foundation/tee inserts (phantoms). Read locks NEVER write the catalog.
  lock table public.route_tees,public.combination_tees,public.course_routes,public.route_combinations,
    public.route_holes,public.route_combination_holes,public.admin_catalog_physical_structures,
    public.admin_catalog_physical_holes,public.admin_catalog_physical_course_links,
    public.admin_catalog_playable_configurations,public.admin_catalog_configuration_holes,
    public.admin_catalog_configuration_components,public.admin_catalog_tee_overrides in share mode nowait;
  select * into saved from public.admin_catalog_tee_classifications where entity_type=p_entity_type and live_tee_id=p_tee_id for update nowait;
  preview:=public.admin_catalog_tee_classification_preview(p_club_id,p_entity_type,p_tee_id,p_decision,p_expected_revision);
  if p_expected_baseline is null or p_expected_baseline is distinct from preview->'baseline' then
    raise exception 'Tee, grid, source or configuration changed since preview' using errcode='40001'; end if;
  decision:=preview->'decision';
  if saved.id is null then
    insert into public.admin_catalog_tee_classifications(club_id,entity_type,live_tee_id,attestation,par_behavior,provenance,evidence,note,
      configuration_id,derivation_rule,declared_holes_count,declared_applicability,baseline,revision,created_by,updated_by,created_at,updated_at)
    values(p_club_id,p_entity_type,p_tee_id,decision->>'attestation',decision->>'par_behavior',decision->>'provenance',decision->'evidence',decision->>'note',
      (decision->>'configuration_id')::uuid,decision->>'derivation_rule',(decision->>'declared_holes_count')::integer,decision->>'declared_applicability',
      preview->'baseline',1,actor,actor,clock_timestamp(),clock_timestamp());
  else
    update public.admin_catalog_tee_classifications set attestation=decision->>'attestation',par_behavior=decision->>'par_behavior',
      provenance=decision->>'provenance',evidence=decision->'evidence',note=decision->>'note',configuration_id=(decision->>'configuration_id')::uuid,
      derivation_rule=decision->>'derivation_rule',declared_holes_count=(decision->>'declared_holes_count')::integer,
      declared_applicability=decision->>'declared_applicability',baseline=preview->'baseline' where id=saved.id;
  end if;
  return public.admin_catalog_tee_classification_detail(p_club_id,p_entity_type,p_tee_id);
end $$;

-- Only four guarded endpoints. Helpers/triggers are private even to Admin APIs.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'admin_catalog_tee_classification_%'
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature); end loop;
end $$;
grant execute on function public.admin_catalog_tee_classification_list(uuid) to authenticated;
grant execute on function public.admin_catalog_tee_classification_detail(uuid,text,uuid) to authenticated;
grant execute on function public.admin_catalog_tee_classification_preview(uuid,text,uuid,jsonb,bigint) to authenticated;
grant execute on function public.admin_catalog_tee_classification_confirm(uuid,text,uuid,jsonb,bigint,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
