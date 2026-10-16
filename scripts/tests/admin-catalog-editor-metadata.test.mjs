import assert from 'node:assert/strict';
import {test} from 'node:test';
import {admin,other,player,role,rpc,sql,setupCombinationTees,owner,dump} from './helpers/combination-tee-fixture.mjs';
const {PGlite}=await import(process.env.STABLR_PGLITE_MODULE||'@electric-sql/pglite');
const fail=(fn,code)=>assert.rejects(fn,e=>e.code===code);
export const call=(db,kind,id,action,args=[])=>rpc(db,'admin_catalog_metadata',[kind,id,action,...args]);
test('curated catalog metadata: legacy compatibility, exact scope, reviewed publication and safe restore',async t=>{
  const db=new PGlite();
  try{
    const {clubId,combination,tee}=await setupCombinationTees(db),courseId=combination.front_route_id;
    // Supabase-managed default SELECT grants already used by the real player.
    await owner(db,'grant select on public.clubs,public.course_routes,public.route_combinations to authenticated');
    const legacyCourse=(await rpc(db,'admin_course_open_draft',[courseId])).draft;
    const legacyRoute=(await rpc(db,'admin_route_open_draft',[combination.id])).draft;
    const initial=await dump(db);await db.exec('reset role');await db.exec(await sql('admin-catalog-editor-metadata'));await role(db);
    let d,plan,published;
    const open=(kind='route',id=courseId)=>call(db,kind,id,'open');
    const save=(kind,id,draft,fields)=>call(db,kind,id,'save',[draft.draft_id,draft.revision,fields]);
    const preview=(kind,id,draft)=>call(db,kind,id,'preview',[draft.draft_id,draft.revision]);
    const publish=(kind,id,draft,p,note='Decisione editoriale test')=>call(db,kind,id,'publish',[draft.draft_id,draft.revision,null,p.confirmation_hash,note]);
    await t.test('additive installation preserves every existing live row, draft, immutable source and foundation baseline',async()=>{
      const after=await dump(db);for(const [table,rows] of Object.entries(initial))assert.deepEqual(after[table],rows,table);
      assert.deepEqual(after.catalog_editor_metadata,[]);
      await db.exec('begin read only');const detail=await call(db,'route',courseId,'detail');await db.exec('commit');
      assert.deepEqual(detail.fields.aliases,[]);assert.equal(detail.has_open_draft,true);assert.equal(detail.history.length,0);
      const list=await rpc(db,'admin_catalog_multi9_club_preview',[clubId]);assert.ok(list); // Existing foundation still readable.
      assert.equal((await open()).draft.draft_id,legacyCourse.draft_id);
    });
    await t.test('anon, player, missing identity and service API cannot invoke any action or write tables; old publishers cannot bypass confirmation',async()=>{
      for(const [r,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',admin]]){
        await role(db,r,uid);for(const action of ['detail','history','open','save','preview','publish','restore'])await fail(()=>call(db,'route',courseId,action),'42501');
      }
      await role(db);for(const fn of ['admin_course_publish_draft','admin_route_publish_draft'])await fail(()=>rpc(db,fn,[legacyCourse.draft_id,1]),'42501');
      for(const r of ['anon','authenticated','service_role'])assert.equal((await owner(db,"select has_table_privilege($1,'public.catalog_editor_metadata','INSERT,UPDATE,DELETE') ok",[r])).rows[0].ok,false);
      await role(db,'authenticated',other);await fail(()=>preview('route',courseId,legacyCourse),'42501');await role(db);
    });
    await t.test('legacy drafts can save aliases/notes privately; strict allowlist rejects source/identity/structure/Par edits',async()=>{
      d=await save('route',courseId,legacyCourse,{...legacyCourse.snapshot,aliases:['Nove curate'],notes:'Nota editoriale pubblica'});
      for(const extra of [{source_payload:{}},{source_external_id:'new'},{club_id:clubId},{total_par:99},{fig_club_id:other}])
        await fail(()=>save('route',courseId,d,{...d.snapshot,...extra}),'22023');
      for(const aliases of [['x',' X '],[''],[17],Array(21).fill('x')])await fail(()=>save('route',courseId,d,{...d.snapshot,aliases}),'22023');
      await fail(()=>save('route',courseId,d,{...d.snapshot,notes:'x'.repeat(5001)}),'22023');
      const before=await dump(db);await db.exec('begin read only');plan=await preview('route',courseId,d);await db.exec('commit');assert.deepEqual(await dump(db),before);
      assert.equal(plan.can_publish,true);assert.equal(plan.impact.metadata_only,true);assert.equal(plan.warnings.length,0);assert.ok(plan.changes.aliases);
      const structural=await save('route',courseId,d,{...d.snapshot,holes_count:18});
      const blocked=await preview('route',courseId,structural);assert.equal(blocked.can_publish,false);assert.match(blocked.blockers.join(' '),/Struttura/);
      await fail(()=>publish('route',courseId,structural,blocked),'23514');
      d=await save('route',courseId,structural,d.snapshot);plan=await preview('route',courseId,d);
    });
    await t.test('stale revision, changed preview, missing note and late failures roll back metadata, live, history and closure',async()=>{
      await fail(()=>publish('route',courseId,d,{...plan,confirmation_hash:'0'.repeat(64)}),'40001');
      await fail(()=>publish('route',courseId,d,plan,' '),'22023');await fail(()=>preview('route',courseId,{...d,revision:99}),'40001');
      await owner(db,"create function public.metadata_fixture_fail() returns trigger language plpgsql as $$begin raise exception 'late failure' using errcode='23514';end;$$");
      for(const table of ['admin_catalog_versions','catalog_editor_metadata']){
        await owner(db,`create trigger metadata_fixture_failure before insert on public.${table} for each row execute function public.metadata_fixture_fail()`);
        const before=await dump(db);await fail(()=>publish('route',courseId,d,plan),'23514');assert.deepEqual(await dump(db),before);
        await owner(db,`drop trigger metadata_fixture_failure on public.${table}`);
      }
    });
    await t.test('metadata-only publication does not touch live timestamps or verified foundations; author/date/diff and draft closure are atomic',async()=>{
      const originBefore=await rpc(db,'admin_catalog_data_origin',[clubId]);
      const teeBefore=await rpc(db,'admin_catalog_tee_classification_detail',[clubId,'combination_tee',tee.id]);
      assert.equal(teeBefore.state,'current');
      const before=await dump(db);published=await publish('route',courseId,d,plan);const after=await dump(db);
      for(const table of ['clubs','course_routes','route_holes','route_tees','route_combinations','route_combination_holes','combination_tees','rounds','round_holes',
        'admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_physical_course_links','admin_catalog_foundation_events'])assert.deepEqual(after[table],before[table],table);
      assert.equal(published.course.notes,'Nota editoriale pubblica');assert.equal(after.catalog_editor_metadata.length,1);
      assert.equal(after.admin_catalog_drafts.find(x=>x.j.draft_id===d.draft_id).j.workflow_status,'published');
      const v=after.admin_catalog_versions.find(x=>x.j.version_id===published.version_id).j;assert.equal(v.published_by,admin);assert.ok(v.diff.aliases);assert.ok(v.published_at);
      const originAfter=await rpc(db,'admin_catalog_data_origin',[clubId]);
      for(const key of ['physical_links','configurations'])assert.deepEqual(originAfter[key],originBefore[key]);
      assert.deepEqual((await rpc(db,'admin_catalog_tee_classification_detail',[clubId,'combination_tee',tee.id])).baseline,teeBefore.baseline);
    });
    await t.test('publication of a curated name reports precise foundation impact without rewriting baselines or imported names',async()=>{
      d=(await open()).draft;d=await save('route',courseId,d,{...d.snapshot,name:'Denominazione STABLR curata'});plan=await preview('route',courseId,d);
      assert.equal(plan.impact.live_record_changes,true);assert.ok(plan.impact.foundation.length);assert.ok(plan.warnings[0].includes('baseline'));
      const originBefore=await rpc(db,'admin_catalog_data_origin',[clubId]);
      assert.equal(originBefore.physical_links.find(link=>link.course_id===courseId).source_state,'matched');
      const before=await dump(db);await publish('route',courseId,d,plan);const after=await dump(db);
      const a=after.course_routes.find(x=>x.j.id===courseId).j,b=before.course_routes.find(x=>x.j.id===courseId).j;
      assert.deepEqual({...a,name:b.name,updated_at:b.updated_at},b);assert.equal(a.name,'Denominazione STABLR curata');
      assert.notEqual(a.updated_at,b.updated_at);
      const originAfter=await rpc(db,'admin_catalog_data_origin',[clubId]);
      assert.equal(originAfter.physical_links.find(link=>link.course_id===courseId).source_state,'changed');
      assert.equal(originAfter.configurations.find(cfg=>cfg.legacy_course_route_id===courseId).source_state,'changed');
      const teeAfter=await rpc(db,'admin_catalog_tee_classification_detail',[clubId,'combination_tee',tee.id]);
      assert.equal(teeAfter.state,'obsolete');assert.equal(teeAfter.baseline.configuration_valid,false);
      for(const table of ['admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_physical_course_links','admin_catalog_foundation_events'])assert.deepEqual(after[table],before[table]);
    });
    await t.test('restore creates a NEW draft on CURRENT base, never overwrites an open draft or restores structural fields',async()=>{
      const firstId=published.version_id;
      d=(await open()).draft;await fail(()=>call(db,'route',courseId,'restore',[null,null,null,null,null,firstId]),'40001');
      await rpc(db,'admin_catalog_archive_draft',[d.draft_id,'route',d.revision]);
      const before=await dump(db),restored=await call(db,'route',courseId,'restore',[null,null,null,null,null,firstId]);d=restored.draft;
      assert.equal(d.snapshot.name,legacyCourse.snapshot.name);assert.notEqual(d.draft_id,legacyCourse.draft_id);
      assert.equal(d.base_snapshot._context.restored_from_version_id,firstId);
      const after=await dump(db);for(const table of ['course_routes','route_holes','route_tees','admin_catalog_versions'])assert.deepEqual(after[table],before[table]);
      plan=await preview('route',courseId,d);assert.equal(plan.can_publish,true);
      await fail(()=>call(db,'route_combination',combination.id,'restore',[null,null,null,null,null,firstId]),'40001'); // Own open combination draft remains intact.
      await rpc(db,'admin_catalog_archive_draft',[d.draft_id,'route',d.revision]);
    });
    await t.test('combination aliases/notes/order use separate projection, preserve immutable origins/holes/SI/tees and source fallback',async()=>{
      d=legacyRoute;
      // Origin name publication correctly invalidated this old structural base: abandon explicitly.
      await fail(()=>preview('route_combination',combination.id,d),'40001');
      await rpc(db,'admin_catalog_archive_draft',[d.draft_id,'route_combination',d.revision]);
      d=(await open('route_combination',combination.id)).draft;
      d=await save('route_combination',combination.id,d,{...d.snapshot,aliases:['Championship curato'],notes:'Note combinazione',display_order:0});
      for(const extra of [{front_route_id:courseId},{holes_count:9},{total_par:100},{holes:[]},{source_payload:{}}])
        await fail(()=>save('route_combination',combination.id,d,{...d.snapshot,...extra}),'22023');
      plan=await preview('route_combination',combination.id,d);assert.equal(plan.can_publish,true);assert.equal(plan.impact.metadata_only,true);
      assert.equal(plan.warnings.length,0);
      const originBefore=await rpc(db,'admin_catalog_data_origin',[clubId]);
      const teeBefore=await rpc(db,'admin_catalog_tee_classification_detail',[clubId,'combination_tee',tee.id]);
      const before=await dump(db);await publish('route_combination',combination.id,d,plan);const after=await dump(db);
      for(const table of ['route_combinations','route_combination_holes','combination_tees','course_routes','route_holes','route_tees','rounds','round_holes','admin_catalog_foundation_events'])assert.deepEqual(after[table],before[table],table);
      const row=after.catalog_editor_metadata.find(x=>x.j.entity_type==='route_combination').j;assert.equal(row.display_order,0);
      const history=await call(db,'route_combination',combination.id,'history');assert.equal(history.history.length,1);assert.ok(history.history[0].changes.display_order);
      assert.ok(!/source_payload|base_snapshot|private/.test(JSON.stringify(history)));
      const originAfter=await rpc(db,'admin_catalog_data_origin',[clubId]);
      for(const key of ['physical_links','configurations'])assert.deepEqual(originAfter[key],originBefore[key]);
      assert.deepEqual((await rpc(db,'admin_catalog_tee_classification_detail',[clubId,'combination_tee',tee.id])).baseline,teeBefore.baseline);
    });
    await t.test('combination curated name changes source baseline through name/updated_at, not Par/SI or historical snapshots',async()=>{
      d=(await open('route_combination',combination.id)).draft;
      d=await save('route_combination',combination.id,d,{...d.snapshot,name:'Combinazione curata'});
      plan=await preview('route_combination',combination.id,d);
      assert.equal(plan.impact.metadata_only,false);assert.ok(plan.warnings.some(w=>w.includes('baseline')));
      const originBefore=await rpc(db,'admin_catalog_data_origin',[clubId]);
      assert.equal(originBefore.configurations.find(cfg=>cfg.legacy_combination_id===combination.id).source_state,'matched');
      const before=await dump(db);await publish('route_combination',combination.id,d,plan);const after=await dump(db);
      const a=after.route_combinations.find(x=>x.j.id===combination.id).j,b=before.route_combinations.find(x=>x.j.id===combination.id).j;
      assert.notEqual(a.updated_at,b.updated_at);assert.equal(a.name,'Combinazione curata');
      assert.deepEqual({...a,name:b.name,updated_at:b.updated_at},b);
      const originAfter=await rpc(db,'admin_catalog_data_origin',[clubId]);
      assert.equal(originAfter.configurations.find(cfg=>cfg.legacy_combination_id===combination.id).source_state,'changed');
      for(const table of ['course_routes','route_holes','route_combination_holes','route_tees','combination_tees','rounds','round_holes',
        'admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_physical_course_links','admin_catalog_foundation_events'])assert.deepEqual(after[table],before[table],table);
    });
    await t.test('player sees only published editorial columns for active playable targets, never author/revision/drafts or API mutation',async()=>{
      await role(db,'authenticated',player);const columns='entity_type,live_entity_id,aliases,notes,display_order';
      assert.equal((await db.query('select '+columns+' from public.catalog_editor_metadata')).rows.length,2);
      await fail(()=>db.query('select * from public.catalog_editor_metadata'),'42501');
      await fail(()=>db.query('select created_by from public.catalog_editor_metadata'),'42501');
      await role(db,'anon','');await fail(()=>db.query('select '+columns+' from public.catalog_editor_metadata'),'42501');
      await role(db);await fail(()=>owner(db,'delete from public.catalog_editor_metadata'),'55000');
    });
  } finally {await db.close();}
});
