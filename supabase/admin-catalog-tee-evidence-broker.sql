-- Incremental, transactional, ONE-SHOT. Prerequisite: admin-catalog-tee-evidence.sql.
-- No backfill, no live linkage; only immutable archive preparations and GitHub receipts.
begin;
do $$ begin
  if to_regprocedure('public.admin_catalog_tee_evidence_stage(text,uuid)') is null
    or to_regprocedure('public.admin_catalog_tee_evidence_confirm(uuid,text,uuid,text,boolean)') is null then
    raise exception 'Server-only tee evidence archive required';
  end if;
end $$;

create table public.admin_catalog_tee_broker_preparations (
  proposal_id uuid primary key references public.admin_catalog_tee_evidence_batches(id) on delete restrict,
  preparation_text text not null check(octet_length(preparation_text) between 1 and 12582912),
  approval_sha256 text not null unique check(approval_sha256 ~ '^[a-f0-9]{64}$'),
  raw_sha256 text not null check(raw_sha256 ~ '^[a-f0-9]{64}$'),
  operator_id uuid not null,
  github_context jsonb not null,
  prepared_at timestamptz not null default clock_timestamp()
);
create table public.admin_catalog_tee_broker_requests (
  id uuid primary key default gen_random_uuid(),
  operation text not null check(operation in ('preview','confirm')),
  repository_id text not null,
  run_id text not null,
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  proposal_id uuid not null references public.admin_catalog_tee_broker_preparations(proposal_id) on delete restrict,
  receipt_id uuid references public.admin_catalog_tee_evidence_batches(id) on delete restrict,
  operator_id uuid not null,
  github_context jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(repository_id,run_id),
  check((operation='preview' and receipt_id is null) or (operation='confirm' and receipt_id is not null))
);
do $$ declare t text; begin
  foreach t in array array['admin_catalog_tee_broker_preparations','admin_catalog_tee_broker_requests'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    -- No direct SELECT policy; even Admin read only existing minimized archive RPCs.
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.admin_catalog_tee_evidence_immutable()',t||'_immutable',t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.admin_catalog_tee_evidence_immutable()',t||'_no_truncate',t);
  end loop;
end $$;

create function public.admin_catalog_tee_broker_require(p_operator_id uuid,p_context jsonb)
returns void language plpgsql stable security definer set search_path=pg_catalog as $$
declare k text; fields text[]:=array['repository','repository_id','repository_owner_id','ref','event_name','workflow_ref','workflow_sha',
  'runner_environment','actor_id','run_id','run_attempt','audience'];
begin
  if auth.role() is distinct from 'service_role' or p_operator_id is null or not exists(
    select 1 from public.profiles where id=p_operator_id and role='admin') then
    raise exception 'Protected broker and current Admin required' using errcode='42501'; end if;
  -- Trust boundary: only broker verifies GitHub signatures/policy; SQL validates the fixed context shape.
  if p_context is null or jsonb_typeof(p_context)<>'object' or not p_context ?& fields
    or (p_context-fields)<>'{}'::jsonb then raise exception 'Bounded GitHub context required' using errcode='22023'; end if;
  foreach k in array fields loop
    if jsonb_typeof(p_context->k) is distinct from 'string' or length(p_context->>k)>300 then
      raise exception 'GitHub scalar required' using errcode='22023'; end if;
  end loop;
  foreach k in array array['repository_id','repository_owner_id','actor_id','run_id'] loop
    if p_context->>k !~ '^[1-9][0-9]{0,19}$' then raise exception 'GitHub identity required' using errcode='22023'; end if;
  end loop;
  if p_context->>'repository'<>'giuseppepalazzo/stablr' or p_context->>'ref'<>'refs/heads/main'
    or p_context->>'event_name'<>'workflow_dispatch' or p_context->>'runner_environment'<>'github-hosted'
    or p_context->>'run_attempt'<>'1' or p_context->>'workflow_sha' !~ '^[a-f0-9]{40}$'
    or p_context->>'workflow_ref'<>'giuseppepalazzo/stablr/.github/workflows/tee-evidence-batch.yml@refs/heads/main'
    or p_context->>'audience' !~ '^stablr:tee-evidence:[a-z0-9-]{1,80}$' then
    raise exception 'GitHub context rejected' using errcode='42501'; end if;
end $$;

create function public.admin_catalog_tee_broker_validate_preparation(p_preparation_text text)
returns jsonb language plpgsql immutable security definer set search_path=pg_catalog as $$
declare p jsonb;
begin
  if p_preparation_text is null or octet_length(p_preparation_text) not between 1 and 12582912 then
    raise exception 'Bounded preparation required' using errcode='22023'; end if;
  p:=p_preparation_text::jsonb;
  if jsonb_typeof(p)<>'object' or not p ?& array['contract_version','batch_id','manifest']
    or (p-array['contract_version','batch_id','manifest'])<>'{}'::jsonb or p->'contract_version' is distinct from '1'::jsonb
    or jsonb_typeof(p->'batch_id') is distinct from 'string'
    or p->>'batch_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
    raise exception 'Explicit preparation identity required' using errcode='22023'; end if;
  perform public.admin_catalog_tee_evidence_validate(p->'manifest'); return p;
