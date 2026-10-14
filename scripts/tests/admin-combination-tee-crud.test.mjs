import assert from 'node:assert/strict';
import { test } from 'node:test';
import { admin,other,player,role,rpc,sql,fields,setupCombinationTees,owner,dump,open,openNew,save,preview,publish,archive } from './helpers/combination-tee-fixture.mjs';
const { PGlite }=await import(process.env.STABLR_PGLITE_MODULE||'@electric-sql/pglite');
const fails=(action,code)=>assert.rejects(action,e=>e.code===code);
test('combination tee CRUD: captured Parco model, private drafts, exact scope/impact, atomic history',async t=>{
  const db=new PGlite();
  try{
    const {clubId,combination,tee,configuration}=await setupCombinationTees(db);
    const before=await dump(db),indexes=(await owner(db,"select * from pg_indexes where tablename='combination_tees' order by indexname")).rows;
    await db.exec('reset role');await db.exec(await sql('admin-combination-tee-crud'));await role(db);
    const list=()=>rpc(db,'admin_combination_tee_list',[combination.id]);
    await t.test('additive one-shot migration leaves all rows, sources, grants and existing indexes unchanged',async()=>{
      const after=await dump(db);assert.deepEqual(after,{...before,combination_tees:before.combination_tees.map(row=>({j:{...row.j,display_order:null}}))});
      assert.deepEqual((await owner(db,"select * from pg_indexes where tablename='combination_tees' order by indexname")).rows,indexes);
      for(const table of ['combination_tees','admin_catalog_drafts','admin_catalog_versions'])assert.equal((await owner(db,`select has_table_privilege('authenticated','public.${table}','INSERT,UPDATE,DELETE') allowed`)).rows[0].allowed,false);
    });
    await t.test('list/get/preview are read-only and payload-minimized, with no draft on viewing a tee',async()=>{
      const start=await dump(db);await db.exec('begin read only');const p=await list();const d=await rpc(db,'admin_combination_tee_get_draft',[tee.id]);await db.exec('commit');
      assert.deepEqual(await dump(db),start);assert.equal(p.combination.holes_count,18);assert.equal(p.tees[0].effective_holes_count,18);assert.equal(d.draft,null);
      assert.ok(!/TEST_NOT_EXPOSED|source_payload/.test(JSON.stringify(p)));assert.equal(p.tees[0].has_draft_changes,false);
    });
    let d;
    await t.test('every RPC denies anon, player, missing UID, service/JWT-role mismatch; helpers are private',async()=>{
      d=(await open(db,tee.id)).draft;
      for(const [name,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',admin]]){
        await role(db,name,uid);
        for(const action of [list,()=>rpc(db,'admin_combination_tee_get_draft',[tee.id]),()=>open(db,tee.id),()=>openNew(db,combination.id),
          ()=>rpc(db,'admin_combination_tee_resume_new_draft',[d.draft_id]),()=>save(db,d,fields()),()=>preview(db,d),()=>publish(db,d),()=>archive(db,d)])await fails(action,'42501');
      }await role(db);
      await fails(()=>rpc(db,'admin_combination_tee_context',[combination.id]),'42501');
      await fails(()=>rpc(db,'admin_catalog_tee_editor_impact',['combination_tee',combination.id,tee.id,fields(),false,true]),'42501');
      await role(db,'authenticated',other);await fails(()=>save(db,d,fields()),'42501');await fails(()=>publish(db,d),'42501');await fails(()=>preview(db,d),'42501');await role(db);
    });
    await t.test('full metadata/rating allowlist, immutable identity/base and optimistic revision',async()=>{
      assert.deepEqual((await open(db,tee.id)).draft,d);assert.equal(d.entity_type,'combination_tee');
      for(const key of ['par_total','holes_count','route_combination_id','source_payload','estimated','id'])await fails(()=>save(db,d,{[key]:123}),'22023');
      for(const v of [54,156,125.5])await fails(()=>save(db,d,{slope_rating:v}),'23514');
      await fails(()=>save(db,d,{display_order:1.5}),'22023');await fails(()=>save(db,d,{tee_name:' '}),'22023');
      await fails(()=>rpc(db,'admin_catalog_create_draft',['combination_tee',fields(),tee.id]),'42501');
      const start=await dump(db);d=await save(db,d,{tee_name:'Giallo curato',tee_color:'arancio',gender:'women',display_order:1,course_rating:72.25,slope_rating:126,is_active:false});
      assert.deepEqual((await dump(db)).combination_tees,start.combination_tees);await fails(()=>save(db,{...d,revision:1},{tee_color:'white'}),'40001');
    });
    await t.test('preview preserves all seven differences and reports exact verified foundation/classification impact; no implicit propagation',async()=>{
      const start=await dump(db);await db.exec('begin read only');const p=await preview(db,d);await db.exec('commit');assert.deepEqual(await dump(db),start);
      assert.equal(p.can_publish,true);assert.equal(Object.keys(p.diff).length,7);assert.equal(p.foundation_impact.may_block_par,true);
      assert.deepEqual(p.foundation_impact.configurations.map(c=>c.id),[configuration.id]);assert.equal(p.foundation_impact.classification_count,1);
      assert.equal(p.foundation_impact.baselines_updated,false);assert.ok(!/snapshot|source_payload|TEST_NOT_EXPOSED/.test(JSON.stringify(p.foundation_impact)));
    });
    await t.test('atomic publication updates only this tee metadata/CR/Slope/state, authors version, closes draft; sealed foundation/Par/SI/distance/rounds stay immutable',async()=>{
      const start=await dump(db),result=await publish(db,d),after=await dump(db);
      assert.equal(result.version_number,1);assert.equal(result.context.tee.tee_name,'Giallo curato');
      for(const table of Object.keys(start).filter(k=>!['combination_tees','admin_catalog_drafts','admin_catalog_versions'].includes(k)))assert.deepEqual(after[table],start[table],table);
      const live=after.combination_tees.find(row=>row.j.id===tee.id).j;
      const original=start.combination_tees.find(row=>row.j.id===tee.id).j;
      for(const key of ['par_total','holes_count','source_system','source_external_id','source_payload','estimated','created_at','route_combination_id'])assert.deepEqual(live[key],original[key]);
      const v=after.admin_catalog_versions.find(row=>row.j.version_id===result.version_id).j;assert.deepEqual(v.snapshot,d.snapshot);assert.equal(v.published_by,admin);assert.equal(v.diff.course_rating.before,72.1);
      assert.equal((await rpc(db,'admin_combination_tee_get_draft',[tee.id])).draft,null);assert.equal((await list()).tees[0].has_draft_changes,false);
      await fails(()=>publish(db,d),'40001');
      assert.equal((await rpc(db,'admin_catalog_tee_classification_detail',[clubId,'combination_tee',tee.id])).state,'obsolete');
      await fails(()=>owner(db,"update public.admin_catalog_versions set snapshot='{}' where version_id=$1",[result.version_id]),'55000');
    });
    let n;
    await t.test('new tee is private/resumable/abandonable; scope and Par are exclusively server-derived',async()=>{
      const start=await dump(db);n=(await openNew(db,combination.id)).draft;assert.equal(n.live_entity_id,null);assert.equal(n.snapshot.tee_name,'');
      assert.deepEqual((await rpc(db,'admin_combination_tee_resume_new_draft',[n.draft_id])).draft,n);
      assert.deepEqual((await dump(db)).combination_tees,start.combination_tees);
      n=await save(db,n,fields());assert.equal((await preview(db,n)).context.tee.par_total,combination.total_par);assert.equal((await preview(db,n)).context.tee.effective_holes_count,18);
      assert.ok((await list()).new_drafts.some(row=>row.draft_id===n.draft_id));
      const empty=(await openNew(db,combination.id)).draft;await archive(db,empty);await fails(()=>rpc(db,'admin_combination_tee_resume_new_draft',[empty.draft_id]),'42501');
    });
    await t.test('new active ratings required, nullable inactive/history allowed; category and name/effective-scope collisions block without renaming',async()=>{
      let a=(await openNew(db,combination.id)).draft;a=await save(db,a,fields({tee_name:'Giallo curato',gender:'men'}));
      assert.match((await preview(db,a)).blockers.join(),/Nome tee già/);await fails(()=>publish(db,a),'23505');await archive(db,a);
      a=(await openNew(db,combination.id)).draft;a=await save(db,a,fields({tee_name:'Incompleto',course_rating:null,slope_rating:null}));
      assert.match((await preview(db,a)).blockers.join(),/CR e Slope/);a=await save(db,a,{is_active:false});assert.equal((await preview(db,a)).can_publish,true);await archive(db,a);
      a=(await openNew(db,combination.id)).draft;a=await save(db,a,fields({gender:'invalid'}));assert.equal((await preview(db,a)).can_publish,false);await archive(db,a);
      const legacy=(await owner(db,"insert into public.combination_tees(route_combination_id,tee_name,holes_count,course_rating,slope_rating) values($1,'Storico nove',9,null,null) returning id",[combination.id])).rows[0];
      let l=(await open(db,legacy.id)).draft;l=await save(db,l,{is_active:false});
      assert.equal((await preview(db,l)).foundation_impact.coverage,'incomplete');await publish(db,l);
      const live=(await list()).tees.find(row=>row.id===legacy.id);assert.equal(live.holes_count,9);assert.equal(live.course_rating,null);assert.equal(live.is_active,false);
    });
    await t.test('late version failure rolls back both insertion and closure, leaving the new draft resumable',async()=>{
      await owner(db,"create function public.fail_combo_test() returns trigger language plpgsql as $$begin raise exception 'test rollback';end$$");
      await owner(db,'create trigger fail_combo_test before insert on public.admin_catalog_versions for each row execute function public.fail_combo_test()');
      const start=await dump(db);await fails(()=>publish(db,n),'P0001');assert.deepEqual(await dump(db),start);
      let edit=(await open(db,tee.id)).draft;edit=await save(db,edit,{slope_rating:127});
      const editing=await dump(db);await fails(()=>publish(db,edit),'P0001');assert.deepEqual(await dump(db),editing);await archive(db,edit);
      await owner(db,'drop trigger fail_combo_test on public.admin_catalog_versions');await owner(db,'drop function public.fail_combo_test()');
      const result=await publish(db,n);assert.equal(result.context.tee.id,n.entity_key);assert.equal(result.context.tee.par_total,combination.total_par);assert.equal(result.context.tee.holes_count,18);
      assert.equal((await list()).new_drafts.length,0);assert.ok((await list()).tees.some(row=>row.id===n.entity_key));
    });
    await t.test('changed source/holes invalidate a confirmation; no automatic rebase or partial publication',async()=>{
      let a=(await open(db,tee.id)).draft;a=await save(db,a,{slope_rating:127});
      await owner(db,'update public.route_combination_holes set stroke_index=case stroke_index when 1 then 2 else stroke_index end where route_combination_id=$1',[combination.id]);
      const start=await dump(db);assert.equal((await preview(db,a)).can_publish,false);await fails(()=>publish(db,a),'40001');assert.deepEqual(await dump(db),start);await archive(db,a);
      const newT=(await openNew(db,combination.id)).draft;const saved=await save(db,newT,fields({tee_name:'Struttura incompleta'}));
      assert.equal((await preview(db,saved)).can_publish,false);await archive(db,saved);
    });
    await t.test('Par overlap uses the shared snapshot contract: unchanged combination drafts benign; actual edits block',async()=>{
      let a=(await open(db,tee.id)).draft;
      const overlaps=async()=>{await db.exec('reset role');try{return await rpc(db,'admin_catalog_par_overlapping_drafts',[clubId,[],[],[{entity_type:'combination_tee',tee_id:tee.id}]]);}finally{await role(db);}};
      assert.deepEqual(await overlaps(),[]);a=await save(db,a,{tee_name:'Edited overlap'});assert.equal((await overlaps())[0].draft_id,a.draft_id);await archive(db,a);
    });
    await t.test('accidental reapplication fails and rolls back without changing records or RPC contracts',async()=>{
      const start=await dump(db);await db.exec('reset role');await fails(async()=>db.exec(await sql('admin-combination-tee-crud')),'42701');await db.exec('rollback');await role(db);
      assert.deepEqual(await dump(db),start);assert.ok((await list()).tees.length>0);
    });
  }finally{await db.close();}
});
