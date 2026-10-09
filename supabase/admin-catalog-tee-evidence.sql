-- Tee source archive v1. Apply ONCE, all at once. No backfill or live linkage.
-- Stage/confirm are server-only. Admin browser JWTs can read minimized RPCs, NEVER raw files.
begin;
do $$ begin
  if to_regprocedure('public.admin_catalog_require_admin()') is null
    or to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise exception 'Admin workflow and Supabase Storage are required';
  end if;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('admin-catalog-evidence','admin-catalog-evidence',false,16777216,array['application/json']);

create table public.admin_catalog_tee_source_artifacts (
  id uuid primary key default gen_random_uuid(),
  source_system text not null check(source_system='fig'),
  source_url text not null check(length(source_url) between 1 and 500),
  source_version text check(length(source_version)<=100),
  acquired_at timestamptz,
  published_at timestamptz,
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer not null check(byte_size between 1 and 16777216),
  object_path text not null check(object_path='fig/'||sha256||'.json'),
  extractor_version text not null check(extractor_version='fig-raw-tee-evidence/1.0.0'),
  manifest_hash text not null check(manifest_hash ~ '^[a-f0-9]{64}$'),
  extraction_manifest jsonb not null,
  prepared_by uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(sha256,extractor_version)
);
create table public.admin_catalog_tee_source_evidence (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.admin_catalog_tee_source_artifacts(id) on delete restrict,
  internal_reference text not null check(length(internal_reference) between 1 and 200),
  observation_id text not null check(observation_id=internal_reference),
  external_tee_id text check(length(external_tee_id)<=300),
  external_configuration_id text check(length(external_configuration_id)<=300),
  synthetic_tee_id text check(length(synthetic_tee_id)<=300),
  club_label text not null check(length(club_label)<=300),
  configuration_label text not null check(length(configuration_label)<=300),
  tee_label text not null check(length(tee_label)<=300),
  par_original text check(length(par_original)<=100),
  par_normalized integer check(par_normalized>0),
  par_state text not null check(par_state in ('esplicito','inferito','assente')),
  scope_original text check(length(scope_original)<=300),
  scope_normalized integer check(scope_normalized in (9,18)),
  scope_state text not null check(scope_state in ('esplicito','inferito','assente')),
  applicability_original text check(length(applicability_original)<=100),
  applicability_normalized text check(applicability_normalized in ('men','women','mixed')),
  applicability_state text not null check(applicability_state in ('esplicito','inferito','assente')),
  par_origin text check(par_origin in ('dichiarato','comune_configurazione','fallback')),
  completeness text not null check(completeness in ('complete','incomplete')),
  certainty text not null check(certainty in ('documented','limited','ambiguous')),
  limitations text[] not null,
  transformations text[] not null,
  predecessor_id uuid references public.admin_catalog_tee_source_evidence(id) on delete restrict,
  recorded_by uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(artifact_id,internal_reference),
  check(par_state<>'assente' or (par_original is null and par_normalized is null and par_origin is null)),
  check(scope_state<>'assente' or scope_normalized is null),
  check(applicability_state<>'assente' or (applicability_original is null and applicability_normalized is null)),
  check(completeness<>'complete' or (external_tee_id is not null and external_configuration_id is not null
    and par_normalized is not null and scope_normalized is not null and applicability_normalized is not null
    and par_state='esplicito' and scope_state='esplicito' and applicability_state='esplicito'))
);
create table public.admin_catalog_tee_evidence_batches (
  id uuid primary key default gen_random_uuid(),
  record_kind text not null check(record_kind in ('staged','receipt')),
  proposal_id uuid references public.admin_catalog_tee_evidence_batches(id) on delete restrict,
  artifact_id uuid not null references public.admin_catalog_tee_source_artifacts(id) on delete restrict,
  manifest_hash text not null check(manifest_hash ~ '^[a-f0-9]{64}$'),
  note text not null check(length(btrim(note)) between 1 and 2000),
  total_count integer not null check(total_count between 1 and 10000),
  inserted_count integer not null check(inserted_count>=0),
  existing_count integer not null check(existing_count>=0),
  incomplete_count integer not null check(incomplete_count>=0),
  excluded_count integer not null check(excluded_count>=0),
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default clock_timestamp(),
  unique(proposal_id),
  check((record_kind='staged' and proposal_id is null) or (record_kind='receipt' and proposal_id is not null)),
  check(total_count=inserted_count+existing_count+excluded_count),
  check(incomplete_count<=inserted_count+existing_count)
);
create unique index admin_catalog_tee_evidence_approval_identity on public.admin_catalog_tee_evidence_batches(manifest_hash)
where record_kind='staged';
create table public.admin_catalog_tee_evidence_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.admin_catalog_tee_evidence_batches(id) on delete restrict,
  observation_id text not null check(length(observation_id) between 1 and 200),
  evidence_id uuid references public.admin_catalog_tee_source_evidence(id) on delete restrict,
  outcome text not null check(outcome in ('inserted','existing','excluded')),
  reason text not null check(length(reason) between 1 and 200),
  unique(batch_id,observation_id),
  check((outcome='excluded')=(evidence_id is null))
);

