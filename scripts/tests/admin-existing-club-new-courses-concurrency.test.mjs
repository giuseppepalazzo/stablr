// Independent native PostgreSQL sessions, isolated local fixture cluster only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { admin,other,setup,role,rpc,create,configure,preview,publish,courseFields } from './helpers/existing-club-course-fixture.mjs';
const enabled=!!process.env.STABLR_PG_BIN&&!!process.env.STABLR_PG_MODULE;
test('native new courses: two Admins, duplicate races, legacy writers and private phantom locks',{skip:!enabled},async t=>{
  const pg=await import(process.env.STABLR_PG_MODULE),Client=pg.Client||pg.default?.Client;
  const root=await mkdtemp(join(tmpdir(),'stablr-new-course-pg-data-')),data=join(root,'data'),bin=process.env.STABLR_PG_BIN;
  const run=(name,args)=>{const result=spawnSync(join(bin,name),args,{encoding:'utf8',timeout:30000});if(result.status!==0)throw new Error(`Local ${name} failed: ${result.stderr}`);};
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  run('initdb',['-D',data,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C']);
  let started=false,a,b;
  const wrap=client=>({query:(...args)=>client.query(...args),exec:text=>client.query(text)});
  const fails=action=>assert.rejects(action,error=>error.code==='55P03');
  try {
    run('pg_ctl',['start','-D',data,'-l',join(root,'postgres.log'),'-o',`-p ${port} -h 127.0.0.1 -k ${root}`,'-w']);started=true;
    const settings={host:'127.0.0.1',port,user:'postgres',database:'postgres'};a=new Client(settings);b=new Client(settings);await a.connect();await b.connect();
    const da=wrap(a),db=wrap(b),{club,old}=await setup(da);await role(db,'authenticated',other);
    const first=await create(da,club),second=await create(db,club);await configure(da,first);await configure(db,second);
    const pa=await preview(da,first),pb=await preview(db,second);
    await t.test('two Admin publications are NOWAIT; duplicate is rejected after the first commit, without partial history',async()=>{
      await a.query('begin');await publish(da,first,pa);
      await fails(()=>publish(db,second,pb));await a.query('commit');
      await assert.rejects(()=>publish(db,second,pb),error=>error.code==='22023');
      assert.equal((await rpc(db,'admin_existing_club_courses',[club.id])).courses[0].workflow_status,'draft');
      await a.query('reset role');assert.equal((await a.query('select count(*)::int n from public.admin_existing_club_course_publications')).rows[0].n,1);
      assert.equal((await a.query("select count(*)::int n from public.course_routes where name='Nuovo nove'")).rows[0].n,1);await role(da);
    });
    const next=await create(da,club,courseFields('Secondo nuovo'));const privateRows=await configure(da,next);let current=await preview(da,next);
    await t.test('legacy Club or course writer makes publisher fail before creating any live/version/receipt',async()=>{
      await b.query("reset role;set lock_timeout='100ms'");await b.query('begin');await b.query('update public.clubs set city=city where id=$1',[club.id]);
      await fails(()=>publish(da,next,current));await b.query('rollback');
      await b.query('begin');await b.query('update public.course_routes set total_par=total_par where id=$1',[old.id]);
      await fails(()=>publish(da,next,current));await b.query('rollback');await role(db,'authenticated',other);
      assert.equal((await rpc(da,'admin_existing_club_courses',[club.id])).courses.find(row=>row.draft_id===next.draft_id).revision,next.revision);
      await a.query('reset role');assert.equal((await a.query('select count(*)::int n from public.admin_existing_club_course_publications')).rows[0].n,1);await role(da);
      current=await preview(da,next);
    });
    await t.test('publisher locks private descendants and generic child insertions; rollback restores the complete draft',async()=>{
      await a.query('begin');await publish(da,next,current);
      await role(db,'authenticated',admin);
      await fails(()=>rpc(db,'admin_new_course_tee_save',[next.draft_id,{...privateRows.tee.snapshot,course_rating:37},next.revision,
        privateRows.holes.draft_id,privateRows.holes.revision,privateRows.tee.draft_id,privateRows.tee.revision]));
      await fails(()=>rpc(db,'admin_catalog_create_draft',['route',courseFields('Phantom'),null,next.parent_draft_id]));
      await b.query('reset role');await fails(()=>b.query("insert into public.course_routes(club_id,name,holes_count) values($1,'Legacy phantom',9)",[club.id]));
      await a.query('rollback');await role(db,'authenticated',other);
      assert.equal((await preview(da,next)).can_publish,true);
      await a.query('reset role');assert.equal((await a.query('select count(*)::int n from public.admin_existing_club_course_publications')).rows[0].n,1);await role(da);
    });
    await t.test('concurrent first saves cannot create two personal contexts for the same Club',async()=>{
      await a.query('reset role');const another=(await a.query("insert into public.clubs(name,name_normalized,created_by) values('Second Club','second club',$1) returning id",[admin])).rows[0];await role(da);await role(db,'authenticated',admin);
      await a.query('begin');await create(da,another,courseFields('Prima bozza'));
      await fails(()=>create(db,another,courseFields('Seconda bozza')));await a.query('commit');await create(db,another,courseFields('Seconda bozza'));
      assert.equal((await rpc(db,'admin_existing_club_courses',[another.id])).courses.length,2);
      await a.query('reset role');assert.equal((await a.query('select count(*)::int n from public.admin_existing_club_course_contexts where club_id=$1',[another.id])).rows[0].n,1);await role(da);
    });
  } finally {
    for(const client of [a,b])if(client){try{await client.query('rollback');}catch{}await client.end();}
    if(started)run('pg_ctl',['stop','-D',data,'-m','fast','-w']);
  }
});
