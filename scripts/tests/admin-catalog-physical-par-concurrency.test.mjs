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
test('native PostgreSQL: independent Admins, NOWAIT phantoms and publication locks',{skip:!enabled},async t=>{
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
    const proposal=await rpc(a,'admin_catalog_par_tee_proposal',[club.id]);
    await t.test('two Admins confirming same batch cannot race or create duplicate classification/audit',async()=>{
      await a.query('begin');await rpc(a,'admin_catalog_par_tee_confirm',[club.id,proposal.proposal_hash,'Native approval',true]);
      await b.query('set role authenticated');await assert.rejects(()=>rpc(b,'admin_catalog_par_tee_confirm',[club.id,proposal.proposal_hash,'Other actor approval',true]),e=>e.code==='55P03');await a.query('commit');
      await assert.rejects(()=>rpc(b,'admin_catalog_par_tee_confirm',[club.id,proposal.proposal_hash,'Other actor approval',true]),e=>e.code==='40001');
      assert.equal((await a.query('select count(*)::int n from public.admin_catalog_par_tee_batches')).rows[0].n,1);assert.equal((await a.query('select count(*)::int n from public.admin_catalog_tee_classification_events')).rows[0].n,2);
    });
    const hole=(await rpc(a,'admin_catalog_par_list',[club.id])).holes[0];
    await t.test('concurrent live update/tee insertion and catalog draft insertion are blocked by publication lock',async()=>{
      await a.query('begin');const d=await rpc(a,'admin_catalog_par_open',[hole.id]);
      await b.query('reset role');await b.query("set lock_timeout='100ms'");
      for(const [q,args] of [['update public.route_holes set par=5 where route_id=$1',[course.id]],
        ["insert into public.route_tees(route_id,tee_name,holes_count,par_total) values($1,'Concurrent phantom',9,35)",[course.id]]])await assert.rejects(()=>b.query(q,args),e=>e.code==='55P03');
      await assert.rejects(()=>rpc(b,'admin_course_open_draft',[course.id]),e=>e.code==='55P03');
      await b.query('set role authenticated');await assert.rejects(()=>rpc(b,'admin_catalog_par_open',[hole.id]),e=>e.code==='55P03');await a.query('rollback');
      assert.equal((await a.query('select count(*)::int n from public.admin_catalog_par_drafts')).rows[0].n,0);assert.ok(d.draft.id);
    });
    await t.test('writer holding catalog row/table first makes publisher fail NOWAIT without even saving a draft',async()=>{
      await b.query('reset role;begin');await b.query('update public.course_routes set total_par=total_par where id=$1',[course.id]);
      await assert.rejects(()=>rpc(a,'admin_catalog_par_open',[hole.id]),e=>e.code==='55P03');await b.query('rollback');
      assert.equal((await a.query('select count(*)::int n from public.admin_catalog_par_drafts')).rows[0].n,0);
    });
    await t.test('an untouched catalog draft stays nonblocking, but concurrent real edits are still locked out',async()=>{
      const empty=(await rpc(a,'admin_course_open_draft',[course.id])).draft;
      await a.query('begin');let d=await rpc(a,'admin_catalog_par_open',[hole.id]);d=await rpc(a,'admin_catalog_par_save',[d.draft.id,d.draft.revision,5]);assert.equal(d.can_publish,true,JSON.stringify(d.blockers));
      await b.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);await b.query('set role authenticated');
      await assert.rejects(()=>rpc(b,'admin_course_save_draft',[empty.draft_id,{...empty.snapshot,name:'Concurrent real edit'},empty.revision]),e=>e.code==='55P03');
      await a.query('rollback');await b.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
      assert.deepEqual((await a.query('select snapshot from public.admin_catalog_drafts where draft_id=$1',[empty.draft_id])).rows[0].snapshot,empty.snapshot);
    });
    await t.test('real PostgreSQL publishes atomically and rejects changed revision on replay',async()=>{
      let d=await rpc(a,'admin_catalog_par_open',[hole.id]);d=await rpc(a,'admin_catalog_par_save',[d.draft.id,d.draft.revision,5]);assert.equal(d.can_publish,true,JSON.stringify(d.blockers));
      const receipt=await rpc(a,'admin_catalog_par_publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Native controlled fixture',true]);assert.equal(receipt.tee_count,2);
      await assert.rejects(()=>rpc(a,'admin_catalog_par_publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Native controlled fixture',true]),e=>e.code==='40001');
      assert.deepEqual((await a.query('select holes_count,par_total from public.route_tees order by holes_count')).rows,[{holes_count:9,par_total:36},{holes_count:18,par_total:72}]);
    });
  }finally{
    if(a){try{await a.query('rollback');}catch{}await a.end();}if(b){try{await b.query('rollback');}catch{}await b.end();}
    if(started)run('pg_ctl',['stop','-D',data,'-m','fast','-w']);
    // Preserve recoverable local fixture directory; never delete user paths.
  }
});
