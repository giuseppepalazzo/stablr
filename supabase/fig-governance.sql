-- One-shot, additive governance. Apply manually AFTER existing Admin workflow/Club editor.
-- No imports, live writes, matching changes, publication or automatic identification.
begin;
create table public.admin_fig_checks (
 id uuid primary key default gen_random_uuid(), request_key text not null unique,
 requested_by uuid not null references auth.users(id) on delete restrict,
 channel text not null check(channel in ('manual','weekly')),
 started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null default 'running' check(status in ('running','success','failed')),
 baseline_id uuid references public.admin_fig_checks(id) on delete restrict,
 source_hash text, extractor text, record_count integer,
 failure_code text check(failure_code in ('SOURCE_UNAVAILABLE','SOURCE_INVALID','CHECK_EXPIRED','BASE_CHANGED')),
 check((status='running' and finished_at is null) or (status<>'running' and finished_at is not null))
);
create unique index admin_fig_one_running on public.admin_fig_checks((status)) where status='running';
create table public.admin_fig_observations (
 check_id uuid not null references public.admin_fig_checks(id) on delete restrict,
 observation_key text not null, source_id text, fields jsonb not null,
 primary key(check_id,observation_key), check(jsonb_typeof(fields)='object')
);
create table public.admin_fig_differences (
 id uuid primary key default gen_random_uuid(), check_id uuid not null references public.admin_fig_checks(id) on delete restrict,
 observation_key text not null, kind text not null check(kind in ('new','changed','missing','unmatched','conflict','divergence')),
 needs_identity boolean not null, fig_club_id uuid, club_id uuid,
 before_fields jsonb, after_fields jsonb, curated_fields jsonb,
 created_at timestamptz not null default now(), unique(check_id,observation_key,kind),
 check(not needs_identity or (fig_club_id is null and club_id is null))
);
-- Independently dated state of the already imported FIG catalog. Its explicit
-- DB identity is NOT asserted as the identity of an unidentified public row.
create table public.admin_fig_catalog_states (
 check_id uuid not null references public.admin_fig_checks(id) on delete restrict,
 fig_club_id uuid not null, fields jsonb not null,
 primary key(check_id,fig_club_id)
);
create table public.admin_fig_decisions (
 id uuid primary key default gen_random_uuid(), difference_id uuid not null references public.admin_fig_differences(id) on delete restrict,
 action text not null check(action in ('ignore','not_corresponding','draft')),
 note text not null check(length(trim(note)) between 1 and 2000),
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), draft_id uuid,
 unique(difference_id,created_by,action)
);
create function public.admin_fig_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Immutable FIG governance record' using errcode='55000';end $$;
create trigger admin_fig_observations_immutable before update or delete on public.admin_fig_observations for each row execute function public.admin_fig_immutable();
create trigger admin_fig_differences_immutable before update or delete on public.admin_fig_differences for each row execute function public.admin_fig_immutable();
create trigger admin_fig_decisions_immutable before update or delete on public.admin_fig_decisions for each row execute function public.admin_fig_immutable();
create trigger admin_fig_catalog_states_immutable before update or delete on public.admin_fig_catalog_states for each row execute function public.admin_fig_immutable();
create trigger admin_fig_observations_no_truncate before truncate on public.admin_fig_observations for each statement execute function public.admin_fig_immutable();
create trigger admin_fig_catalog_states_no_truncate before truncate on public.admin_fig_catalog_states for each statement execute function public.admin_fig_immutable();
create trigger admin_fig_differences_no_truncate before truncate on public.admin_fig_differences for each statement execute function public.admin_fig_immutable();
create trigger admin_fig_decisions_no_truncate before truncate on public.admin_fig_decisions for each statement execute function public.admin_fig_immutable();
create trigger admin_fig_checks_no_truncate before truncate on public.admin_fig_checks for each statement execute function public.admin_fig_immutable();
create function public.admin_fig_check_guard() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' or old.status<>'running' or new.status='running' or
 (new.id,new.request_key,new.requested_by,new.channel,new.started_at,new.baseline_id) is distinct from
 (old.id,old.request_key,old.requested_by,old.channel,old.started_at,old.baseline_id) then
 raise exception 'Immutable completed check' using errcode='55000';end if;return new;
