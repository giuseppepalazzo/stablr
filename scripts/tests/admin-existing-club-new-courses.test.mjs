import assert from 'node:assert/strict';
import { test } from 'node:test';
import { admin,other,player,setup,role,rpc,create,configure,preview,publish,state,sql,courseFields,teeFields,grid,tables } from './helpers/existing-club-course-fixture.mjs';
const {PGlite}=await import(process.env.STABLR_PGLITE_MODULE||'@electric-sql/pglite');
const fails=(action,code)=>assert.rejects(action,error=>error.code===code);
test('existing Club new courses: private workflow, server completeness, atomic publication and preserved catalog',async t=>{
  const db=new PGlite();let draft,configured,plan;
  try {
    const {club}=await setup(db);const original=await state(db);
    await t.test('list/preview read-only; first save creates only a personal context and course draft',async()=>{
      await db.exec('begin read only');const empty=await rpc(db,'admin_existing_club_courses',[club.id]);await db.exec('commit');
      assert.deepEqual(empty.courses,[]);assert.deepEqual(await state(db),original);
      draft=await create(db,club);const after=await state(db);
      assert.equal(after.admin_existing_club_course_contexts.length,1);assert.equal(after.admin_catalog_drafts.length,2);
      for(const table of tables.slice(0,10))assert.deepEqual(after[table],original[table]);
      await db.exec('begin read only');plan=await preview(db,draft);await db.exec('commit');
      assert.equal(plan.can_publish,false);assert.equal(plan.checklist.holes,false);assert.equal(plan.checklist.tees,false);
      assert.deepEqual((await rpc(db,'admin_existing_club_courses',[club.id])).courses[0].draft_id,draft.draft_id);
    });
    await t.test('all RPCs reject anon/player/no identity/service/other owner; no API DML grants',async()=>{
      const before=await state(db);
      for(const [name,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',''],['service_role',admin]]){
        await role(db,name,uid);
        for(const [fn,args] of [['admin_existing_club_courses',[club.id]],['admin_existing_club_course_save',[club.id,courseFields()]],
          ['admin_existing_club_course_archive',[club.id,draft.draft_id,draft.revision]],['admin_existing_club_course_preview',[draft.draft_id]],
          ['admin_existing_club_course_publish',[draft.draft_id,draft.revision,plan.confirmation_hash,'Test']]])await fails(()=>rpc(db,fn,args),'42501');
      }
      await role(db,'authenticated',other);assert.deepEqual((await rpc(db,'admin_existing_club_courses',[club.id])).courses,[]);
      await fails(()=>preview(db,draft),'42501');await fails(()=>publish(db,draft,plan),'42501');
      await fails(()=>rpc(db,'admin_existing_club_course_save',[club.id,courseFields(),draft.draft_id,draft.revision]),'42501');
      assert.deepEqual(await state(db),before);
      await db.exec('reset role');for(const table of tables.slice(-2))for(const api of ['anon','authenticated','service_role'])for(const grant of ['INSERT','UPDATE','DELETE','TRUNCATE'])
        assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[api,'public.'+table,grant])).rows[0].allowed,false);await role(db);
    });
    await t.test('strict fields, complete grid, rating domains and derived Par/scope; source Club stays untouched',async()=>{
      for(const fields of [{...courseFields(),holes_count:10},{...courseFields(),name:' '},{...courseFields(),display_order:0.5},{...courseFields(),club_id:club.id}])
        await fails(()=>create(db,club,fields),'22023');
      configured=await configure(db,draft);plan=await preview(db,draft);assert.equal(plan.can_publish,true);assert.equal(plan.course.total_par,36);
      assert.equal(plan.course.tees[0].par_total,36);assert.equal(plan.course.tees[0].holes_count,9);
      await fails(()=>rpc(db,'admin_new_course_tee_save',[draft.draft_id,teeFields({slope_rating:36}),draft.revision,configured.holes.draft_id,configured.holes.revision]),'22023');
      await fails(()=>rpc(db,'admin_new_course_tee_save',[draft.draft_id,teeFields({par_total:999}),draft.revision,configured.holes.draft_id,configured.holes.revision]),'22023');
      await fails(()=>rpc(db,'admin_catalog_save_draft',[draft.draft_id,{...courseFields(),holes_count:18},draft.revision]),'22023');
      const ctx=(await state(db)).admin_existing_club_course_contexts[0];
      await fails(()=>rpc(db,'admin_catalog_save_draft',[ctx.draft_id,{club_id:player},1]),'42501');
      assert.deepEqual((await state(db)).clubs,original.clubs);
    });
    await t.test('save/abandon/reopen remain private; name/category collisions and incomplete ratings block',async()=>{
      let extra=await create(db,club,courseFields('Privato da abbandonare',18));
      extra=await rpc(db,'admin_existing_club_course_save',[club.id,courseFields('Rinominato',18),extra.draft_id,extra.revision]);
      await fails(()=>rpc(db,'admin_existing_club_course_save',[club.id,courseFields('Perso',18),extra.draft_id,1]),'40001');
      await rpc(db,'admin_existing_club_course_archive',[club.id,extra.draft_id,extra.revision]);
      assert.equal((await rpc(db,'admin_existing_club_courses',[club.id])).courses.length,1);
      const duplicate=await create(db,club,courseFields(' PERCORSO STORICO '));assert.equal((await preview(db,duplicate)).checklist.unique_name,false);
      const partial=await create(db,club,courseFields('Rating incompleti'));await configure(db,partial,teeFields({course_rating:null,slope_rating:null}));
      assert.equal((await preview(db,partial)).can_publish,false);
      await rpc(db,'admin_new_course_tee_save',[draft.draft_id,teeFields({rating_category:'women'}),draft.revision,configured.holes.draft_id,configured.holes.revision]);
      assert.ok((await preview(db,draft)).blockers.some(b=>b.includes('nomi tee')));
      const tees=(await rpc(db,'admin_new_course_tees',[draft.draft_id])).tees;
      await rpc(db,'admin_new_course_tee_archive',[draft.draft_id,tees.find(t=>t.snapshot.rating_category==='women').draft_id,1]);plan=await preview(db,draft);
    });
    await t.test('expected revision/hash and changed descendants/Club/duplicate races are checked at confirmation',async()=>{
      await fails(()=>publish(db,draft,plan,' '),'22023');await fails(()=>publish(db,{...draft,revision:99},plan),'40001');
      const stale=plan;configured.tee=await rpc(db,'admin_new_course_tee_save',[draft.draft_id,teeFields({course_rating:37}),draft.revision,configured.holes.draft_id,configured.holes.revision,configured.tee.draft_id,configured.tee.revision]);
      await fails(()=>publish(db,draft,stale),'40001');plan=await preview(db,draft);
      await db.exec('reset role');await db.query('update public.clubs set city=$1 where id=$2',['Nuova località',club.id]);await role(db);
      await fails(()=>publish(db,draft,plan),'40001');plan=await preview(db,draft);
      await db.exec('reset role');await db.query('update public.clubs set city=$1,updated_at=$2 where id=$3',[original.clubs[0].city,original.clubs[0].updated_at,club.id]);await role(db);plan=await preview(db,draft);
      await db.exec('reset role');const raced=(await db.query("insert into public.course_routes(club_id,name,holes_count) values($1,'Nuovo nove',9) returning id",[club.id])).rows[0];await role(db);
      const before=await state(db);await fails(()=>publish(db,draft,plan),'22023');assert.deepEqual(await state(db),before);
      // Remove only this isolated race fixture, never a real catalog row.
      await db.exec('reset role');await db.query('delete from public.course_routes where id=$1',[raced.id]);await role(db);plan=await preview(db,draft);
    });
    await t.test('late tee/version/receipt/closure failures roll back every live and history write',async()=>{
      await db.exec("reset role;create function public.fixture_fail() returns trigger language plpgsql as $$begin raise exception 'fixture failure' using errcode='23514';end;$$;");
      for(const table of ['route_tees','admin_catalog_versions','admin_existing_club_course_publications']){
        await db.exec(`create trigger fixture_failure before insert on public.${table} for each row execute function public.fixture_fail()`);await role(db);
        const before=await state(db);await fails(()=>publish(db,draft,plan),'23514');assert.deepEqual(await state(db),before);
        await db.exec(`reset role;drop trigger fixture_failure on public.${table}`);
      }
      await db.exec("create function public.fixture_close_fail() returns trigger language plpgsql as $$begin if new.workflow_status='published' then raise exception 'close failure' using errcode='23514';end if;return new;end;$$;create trigger z_fixture_close before update on public.admin_catalog_drafts for each row execute function public.fixture_close_fail();");
      await role(db);const before=await state(db);await fails(()=>publish(db,draft,plan),'23514');assert.deepEqual(await state(db),before);
      await db.exec('reset role;drop trigger z_fixture_close on public.admin_catalog_drafts');await role(db);
    });
    await t.test('publication creates only this course/holes/tees, closes draft, retains immutable version/audit and other pending drafts',async()=>{
      const before=await state(db);const result=await publish(db,draft,plan);assert.equal(result.course.club_id,club.id);assert.equal(result.course.route_holes.length,9);
      assert.equal(result.course.total_par,36);assert.equal(result.course.route_tees[0].par_total,36);assert.equal(result.course.route_tees[0].holes_count,9);
      const after=await state(db);assert.deepEqual(after.clubs,before.clubs);
      for(const table of tables.slice(0,10))assert.deepEqual(after[table].filter(row=>before[table].some(old=>old.id===row.id)),before[table]);
      assert.equal(after.admin_catalog_drafts.find(row=>row.draft_id===draft.draft_id).workflow_status,'published');
      for(const row of [configured.holes,configured.tee])assert.equal(after.admin_catalog_drafts.find(d=>d.draft_id===row.draft_id).workflow_status,'archived');
      assert.equal(after.admin_existing_club_course_publications.length,1);assert.equal(after.admin_catalog_versions.length,1);
      for(const row of before.admin_catalog_drafts.filter(d=>![draft.draft_id,configured.holes.draft_id,configured.tee.draft_id].includes(d.draft_id)))
        assert.deepEqual(after.admin_catalog_drafts.find(d=>d.draft_id===row.draft_id),row);
      await fails(()=>publish(db,draft,plan),'40001');assert.deepEqual(await state(db),after);
      await db.exec('reset role');for(const table of ['admin_catalog_versions','admin_existing_club_course_publications']){
        await fails(()=>db.exec(`update public.${table} set ${table==='admin_catalog_versions'?'snapshot':'created_records'}='{}'`),'55000');
        await fails(()=>db.exec(`delete from public.${table}`),'55000');await fails(()=>db.exec(`truncate public.${table} cascade`),'55000');
      }await role(db);
    });
    await t.test('18-hole path derives 72 Par; inactive Club blocks; legacy New Club flow remains usable; migration one-shot',async()=>{
      const eighteen=await create(db,club,courseFields('Nuovo diciotto',18));await configure(db,eighteen);const p=await preview(db,eighteen);
      assert.equal(p.course.total_par,72);assert.equal((await publish(db,eighteen,p)).course.route_tees[0].holes_count,18);
      await db.exec('reset role');await db.query('update public.clubs set is_active=false where id=$1',[club.id]);await role(db);
      await fails(()=>rpc(db,'admin_existing_club_courses',[club.id]),'22023');await fails(()=>create(db,club),'22023');
      const root=await rpc(db,'admin_catalog_create_draft',['club',{name:'Nuovo Club separato',city:null}]);
      const child=await rpc(db,'admin_new_club_course_save',[root.draft_id,courseFields('Legacy privato')]);await configure(db,child);
      const legacyPlan=await rpc(db,'admin_new_club_preview',[root.draft_id]);assert.equal(legacyPlan.can_publish,true);
      await fails(()=>preview(db,child),'42501');
      const legacyPublication=await rpc(db,'admin_new_club_publish',[root.draft_id,root.revision,legacyPlan.confirmation_hash,'Compatibility fixture']);
      assert.equal(legacyPublication.club.course_routes[0].route_holes.length,9);
      await db.exec('reset role');const migration=await sql('admin-existing-club-new-courses');await fails(()=>db.exec(migration),'42P07');await db.exec('rollback');
    });
  } finally {await db.close();}
});
