// Isolated PostgreSQL/WASM. All records and source evidence are test fixtures.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const readSql = (name) => readFile(new URL(`../../supabase/${name}`, import.meta.url), 'utf8');
const [schema, extension, figSchema, matching, workflow, foundation, migration] = await Promise.all([
  'shared-catalog-schema.sql','fig-whs-extension.sql','fig-catalog-schema.sql','fig-club-matching.sql',
  'admin-catalog-workflow.sql','admin-catalog-physical-foundation.sql','admin-catalog-structure-review.sql'
].map(readSql));
const admin='11111111-1111-4111-8111-111111111111', player='22222222-2222-4222-8222-222222222222';
const club='33333333-3333-4333-8333-333333333333', other='44444444-4444-4444-8444-444444444444';
const inactive='55555555-5555-4555-8555-555555555555', front='66666666-6666-4666-8666-666666666666';
const back='77777777-7777-4777-8777-777777777777', combination='88888888-8888-4888-8888-888888888888';
const fig='99999999-9999-4999-8999-999999999999', batch='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const newTables=['admin_catalog_physical_structures','admin_catalog_physical_holes','admin_catalog_playable_configurations',
  'admin_catalog_configuration_holes','admin_catalog_tee_overrides','admin_catalog_foundation_events'];
const oldTables=['clubs','course_routes','route_holes','route_combinations','route_combination_holes','route_tees','combination_tees',
  'fig_clubs','fig_playable_courses','fig_import_batches','rounds','round_holes','admin_catalog_drafts','admin_catalog_versions'];

