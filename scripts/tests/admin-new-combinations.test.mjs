import assert from 'node:assert/strict';
import { test } from 'node:test';
import { admin,other,player,role,rpc,sql,setupCombinationTees,owner,dump } from './helpers/combination-tee-fixture.mjs';
const {PGlite}=await import(process.env.STABLR_PGLITE_MODULE||'@electric-sql/pglite');
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
export const fields=(club,sections)=>({club_id:club,name:'Nuova combinazione verificata',front_configuration_id:sections[0].id,
  back_configuration_id:sections[1].id,source_hash:sections[0].source_hash+sections[1].source_hash,
  holes:Array.from({length:18},(_,i)=>({position:i+1,si:i+1})),
  tees:[{name:'Giallo',tee_color:'giallo',rating_category:'men',course_rating:71.5,slope_rating:125,is_active:true,display_order:0}]});
test('new combinations: exact verified sections, private workflow, atomic creation and isolation',async t=>{
  const db=new PGlite();
  try {
    const {clubId}=await setupCombinationTees(db);
    const sqlText=await sql('admin-new-combinations');
    await db.exec('reset role');await db.exec(await sql('admin-combination-tee-crud'));await db.exec(sqlText);await role(db);
    const initial=await dump(db);let list,draft,plan;
    const preview=()=>rpc(db,'admin_new_combination_preview',[draft.draft_id]);
    const publish=(hash=plan.confirmation_hash,revision=draft.revision)=>rpc(db,'admin_new_combination_publish',[draft.draft_id,revision,hash,'Conferma test esplicita']);
    await t.test('read-only list exposes only exact verified physical nines; preview/list never create drafts',async()=>{
      await db.exec('begin read only');list=await rpc(db,'admin_new_combinations',[clubId]);await db.exec('commit');
      assert.equal(list.sections.length,3);assert.equal(list.drafts.length,0);assert.equal(list.sections[0].holes.length,9);
      assert.deepEqual(await dump(db),initial);assert.ok(!/source_payload|registration_snapshot/.test(JSON.stringify(list)));
      const pair=list.sections.flatMap(a=>list.sections.filter(b=>a.course_id!==b.course_id).map(b=>[a,b]))
        .find(([a,b])=>!initial.route_combinations.some(x=>x.j.club_id===clubId&&x.j.front_route_id===a.course_id&&x.j.back_route_id===b.course_id));
      assert.ok(pair);list.sections=[...pair,...list.sections.filter(s=>!pair.includes(s))];
    });
    await t.test('all RPCs reject anon, player, missing identity, service role and other owner',async()=>{
      for(const [name,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',admin]]){
        await role(db,name,uid);
        for(const [fn,args] of [['admin_new_combinations',[clubId]],['admin_new_combination_save',[fields(clubId,list.sections)]],
          ['admin_new_combination_preview',[clubId]],['admin_new_combination_publish',[clubId,1,'a'.repeat(64),'test']]])await rejects(()=>rpc(db,fn,args),'42501');
      }
      await role(db);draft=await rpc(db,'admin_new_combination_save',[fields(clubId,list.sections)]);
      await role(db,'authenticated',other);await rejects(()=>preview(),'42501');
      await rejects(()=>rpc(db,'admin_new_combination_save',[draft.snapshot,draft.draft_id,1]),'42501');
      assert.equal((await rpc(db,'admin_new_combinations',[clubId])).drafts.length,0);await role(db);
      for(const table of ['admin_catalog_drafts','admin_new_combination_publications']){
        assert.equal((await owner(db,`select has_table_privilege('authenticated','public.${table}','INSERT,UPDATE,DELETE') ok`)).rows[0].ok,false);
      }
    });
    await t.test('save/resume and abandon remain private; invalid sources/allowlist/base/revision rejected',async()=>{
      assert.equal((await rpc(db,'admin_new_combinations',[clubId])).drafts[0].draft_id,draft.draft_id);
      for(const bad of [{...draft.snapshot,total_par:999},{...draft.snapshot,front_configuration_id:list.sections[1].id},
        {...draft.snapshot,source_hash:'a'.repeat(128)}])await assert.rejects(()=>rpc(db,'admin_new_combination_save',[bad]));
      await rejects(()=>rpc(db,'admin_new_combination_save',[draft.snapshot,draft.draft_id,99]),'40001');
      const abandoned=await rpc(db,'admin_new_combination_save',[{...draft.snapshot,name:'Da abbandonare'}]);
      await rpc(db,'admin_catalog_archive_draft',[abandoned.draft_id,'route_combination',1]);
      assert.equal((await rpc(db,'admin_new_combinations',[clubId])).drafts.length,1);
      for(const table of ['clubs','course_routes','route_holes','route_tees','route_combinations','route_combination_holes','combination_tees','rounds','round_holes'])
        assert.deepEqual((await dump(db))[table],initial[table]);
    });
    await t.test('preview validates explicit SI, names, rating completeness and computes inherited Par and scope server-side',async()=>{
      const incomplete=await rpc(db,'admin_new_combination_save',[{...draft.snapshot,name:'Da completare',holes:draft.snapshot.holes.map(h=>({...h,si:null})),tees:[]}]);
      const p=await rpc(db,'admin_new_combination_preview',[incomplete.draft_id]);assert.equal(p.can_publish,false);assert.equal(p.blockers.length,2);
      await rejects(()=>rpc(db,'admin_new_combination_publish',[incomplete.draft_id,1,p.confirmation_hash,'test']),'23514');
      const duplicated=await rpc(db,'admin_new_combination_save',[{...draft.snapshot,name:'SI duplicati',holes:draft.snapshot.holes.map(h=>({...h,si:1}))}]);
      assert.equal((await rpc(db,'admin_new_combination_preview',[duplicated.draft_id])).can_publish,false);
      const prior=initial.route_combinations.find(x=>x.j.club_id===clubId).j;
      const a=list.sections.find(s=>s.course_id===prior.front_route_id),b=list.sections.find(s=>s.course_id===prior.back_route_id);
      const collision=await rpc(db,'admin_new_combination_save',[{...fields(clubId,[a,b]),name:prior.name}]);
      const collisionPlan=await rpc(db,'admin_new_combination_preview',[collision.draft_id]);
      assert.ok(collisionPlan.blockers.some(x=>x.includes('coppia ordinata')));assert.ok(collisionPlan.blockers.some(x=>x.includes('nome')));
      for(const si of [0,19,1.5])await rejects(()=>rpc(db,'admin_new_combination_save',[{...draft.snapshot,holes:draft.snapshot.holes.map((h,i)=>i===0?{...h,si}:h)}]),'22023');
      for(const slope of [54,156,113.5])await rejects(()=>rpc(db,'admin_new_combination_save',[{...draft.snapshot,tees:[{...draft.snapshot.tees[0],slope_rating:slope}]}]),'22023');
      plan=await preview();assert.equal(plan.can_publish,true);assert.equal(plan.holes.length,18);assert.equal(plan.impact.existing_records_updated,0);
      assert.equal(plan.total_par,plan.holes.reduce((n,h)=>n+h.par,0));
      const before=await dump(db);await db.exec('begin read only');await preview();await db.exec('commit');assert.deepEqual(await dump(db),before);
      await rejects(()=>publish('0'.repeat(64)),'40001');await rejects(()=>publish(plan.confirmation_hash,99),'40001');
      await rejects(()=>rpc(db,'admin_new_combination_publish',[draft.draft_id,1,plan.confirmation_hash,' ']),'22023');
    });
    await t.test('changed live sources and physical revisions block; no automatic rebase or archival',async()=>{
      const id=list.sections[0].course_id;
      await db.exec('begin');
      await owner(db,"update public.course_routes set name=name||' changed' where id=$1",[id]);
      await db.exec('savepoint before_attempt');
      await assert.rejects(()=>publish());
      await db.exec('rollback to before_attempt');
      const d=(await rpc(db,'admin_new_combinations',[clubId])).drafts.find(x=>x.draft_id===draft.draft_id);assert.equal(d.workflow_status,'draft');
      await db.exec('rollback');await role(db);
      plan=await preview();
    });
    await t.test('late failures in tee, foundation audit, versions, receipt and draft closure roll back EVERYTHING',async()=>{
      await owner(db,"create function public.fixture_fail_new_combination() returns trigger language plpgsql as $$begin raise exception 'late test failure' using errcode='23514';end;$$");
      for(const table of ['combination_tees','admin_catalog_foundation_events','admin_catalog_versions','admin_new_combination_publications']){
        await owner(db,`create trigger z_fail_new_combination before insert on public.${table} for each row execute function public.fixture_fail_new_combination()`);
        const before=await dump(db);await rejects(()=>publish(),'23514');assert.deepEqual(await dump(db),before);
        await owner(db,`drop trigger z_fail_new_combination on public.${table}`);
      }
      await owner(db,"create function public.fixture_close_new_combination() returns trigger language plpgsql as $$begin if new.workflow_status='published' then raise exception 'closure failure' using errcode='23514';end if;return new;end;$$");
      await owner(db,'create trigger z_fail_new_combination before update on public.admin_catalog_drafts for each row execute function public.fixture_close_new_combination()');
      const before=await dump(db);await rejects(()=>publish(),'23514');assert.deepEqual(await dump(db),before);
      await owner(db,'drop trigger z_fail_new_combination on public.admin_catalog_drafts');
    });
    await t.test('atomic publication creates only new children and verified exact physical links; closes draft and seals history',async()=>{
      const before=await dump(db),result=await publish(),after=await dump(db),live=result.combination;
      assert.equal(live.route_combination_holes.length,18);assert.equal(live.combination_tees[0].holes_count,18);
      assert.equal(live.combination_tees[0].par_total,plan.total_par);assert.equal(live.front_route_id,list.sections[0].course_id);
      assert.equal(live.combination_tees[0].display_order,0);
      assert.equal(live.back_route_id,list.sections[1].course_id);
      for(const [name,rows] of Object.entries(before)){
        const key=name==='admin_catalog_versions'?'version_id':name==='admin_catalog_drafts'?'draft_id':name==='admin_catalog_foundation_events'?'event_id':name.endsWith('publications')?'publication_id':'id';
        for(const row of rows){if(name==='admin_catalog_drafts'&&row.j.draft_id===draft.draft_id)continue;
          assert.ok(after[name].some(x=>JSON.stringify(x)===JSON.stringify(row)),`${name}: existing ${row.j[key]} untouched`);}
      }
      assert.equal(after.admin_catalog_drafts.find(x=>x.j.draft_id===draft.draft_id).j.workflow_status,'published');
      assert.equal(after.admin_catalog_playable_configurations.find(x=>x.j.id===result.configuration_id).j.review_status,'verified');
      await rpc(db,'admin_route_get_draft',[live.id]); // Existing editor can read the newly published combination.
      assert.equal((await rpc(db,'admin_route_get_draft',[live.id])).context.checks.coherent,true);
      await rejects(()=>publish(),'40001');
      for(const table of ['admin_new_combination_publications','admin_catalog_versions']){
        await rejects(()=>owner(db,`delete from public.${table}`),'55000');
        await rejects(()=>owner(db,`update public.${table} set snapshot='{}'`),'55000');
      }
    });
    await t.test('helpers have no API grants and accidental migration reapplication rolls back unchanged',async()=>{
      for(const fn of ['admin_new_combination_section(uuid)','admin_new_combination_fields(jsonb)','admin_new_combination_guard()'])
        for(const r of ['authenticated','anon','service_role'])assert.equal((await owner(db,'select has_function_privilege($1,$2,\'EXECUTE\') allowed',[r,'public.'+fn])).rows[0].allowed,false);
      const before=await dump(db);await db.exec('reset role');await rejects(()=>db.exec(sqlText),'42P07');
      await db.exec('rollback');await role(db);assert.deepEqual(await dump(db),before);
    });
  } finally {await db.close();}
});