end $$;
create trigger admin_fig_check_guard before update or delete on public.admin_fig_checks for each row execute function public.admin_fig_check_guard();
alter table public.admin_fig_checks enable row level security;
alter table public.admin_fig_observations enable row level security;
alter table public.admin_fig_differences enable row level security;
alter table public.admin_fig_decisions enable row level security;
alter table public.admin_fig_catalog_states enable row level security;
revoke all on public.admin_fig_checks,public.admin_fig_observations,public.admin_fig_differences,public.admin_fig_decisions,public.admin_fig_catalog_states from public,anon,authenticated,service_role;

create function public.admin_fig_service(p_operator uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.role() is distinct from 'service_role' or auth.uid() is not null or not exists(select 1 from public.profiles where id=p_operator and role='admin') then
 raise exception 'Protected server required' using errcode='42501';end if;
end $$;
create function public.admin_fig_check_begin(p_operator uuid,p_channel text,p_request_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.admin_fig_checks; b uuid;
begin
 perform public.admin_fig_service(p_operator);
 if p_channel not in ('manual','weekly') or p_channel is null or length(p_request_key) not between 1 and 200 or p_request_key is null then raise exception 'Invalid request' using errcode='22023';end if;
 if not pg_try_advisory_xact_lock(723145091) then raise exception 'Check busy' using errcode='55P03';end if;
 select * into r from public.admin_fig_checks where request_key=p_request_key;
 if found then
  if r.requested_by<>p_operator or r.channel<>p_channel then raise exception 'Replay rejected' using errcode='42501';end if;
  return jsonb_build_object('id',r.id,'status',r.status,'replay',true);
 end if;
 -- An interrupted request cannot hold the single-run lease forever. Its failure
 -- never advances the baseline or generates removal differences.
 update public.admin_fig_checks set status='failed',finished_at=now(),failure_code='CHECK_EXPIRED'
 where status='running' and started_at<now()-interval '10 minutes';
 if exists(select 1 from public.admin_fig_checks where status='running') then raise exception 'Check busy' using errcode='55P03';end if;
 select id into b from public.admin_fig_checks where status='success' order by finished_at desc,id desc limit 1;
 insert into public.admin_fig_checks(request_key,requested_by,channel,baseline_id) values(p_request_key,p_operator,p_channel,b) returning * into r;
 return jsonb_build_object('id',r.id,'status',r.status,'replay',false);
end $$;

create function public.admin_fig_check_finish(p_operator uuid,p_check_id uuid,p_photograph jsonb,p_failure text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.admin_fig_checks; item jsonb; old_item jsonb; k text; f uuid; c uuid; n integer; current_base uuid; change_kind text; curated jsonb; links integer;
begin
 perform public.admin_fig_service(p_operator);
 if not pg_try_advisory_xact_lock(723145091) then raise exception 'Check busy' using errcode='55P03';end if;
 select * into r from public.admin_fig_checks where id=p_check_id for update nowait;
 if not found or r.requested_by<>p_operator then raise exception 'Check rejected' using errcode='42501';end if;
 if r.status<>'running' then return jsonb_build_object('id',r.id,'status',r.status);end if;
 select id into current_base from public.admin_fig_checks where status='success' order by finished_at desc,id desc limit 1;
 if current_base is distinct from r.baseline_id then p_failure:='BASE_CHANGED';end if;
 if p_failure is not null then
  if p_failure not in ('SOURCE_UNAVAILABLE','SOURCE_INVALID','BASE_CHANGED') then raise exception 'Invalid failure' using errcode='22023';end if;
  update public.admin_fig_checks set status='failed',finished_at=now(),failure_code=p_failure where id=r.id;
  return jsonb_build_object('id',r.id,'status','failed');
 end if;
 if p_photograph is null or jsonb_typeof(p_photograph)<>'object' or
 (select array_agg(key order by key) from jsonb_object_keys(p_photograph) key)<>array['extractor','records','source_hash']::text[] or
 p_photograph->>'extractor' is distinct from 'fig-governance/1' or jsonb_typeof(p_photograph->'source_hash') is distinct from 'string' or (p_photograph->>'source_hash') !~ '^[a-f0-9]{64}$' or
 jsonb_typeof(p_photograph->'records') is distinct from 'array' then raise exception 'Invalid photograph' using errcode='22023';end if;
 n:=jsonb_array_length(p_photograph->'records');if n not between 1 and 10000 then raise exception 'Invalid cardinality' using errcode='22023';end if;
 if r.baseline_id is not null and n < (select record_count from public.admin_fig_checks where id=r.baseline_id)*0.5 then
  raise exception 'Suspicious partial source: review provider before accepting removals' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_photograph->'records') loop
  if jsonb_typeof(item)<>'object' or (select array_agg(key order by key) from jsonb_object_keys(item) key)<>
   array['city','course','key','name','par','ratings','source_id']::text[] or
   jsonb_typeof(item->'name') is distinct from 'string' or jsonb_typeof(item->'course') is distinct from 'string' or jsonb_typeof(item->'key') is distinct from 'string' or
   length(item->>'name') not between 1 and 250 or length(item->>'course') not between 1 and 250 or
   (item->>'key') !~ '^[a-f0-9]{64}:[1-9][0-9]*$' or
   jsonb_typeof(item->'par') is distinct from 'number' or (item->>'par')::numeric<=0 or (item->>'par')::numeric<>trunc((item->>'par')::numeric) or
   jsonb_typeof(item->'ratings') is distinct from 'array' or jsonb_array_length(item->'ratings')<>14 or
   exists(select 1 from jsonb_array_elements(item->'ratings') v where jsonb_typeof(v) not in ('number','null')) or
   jsonb_typeof(item->'city') not in ('null','string') or jsonb_typeof(item->'source_id') is distinct from 'null' then
   -- Version 1 public provider has NO native IDs. Even service cannot smuggle
   -- a name-derived ID into a verified three-way comparison through this RPC.
   raise exception 'Invalid observation or unverified identity' using errcode='22023';
  end if;
  insert into public.admin_fig_observations(check_id,observation_key,source_id,fields)
   values(r.id,item->>'key',null,item-'key'-'source_id');
 end loop;
 -- Three-way engine is identity-gated. This source version intentionally
 -- produces only unidentified observations. No join by name/city/Par/offset.
 for item in select jsonb_build_object('key',observation_key,'fields',fields) from public.admin_fig_observations where check_id=r.id loop
  k:=item->>'key';select fields into old_item from public.admin_fig_observations where check_id=r.baseline_id and observation_key=k;
  if old_item is null then
   insert into public.admin_fig_differences(check_id,observation_key,kind,needs_identity,after_fields)
    values(r.id,k,case when r.baseline_id is null then 'unmatched' else 'new' end,true,item->'fields');
  end if;
 end loop;
 if r.baseline_id is not null then
  insert into public.admin_fig_differences(check_id,observation_key,kind,needs_identity,before_fields)
   select r.id,o.observation_key,'missing',true,o.fields from public.admin_fig_observations o where o.check_id=r.baseline_id
   and not exists(select 1 from public.admin_fig_observations x where x.check_id=r.id and x.observation_key=o.observation_key);
 end if;
 -- A SEPARATE comparison of the imported catalog, using only existing stored
 -- links. Never associate these UUIDs with the public observations by names.
 insert into public.admin_fig_catalog_states(check_id,fig_club_id,fields)
 select r.id,g.id,jsonb_build_object('name',g.name,'city',g.city,'source_external_id',g.source_external_id,
  'courses',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'holes_count',p.holes_count,'par',p.total_par,
   'tees',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.tee_name,'gender',t.gender,'par',t.par_total,'cr',t.course_rating,'slope',t.slope_rating) order by t.id)
   from public.fig_course_tees t where t.fig_playable_course_id=p.id),'[]'::jsonb)) order by p.id)
   from public.fig_playable_courses p where p.fig_club_id=g.id),'[]'::jsonb))
 from public.fig_clubs g where g.source_system='fig';
 for item in select jsonb_build_object('id',fig_club_id,'fields',fields) from public.admin_fig_catalog_states where check_id=r.id loop
  f:=(item->>'id')::uuid; k:='catalog:'||f::text;
  select fields into old_item from public.admin_fig_catalog_states where check_id=r.baseline_id and fig_club_id=f;
  select count(*),(array_agg(id order by id))[1] into links,c from public.clubs where fig_club_id=f and fig_match_status='matched';
  -- Conflicting/unverified links are a coverage problem, not absence of impact.
  if links<>1 then
   change_kind:=case when links>1 then 'conflict' else 'unmatched' end;curated:=null;c:=null;
  elsif exists(select 1 from public.admin_fig_differences d join public.admin_fig_decisions a on a.difference_id=d.id
    where d.fig_club_id=f and d.club_id=c and a.action='not_corresponding') then
   change_kind:='conflict';curated:=null;c:=null;
  else
   select jsonb_build_object('name',name,'city',city) into curated from public.clubs where id=c;
   change_kind:=case when old_item is null and r.baseline_id is not null then 'new' when old_item is not null and old_item is distinct from item->'fields' then 'changed'
     when curated is distinct from jsonb_build_object('name',item->'fields'->'name','city',item->'fields'->'city') then 'divergence' else null end;
  end if;
  if change_kind is not null and (old_item is distinct from item->'fields' or change_kind in ('divergence','unmatched','conflict')) then
   -- An ignored editorial divergence persists until FIG or curated fields
   -- really change. New snapshots must not erase the decision.
   if not exists(select 1 from public.admin_fig_differences d where d.observation_key=k and d.kind=change_kind
    and d.after_fields is not distinct from item->'fields' and d.curated_fields is not distinct from curated
    and (not exists(select 1 from public.admin_fig_decisions a where a.difference_id=d.id) or
     exists(select 1 from public.admin_fig_decisions a where a.difference_id=d.id and a.action='ignore'))) then
    insert into public.admin_fig_differences(check_id,observation_key,kind,needs_identity,fig_club_id,club_id,before_fields,after_fields,curated_fields)
     values(r.id,k,change_kind,links<>1 or c is null,case when links=1 and c is not null then f end,c,old_item,item->'fields',curated);
   end if;
  end if;
 end loop;
 if r.baseline_id is not null then
  insert into public.admin_fig_differences(check_id,observation_key,kind,needs_identity,fig_club_id,club_id,before_fields)
  select r.id,'catalog:'||o.fig_club_id::text,'missing',false,o.fig_club_id,c.id,o.fields
  from public.admin_fig_catalog_states o join public.clubs c on c.fig_club_id=o.fig_club_id and c.fig_match_status='matched'
  where o.check_id=r.baseline_id and not exists(select 1 from public.admin_fig_catalog_states x where x.check_id=r.id and x.fig_club_id=o.fig_club_id)
  and (select count(*) from public.clubs z where z.fig_club_id=o.fig_club_id and z.fig_match_status='matched')=1;
 end if;
 update public.admin_fig_checks set status='success',finished_at=now(),source_hash=p_photograph->>'source_hash',extractor=p_photograph->>'extractor',record_count=n where id=r.id;
 return jsonb_build_object('id',r.id,'status','success');
