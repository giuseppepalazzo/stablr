// Isolated PostgreSQL only: no Supabase credentials, HTTP or production data.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {admin,other,player,role,rpc,sql,setupCombinationTees,owner,dump} from './helpers/combination-tee-fixture.mjs';
const {PGlite}=await import(process.env.STABLR_PGLITE_MODULE||'@electric-sql/pglite');
const signature='(text,uuid,text,uuid,bigint,jsonb,text,text,uuid)';
const fail=(fn,code,message)=>assert.rejects(fn,e=>e.code===code&&(!message||e.message===message));

test('metadata API conflicts are non-retryable; unchanged checks, grants, history and atomic rollback',async t=>{
  const db=new PGlite();
  try{
    const {combination}=await setupCombinationTees(db),target=combination.front_route_id;
    await db.exec('reset role');await db.exec(await sql('admin-catalog-editor-metadata'));await role(db);
    const call=(kind,id,action,args=[])=>rpc(db,'admin_catalog_metadata',[kind,id,action,...args]);
    const open=(kind,id)=>call(kind,id,'open');
    const save=(kind,id,d,fields)=>call(kind,id,'save',[d.draft_id,d.revision,fields]);
    const preview=(kind,id,d)=>call(kind,id,'preview',[d.draft_id,d.revision]);
    const publish=(kind,id,d,p)=>call(kind,id,'publish',[d.draft_id,d.revision,null,p.confirmation_hash,'Explicit isolated test']);
    const first=(await open('route',target)).draft;
    await fail(()=>preview('route',target,{...first,revision:99}),'40001','Bozza cambiata o chiusa');
    const before=await dump(db);
    const definition=(await owner(db,'select pg_get_functiondef($1::regprocedure) definition',['public.admin_catalog_metadata'+signature])).rows[0].definition;
    const migration=await sql('admin-catalog-metadata-conflict-errors');
    await db.exec('reset role');await db.exec(migration);await role(db);

    await t.test('migration changes no data or original implementation and cannot be reapplied',async()=>{
      assert.deepEqual(await dump(db),before);
      const original=(await owner(db,'select pg_get_functiondef($1::regprocedure) definition',['public.admin_catalog_metadata_before_conflict_errors'+signature])).rows[0].definition;
      assert.equal(original.replace('admin_catalog_metadata_before_conflict_errors','admin_catalog_metadata'),definition);
      await db.exec('reset role');
      await fail(()=>db.exec(migration),'42723');
      await db.exec('rollback');await role(db);
      assert.deepEqual(await dump(db),before);
    });
    await t.test('Admin-only entry point; original helper cannot bypass the boundary',async()=>{
      for(const [r,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',admin]]){
        await role(db,r,uid);await fail(()=>open('route',target),'42501');
      }
      await role(db);
      for(const r of ['anon','authenticated','service_role']){
        const allowed=(await owner(db,'select has_function_privilege($1,$2,\'EXECUTE\') ok',[r,'public.admin_catalog_metadata_before_conflict_errors'+signature])).rows[0].ok;
        assert.equal(allowed,false);
      }
      await fail(()=>rpc(db,'admin_catalog_metadata_before_conflict_errors',['route',target,'open']),'42501');
      await role(db,'authenticated',other);await fail(()=>preview('route',target,first),'42501');await role(db);
    });

    await t.test('legacy TEST-shaped draft: identical metadata/context/version but changed live timestamp must remain blocked',async()=>{
      const id=combination.back_route_id;
      const legacy=(await rpc(db,'admin_course_open_draft',[id])).draft;
      assert.equal(legacy.base_snapshot._context.metadata_contract,undefined);
      const d=await save('route',id,legacy,{...legacy.snapshot,name:'Percorso TEST UX'});
      const before=await dump(db);
      await db.exec('begin');
      // A no-op field update changes only updated_at via the real live trigger.
      await owner(db,'update public.course_routes set name=name where id=$1',[id]);
      const state=(await owner(db,'select public.admin_catalog_metadata_state($1,$2) state',['route',id])).rows[0].state;
      const fields=(await owner(db,"select public.admin_catalog_metadata_fields($1,$2::jsonb-'_context') fields",['route',JSON.stringify(d.base_snapshot)])).rows[0].fields;
      // The base normalizer excludes its private context, just like the publisher.
      assert.deepEqual(fields,state.fields);
      await db.exec('savepoint conflict_check');
      await fail(()=>preview('route',id,d),'PT409','Base live o versione cambiata');
      await db.exec('rollback to savepoint conflict_check');
      assert.deepEqual(state.base_version_id,d.base_version_id);
      assert.deepEqual(state.legacy_context,d.base_snapshot._context);
      assert.notEqual(state.updated_at,d.base_live_updated_at);
      assert.equal((await rpc(db,'admin_course_get_draft',[id])).workflow_status,'draft');
      await db.exec('rollback');await role(db);
      assert.deepEqual(await dump(db),before);
      assert.equal((await preview('route',id,d)).can_publish,true);
    });

    for(const [kind,id] of [['route',target],['route_combination',combination.id]]){
      await t.test(`${kind}: stale draft/base/hash fail without rebase; valid publication and restore still work`,async()=>{
        let d=(await open(kind,id)).draft;
        d=await save(kind,id,d,{...d.snapshot,notes:'Private test change'});
        const state=await dump(db);
        await db.exec('begin read only');
        await fail(()=>preview(kind,id,{...d,revision:d.revision-1}),'PT409','Bozza cambiata o chiusa');
        // PostgreSQL aborts the transaction on any conflict; no partial reads/writes.
        await db.exec('rollback');assert.deepEqual(await dump(db),state);
        const p=await preview(kind,id,d);
        await fail(()=>publish(kind,id,d,{...p,confirmation_hash:'0'.repeat(64)}),'PT409','Anteprima cambiata');
        assert.deepEqual(await dump(db),state);
        // A real live divergence still blocks, including in the same transaction.
        const table=kind==='route'?'course_routes':'route_combinations';
        await db.exec('begin');
        await owner(db,`update public.${table} set name=name||' changed' where id=$1`,[id]);
        await fail(()=>preview(kind,id,d),'PT409','Base live o versione cambiata');
        await db.exec('rollback');await role(db);
        assert.deepEqual(await dump(db),state);
        const published=await publish(kind,id,d,await preview(kind,id,d));
        await fail(()=>preview(kind,id,d),'PT409','Bozza cambiata o chiusa');
        const history=await call(kind,id,'history');assert.ok(history.history.some(v=>v.version_id===published.version_id));
        const restored=await call(kind,id,'restore',[null,null,null,null,null,published.version_id]);
        assert.notEqual(restored.draft.draft_id,d.draft_id);assert.equal(restored.draft.workflow_status,'draft');
        await fail(()=>call(kind,id,'restore',[null,null,null,null,null,published.version_id]),'PT409');
      });
    }

    await t.test('late 40001 after a live UPDATE rolls back live, draft, version and metadata together',async()=>{
      const d0=(await open('route',target)).draft;
      const d=await save('route',target,d0,{...d0.snapshot,name:'Never published'});
      const p=await preview('route',target,d);
      await owner(db,"create function public.conflict_fixture_fail() returns trigger language plpgsql as $$begin raise exception 'Late test conflict' using errcode='40001';end;$$");
      await owner(db,'create trigger conflict_fixture_fail before insert on public.admin_catalog_versions for each row execute function public.conflict_fixture_fail()');
      const state=await dump(db);
      await fail(()=>publish('route',target,d,p),'PT409','Late test conflict');
      assert.deepEqual(await dump(db),state);
      await owner(db,'drop trigger conflict_fixture_fail on public.admin_catalog_versions');
      await publish('route',target,d,p);
    });
  }finally{await db.close();}
});

test('native independent Admin sessions: NOWAIT and stale-base guards survive error translation',
  {skip:!process.env.STABLR_PG_BIN||!process.env.STABLR_PG_MODULE},async t=>{
  const pg=await import(process.env.STABLR_PG_MODULE),Client=pg.Client||pg.default?.Client;
  const root=await mkdtemp(join(tmpdir(),'stablr-conflict-pg-')),data=join(root,'data'),bin=process.env.STABLR_PG_BIN;
  const run=(name,args)=>{const r=spawnSync(join(bin,name),args,{encoding:'utf8',timeout:30000});if(r.status!==0)throw new Error(`Local ${name}: ${r.stderr}`);};
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  run('initdb',['-D',data,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C']);
  const wrap=client=>({query:(...args)=>client.query(...args),exec:text=>client.query(text)});
  let started=false,a,b;
  try{
    run('pg_ctl',['start','-D',data,'-l',join(root,'postgres.log'),'-o',`-p ${port} -h 127.0.0.1 -k ${root}`,'-w']);started=true;
    const settings={host:'127.0.0.1',port,user:'postgres',database:'postgres'};
    a=new Client(settings);b=new Client(settings);await a.connect();await b.connect();const da=wrap(a),db=wrap(b);
    const {combination}=await setupCombinationTees(da),target=combination.front_route_id;
    await a.query('reset role');await a.query(await sql('admin-catalog-editor-metadata'));await a.query(await sql('admin-catalog-metadata-conflict-errors'));
    await role(da);await role(db,'authenticated',other);
    const call=(conn,action,args=[])=>rpc(conn,'admin_catalog_metadata',['route',target,action,...args]);
    const save=(conn,d,notes)=>call(conn,'save',[d.draft_id,d.revision,{...d.snapshot,notes}]);
    const preview=(conn,d)=>call(conn,'preview',[d.draft_id,d.revision]);
    const publish=(conn,d,p)=>call(conn,'publish',[d.draft_id,d.revision,null,p.confirmation_hash,'Local concurrency confirmation']);
    const first=await save(da,(await call(da,'open')).draft,'First Admin'),second=await save(db,(await call(db,'open')).draft,'Second Admin');
    const pa=await preview(da,first),pb=await preview(db,second);
    await t.test('concurrent saves and publications fail NOWAIT, never bypassing locks',async()=>{
      await a.query('begin');await save(da,first,'Uncommitted');await role(db,'authenticated',admin);
      await fail(()=>save(db,first,'Other tab'),'55P03');await fail(()=>publish(db,first,pa),'55P03');
      await a.query('rollback');await role(db,'authenticated',other);
    });
    await t.test('competing publication: one immutable version; other base conflicts with PT409 and preserves its draft',async()=>{
      await a.query('begin');await publish(da,first,pa);await fail(()=>publish(db,second,pb),'55P03');await a.query('commit');
      await fail(()=>publish(db,second,pb),'PT409','Base live o versione cambiata');
      await a.query('reset role');
      assert.equal((await a.query('select count(*)::int n from public.admin_catalog_versions where live_entity_id=$1',[target])).rows[0].n,1);
      const remaining=(await a.query('select workflow_status,revision,base_snapshot from public.admin_catalog_drafts where draft_id=$1',[second.draft_id])).rows[0];
      assert.equal(remaining.workflow_status,'draft');assert.equal(Number(remaining.revision),second.revision);assert.deepEqual(remaining.base_snapshot,second.base_snapshot);
    });
  }finally{if(a)await a.end();if(b)await b.end();if(started)run('pg_ctl',['stop','-D',data,'-m','fast','-w']);}
});
