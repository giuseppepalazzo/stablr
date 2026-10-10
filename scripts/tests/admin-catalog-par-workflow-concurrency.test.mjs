// Native PostgreSQL with independent sessions. Optional portable runtime paths;
// never uses an existing/server/production database or any Supabase credential.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
const enabled=!!process.env.STABLR_PG_BIN&&!!process.env.STABLR_PG_MODULE;
test('native Par workflow: batch, local CAS and phantom/legacy locks',{skip:!enabled},async t=>{
  const pg=await import(process.env.STABLR_PG_MODULE),Client=pg.Client||pg.default?.Client;
  const root=await mkdtemp(join(tmpdir(),'stablr-par-pg-')),data=join(root,'data'),bin=process.env.STABLR_PG_BIN;
  const run=(name,args)=>{const r=spawnSync(join(bin,name),args,{encoding:'utf8',timeout:30000});if(r.status!==0)throw new Error(`Local ${name} failed: ${r.stderr}`);};
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  run('initdb',['-D',data,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C']);
  let started=false,a,b;
  const admin='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
  const sql=n=>readFile(new URL('../../supabase/'+n,import.meta.url),'utf8');
  const rpc=async(c,n,args=[])=>(await c.query('select to_jsonb(public.'+n+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')) result',args.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v))).rows[0].result;
  try{
    run('pg_ctl',['start','-D',data,'-l',join(root,'postgres.log'),'-o',`-p ${port} -h 127.0.0.1 -k ${root}`,'-w']);started=true;
    const settings={host:'127.0.0.1',port,user:'postgres',database:'postgres'};a=new Client(settings);b=new Client(settings);await a.connect();await b.connect();
    await a.query("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key references auth.users,role text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;grant usage on schema auth to anon,authenticated,service_role;create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;");
    await a.query('insert into auth.users values($1),($2)',[admin,other]);await a.query("insert into public.profiles values($1,'admin'),($2,'admin')",[admin,other]);
    const schema=await sql('shared-catalog-schema.sql'),extension=await sql('fig-whs-extension.sql');
    for(const n of ['clubs','course_routes','route_holes','route_combinations','route_combination_holes','rounds','round_holes'])await a.query(schema.match(new RegExp('create table public\\.'+n+' \\([\\s\\S]*?\\n\\);'))[0]);
    for(const n of ['route_tees','combination_tees'])await a.query(extension.match(new RegExp('create table if not exists public\\.'+n+' \\([\\s\\S]*?\\n\\);'))[0]);
    for(const n of ['clubs','course_routes','route_combinations'])await a.query('alter table public.'+n+' add column source_system text,add column source_external_id text,add column source_payload jsonb');
    for(const n of ['admin-catalog-workflow.sql','admin-club-editor.sql','admin-course-editor.sql','admin-catalog-abandon-draft.sql','admin-route-editor.sql','admin-hole-grid-editor.sql','admin-course-hole-grid-editor.sql','admin-course-tee-editor.sql','admin-catalog-physical-foundation.sql','admin-catalog-physical-course-links.sql','admin-catalog-playable-configurations.sql','admin-catalog-physical-18-configurations.sql','admin-catalog-structure-club-lock.sql','admin-catalog-multi9.sql','admin-catalog-multi9-club-proposals.sql','admin-catalog-multi9-preview-repair.sql','admin-catalog-data-origin.sql','admin-catalog-tee-classifications.sql','admin-catalog-physical-par.sql','admin-catalog-physical-par-source-drafts.sql'])await a.query(await sql(n));
    await a.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[admin]);
    await b.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[other]);
    const club=(await a.query("insert into public.clubs(name,name_normalized,created_by) values('Native nine','native',$1) returning id",[admin])).rows[0];
    const course=(await a.query("insert into public.course_routes(club_id,name,holes_count,total_par) values($1,'Nine',9,35) returning id",[club.id])).rows[0];
    await a.query('insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) select $1,n,case when n=7 then 3 else 4 end,n*2-1 from generate_series(1,9)n',[course.id]);
    await a.query("insert into public.route_tees(route_id,tee_name,holes_count,par_total) values($1,'Same exact tee',9,35),($1,'Same exact tee',18,70)",[course.id]);
    let s=await rpc(a,'admin_catalog_foundation_create_structure',[club.id,'Native verified structure','stablr','Exact native fixture','Explicit fixture']);
    s=await rpc(a,'admin_catalog_foundation_review_structure',[s.id,s.revision,'fisico_9','stablr','Exact native fixture','Explicit fixture',true]);
    let p=await rpc(a,'admin_catalog_physical_course_preview',[s.id,course.id]);p=await rpc(a,'admin_catalog_physical_course_register',[s.id,course.id,s.revision,p.source,'Explicit source',true]);p=await rpc(a,'admin_catalog_physical_course_verify',[p.link.id,p.link.revision,p.mapping,'Verified fixture',true]);
    for(const kind of ['autonomous_9','repeated_18']){let cfg=await rpc(a,'admin_catalog_playable_preview',[s.id,p.link.id,kind]);cfg=await rpc(a,'admin_catalog_playable_register',[s.id,p.link.id,kind,cfg.baseline,'Explicit fixture',true]);await rpc(a,'admin_catalog_playable_verify',[cfg.configuration.id,cfg.configuration.revision,cfg.baseline,cfg.saved_holes,'Verified fixture',true]);}

    await a.query(await sql('admin-catalog-par-workflow.sql'));
    const route=(await a.query("insert into public.course_routes(club_id,name,holes_count,total_par) values($1,'Independent native nine',9,35) returning id",[club.id])).rows[0];
    await a.query('insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) select $1,n,case when n=7 then 3 else 4 end,n from generate_series(1,9)n',[route.id]);
    const preview=await rpc(a,'admin_catalog_par_workflow_preview');
    await b.query('set role authenticated');
    await t.test('two Admin approvals are NOWAIT, one immutable receipt, exact retry',async()=>{
      await a.query('begin');const receipt=await rpc(a,'admin_catalog_par_workflow_confirm',[preview,'Native batch',true]);
      await assert.rejects(()=>rpc(b,'admin_catalog_par_workflow_confirm',[preview,'Other Admin',true]),e=>e.code==='55P03');
      await a.query('commit');assert.deepEqual(await rpc(a,'admin_catalog_par_workflow_confirm',[preview,'Native batch',true]),receipt);
      await assert.rejects(()=>rpc(b,'admin_catalog_par_workflow_confirm',[preview,'Other Admin',true]),e=>e.code==='40001');
      assert.equal((await a.query('select count(*)::int n from public.admin_catalog_par_workflow_batches')).rows[0].n,1);
    });
    const row=(await a.query('select id from public.route_holes where route_id=$1 and physical_hole_number=1',[route.id])).rows[0];
    await t.test('local publication reserve blocks concurrent live writer, phantom tee and draft insertion',async()=>{
      await a.query('begin');const d=await rpc(a,'admin_catalog_local_par_open',['course',route.id,row.id]);
      await b.query('reset role');await b.query("set lock_timeout='100ms'");
      for(const [q,args] of [
        ['update public.route_holes set par=5 where id=$1',[row.id]],
        ["insert into public.route_tees(route_id,tee_name,holes_count,par_total) values($1,'Concurrent tee',9,35)",[route.id]],
      ])await assert.rejects(()=>b.query(q,args),e=>e.code==='55P03');
      await assert.rejects(()=>rpc(b,'admin_course_open_draft',[route.id]),e=>e.code==='55P03');
      await b.query('set role authenticated');await assert.rejects(()=>rpc(b,'admin_catalog_local_par_open',['course',route.id,row.id]),e=>e.code==='55P03');await a.query('rollback');assert.ok(d.draft.id);
    });
    await t.test('two owned unchanged drafts coexist, first publish makes second baseline stale without auto-rebase',async()=>{
      let first=await rpc(a,'admin_catalog_local_par_open',['course',route.id,row.id]),second=await rpc(b,'admin_catalog_local_par_open',['course',route.id,row.id]);
      first=await rpc(a,'admin_catalog_local_par_save',[first.draft.id,first.draft.revision,5,false]);assert.equal(first.can_publish,true,JSON.stringify(first.blockers));
      await a.query('begin');await rpc(a,'admin_catalog_local_par_publish',[first.draft.id,first.draft.revision,first.baseline_hash,'Native local publication',true]);
      await assert.rejects(()=>rpc(b,'admin_catalog_local_par_save',[second.draft.id,second.draft.revision,6,false]),e=>e.code==='55P03');await a.query('commit');
      await assert.rejects(()=>rpc(b,'admin_catalog_local_par_save',[second.draft.id,second.draft.revision,6,false]),e=>e.code==='40001');
      assert.equal((await a.query('select total_par from public.course_routes where id=$1',[route.id])).rows[0].total_par,36);
      assert.equal((await a.query('select status from public.admin_catalog_local_par_drafts where id=$1',[second.draft.id])).rows[0].status,'draft');
    });
    await t.test('physical parent is not blocked by an unrelated local draft in the same club',async()=>{
      const h=(await rpc(a,'admin_catalog_par_list',[club.id])).holes[0];let d=await rpc(a,'admin_catalog_par_open',[h.id]);d=await rpc(a,'admin_catalog_par_save',[d.draft.id,d.draft.revision,5]);assert.equal(d.can_publish,true,JSON.stringify(d.blockers));
      await rpc(a,'admin_catalog_par_publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Native physical with independent local grid',true]);
      assert.deepEqual((await a.query('select holes_count,par_total from public.route_tees where route_id=$1 order by holes_count',[course.id])).rows,[{holes_count:9,par_total:36},{holes_count:18,par_total:72}]);
    });
  }finally{
    if(a){try{await a.query('rollback');}catch{}await a.end();}if(b){try{await b.query('rollback');}catch{}await b.end();}
    if(started)run('pg_ctl',['stop','-D',data,'-m','fast','-w']);
  }
});

