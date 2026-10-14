// Separate native PostgreSQL sessions, local temporary cluster only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { admin,other,setupCombinationTees,role,sql,rpc,fields,open,openNew,save,preview,publish } from './helpers/combination-tee-fixture.mjs';
const enabled=!!process.env.STABLR_PG_BIN&&!!process.env.STABLR_PG_MODULE;
test('native combination tees: Admin races, source locks and rollback',{skip:!enabled},async t=>{
  const pg=await import(process.env.STABLR_PG_MODULE),Client=pg.Client||pg.default?.Client;
  const root=await mkdtemp(join(tmpdir(),'stablr-combination-tee-pg-')),data=join(root,'data'),bin=process.env.STABLR_PG_BIN;
  const run=(name,args)=>{const r=spawnSync(join(bin,name),args,{encoding:'utf8',timeout:30000});if(r.status!==0)throw new Error(`Local ${name}: ${r.stderr}`);};
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  run('initdb',['-D',data,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C']);let started=false,a,b;
  const wrap=client=>({query:(...args)=>client.query(...args),exec:text=>client.query(text)});
  const fails=(action,code='55P03')=>assert.rejects(action,e=>e.code===code);
  try{
    run('pg_ctl',['start','-D',data,'-l',join(root,'postgres.log'),'-o',`-p ${port} -h 127.0.0.1 -k ${root}`,'-w']);started=true;
    const settings={host:'127.0.0.1',port,user:'postgres',database:'postgres'};a=new Client(settings);b=new Client(settings);await a.connect();await b.connect();
    const da=wrap(a),db=wrap(b),{combination,tee}=await setupCombinationTees(da);
    await a.query('reset role');await da.exec(await sql('admin-combination-tee-crud'));await role(da);await role(db,'authenticated',other);
    let first=(await openNew(da,combination.id)).draft,second=(await openNew(db,combination.id)).draft;
    first=await save(da,first,fields());second=await save(db,second,fields({gender:'women'}));
    await t.test('duplicate first publication: one Admin succeeds, concurrent one fails explicitly and cannot insert a second tee/version',async()=>{
      await a.query('begin');await publish(da,first);await fails(()=>publish(db,second));await a.query('commit');await fails(()=>publish(db,second),'23505');
      assert.equal((await rpc(db,'admin_combination_tee_resume_new_draft',[second.draft_id])).draft.workflow_status,'draft');
      await a.query('reset role');assert.equal((await a.query('select count(*)::int n from public.combination_tees where tee_name=$1',[fields().tee_name])).rows[0].n,1);
      assert.equal((await a.query("select count(*)::int n from public.admin_catalog_versions where entity_type='combination_tee'")).rows[0].n,1);await role(da);
    });
    let next=(await openNew(da,combination.id)).draft;next=await save(da,next,fields({tee_name:'Protected source'}));
    await t.test('legacy tee/hole/parent writer causes NOWAIT refusal before any publication',async()=>{
      for(const [statement,ids] of [
        ['update public.combination_tees set slope_rating=slope_rating where id=$1',[tee.id]],
        ['update public.route_combination_holes set par=par where route_combination_id=$1',[combination.id]],
        ['update public.route_holes set par=par where route_id=$1',[combination.front_route_id]],
        ['update public.course_routes set name=name where id=$1',[combination.front_route_id]],
        ['update public.route_combinations set total_par=total_par where id=$1',[combination.id]]]){
        await b.query('reset role;begin');await b.query(statement,ids);await fails(()=>publish(da,next));await b.query('rollback');
      }await role(db,'authenticated',other);assert.equal((await preview(da,next)).can_publish,true);
    });
    await t.test('a publication protects source and tee phantoms; rolling back leaves no live/history/closed draft',async()=>{
      await a.query('begin');await publish(da,next);await b.query("reset role;set lock_timeout='100ms'");
      await fails(()=>b.query('update public.route_combination_holes set stroke_index=stroke_index where route_combination_id=$1',[combination.id]));
      await fails(()=>b.query('update public.route_holes set par=par where route_id=$1',[combination.front_route_id]));
      await fails(()=>b.query("insert into public.combination_tees(route_combination_id,tee_name,holes_count) values($1,'Phantom',18)",[combination.id]));
      await fails(()=>b.query('update public.route_combinations set name=name where id=$1',[combination.id]));
      await a.query('rollback');await role(db,'authenticated',other);
      assert.equal((await preview(da,next)).can_publish,true);await a.query('reset role');
      assert.equal((await a.query('select count(*)::int n from public.combination_tees where id=$1',[next.entity_key])).rows[0].n,0);
      assert.equal((await a.query("select count(*)::int n from public.admin_catalog_versions where entity_type='combination_tee'")).rows[0].n,1);await role(da);
    });
    await t.test('same draft CAS and two Admin edits cannot silently overwrite another revision/publication',async()=>{
      await role(db,'authenticated',admin);await a.query('begin');const saved=await save(da,next,{tee_name:'New revision'});
      await fails(()=>save(db,next,{tee_name:'Stale revision'}));await a.query('commit');await fails(()=>save(db,next,{tee_name:'Stale revision'}),'40001');
      await fails(()=>publish(db,next),'40001');assert.equal((await rpc(db,'admin_combination_tee_resume_new_draft',[next.draft_id])).draft.revision,saved.revision);
      let ea=(await open(da,tee.id)).draft;ea=await save(da,ea,{course_rating:72.5});await role(db,'authenticated',other);let eb=(await open(db,tee.id)).draft;eb=await save(db,eb,{slope_rating:126});
      await a.query('begin');await publish(da,ea);await fails(()=>publish(db,eb));await a.query('commit');await fails(()=>publish(db,eb),'40001');
    });
  }finally{
    for(const client of [a,b])if(client){try{await client.query('rollback');}catch{}await client.end();}
    if(started)run('pg_ctl',['stop','-D',data,'-m','fast','-w']);
  }
});