end $$;

create function public.admin_catalog_tee_broker_check_request(p_context jsonb,p_token_hash text,p_request_sha256 text,p_operator_id uuid,p_operation text)
returns void language plpgsql stable security definer set search_path=pg_catalog as $$
declare r public.admin_catalog_tee_broker_requests;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'OIDC identifier hash required' using errcode='22023'; end if;
  select * into r from public.admin_catalog_tee_broker_requests where token_hash=p_token_hash;
  if found and (r.repository_id<>p_context->>'repository_id' or r.run_id<>p_context->>'run_id') then
    raise exception 'OIDC identifier already used by another run' using errcode='40001'; end if;
  select * into r from public.admin_catalog_tee_broker_requests
    where repository_id=p_context->>'repository_id' and run_id=p_context->>'run_id';
  if found and (r.request_sha256<>p_request_sha256 or r.operation<>p_operation or r.operator_id<>p_operator_id
    or r.github_context<>p_context) then raise exception 'Run already bound to a different request' using errcode='40001'; end if;
end $$;

create function public.admin_catalog_tee_broker_lock(p_context jsonb,p_token_hash text)
returns void language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
  if not pg_try_advisory_xact_lock(hashtextextended('tee-broker-run:'||(p_context->>'repository_id')||':'||(p_context->>'run_id'),0))
    or not pg_try_advisory_xact_lock(hashtextextended('tee-broker-token:'||p_token_hash,0)) then
    raise exception 'Broker request busy' using errcode='55P03'; end if;
end $$;

