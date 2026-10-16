// Independent local PostgreSQL sessions only. No network/database credentials.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {admin,other,setupCombinationTees,role,sql,rpc} from './helpers/combination-tee-fixture.mjs';
const enabled=!!process.env.STABLR_PG_BIN&&!!process.env.STABLR_PG_MODULE;
test('catalog metadata native concurrency: locks, changed projection and dependency writers',{skip:!enabled},async t=>{
  const pg=await import(process.env.STABLR_PG_MODULE),Client=pg.Client||pg.default?.Client;
  const root=await mkdtemp(join(tmpdir(),'stablr-metadata-pg-')),data=join(root,'data'),bin=process.env.STABLR_PG_BIN;
  const run=(name,args)=>{const r=spawnSync(join(bin,name),args,{encoding:'utf8',timeout:30000});if(r.status!==0)throw new Error(`Local ${name}: ${r.stderr}`);};
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  run('initdb',['-D',data,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C']);let started=false,a,b;
  const wrap=client=>({query:(...args)=>client.query(...args),exec:text=>client.query(text)});
  const locked=action=>assert.rejects(action,e=>e.code==='55P03');
  try{
    run('pg_ctl',['start','-D',data,'-l',join(root,'postgres.log'),'-o',`-p ${port} -h 127.0.0.1 -k ${root}`,'-w']);started=true;
    const settings={host:'127.0.0.1',port,user:'postgres',database:'postgres'};
    a=new Client(settings);b=new Client(settings);await a.connect();await b.connect();const da=wrap(a),db=wrap(b);
    const {combination}=await setupCombinationTees(da),target=combination.front_route_id;
    await a.query('reset role');await a.query(await sql('admin-catalog-editor-metadata'));await role(da);await role(db,'authenticated',other);
    const call=(conn,action,args=[])=>rpc(conn,'admin_catalog_metadata',['route',target,action,...args]);
    const open=conn=>call(conn,'open');
    const save=(conn,d,notes)=>call(conn,'save',[d.draft_id,d.revision,{...d.snapshot,notes}]);
    const preview=(conn,d)=>call(conn,'preview',[d.draft_id,d.revision]);
    const publish=(conn,d,p)=>call(conn,'publish',[d.draft_id,d.revision,null,p.confirmation_hash,'Native explicit confirmation']);
    let first=await save(da,(await open(da)).draft,'Prima decisione'),second=await save(db,(await open(db)).draft,'Seconda decisione');
    const pa=await preview(da,first),pb=await preview(db,second);
    await t.test('same personal draft CAS and NOWAIT protect save/publication',async()=>{
      await a.query('begin');await save(da,first,'Concurrent save');await role(db,'authenticated',admin);
      await locked(()=>save(db,first,'Other tab'));await locked(()=>publish(db,first,pa));
      await a.query('rollback');await role(db,'authenticated',other);
    });
    await t.test('source mutation and dependency phantom insertion cannot race publication',async()=>{
      await b.query('reset role');await b.query('begin');await b.query('update public.route_holes set par=par where route_id=$1',[target]);
      await locked(()=>publish(da,first,pa));await b.query('rollback');await role(db,'authenticated',other);
      await a.query('begin');await publish(da,first,pa);await b.query("reset role;set lock_timeout='100ms'");
      await locked(()=>b.query("insert into public.route_tees(route_id,tee_name,holes_count) values($1,'Concurrent tee',9)",[target]));
      await a.query('rollback');await role(db,'authenticated',other);
    });
    await t.test('two Admins: metadata-only first commit invalidates the other base even without live timestamp change',async()=>{
      await a.query('reset role');const before=(await a.query('select updated_at from public.course_routes where id=$1',[target])).rows[0];await role(da);
      await a.query('begin');await publish(da,first,pa);await locked(()=>publish(db,second,pb));await a.query('commit');
      await assert.rejects(()=>publish(db,second,pb),e=>e.code==='40001');
      await a.query('reset role');const after=(await a.query('select updated_at from public.course_routes where id=$1',[target])).rows[0];assert.deepEqual(after,before);
      assert.equal((await a.query('select count(*)::int n from public.admin_catalog_versions where live_entity_id=$1',[target])).rows[0].n,1);
      assert.equal((await a.query('select workflow_status from public.admin_catalog_drafts where draft_id=$1',[second.draft_id])).rows[0].workflow_status,'draft');
      assert.equal((await a.query('select revision::int n from public.catalog_editor_metadata where live_entity_id=$1',[target])).rows[0].n,1);
    });
  }finally{
    if(a)await a.end();if(b)await b.end();if(started)run('pg_ctl',['stop','-D',data,'-m','fast','-w']);
  }
});
