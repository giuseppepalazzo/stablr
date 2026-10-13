// Local isolated PostgreSQL; fixtures never connect to production.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const sql = name => readFile(new URL(`../../supabase/${name}.sql`,import.meta.url),'utf8');
const migration = await sql('admin-new-club-course-holes');
const admin='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const player='33333333-3333-4333-8333-333333333333',live='44444444-4444-4444-8444-444444444444';
test('private new Club hole grids: permissions, cardinality, SI, revisions and non-destructive archival',async t=>{
  const db=new PGlite();
  const asRole=async(name,uid='')=>{await db.exec(`reset role;set role ${name}`);await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,name]);};
  const fails=(fn,code)=>assert.rejects(fn,e=>e.code===code);
  const open=async course=>(await db.query('select public.admin_new_course_holes_open($1) result',[course.draft_id])).rows[0].result;
  const summary=async parent=>(await db.query('select public.admin_new_course_holes_summaries($1) result',[parent.draft_id])).rows[0].result;
  const save=async(result,snapshot=result.draft.snapshot,revision=result.draft.revision,courseRevision=result.course.revision)=>(await db.query(
    'select * from public.admin_new_course_holes_save($1,$2::jsonb,$3::bigint,$4::bigint)',[result.draft.draft_id,JSON.stringify(snapshot),revision,courseRevision])).rows[0];
  const archive=async result=>(await db.query('select * from public.admin_new_course_holes_archive($1,$2::bigint,$3::bigint)',[result.draft.draft_id,result.draft.revision,result.course.revision])).rows[0];
  const full=count=>({holes_count:count,holes:Array.from({length:count},(_,i)=>({physical_hole_number:i+1,par:4,stroke_index:count-i}))});
  const copy=value=>JSON.parse(JSON.stringify(value));
  const unchanged=async()=>{
    await db.exec('reset role');
    for(const table of ['clubs','course_routes','route_holes','route_tees','route_combinations','route_combination_holes','combination_tees','rounds','round_holes'])
      assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,1,table);
    assert.deepEqual((await db.query('select par,stroke_index from public.route_holes')).rows,[{par:4,stroke_index:1}]);
    assert.equal((await db.query('select count(*)::int n from public.admin_catalog_versions')).rows[0].n,0);
    await asRole('authenticated',admin);
  };
  try{
    await db.exec(`
      create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
      create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key references auth.users,role text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'');$$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin');$$;
      insert into auth.users values('${admin}'),('${other}'),('${player}');
      insert into public.profiles values('${admin}','admin'),('${other}','admin'),('${player}','user');
      create table public.clubs(id uuid primary key,name text,city text,is_active boolean,updated_at timestamptz default now());
      create table public.course_routes(id uuid primary key,club_id uuid,name text,holes_count integer,total_par integer,display_order integer,is_active boolean,source_system text,source_external_id text,source_payload jsonb,updated_at timestamptz);
      create table public.route_holes(id uuid primary key,route_id uuid,par integer,stroke_index integer);
      create table public.route_tees(id uuid primary key,route_id uuid,holes_count integer,is_active boolean);
      create table public.route_combinations(id uuid primary key,front_route_id uuid,back_route_id uuid,is_active boolean);
      create table public.route_combination_holes(id uuid primary key,route_id uuid);
      create table public.combination_tees(id uuid primary key);
      create table public.rounds(id uuid primary key,selected_routes jsonb);
      create table public.round_holes(id uuid primary key,route_id uuid);
      insert into public.clubs values('${live}','Live fixture',null,true,now());
      insert into public.course_routes(id,club_id,name,holes_count,is_active) values('${live}','${live}','Live course',9,true);
      insert into public.route_holes values('${live}','${live}',4,1);
      insert into public.route_tees(id) values('${live}');insert into public.route_combinations(id) values('${live}');
      insert into public.route_combination_holes(id) values('${live}');insert into public.combination_tees values('${live}');
      insert into public.rounds(id) values('${live}');insert into public.round_holes(id) values('${live}');
    `);
    for(const name of ['admin-catalog-workflow','admin-club-editor','admin-course-editor','admin-catalog-abandon-draft','admin-new-club-courses'])await db.exec(await sql(name));
    const policies=(await db.query('select * from pg_policies')).rows;
    await db.exec(migration);await asRole('authenticated',admin);
    const parent=(await db.query("select * from public.admin_catalog_create_draft('club',$1::jsonb)",[JSON.stringify({name:'Private club',city:null})])).rows[0];
    const course=async count=>(await db.query('select * from public.admin_new_club_course_save($1,$2::jsonb)',[parent.draft_id,JSON.stringify({name:`Private ${count}`,holes_count:count,display_order:0})])).rows[0];
    const nine=await course(9),eighteen=await course(18);let n,e;
    await t.test('no backfill/live writes or new DML grants; summary is read-only',async()=>{
      await db.exec('begin read only');assert.deepEqual(await summary(parent),[]);await db.exec('commit');
      await db.exec('reset role');assert.deepEqual((await db.query('select * from pg_policies')).rows,policies);
      assert.equal((await db.query("select count(*)::int n from public.admin_catalog_drafts where entity_type='new_course_holes_grid'")).rows[0].n,0);
      for(const role of ['anon','authenticated','service_role'])for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE'])
        assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,'public.admin_catalog_drafts',privilege])).rows[0].allowed,false);
      await unchanged();
    });
    await t.test('explicit open/resume yields one grid with 9/18 readonly slots and NULL data, no generated Par/SI',async()=>{
      const attempts=await Promise.all([open(nine),open(nine)]);assert.equal(attempts[0].draft.draft_id,attempts[1].draft.draft_id);
      n=attempts[0];e=await open(eighteen);
      for(const [result,count] of [[n,9],[e,18]]){
        assert.equal(result.draft.parent_draft_id,result.course.draft_id);assert.equal(result.draft.live_entity_id,null);
        assert.equal(result.draft.base_snapshot,null);assert.equal(result.draft.base_version_id,null);
        assert.equal(result.draft.entity_type,'new_course_holes_grid');assert.equal(result.configured,false);
        assert.equal(result.draft.snapshot.holes.length,count);
        assert.deepEqual(result.draft.snapshot.holes.map(h=>h.physical_hole_number),Array.from({length:count},(_,i)=>i+1));
        assert.ok(result.draft.snapshot.holes.every(h=>h.par===null&&h.stroke_index===null));
      }
      await unchanged();
    });
    await t.test('complete Par 3/4/5 with exact own SI permutations configures both 9 and 18 and sums Par',async()=>{
      n.draft=await save(n,full(9));e.draft=await save(e,full(18));
      const rows=await summary(parent);
      assert.deepEqual(rows.map(x=>[x.configured,x.total_par]).sort((a,b)=>a[1]-b[1]),[[true,36],[true,72]]);
      assert.deepEqual((await open(nine)).draft.snapshot,full(9));await unchanged();
    });
    await t.test('partial and duplicate SI drafts stay incomplete, never become configured',async()=>{
      const partial=full(9);partial.holes[0].par=null;n.draft=await save(n,partial);
      assert.equal((await summary(parent)).find(x=>x.course_draft_id===nine.draft_id).configured,false);
      const dup=full(9);dup.holes[1].stroke_index=9;n.draft=await save(n,dup);
      assert.equal((await summary(parent)).find(x=>x.course_draft_id===nine.draft_id).configured,false);
      n.draft=await save(n,full(9));
    });
    await t.test('allowlist, number/order, cardinality, Par domain and SI bounds cannot be bypassed',async()=>{
      const bad=[null,[],{}, {...full(9),holes_count:18},{...full(9),holes:full(9).holes.slice(1)},{...full(9),total_par:36}];
      for(const [key,value] of [['par',2],['par',6],['par',4.5],['par','4'],['stroke_index',0],['stroke_index',10],['stroke_index',1.5],['stroke_index','1'],['physical_hole_number',2],['id',live],['distance',120]]){
        const snapshot=full(9);snapshot.holes[0][key]=value;bad.push(snapshot);
      }
      const reordered=full(9);reordered.holes.reverse();bad.push(reordered);
      for(const snapshot of bad)await fails(()=>save(n,snapshot),'22023');
      assert.deepEqual((await open(nine)).draft.snapshot,full(9));
      const wrong=full(18);wrong.holes[0].stroke_index=19;await fails(()=>save(e,wrong),'22023');
    });
    await t.test('anon/player/missing UID/service/another Admin are rejected by all RPCs and generic saves',async()=>{
      for(const [role,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',''],['service_role',admin],['authenticated',other]]){
        await asRole(role,uid);await fails(()=>open(nine),'42501');await fails(()=>summary(parent),'42501');await fails(()=>save(n),'42501');await fails(()=>archive(n),'42501');
      }
      await asRole('authenticated',other);
      await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3)',[n.draft.draft_id,JSON.stringify(full(9)),n.draft.revision]),'42501');
      await asRole('authenticated',admin);
      await fails(()=>db.query("select public.admin_catalog_create_draft('new_course_holes_grid',$1::jsonb,null,$2)",[JSON.stringify(full(9)),nine.draft_id]),'22023');
    });
    await t.test('grid and parent revision conflicts preserve snapshots with no partial writes',async()=>{
      const stale=copy(n);n.draft=await save(n,full(9));await fails(()=>save(stale),'40001');await fails(()=>save(n,n.draft.snapshot,null),'22023');
      const renamed=(await db.query('select * from public.admin_new_club_course_save($1,$2::jsonb,$3,$4)',[parent.draft_id,JSON.stringify({...nine.snapshot,name:'Renamed'}),nine.draft_id,nine.revision])).rows[0];
      await fails(()=>save(n),'40001');await fails(()=>archive(n),'40001');n=await open(renamed);
      const attempts=await Promise.allSettled([save(n),save(n)]);assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(attempts.find(x=>x.status==='rejected').reason.code,'40001');n=await open(renamed);
    });
    await t.test('changing 9/18 while a grid exists is blocked, including generic workflow writes',async()=>{
      await fails(()=>db.query('select public.admin_new_club_course_save($1,$2::jsonb,$3,$4)',[parent.draft_id,JSON.stringify({...n.course.snapshot,holes_count:18}),n.course.draft_id,n.course.revision]),'22023');
      await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3)',[n.course.draft_id,JSON.stringify({...n.course.snapshot,holes_count:18}),n.course.revision]),'22023');
      await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3)',[n.draft.draft_id,JSON.stringify({...full(9),tee:'forbidden'}),n.draft.revision]),'22023');
      await fails(()=>db.query('select public.admin_course_publish_draft($1,$2)',[n.draft.draft_id,n.draft.revision]),'42501');
      await unchanged();
    });
    await t.test('abandon archives values, leaves course intact, frees structure and next open creates a new empty grid',async()=>{
      const archived=await archive(n);assert.equal(archived.workflow_status,'archived');assert.deepEqual(archived.snapshot,full(9));
      assert.equal((await summary(parent)).some(x=>x.course_draft_id===n.course.draft_id),false);
      await fails(()=>save(n),'40001');
      const changed=(await db.query('select * from public.admin_new_club_course_save($1,$2::jsonb,$3,$4)',[parent.draft_id,JSON.stringify({...n.course.snapshot,holes_count:18}),n.course.draft_id,n.course.revision])).rows[0];
      const fresh=await open(changed);assert.notEqual(fresh.draft.draft_id,n.draft.draft_id);assert.equal(fresh.draft.snapshot.holes.length,18);
      assert.ok(fresh.draft.snapshot.holes.every(h=>h.par===null&&h.stroke_index===null));
      await db.query("select public.admin_catalog_archive_draft($1,'route',$2)",[changed.draft_id,changed.revision]);
      await fails(()=>open(changed),'40001');await fails(()=>save(fresh),'40001');await unchanged();
    });
    await t.test('closed Club disables remaining grids; second migration application rolls back',async()=>{
      await db.query("select public.admin_catalog_archive_draft($1,'club',$2)",[parent.draft_id,parent.revision]);
      await fails(()=>summary(parent),'40001');await fails(()=>open(eighteen),'40001');await fails(()=>save(e),'40001');
      await db.exec('reset role');const before=(await db.query('select count(*)::int n from public.admin_catalog_drafts')).rows[0].n;
      await fails(()=>db.exec(migration),'42P07');await db.exec('rollback');
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_drafts')).rows[0].n,before);await unchanged();
    });
  }finally{await db.close();}
});