-- No direct table access, including service_role (BYPASSRLS does not bypass ACLs).
do $$ declare t text; begin
  foreach t in array array['admin_catalog_tee_source_artifacts','admin_catalog_tee_source_evidence',
    'admin_catalog_tee_evidence_batches','admin_catalog_tee_evidence_batch_items'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('create policy %I on public.%I for select to authenticated using(auth.uid() is not null and auth.role()=''authenticated'' and public.is_admin())',t||'_admin_read',t);
  end loop;
end $$;

create function public.admin_catalog_tee_evidence_immutable()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'Source archive is append-only' using errcode='55000'; end $$;
do $$ declare t text; begin
  foreach t in array array['admin_catalog_tee_source_artifacts','admin_catalog_tee_source_evidence',
    'admin_catalog_tee_evidence_batches','admin_catalog_tee_evidence_batch_items'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.admin_catalog_tee_evidence_immutable()',t||'_immutable',t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.admin_catalog_tee_evidence_immutable()',t||'_no_truncate',t);
  end loop;
end $$;

-- Restrictive guards protect the new bucket even if another permissive Storage policy is broad.
create policy admin_catalog_evidence_read_guard on storage.objects as restrictive for select to anon,authenticated
using(bucket_id<>'admin-catalog-evidence');
create policy admin_catalog_evidence_insert_guard on storage.objects as restrictive for insert to anon,authenticated
with check(bucket_id<>'admin-catalog-evidence');
create policy admin_catalog_evidence_update_guard on storage.objects as restrictive for update to anon,authenticated
using(bucket_id<>'admin-catalog-evidence') with check(bucket_id<>'admin-catalog-evidence');
create policy admin_catalog_evidence_delete_guard on storage.objects as restrictive for delete to anon,authenticated
using(bucket_id<>'admin-catalog-evidence');

-- Storage may finish upload metadata before staging. Once registered, even the trusted process
-- cannot replace/move/delete the object. Never edit bytes behind a registered hash.
create function public.admin_catalog_tee_evidence_storage_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_table_name='buckets' then
    if old.id='admin-catalog-evidence' then
      raise exception 'Private evidence bucket configuration is immutable' using errcode='55000';
    end if;
  elsif old.bucket_id='admin-catalog-evidence' and exists(
    select 1 from public.admin_catalog_tee_source_artifacts where object_path=old.name) then
    raise exception 'Registered evidence object is immutable' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger admin_catalog_evidence_bucket_immutable before update or delete on storage.buckets
for each row execute function public.admin_catalog_tee_evidence_storage_guard();
create trigger admin_catalog_evidence_object_immutable before update or delete on storage.objects
for each row execute function public.admin_catalog_tee_evidence_storage_guard();

create function public.admin_catalog_tee_evidence_validate(p jsonb)
returns void language plpgsql immutable security definer set search_path=pg_catalog as $$
declare a jsonb; i jsonb; e jsonb; k text;
begin
  if p is null or jsonb_typeof(p)<>'object' or not p ?& array['contract_version','extractor_version','artifact','items']
    or (p-array['contract_version','extractor_version','artifact','items'])<>'{}'::jsonb
    or p->>'contract_version'<>'1' or p->>'extractor_version'<>'fig-raw-tee-evidence/1.0.0'
    or octet_length(p::text)>12582912 or jsonb_typeof(p->'items')<>'array' then
    raise exception 'Unsupported archival manifest' using errcode='22023'; end if;
  if jsonb_array_length(p->'items') not between 1 and 10000 then raise exception 'Batch size out of bounds' using errcode='22023'; end if;
  a:=p->'artifact';
  if jsonb_typeof(a)<>'object' or not a ?& array['source_system','source_url','source_version','acquired_at','published_at','sha256','byte_size','object_path','content_type']
    or (a-array['source_system','source_url','source_version','acquired_at','published_at','sha256','byte_size','object_path','content_type'])<>'{}'::jsonb
    or a->>'source_system'<>'fig' or a->>'content_type'<>'application/json'
    or a->>'source_url' !~ '^https://([a-zA-Z0-9-]+\.)*federgolf\.it/[^?#]*$'
    or length(a->>'source_url')>500 or a->>'sha256' !~ '^[a-f0-9]{64}$'
    or a->>'object_path' is distinct from 'fig/'||(a->>'sha256')||'.json'
    or jsonb_typeof(a->'byte_size')<>'number' or (a->>'byte_size')::integer not between 1 and 16777216 then
    raise exception 'Invalid artifact metadata' using errcode='22023'; end if;
  foreach k in array array['source_system','source_url','sha256','object_path','content_type'] loop
    if jsonb_typeof(a->k) is distinct from 'string' then raise exception 'Artifact scalar required' using errcode='22023'; end if;
  end loop;
  foreach k in array array['source_version','acquired_at','published_at'] loop
    if jsonb_typeof(a->k) not in ('string','null') or length(a->>k)>100 then
      raise exception 'Invalid artifact date/version' using errcode='22023'; end if;
  end loop;
  if a->'published_at'<>'null'::jsonb then raise exception 'FIG raw does not attest publication date' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p->'items') x group by x->>'observation_id' having count(*)>1) then
    raise exception 'Duplicate observation locator' using errcode='23505'; end if;
  for i in select value from jsonb_array_elements(p->'items') loop
    if jsonb_typeof(i)<>'object' or not i ?& array['observation_id','outcome','reason','evidence']
      or (i-array['observation_id','outcome','reason','evidence'])<>'{}'::jsonb
      or i->>'observation_id' !~ '^table:[0-9]+/row:[0-9]+/tee-column:[0-9]+$'
      or i->>'outcome' not in ('complete','incomplete','excluded') then
      raise exception 'Invalid observation' using errcode='22023'; end if;
    foreach k in array array['observation_id','outcome','reason'] loop
      if jsonb_typeof(i->k) is distinct from 'string' or length(i->>k)>200 then
        raise exception 'Observation scalar required' using errcode='22023'; end if;
    end loop;
    if i->>'outcome'='excluded' then
      if i->'evidence'<>'null'::jsonb or i->>'reason' not in ('unsupported_header_layout','invalid_row_shape','invalid_cell_shape') then
        raise exception 'Invalid exclusion' using errcode='22023'; end if;
      continue;
    end if;
    e:=i->'evidence';
    if jsonb_typeof(e)<>'object' or not e ?& array['internal_reference','external_tee_id','external_configuration_id','synthetic_tee_id',
      'club_label','configuration_label','tee_label','par_original','par_normalized','par_state','scope_original','scope_normalized','scope_state',
      'applicability_original','applicability_normalized','applicability_state','par_origin','completeness','certainty','limitations','transformations','predecessor_id']
      or (e-array['internal_reference','external_tee_id','external_configuration_id','synthetic_tee_id','club_label','configuration_label','tee_label',
      'par_original','par_normalized','par_state','scope_original','scope_normalized','scope_state','applicability_original','applicability_normalized',
      'applicability_state','par_origin','completeness','certainty','limitations','transformations','predecessor_id'])<>'{}'::jsonb then
      raise exception 'Evidence allowlist required' using errcode='22023'; end if;
    -- v1 raw FIG lost header spans/native IDs: cannot assert complete tee-specific proof.
    if e->>'internal_reference' is distinct from i->>'observation_id' or i->>'outcome'<>'incomplete'
      or e->>'completeness'<>'incomplete' or e->>'certainty'<>'limited' or i->>'reason'<>'incomplete_source_evidence'
      or e->'external_tee_id'<>'null'::jsonb or e->'external_configuration_id'<>'null'::jsonb
      or e->'synthetic_tee_id'<>'null'::jsonb or e->'predecessor_id'<>'null'::jsonb
      or e->'applicability_original'<>'null'::jsonb or e->'applicability_normalized'<>'null'::jsonb or e->>'applicability_state'<>'assente'
      or (e->'par_normalized'<>'null'::jsonb and (jsonb_typeof(e->'par_normalized')<>'number' or e->>'par_origin'<>'comune_configurazione'))
      or (e->'scope_normalized'<>'null'::jsonb and (jsonb_typeof(e->'scope_normalized')<>'number' or e->>'scope_state'<>'esplicito')) then
      raise exception 'Extractor v1 cannot promote incomplete source evidence' using errcode='22023'; end if;
    foreach k in array array['club_label','configuration_label','tee_label'] loop
      if jsonb_typeof(e->k)<>'string' or length(e->>k)>300 then raise exception 'Invalid source label' using errcode='22023'; end if;
    end loop;
    foreach k in array array['par_original','scope_original','applicability_original'] loop
      if jsonb_typeof(e->k) not in ('string','null') or length(e->>k)>(case when k='scope_original' then 300 else 100 end) then
        raise exception 'Original source scalar required' using errcode='22023'; end if;
    end loop;
    foreach k in array array['par_state','scope_state','applicability_state'] loop
      if jsonb_typeof(e->k) is distinct from 'string' or e->>k not in ('esplicito','inferito','assente') then
        raise exception 'Invalid source value state' using errcode='22023'; end if;
    end loop;
    if e->'par_normalized'<>'null'::jsonb and (e->>'par_normalized' !~ '^[0-9]+$' or (e->>'par_normalized')::integer<=0) then
      raise exception 'Invalid normalized Par' using errcode='22023'; end if;
    if e->'scope_normalized'<>'null'::jsonb and e->>'scope_normalized' not in ('9','18') then
      raise exception 'Invalid normalized scope' using errcode='22023'; end if;
    if (e->>'par_state'='assente' and (e->'par_original'<>'null'::jsonb or e->'par_normalized'<>'null'::jsonb or e->'par_origin'<>'null'::jsonb))
      or (e->>'scope_state'='assente' and e->'scope_normalized'<>'null'::jsonb)
      or (e->'par_origin'<>'null'::jsonb and (jsonb_typeof(e->'par_origin')<>'string' or e->>'par_origin'<>'comune_configurazione')) then
      raise exception 'Inconsistent source value/origin' using errcode='22023'; end if;
    foreach k in array array['limitations','transformations'] loop
      if jsonb_typeof(e->k)<>'array' or jsonb_array_length(e->k)>20 or exists(
        select 1 from jsonb_array_elements(e->k) x where jsonb_typeof(x)<>'string' or length(x#>>'{}')>100) then
        raise exception 'Invalid extraction limits' using errcode='22023'; end if;
    end loop;
    if not e->'limitations' ?& array['native_tee_id_absent','native_configuration_id_absent','applicability_header_spans_unavailable','par_common_configuration'] then
      raise exception 'Known FIG limitations must be retained' using errcode='22023'; end if;
  end loop;
end $$;

-- Receipt projection is allowlisted and shared by first success and an EXACT technical retry.
create function public.admin_catalog_tee_evidence_receipt(p public.admin_catalog_tee_evidence_batches)
returns jsonb language sql immutable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('batch_id',p.id,'total',p.total_count,'inserted',p.inserted_count,
    'existing',p.existing_count,'incomplete',p.incomplete_count,'excluded',p.excluded_count);
$$;

-- ONLY trusted server/service capability. Preparation is append-only; not an approval.
-- The trusted process verifies the operator JWT/Admin BEFORE privileged activity.
create function public.admin_catalog_tee_evidence_stage(p_preparation_text text,p_operator_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare preparation jsonb; p_manifest jsonb; a jsonb; h text; approval_hash text; batch_key uuid;
  saved public.admin_catalog_tee_source_artifacts; proposal public.admin_catalog_tee_evidence_batches;
  total integer; excluded integer; n integer;
begin
  if auth.role() is distinct from 'service_role' or p_operator_id is null or not exists(
    select 1 from public.profiles where id=p_operator_id and role='admin') then
    raise exception 'Protected server and authorized Admin operator required' using errcode='42501'; end if;
  if p_preparation_text is null or octet_length(p_preparation_text)>12582912 then
    raise exception 'Bounded reviewed preparation required' using errcode='22023'; end if;
  preparation:=p_preparation_text::jsonb;
  if jsonb_typeof(preparation)<>'object' or not preparation ?& array['contract_version','batch_id','manifest']
    or (preparation-array['contract_version','batch_id','manifest'])<>'{}'::jsonb
    or preparation->'contract_version' is distinct from '1'::jsonb
    or jsonb_typeof(preparation->'batch_id') is distinct from 'string'
    or preparation->>'batch_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
    raise exception 'Explicit immutable batch identity required' using errcode='22023'; end if;
  batch_key:=(preparation->>'batch_id')::uuid;
  p_manifest:=preparation->'manifest';
  perform public.admin_catalog_tee_evidence_validate(p_manifest); a:=p_manifest->'artifact';
  h:=encode(sha256(convert_to(p_manifest::text,'UTF8')),'hex');
  -- This hash is computed SERVER-side over EXACT reviewed bytes, including batch UUID.
  approval_hash:=encode(sha256(convert_to(p_preparation_text,'UTF8')),'hex');
  if not pg_try_advisory_xact_lock(hashtextextended('tee-batch:'||batch_key::text,0)) then
    raise exception 'Batch preparation is busy' using errcode='55P03'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('tee-source:'||(a->>'sha256'),0)) then
    raise exception 'Artifact is busy' using errcode='55P03'; end if;
  perform 1 from storage.objects where bucket_id='admin-catalog-evidence' and name=a->>'object_path'
    and (metadata->>'size')::bigint=(a->>'byte_size')::bigint for share nowait;
  if not found then raise exception 'Immutable uploaded object required' using errcode='22023'; end if;
  select * into saved from public.admin_catalog_tee_source_artifacts
    where sha256=a->>'sha256' and extractor_version=p_manifest->>'extractor_version';
  if found then
    if saved.manifest_hash<>h then raise exception 'Same extraction identity has different contents' using errcode='40001'; end if;
  else
    insert into public.admin_catalog_tee_source_artifacts(source_system,source_url,source_version,acquired_at,published_at,sha256,byte_size,
      object_path,extractor_version,manifest_hash,extraction_manifest,prepared_by)
    values('fig',a->>'source_url',a->>'source_version',(a->>'acquired_at')::timestamptz,(a->>'published_at')::timestamptz,a->>'sha256',
      (a->>'byte_size')::integer,a->>'object_path',p_manifest->>'extractor_version',h,p_manifest,p_operator_id) returning * into saved;
  end if;
  select * into proposal from public.admin_catalog_tee_evidence_batches where id=batch_key;
  if found then
    if proposal.record_kind<>'staged' or proposal.artifact_id<>saved.id or proposal.manifest_hash<>approval_hash
      or proposal.confirmed_by<>p_operator_id then
      raise exception 'Prepared batch identity cannot be reused or changed' using errcode='40001'; end if;
  else
    select count(*),count(*) filter(where x->>'outcome'='excluded') into total,excluded
      from jsonb_array_elements(p_manifest->'items') x;
    n:=total-excluded;
    -- Staged counts are expectations, not receipts. Stage is never listed as a confirmation.
    insert into public.admin_catalog_tee_evidence_batches(id,record_kind,artifact_id,manifest_hash,note,total_count,
      inserted_count,existing_count,incomplete_count,excluded_count,confirmed_by)
    values(batch_key,'staged',saved.id,approval_hash,'Prepared by protected FIG process; awaiting explicit approval',total,n,0,n,excluded,p_operator_id);
  end if;
  return jsonb_build_object('proposal_id',batch_key,'artifact_id',saved.id,'approval_sha256',approval_hash);
end $$;

create function public.admin_catalog_tee_evidence_preview(p_artifact_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid; a public.admin_catalog_tee_source_artifacts; counts jsonb;
begin
  actor:=public.admin_catalog_require_admin();
  if p_artifact_id is null then return jsonb_build_object('admin_id',actor,'contract_version',1); end if;
  select * into a from public.admin_catalog_tee_source_artifacts where id=p_artifact_id;
  if not found then raise exception 'Artifact not found' using errcode='22023'; end if;
  select jsonb_build_object('total',count(*),'incomplete',count(*) filter(where x->>'outcome'='incomplete'),
    'excluded',count(*) filter(where x->>'outcome'='excluded')) into counts from jsonb_array_elements(a.extraction_manifest->'items') x;
  return jsonb_build_object('artifact_id',a.id,'manifest_hash',a.manifest_hash,'extractor_version',a.extractor_version,
    'counts',counts,'prepared_by_current_admin',a.prepared_by=actor,'already_confirmed',exists(
      select 1 from public.admin_catalog_tee_evidence_batches where artifact_id=a.id and record_kind='receipt'));
end $$;

create function public.admin_catalog_tee_evidence_confirm(p_proposal_id uuid,p_approved_sha256 text,p_operator_id uuid,p_note text,p_confirm boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; a public.admin_catalog_tee_source_artifacts; proposal public.admin_catalog_tee_evidence_batches;
  receipt public.admin_catalog_tee_evidence_batches; b uuid; eid uuid; i jsonb; e jsonb;
  inserted integer:=0; existing integer:=0; incomplete integer:=0; excluded integer:=0; outcome text;
begin
  if auth.role() is distinct from 'service_role' or p_operator_id is null or not exists(
    select 1 from public.profiles where id=p_operator_id and role='admin') then
    raise exception 'Protected server and current Admin operator required' using errcode='42501'; end if;
  actor:=p_operator_id;
  if p_confirm is distinct from true or p_note is null or length(btrim(p_note)) not between 1 and 2000 then
    raise exception 'Explicit confirmation and note required' using errcode='22023'; end if;
  if p_proposal_id is null or p_approved_sha256 is null or p_approved_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Exact proposal and explicit reviewed SHA-256 required' using errcode='22023'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('tee-batch:'||p_proposal_id::text,0)) then
    raise exception 'Batch is busy' using errcode='55P03'; end if;
  select * into proposal from public.admin_catalog_tee_evidence_batches where id=p_proposal_id and record_kind='staged' for share nowait;
  if not found then raise exception 'Prepared batch not found' using errcode='22023'; end if;
  if proposal.confirmed_by<>actor then raise exception 'Only preparing Admin can approve' using errcode='42501'; end if;
  if p_approved_sha256 is distinct from proposal.manifest_hash then raise exception 'Approval does not match prepared manifest' using errcode='40001'; end if;
  select * into receipt from public.admin_catalog_tee_evidence_batches where proposal_id=proposal.id and record_kind='receipt';
  if found then
    if receipt.confirmed_by<>actor or receipt.note<>btrim(p_note) or receipt.manifest_hash<>p_approved_sha256 then
      raise exception 'Approval consumed; only an identical technical retry is allowed' using errcode='40001'; end if;
    return public.admin_catalog_tee_evidence_receipt(receipt);
  end if;
  select * into a from public.admin_catalog_tee_source_artifacts where id=proposal.artifact_id for share nowait;
  if not found then raise exception 'Artifact not found' using errcode='22023'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('tee-source:'||a.sha256,0)) then
    raise exception 'Artifact is busy' using errcode='55P03'; end if;
  perform public.admin_catalog_tee_evidence_validate(a.extraction_manifest);
  perform 1 from storage.objects where bucket_id='admin-catalog-evidence' and name=a.object_path for share nowait;
  if not found then raise exception 'Archived object missing' using errcode='40001'; end if;
  b:=gen_random_uuid();
  -- Counts computed before receipt; all new rows, items and receipt are one transaction.
  for i in select value from jsonb_array_elements(a.extraction_manifest->'items') loop
    if i->>'outcome'='excluded' then excluded:=excluded+1;
    else
      incomplete:=incomplete+1;
      if exists(select 1 from public.admin_catalog_tee_source_evidence where artifact_id=a.id and internal_reference=i->>'observation_id') then
        existing:=existing+1;
      else inserted:=inserted+1; end if;
    end if;
  end loop;
  insert into public.admin_catalog_tee_evidence_batches(id,record_kind,proposal_id,artifact_id,manifest_hash,note,total_count,inserted_count,existing_count,incomplete_count,excluded_count,confirmed_by)
  values(b,'receipt',proposal.id,a.id,p_approved_sha256,btrim(p_note),jsonb_array_length(a.extraction_manifest->'items'),inserted,existing,incomplete,excluded,actor)
  returning * into receipt;
  for i in select value from jsonb_array_elements(a.extraction_manifest->'items') loop
    eid:=null;
    if i->>'outcome'='excluded' then outcome:='excluded';
    else
      select id into eid from public.admin_catalog_tee_source_evidence where artifact_id=a.id and internal_reference=i->>'observation_id';
      if found then outcome:='existing';
      else
        e:=i->'evidence'; outcome:='inserted';
        insert into public.admin_catalog_tee_source_evidence(artifact_id,internal_reference,observation_id,external_tee_id,external_configuration_id,synthetic_tee_id,
          club_label,configuration_label,tee_label,par_original,par_normalized,par_state,scope_original,scope_normalized,scope_state,
          applicability_original,applicability_normalized,applicability_state,par_origin,completeness,certainty,limitations,transformations,predecessor_id,recorded_by)
        values(a.id,e->>'internal_reference',i->>'observation_id',e->>'external_tee_id',e->>'external_configuration_id',e->>'synthetic_tee_id',
          e->>'club_label',e->>'configuration_label',e->>'tee_label',e->>'par_original',(e->>'par_normalized')::integer,e->>'par_state',
          e->>'scope_original',(e->>'scope_normalized')::integer,e->>'scope_state',e->>'applicability_original',e->>'applicability_normalized',
          e->>'applicability_state',e->>'par_origin',e->>'completeness',e->>'certainty',array(select jsonb_array_elements_text(e->'limitations')),
          array(select jsonb_array_elements_text(e->'transformations')),(e->>'predecessor_id')::uuid,actor) returning id into eid;
      end if;
    end if;
    insert into public.admin_catalog_tee_evidence_batch_items(batch_id,observation_id,evidence_id,outcome,reason)
    values(b,i->>'observation_id',eid,outcome,i->>'reason');
  end loop;
  return public.admin_catalog_tee_evidence_receipt(receipt);
end $$;

create function public.admin_catalog_tee_evidence_list(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  perform public.admin_catalog_require_admin();
  if p_offset is null or p_offset<0 then raise exception 'Invalid pagination' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'source',a.source_system,'extractor_version',a.extractor_version,'confirmed_at',b.confirmed_at,
    'total',b.total_count,'inserted',b.inserted_count,'existing',b.existing_count,'incomplete',b.incomplete_count,'excluded',b.excluded_count)
    order by b.confirmed_at desc,b.id),'[]'::jsonb) into result
  from (select * from public.admin_catalog_tee_evidence_batches where record_kind='receipt' order by confirmed_at desc,id limit 50 offset p_offset) b
  join public.admin_catalog_tee_source_artifacts a on a.id=b.artifact_id;
  return jsonb_build_object('items',result,'total',(select count(*) from public.admin_catalog_tee_evidence_batches where record_kind='receipt'),'offset',p_offset);
end $$;

create function public.admin_catalog_tee_evidence_detail(p_batch_id uuid,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare b public.admin_catalog_tee_evidence_batches; a public.admin_catalog_tee_source_artifacts; items jsonb;
begin
  perform public.admin_catalog_require_admin();
  if p_batch_id is null or p_offset is null or p_offset<0 then raise exception 'Exact batch and valid page required' using errcode='22023'; end if;
  select * into b from public.admin_catalog_tee_evidence_batches where id=p_batch_id and record_kind='receipt';
  if not found then raise exception 'Batch not found' using errcode='22023'; end if;
  select * into a from public.admin_catalog_tee_source_artifacts where id=b.artifact_id;
  select coalesce(jsonb_agg(jsonb_build_object('observation_id',i.observation_id,'outcome',i.outcome,'reason',i.reason,'evidence',
    case when e.id is null then null else jsonb_build_object('id',e.id,'internal_reference',e.internal_reference,
    'external_tee_id',e.external_tee_id,'external_configuration_id',e.external_configuration_id,'synthetic_tee_id',e.synthetic_tee_id,
    'club_label',e.club_label,'configuration_label',e.configuration_label,'tee_label',e.tee_label,
    'par_original',e.par_original,'par_normalized',e.par_normalized,'par_state',e.par_state,
    'scope_original',e.scope_original,'scope_normalized',e.scope_normalized,'scope_state',e.scope_state,
    'applicability_original',e.applicability_original,'applicability_normalized',e.applicability_normalized,'applicability_state',e.applicability_state,
    'par_origin',e.par_origin,'completeness',e.completeness,'certainty',e.certainty,'limitations',e.limitations,'transformations',e.transformations,
    'predecessor_id',e.predecessor_id,'recorded_at',e.recorded_at) end) order by i.observation_id),'[]'::jsonb) into items
  from (select * from public.admin_catalog_tee_evidence_batch_items where batch_id=b.id order by observation_id limit 100 offset p_offset) i
  left join public.admin_catalog_tee_source_evidence e on e.id=i.evidence_id;
  return jsonb_build_object('batch',jsonb_build_object('id',b.id,'note',b.note,'confirmed_at',b.confirmed_at,
    'current_admin',b.confirmed_by=auth.uid(),'total',b.total_count,'inserted',b.inserted_count,'existing',b.existing_count,'incomplete',b.incomplete_count,'excluded',b.excluded_count),
    'artifact',jsonb_build_object('source',a.source_system,'source_url',a.source_url,'sha256',a.sha256,'byte_size',a.byte_size,
      'source_version',a.source_version,'acquired_at',a.acquired_at,'published_at',a.published_at,'extractor_version',a.extractor_version,'recorded_at',a.recorded_at),
    'items',items,'offset',p_offset);
end $$;

revoke all on function public.admin_catalog_tee_evidence_immutable() from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_evidence_storage_guard() from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_evidence_validate(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_evidence_receipt(public.admin_catalog_tee_evidence_batches) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_evidence_stage(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_evidence_preview(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_evidence_confirm(uuid,text,uuid,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_evidence_list(integer) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_evidence_detail(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_catalog_tee_evidence_stage(text,uuid) to service_role;
grant execute on function public.admin_catalog_tee_evidence_confirm(uuid,text,uuid,text,boolean) to service_role;
grant execute on function public.admin_catalog_tee_evidence_preview(uuid) to authenticated;
grant execute on function public.admin_catalog_tee_evidence_list(integer) to authenticated;
grant execute on function public.admin_catalog_tee_evidence_detail(uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
