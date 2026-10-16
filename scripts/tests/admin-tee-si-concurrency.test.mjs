// Real separate PostgreSQL sessions; temporary local cluster, never production.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {setupSi,call,role,admin,other} from './helpers/tee-si-fixture.mjs';
const enabled=!!process.env.STABLR_PG_BIN&&!!process.env.STABLR_PG_MODULE;
test('native tee SI: two Admin sessions, source phantoms, atomic rollback',{skip:!enabled},async t=>{
  const pg=await import(process.env.STABLR_PG_MODULE),Client=pg.Client||pg.default?.Client;
  const root=await mkdtemp(join(tmpdir(),'stablr-si-pg-')),data=join(root,'data'),bin=process.env.STABLR_PG_BIN;
  const run=(name,args)=>{const r=spawnSync(join(bin,name),args,{encoding:'utf8',timeout:30000});if(r.status!==0)throw new Error(`Local ${name}: ${r.stderr}`);};
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  run('initdb',['-D',data,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C']);let started=false,a,b;
  const wrap=c=>({query:(...args)=>c.query(...args),exec:text=>c.query(text)});
  const fail=(action,code='55P03')=>assert.rejects(action,e=>e.code===code);
  try {
    run('pg_ctl',['start','-D',data,'-l',join(root,'postgres.log'),'-o',`-p ${port} -h 127.0.0.1 -k ${root}`,'-w']);started=true;
    const opts={host:'127.0.0.1',port,user:'postgres',database:'postgres'};a=new Client(opts);b=new Client(opts);await a.connect();await b.connect();
    const da=wrap(a),db=wrap(b),{tee,combination}=await setupSi(da);await role(db,'authenticated',other);
    const first=await call(da,tee,'open'),second=await call(db,tee,'open');
    const fields={mode:'managed',holes:first.draft.snapshot.holes.map((h,i)=>({...h,si:i===0?first.context.holes[1].standard_si:i===1?first.context.holes[0].standard_si:null}))};
    let d=(await call(da,tee,'save',first.draft,fields)).draft;
    const otherDraft=(await call(db,tee,'save',second.draft,fields)).draft;
    let preview=await call(da,tee,'preview',d);
    await t.test('own draft CAS and advisory NOWAIT prevent concurrent saves',async()=>{
      await role(db,'authenticated',admin);await a.query('begin');const updated=await call(da,tee,'save',d,fields);
      await fail(()=>call(db,tee,'save',d,fields));await a.query('commit');await fail(()=>call(db,tee,'save',d,fields),'40001');
      d=updated.draft;preview=await call(da,tee,'preview',d);await role(db,'authenticated',other);
    });
    await t.test('source writes and overlapping draft phantoms refuse publication before any write',async()=>{
      for(const [sql,args] of [
        ['update public.combination_tees set slope_rating=slope_rating where id=$1',[tee.id]],
        ['update public.route_combination_holes set stroke_index=stroke_index where route_combination_id=$1',[combination.id]],
        ['lock table public.admin_catalog_configuration_holes in row exclusive mode',[]]
      ]){
        await b.query('reset role;begin');await b.query(sql,args);await fail(()=>call(da,tee,'publish',d,null,preview.confirmation_hash,'TEST'));await b.query('rollback');
      }
      await role(db,'authenticated',other);await b.query('begin');await call(db,tee,'save',otherDraft,fields);
      await fail(()=>call(da,tee,'publish',d,null,preview.confirmation_hash,'TEST'));await b.query('rollback');
    });
    await t.test('one publisher wins; rollback restores projection, version and open draft together',async()=>{
      await a.query('begin');await call(da,tee,'publish',d,null,preview.confirmation_hash,'TEST');
      const op=await call(db,tee,'preview',otherDraft);await fail(()=>call(db,tee,'publish',otherDraft,null,op.confirmation_hash,'TEST'));
      await b.query("reset role;set lock_timeout='100ms'");
      await fail(()=>b.query('update public.route_combination_holes set stroke_index=stroke_index where route_combination_id=$1',[combination.id]));
      await a.query('rollback');await role(db,'authenticated',other);
      assert.equal((await call(da,tee,'detail')).context.current,null);assert.equal((await call(da,tee,'detail')).history.length,0);
      assert.equal((await call(da,tee,'detail')).draft.draft_id,d.draft_id);
      preview=await call(da,tee,'preview',d);await call(da,tee,'publish',d,null,preview.confirmation_hash,'TEST committed');
      const stale=await call(db,tee,'preview',otherDraft);assert.equal(stale.can_publish,false);
      await fail(()=>call(db,tee,'publish',otherDraft,null,stale.confirmation_hash,'TEST'),'40001');
      assert.equal((await call(da,tee,'detail')).history.length,1);assert.equal((await call(db,tee,'detail')).draft.workflow_status,'draft');
    });
  }finally{
    for(const c of [a,b])if(c){try{await c.query('rollback');}catch{}await c.end();}
    if(started)run('pg_ctl',['stop','-D',data,'-m','fast','-w']);
  }
});