end $$;

create function public.admin_fig_overview(p_offset integer default 0,p_show_resolved boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 perform public.admin_catalog_require_admin();
 if p_offset is null or p_offset<0 or p_offset>100000 or p_show_resolved is null then raise exception 'Invalid page' using errcode='22023';end if;
 select jsonb_build_object(
  'last_check',(select jsonb_build_object('id',id,'status',status,'started_at',started_at,'finished_at',finished_at,'failure_code',failure_code,'record_count',record_count) from public.admin_fig_checks order by started_at desc,id desc limit 1),
  'baseline',(select jsonb_build_object('id',id,'finished_at',finished_at,'record_count',record_count) from public.admin_fig_checks where status='success' order by finished_at desc,id desc limit 1),
  'total',(select count(*) from public.admin_fig_differences d where p_show_resolved or not exists(select 1 from public.admin_fig_decisions a where a.difference_id=d.id)),
  'queue',coalesce((select jsonb_agg(x.row) from (select jsonb_build_object('id',d.id,'kind',d.kind,'needs_identity',d.needs_identity,'created_at',d.created_at,
    'before',d.before_fields,'after',d.after_fields,'curated',d.curated_fields,'origin',case when d.observation_key like 'catalog:%' then 'catalog' else 'public' end,
    'can_draft',not d.needs_identity and d.after_fields is not null and d.club_id is not null and d.kind not in ('conflict','missing'),
    'decision',(select jsonb_build_object('action',a.action,'note',a.note,'created_at',a.created_at) from public.admin_fig_decisions a where a.difference_id=d.id order by a.created_at desc,a.id desc limit 1)) row
    from public.admin_fig_differences d where p_show_resolved or not exists(select 1 from public.admin_fig_decisions a where a.difference_id=d.id)
    order by d.created_at desc,d.id limit 50 offset p_offset) x),'[]'::jsonb)) into result;
 return result;
end $$;

create function public.admin_fig_decide(p_difference_id uuid,p_action text,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.admin_catalog_require_admin(); d public.admin_fig_differences; existing public.admin_fig_decisions; draft public.admin_catalog_drafts; desired jsonb;
begin
 if p_action not in ('ignore','not_corresponding','draft') or p_action is null or p_note is null or length(trim(p_note)) not between 1 and 2000 then raise exception 'Explicit decision required' using errcode='22023';end if;
 select * into d from public.admin_fig_differences where id=p_difference_id for update nowait;
 if not found then raise exception 'Difference unavailable' using errcode='42501';end if;
 select * into existing from public.admin_fig_decisions where difference_id=d.id order by created_at desc limit 1;
 if found then
  if existing.created_by=actor and existing.action=p_action and existing.note=trim(p_note) then return jsonb_build_object('action',existing.action,'id',existing.id,'draft_id',existing.draft_id,'club_id',d.club_id);end if;
  raise exception 'Decision already recorded' using errcode='40001';
 end if;
 if p_action='draft' then
  if d.needs_identity or d.club_id is null or d.after_fields is null or d.kind in ('conflict','missing') then
   raise exception 'Da identificare: no verified identity' using errcode='22023';end if;
  perform 1 from public.clubs where id=d.club_id for update nowait;
  perform 1 from public.fig_clubs where id=d.fig_club_id for share nowait;
  if (select count(*) from public.clubs where fig_club_id=d.fig_club_id and fig_match_status='matched')<>1 or
   not exists(select 1 from public.clubs where id=d.club_id and fig_club_id=d.fig_club_id and fig_match_status='matched'
     and jsonb_build_object('name',name,'city',city)=d.curated_fields) or
   not exists(select 1 from public.fig_clubs where id=d.fig_club_id and name=d.after_fields->>'name' and city is not distinct from d.after_fields->>'city') then
   raise exception 'Source or curated base changed' using errcode='40001';end if;
  -- Missing source locality is not an instruction to erase curated locality.
  desired:=public.admin_club_validate_snapshot(jsonb_build_object('name',d.after_fields->'name','city',coalesce(d.after_fields->>'city',d.curated_fields->>'city')));
  draft:=public.admin_club_open_draft(d.club_id);
  if draft.snapshot is distinct from draft.base_snapshot and draft.snapshot is distinct from desired then
   raise exception 'Existing draft contains changes' using errcode='40001';end if;
  draft:=public.admin_club_save_draft(draft.draft_id,desired,draft.revision);
 end if;
 insert into public.admin_fig_decisions(difference_id,action,note,created_by,draft_id) values(d.id,p_action,trim(p_note),actor,draft.draft_id) returning * into existing;
 return jsonb_build_object('id',existing.id,'action',existing.action,'draft_id',existing.draft_id,'club_id',d.club_id);
end $$;
revoke all on function public.admin_fig_immutable(),public.admin_fig_check_guard(),public.admin_fig_service(uuid),
 public.admin_fig_check_begin(uuid,text,text),public.admin_fig_check_finish(uuid,uuid,jsonb,text),
 public.admin_fig_overview(integer,boolean),public.admin_fig_decide(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_fig_check_begin(uuid,text,text),public.admin_fig_check_finish(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.admin_fig_overview(integer,boolean),public.admin_fig_decide(uuid,text,text) to authenticated;
commit;
