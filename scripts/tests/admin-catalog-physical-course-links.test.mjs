// PostgreSQL/WASM only: every club/course/source is an isolated test fixture.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite }=await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const sql=(name)=>readFile(new URL(`../../supabase/${name}`,import.meta.url),'utf8');
const [schema,extension,workflow,foundation,migration]=await Promise.all([
  'shared-catalog-schema.sql','fig-whs-extension.sql','admin-catalog-workflow.sql',
  'admin-catalog-physical-foundation.sql','admin-catalog-physical-course-links.sql'].map(sql));
const admin='11111111-1111-4111-8111-111111111111',player='22222222-2222-4222-8222-222222222222';
const club='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
const live=['clubs','course_routes','route_holes','route_combinations','route_combination_holes','route_tees','combination_tees','rounds','round_holes','admin_catalog_drafts','admin_catalog_versions'];
test('Phase 3a physical course identity registration and separate 1:1 verification',async(t)=>{
  const db=new PGlite();
  const role=async(name='authenticated',uid=admin,claim=name)=>{await db.exec(`reset role;set role ${name}`);await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,claim]);};
  const rpc=async(name,args=[])=> (await db.query(`select * from public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args)).rows[0];
  const preview=async(s,c=null)=>(await rpc('admin_catalog_physical_course_preview',[s.id,c])).admin_catalog_physical_course_preview;
  const register=async(context,options={})=>(await rpc('admin_catalog_physical_course_register',[context.structure.id,context.source?.course.id || options.course,options.revision ?? context.structure.revision,options.source ?? context.source,options.reason ?? 'Explicit fixture registration',options.confirm ?? true])).admin_catalog_physical_course_register;
  const verify=async(context,options={})=>(await rpc('admin_catalog_physical_course_verify',[context.link.id,options.revision ?? context.link.revision,options.mapping ?? context.mapping,options.reason ?? 'Manual fixture 1:1 verification',options.confirm ?? true])).admin_catalog_physical_course_verify;
  const fail=(fn,code)=>assert.rejects(fn,e=>e.code===code);
  const structure=async(classification='fisico_9')=>{
    const s=await rpc('admin_catalog_foundation_create_structure',[club,`Structure ${Math.random()}`,'stablr','fixture:source','Manual classification']);
    return classification==='non_classificato' ? s : rpc('admin_catalog_foundation_review_structure',[s.id,s.revision,classification,'stablr','fixture:source','Manual classification',true]);
  };
  const numbers=(n,start=1)=>Array.from({length:n},(_,i)=>i+start);
  const oldRows=async()=>{await db.exec('reset role');const data=[];for(const name of live)data.push((await db.query(`select to_jsonb(t) j from public.${name} t order by to_jsonb(t)::text`)).rows);await role();return data;};
  const newCount=async()=> (await db.query('select count(*)::int n from public.admin_catalog_physical_course_links')).rows[0].n;
  let courses={},s9,s18,multi,registered,baseline,oldEvents,oldHole;
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key references auth.users,role text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
      insert into auth.users values('${admin}'),('${player}');insert into public.profiles values('${admin}','admin'),('${player}','user');`);
    for(const name of ['clubs','course_routes','route_holes','route_combinations','route_combination_holes','rounds','round_holes']) await db.exec(schema.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    for(const name of ['route_tees','combination_tees']) await db.exec(extension.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    await db.exec(`alter table public.clubs add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.course_routes add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.route_combinations add column source_system text,add column source_external_id text,add column source_payload jsonb;
      insert into public.clubs(id,name,name_normalized,created_by) values('${club}','Fixture club','fixture club','${admin}'),('${other}','Other fixture','other fixture','${admin}');`);
    for(const [key,count,nums,id] of [['nine',9,numbers(9),club],['eighteen',18,numbers(18),club],['missing',9,numbers(8),club],
      ['duplicate',9,[1,1,2,3,4,5,6,7,8],club],['back',9,numbers(9,10),club],['repeat',18,numbers(9),club],
      ['secondNine',9,numbers(9),club],['foreign',9,numbers(9),other],['rollback',9,numbers(9),club]]){
      const c=(await db.query("insert into public.course_routes(club_id,name,holes_count,total_par,source_system,source_payload) values($1,$2,$3,$4,'gesgolf',$5) returning *",[id,`Course fixture ${key}`,count,count*4,{source_key:key}])).rows[0];
      courses[key]=c;for(const n of nums) await db.query('insert into public.route_holes(route_id,physical_hole_number,par,stroke_index,display_label) values($1,$2,4,null,$3)',[c.id,n,`Source ${n}`]);
    }
    courses.derived=(await db.query("insert into public.course_routes(club_id,name,holes_count,source_system,source_payload) values($1,'Derived fixture',18,'gesgolf',$2) returning *",[club,{product_simplification:'physical_9_official_18_variant'}])).rows[0];
    for(const n of numbers(18)) await db.query('insert into public.route_holes(route_id,physical_hole_number,par) values($1,$2,4)',[courses.derived.id,n]);
    await db.exec(workflow);await db.exec(foundation);await role();
    const existing=await structure();oldHole=await rpc('admin_catalog_foundation_create_physical_hole',[existing.id,1,'Old proposal',null,'stablr','fixture:old','Existing pending evidence',false]);
    const draft=await rpc('admin_catalog_create_draft',['club',{name:'Historical fixture'},club]);await db.exec('reset role');
    await db.query(`insert into public.admin_catalog_versions(entity_type,entity_key,live_entity_id,source_draft_id,version_number,schema_version,snapshot,published_by) values('club',$1,$2,$3,1,1,'{"name":"Historical fixture"}',$4)`,[draft.entity_key,club,draft.draft_id,admin]);
    await db.exec(`insert into public.rounds(user_id,club_id,holes_count,total_par,round_type,selected_routes) values('${player}','${club}',9,36,'single_9','[{"par":36}]');
      insert into public.round_holes(round_id,user_id,club_id,route_id,round_hole_number,route_position,physical_hole_number,par,stroke_index) select id,user_id,club_id,'${courses.nine.id}',1,1,1,4,1 from public.rounds;`);
    const policies=(await db.query('select * from pg_policies order by tablename,policyname')).rows;
    const grants=(await db.query("select * from information_schema.role_table_grants where table_schema='public' order by table_name,grantee,privilege_type")).rows;
    const triggers=(await db.query("select oid,pg_get_triggerdef(oid) definition from pg_trigger order by oid")).rows;
    const functions=(await db.query("select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid")).rows;
    oldEvents=(await db.query('select * from public.admin_catalog_foundation_events order by id')).rows;
    baseline=await oldRows();await db.exec('reset role');await db.exec(migration);await role();

    await t.test('one-shot additive migration has no backfill, consumer changes or changes to live schema/security/history',async()=>{
      assert.equal(await newCount(),0);assert.deepEqual(await oldRows(),baseline);
      const h=(await db.query('select * from public.admin_catalog_physical_holes where id=$1',[oldHole.id])).rows[0];
      assert.equal(h.source_course_link_id,null);assert.equal(h.source_route_hole_id,null);assert.equal(h.source_position,null);
      const {source_course_link_id,source_route_hole_id,source_position,...before}=h;assert.deepEqual(before,oldHole);
      assert.deepEqual((await db.query('select * from public.admin_catalog_foundation_events order by id')).rows,oldEvents);
      await db.exec('reset role');
      assert.deepEqual((await db.query("select * from pg_policies where tablename<>'admin_catalog_physical_course_links' order by tablename,policyname")).rows,policies);
      assert.deepEqual((await db.query("select * from information_schema.role_table_grants where table_schema='public' and table_name<>'admin_catalog_physical_course_links' order by table_name,grantee,privilege_type")).rows,grants);
      assert.deepEqual((await db.query('select oid,pg_get_triggerdef(oid) definition from pg_trigger where oid=any($1::oid[]) order by oid',[triggers.map(v=>v.oid)])).rows,triggers);
      assert.deepEqual((await db.query('select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p where p.oid=any($1::oid[]) order by p.oid',[functions.map(v=>v.oid)])).rows,functions);
      await role();
    });
    await t.test('all RPCs/helpers and direct writes are denied to player, anon and service API',async()=>{
      for(const args of [['anon','','anon'],['authenticated',player,'authenticated'],['service_role',admin,'service_role'],['authenticated','','authenticated'],['authenticated',admin,'anon']]){
        await role(...args);await fail(()=>rpc('admin_catalog_physical_course_preview',[club,null]),'42501');
        await fail(()=>rpc('admin_catalog_physical_course_register',[club,courses.nine.id,1,{},'note',true]),'42501');
        await fail(()=>rpc('admin_catalog_physical_course_verify',[club,1,[],'note',true]),'42501');
      }
      await role();for(const name of ['source','inspect']) await fail(()=>rpc(`admin_catalog_physical_course_${name}`,name==='source'?[courses.nine.id]:[club,courses.nine.id]),'42501');
      await fail(()=>db.query('insert into public.admin_catalog_physical_course_links default values'),'42501');
    });
    await t.test('preview is read-only and requires a manually classified structure for registration',async()=>{
      const s=await structure('non_classificato');const p=await preview(s,courses.nine.id);
      assert.ok(p.reasons.includes('unclassified_structure'));assert.equal(p.can_register,false);
      await fail(()=>register(p),'23514');assert.equal(await newCount(),0);
      s9=await structure();s18=await structure('fisico_18');multi=await structure('multi_9');
      const empty=await preview(s9);assert.deepEqual(empty.physical_holes,[]);assert.equal(empty.source,null);assert.equal(empty.can_register,false);
      const n=await preview(s9,courses.nine.id);assert.equal(n.can_register,true);assert.equal(n.source.holes.length,9);
      assert.ok(n.source.holes.every(h=>h.stroke_index===null)); // physical identity needs no SI
      assert.deepEqual(n.physical_holes,[]);assert.deepEqual(n.links,[]);assert.equal(await newCount(),0);
    });
    await t.test('incomplete/duplicate/cardinality/numbering/foreign sources block without copying or offset',async()=>{
      for(const [key,reason] of [['missing','incomplete_holes'],['duplicate','duplicate_numbers'],['repeat','wrong_cardinality'],['back','incomplete_numbers']]){
        const p=await preview(s9,courses[key].id);assert.ok(p.reasons.includes(reason),key);await fail(()=>register(p),'23514');
      }
      assert.ok((await preview(s18,courses.nine.id)).reasons.includes('wrong_cardinality'));
      assert.ok((await preview(multi,courses.eighteen.id)).reasons.includes('wrong_cardinality'));
      const derived=await preview(s18,courses.derived.id);assert.ok(derived.reasons.includes('derived_source'));await fail(()=>register(derived),'23514');
      await fail(()=>preview(s9,courses.foreign.id),'22023');assert.equal(await newCount(),0);
    });
    await t.test('confirmation, note, exact source baseline and structure CAS are mandatory',async()=>{
      const p=await preview(s9,courses.nine.id);
      await fail(()=>register(p,{confirm:false}),'22023');await fail(()=>register(p,{reason:' '}),'22023');
      await fail(()=>register(p,{revision:p.structure.revision-1}),'40001');
      await fail(()=>register(p,{source:{...p.source,holes:p.source.holes.map((h,i)=>i===0?{...h,par:5}:h)}}),'40001');
      await db.exec('reset role');await db.query('update public.route_holes set par=5 where id=$1',[p.source.holes[0].id]);await role();
      await fail(()=>register(p),'40001');await db.exec('reset role');await db.query('update public.route_holes set par=4 where id=$1',[p.source.holes[0].id]);await role();
      assert.equal(await newCount(),0);
    });
    await t.test('registration atomically creates exact physical identities, pending source association and audit only',async()=>{
      const p=await preview(s9,courses.nine.id);registered=await register(p);
      assert.equal(registered.physical_holes.length,9);assert.equal(registered.mapping.length,9);
      assert.equal(registered.link.review_status,'needs_review');assert.equal(registered.link.revision,1);
      assert.equal(registered.can_verify,true);assert.equal(registered.can_register,false);
      assert.ok(registered.physical_holes.every(h=>h.review_status==='verified'&&h.base_par===4&&!Object.hasOwn(h,'stroke_index')));
      assert.deepEqual(registered.mapping.map(h=>h.source_hole_id),p.source.holes.map(h=>h.id));
      assert.deepEqual(registered.mapping.map(h=>h.position),numbers(9));
      assert.equal(registered.events.length,10);assert.ok(registered.events.every(e=>e.actor_id===admin));
      for(const table of ['admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_tee_overrides']) assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,0);
      await fail(()=>register(p),'23514');assert.equal(await newCount(),1);assert.deepEqual(await oldRows(),baseline);
    });
    await t.test('normal users cannot see populated source links and no client has direct DML',async()=>{
      await role('authenticated',player);assert.equal((await db.query('select count(*)::int n from public.admin_catalog_physical_course_links')).rows[0].n,0);
      await role('anon');await fail(()=>db.query('select * from public.admin_catalog_physical_course_links'),'42501');await role();
      assert.equal((await db.query("select has_table_privilege('authenticated','public.admin_catalog_physical_course_links','INSERT,UPDATE,DELETE,TRUNCATE') allowed")).rows[0].allowed,false);
    });
    await t.test('verification is separate and blocks edited mappings, changed live and stale revision',async()=>{
      await fail(()=>verify(registered,{confirm:false}),'22023');await fail(()=>verify(registered,{reason:' '}),'22023');
      await fail(()=>verify(registered,{mapping:[...registered.mapping].reverse()}),'40001');
      await fail(()=>verify(registered,{revision:0}),'40001');
      await db.exec('reset role');await db.query('update public.route_holes set par=5 where id=$1',[registered.mapping[0].source_hole_id]);await role();
      const p=await preview(s9,courses.nine.id);assert.ok(p.reasons.includes('source_changed'));assert.equal(p.can_verify,false);
      await fail(()=>verify(registered),'23514');
      await db.exec('reset role');await db.query('update public.route_holes set par=4 where id=$1',[registered.mapping[0].source_hole_id]);await role();
      // A verification with a failed audit must also keep its pending revision.
      await db.exec('reset role');await db.exec(`create function public.fixture_fail_link_verification_audit() returns trigger language plpgsql as $$begin if new.entity_table='admin_catalog_physical_course_links' and new.operation='UPDATE' then raise exception 'Fixture verification audit failure' using errcode='23514';end if;return new;end$$;
        create trigger fixture_link_verification_audit_failure before insert on public.admin_catalog_foundation_events for each row execute function public.fixture_fail_link_verification_audit();`);
      await role();await fail(()=>verify(registered),'23514');
      const pending=await preview(s9,courses.nine.id);assert.equal(pending.link.review_status,'needs_review');assert.equal(pending.link.revision,1);assert.equal(pending.events.length,10);
      await db.exec('reset role');await db.exec('drop trigger fixture_link_verification_audit_failure on public.admin_catalog_foundation_events');await role();
      const done=await verify(registered);assert.equal(done.link.review_status,'verified');assert.equal(done.link.revision,2);
      assert.equal(done.events.length,11);assert.ok(done.events.some(e=>e.operation==='UPDATE'&&e.before_snapshot.review_status==='needs_review'&&e.after_snapshot.review_status==='verified'));
      await fail(()=>verify(registered),'40001');await fail(()=>verify(done),'23514');assert.deepEqual(await oldRows(),baseline);
    });
    await t.test('no relinking, Par-based matches or physical identity merges on conflicting structures/sources',async()=>{
      const elsewhere=await structure();let p=await preview(elsewhere,courses.nine.id);assert.ok(p.reasons.includes('already_linked_elsewhere'));await fail(()=>register(p),'23514');
      p=await preview(s9,courses.secondNine.id);assert.ok(p.reasons.includes('already_linked_elsewhere'));assert.ok(p.reasons.includes('physical_numbers_in_use'));await fail(()=>register(p),'23514');
    });
    await t.test('18 preserves 1..18; multi-nine preserves source 10..18 without an offset and blocks reused numbers',async()=>{
      const eighteen=await register(await preview(s18,courses.eighteen.id));assert.deepEqual(eighteen.mapping.map(h=>h.physical_number),numbers(18));
      const second=await register(await preview(multi,courses.back.id));assert.deepEqual(second.mapping.map(h=>h.physical_number),numbers(9,10));
      assert.deepEqual(second.mapping.map(h=>h.position),numbers(9));assert.equal(second.link.review_status,'needs_review');
      const first=await register(await preview(multi,courses.secondNine.id));assert.equal(first.physical_holes.length,18);
      const fresh=await structure('multi_9');const p=await preview(fresh,courses.secondNine.id);assert.ok(p.reasons.includes('already_linked_elsewhere'));
      assert.deepEqual(await oldRows(),baseline);
    });
    await t.test('audit failure rolls back the whole registration; links and events cannot be deleted or rewritten',async()=>{
      const s=await structure();const p=await preview(s,courses.rollback.id);const before=await newCount();
      await db.exec('reset role');await db.exec(`create function public.fixture_fail_physical_audit() returns trigger language plpgsql as $$begin if new.entity_table='admin_catalog_physical_holes' and (new.after_snapshot->>'physical_number')::integer=5 then raise exception 'Fixture audit failure' using errcode='23514';end if;return new;end$$;
        create trigger fixture_physical_audit_failure before insert on public.admin_catalog_foundation_events for each row execute function public.fixture_fail_physical_audit();`);
      await role();await fail(()=>register(p),'23514');assert.equal(await newCount(),before);
      assert.deepEqual((await preview(s)).physical_holes,[]);assert.deepEqual((await preview(s)).events,[]);
      await db.exec('reset role');await db.exec('drop trigger fixture_physical_audit_failure on public.admin_catalog_foundation_events');
      await fail(()=>db.query('delete from public.admin_catalog_physical_course_links'),'55000');await fail(()=>db.query('truncate public.admin_catalog_physical_course_links cascade'),'55000');
      await fail(()=>db.query("update public.admin_catalog_foundation_events set operation='UPDATE'"),'55000');await role();
    });
    await t.test('reapplication fails atomically and current catalog, rounds, drafts and versions remain unchanged',async()=>{
      assert.deepEqual(await oldRows(),baseline);await db.exec('reset role');await fail(()=>db.exec(migration),'42P07');await db.exec('rollback');await role();
      assert.equal((await preview(s9,courses.nine.id)).link.review_status,'verified');assert.deepEqual(await oldRows(),baseline);
    });
  }finally{await db.close();}
});
