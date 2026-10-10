-- Incremental repair AFTER admin-catalog-physical-par.sql. Apply ONCE.
-- No data DML/backfill. Original publisher migration remains unchanged.
begin;

create function public.admin_catalog_par_overlapping_drafts(p_club_id uuid,p_configurations jsonb,p_rows jsonb,p_tees jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare d public.admin_catalog_drafts; requested jsonb; current_values jsonb; base_values jsonb; changed boolean; result jsonb:='[]';
begin
  perform public.admin_catalog_require_admin();
  for d in select * from public.admin_catalog_drafts where workflow_status='draft' and (
    (entity_type in ('route','course','route_holes_grid') and live_entity_id::text in (select x->>'course_id' from jsonb_array_elements(p_configurations) x))
    or (entity_type in ('route_combination','combination_holes_grid') and live_entity_id::text in (select x->>'combination_id' from jsonb_array_elements(p_configurations) x))
    or (entity_type='hole' and live_entity_id::text in (select x->>'id' from jsonb_array_elements(p_rows) x where x->>'kind'='course_hole'))
    or (entity_type='combination_hole' and live_entity_id::text in (select x->>'id' from jsonb_array_elements(p_rows) x where x->>'kind'='combination_hole'))
    or (entity_type in ('route_tee','combination_tee') and exists(select 1 from jsonb_array_elements(p_tees) x where x->>'entity_type'=entity_type and x->>'tee_id'=live_entity_id::text))
  ) order by draft_id loop
    requested:=null;current_values:=null;base_values:=null;changed:=true;
    begin
      case d.entity_type
        when 'route' then
          requested:=public.admin_course_validate_snapshot(d.snapshot);
          select jsonb_build_object('name',btrim(c.name),'holes_count',c.holes_count,'display_order',c.display_order,'is_active',c.is_active) into current_values from public.course_routes c where c.id=d.live_entity_id and c.club_id=p_club_id;
        when 'route_combination' then
          requested:=public.admin_route_validate_snapshot(d.snapshot);
          select jsonb_build_object('name',btrim(c.name),'is_active',c.is_active) into current_values from public.route_combinations c where c.id=d.live_entity_id and c.club_id=p_club_id;
        when 'route_tee' then
          requested:=public.admin_course_tee_validate_snapshot(d.snapshot);
          select jsonb_build_object('course_rating',t.course_rating,'slope_rating',t.slope_rating,'is_active',t.is_active) into current_values from public.route_tees t join public.course_routes c on c.id=t.route_id where t.id=d.live_entity_id and c.club_id=p_club_id;
        when 'route_holes_grid' then
          requested:=public.admin_course_hole_grid_validate_snapshot(d.snapshot,d.base_snapshot);
          select jsonb_build_object('holes',coalesce(jsonb_agg(jsonb_build_object('id',h.id,'physical_hole_number',h.physical_hole_number,'par',h.par,'stroke_index',h.stroke_index) order by h.id::text),'[]')) into current_values from public.route_holes h join public.course_routes c on c.id=h.route_id where c.id=d.live_entity_id and c.club_id=p_club_id;
          requested:=jsonb_build_object('holes',(select jsonb_agg(x order by x->>'id') from jsonb_array_elements(requested->'holes') x));
        when 'combination_holes_grid' then
          requested:=public.admin_hole_grid_validate_snapshot(d.snapshot,d.base_snapshot);
          select jsonb_build_object('holes',coalesce(jsonb_agg(jsonb_build_object('id',h.id,'round_hole_number',h.round_hole_number,'par',h.par,'stroke_index',h.stroke_index) order by h.id::text),'[]')) into current_values from public.route_combination_holes h join public.route_combinations c on c.id=h.route_combination_id where c.id=d.live_entity_id and c.club_id=p_club_id;
          requested:=jsonb_build_object('holes',(select jsonb_agg(x order by x->>'id') from jsonb_array_elements(requested->'holes') x));
        else
          -- No safe editor comparison contract yet: an overlapping unsupported
          -- draft is NOT assumed unchanged. Do not read/echo arbitrary payloads.
          requested:=null;
      end case;
      -- An untouched draft is not an intention to reverse subsequent live
      -- publications. Compare editable fields with its immutable original base
      -- as well as current live, ignoring context/timestamps. Never rebase it.
      if requested is not null and d.base_snapshot is not null then
        base_values:=d.base_snapshot-array['_context','_si_sequence'];
        if d.entity_type in ('route_holes_grid','combination_holes_grid') then
          base_values:=jsonb_build_object('holes',(select jsonb_agg(x order by x->>'id') from jsonb_array_elements(base_values->'holes') x));
        elsif d.entity_type='route' then base_values:=public.admin_course_validate_snapshot(base_values);
        elsif d.entity_type='route_combination' then base_values:=public.admin_route_validate_snapshot(base_values);
        elsif d.entity_type='route_tee' then base_values:=public.admin_course_tee_validate_snapshot(base_values);end if;
      end if;
      changed:=requested is null or current_values is null or (requested is distinct from current_values and (base_values is null or requested is distinct from base_values));
    exception when invalid_parameter_value or check_violation or invalid_text_representation or numeric_value_out_of_range then
      changed:=true; -- malformed overlapping draft fails closed
    end;
    if changed then result:=result||jsonb_build_array(jsonb_build_object('draft_id',d.draft_id,'entity_type',d.entity_type,'live_entity_id',d.live_entity_id,'revision',d.revision));end if;
  end loop;
  return result;
end $$;
revoke all on function public.admin_catalog_par_overlapping_drafts(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Retain the old fingerprint algorithm privately to recognise an existing
-- draft only when its ORIGINAL entire baseline still matches exactly. This is
-- compatibility, not an implicit rebase or a migration-time update of drafts.
alter function public.admin_catalog_par_plan(uuid,integer,uuid) rename to admin_catalog_par_plan_legacy;
revoke all on function public.admin_catalog_par_plan_legacy(uuid,integer,uuid) from public,anon,authenticated,service_role;

-- SQL NULL is not a model: a verified autonomous source without a registration
-- discriminator still needs the same exact source checks and total update.
-- Keep every other classification, grid and source-baseline check unchanged.
do $$ declare body text; needle text:=$n$(cfg->>'registration_kind'<>'multi9_18' or jsonb_array_length(components)=2)$n$;begin
  select pg_get_functiondef('public.admin_catalog_tee_classification_context(uuid,text,uuid,uuid)'::regprocedure) into body;
  if strpos(body,needle)=0 then raise exception 'Unsupported tee context definition';end if;
  execute replace(body,needle,$n$(coalesce(cfg->>'registration_kind','')<>'multi9_18' or jsonb_array_length(components)=2)$n$);
end $$;

create or replace function public.admin_catalog_par_graph_check(p_g jsonb)
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
        if live is null or (coalesce(c->>'registration_kind','')<>'repeated_18' and live->>'physical_hole_number'<>h->>'position')
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
    if coalesce(c->>'registration_kind','')<>'repeated_18' then
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

create or replace function public.admin_catalog_par_plan(p_physical_hole_id uuid,p_new_par integer,p_draft_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
#variable_conflict use_column
declare ph public.admin_catalog_physical_holes; g jsonb; c jsonb; t record; s public.admin_catalog_tee_classifications;
  ctx jsonb; changes jsonb:='[]'; exclusions jsonb:='[]'; tees jsonb:='[]'; rows_changed jsonb:='[]'; why text[];
  before_total integer; delta integer; total integer; scope integer; ids uuid[]; origin_hash text; source_hash text; classifications_hash text; draft_hash text; draft_conflicts jsonb;
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
    -- Target identity and the draft baseline must not depend on the proposed
    -- Par. Even before an edit, capture all inheriting occurrences of this hole.
    if exists(select 1 from jsonb_array_elements(g->'configuration_holes') h where h->>'configuration_id'=c->>'id' and h->>'physical_hole_id'=ph.id::text and h->>'par_mode'='inherited') then
      changes:=changes||jsonb_build_array(jsonb_build_object('id',c->>'id','label',c->>'label','holes_count',c->'holes_count',
        'before_total',before_total,'after_total',before_total+delta,'course_id',c->'legacy_course_route_id','combination_id',c->'legacy_combination_id',
        'registration_kind',c->'registration_kind','impact_role',case when c->>'relationship_kind'='autonomous'
          and c->>'legacy_course_route_id'=(select l->>'course_id' from jsonb_array_elements(g->'physical_links') l where l->>'id'=ph.source_course_link_id::text)
          and c->>'holes_count'=(select l->>'holes_count' from jsonb_array_elements(g->'physical_links') l where l->>'id'=ph.source_course_link_id::text)
          then 'physical_base' else 'propagated' end,
        'occurrences',(select jsonb_agg(jsonb_build_object('position',h->'position','occurrence',h->'occurrence')) from jsonb_array_elements(g->'configuration_holes') h where h->>'configuration_id'=c->>'id' and h->>'physical_hole_id'=ph.id::text and h->>'par_mode'='inherited')));
    end if;
    exclusions:=exclusions||coalesce((select jsonb_agg(jsonb_build_object('configuration_label',c->>'label','position',h->'position','par_override',h->'par_override')) from jsonb_array_elements(g->'configuration_holes') h where h->>'configuration_id'=c->>'id' and h->>'physical_hole_id'=ph.id::text and h->>'par_mode'='override'),'[]');
  end loop;
  if jsonb_array_length(changes)=0 then why:=array_append(why,'no_verified_inherited_configuration');end if;
  if not exists(select 1 from jsonb_array_elements(changes) c where c->>'impact_role'='physical_base') then
    why:=array_append(why,'physical_source_configuration_missing');end if;
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
  -- Compare only explicit editable fields with CURRENT live values. Mere draft
  -- existence, stale base timestamps and unrelated targets are not conflicts.
  draft_conflicts:=public.admin_catalog_par_overlapping_drafts(ph.club_id,changes,rows_changed,tees);
  if jsonb_array_length(draft_conflicts)>0 then why:=array_append(why,'overlapping_live_draft');end if;
  if exists(select 1 from public.admin_catalog_par_drafts d where d.club_id=ph.club_id and d.status in ('draft','publishing') and d.id is distinct from p_draft_id) then why:=array_append(why,'overlapping_physical_par_draft');end if;
  origin_hash:=public.admin_catalog_par_hash(g-array['read_at','publication','drafts']);
  select public.admin_catalog_par_hash(coalesce(jsonb_agg(jsonb_build_array(c.id,c.revision,c.baseline) order by c.id),'[]')) into classifications_hash from public.admin_catalog_tee_classifications c where c.club_id=ph.club_id;
  draft_hash:=public.admin_catalog_par_hash(draft_conflicts);
  select public.admin_catalog_par_hash(jsonb_build_array(
    (select jsonb_agg(jsonb_build_array(r.id,r.source_system,r.source_external_id,r.source_payload) order by r.id) from public.course_routes r where r.club_id=ph.club_id),
    (select jsonb_agg(jsonb_build_array(r.id,r.source_system,r.source_external_id,r.source_payload) order by r.id) from public.route_combinations r where r.club_id=ph.club_id),
    (select jsonb_agg(jsonb_build_array(lt.id,lt.source_payload) order by lt.id) from public.route_tees lt join public.course_routes r on r.id=lt.route_id where r.club_id=ph.club_id),
    (select jsonb_agg(jsonb_build_array(lt.id,lt.source_payload) order by lt.id) from public.combination_tees lt join public.route_combinations r on r.id=lt.route_combination_id where r.club_id=ph.club_id))) into source_hash;
  return jsonb_build_object('club_id',ph.club_id,'physical_hole',jsonb_build_object('id',ph.id,'number',ph.physical_number,'label',ph.label,'revision',ph.revision,'before',ph.base_par,'after',p_new_par,
    'course_name',(select r.name from public.course_routes r join public.admin_catalog_physical_course_links l on l.course_id=r.id where l.id=ph.source_course_link_id)),
    'configurations',changes,'live_rows',rows_changed,'tees',tees,'overrides_excluded',exclusions,
    'blockers',to_jsonb(array(select distinct x from unnest(why) x order by x)),'can_publish',cardinality(why)=0,
    'baseline_hash',public.admin_catalog_par_hash(jsonb_build_array(origin_hash,classifications_hash,draft_hash,source_hash)),
    'legacy_baseline_hash',public.admin_catalog_par_plan_legacy(p_physical_hole_id,p_new_par,p_draft_id)->>'baseline_hash');
end $$;

create or replace function public.admin_catalog_par_publish(p_draft_id uuid,p_revision bigint,p_expected_hash text,p_note text,p_confirm boolean default false)
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
  if p_expected_hash is null or (d.base_hash is distinct from p->>'baseline_hash' and d.base_hash is distinct from p->>'legacy_baseline_hash') or p_expected_hash is distinct from p->>'baseline_hash' then raise exception 'Impact/source/classification/draft base changed' using errcode='40001';end if;
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
    if x->>'course_id' is not null and coalesce(x->>'registration_kind','')<>'repeated_18' then
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

create or replace function public.admin_catalog_par_open(p_physical_hole_id uuid)
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
  return p||jsonb_build_object('draft',jsonb_build_object('id',d.id,'revision',d.revision,'par',d.new_par,'status',d.status),'base_changed',(d.base_hash is distinct from p->>'baseline_hash' and d.base_hash is distinct from p->>'legacy_baseline_hash'));
end $$;

create or replace function public.admin_catalog_par_save(p_draft_id uuid,p_revision bigint,p_new_par integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d public.admin_catalog_par_drafts;p jsonb;
begin
  perform public.admin_catalog_require_admin();select * into d from public.admin_catalog_par_drafts where id=p_draft_id and actor_id=auth.uid() and status='draft';
  if not found then raise exception 'Own active draft required' using errcode='42501';end if;
  perform public.admin_catalog_par_lock(d.club_id);
  select * into d from public.admin_catalog_par_drafts where id=p_draft_id for update nowait;
  if p_revision is null or d.revision<>p_revision or d.status<>'draft' then raise exception 'Draft revision changed' using errcode='40001';end if;
  p:=public.admin_catalog_par_plan(d.physical_hole_id,p_new_par,d.id);
  if (d.base_hash is distinct from p->>'baseline_hash' and d.base_hash is distinct from p->>'legacy_baseline_hash') then raise exception 'Publication base changed: do not rebase implicitly' using errcode='40001';end if;
  -- An explicit save may canonicalise an old-format hash ONLY after the exact
  -- legacy baseline passed above. No changed source is adopted or rebased.
  update public.admin_catalog_par_drafts set new_par=p_new_par,base_hash=p->>'baseline_hash',revision=revision+1,updated_at=clock_timestamp() where id=d.id returning * into d;
  return p||jsonb_build_object('draft',jsonb_build_object('id',d.id,'revision',d.revision,'par',d.new_par,'status',d.status),'base_changed',false);
end $$;

-- CREATE OR REPLACE keeps existing RPC grants; explicitly close private helpers.
revoke all on function public.admin_catalog_par_graph_check(jsonb),public.admin_catalog_par_plan(uuid,integer,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_par_publish(uuid,bigint,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_catalog_par_publish(uuid,bigint,text,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;

