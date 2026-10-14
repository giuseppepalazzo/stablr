// Local isolated PostgreSQL only. Exact registered physical/configuration links.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { admin,other,player,setup,role,rpc,sql } from './helpers/existing-club-course-fixture.mjs';
const { PGlite }=await import(process.env.STABLR_PGLITE_MODULE||'@electric-sql/pglite');
const fails=(action,code)=>assert.rejects(action,e=>e.code===code);
test('tee preview: verified 9×2 baseline impact, isolation and no writes',async t=>{
  const db=new PGlite();
  const owner=async(statement,args=[])=>{await db.exec('reset role');try{return await db.query(statement,args);}finally{await role(db);}};
  const dump=async()=>{await db.exec('reset role');const out={};for(const {tablename} of (await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows)
    out[tablename]=(await db.query(`select to_jsonb(t) j from public.${tablename} t order by to_jsonb(t)::text`)).rows;await role(db);return out;};
  const open=id=>rpc(db,'admin_course_tee_open_draft',[id]);
  const save=(d,fields)=>rpc(db,'admin_course_tee_save_draft',[d.draft_id,{...d.snapshot,...fields},d.revision]);
  const preview=d=>rpc(db,'admin_course_tee_preview_draft',[d.draft_id]);
  try {
    const {club,old}=await setup(db);
    for(const name of ['admin-catalog-physical-foundation','admin-catalog-physical-course-links','admin-catalog-playable-configurations',
      'admin-catalog-physical-18-configurations','admin-catalog-structure-club-lock','admin-catalog-multi9','admin-catalog-multi9-club-proposals',
      'admin-catalog-multi9-preview-repair','admin-catalog-data-origin','admin-catalog-tee-classifications','admin-course-tee-crud']) {
      await db.exec('reset role');await db.exec(await sql(name));await role(db);
    }
    // Mare regression form: single physical nine, explicit independent 9/18 tee rows.
    await owner('update public.route_holes set stroke_index=2*physical_hole_number-1,par=case physical_hole_number when 1 then 3 else 4 end where route_id=$1',[old.id]);
    await owner("update public.course_routes set name='Percorso',total_par=35 where id=$1",[old.id]);
    const nine=(await owner("update public.route_tees set tee_name='Giallo',tee_color='giallo',par_total=35,course_rating=34.8 where route_id=$1 returning *",[old.id])).rows[0];
    const eighteen=(await owner("insert into public.route_tees(route_id,tee_name,tee_color,holes_count,par_total,course_rating,slope_rating) values($1,'Giallo','giallo',18,70,69.6,125) returning *",[old.id])).rows[0];
    let s=await rpc(db,'admin_catalog_foundation_create_structure',[club.id,'Mare fixture','stablr','Exact source fixture','Manual test']);
    s=await rpc(db,'admin_catalog_foundation_review_structure',[s.id,s.revision,'fisico_9','stablr','Exact source fixture','Manual test',true]);
    let link=await rpc(db,'admin_catalog_physical_course_preview',[s.id,old.id]);
    link=await rpc(db,'admin_catalog_physical_course_register',[s.id,old.id,s.revision,link.source,'Explicit source',true]);
    link=await rpc(db,'admin_catalog_physical_course_verify',[link.link.id,link.link.revision,link.mapping,'Verified mapping',true]);
    const configurations=[];
    for(const kind of ['autonomous_9','repeated_18']) {
      let p=await rpc(db,'admin_catalog_playable_preview',[s.id,link.link.id,kind]);
      p=await rpc(db,'admin_catalog_playable_register',[s.id,link.link.id,kind,p.baseline,'Explicit configuration',true]);
      p=await rpc(db,'admin_catalog_playable_verify',[p.configuration.id,p.configuration.revision,p.baseline,p.saved_holes,'Verified configuration',true]);configurations.push(p.configuration);
    }
    for(const [tee,cfg] of [[nine,configurations[0]],[eighteen,configurations[1]]]) {
      const detail=await rpc(db,'admin_catalog_tee_classification_detail',[club.id,'route_tee',tee.id]);
      const decision={attestation:'curato',par_behavior:'derivato',provenance:'stablr',note:'Explicit test-only derivation',
        evidence:{kind:'admin_review',reference:'verified_configuration:'+cfg.id,par_total:tee.par_total,holes_count:tee.holes_count,applicability:null},
        configuration_id:cfg.id,derivation_rule:'sum_configuration_effective_par',declared_holes_count:tee.holes_count,declared_applicability:null};
      const p=await rpc(db,'admin_catalog_tee_classification_preview',[club.id,'route_tee',tee.id,decision,detail.revision]);
      await rpc(db,'admin_catalog_tee_classification_confirm',[club.id,'route_tee',tee.id,p.decision,p.revision,p.baseline,true]);
    }
    const baseline=await dump();await db.exec('reset role');await db.exec(await sql('admin-course-tee-foundation-impact'));await role(db);
    await t.test('one-shot migration writes no records and keeps all foundation/catalog/history rows immutable',async()=>assert.deepEqual(await dump(),baseline));
    await t.test('shared combination extension preserves the exact existing Mare 9/18 course preview and writes no rows',async()=>{
      let original=(await open(nine.id)).draft;original=await save(original,{tee_color:'orange'});
      const oldPreview=await preview(original),rows=await dump();
      await db.exec('reset role');await db.exec(await sql('admin-route-editor'));await db.exec(await sql('admin-combination-tee-crud'));await role(db);
      assert.deepEqual(await preview(original),oldPreview);assert.deepEqual(await dump(),rows);
      await rpc(db,'admin_course_tee_archive_draft',[original.draft_id,original.revision]);
    });
    await t.test('all APIs/helper reject anon, player, missing UID, service role and another draft owner',async()=>{
      const d=(await open(nine.id)).draft;
      for(const [name,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',admin],['authenticated',other]]) {
        await role(db,name,uid);await fails(()=>preview(d),'42501');
        await fails(()=>rpc(db,'admin_course_tee_preview_without_impact',[d.draft_id]),'42501');
      }await role(db);
    });
    let d;
    await t.test('color-only nine publication previews BOTH verified 9/18 snapshots, read-only and minimized',async()=>{
      d=(await open(nine.id)).draft;d=await save(d,{tee_color:'orange'});
      const start=await dump();await db.exec('begin read only');const plan=await preview(d);await db.exec('commit');assert.deepEqual(await dump(),start);
      assert.equal(plan.can_publish,true);assert.equal(plan.foundation_impact.may_block_par,true);
      assert.deepEqual(plan.foundation_impact.configurations.map(c=>c.holes_count),[9,18]);
      assert.ok(plan.foundation_impact.configurations.every(c=>c.reason==='recorded_tee_baseline'&&c.tee_state==='matched'));
      assert.equal(plan.foundation_impact.baselines_updated,false);
      assert.equal(plan.foundation_impact.classification_count,2);
      assert.ok(!/source_payload|snapshot|distances_m/.test(JSON.stringify(plan.foundation_impact)));
    });
    await t.test('new private tee predicts baseline invalidation before publication, while ratings/tee18 remain independent',async()=>{
      let n=(await rpc(db,'admin_course_tee_open_new_draft',[old.id])).draft;
      n=await save(n,{tee_name:'Nuovo arancio',tee_color:'arancio',gender:'women',display_order:1,course_rating:35,slope_rating:113,is_active:true});
      const start=await dump(),plan=await preview(n);assert.equal(plan.is_new,true);
      assert.deepEqual(plan.foundation_impact.configurations.map(c=>c.holes_count),[9,18]);assert.deepEqual(await dump(),start);
      assert.equal((await rpc(db,'admin_course_tee_list',[old.id])).tees.find(row=>row.id===eighteen.id).course_rating,69.6);
      await rpc(db,'admin_course_tee_archive_draft',[n.draft_id,n.revision]);
    });
    await t.test('confirm changes only selected nine tee and its draft/version; foundation and eighteen tee are never rebased/updated',async()=>{
      const start=await dump();await rpc(db,'admin_course_tee_publish_draft',[d.draft_id,d.revision]);const after=await dump();
      for(const table of Object.keys(start).filter(k=>!['route_tees','admin_catalog_drafts','admin_catalog_versions'].includes(k)))assert.deepEqual(after[table],start[table],table);
      assert.deepEqual(after.route_tees.find(row=>row.j.id===eighteen.id),start.route_tees.find(row=>row.j.id===eighteen.id));
      const g=await rpc(db,'admin_catalog_data_origin',[club.id]);assert.ok(g.configurations.filter(c=>configurations.some(x=>x.id===c.id)).every(c=>c.tee_state==='changed'));
    });
    await t.test('no verified exact relationship is reported as incomplete, never linked by an equal name or color',async()=>{
      const otherCourse=(await owner("insert into public.course_routes(club_id,name,holes_count,total_par) values($1,'Percorso',9,35) returning id",[club.id])).rows[0];
      const unrelated=(await owner("insert into public.route_tees(route_id,tee_name,tee_color,holes_count,course_rating,slope_rating) values($1,'Giallo','giallo',9,34.8,125) returning id",[otherCourse.id])).rows[0];
      let u=(await open(unrelated.id)).draft;u=await save(u,{tee_color:'orange'});
      const p=await preview(u);assert.equal(p.foundation_impact.coverage,'incomplete');assert.deepEqual(p.foundation_impact.configurations,[]);
    });
    await t.test('stale confirmation still fails and rolls back: the informational wrapper bypasses no publisher controls',async()=>{
      let stale=(await open(eighteen.id)).draft;stale=await save(stale,{slope_rating:126});
      assert.equal((await preview(stale)).can_publish,true);
      await owner('update public.route_tees set slope_rating=127 where id=$1',[eighteen.id]);
      const before=await dump();await fails(()=>rpc(db,'admin_course_tee_publish_draft',[stale.draft_id,stale.revision]),'40001');assert.deepEqual(await dump(),before);
    });
  } finally {await db.close();}
});
