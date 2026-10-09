// Real catalog-shaped fixture captured with GET only; all SQL runs in isolation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
const {PGlite}=await import(process.env.STABLR_PGLITE_MODULE||'@electric-sql/pglite');
const fixture=JSON.parse(await readFile(new URL('./fixtures/parco-de-medici-multi9-preview.json',import.meta.url),'utf8'));
const files=['shared-catalog-schema.sql','fig-whs-extension.sql','admin-catalog-workflow.sql','admin-catalog-physical-foundation.sql','admin-catalog-physical-course-links.sql','admin-catalog-playable-configurations.sql','admin-catalog-physical-18-configurations.sql','admin-catalog-structure-club-lock.sql','admin-catalog-multi9.sql','admin-catalog-multi9-club-proposals.sql','admin-catalog-multi9-preview-repair.sql'];
const sql=await Promise.all(files.map(f=>readFile(new URL('../../supabase/'+f,import.meta.url),'utf8')));
const admin='11111111-1111-4111-8111-111111111111',player='22222222-2222-4222-8222-222222222222';
for (const deployment of ['obsolete_structure_only','club_proposals_applied']) test('real Parco De Medici preview repair: '+deployment,async(t)=>{
 const db=new PGlite();
 const role=async(name='authenticated',uid=admin)=>{
  await db.exec('reset role;set role '+name);
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,name]);
 };
 const rpc=async(name='admin_catalog_multi9_batch_preview',args=[null])=>(await db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') j',args)).rows[0].j;
 const foundationTables=['admin_catalog_physical_structures','admin_catalog_physical_holes','admin_catalog_physical_course_links','admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_foundation_events','admin_catalog_multi9_batches','admin_catalog_configuration_components'];
 const empty=async()=>{for(const table of foundationTables)assert.equal((await db.query('select count(*)::int n from public.'+table)).rows[0].n,0);};
 try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key references auth.users,role text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;grant usage on schema auth to anon,authenticated,service_role;create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;");
  await db.query('insert into auth.users values($1),($2)',[admin,player]);await db.query("insert into public.profiles values($1,'admin'),($2,'user')",[admin,player]);
  for(const name of ['clubs','course_routes','route_holes','route_combinations','route_combination_holes','rounds','round_holes'])await db.exec(sql[0].match(new RegExp('create table public\\.'+name+' \\([\\s\\S]*?\\n\\);'))[0]);
  for(const name of ['route_tees','combination_tees'])await db.exec(sql[1].match(new RegExp('create table if not exists public\\.'+name+' \\([\\s\\S]*?\\n\\);'))[0]);
  for(const name of ['clubs','course_routes','route_combinations'])await db.exec('alter table public.'+name+' add column source_system text,add column source_external_id text,add column source_payload jsonb');
  for(const s of sql.slice(2,9))await db.exec(s);
  const insert=async(table,rows)=>{for(const row of rows){const keys=Object.keys(row);await db.query('insert into public.'+table+'('+keys.join(',')+') values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys.map(k=>row[k]));}};
  await insert('clubs',[{...fixture.club,created_by:admin}]);await insert('course_routes',fixture.routes);await insert('route_holes',fixture.holes);await insert('route_combinations',fixture.combinations);await insert('route_combination_holes',fixture.slots);
  await role();
  await t.test('the historical endpoint reproduces exactly zero selected and zero excluded with the real pilot rows',async()=>{
   const response=await rpc();assert.deepEqual(response.candidates,[]);assert.deepEqual(response.excluded,[]);await empty();
  });
  await db.exec('reset role');
  if(deployment==='club_proposals_applied') await db.exec(sql[9]);
  const registrationSignature='public.admin_catalog_multi9_batch_register(jsonb,text,boolean)';
  const definition=async()=>(await db.query('select pg_get_functiondef($1::regprocedure) body',[registrationSignature])).rows[0].body;
  const registerBefore=await definition();
  await db.exec(sql[10]);
  if(deployment==='club_proposals_applied') assert.equal(await definition(),registerBefore,'existing registration body must remain byte-for-byte unchanged');
  await role();
  await t.test('repaired discovery returns the real unclassified pilot: three nines, 27 physical holes, four official combinations',async()=>{
   const response=await rpc('admin_catalog_multi9_proposal_preview');assert.equal(response.preview_contract,2);assert.equal(response.discovery_scope,'clubs_with_combinations');assert.equal(response.candidates.length,1);assert.equal(response.excluded.length,0);
   const c=response.candidates[0];assert.equal(c.club_id,fixture.club.id);assert.equal(c.club_name,"Parco De' Medici");
   assert.equal(c.classification_proposal,'multi_9');assert.equal(c.structure_id,null);assert.equal(c.structure_proposal.action,'create');
   assert.equal(c.courses.length,3);assert.equal(c.physical_hole_count,27);assert.equal(c.combinations.length,4);assert.equal(c.configuration_count,7);
   assert.deepEqual(c.combinations.map(x=>x.id).sort(),fixture.combinations.map(x=>x.id).sort());
   assert.ok(c.combinations.every(x=>x.sequence.length===18&&x.sequence.every(h=>h.source_hole_id)));
   await empty();
  });
  await t.test('an unresolved exact reference returns the pilot among exclusions with a concrete reason, never silently drops it',async()=>{
   const slot=fixture.slots.find(h=>h.round_hole_number===1);
   await db.exec('reset role');await db.query('update public.route_combination_holes set physical_hole_number=18 where id=$1',[slot.id]);await role();
   const response=await rpc('admin_catalog_multi9_proposal_preview');assert.equal(response.candidates.length,0);assert.equal(response.excluded.length,1);
   const c=response.excluded[0];assert.equal(c.club_id,fixture.club.id);assert.ok(c.reasons.includes('invalid_combination'));
   assert.ok(c.combinations.find(x=>x.id===slot.route_combination_id).reasons.includes('non_unique_exact_reference'));await empty();
  });
  await t.test('declared preview denies anon, player and service API, and never falls back to an unprotected reader',async()=>{
   for(const [name,uid] of [['anon',''],['authenticated',player],['service_role',admin]]){
    await role(name,uid);
    for(const [name,args] of [['admin_catalog_multi9_proposal_preview',[null]],['admin_catalog_multi9_batch_preview',[null]],['admin_catalog_multi9_club_preview',[fixture.club.id]],['admin_catalog_multi9_club_inspect',[fixture.club.id]],['admin_catalog_multi9_club_apply',[fixture.club.id,{},'test']],['admin_catalog_multi9_batch_register',[[],'test',true]]])
     await assert.rejects(()=>rpc(name,args),e=>e.code==='42501');
   }
   await role();await empty();
  });
  await t.test('one-shot second application fails atomically without foundation writes',async()=>{
   await db.exec('reset role');await assert.rejects(()=>db.exec(sql[10]),/already applied/);await db.exec('rollback');await role();await empty();
  });
 }finally{await db.close();}
});
