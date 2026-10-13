// Real schema/migrations on isolated PostgreSQL. No remote queries or writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite }=await import(process.env.STABLR_PGLITE_MODULE||'@electric-sql/pglite');
const sql=async name=>(await readFile(new URL(`../../supabase/${name}.sql`,import.meta.url),'utf8')).replaceAll('create extension if not exists pgcrypto;','');
const admin='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',player='33333333-3333-4333-8333-333333333333';
const fig='55555555-5555-4555-8555-555555555555';
const grid=count=>({holes_count:count,holes:Array.from({length:count},(_,i)=>({physical_hole_number:i+1,par:i===0?3:4,stroke_index:count-i}))});
const teeFields=(name='Giallo',updates={})=>({name,tee_color:'giallo',rating_category:'men',course_rating:70.2,slope_rating:120,is_active:true,display_order:0,...updates});
test('atomic new Club publication: actual schema, permissions, preview, snapshot conflicts and rollback',async t=>{
  const db=new PGlite();let root,course,holes,tee,plan;
  const role=async(name,uid='')=>{await db.exec(`reset role;set role ${name}`);await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,name]);};
  const fails=(fn,code)=>assert.rejects(fn,error=>error.code===code);
  const preview=async d=>(await db.query('select public.admin_new_club_preview($1) result',[(d||root).draft_id])).rows[0].result;
  const publish=async(d=root,p=plan,note='Conferma Admin motivata')=>(await db.query('select public.admin_new_club_publish($1,$2,$3,$4) result',[d.draft_id,d.revision,p.confirmation_hash,note])).rows[0].result;
  const newRoot=async(name,source=null)=>(await db.query("select * from public.admin_catalog_create_draft('club',$1::jsonb)",[JSON.stringify({name,city:'Roma',...(source?{fig_source:source,fig_code:source.source_external_id}:{})})])).rows[0];
  const newCourse=async(d,count)=>(await db.query('select * from public.admin_new_club_course_save($1,$2::jsonb)',[d.draft_id,JSON.stringify({name:`Percorso ${count}`,holes_count:count,display_order:count})])).rows[0];
  const configure=async(c,fields=teeFields())=>{
    const opened=(await db.query('select public.admin_new_course_holes_open($1) result',[c.draft_id])).rows[0].result;
    const g=(await db.query('select * from public.admin_new_course_holes_save($1,$2::jsonb,$3,$4)',[opened.draft.draft_id,JSON.stringify(grid(c.snapshot.holes_count)),opened.draft.revision,c.revision])).rows[0];
    const saved=(await db.query('select * from public.admin_new_course_tee_save($1,$2::jsonb,$3,$4,$5)',[c.draft_id,JSON.stringify(fields),c.revision,g.draft_id,g.revision])).rows[0];
    return {grid:g,tee:saved};
  };
  const tables=['clubs','course_routes','route_holes','route_tees','route_combinations','route_combination_holes','combination_tees','rounds','round_holes','admin_catalog_drafts','admin_catalog_versions','admin_new_club_publications'];
  const state=async()=>{await db.exec('reset role');const result={};for(const table of tables)result[table]=(await db.query(`select * from public.${table} order by ${table==='admin_catalog_drafts'?'draft_id':table==='admin_catalog_versions'?'version_id':table==='admin_new_club_publications'?'publication_id':'id'}`)).rows;await role('authenticated',admin);return result;};
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
      create table public.profiles(id uuid primary key references auth.users,player_name text,hcp numeric,role text not null default 'user',created_at timestamptz default now(),updated_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'');$$;
      grant usage on schema auth to anon,authenticated,service_role;
      insert into auth.users values('${admin}'),('${other}'),('${player}');`);
    for(const name of ['shared-catalog-schema','fig-whs-extension','fig-catalog-schema','fig-club-matching'])await db.exec(await sql(name));
    await db.exec(`insert into public.profiles(id,role) values('${admin}','admin'),('${other}','admin'),('${player}','user');
      insert into public.fig_clubs(id,name,name_normalized,source_system,source_external_id) values('${fig}','Fonte FIG','fonte fig','fig','fig-fixture');
      insert into public.clubs(name,name_normalized,created_by) values('Esistente','esistente','${admin}');`);
    for(const name of ['admin-catalog-workflow','admin-club-editor','admin-course-editor','admin-catalog-abandon-draft','admin-course-tee-editor','admin-new-club-courses','admin-new-club-course-holes','admin-new-club-course-tees'])await db.exec(await sql(name));
    const migration=await sql('admin-new-club-publish');await db.exec(migration);await role('authenticated',admin);
    const existing=(await state()).clubs[0];
    await db.exec('reset role');
    const oldRoute=(await db.query("insert into public.course_routes(club_id,name,holes_count,total_par,is_active) values($1,'Percorso storico',9,36,true) returning id",[existing.id])).rows[0].id;
    await db.query('insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) values($1,1,4,1)',[oldRoute]);
    await db.query("insert into public.route_tees(route_id,tee_name,holes_count,course_rating,slope_rating,par_total,source_payload) values($1,'Storico',9,35,120,36,$2::jsonb)",[oldRoute,JSON.stringify({distances:[120],historical:true})]);
    const oldRound=(await db.query("insert into public.rounds(user_id,club_id,holes_count,total_par,round_type,selected_routes) values($1,$2,9,36,'single_9',$3::jsonb) returning id",[player,existing.id,JSON.stringify([{route_id:oldRoute,par:36}])])).rows[0].id;
    await db.query('insert into public.round_holes(round_id,user_id,club_id,route_id,round_hole_number,route_position,physical_hole_number,par,stroke_index) values($1,$2,$3,$4,1,1,1,4,1)',[oldRound,player,existing.id,oldRoute]);
    const existingState=await state();
    await t.test('preview is read-only, missing prerequisites visible, no generated grids/live',async()=>{
      root=await newRoot('');const before=await state();await db.exec('begin read only');plan=await preview();await db.exec('commit');
      assert.equal(plan.can_publish,false);assert.equal(plan.checklist.club_name,false);assert.equal(plan.checklist.courses,false);assert.deepEqual(await state(),before);
      await fails(()=>publish(),'22023');const duplicate=await newRoot('  ESISTENTE  ');assert.equal((await preview(duplicate)).checklist.unique_name,false);
      root=await newRoot('Nuovo curato');course=await newCourse(root,9);plan=await preview();assert.equal(plan.checklist.holes,false);assert.equal(plan.checklist.tees,false);
      ({grid:holes,tee}=await configure(course));plan=await preview();assert.equal(plan.can_publish,true);assert.deepEqual(plan.counts,{courses:1,holes:9,tees:1});assert.equal(plan.courses[0].total_par,35);
      assert.equal(plan.courses[0].tees[0].par_total,35);assert.equal(plan.courses[0].tees[0].holes_count,9);
    });
    await t.test('Admin owner only; no API DML or service bypass; note/hash required',async()=>{
      const before=await state();for(const [name,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',''],['service_role',admin],['authenticated',other]]){
        await role(name,uid);await fails(()=>preview(),'42501');await fails(()=>publish(),'42501');
      }
      await role('authenticated',admin);await fails(()=>publish(root,plan,' '),'22023');await fails(()=>publish(root,{...plan,confirmation_hash:'0'.repeat(64)}),'40001');
      await fails(()=>publish({...root,revision:99}),'40001');assert.deepEqual(await state(),before);
      await db.exec('reset role');for(const name of ['anon','authenticated','service_role'])for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[name,'public.admin_new_club_publications',privilege])).rows[0].allowed,false);await role('authenticated',admin);
    });
    await t.test('changed descendants/additions and exact FIG identity races invalidate confirmation',async()=>{
      const stale=plan;tee=(await db.query('select * from public.admin_new_course_tee_save($1,$2::jsonb,$3,$4,$5,$6,$7)',[course.draft_id,JSON.stringify({...tee.snapshot,course_rating:71}),course.revision,holes.draft_id,holes.revision,tee.draft_id,tee.revision])).rows[0];
      const before=await state();await fails(()=>publish(root,stale),'40001');assert.deepEqual(await state(),before);plan=await preview();
      const extra=await newCourse(root,18);await fails(()=>publish(),'40001');await db.query('select public.admin_new_club_course_archive($1,$2,$3)',[root.draft_id,extra.draft_id,extra.revision]);plan=await preview();
    });
    await t.test('late insert/audit/closure failures roll back all catalog and history writes',async()=>{
      await db.exec('reset role');await db.exec("create function public.test_fail_insert() returns trigger language plpgsql as $$begin raise exception 'fixture failure' using errcode='23514';end;$$;");
      for(const table of ['route_tees','admin_new_club_publications']){
        await db.exec(`create trigger fail_publication before insert on public.${table} for each row execute function public.test_fail_insert()`);await role('authenticated',admin);
        const before=await state();await fails(()=>publish(),'23514');assert.deepEqual(await state(),before);await db.exec(`reset role;drop trigger fail_publication on public.${table}`);
      }
      await db.exec("create function public.test_fail_close() returns trigger language plpgsql as $$begin if new.workflow_status='published' then raise exception 'fixture closure failure' using errcode='23514';end if;return new;end;$$;create trigger z_fail_close before update on public.admin_catalog_drafts for each row execute function public.test_fail_close();");
      await role('authenticated',admin);const before=await state();await fails(()=>publish(),'23514');assert.deepEqual(await state(),before);await db.exec('reset role;drop trigger z_fail_close on public.admin_catalog_drafts');await role('authenticated',admin);
    });
    await t.test('real live constraints, category collision and incomplete active tee block before writes',async()=>{
      const partial=await newRoot('Tee incompleto'),c=await newCourse(partial,18);await configure(c,teeFields('Bianco',{course_rating:null,slope_rating:null}));assert.equal((await preview(partial)).can_publish,false);
      const collision=await newRoot('Categoria collisione'),cc=await newCourse(collision,9),data=await configure(cc);
      await db.query('select public.admin_new_course_tee_save($1,$2::jsonb,$3,$4,$5)',[cc.draft_id,JSON.stringify(teeFields('Giallo',{rating_category:'women'})),cc.revision,data.grid.draft_id,data.grid.revision]);
      const bad=await preview(collision);assert.equal(bad.can_publish,false);assert.ok(bad.courses[0].blockers.some(value=>value.includes('categorie')));
      const before=await state();await fails(()=>publish(collision,bad),'22023');assert.deepEqual(await state(),before);
      await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3)',[data.grid.draft_id,JSON.stringify({...grid(9),total_par:1}),data.grid.revision]),'22023');
      const missing=grid(9);missing.holes[0].par=null;
      holes=(await db.query('select * from public.admin_new_course_holes_save($1,$2::jsonb,$3,$4)',[holes.draft_id,JSON.stringify(missing),holes.revision,course.revision])).rows[0];
      assert.equal((await preview()).can_publish,false);const duplicateSi=grid(9);duplicateSi.holes[1].stroke_index=9;
      holes=(await db.query('select * from public.admin_new_course_holes_save($1,$2::jsonb,$3,$4)',[holes.draft_id,JSON.stringify(duplicateSi),holes.revision,course.revision])).rows[0];
      assert.equal((await preview()).can_publish,false);
      holes=(await db.query('select * from public.admin_new_course_holes_save($1,$2::jsonb,$3,$4)',[holes.draft_id,JSON.stringify(grid(9)),holes.revision,course.revision])).rows[0];
    });
    await t.test('complete manual tree publishes once with derived totals, immutable version/receipt and closed private drafts',async()=>{
      const second=await newCourse(root,18);await configure(second,teeFields('Bianco'));
      plan=await preview();assert.deepEqual(plan.counts,{courses:2,holes:27,tees:2});const result=await publish();assert.equal(result.club.playable,true);assert.equal(result.club.course_routes[0].total_par,35);
      assert.equal(result.club.course_routes[1].total_par,71);
      assert.equal(result.club.course_routes[0].route_tees[0].par_total,35);assert.equal(result.club.course_routes[0].route_tees[0].holes_count,9);
      const after=await state();assert.deepEqual(after.clubs.find(row=>row.id===existing.id),existing);
      for(const table of tables.slice(0,9))assert.deepEqual(after[table].filter(row=>existingState[table].some(old=>old.id===row.id)),existingState[table]);
      assert.equal(after.admin_catalog_drafts.find(row=>row.draft_id===root.draft_id).workflow_status,'published');
      for(const id of [course.draft_id,holes.draft_id,tee.draft_id]){const row=after.admin_catalog_drafts.find(row=>row.draft_id===id);assert.equal(row.workflow_status,'archived');assert.equal(row.live_entity_id,null);}
      assert.equal(after.admin_catalog_versions.length,1);assert.equal(after.admin_new_club_publications.length,1);
      assert.equal(after.rounds.length,1);assert.equal(after.round_holes.length,1);assert.equal(after.route_combinations.length,0);
      await fails(()=>publish(),'40001');assert.deepEqual(await state(),after);
      await db.exec('reset role');for(const table of ['admin_catalog_versions','admin_new_club_publications']){
        await fails(()=>db.exec(`update public.${table} set ${table==='admin_catalog_versions'?'snapshot':'created_records'}='{}'::jsonb`),'55000');
        await fails(()=>db.exec(`delete from public.${table}`),'55000');await fails(()=>db.exec(`truncate public.${table} cascade`),'55000');
      }
      await role('authenticated',admin);await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3)',[root.draft_id,JSON.stringify(root.snapshot),root.revision+1]),'40001');
    });
    await t.test('FIG provenance preserved without definitive matching; name and FIG rechecks reject new duplicates',async()=>{
      const source={id:fig,name:'Fonte FIG',city:null,source_system:'fig',source_external_id:'fig-fixture'};
      const d=await newRoot('Nuovo da FIG',source),c=await newCourse(d,18);await configure(c);const p=await preview(d);
      const result=await publish(d,p);assert.equal(result.club.course_routes[0].total_par,71);const data=await state();const live=data.clubs.find(row=>row.id===result.club.id);
      assert.equal(live.fig_club_id,null);assert.equal(live.fig_match_status,'unmatched');assert.deepEqual(live.source_payload.new_club_provenance.fig_source,source);
      const otherDraft=await newRoot('Altro nome FIG',source);assert.equal((await preview(otherDraft)).can_publish,false);
      const duplicate=await newRoot('nuovo CURATO');assert.equal((await preview(duplicate)).checklist.unique_name,false);
      const mutable=await newRoot('Cambiamento catalogo'),mc=await newCourse(mutable,9);await configure(mc);const previous=await preview(mutable);
      await db.exec('reset role');await db.query('insert into public.clubs(name,name_normalized,created_by) values($1,$2,$3)',['Cambiamento catalogo','cambiamento catalogo',admin]);await role('authenticated',admin);
      const before=await state();await fails(()=>publish(mutable,previous),'22023');assert.deepEqual(await state(),before);
      await db.exec('reset role');await fails(()=>db.exec(migration),'42P07');await db.exec('rollback');
    });
  } finally {await db.close();}
});
