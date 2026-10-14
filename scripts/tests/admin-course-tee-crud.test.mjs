// Isolated PostgreSQL fixtures only; never connects to Supabase.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { admin, other, player, setup, role, rpc, sql, state } from './helpers/existing-club-course-fixture.mjs';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const fails = (action, code) => assert.rejects(action, error => error.code === code);
const open = (db,id) => rpc(db,'admin_course_tee_open_draft',[id]);
const openNew = (db,id) => rpc(db,'admin_course_tee_open_new_draft',[id]);
const save = (db,d,snapshot) => rpc(db,'admin_course_tee_save_draft',[d.draft_id,snapshot,d.revision]);
const preview = (db,d) => rpc(db,'admin_course_tee_preview_draft',[d.draft_id]);
const publish = (db,d) => rpc(db,'admin_course_tee_publish_draft',[d.draft_id,d.revision]);
const archive = (db,d) => rpc(db,'admin_course_tee_archive_draft',[d.draft_id,d.revision]);
const newFields = (name='Nuovo tee') => ({tee_name:name,tee_color:'arancio',gender:'men',display_order:2,course_rating:36.1,slope_rating:113,is_active:true});

test('published course tee CRUD: compatibility, Admin-only private drafts and atomic publication',async t=>{
  const db=new PGlite();
  try {
    const {club,old}=await setup(db);
    const before=await state(db),tee=before.route_tees[0];
    let legacy=(await open(db,tee.id)).draft;
    legacy=await save(db,legacy,{...legacy.snapshot,course_rating:36.5});
    const baseline=await state(db);
    await db.exec('reset role');
    const policies=(await db.query('select * from pg_policies order by tablename,policyname')).rows;
    const indexes=(await db.query("select * from pg_indexes where tablename='route_tees' order by indexname")).rows;
    // Install only the real, optional overlap comparator (not a fake publisher).
    const parSql=await sql('admin-catalog-physical-par-source-drafts');
    await db.exec(parSql.slice(parSql.indexOf('create function public.admin_catalog_par_overlapping_drafts('),parSql.indexOf('-- Retain the old fingerprint')));
    await db.exec(await sql('admin-course-tee-crud'));await role(db);

    await t.test('additive one-shot migration preserves saved drafts, history, all live values, policies and indexes',async()=>{
      const after=await state(db);
      assert.deepEqual(after,{...baseline,route_tees:baseline.route_tees.map(row=>({...row,display_order:null}))});
      await db.exec('reset role');
      assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows,policies);
      assert.deepEqual((await db.query("select * from pg_indexes where tablename='route_tees' order by indexname")).rows,indexes);
      for(const table of ['route_tees','admin_catalog_drafts','admin_catalog_versions'])
        assert.equal((await db.query(`select has_table_privilege('authenticated','public.${table}','INSERT,UPDATE,DELETE') allowed`)).rows[0].allowed,false);
      await role(db);
    });
    await t.test('pre-migration three-field draft resumes unchanged and publishes without a false NULL-order conflict',async()=>{
      assert.deepEqual((await open(db,tee.id)).draft,legacy);
      const plan=await preview(db,legacy);assert.equal(plan.can_publish,true);assert.equal(plan.fields.tee_name,tee.tee_name);
      assert.deepEqual(Object.keys(plan.diff),['course_rating']);
      const result=await publish(db,legacy);assert.equal(result.context.tee.course_rating,36.5);
      const after=await state(db);
      for(const key of Object.keys(tee).filter(k=>!['course_rating','updated_at'].includes(k)))assert.deepEqual(after.route_tees[0][key],tee[key]);
      assert.deepEqual(after.admin_catalog_drafts[0].snapshot,legacy.snapshot);
      assert.equal(after.admin_catalog_drafts[0].workflow_status,'published');
      assert.equal(after.admin_catalog_versions[0].diff.course_rating.before,36);
    });
    await t.test('all entry points reject anon, player, missing identity and service; helpers inaccessible',async()=>{
      const functions=[()=>openNew(db,old.id),()=>rpc(db,'admin_course_tee_resume_new_draft',[legacy.draft_id]),
        ()=>preview(db,legacy),()=>rpc(db,'admin_course_tee_list',[old.id]),()=>open(db,tee.id),
        ()=>save(db,legacy,newFields()),()=>publish(db,legacy),()=>archive(db,legacy)];
      for(const [name,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',admin]]) {
        await role(db,name,uid);for(const f of functions)await fails(f,'42501');
        await fails(()=>db.query("select public.admin_course_tee_full_snapshot('{}')"),'42501');
        await fails(()=>db.query("select public.admin_course_tee_new_context($1)",[old.id]),'42501');
      }await role(db);
    });
    let fresh;
    await t.test('new open/resume is private, no live/version writes; ownership and exact seven-field allowlist',async()=>{
      const start=await state(db);fresh=(await openNew(db,old.id)).draft;
      assert.equal(fresh.live_entity_id,null);assert.equal(fresh.snapshot.tee_name,'');
      const resumed=await rpc(db,'admin_course_tee_resume_new_draft',[fresh.draft_id]);assert.deepEqual(resumed.draft,fresh);
      const after=await state(db);assert.deepEqual(after.route_tees,start.route_tees);assert.deepEqual(after.admin_catalog_versions,start.admin_catalog_versions);
      await role(db,'authenticated',other);
      for(const action of [()=>preview(db,fresh),()=>save(db,fresh,newFields()),()=>publish(db,fresh),()=>rpc(db,'admin_course_tee_resume_new_draft',[fresh.draft_id])])await fails(action,'42501');
      await role(db);
      for(const key of ['holes_count','par_total','route_id','source_payload','estimated','id'])await fails(()=>save(db,fresh,{...newFields(),[key]:9}),'22023');
      for(const fields of [{...newFields(),tee_name:''},{...newFields(),course_rating:'36'}, {...newFields(),display_order:0.5}])await fails(()=>save(db,fresh,fields),'22023');
      for(const slope of [54,156,125.5])await fails(()=>save(db,fresh,{...newFields(),slope_rating:slope}),'23514');
      fresh=await save(db,fresh,newFields());await fails(()=>save(db,{...fresh,revision:1},newFields()),'40001');
      assert.equal((await state(db)).route_tees.length,1);
    });
    await t.test('preview is read-only and includes exact server scope/Par, metadata diff and uniqueness across category/inactive/null scopes',async()=>{
      await db.exec('begin read only');const plan=await preview(db,fresh);await db.exec('commit');
      assert.equal(plan.can_publish,true);assert.equal(plan.context.course.holes_count,9);assert.equal(plan.context.tee.par_total,36);
      assert.equal(plan.diff.tee_name.before,null);assert.equal(plan.diff.tee_name.after,'Nuovo tee');
      let collision=(await openNew(db,old.id)).draft;
      collision=await save(db,collision,{...newFields(tee.tee_name),gender:'women',is_active:false});
      assert.match((await preview(db,collision)).blockers.join(),/Nome tee già/);await fails(()=>publish(db,collision),'23505');await archive(db,collision);
      collision=(await openNew(db,old.id)).draft;
      collision=await save(db,collision,{...newFields('Incompleto'),course_rating:null,slope_rating:null});
      assert.match((await preview(db,collision)).blockers.join(),/CR e Slope/);
      collision=await save(db,collision,{...collision.snapshot,is_active:false});assert.equal((await preview(db,collision)).can_publish,true);await archive(db,collision);
      collision=(await openNew(db,old.id)).draft;collision=await save(db,collision,{...newFields('Categoria non valida'),gender:'mixed'});
      assert.match((await preview(db,collision)).blockers.join(),/Categoria/);await fails(()=>publish(db,collision),'22023');await archive(db,collision);
    });
    await t.test('creation publishes one live tee and immutable version, closes only its own draft and preserves holes/Par/SI/rounds/source',async()=>{
      const start=await state(db),result=await publish(db,fresh),after=await state(db);
      assert.equal(result.context.tee.id,fresh.entity_key);assert.equal(result.context.tee.holes_count,9);assert.equal(result.context.tee.par_total,36);
      assert.equal(result.context.tee.estimated,false);assert.equal(result.version_number,1);
      for(const table of Object.keys(start).filter(k=>!['route_tees','admin_catalog_drafts','admin_catalog_versions'].includes(k)))assert.deepEqual(after[table],start[table]);
      assert.deepEqual(after.route_tees.find(row=>row.id===tee.id),start.route_tees[0]);
      assert.equal(after.route_tees.length,2);assert.equal(after.admin_catalog_versions.length,start.admin_catalog_versions.length+1);
      const version=after.admin_catalog_versions.find(row=>row.version_id===result.version_id);
      assert.equal(version.published_by,admin);assert.deepEqual(version.snapshot,fresh.snapshot);assert.equal(version.diff.creation,true);
      assert.equal(after.admin_catalog_drafts.find(row=>row.draft_id===fresh.draft_id).workflow_status,'published');
      assert.equal((await rpc(db,'admin_course_tee_list',[old.id])).new_drafts.length,0);
      await fails(()=>publish(db,fresh),'40001');
      await db.exec('reset role');await fails(()=>db.query("update public.admin_catalog_versions set diff='{}' where version_id=$1",[result.version_id]),'55000');await role(db);
    });
    await t.test('metadata and CR edits reuse existing entity lineage; no source normalization/order backfill or read-only changes',async()=>{
      await db.exec('reset role');await db.query("update public.route_tees set tee_color='  yellow  ',gender='legacy',source_payload=source_payload||'{\"admin_display_order\":7}' where id=$1",[tee.id]);await role(db);
      const opened=await open(db,tee.id);let d=opened.draft;const start=await state(db);
      assert.equal(opened.context.tee.display_order,7);assert.equal(d.snapshot.display_order,7);assert.equal(d.snapshot.tee_color,'yellow');
      assert.equal((await rpc(db,'admin_course_tee_list',[old.id])).tees.find(row=>row.id===tee.id).has_draft_changes,false);
      d=await save(db,d,{...d.snapshot,slope_rating:114});assert.equal((await preview(db,d)).can_publish,true);await publish(db,d);
      const retained=(await state(db)).route_tees.find(row=>row.id===tee.id);assert.equal(retained.display_order,null);assert.equal(retained.tee_color,'  yellow  ');assert.equal(retained.gender,'legacy');
      d=(await open(db,tee.id)).draft;
      d=await save(db,d,{...d.snapshot,tee_name:'Storico rinominato',tee_color:'white',gender:'women',display_order:1,is_active:false});
      const plan=await preview(db,d);assert.equal(plan.can_publish,true);assert.equal(plan.diff.gender.before,'legacy');const result=await publish(db,d);
      assert.equal(result.version_number,3);
      const after=(await state(db)).route_tees.find(row=>row.id===tee.id);
      for(const key of Object.keys(retained).filter(k=>!['tee_name','tee_color','gender','display_order','is_active','updated_at'].includes(k)))assert.deepEqual(after[key],retained[key]);
      assert.deepEqual(after.source_payload,start.route_tees.find(row=>row.id===tee.id).source_payload);
      assert.equal((await rpc(db,'admin_course_tee_list',[old.id])).tees[0].id,tee.id);
    });
    await t.test('new generation draft conflicts with a changed grid or parent; existing tee conflicts with actual order/base changes',async()=>{
      let d=(await openNew(db,old.id)).draft;d=await save(db,d,newFields('Base mutata'));
      await db.exec('reset role');await db.query('update public.route_holes set stroke_index=10 where route_id=$1 and physical_hole_number=1',[old.id]);await role(db);
      assert.equal((await preview(db,d)).can_publish,false);await fails(()=>publish(db,d),'40001');await archive(db,d);
      await db.exec('reset role');await db.query('update public.route_holes set stroke_index=1 where route_id=$1 and physical_hole_number=1',[old.id]);await role(db);
      d=(await open(db,tee.id)).draft;d=await save(db,d,{...d.snapshot,is_active:true});
      await db.exec('reset role');await db.query('update public.route_tees set display_order=9 where id=$1',[tee.id]);await role(db);
      await fails(()=>publish(db,d),'40001');await archive(db,d);
      d=(await openNew(db,old.id)).draft;d=await save(db,d,newFields('Percorso mutato'));
      await db.exec('reset role');await db.query('update public.course_routes set total_par=35 where id=$1',[old.id]);await role(db);
      await fails(()=>publish(db,d),'40001');await archive(db,d);
      await db.exec('reset role');await db.query('update public.course_routes set total_par=36 where id=$1',[old.id]);await role(db);
    });
    await t.test('failure while recording history rolls back creation/edit and closure; abandoning even an empty new draft never deletes live',async()=>{
      let d=(await openNew(db,old.id)).draft;d=await save(db,d,newFields('Rollback'));
      await db.exec(`reset role;create function public.fail_tee_test() returns trigger language plpgsql as $$begin raise exception 'test rollback';end$$;
        create trigger fail_tee_test before insert on public.admin_catalog_versions for each row execute function public.fail_tee_test();`);await role(db);
      const start=await state(db);await fails(()=>publish(db,d),'P0001');assert.deepEqual(await state(db),start);await archive(db,d);
      let edit=(await open(db,tee.id)).draft;edit=await save(db,edit,{...edit.snapshot,slope_rating:115});
      const editing=await state(db);await fails(()=>publish(db,edit),'P0001');assert.deepEqual(await state(db),editing);await archive(db,edit);
      await db.exec('reset role;drop trigger fail_tee_test on public.admin_catalog_versions;drop function public.fail_tee_test();');await role(db);
      const empty=(await openNew(db,old.id)).draft;const live=(await state(db)).route_tees;
      await archive(db,empty);assert.deepEqual((await state(db)).route_tees,live);
      await fails(()=>rpc(db,'admin_course_tee_resume_new_draft',[empty.draft_id]),'42501');
    });
    await t.test('actual Par overlap comparator recognises untouched full/legacy tee drafts; real metadata changes block',async()=>{
      let d=(await open(db,tee.id)).draft;
      const overlaps=()=>rpc(db,'admin_catalog_par_overlapping_drafts',[club.id,[],[],[{entity_type:'route_tee',tee_id:tee.id}]]);
      await db.exec('reset role');assert.deepEqual(await overlaps(),[]);await role(db);
      d=await save(db,d,{...d.snapshot,tee_name:'Modifica sovrapposta'});
      await db.exec('reset role');assert.equal((await overlaps())[0].draft_id,d.draft_id);await role(db);await archive(db,d);
      // Original published three-field version/snapshot remains immutable.
      assert.deepEqual((await state(db)).admin_catalog_drafts.find(row=>row.draft_id===legacy.draft_id).snapshot,legacy.snapshot);
    });
  } finally {await db.close();}
});