test('Phase 2 structure review: guarded read-only evidence and explicit foundation-only decisions', async(t)=>{
  const db=new PGlite();
  const role=async(name='authenticated',uid=admin,claim=name)=>{
    await db.exec(`reset role;set role ${name}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,claim]);
  };
  const fail=(fn,code)=>assert.rejects(fn,e=>e.code===code);
  const rpc=async(name,params=[]) => (await db.query(`select * from public.${name}(${params.map((_,i)=>`$${i+1}`).join(',')})`,params)).rows[0];
  const queue=async()=> (await rpc('admin_catalog_structure_review_queue')).admin_catalog_structure_review_queue.items;
  const detail=async(type='structure',id=club)=>(await rpc('admin_catalog_structure_review_detail',[type,id])).admin_catalog_structure_review_detail;
  const records=async()=>{
    await db.exec('reset role');const rows=[];
    for(const name of oldTables) rows.push((await db.query(`select to_jsonb(t) value from public.${name} t order by to_jsonb(t)::text`)).rows);
    await role();return rows;
  };
  const createStructure=(id=club)=>rpc('admin_catalog_foundation_create_structure',[id,'Physical fixture','fig','fixture:source','Manual fixture review']);
  const classify=(s,classification,confirm)=>rpc('admin_catalog_foundation_review_structure',[s.id,s.revision,classification,'fig','fixture:source','Manual fixture review',confirm]);
  let baseline, structure, configuration;
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create table public.profiles(id uuid primary key references auth.users,role text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
      insert into auth.users values('${admin}'),('${player}');insert into public.profiles values('${admin}','admin'),('${player}','user');`);
    for(const name of ['clubs','course_routes','route_holes','route_combinations','route_combination_holes','rounds','round_holes'])
      await db.exec(schema.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    for(const name of ['route_tees','combination_tees'])
      await db.exec(extension.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    for(const name of ['fig_import_batches','fig_clubs','fig_playable_courses'])
      await db.exec(figSchema.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    await db.exec(matching);
    await db.exec(`alter table public.clubs add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.course_routes add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.route_combinations add column source_system text,add column source_external_id text,add column source_payload jsonb;
      insert into public.fig_import_batches(id,source_url,scraped_at,imported_at) values('${batch}','https://fixture.invalid',now(),'2026-10-01T12:00:00Z');
      insert into public.fig_clubs(id,import_batch_id,source_external_id,name,name_normalized,source_payload)
        values('${fig}','${batch}','fig-fixture','Club fixture','club fixture','{"physical_holes_count":9}');
      insert into public.fig_playable_courses(fig_club_id,source_external_id,name,name_normalized,holes_count,course_type,course_composition)
        values('${fig}','fig-course-fixture','Repeat fixture','repeat fixture',18,'repeat_9','{"rounds":2}');
      insert into public.clubs(id,name,name_normalized,created_by,fig_club_id,source_system,source_payload,is_active) values
        ('${club}','Club fixture','club fixture','${admin}','${fig}','gesgolf','{"physical_hole_count":9,"protected_manual":true}',true),
        ('${other}','Club fixture','club fixture other','${admin}',null,'gesgolf','{}',true),
        ('${inactive}','Inactive fixture','inactive fixture','${admin}',null,'gesgolf','{}',false);
      insert into public.course_routes(id,club_id,name,holes_count,total_par,source_system,source_payload) values
        ('${front}','${club}','Front fixture',9,36,'gesgolf','{"source_id":"front-fixture"}'),
        ('${back}','${club}','Back fixture',9,36,'gesgolf','{"source_id":"back-fixture"}');
      insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) select '${front}',n,4,n from generate_series(1,9)n;
      insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) select '${back}',n,4,n from generate_series(10,18)n;
      insert into public.route_combinations(id,club_id,name,front_route_id,back_route_id,total_par,source_system)
        values('${combination}','${club}','Combination fixture','${front}','${back}',72,'gesgolf');
      insert into public.route_combination_holes(route_combination_id,round_hole_number,route_id,route_position,physical_hole_number,par,stroke_index)
        select '${combination}',n,case when n<=9 then '${front}'::uuid else '${back}'::uuid end,case when n<=9 then 1 else 2 end,
          case when n<=9 then n else n-9 end,4,n from generate_series(1,18)n;
      insert into public.rounds(user_id,club_id,holes_count,total_par,round_type,selected_routes)
        values('${player}','${club}',9,36,'single_9','[{"route_name":"Historical fixture","par":36}]');
      insert into public.round_holes(round_id,user_id,club_id,route_id,round_hole_number,route_position,physical_hole_number,par,stroke_index)
        select id,user_id,club_id,'${front}',1,1,1,4,1 from public.rounds;`);
    await db.exec(workflow);await db.exec(foundation);await role();
    const draft=await rpc('admin_catalog_create_draft',['club',{name:'Historical fixture'},club]);
    await db.exec('reset role');
    await db.query(`insert into public.admin_catalog_versions(entity_type,entity_key,live_entity_id,source_draft_id,version_number,schema_version,snapshot,published_by)
      values('club',$1,$2,$3,1,1,'{"name":"Historical fixture"}',$4)`,[draft.entity_key,club,draft.draft_id,admin]);
    const policies=(await db.query('select * from pg_policies order by tablename,policyname')).rows;
    const privileges=(await db.query("select * from information_schema.role_table_grants where table_schema='public' order by table_name,grantee,privilege_type")).rows;
    const triggers=(await db.query("select t.oid,pg_get_triggerdef(t.oid) definition from pg_trigger t order by t.oid")).rows;
    const functions=(await db.query("select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid")).rows;
    baseline=await records();await db.exec('reset role');await db.exec(migration);await role();

    await t.test('two read RPCs only; tables, policies, triggers, functions and data remain unchanged',async()=>{
      await db.exec('reset role');
      assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows,policies);
      assert.deepEqual((await db.query("select * from information_schema.role_table_grants where table_schema='public' order by table_name,grantee,privilege_type")).rows,privileges);
      assert.deepEqual((await db.query("select t.oid,pg_get_triggerdef(t.oid) definition from pg_trigger t order by t.oid")).rows,triggers);
      assert.deepEqual((await db.query("select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname not like 'admin_catalog_structure_review_%' order by p.oid")).rows,functions);
      const added=(await db.query("select prosecdef,provolatile,proconfig from pg_proc where proname like 'admin_catalog_structure_review_%'")).rows;
      assert.equal(added.length,2);assert.ok(added.every(p=>p.prosecdef&&p.provolatile==='s'&&p.proconfig.includes('search_path=pg_catalog')));
      await role();assert.deepEqual(await records(),baseline);
    });
    await t.test('both RPCs reject anon, player, service API, missing UID and wrong JWT role',async()=>{
      for(const args of [['anon','','anon'],['authenticated',player,'authenticated'],['service_role',admin,'service_role'],['authenticated','','authenticated'],['authenticated',admin,'anon']]){
        await role(...args);await fail(queue,'42501');await fail(()=>detail(),'42501');
      }
      await role();
    });
    await t.test('queue derives pending candidates without creating foundation data or classifying by source',async()=>{
      const items=await queue();assert.equal(items.length,3);assert.ok(items.every(i=>i.status==='needs_review'));
      assert.ok(!items.some(i=>i.club_id===inactive));
      assert.equal(items.find(i=>i.target_id===club).classification,null);
      assert.equal(items.find(i=>i.target_id===combination).verified_hole_count,0);
      for(const table of newTables) assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,0);
    });
    await t.test('detail follows only explicit FIG FK and exposes real payload, import, exact missing references and empty audit',async()=>{
      const d=await detail();assert.equal(d.fig.id,fig);assert.equal(d.fig.import_batch.id,batch);
      assert.equal(d.fig.courses[0].course_type,'repeat_9');assert.equal(d.club.source_payload.protected_manual,true);
      assert.equal(d.courses.length,2);assert.equal(d.combinations[0].holes.length,18);
      assert.equal(d.combinations[0].holes.filter(h=>!h.exact_legacy_reference_exists).length,9);
      assert.deepEqual(d.events,[]);assert.deepEqual(d.structures,[]);assert.deepEqual(d.configurations,[]);
      assert.equal((await detail('structure',other)).fig,null); // same name must not match
      await fail(()=>detail('invalid',club),'22023');await fail(()=>detail('structure',inactive),'22023');
      await fail(()=>detail('hole_links',front),'22023');
      for(const table of newTables) assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,0);
    });
    await t.test('explicit creation/nonclassification is resumable and stays pending with immutable audit',async()=>{
      structure=await createStructure();assert.equal(structure.classification,'non_classificato');
      structure=await classify(structure,'non_classificato',false);
      assert.equal((await queue()).find(i=>i.target_id===club).status,'needs_review');
      const d=await detail();assert.equal(d.structures[0].id,structure.id);assert.equal(d.events.length,2);
      assert.ok(d.events.every(e=>e.actor_id===admin&&e.entity_table==='admin_catalog_physical_structures'));
      assert.ok(d.events.some(e=>e.before_snapshot&&e.after_snapshot.classification==='non_classificato'));
      for(const table of newTables.slice(1,5)) assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,0);
    });
    await t.test('classified clubs remain consultable but combination requires independent verified mapping',async()=>{
      const stale={...structure};structure=await classify(structure,'fisico_9',true);
      await fail(()=>classify(stale,'fisico_18',true),'40001');
      const items=await queue();assert.equal(items.find(i=>i.target_id===club).status,'verified');
      assert.equal(items.find(i=>i.target_id===club).classification,'fisico_9');
      assert.equal(items.find(i=>i.target_id===combination).status,'needs_review');
      const d=await detail('hole_links',combination);assert.equal(d.structures[0].review_status,'verified');assert.equal(d.events.length,3);
      assert.deepEqual(await records(),baseline);
    });
    await t.test('cardinality alone and pending configurations never imply verified combination; only explicit complete review does',async()=>{
      configuration=await rpc('admin_catalog_foundation_create_configuration',[club,'Combination proposal',18,'fig','fixture:source','Explicit fixture mapping',null,combination]);
      configuration=await rpc('admin_catalog_foundation_review_configuration',[configuration.id,configuration.revision,structure.id,'autonomous',null,null,'fig','fixture:source','Explicit fixture mapping',false]);
      const physical=[];
      for(let n=1;n<=9;n++) physical.push(await rpc('admin_catalog_foundation_create_physical_hole',[structure.id,n,`Hole ${n}`,4,'fig','fixture:source','Manual physical identity',true]));
      for(let n=1;n<=18;n++){
        await rpc('admin_catalog_foundation_record_configuration_hole',[configuration.id,configuration.revision,n,n<=9?1:2,physical[(n-1)%9].id,'inherited',null,n,'fig','fixture:source','Manual link',true,null,null]);
        configuration=(await db.query('select * from public.admin_catalog_playable_configurations where id=$1',[configuration.id])).rows[0];
        if(n===9){const row=(await queue()).find(i=>i.target_id===combination);assert.equal(row.verified_hole_count,9);assert.equal(row.status,'needs_review');}
      }
      let row=(await queue()).find(i=>i.target_id===combination);assert.equal(row.verified_hole_count,18);assert.equal(row.status,'needs_review');
      await rpc('admin_catalog_foundation_review_configuration',[configuration.id,configuration.revision,structure.id,'autonomous',null,null,'fig','fixture:source','Explicit final verification',true]);
      row=(await queue()).find(i=>i.target_id===combination);assert.equal(row.status,'verified');
      const d=await detail('hole_links',combination);assert.equal(d.configurations[0].holes.length,18);
      assert.ok(d.events.some(e=>e.entity_table==='admin_catalog_configuration_holes'));
      assert.ok(d.events.every(e=>e.after_snapshot.club_id===club));
    });
    await t.test('all current data and history stay immutable and one-shot reapplication rolls back',async()=>{
      assert.deepEqual(await records(),baseline);
      await db.exec('reset role');await fail(()=>db.exec(migration),'42723');await db.exec('rollback');await role();
      assert.ok((await queue()).some(i=>i.target_id===club&&i.status==='verified'));
      assert.deepEqual(await records(),baseline);
    });
  }finally{await db.close();}
});
