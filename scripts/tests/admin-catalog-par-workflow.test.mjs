// Isolated PostgreSQL only. No remote publication, credentials or network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
const { PGlite }=await import(process.env.STABLR_PGLITE_MODULE||'@electric-sql/pglite');
const read=name=>readFile(new URL('../../supabase/'+name,import.meta.url),'utf8');
const schema=await read('shared-catalog-schema.sql'),extension=await read('fig-whs-extension.sql'),migration=await read('admin-catalog-physical-par.sql'),repair=await read('admin-catalog-physical-par-source-drafts.sql');
const prerequisites=await Promise.all(['admin-catalog-workflow.sql','admin-club-editor.sql','admin-course-editor.sql','admin-catalog-abandon-draft.sql','admin-route-editor.sql','admin-hole-grid-editor.sql','admin-course-hole-grid-editor.sql','admin-course-tee-editor.sql','admin-catalog-physical-foundation.sql','admin-catalog-physical-course-links.sql','admin-catalog-playable-configurations.sql','admin-catalog-physical-18-configurations.sql','admin-catalog-structure-club-lock.sql','admin-catalog-multi9.sql','admin-catalog-multi9-club-proposals.sql','admin-catalog-multi9-preview-repair.sql','admin-catalog-data-origin.sql','admin-catalog-tee-classifications.sql'].map(read));
const parco=JSON.parse(await readFile(new URL('./fixtures/parco-de-medici-multi9-preview.json',import.meta.url),'utf8'));
const admin='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',player='33333333-3333-4333-8333-333333333333';
test('Par workflow: isolated approvals, local publication and explicit override',async t=>{
  const db=new PGlite();
  const role=async(name='authenticated',uid=admin,claim=name)=>{await db.exec('reset role;set role '+name);await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,claim]);};
  let outerTransaction=false;
  const query=async(sql,args=[])=>{if(outerTransaction)await db.exec('savepoint test_operation');try{const r=await db.query(sql,args);if(outerTransaction)await db.exec('release savepoint test_operation');return r;}catch(e){if(outerTransaction)await db.exec('rollback to savepoint test_operation;release savepoint test_operation');throw e;}};
  const rpc=async(name,args=[]) => (await query('select to_jsonb(public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')) result',args)).rows[0].result;
  const par=(name,args=[])=>rpc('admin_catalog_par_'+name,args);
  const failure=(fn,code)=>assert.rejects(fn,e=>e.code===code);
  const rollback=async fn=>{await db.exec('begin');outerTransaction=true;try{await fn();}finally{outerTransaction=false;await db.exec('rollback');await role();}};
  const dump=async()=>{await db.exec('reset role');const out={};for(const {tablename} of (await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows)out[tablename]=(await db.query('select to_jsonb(t) j from public.'+tablename+' t order by to_jsonb(t)::text')).rows;await role();return out;};
  const ownerQuery=async(sql,args=[])=>{await db.exec('reset role');try{return await query(sql,args);}finally{await role();}};
  const createCourse=async(club,name,pars,si)=>{
    const c=(await ownerQuery("insert into public.course_routes(club_id,name,holes_count,total_par,source_system) values($1,$2,$3,$4,'stablr') returning *",[club.id,name,pars.length,pars.reduce((a,b)=>a+b,0)])).rows[0];
    for(let i=0;i<pars.length;i++)await ownerQuery('insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) values($1,$2,$3,$4)',[c.id,i+1,pars[i],si[i]]);
    return c;
  };
  const structure=async(club,course,classification)=>{
    let s=await rpc('admin_catalog_foundation_create_structure',[club.id,club.name,'stablr','Fixture exact source','Manual fixture']);
    s=await rpc('admin_catalog_foundation_review_structure',[s.id,s.revision,classification,'stablr','Fixture exact source','Manual fixture',true]);
    let p=await rpc('admin_catalog_physical_course_preview',[s.id,course.id]);
    p=await rpc('admin_catalog_physical_course_register',[s.id,course.id,s.revision,p.source,'Explicit fixture',true]);
    p=await rpc('admin_catalog_physical_course_verify',[p.link.id,p.link.revision,p.mapping,'Manual verified fixture',true]);return {s,p};
  };
  const register9=async(f,kind)=>{let p=await rpc('admin_catalog_playable_preview',[f.s.id,f.p.link.id,kind]);p=await rpc('admin_catalog_playable_register',[f.s.id,f.p.link.id,kind,p.baseline,'Fixture explicit choice',true]);return rpc('admin_catalog_playable_verify',[p.configuration.id,p.configuration.revision,p.baseline,p.saved_holes,'Fixture verified',true]);};
  let mare,course,hole,tee9,tee18,nine,eighteen;
  try{
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key references auth.users,role text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;grant usage on schema auth to anon,authenticated,service_role;create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;");
    await db.query('insert into auth.users values($1),($2),($3)',[admin,other,player]);await db.query("insert into public.profiles values($1,'admin'),($2,'admin'),($3,'user')",[admin,other,player]);
    for(const name of ['clubs','course_routes','route_holes','route_combinations','route_combination_holes','rounds','round_holes'])await db.exec(schema.match(new RegExp('create table public\\.'+name+' \\([\\s\\S]*?\\n\\);'))[0]);
    for(const name of ['route_tees','combination_tees'])await db.exec(extension.match(new RegExp('create table if not exists public\\.'+name+' \\([\\s\\S]*?\\n\\);'))[0]);
    for(const name of ['clubs','course_routes','route_combinations'])await db.exec('alter table public.'+name+' add column source_system text,add column source_external_id text,add column source_payload jsonb');
    for(const sql of prerequisites)await db.exec(sql);await role();
    mare=(await ownerQuery("insert into public.clubs(name,name_normalized,created_by) values('Mare di Roma','mare',$1) returning *",[admin])).rows[0];
    course=await createCourse(mare,'Percorso',[4,4,4,4,4,4,3,4,4],[11,17,1,7,9,5,3,13,15]);
    tee9=(await ownerQuery("insert into public.route_tees(route_id,tee_name,holes_count,par_total,course_rating,slope_rating) values($1,'Giallo',9,35,34.8,125) returning *",[course.id])).rows[0];
    tee18=(await ownerQuery("insert into public.route_tees(route_id,tee_name,holes_count,par_total,course_rating,slope_rating) values($1,'Giallo',18,70,69.6,125) returning *",[course.id])).rows[0];
    const f=await structure(mare,course,'fisico_9');nine=(await register9(f,'autonomous_9')).configuration;eighteen=(await register9(f,'repeated_18')).configuration;
    hole=(await rpc('admin_catalog_data_origin',[mare.id])).physical_holes.find(h=>h.physical_number===1);

    await db.exec('reset role'); await db.exec(migration); await db.exec(repair);
    const next=await read('admin-catalog-par-workflow.sql'),before=await dump();
    await db.exec('reset role'); await db.exec(next);await role();
    const after=await dump();for(const [name,rows] of Object.entries(before))assert.deepEqual(after[name],rows,name);
    await t.test('incremental migration is one-shot and fails without partially changing existing records',async()=>{
      await db.exec('reset role');await failure(()=>db.exec(next),'42P07');await db.exec('rollback');assert.deepEqual(await dump(),after);
    });
    const local=(name,args=[])=>rpc('admin_catalog_local_par_'+name,args);
    const preview=()=>rpc('admin_catalog_par_workflow_preview');
    const confirm=(p,n='Explicit full catalog approval')=>rpc('admin_catalog_par_workflow_confirm',[p,n,true]);
    let autonomous,autonomousClub;
    await t.test('preview is read-only and covers physical and independent autonomous configurations',async()=>{
      autonomousClub=(await ownerQuery("insert into public.clubs(name,name_normalized,created_by) values('Local fixture','local',$1) returning *",[admin])).rows[0];
      autonomous=await createCourse(autonomousClub,'Independent nine',[4,4,4,4,4,4,3,4,4],[1,2,3,4,5,6,7,8,9]);
      const b=await dump(),p=await preview();assert.deepEqual(await dump(),b);assert.equal(p.target_count,2);
      assert.ok(p.clubs.every(c=>c.targets.every(x=>!('holes' in x))));
      assert.equal(p.clubs.find(c=>c.club_id===mare.id).targets[0].mode,'physical');
      assert.equal(p.clubs.find(c=>c.club_id===autonomousClub.id).targets[0].mode,'local');
      assert.equal(p.tee_count,2);assert.ok(!JSON.stringify(p).includes('source_payload'));
      await db.exec('begin read only');await preview();await db.exec('rollback');
    });
    await t.test('anon/player/service/missing identity cannot invoke RPCs or mutate tables',async()=>{
      for(const [r,u,c] of [['anon','','anon'],['authenticated',player,'authenticated'],['service_role',admin,'service_role'],['authenticated','','authenticated'],['authenticated',admin,'service_role']]){
        await role(r,u,c);await failure(preview,'42501');await failure(()=>local('list',[mare.id]),'42501');
        await failure(()=>query('select * from public.admin_catalog_par_targets'),'42501');
        await failure(()=>rpc('admin_catalog_par_workflow_confirm',[{},'Denied',true]),'42501');
        await failure(()=>local('open',['course',course.id,randomUUID()]),'42501');
        await failure(()=>local('save',[randomUUID(),1,4,false]),'42501');
        await failure(()=>local('publish',[randomUUID(),1,'0'.repeat(64),'Denied',true]),'42501');
        await failure(()=>rpc('admin_catalog_par_target',['course',course.id]),'42501');
      }await role();
    });
    await t.test('one approval enables targets and tees; exact retry has one immutable receipt',async()=>{
      const p=await preview(),b=await dump(),receipt=await confirm(p);
      assert.equal(receipt.confirmed.length,2);assert.equal(receipt.excluded.length,0);
      assert.deepEqual(await confirm(p),receipt);const a=await dump();
      for(const table of ['course_routes','route_holes','route_combinations','route_combination_holes','route_tees','combination_tees','admin_catalog_playable_configurations','admin_catalog_physical_holes','rounds','round_holes','admin_catalog_drafts','admin_catalog_versions'])assert.deepEqual(a[table],b[table],table);
      assert.equal(a.admin_catalog_par_workflow_batches.length,1);
      await role('authenticated',other);await failure(()=>confirm(p),'40001');await role();
      await failure(()=>query("update public.admin_catalog_par_workflow_batches set note='rewrite'"),'42501');
      await failure(()=>ownerQuery("update public.admin_catalog_par_workflow_batches set note='rewrite'"),'55000');
      await failure(()=>ownerQuery('delete from public.admin_catalog_par_targets'),'55000');
    });
    await t.test('9x2 rejects local override; physical publication still updates 9 and repeated18',async()=>{
      const physicalRow=(await ownerQuery('select id from public.route_holes where route_id=$1 order by physical_hole_number',[course.id])).rows[0].id;
      await failure(()=>local('open',['course',course.id,physicalRow]),'23514');
      await rollback(async()=>{let d=await par('open',[hole.id]);d=await par('save',[d.draft.id,d.draft.revision,5]);assert.equal(d.can_publish,true,JSON.stringify(d.blockers));await par('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Physical fixture',true]);const tees=(await ownerQuery('select holes_count,par_total from public.route_tees where route_id=$1 order by holes_count',[course.id])).rows;assert.deepEqual(tees,[{holes_count:9,par_total:36},{holes_count:18,par_total:72}]);});
    });
    await t.test('Mare real-shaped 5 to 4: 35 to 34, repeated18 70 to 68 and eight tees, unchanged SI/rating',async()=>{
      await rollback(async()=>{
        const club=(await ownerQuery("insert into public.clubs(name,name_normalized,created_by) values('Mare regression','mare-regression',$1) returning *",[admin])).rows[0];
        const c=await createCourse(club,'Percorso',[5,3,4,3,4,5,4,4,3],[11,17,1,7,9,5,3,13,15]);
        for(const scope of [9,18])for(const name of ['Giallo','Rosso','Verde','Arancio'])await ownerQuery("insert into public.route_tees(route_id,tee_name,holes_count,par_total,course_rating,slope_rating) values($1,$2,$3,$4,34.8,125)",[c.id,name,scope,scope===9?35:70]);
        const f=await structure(club,c,'fisico_9');await register9(f,'autonomous_9');await register9(f,'repeated_18');
        const proposal=await preview();assert.equal(proposal.clubs.find(x=>x.club_id===club.id).tee_proposal.tee_count,8);await confirm(proposal,'Mare exact regression approval');
        const ph=(await par('list',[club.id])).holes.find(x=>x.number===1);
        let d=await par('open',[ph.id]);d=await par('save',[d.draft.id,d.draft.revision,4]);
        assert.equal(d.can_publish,true,JSON.stringify(d.blockers));assert.equal(d.tees.length,8);
        assert.deepEqual(d.configurations.map(x=>[x.before_total,x.after_total]).sort((a,b)=>a[0]-b[0]),[[35,34],[70,68]]);
        const before=await dump();await par('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Mare regression publication',true]);const after=await dump();
        for(const x of after.route_holes)assert.equal(x.j.stroke_index,before.route_holes.find(y=>y.j.id===x.j.id).j.stroke_index);
        for(const x of after.route_tees){const old=before.route_tees.find(y=>y.j.id===x.j.id).j;assert.equal(x.j.course_rating,old.course_rating);assert.equal(x.j.slope_rating,old.slope_rating);if(x.j.route_id===c.id)assert.equal(x.j.par_total,x.j.holes_count===9?34:68);}
        assert.deepEqual(after.rounds,before.rounds);assert.deepEqual(after.round_holes,before.round_holes);
      });
    });
    await t.test('independent local draft/publication updates exactly hole and total, with compensating publication',async()=>{
      const h=(await local('list',[autonomousClub.id])).targets[0].holes[0];const b=await dump();
      let d=await local('open',['course',autonomous.id,h.id]);d=await local('save',[d.draft.id,d.draft.revision,5,false]);
      assert.equal(d.can_publish,true,JSON.stringify(d.blockers));assert.equal(d.after_total,36);
      const mid=await dump();assert.deepEqual(mid.route_holes,b.route_holes);assert.deepEqual(mid.course_routes,b.course_routes);
      await failure(()=>local('publish',[d.draft.id,d.draft.revision,'0'.repeat(64),'Mismatch',true]),'40001');
      const receipt=await local('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Local fixture publication',true]);assert.equal(receipt.total,36);
      const a=await dump();for(const table of ['route_tees','combination_tees','admin_catalog_physical_holes','admin_catalog_configuration_holes','rounds','round_holes','admin_catalog_drafts','admin_catalog_versions'])assert.deepEqual(a[table],b[table],table);
      assert.equal(a.admin_catalog_local_par_drafts[0].j.status,'published');
      assert.equal(a.route_holes.find(x=>x.j.id===h.id).j.stroke_index,1);
      await failure(()=>local('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Replay',true]),'40001');
      d=await local('open',['course',autonomous.id,h.id]);d=await local('save',[d.draft.id,d.draft.revision,4,false]);await local('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Compensating publication',true]);
      assert.equal((await dump()).admin_catalog_local_par_versions.length,2);
    });
    await t.test('unchanged catalog draft is harmless; real overlapping draft blocks; no rebase/archive',async()=>{
      await rollback(async()=>{let grid=await rpc('admin_course_hole_grid_open_draft',[autonomous.id]);const h=grid.draft.snapshot.holes[0];let d=await local('open',['course',autonomous.id,h.id]);d=await local('save',[d.draft.id,d.draft.revision,5,false]);assert.equal(d.can_publish,true);
        grid.draft=await rpc('admin_course_hole_grid_save_draft',[grid.draft.draft_id,{holes:grid.draft.snapshot.holes.map(x=>x.id===h.id?{...x,par:6}:x)},grid.draft.revision]);
        const b=await dump();await failure(()=>local('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Overlap denied',true]),'40001');assert.deepEqual(await dump(),b);
        await failure(()=>rpc('admin_course_hole_grid_publish_draft',[grid.draft.draft_id,grid.draft.revision]),'23514');
      });
    });
    await t.test('Fiuggi: explicit independent override updates live and derived tee, then excludes parent propagation',async()=>{
      await rollback(async()=>{
        const club=(await ownerQuery("insert into public.clubs(name,name_normalized,created_by) values('Fiuggi isolated','fiuggiisolated',$1) returning *",[admin])).rows[0];
        const pars=[5,4,3,4,3,4,4,5,3,5,3,4,3,4,5,3,4,4],si=[9,17,15,3,13,1,5,11,7,12,2,18,4,8,6,16,14,10];
        const courses=[await createCourse(club,'18',pars,si),await createCourse(club,'Front',pars.slice(0,9),si.slice(0,9)),await createCourse(club,'Back',pars.slice(9),si.slice(9))];
        for(const c of courses)await ownerQuery("insert into public.route_tees(route_id,tee_name,holes_count,par_total,course_rating,slope_rating) values($1,'Fixture',$2,$3,70,125)",[c.id,c.holes_count,c.total_par]);
        const f=await structure(club,courses[0],'fisico_18');
        for(const [i,kind] of ['autonomous_18','front_9','back_9'].entries()){
          let p=await rpc('admin_catalog_physical18_preview',[f.s.id,f.p.link.id,kind,courses[i].id,'inherited']);
          p=await rpc('admin_catalog_physical18_register',[f.s.id,f.p.link.id,kind,courses[i].id,'inherited',p.baseline,'Exact interval',true]);
          await rpc('admin_catalog_physical18_verify',[p.configuration.id,p.configuration.revision,p.baseline,p.saved_holes,'Verified interval',true]);
        }
        const p=await preview();assert.equal(p.clubs.find(c=>c.club_id===club.id).targets.filter(x=>x.mode==='override').length,2);await confirm(p,'Approve Fiuggi fixture');
        const h=(await local('list',[club.id])).targets.find(x=>x.target.id===courses[1].id).holes[0];
        let d=await local('open',['course',courses[1].id,h.id]);d=await local('save',[d.draft.id,d.draft.revision,4,false]);assert.ok(d.blockers.includes('explicit_local_override_required'));
        d=await local('save',[d.draft.id,d.draft.revision,4,true]);assert.equal(d.can_publish,true,JSON.stringify(d.blockers));const before=await dump();
        await local('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Explicit local override',true]);const after=await dump();
        assert.deepEqual(after.admin_catalog_physical_holes,before.admin_catalog_physical_holes);assert.deepEqual(after.admin_catalog_playable_configurations,before.admin_catalog_playable_configurations);
        const slot=after.admin_catalog_configuration_holes.find(x=>x.j.legacy_route_hole_id===h.id).j;assert.equal(slot.par_mode,'override');assert.equal(slot.par_override,4);
        assert.equal(after.admin_catalog_foundation_events.length,before.admin_catalog_foundation_events.length+1);
        assert.equal(after.route_tees.find(x=>x.j.route_id===courses[1].id).j.par_total,34);
        for(const x of after.route_holes){assert.equal(x.j.stroke_index,before.route_holes.find(y=>y.j.id===x.j.id).j.stroke_index);}
        const ph=(await par('list',[club.id])).holes.find(x=>x.number===1);let pd=await par('open',[ph.id]);pd=await par('save',[pd.draft.id,pd.draft.revision,4]);assert.equal(pd.can_publish,true,JSON.stringify(pd.blockers));assert.ok(pd.overrides_excluded.some(x=>x.position===1));assert.equal(pd.configurations.length,1);
        await par('publish',[pd.draft.id,pd.draft.revision,pd.baseline_hash,'Parent with override excluded',true]);
        const final=await dump();assert.equal(final.route_holes.find(x=>x.j.id===h.id).j.par,4);assert.equal(final.route_tees.find(x=>x.j.route_id===courses[1].id).j.par_total,34);
      });
    });
    await t.test('unlinked combination is autonomous: local Par and total never modify its exact course references',async()=>{
      await rollback(async()=>{
        const second=await createCourse(autonomousClub,'Independent second nine',[4,4,4,4,4,4,3,4,4],[1,2,3,4,5,6,7,8,9]);
        const combo=(await ownerQuery("insert into public.route_combinations(club_id,name,holes_count,total_par,front_route_id,back_route_id) values($1,'Independent combination',18,70,$2,$3) returning id",[autonomousClub.id,autonomous.id,second.id])).rows[0];
        for(let i=1;i<=18;i++)await ownerQuery('insert into public.route_combination_holes(route_combination_id,round_hole_number,route_id,route_position,physical_hole_number,par,stroke_index) values($1,$2,$3,$4,$5,$6,$2)',[combo.id,i,i<=9?autonomous.id:second.id,i<=9?1:2,1+(i-1)%9,1+(i-1)%9===7?3:4]);
        await confirm(await preview(),'Autonomous combination approval');const t=(await local('list',[autonomousClub.id])).targets.find(x=>x.target.id===combo.id);assert.equal(t.mode,'local');assert.ok(t.approved);
        let d=await local('open',['combination',combo.id,t.holes[0].id]);d=await local('save',[d.draft.id,d.draft.revision,5,false]);assert.equal(d.can_publish,true,JSON.stringify(d.blockers));const b=await dump();await local('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Local independent combination',true]);const a=await dump();assert.deepEqual(a.route_holes,b.route_holes);assert.deepEqual(a.course_routes,b.course_routes);assert.equal(a.route_combinations.find(x=>x.j.id===combo.id).j.total_par,71);
      });
    });
    await t.test('an exact uncovered live reference blocks the parent until autonomy is explicitly approved',async()=>{
      await rollback(async()=>{
        const second=await createCourse(mare,'Independent other nine',Array(9).fill(4),[1,2,3,4,5,6,7,8,9]);
        const combo=(await ownerQuery("insert into public.route_combinations(club_id,name,holes_count,total_par,front_route_id,back_route_id) values($1,'Unlinked exact combination',18,71,$2,$3) returning id",[mare.id,course.id,second.id])).rows[0];
        const source=(await ownerQuery('select physical_hole_number,par from public.route_holes where route_id=$1 order by physical_hole_number',[course.id])).rows;
        for(let i=1;i<=18;i++)await ownerQuery('insert into public.route_combination_holes(route_combination_id,round_hole_number,route_id,route_position,physical_hole_number,par,stroke_index) values($1,$2,$3,$4,$5,$6,$2)',[combo.id,i,i<=9?course.id:second.id,i<=9?1:2,1+(i-1)%9,i<=9?source[i-1].par:4]);
        let p=await par('open',[hole.id]);p=await par('save',[p.draft.id,p.draft.revision,5]);assert.ok(p.blockers.includes('ambiguous_or_uncovered_live_row'));
        await par('abandon',[p.draft.id,p.draft.revision,true]);
        await confirm(await preview(),'Explicit autonomy, never inherited by reference alone');
        p=await par('open',[hole.id]);p=await par('save',[p.draft.id,p.draft.revision,5]);assert.equal(p.can_publish,true,JSON.stringify(p.blockers));assert.ok(p.autonomous_excluded.some(x=>x.label==='Unlinked exact combination'));
        const before=await dump();await par('publish',[p.draft.id,p.draft.revision,p.baseline_hash,'Parent preserving explicitly autonomous combination',true]);const after=await dump();
        assert.deepEqual(after.route_combination_holes,before.route_combination_holes);assert.deepEqual(after.route_combinations,before.route_combinations);
      });
    });
    await t.test('Parco exact multi9: official combination override is independent and audited',async()=>{
      await rollback(async()=>{
        for(const [table,rows] of [['clubs',[{...parco.club,created_by:admin}]],['course_routes',parco.routes],['route_holes',parco.holes],['route_combinations',parco.combinations],['route_combination_holes',parco.slots]])for(const row of rows){const keys=Object.keys(row);await ownerQuery(`insert into public.${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]));}
        for(const combo of parco.combinations)await ownerQuery("insert into public.combination_tees(route_combination_id,tee_name,holes_count,par_total,course_rating,slope_rating) values($1,'Exact fixture tee',18,$2,70,125)",[combo.id,combo.total_par]);
        const mp=await rpc('admin_catalog_multi9_club_preview',[parco.club.id]);await rpc('admin_catalog_multi9_batch_register',[[mp],'Explicit physical fixture',true]);
        await confirm(await preview(),'Approve Parco exact fixture');
        const list=await local('list',[parco.club.id]),target=list.targets.find(t=>t.type==='combination' && t.approved && !t.reasons.length);assert.ok(target,JSON.stringify(list.targets.map(t=>({type:t.type,reasons:t.reasons}))));
        const h=target.holes[0],np=h.par===4?5:4;let d=await local('open',['combination',target.target.id,h.id]);d=await local('save',[d.draft.id,d.draft.revision,np,true]);assert.equal(d.can_publish,true,JSON.stringify(d.blockers));const before=await dump();
        await local('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Explicit official combination override',true]);const after=await dump();
        assert.deepEqual(after.route_holes,before.route_holes);assert.deepEqual(after.course_routes,before.course_routes);assert.deepEqual(after.admin_catalog_physical_holes,before.admin_catalog_physical_holes);
        assert.equal(after.route_combination_holes.find(x=>x.j.id===h.id).j.stroke_index,h.si);
        assert.equal(after.route_combinations.find(x=>x.j.id===target.target.id).j.total_par,target.target.total_par+np-h.par);
        const slot=after.admin_catalog_configuration_holes.find(x=>x.j.legacy_combination_hole_id===h.id).j;assert.equal(slot.par_mode,'override');assert.equal(slot.par_override,np);
      });
    });
    await t.test('late failure rolls back local live changes, audit, version and draft status',async()=>{
      await rollback(async()=>{const h=(await local('list',[autonomousClub.id])).targets[0].holes[0];let d=await local('open',['course',autonomous.id,h.id]);d=await local('save',[d.draft.id,d.draft.revision,5,false]);
        await ownerQuery("create function public.reject_local_version() returns trigger language plpgsql as $$begin raise exception 'Injected late failure' using errcode='23514';end$$");await ownerQuery('create trigger reject_local_version before insert on public.admin_catalog_local_par_versions for each row execute function public.reject_local_version()');const before=await dump();await failure(()=>local('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Injected rollback',true]),'23514');assert.deepEqual(await dump(),before);
      });
    });
    await t.test('unknown tees block rather than silently drift and retain all values',async()=>{
      await rollback(async()=>{await ownerQuery("insert into public.route_tees(route_id,tee_name,holes_count,par_total) values($1,'Unknown',9,35)",[autonomous.id]);const h=(await local('list',[autonomousClub.id])).targets[0].holes[0];let d=await local('open',['course',autonomous.id,h.id]);d=await local('save',[d.draft.id,d.draft.revision,5,false]);assert.ok(d.blockers.includes('tee_unknown_review_obsolete_or_override'));const b=await dump();await failure(()=>local('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Unknown denied',true]),'23514');assert.deepEqual(await dump(),b);});
    });
    await t.test('specific target base mutation is rejected; unrelated club edits do not create conflicts',async()=>{
      await rollback(async()=>{const h=(await local('list',[autonomousClub.id])).targets[0].holes[0];let d=await local('open',['course',autonomous.id,h.id]);d=await local('save',[d.draft.id,d.draft.revision,5,false]);
        await ownerQuery("update public.course_routes set name='Unrelated rename' where id=$1",[course.id]);
        const resumed=await local('open',['course',autonomous.id,h.id]);assert.equal(resumed.base_changed,false);
        await ownerQuery('update public.route_holes set stroke_index=18 where id=$1',[h.id]);const b=await dump();await failure(()=>local('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Mutated source denied',true]),'40001');assert.deepEqual(await dump(),b);
      });
    });
    await t.test('per-club approval rolls back changed club but preserves valid clubs',async()=>{
      await rollback(async()=>{const c=(await ownerQuery("insert into public.clubs(name,name_normalized,created_by) values('Other local','otherlocal',$1) returning *",[admin])).rows[0];const r=await createCourse(c,'Other nine',Array(9).fill(4),[1,2,3,4,5,6,7,8,9]);const p=await preview();await ownerQuery('update public.route_holes set par=5 where route_id=$1 and physical_hole_number=1',[r.id]);const result=await confirm(p,'Partial safe approval');assert.ok(result.excluded.some(x=>x.club_id===c.id));assert.ok(result.confirmed.some(x=>x.club_id===autonomousClub.id));assert.equal((await ownerQuery('select count(*) n from public.admin_catalog_par_targets where club_id=$1',[c.id])).rows[0].n,0);});
    });
  } finally {await db.close();}
});

