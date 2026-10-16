// Native local PostgreSQL: independent Admin sessions; no remote access.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { admin,other,setupCombinationTees,role,sql,rpc } from './helpers/combination-tee-fixture.mjs';
const enabled=!!process.env.STABLR_PG_BIN&&!!process.env.STABLR_PG_MODULE;
test('new combinations native: Admin races, sources, phantoms and private CAS',{skip:!enabled},async t=>{
  const pg=await import(process.env.STABLR_PG_MODULE),Client=pg.Client||pg.default?.Client;
  const root=await mkdtemp(join(tmpdir(),'stablr-new-combinations-pg-')),data=join(root,'data'),bin=process.env.STABLR_PG_BIN;
  const run=(name,args)=>{const r=spawnSync(join(bin,name),args,{encoding:'utf8',timeout:30000});if(r.status!==0)throw new Error(`Local ${name}: ${r.stderr}`);};
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  run('initdb',['-D',data,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C']);let started=false,a,b;
  const wrap=client=>({query:(...args)=>client.query(...args),exec:text=>client.query(text)});
  const locked=action=>assert.rejects(action,e=>e.code==='55P03');
  try{
    run('pg_ctl',['start','-D',data,'-l',join(root,'postgres.log'),'-o',`-p ${port} -h 127.0.0.1 -k ${root}`,'-w']);started=true;
    const settings={host:'127.0.0.1',port,user:'postgres',database:'postgres'};
    a=new Client(settings);b=new Client(settings);await a.connect();await b.connect();const da=wrap(a),db=wrap(b);
    const {clubId}=await setupCombinationTees(da);await a.query('reset role');await a.query(await sql('admin-combination-tee-crud'));await a.query(await sql('admin-new-combinations'));await role(da);await role(db,'authenticated',other);
    const {sections}=await rpc(da,'admin_new_combinations',[clubId]);
    await a.query('reset role');const pairs=(await a.query('select front_route_id,back_route_id from public.route_combinations where club_id=$1',[clubId])).rows;await role(da);
    const [f,k]=sections.flatMap(x=>sections.filter(y=>x.course_id!==y.course_id).map(y=>[x,y])).find(([x,y])=>!pairs.some(p=>p.front_route_id===x.course_id&&p.back_route_id===y.course_id));
    const fields={club_id:clubId,name:'New native combination',front_configuration_id:f.id,back_configuration_id:k.id,source_hash:f.source_hash+k.source_hash,
      holes:Array.from({length:18},(_,i)=>({position:i+1,si:i+1})),tees:[{name:'Giallo',tee_color:'yellow',rating_category:'men',course_rating:72,slope_rating:113,is_active:true,display_order:0}]};
    const first=await rpc(da,'admin_new_combination_save',[fields]),second=await rpc(db,'admin_new_combination_save',[fields]);
    const pa=await rpc(da,'admin_new_combination_preview',[first.draft_id]),pb=await rpc(db,'admin_new_combination_preview',[second.draft_id]);
    const publish=(conn,d,p)=>rpc(conn,'admin_new_combination_publish',[d.draft_id,d.revision,p.confirmation_hash,'Native explicit confirmation']);
    await t.test('same draft save/publish locks are NOWAIT without writes',async()=>{
      await a.query('begin');await rpc(da,'admin_new_combination_save',[fields,first.draft_id,1]);
      // Same Admin on a second connection, as two browser tabs.
      await role(db);await locked(()=>rpc(db,'admin_new_combination_save',[fields,first.draft_id,1]));await locked(()=>publish(db,first,pa));
      await a.query('rollback');await role(db,'authenticated',other);
    });
    await t.test('source writer and club-wide lock block publisher before live insertion',async()=>{
      await b.query('reset role');await b.query('begin');await b.query('update public.route_holes set par=par where route_id=$1',[f.course_id]);
      await locked(()=>publish(da,first,pa));await b.query('rollback');await role(db,'authenticated',other);
      await b.query('begin');await rpc(db,'admin_catalog_foundation_create_structure',[clubId,'Concurrent proposal','stablr','native-test','Explicit test proposal']);
      await locked(()=>publish(da,first,pa));await b.query('rollback');
    });
    await t.test('two Admins: first commits once, second blocks then detects duplicate, with no partial receipt',async()=>{
      await a.query('begin');await publish(da,first,pa);await locked(()=>publish(db,second,pb));
      await b.query("reset role;set lock_timeout='100ms'");
      await locked(()=>b.query('update public.route_holes set par=par where route_id=$1',[f.course_id]));
      await a.query('commit');await role(db,'authenticated',other);
      await assert.rejects(()=>publish(db,second,pb),e=>e.code==='23514');
      assert.equal((await rpc(db,'admin_new_combinations',[clubId])).drafts.find(d=>d.draft_id===second.draft_id).revision,1);
      await a.query('reset role');assert.equal((await a.query('select count(*)::int n from public.admin_new_combination_publications')).rows[0].n,1);
    });
  }finally{
    if(a)await a.end();if(b)await b.end();if(started)run('pg_ctl',['stop','-D',data,'-m','fast','-w']);
  }
});