create function public.admin_catalog_tee_broker_summary(p_proposal_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare p public.admin_catalog_tee_broker_preparations; m jsonb; reasons jsonb;
begin
  select * into strict p from public.admin_catalog_tee_broker_preparations where proposal_id=p_proposal_id;
  m:=p.preparation_text::jsonb->'manifest';
  select coalesce(jsonb_agg(jsonb_build_object('reason',reason,'count',n) order by reason),'[]'::jsonb) into reasons
    from (select i->>'reason' reason,count(*) n from jsonb_array_elements(m->'items') i group by i->>'reason') x;
  return jsonb_build_object('proposal_id',p.proposal_id,'approval_sha256',p.approval_sha256,'extractor_version',m->>'extractor_version',
    'counts',jsonb_build_object('total',jsonb_array_length(m->'items'),'complete',0,
      'incomplete',(select count(*) from jsonb_array_elements(m->'items') i where i->>'outcome'='incomplete'),
      'excluded',(select count(*) from jsonb_array_elements(m->'items') i where i->>'outcome'='excluded')),'reasons',reasons);
end $$;

-- Read-only preflight BEFORE Storage: active Admin, preparation schema and run/token replay checks.
create function public.admin_catalog_tee_broker_preflight(p_preparation_text text,p_context jsonb,p_token_hash text,p_operator_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare p jsonb; h text;
begin
  perform public.admin_catalog_tee_broker_require(p_operator_id,p_context);
  p:=public.admin_catalog_tee_broker_validate_preparation(p_preparation_text);
  h:=encode(sha256(convert_to(jsonb_build_object('operation','preview','preparation_sha256',
    encode(sha256(convert_to(p_preparation_text,'UTF8')),'hex'))::text,'UTF8')),'hex');
  perform public.admin_catalog_tee_broker_check_request(p_context,p_token_hash,h,p_operator_id,'preview');
  return jsonb_build_object('authorized',true);
end $$;

create function public.admin_catalog_tee_broker_stage(p_preparation_text text,p_context jsonb,p_token_hash text,p_operator_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare p jsonb; s jsonb; h text; existing public.admin_catalog_tee_broker_preparations;
begin
  perform public.admin_catalog_tee_broker_preflight(p_preparation_text,p_context,p_token_hash,p_operator_id);
  perform public.admin_catalog_tee_broker_lock(p_context,p_token_hash);
  perform public.admin_catalog_tee_broker_preflight(p_preparation_text,p_context,p_token_hash,p_operator_id);
  p:=p_preparation_text::jsonb;
  h:=encode(sha256(convert_to(jsonb_build_object('operation','preview','preparation_sha256',
    encode(sha256(convert_to(p_preparation_text,'UTF8')),'hex'))::text,'UTF8')),'hex');
  select * into existing from public.admin_catalog_tee_broker_preparations where proposal_id=(p->>'batch_id')::uuid;
  if found and (existing.preparation_text<>p_preparation_text or existing.github_context<>p_context or existing.operator_id<>p_operator_id) then
    raise exception 'Preparation cannot be reused by another run' using errcode='40001'; end if;
  s:=public.admin_catalog_tee_evidence_stage(p_preparation_text,p_operator_id);
  if not exists(select 1 from public.admin_catalog_tee_broker_preparations where proposal_id=(s->>'proposal_id')::uuid) then
    insert into public.admin_catalog_tee_broker_preparations(proposal_id,preparation_text,approval_sha256,raw_sha256,operator_id,github_context)
    values((s->>'proposal_id')::uuid,p_preparation_text,s->>'approval_sha256',p->'manifest'->'artifact'->>'sha256',p_operator_id,p_context);
  end if;
  if not exists(select 1 from public.admin_catalog_tee_broker_requests where repository_id=p_context->>'repository_id' and run_id=p_context->>'run_id') then
    insert into public.admin_catalog_tee_broker_requests(operation,repository_id,run_id,token_hash,request_sha256,proposal_id,operator_id,github_context)
    values('preview',p_context->>'repository_id',p_context->>'run_id',p_token_hash,h,(s->>'proposal_id')::uuid,p_operator_id,p_context);
  end if;
  return public.admin_catalog_tee_broker_summary((s->>'proposal_id')::uuid);
end $$;

-- Only owned preparation METADATA goes to the broker; exact text never leaves SQL.
create function public.admin_catalog_tee_broker_prepared(p_proposal_id uuid,p_operator_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare p public.admin_catalog_tee_broker_preparations;
begin
  if auth.role() is distinct from 'service_role' or p_operator_id is null or not exists(select 1 from public.profiles where id=p_operator_id and role='admin') then
    raise exception 'Protected broker and current Admin required' using errcode='42501'; end if;
  select * into p from public.admin_catalog_tee_broker_preparations where proposal_id=p_proposal_id and operator_id=p_operator_id;
  if not found then raise exception 'Exact owned preparation required' using errcode='42501'; end if;
  return jsonb_build_object('approval_sha256',p.approval_sha256,'actor_id',p.github_context->>'actor_id','workflow_sha',p.github_context->>'workflow_sha');
end $$;

create function public.admin_catalog_tee_broker_confirm(p_proposal_id uuid,p_approved_sha256 text,p_note text,p_context jsonb,p_token_hash text,p_operator_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare p public.admin_catalog_tee_broker_preparations; h text; r jsonb;
begin
  perform public.admin_catalog_tee_broker_require(p_operator_id,p_context);
  if p_proposal_id is null or p_approved_sha256 is null or p_approved_sha256 !~ '^[a-f0-9]{64}$'
    or p_note is null or length(btrim(p_note)) not between 1 and 2000 then
    raise exception 'Explicit proposal/hash/note required' using errcode='22023'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'OIDC identifier hash required' using errcode='22023'; end if;
  perform public.admin_catalog_tee_broker_lock(p_context,p_token_hash);
  h:=encode(sha256(convert_to(jsonb_build_object('operation','confirm','proposal_id',p_proposal_id,
    'approval_sha256',p_approved_sha256,'note',btrim(p_note))::text,'UTF8')),'hex');
  perform public.admin_catalog_tee_broker_check_request(p_context,p_token_hash,h,p_operator_id,'confirm');
  select * into p from public.admin_catalog_tee_broker_preparations where proposal_id=p_proposal_id for share nowait;
  if not found or p.operator_id<>p_operator_id or p.github_context->>'actor_id'<>p_context->>'actor_id'
    or p.github_context->>'repository_id'<>p_context->>'repository_id' then
    raise exception 'Owned broker preparation required' using errcode='42501'; end if;
  if p.approval_sha256<>p_approved_sha256 or encode(sha256(convert_to(p.preparation_text,'UTF8')),'hex')<>p_approved_sha256 then
    raise exception 'Approval hash mismatch' using errcode='40001'; end if;
  r:=public.admin_catalog_tee_evidence_confirm(p_proposal_id,p_approved_sha256,p_operator_id,btrim(p_note),true);
  if not exists(select 1 from public.admin_catalog_tee_broker_requests where repository_id=p_context->>'repository_id' and run_id=p_context->>'run_id') then
    insert into public.admin_catalog_tee_broker_requests(operation,repository_id,run_id,token_hash,request_sha256,proposal_id,receipt_id,operator_id,github_context)
    values('confirm',p_context->>'repository_id',p_context->>'run_id',p_token_hash,h,p_proposal_id,(r->>'batch_id')::uuid,p_operator_id,p_context);
  end if;
  return r;
end $$;

revoke all on function public.admin_catalog_tee_broker_require(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_broker_validate_preparation(text) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_broker_check_request(jsonb,text,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_broker_lock(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_broker_summary(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_broker_preflight(text,jsonb,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_broker_stage(text,jsonb,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_broker_prepared(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_tee_broker_confirm(uuid,text,text,jsonb,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_catalog_tee_broker_preflight(text,jsonb,text,uuid) to service_role;
grant execute on function public.admin_catalog_tee_broker_stage(text,jsonb,text,uuid) to service_role;
grant execute on function public.admin_catalog_tee_broker_prepared(uuid,uuid) to service_role;
grant execute on function public.admin_catalog_tee_broker_confirm(uuid,text,text,jsonb,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
