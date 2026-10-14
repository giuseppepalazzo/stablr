// Separate native PostgreSQL connections; temporary local cluster, never remote.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { admin,other,setup,role,rpc,sql } from './helpers/existing-club-course-fixture.mjs';
const enabled=!!process.env.STABLR_PG_BIN&&!!process.env.STABLR_PG_MODULE;
test('native tee CRUD: concurrent Admins and legacy writers',{skip:!enabled},async t=>{
  const pg=await import(process.env.STABLR_PG_MODULE),Client=pg.Client||pg.default?.Client;
  const root=await mkdtemp(join(tmpdir(),'stablr-tee-crud-pg-')),data=join(root,'data'),bin=process.env.STABLR_PG_BIN;
  const run=(name,args)=>{const result=spawnSync(join(bin,name),args,{encoding:'utf8',timeout:30000});if(result.status!==0)throw new Error(`Local ${name} failed: ${result.stderr}`);};
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  run('initdb',['-D',data,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C']);
  let started=false,a,b;
  const wrap=client=>({query:(...args)=>client.query(...args),exec:text=>client.query(text)});
  const fails=(action,code='55P03')=>assert.rejects(action,error=>error.code===code);
  const publish=(db,d)=>rpc(db,'admin_course_tee_publish_draft',[d.draft_id,d.revision]);
  const save=(db,d,updates)=>rpc(db,'admin_course_tee_save_draft',[d.draft_id,{...d.snapshot,...updates},d.revision]);
  const fields={tee_name:'Nuovo concorrente',tee_color:'orange',gender:'men',display_order:1,course_rating:36,slope_rating:113,is_active:true};
  try {
    run('pg_ctl',['start','-D',data,'-l',join(root,'postgres.log'),'-o',`-p ${port} -h 127.0.0.1 -k ${root}`,'-w']);started=true;
    const settings={host:'127.0.0.1',port,user:'postgres',database:'postgres'};a=new Client(settings);b=new Client(settings);await a.connect();await b.connect();
    const da=wrap(a),db=wrap(b),{old}=await setup(da);
    await a.query('reset role');await da.exec(await sql('admin-course-tee-crud'));await role(da);await role(db,'authenticated',other);
    let first=(await rpc(da,'admin_course_tee_open_new_draft',[old.id])).draft;
    let second=(await rpc(db,'admin_course_tee_open_new_draft',[old.id])).draft;
    first=await save(da,first,fields);second=await save(db,second,{...fields,gender:'women'});
    await t.test('two new tees with the same name/scope cannot both publish; loser retains only a private draft',async()=>{
      await a.query('begin');await publish(da,first);await fails(()=>publish(db,second));await a.query('commit');
      await fails(()=>publish(db,second),'23505');
      assert.equal((await rpc(db,'admin_course_tee_resume_new_draft',[second.draft_id])).draft.workflow_status,'draft');
      await a.query('reset role');assert.equal((await a.query("select count(*)::int n from public.route_tees where tee_name='Nuovo concorrente'")).rows[0].n,1);
      assert.equal((await a.query('select count(*)::int n from public.admin_catalog_versions')).rows[0].n,1);await role(da);
    });
    let next=(await rpc(da,'admin_course_tee_open_new_draft',[old.id])).draft;next=await save(da,next,{...fields,tee_name:'Rollback concorrente'});
    await t.test('new publisher prevents grid and uniqueness-domain phantoms; transaction rollback leaves no live tee/version',async()=>{
      await a.query('begin');await publish(da,next);await b.query("reset role;set lock_timeout='100ms'");
      await fails(()=>b.query('update public.route_holes set par=par where route_id=$1',[old.id]));
      await fails(()=>b.query("insert into public.route_tees(route_id,tee_name,holes_count) values($1,'Legacy phantom',9)",[old.id]));
      await fails(()=>b.query('update public.course_routes set total_par=total_par where id=$1',[old.id]));
      await a.query('rollback');await role(db,'authenticated',other);
      assert.equal((await rpc(da,'admin_course_tee_preview_draft',[next.draft_id])).can_publish,true);
      await a.query('reset role');assert.equal((await a.query('select count(*)::int n from public.route_tees where id=$1',[next.entity_key])).rows[0].n,0);
      assert.equal((await a.query('select count(*)::int n from public.admin_catalog_versions')).rows[0].n,1);await role(da);
    });
    await t.test('a pre-existing legacy tee or grid write causes explicit NOWAIT refusal, with no partial publication',async()=>{
      for(const statement of ['update public.route_tees set slope_rating=slope_rating where route_id=$1','update public.route_holes set par=par where route_id=$1']){
        await b.query('reset role;begin');await b.query(statement,[old.id]);await fails(()=>publish(da,next));await b.query('rollback');
      }
      await role(db,'authenticated',other);assert.equal((await rpc(da,'admin_course_tee_resume_new_draft',[next.draft_id])).draft.revision,next.revision);
    });
    await t.test('optimistic draft saves and publication cannot silently overwrite another Admin/revision',async()=>{
      await role(db,'authenticated',admin);await a.query('begin');const saved=await save(da,next,{tee_name:'Saved revision'});
      await fails(()=>save(db,next,{tee_name:'Stale revision'}));await a.query('commit');await fails(()=>save(db,next,{tee_name:'Stale revision'}),'40001');
      await fails(()=>publish(db,next),'40001');assert.equal((await rpc(db,'admin_course_tee_resume_new_draft',[next.draft_id])).draft.revision,saved.revision);
      const id=(await rpc(da,'admin_course_tee_list',[old.id])).tees.find(row=>row.tee_name==='Nuovo concorrente').id;
      let editA=(await rpc(da,'admin_course_tee_open_draft',[id])).draft;editA=await save(da,editA,{slope_rating:114});
      await role(db,'authenticated',other);let editB=(await rpc(db,'admin_course_tee_open_draft',[id])).draft;editB=await save(db,editB,{slope_rating:115});
      await a.query('begin');await publish(da,editA);await fails(()=>publish(db,editB));await a.query('commit');await fails(()=>publish(db,editB),'40001');
    });
  } finally {
    for(const client of [a,b])if(client){try{await client.query('rollback');}catch{}await client.end();}
    if(started)run('pg_ctl',['stop','-D',data,'-m','fast','-w']);
  }
});
