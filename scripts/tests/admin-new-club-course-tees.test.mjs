// Isolated PostgreSQL only; no remote connection or real catalog data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const sql = name => readFile(new URL(`../../supabase/${name}.sql`,import.meta.url),'utf8');
const admin='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',player='33333333-3333-4333-8333-333333333333';
const fields = (updates={}) => ({name:'Giallo',tee_color:'giallo',rating_category:'men',course_rating:70.2,slope_rating:120,is_active:true,display_order:0,...updates});
test('private course tees: complete grid, revisions, uniqueness, permissions and no live writes',async t=>{
  const db=new PGlite();let parent,course,grid,tee,context;
  const role=async(name,uid='')=>{await db.exec(`reset role;set role ${name}`);await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,name]);};
  const fails=(action,code)=>assert.rejects(action,error=>error.code===code);
  const list=async c=>(await db.query('select public.admin_new_course_tees($1) result',[(c||course).draft_id])).rows[0].result;
  const save=async(snapshot=fields(),draft=null,ctx=context)=>(await db.query('select * from public.admin_new_course_tee_save($1,$2::jsonb,$3,$4,$5,$6,$7)',
    [course.draft_id,JSON.stringify(snapshot),ctx.course_revision,ctx.grid_draft_id,ctx.grid_revision,draft?.draft_id||null,draft?.revision||null])).rows[0];
  const archive=async draft=>(await db.query('select * from public.admin_new_course_tee_archive($1,$2,$3)',[course.draft_id,draft.draft_id,draft.revision])).rows[0];
  const full=count=>({holes_count:count,holes:Array.from({length:count},(_,i)=>({physical_hole_number:i+1,par:4,stroke_index:i+1}))});
  const saveGrid=async snapshot=>{grid=(await db.query('select * from public.admin_new_course_holes_save($1,$2::jsonb,$3,$4)',[grid.draft_id,JSON.stringify(snapshot),grid.revision,course.revision])).rows[0];};
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
      create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key references auth.users,role text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'');$$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin');$$;
      insert into auth.users values('${admin}'),('${other}'),('${player}');insert into public.profiles values('${admin}','admin'),('${other}','admin'),('${player}','user');
      create table public.clubs(id uuid primary key,name text,city text,is_active boolean,updated_at timestamptz);
      create table public.course_routes(id uuid primary key,club_id uuid,name text,holes_count integer,total_par integer,display_order integer,is_active boolean,source_system text,source_external_id text,source_payload jsonb,updated_at timestamptz);
      create table public.route_holes(id uuid primary key,route_id uuid);create table public.route_tees(id uuid primary key,route_id uuid);
      create table public.route_combinations(id uuid primary key,front_route_id uuid,back_route_id uuid);create table public.route_combination_holes(id uuid primary key,route_id uuid);create table public.combination_tees(id uuid primary key);
      create table public.rounds(id uuid primary key,selected_routes jsonb);create table public.round_holes(id uuid primary key,route_id uuid);
    `);
    const liveTables=['clubs','course_routes','route_holes','route_tees','route_combinations','route_combination_holes','combination_tees','rounds','round_holes'];
    for(const table of liveTables)await db.query(`insert into public.${table}(id) values($1)`,[player]);
    const before=[];for(const table of liveTables)before.push((await db.query(`select * from public.${table}`)).rows);
    for(const name of ['admin-catalog-workflow','admin-club-editor','admin-course-editor','admin-catalog-abandon-draft','admin-new-club-courses','admin-new-club-course-holes'])await db.exec(await sql(name));
    const policies=(await db.query('select * from pg_policies')).rows;
    const migration=await sql('admin-new-club-course-tees');await db.exec(migration);await role('authenticated',admin);
    parent=(await db.query("select * from public.admin_catalog_create_draft('club',$1::jsonb)",[JSON.stringify({name:'Private',city:null})])).rows[0];
    course=(await db.query('select * from public.admin_new_club_course_save($1,$2::jsonb)',[parent.draft_id,JSON.stringify({name:'Private nine',holes_count:9,display_order:0})])).rows[0];
    await t.test('read-only list creates no grid; new tees require complete unique SI/Par',async()=>{
      await db.exec('begin read only');const result=await list();await db.exec('commit');assert.deepEqual(result.tees,[]);assert.equal(result.context.configured,false);context=result.context;
      await fails(()=>save(),'22023');assert.equal((await db.query("select count(*)::int n from public.admin_catalog_drafts where entity_type='new_course_holes_grid'")).rows[0].n,0);
      grid=(await db.query('select public.admin_new_course_holes_open($1) result',[course.draft_id])).rows[0].result.draft;
      await saveGrid(full(9));context=(await list()).context;assert.equal(context.par_total,36);
      tee=await save();assert.equal(tee.entity_type,'new_course_tee');assert.equal(tee.live_entity_id,null);assert.equal(tee.base_snapshot,null);assert.equal(tee.parent_draft_id,course.draft_id);
    });
    await t.test('rename/order/status and nullable ratings save privately; total remains derived',async()=>{
      tee=await save(fields({name:'Bianco',display_order:-2,is_active:false,course_rating:null,slope_rating:null}),tee);
      assert.equal(tee.snapshot.display_order,-2);assert.equal(tee.snapshot.is_active,false);assert.equal('par_total' in tee.snapshot,false);
      const changed=full(9);changed.holes[0].par=3;await saveGrid(changed);
      const result=await list();assert.equal(result.context.par_total,35);assert.deepEqual(result.tees[0].snapshot,tee.snapshot);context=result.context;
    });
    await t.test('allowlist, category, slope domain, order and exact identity are enforced on server',async()=>{
      for(const update of [{name:' '},{name:'a'.repeat(201)},{tee_color:'a'.repeat(101)},{rating_category:'all'},{course_rating:'70'},{slope_rating:54},{slope_rating:156},{slope_rating:100.5},{is_active:'true'},{display_order:0.5},{par_total:35},{distance:120},{holes_count:18}])
        await fails(()=>save(fields(update),tee),'22023');
      await fails(()=>save(fields({name:' BIANCO ',course_rating:null,slope_rating:null})),'23505');
      const women=await save(fields({name:'Bianco',rating_category:'women'}));assert.notEqual(women.draft_id,tee.draft_id);
      await archive(women);
      await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3)',[tee.draft_id,JSON.stringify(fields({par_total:35})),tee.revision]),'22023');
      await fails(()=>db.query("select public.admin_catalog_create_draft('new_course_tee',$1::jsonb,null,$2)",[JSON.stringify(fields()),course.draft_id]),'22023');
    });
    await t.test('tee/course/grid CAS conflicts roll back and do not rebase',async()=>{
      const old=tee;tee=await save(tee.snapshot,tee);await fails(()=>save(old.snapshot,old),'40001');await fails(()=>archive(old),'40001');
      const stale=context;await saveGrid(full(9));await fails(()=>save(tee.snapshot,tee,stale),'40001');context=(await list()).context;
      await fails(()=>save(tee.snapshot,tee,{...context,grid_draft_id:parent.draft_id}),'40001');
      const renamed=(await db.query('select * from public.admin_new_club_course_save($1,$2::jsonb,$3,$4)',[parent.draft_id,JSON.stringify({...course.snapshot,name:'Renamed'}),course.draft_id,course.revision])).rows[0];
      await fails(()=>save(tee.snapshot,tee),'40001');course=renamed;context=(await list()).context;
      const attempts=await Promise.allSettled([save(tee.snapshot,tee),save(tee.snapshot,tee)]);assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);assert.equal(attempts.find(x=>x.status==='rejected').reason.code,'40001');tee=(await list()).tees[0];
    });
    await t.test('anon/player/missing UID/service/other Admin cannot read or mutate; no direct DML',async()=>{
      for(const [name,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',''],['service_role',admin],['authenticated',other]]) {
        await role(name,uid);await fails(()=>list(),'42501');await fails(()=>save(),'42501');await fails(()=>archive(tee),'42501');
      }
      await role('authenticated',other);await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3)',[tee.draft_id,JSON.stringify(tee.snapshot),tee.revision]),'42501');
      await db.exec('reset role');for(const name of ['anon','authenticated','service_role'])for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[name,'public.admin_catalog_drafts',privilege])).rows[0].allowed,false);
      assert.deepEqual((await db.query('select * from pg_policies')).rows,policies);await role('authenticated',admin);
    });
    await t.test('incomplete grid blocks save, permits archival and does not discard stored tee',async()=>{
      const partial=full(9);partial.holes[0].par=null;await saveGrid(partial);context=(await list()).context;assert.equal(context.par_total,null);
      await fails(()=>save(tee.snapshot,tee),'22023');const result=await archive(tee);assert.equal(result.workflow_status,'archived');assert.deepEqual(result.snapshot,tee.snapshot);
      await fails(()=>archive(tee),'40001');await saveGrid(full(9));context=(await list()).context;tee=await save(fields());
      await db.query('select public.admin_new_course_holes_archive($1,$2,$3)',[grid.draft_id,grid.revision,course.revision]);
      await fails(()=>db.query('select public.admin_new_club_course_save($1,$2::jsonb,$3,$4)',[parent.draft_id,JSON.stringify({...course.snapshot,holes_count:18}),course.draft_id,course.revision]),'22023');
      await archive(tee);
    });
    await t.test('18 scope uses its full grid, closed parents disable operations, no live writes or versions',async()=>{
      const eighteen=(await db.query('select * from public.admin_new_club_course_save($1,$2::jsonb)',[parent.draft_id,JSON.stringify({name:'Private eighteen',holes_count:18,display_order:1})])).rows[0];
      const opened=(await db.query('select public.admin_new_course_holes_open($1) result',[eighteen.draft_id])).rows[0].result;
      await db.query('select public.admin_new_course_holes_save($1,$2::jsonb,$3,$4)',[opened.draft.draft_id,JSON.stringify(full(18)),opened.draft.revision,eighteen.revision]);
      course=eighteen;context=(await list()).context;assert.equal(context.par_total,72);tee=await save(fields());
      await db.query("select public.admin_catalog_archive_draft($1,'club',$2)",[parent.draft_id,parent.revision]);
      await fails(()=>list(),'40001');await fails(()=>archive(tee),'40001');await db.exec('reset role');
      for(let i=0;i<liveTables.length;i++)assert.deepEqual((await db.query(`select * from public.${liveTables[i]}`)).rows,before[i]);
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_versions')).rows[0].n,0);
      await fails(()=>db.exec(migration),'42P07');await db.exec('rollback');
    });
  } finally {await db.close();}
});
