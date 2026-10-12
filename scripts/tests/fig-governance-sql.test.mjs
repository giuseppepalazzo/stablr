import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { extract } from '../../supabase/functions/fig-governance/source.mjs';
const {PGlite}=await import(process.env.STABLR_PGLITE_MODULE||'@electric-sql/pglite');
const sql=await readFile(new URL('../../supabase/fig-governance.sql',import.meta.url),'utf8');
const foundation=await readFile(new URL('../../supabase/admin-catalog-workflow.sql',import.meta.url),'utf8');
const clubEditor=await readFile(new URL('../../supabase/admin-club-editor.sql',import.meta.url),'utf8');
const admin='11111111-1111-4111-8111-111111111111',player='22222222-2222-4222-8222-222222222222',fig='33333333-3333-4333-8333-333333333333',club='44444444-4444-4444-8444-444444444444';
const photo=async(par=35)=>extract(`<table><tr><th>Circolo Percorso PAR CR Slope</th></tr><tr>${['FIXTURE','9 Buche',par,...Array(14).fill('')].map(v=>'<td>'+v+'</td>').join('')}</tr></table>`);
test('PostgreSQL governance authorization, baselines, exact matching, audit and no live changes',async t=>{
 const db=new PGlite();const role=async(name='service_role',uid='',claim=name)=>{await db.exec('reset role;set role '+name);await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,claim]);};
 const rpc=async(name,args=[])=>(await db.query(`select public.admin_fig_${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).rows[0].r;
 const begin=key=>rpc('check_begin',[admin,'weekly',key]);const finish=(id,p,f=null)=>rpc('check_finish',[admin,id,p,f]);const fails=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 const original=()=>db.query('select name,city,is_active,fig_club_id,fig_match_status,playable from public.clubs where id=$1',[club]);
 const names=['admin_fig_checks','admin_fig_observations','admin_fig_catalog_states','admin_fig_differences','admin_fig_decisions'];
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key,role text);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
   grant usage on schema auth to anon,authenticated,service_role;
   create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
   insert into auth.users values('${admin}'),('${player}');insert into public.profiles values('${admin}','admin'),('${player}','user');
   create table public.clubs(id uuid primary key,name text,city text,name_normalized text,is_active boolean,updated_at timestamptz default now(),fig_club_id uuid,fig_match_status text,playable boolean);
   insert into public.clubs values('${club}','STABLR curato',null,'stablr',true,now(),'${fig}','matched',true);
   create table public.course_routes(id uuid primary key);create table public.route_combinations(id uuid primary key);create table public.route_holes(id uuid primary key);
   create table public.route_combination_holes(id uuid primary key);create table public.route_tees(id uuid primary key);create table public.combination_tees(id uuid primary key);
   create table public.fig_clubs(id uuid primary key,name text,city text,source_system text,source_external_id text);
   insert into public.fig_clubs values('${fig}','FIG pubblicato',null,'fig','persisted-fig-key');
   create table public.fig_playable_courses(id uuid primary key,fig_club_id uuid,name text,holes_count integer,total_par integer);
   create table public.fig_course_tees(id uuid primary key,fig_playable_course_id uuid,tee_name text,gender text,par_total integer,course_rating numeric,slope_rating integer);`);
  await db.exec(foundation);await db.exec(clubEditor);await db.exec(sql);
  const liveBefore=(await original()).rows;let first,second,third,fourth,difference;
  await t.test('no backfill/direct API DML; Admin UI only; service must have current Admin operator',async()=>{
   for(const args of [['anon',''],['authenticated',player],['authenticated',''],['service_role','']]){await role(...args);await fails(()=>rpc('overview'),'42501');await fails(()=>rpc('decide',[admin,'ignore','note']),'42501');}
   for(const args of [['anon',''],['authenticated',admin],['authenticated',player],['service_role','']]){await role(...args);for(const name of names){await fails(()=>db.exec('select * from public.'+name),'42501');await fails(()=>db.exec('insert into public.'+name+' default values'),'42501');await fails(()=>db.exec('delete from public.'+name),'42501');await fails(()=>db.exec('truncate public.'+name),'42501');}
    if(args[0]!=='service_role')await fails(()=>begin('unauthorized'),'42501');}
   await role();await fails(()=>rpc('check_begin',[player,'weekly','player']),'42501');await role('service_role',admin);await fails(()=>begin('has-uid'),'42501');await role();
  });
  await t.test('first complete snapshot: unidentified observations and exact linked catalog; no name attribution',async()=>{
   first=await begin('1');await finish(first.id,await photo());await role('authenticated',admin);const data=await rpc('overview');
   assert.equal(data.last_check.status,'success');assert.equal(data.baseline.id,first.id);assert.equal(data.queue.length,2);
   const unknown=data.queue.find(x=>x.origin==='public');assert.equal(unknown.needs_identity,true);assert.equal(unknown.curated,null);assert.equal(unknown.can_draft,false);
   difference=data.queue.find(x=>x.origin==='catalog');assert.equal(difference.needs_identity,false);assert.equal(difference.curated.name,'STABLR curato');assert.equal(difference.can_draft,true);
   await fails(()=>rpc('decide',[unknown.id,'draft','explicit']),'22023');await fails(()=>rpc('decide',[unknown.id,'ignore','']),'22023');
   const decision=await rpc('decide',[unknown.id,'ignore','Keep unidentified']);assert.deepEqual(await rpc('decide',[unknown.id,'ignore','Keep unidentified']),decision);
   assert.equal((await rpc('overview')).total,1);assert.equal((await rpc('overview',[0,true])).total,2);await role();
  });
  await t.test('idempotent run, running lease conflict and malformed input rollback',async()=>{
   assert.equal((await begin('1')).replay,true);second=await begin('2');await fails(()=>begin('concurrent'),'55P03');
   const bad=await photo();bad.records[0].source_id='fig-name-derived';await fails(()=>finish(second.id,bad),'22023');
   await db.exec('reset role');assert.equal((await db.query('select count(*) n from public.admin_fig_observations where check_id=$1',[second.id])).rows[0].n,0);await role();
   await finish(second.id,null,'SOURCE_INVALID');await role('authenticated',admin);assert.equal((await rpc('overview')).baseline.id,first.id);assert.equal((await rpc('overview')).total,1);await role();
  });
  await t.test('unreachable source failure cannot advance baseline or create removals',async()=>{
   third=await begin('3');await finish(third.id,null,'SOURCE_UNAVAILABLE');await role('authenticated',admin);const data=await rpc('overview');assert.equal(data.baseline.id,first.id);assert.equal(data.last_check.failure_code,'SOURCE_UNAVAILABLE');assert.equal(data.total,1);await role();
  });
  await t.test('unchanged photograph, persistent editorial ignore, new baseline',async()=>{
   await role('authenticated',admin);await rpc('decide',[difference.id,'ignore','Intentional curated divergence']);await role();
   fourth=await begin('4');await finish(fourth.id,await photo());await role('authenticated',admin);const data=await rpc('overview');assert.equal(data.baseline.id,fourth.id);assert.equal(data.total,0);await role();
  });
  await t.test('changed unidentified row is not falsely joined; catalog FIG change queues three-way difference',async()=>{
   await db.exec("reset role;update public.fig_clubs set name='FIG nuova fonte' where id='"+fig+"'");await role();const next=await begin('5');await finish(next.id,await photo(34));
   await role('authenticated',admin);const data=await rpc('overview');const unknown=data.queue.filter(x=>x.origin==='public');assert.equal(unknown.length,2);assert.ok(unknown.every(x=>x.needs_identity&&!x.curated));
   difference=data.queue.find(x=>x.origin==='catalog');assert.equal(difference.kind,'changed');assert.equal(difference.before.name,'FIG pubblicato');assert.equal(difference.after.name,'FIG nuova fonte');assert.equal(difference.curated.name,'STABLR curato');await role();
  });
  await t.test('explicit draft proposal writes draft/audit only, checks base and protects existing changed draft',async()=>{
   await role('authenticated',admin);const decision=await rpc('decide',[difference.id,'draft','Reviewed name change only']);assert.ok(decision.draft_id);assert.equal(decision.club_id,club);
   assert.deepEqual(await rpc('decide',[difference.id,'draft','Reviewed name change only']),decision);
   await db.exec('reset role');assert.deepEqual((await original()).rows,liveBefore);assert.equal((await db.query('select snapshot from public.admin_catalog_drafts where draft_id=$1',[decision.draft_id])).rows[0].snapshot.name,'FIG nuova fonte');
   assert.equal((await db.query('select count(*) n from public.admin_catalog_versions')).rows[0].n,0);
   await db.exec("update public.fig_clubs set name='FIG altra fonte'");await role();const next=await begin('6');await finish(next.id,await photo(34));await role('authenticated',admin);
   const changed=(await rpc('overview')).queue.find(x=>x.origin==='catalog');await fails(()=>rpc('decide',[changed.id,'draft','Must not overwrite existing draft']),'40001');
   await db.exec('reset role');assert.equal((await db.query('select count(*) n from public.admin_fig_decisions where difference_id=$1',[changed.id])).rows[0].n,0);await role();
  });
  await t.test('non-corresponding decision does not mutate live matching; photos/audit immutable',async()=>{
   await role('authenticated',admin);const changed=(await rpc('overview')).queue.find(x=>x.origin==='catalog');await rpc('decide',[changed.id,'not_corresponding','Reject governance relationship']);await role();
   await db.exec('reset role');assert.deepEqual((await original()).rows,liveBefore);
   for(const name of names.slice(1))await fails(()=>db.exec(`delete from public.${name}`),'55000');
   await fails(()=>db.exec('truncate public.admin_fig_checks cascade'),'55000');
   await fails(()=>db.exec("update public.admin_fig_checks set status='failed' where status='success'"),'55000');
   await role('authenticated',admin);await db.exec('begin read only');await rpc('overview',[0,true]);await db.exec('commit');await role();
  });
  await t.test('transactional rollback includes snapshot and check status; expired lease cannot finish later',async()=>{
   const changedPhoto=await photo(33);
   const next=await begin('7');await db.exec("reset role;create function public.fixture_fail_fig() returns trigger language plpgsql as $$begin raise exception 'fixture' using errcode='23514';end$$;create trigger fixture_fail before insert on public.admin_fig_catalog_states for each row execute function public.fixture_fail_fig()");await role();
   await fails(()=>finish(next.id,changedPhoto),'23514');await db.exec('reset role');assert.equal((await db.query('select count(*) n from public.admin_fig_observations where check_id=$1',[next.id])).rows[0].n,0);
   await db.exec('drop trigger fixture_fail on public.admin_fig_catalog_states');
   // Fixture-only clock simulation. Production trigger forbids changing dates.
   await db.exec('alter table public.admin_fig_checks disable trigger admin_fig_check_guard');await db.query("update public.admin_fig_checks set started_at=now()-interval '11 minutes' where id=$1",[next.id]);await db.exec('alter table public.admin_fig_checks enable trigger admin_fig_check_guard');await role();
   const replacement=await begin('8');assert.equal((await finish(next.id,changedPhoto)).status,'failed');await finish(replacement.id,null,'SOURCE_UNAVAILABLE');
  });
  await t.test('fixed definer paths, one-shot migration, no live DML or consumer trigger',async()=>{
   await db.exec('reset role');const functions=(await db.query("select proconfig from pg_proc where proname in ('admin_fig_service','admin_fig_check_begin','admin_fig_check_finish','admin_fig_overview','admin_fig_decide')")).rows;assert.ok(functions.every(f=>f.proconfig.includes('search_path=pg_catalog')));
   assert.ok(!/\b(?:insert into|update|delete from) public\.(?:clubs|fig_clubs|course_routes|route_holes|route_tees|combination_tees|rounds)\b/i.test(sql));
   await fails(()=>db.exec(sql),'42P07');await db.exec('rollback');assert.deepEqual((await original()).rows,liveBefore);
  });
  await t.test('new link conflict is queued even when FIG fields have not changed; no name matching',async()=>{
   await db.exec('reset role');await db.query("insert into public.clubs(id,name,city,name_normalized,is_active,fig_club_id,fig_match_status,playable) values($1,'Other explicitly linked Club',null,'other',true,$2,'matched',true)",[player,fig]);await role();
   const next=await begin('9');await finish(next.id,await photo(34));await role('authenticated',admin);
   const conflicts=(await rpc('overview')).queue.filter(d=>d.origin==='catalog'&&d.kind==='conflict');assert.equal(conflicts.length,1);assert.equal(conflicts[0].curated,null);assert.equal(conflicts[0].needs_identity,true);assert.equal(conflicts[0].can_draft,false);
   await db.exec('reset role');await db.query('delete from public.clubs where id=$1',[player]);assert.deepEqual((await original()).rows,liveBefore);
  });
 } finally {await db.close();}
});
