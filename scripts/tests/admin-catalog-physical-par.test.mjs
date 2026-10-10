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
test('safe physical Par: exact proposals, multi-row transaction, concurrency and immutable audit',async t=>{
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
    await t.test('one-shot migration does not change existing rows or historical evidence',async()=>{
      const before=await dump();await db.exec('reset role');await db.exec(migration);const after=await dump();for(const [name,rows] of Object.entries(before))assert.deepEqual(after[name],rows,name);
      await db.exec('reset role');await failure(()=>db.exec(migration),'42P07');await db.exec('rollback');await role();
    });
    await t.test('incremental repair has no data writes and fails atomically on second application',async()=>{
      const empty=(await rpc('admin_course_open_draft',[course.id])).draft;
      const old=await par('open',[hole.id]);const oldBase=(await ownerQuery('select base_hash from public.admin_catalog_par_drafts where id=$1',[old.draft.id])).rows[0].base_hash;
      const before=await dump();await db.exec('reset role');await db.exec(repair);assert.deepEqual(await dump(),before);
      await db.exec('reset role');await failure(()=>db.exec(repair),'42723');await db.exec('rollback');await role();
      const resumed=await par('open',[hole.id]);assert.equal(resumed.base_changed,false);assert.equal(resumed.draft.id,old.draft.id);
      assert.equal((await ownerQuery('select base_hash from public.admin_catalog_par_drafts where id=$1',[old.draft.id])).rows[0].base_hash,oldBase,'Read/open never rewrites the pre-fix base');
      const saved=await par('save',[resumed.draft.id,resumed.draft.revision,5]);assert.ok(!saved.blockers.includes('overlapping_live_draft'));
      assert.equal((await ownerQuery('select base_hash from public.admin_catalog_par_drafts where id=$1',[old.draft.id])).rows[0].base_hash,saved.baseline_hash,'Explicit save upgrades only the hash format of a proven identical baseline');
      const benign=await rpc('admin_course_save_draft',[empty.draft_id,empty.snapshot,empty.revision]);
      const savedAgain=await par('save',[saved.draft.id,saved.draft.revision,5]);assert.ok(!savedAgain.blockers.includes('overlapping_live_draft'));
      await par('abandon',[savedAgain.draft.id,savedAgain.draft.revision,true]);await rpc('admin_catalog_archive_draft',[empty.draft_id,'route',benign.revision]);
    });
    await t.test('anon/player/service/missing identity and forged role denied; no direct DML/read/private helper access',async()=>{
      for(const r of [['anon',''],['authenticated',player],['service_role',admin],['service_role',admin,'authenticated'],['authenticated',''],['authenticated',admin,'service_role']]){
        await role(...r);
        for(const [name,args] of [['list',[mare.id]],['tee_proposal',[mare.id]],['tee_confirm',[mare.id,'x','Note',true]],['open',[hole.id]],['save',[hole.id,1,5]],['publish',[hole.id,1,'x','Note',true]],['abandon',[hole.id,1,true]]])await failure(()=>par(name,args),'42501');
        for(const table of ['admin_catalog_par_drafts','admin_catalog_par_versions','admin_catalog_par_tee_batches'])for(const action of ['select * from','delete from','update'])await failure(()=>db.exec(action==='update'?`update public.${table} set club_id=club_id`:`${action} public.${table}`),'42501');
      }await role();await failure(()=>par('plan',[hole.id,5,null]),'42501');await failure(()=>par('plan_legacy',[hole.id,5,null]),'42501');await failure(()=>par('overlapping_drafts',[mare.id,[],[],[]]),'42501');await failure(()=>par('lock',[mare.id]),'42501');await failure(()=>db.exec('insert into public.admin_catalog_par_drafts default values'),'42501');
    });
    let proposal;
    await t.test('pure preview uses exact verified 9/18 scopes, not FIG/raw/equal names; incomplete evidence never certifies',async()=>{
      const before=await dump();await db.exec('begin read only');proposal=await par('tee_proposal',[mare.id]);await par('list',[mare.id]);await db.exec('commit');assert.deepEqual(await dump(),before);
      assert.equal(proposal.tee_count,2);assert.equal(proposal.configuration_count,2);assert.ok(proposal.items.every(x=>x.decision.attestation==='curato'&&x.decision.par_behavior==='derivato'));
      assert.ok(proposal.items.some(x=>x.configuration_id===eighteen.id&&x.scope===18));assert.ok(!JSON.stringify(proposal).includes('source_payload'));
      await rollback(async()=>{await ownerQuery("update public.route_tees set source_payload='{\"private\":\"SECRET\"}' where id=$1",[tee9.id]);const p=await par('tee_proposal',[mare.id]);assert.equal(p.tee_count,0);assert.ok(p.excluded.every(x=>x.reason==='unverified_or_changed_dependencies'));assert.ok(!JSON.stringify(p).includes('SECRET'));});
    });
    await t.test('batch requires approval, note, current exact hash; one atomic decision and idempotent receipt',async()=>{
      await failure(()=>par('tee_confirm',[mare.id,proposal.proposal_hash,'Approve',false]),'22023');await failure(()=>par('tee_confirm',[mare.id,'forged','Approve',true]),'40001');
      await rollback(async()=>{
        await ownerQuery("create function public.test_batch_failure() returns trigger language plpgsql as $$begin if (select count(*) from public.admin_catalog_tee_classifications)>0 then raise exception 'Fixture second classification failure' using errcode='23514';end if;return new;end$$");
        await ownerQuery('create trigger test_batch_failure before insert on public.admin_catalog_tee_classifications for each row execute function public.test_batch_failure()');
        const before=await dump();await failure(()=>par('tee_confirm',[mare.id,proposal.proposal_hash,'Atomic batch failure',true]),'23514');assert.deepEqual(await dump(),before);
      });
      const before=await dump();const receipt=await par('tee_confirm',[mare.id,proposal.proposal_hash,'Explicit curated derivation',true]);assert.equal(receipt.tee_count,2);
      const after=await dump();for(const table of ['route_tees','route_holes','course_routes','admin_catalog_playable_configurations','admin_catalog_versions'])assert.deepEqual(before[table],after[table]);
      assert.deepEqual(await par('tee_confirm',[mare.id,proposal.proposal_hash,'Explicit curated derivation',true]),receipt);await failure(()=>par('tee_confirm',[mare.id,proposal.proposal_hash,'Different approval',true]),'40001');
      const p=await par('tee_proposal',[mare.id]);assert.equal(p.tee_count,0);assert.ok(p.excluded.every(x=>x.reason==='existing_classification_preserved'));
    });
    await t.test('draft saves no live data; repeated 18 has two occurrences, 36/72 totals, SI never propagated',async()=>{
      await rollback(async()=>{
        const before=await dump(),open=await par('open',[hole.id]);assert.equal(open.base_changed,false);const saved=await par('save',[open.draft.id,open.draft.revision,5]);
        assert.equal(saved.can_publish,true,JSON.stringify(saved.blockers));assert.deepEqual(saved.configurations.map(c=>c.after_total).sort(),[36,72]);assert.equal(saved.configurations.find(c=>c.holes_count===18).occurrences.length,2);
        const after=await dump();for(const table of Object.keys(before).filter(n=>n!=='admin_catalog_par_drafts'))assert.deepEqual(after[table],before[table]);
        await failure(()=>par('save',[open.draft.id,open.draft.revision,3]),'40001');await role('authenticated',other);await failure(()=>par('save',[saved.draft.id,saved.draft.revision,3]),'42501');await role();
      });
    });
    await t.test('untouched catalog drafts and unrelated edited club drafts do not block or alter an existing Par baseline',async()=>{
      await rollback(async()=>{
        const d=await par('open',[hole.id]);const initial=await par('save',[d.draft.id,d.draft.revision,5]);
        const courseDraft=(await rpc('admin_course_open_draft',[course.id])).draft;
        const grid=(await rpc('admin_course_hole_grid_open_draft',[course.id])).draft;
        const tee=(await rpc('admin_course_tee_open_draft',[tee9.id])).draft;
        const clubDraft=await rpc('admin_club_open_draft',[mare.id]);
        await rpc('admin_club_save_draft',[clubDraft.draft_id,{...clubDraft.snapshot,name:'Unrelated Club name intention'},clubDraft.revision]);
        await rpc('admin_course_save_draft',[courseDraft.draft_id,courseDraft.snapshot,courseDraft.revision]);
        const saved=await par('save',[initial.draft.id,initial.draft.revision,5]);assert.equal(saved.can_publish,true,JSON.stringify(saved.blockers));assert.equal(saved.baseline_hash,initial.baseline_hash);
        const before=await dump();await par('publish',[saved.draft.id,saved.draft.revision,saved.baseline_hash,'Unchanged drafts do not block',true]);const after=await dump();assert.deepEqual(after.admin_catalog_drafts,before.admin_catalog_drafts);
        // The grid is now stale, but was never edited by its owner. It cannot
        // imply an intention to reverse the newly published Par.
        const next=await par('open',[hole.id]),reverse=await par('save',[next.draft.id,next.draft.revision,4]);assert.equal(reverse.can_publish,true,JSON.stringify(reverse.blockers));
        assert.equal((await ownerQuery('select workflow_status from public.admin_catalog_drafts where draft_id=$1',[grid.draft_id])).rows[0].workflow_status,'draft');assert.equal(tee.workflow_status,'draft');
      });
    });
    await t.test('only genuinely edited overlapping snapshots block, including a changed tee and hole grid',async()=>{
      for(const kind of ['tee','grid'])await rollback(async()=>{
        if(kind==='tee'){const d=(await rpc('admin_course_tee_open_draft',[tee9.id])).draft;await rpc('admin_course_tee_save_draft',[d.draft_id,{...d.snapshot,course_rating:35},d.revision]);}
        else {const d=(await rpc('admin_course_hole_grid_open_draft',[course.id])).draft;const snapshot={holes:d.snapshot.holes.map((h,i)=>i===0?{...h,par:5}:h)};await rpc('admin_course_hole_grid_save_draft',[d.draft_id,snapshot,d.revision]);}
        const d=await par('open',[hole.id]),p=await par('save',[d.draft.id,d.draft.revision,5]);assert.ok(p.blockers.includes('overlapping_live_draft'));
        const before=await dump();await failure(()=>par('publish',[p.draft.id,p.draft.revision,p.baseline_hash,'Block edited overlapping draft',true]),'23514');assert.deepEqual(await dump(),before);
      });
    });
    await t.test('Mare Buca 1 5→4: source9 35→34, repeated18 70→68, all eight derived tees and untouched drafts',async()=>{
      await rollback(async()=>{
        const club=(await ownerQuery("insert into public.clubs(name,name_normalized,created_by) values('Mare regression','mare-regression',$1) returning *",[admin])).rows[0];
        const c=await createCourse(club,'Percorso',[5,4,4,4,3,4,3,4,4],[11,17,1,7,9,5,3,13,15]);
        for(const n of [9,18])for(const name of ['Giallo','Verde','Rosso','Arancio'])await ownerQuery("insert into public.route_tees(route_id,tee_name,tee_color,gender,holes_count,par_total,course_rating,slope_rating) values($1,$2,$3,$4,$5,$6,$7,125)",[c.id,name,name.toLowerCase(),name==='Arancio'&&n===18?'women':null,n,n===9?35:70,n===9?34.8:69.6]);
        const f=await structure(club,c,'fisico_9');await register9(f,'autonomous_9');await register9(f,'repeated_18');
        const proposal=await par('tee_proposal',[club.id]);assert.equal(proposal.tee_count,8);assert.equal(proposal.configuration_count,2);await par('tee_confirm',[club.id,proposal.proposal_hash,'Explicit eight-tee rule',true]);
        await rpc('admin_course_open_draft',[c.id]);await rpc('admin_course_hole_grid_open_draft',[c.id]);
        const round=(await ownerQuery("insert into public.rounds(user_id,club_id,holes_count,total_par,round_type,selected_routes) values($1,$2,18,70,'repeat_9',$3) returning *",[player,club.id,[{route_id:c.id,par:70}]])).rows[0];
        await ownerQuery('insert into public.round_holes(round_id,user_id,club_id,route_id,round_hole_number,route_position,physical_hole_number,par,stroke_index) values($1,$2,$3,$4,1,1,1,5,11)',[round.id,player,club.id,c.id]);
        const h=(await par('list',[club.id])).holes.find(h=>h.number===1);const opened=await par('open',[h.id]);const before=await dump();const p=await par('save',[opened.draft.id,opened.draft.revision,4]);
        assert.equal(p.can_publish,true,JSON.stringify(p.blockers));assert.deepEqual(p.configurations.map(x=>[x.holes_count,x.before_total,x.after_total]).sort((a,b)=>a[0]-b[0]),[[9,35,34],[18,70,68]]);
        assert.equal(p.configurations.find(x=>x.holes_count===9).impact_role,'physical_base');assert.equal(p.configurations.find(x=>x.holes_count===18).occurrences.length,2);
        assert.equal(p.tees.length,8);assert.ok(p.tees.every(x=>x.eligible&&x.before===(x.scope===9?35:70)&&x.after===(x.scope===9?34:68)));
        const preview=await dump();for(const table of Object.keys(before).filter(x=>x!=='admin_catalog_par_drafts'))assert.deepEqual(preview[table],before[table],'Preview does not write '+table);
        await par('publish',[p.draft.id,p.draft.revision,p.baseline_hash,'Isolated regression publication',true]);const after=await dump();assert.equal(after.course_routes.find(x=>x.j.id===c.id).j.total_par,34);
        for(const t of after.route_tees.filter(x=>x.j.route_id===c.id)){const old=before.route_tees.find(x=>x.j.id===t.j.id).j;assert.equal(t.j.par_total,t.j.holes_count===9?34:68);assert.deepEqual({...t.j,par_total:old.par_total,updated_at:old.updated_at},old);}
        for(const r of after.route_holes){const old=before.route_holes.find(x=>x.j.id===r.j.id).j;assert.deepEqual({...r.j,par:old.par},old);}
        for(const table of ['admin_catalog_drafts','admin_catalog_versions','admin_catalog_tee_overrides','admin_catalog_configuration_holes','admin_catalog_playable_configurations','rounds','round_holes'])assert.deepEqual(after[table],before[table],table+' immutable');
      });
    });
    await t.test('changed tee/source, overlapping drafts, unknown/review decisions and missing coverage block without partial writes',async()=>{
      for(const mutate of [
        ()=>ownerQuery('update public.route_tees set slope_rating=126 where id=$1',[tee9.id]),
        async()=>{const d=(await rpc('admin_course_open_draft',[course.id])).draft;await rpc('admin_course_save_draft',[d.draft_id,{...d.snapshot,name:'Really changed course'},d.revision]);},
        async()=>{await role('authenticated',other);await par('open',[hole.id]);await role();},
        ()=>ownerQuery("insert into public.course_routes(club_id,name,holes_count,total_par) values($1,'Unlinked equal name',9,35)",[mare.id]),
        ()=>ownerQuery('update public.route_tees set holes_count=null,par_total=null where id=$1',[tee18.id])
      ])await rollback(async()=>{const d=await par('open',[hole.id]);const saved=await par('save',[d.draft.id,d.draft.revision,5]);await mutate();const before=await dump();await assert.rejects(()=>par('publish',[saved.draft.id,saved.draft.revision,saved.baseline_hash,'Do not publish',true]));assert.deepEqual(await dump(),before);});
      for(const behavior of ['sconosciuto','richiede_revisione'])await rollback(async()=>{
        const detail=await rpc('admin_catalog_tee_classification_detail',[mare.id,'route_tee',tee9.id]);
        const decision={attestation:'curato',par_behavior:behavior,provenance:'stablr',evidence:detail.classification.evidence,note:'Explicit different behavior',configuration_id:null,derivation_rule:null,declared_holes_count:9,declared_applicability:null};
        const p=await rpc('admin_catalog_tee_classification_preview',[mare.id,'route_tee',tee9.id,decision,detail.revision]);await rpc('admin_catalog_tee_classification_confirm',[mare.id,'route_tee',tee9.id,p.decision,p.revision,p.baseline,true]);
        const d=await par('open',[hole.id]),s=await par('save',[d.draft.id,d.draft.revision,5]);assert.equal(s.can_publish,false);assert.ok(s.blockers.includes('tee_unknown_review_obsolete_or_override'));const before=await dump();await failure(()=>par('publish',[s.draft.id,s.draft.revision,s.baseline_hash,'Blocked fixture',true]),'23514');assert.deepEqual(await dump(),before);
      });
    });
    await t.test('failure AFTER live writes rolls back physical/live/tee/anchor/classification audits/draft closure',async()=>{
      await rollback(async()=>{const d=await par('open',[hole.id]),s=await par('save',[d.draft.id,d.draft.revision,5]);await ownerQuery("create function public.test_par_failure() returns trigger language plpgsql as $$begin raise exception 'Fixture late failure' using errcode='23514';end$$");await ownerQuery("create trigger test_par_failure before insert on public.admin_catalog_par_versions for each row execute function public.test_par_failure()");const before=await dump();await failure(()=>par('publish',[s.draft.id,s.draft.revision,s.baseline_hash,'Fail atomically',true]),'23514');assert.deepEqual(await dump(),before);});
    });
    await t.test('publication + compensating publication: sealed source/history stay immutable, new baseline usable immediately',async()=>{
      const before=await dump(),d=await par('open',[hole.id]),s=await par('save',[d.draft.id,d.draft.revision,5]);
      await failure(()=>par('publish',[s.draft.id,s.draft.revision,s.baseline_hash,' ',true]),'22023');
      const receipt=await par('publish',[s.draft.id,s.draft.revision,s.baseline_hash,'Explicit atomic fixture',true]);assert.equal(receipt.tee_count,2);assert.equal(receipt.configuration_count,2);
      const after=await dump();assert.equal(after.route_tees.find(x=>x.j.id===tee9.id).j.par_total,36);assert.equal(after.route_tees.find(x=>x.j.id===tee18.id).j.par_total,72);
      assert.equal(after.course_routes.find(x=>x.j.id===course.id).j.total_par,36);assert.equal(after.admin_catalog_par_drafts.find(x=>x.j.id===d.draft.id).j.status,'published');
      for(const name of ['admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_physical_course_links','admin_catalog_versions','admin_catalog_drafts','rounds','round_holes'])assert.deepEqual(after[name],before[name],name);
      for(const x of after.route_holes){const old=before.route_holes.find(o=>o.j.id===x.j.id).j;assert.equal(x.j.stroke_index,old.stroke_index);}
      for(const x of after.route_tees){const old=before.route_tees.find(o=>o.j.id===x.j.id).j;assert.equal(x.j.course_rating,old.course_rating);assert.equal(x.j.slope_rating,old.slope_rating);}
      assert.equal((await rpc('admin_catalog_tee_classification_detail',[mare.id,'route_tee',tee9.id])).state,'current');
      const g=await rpc('admin_catalog_data_origin',[mare.id]);assert.ok(g.configurations.every(x=>x.source_state==='matched'));assert.ok(g.physical_links.every(x=>x.source_state==='matched'));
      await failure(()=>par('publish',[s.draft.id,s.draft.revision,s.baseline_hash,'Explicit atomic fixture',true]),'40001');
      const next=await par('open',[hole.id]);assert.notEqual(next.draft.id,d.draft.id);assert.equal(next.base_changed,false);
      const restored=await par('save',[next.draft.id,next.draft.revision,4]);assert.equal(restored.can_publish,true,JSON.stringify(restored.blockers));await par('publish',[restored.draft.id,restored.draft.revision,restored.baseline_hash,'New compensating publication',true]);
      const versions=await par('list',[mare.id]);assert.equal(versions.history.length,2);assert.equal(versions.history.find(v=>v.id===receipt.version_id).after.par,5);
      await failure(()=>db.exec('update public.admin_catalog_par_versions set note=note'),'42501');await ownerQuery("select set_config('request.jwt.claim.role','authenticated',false)");
      await db.exec('reset role');await failure(()=>db.exec('update public.admin_catalog_par_versions set note=note'),'55000');await role();
    });
    await t.test('abandonment explicit; no physical mutation via GUC, generic foundation writer or stale owner revision',async()=>{
      const d=await par('open',[hole.id]);await failure(()=>par('abandon',[d.draft.id,d.draft.revision,false]),'22023');const before=await dump();await par('abandon',[d.draft.id,d.draft.revision,true]);const after=await dump();assert.deepEqual(after.route_holes,before.route_holes);assert.deepEqual(after.admin_catalog_par_versions,before.admin_catalog_par_versions);
      const current=(await rpc('admin_catalog_data_origin',[mare.id])).physical_holes.find(h=>h.id===hole.id);
      await failure(()=>rpc('admin_catalog_foundation_review_physical_hole',[hole.id,current.revision,5,'stablr','Forged','Attempt',true]),'55000');
      await db.query("select set_config('stablr.par_publication','true',false)");await failure(()=>ownerQuery('update public.admin_catalog_physical_holes set base_par=5 where id=$1',[hole.id]),'55000');await role();
    });
    await t.test('Fiuggi and real Parco incomplete configurations are blocked, not automatically inferred',async()=>{
      const fiuggi=(await ownerQuery("insert into public.clubs(name,name_normalized,created_by) values('Fiuggi 1928','fiuggi',$1) returning *",[admin])).rows[0];
      const pars=[5,4,3,4,3,4,4,5,3,5,3,4,3,4,5,3,4,4],si=[9,17,15,3,13,1,5,11,7,12,2,18,4,8,6,16,14,10];
      const fc=await createCourse(fiuggi,'18 Buche',pars,si);await createCourse(fiuggi,'Prime Nove',pars.slice(0,9),si.slice(0,9));await createCourse(fiuggi,'Seconde Nove',pars.slice(9),si.slice(9));
      const ff=await structure(fiuggi,fc,'fisico_18');let fp=await rpc('admin_catalog_physical18_preview',[ff.s.id,ff.p.link.id,'autonomous_18',fc.id,'inherited']);fp=await rpc('admin_catalog_physical18_register',[ff.s.id,ff.p.link.id,'autonomous_18',fc.id,'inherited',fp.baseline,'Explicit fixture',true]);await rpc('admin_catalog_physical18_verify',[fp.configuration.id,fp.configuration.revision,fp.baseline,fp.saved_holes,'Verified fixture',true]);
      const fh=(await par('list',[fiuggi.id])).holes[0],fd=await par('open',[fh.id]),fs=await par('save',[fd.draft.id,fd.draft.revision,4]);assert.ok(fs.blockers.includes('incomplete_club_coverage'));
      for(const [table,rows] of [['clubs',[{...parco.club,created_by:admin}]],['course_routes',parco.routes],['route_holes',parco.holes],['route_combinations',parco.combinations],['route_combination_holes',parco.slots]])for(const row of rows){const keys=Object.keys(row);await ownerQuery(`insert into public.${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]));}
      const p=await rpc('admin_catalog_multi9_club_preview',[parco.club.id]);await rpc('admin_catalog_multi9_batch_register',[[p],'Explicit fixture batch',true]);
      const ph=(await par('list',[parco.club.id])).holes[0],pd=await par('open',[ph.id]),ps=await par('save',[pd.draft.id,pd.draft.revision,ph.par===4?5:4]);assert.ok(ps.blockers.includes('incomplete_club_coverage'));assert.ok(ps.configurations.some(c=>c.combination_id));
      const before=await dump();await failure(()=>par('publish',[ps.draft.id,ps.draft.revision,ps.baseline_hash,'Do not infer missing repeats',true]),'23514');assert.deepEqual(await dump(),before);
    });
    await t.test('complete physical18 propagates only to explicitly inherited front/back grids, preserving source SI',async()=>{
      await rollback(async()=>{
        const club=(await ownerQuery("insert into public.clubs(name,name_normalized,created_by) values('Complete physical18 fixture','complete18',$1) returning *",[admin])).rows[0];
        const pars=[5,4,3,4,3,4,4,5,3,5,3,4,3,4,5,3,4,4],si=[9,17,15,3,13,1,5,11,7,12,2,18,4,8,6,16,14,10];
        const courses=[await createCourse(club,'18',pars,si),await createCourse(club,'Front',pars.slice(0,9),si.slice(0,9)),await createCourse(club,'Back',pars.slice(9),si.slice(9))];
        for(const c of courses)await ownerQuery("insert into public.route_tees(route_id,tee_name,holes_count,par_total,course_rating,slope_rating) values($1,'Fixture', $2,$3,70,125)",[c.id,c.holes_count,c.total_par]);
        const f=await structure(club,courses[0],'fisico_18');
        for(const [i,kind] of ['autonomous_18','front_9','back_9'].entries()){
          let p=await rpc('admin_catalog_physical18_preview',[f.s.id,f.p.link.id,kind,courses[i].id,'inherited']);
          p=await rpc('admin_catalog_physical18_register',[f.s.id,f.p.link.id,kind,courses[i].id,'inherited',p.baseline,'Explicit interval fixture',true]);
          await rpc('admin_catalog_physical18_verify',[p.configuration.id,p.configuration.revision,p.baseline,p.saved_holes,'Verified exact interval',true]);
        }
        const p=await par('tee_proposal',[club.id]);assert.equal(p.tee_count,3);await par('tee_confirm',[club.id,p.proposal_hash,'Curated explicit rule',true]);
        const unrelated=(await rpc('admin_course_open_draft',[courses[2].id])).draft;await rpc('admin_course_save_draft',[unrelated.draft_id,{...unrelated.snapshot,name:'Edited but unrelated back nine'},unrelated.revision]);
        const h=(await par('list',[club.id])).holes.find(h=>h.number===1);let d=await par('open',[h.id]);d=await par('save',[d.draft.id,d.draft.revision,4]);
        assert.equal(d.can_publish,true,JSON.stringify(d.blockers));assert.deepEqual(d.configurations.map(c=>c.after_total).sort(),[34,69]);assert.equal(d.tees.length,2);
        const before=await dump();await par('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Explicit physical18 fixture',true]);const after=await dump();
        for(const c of courses){const live=after.course_routes.find(x=>x.j.id===c.id).j;assert.equal(live.total_par,c.total_par-(c.id===courses[2].id?0:1));}
        for(const r of after.route_holes){const old=before.route_holes.find(x=>x.j.id===r.j.id).j;assert.equal(r.j.stroke_index,old.stroke_index);}
        assert.deepEqual(after.admin_catalog_configuration_holes,before.admin_catalog_configuration_holes);
      });
    });
    await t.test('explicit configuration source Par overrides stay unchanged even when equal to the physical base',async()=>{
      await rollback(async()=>{
        const club=(await ownerQuery("insert into public.clubs(name,name_normalized,created_by) values('Explicit override18','override18',$1) returning *",[admin])).rows[0];
        const pars=Array(18).fill(4),si=Array.from({length:18},(_,i)=>i+1);
        const courses=[await createCourse(club,'Physical18',pars,si),await createCourse(club,'Explicit source9',pars.slice(0,9),si.slice(0,9))];
        const f=await structure(club,courses[0],'fisico_18');
        for(const [i,kind] of ['autonomous_18','front_9'].entries()){
          const mode=i===1?'source':'inherited';let p=await rpc('admin_catalog_physical18_preview',[f.s.id,f.p.link.id,kind,courses[i].id,mode]);
          p=await rpc('admin_catalog_physical18_register',[f.s.id,f.p.link.id,kind,courses[i].id,mode,p.baseline,'Explicit Par choice',true]);
          await rpc('admin_catalog_physical18_verify',[p.configuration.id,p.configuration.revision,p.baseline,p.saved_holes,'Verified explicit choice',true]);
        }
        const h=(await par('list',[club.id])).holes.find(h=>h.number===1);let d=await par('open',[h.id]);d=await par('save',[d.draft.id,d.draft.revision,5]);assert.equal(d.can_publish,true,JSON.stringify(d.blockers));assert.equal(d.configurations.length,1);assert.equal(d.overrides_excluded.length,1);
        const before=await dump();await par('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Preserve explicit configuration override',true]);const after=await dump();
        assert.deepEqual(after.route_holes.filter(x=>x.j.route_id===courses[1].id),before.route_holes.filter(x=>x.j.route_id===courses[1].id));assert.deepEqual(after.admin_catalog_configuration_holes,before.admin_catalog_configuration_holes);
      });
    });
    await t.test('verified full tee Par overrides shield the tee, partial/unverified overrides block; SI-only stays unchanged',async()=>{
      for(const mode of ['full','partial','unverified','si'])await rollback(async()=>{
        const club=(await ownerQuery("insert into public.clubs(name,name_normalized,created_by) values('Override fixture','override',$1) returning *",[admin])).rows[0];
        const c=await createCourse(club,'Physical nine',[4,4,4,4,4,4,3,4,4],[1,3,5,7,9,11,13,15,17]);
        const tee=(await ownerQuery("insert into public.route_tees(route_id,tee_name,holes_count,par_total) values($1,'Explicit target',18,70) returning *",[c.id])).rows[0];
        const f=await structure(club,c,'fisico_9');await register9(f,'autonomous_9');const cfg=(await register9(f,'repeated_18')).configuration;
        const slots=(await ownerQuery('select * from public.admin_catalog_configuration_holes where configuration_id=$1 and position in (1,10) order by position',[cfg.id])).rows;
        for(const slot of mode==='partial'?[slots[0]]:slots)await ownerQuery(`insert into public.admin_catalog_tee_overrides(configuration_id,configuration_hole_id,route_tee_id,par_override,stroke_index_override,review_status,source_system,source_reference,reason,created_by,updated_by) values($1,$2,$3,$4,$5,$6,'stablr','Exact fixture','Explicit override fixture',$7,$7)`,[cfg.id,slot.id,tee.id,mode==='si'?null:4,mode==='si'?slot.stroke_index:null,mode==='unverified'?'needs_review':'verified',admin]);
        if(mode==='si'){const p=await par('tee_proposal',[club.id]);assert.equal(p.tee_count,1);await par('tee_confirm',[club.id,p.proposal_hash,'Explicit SI-only fixture',true]);}
        const h=(await par('list',[club.id])).holes.find(x=>x.number===1);let d=await par('open',[h.id]);d=await par('save',[d.draft.id,d.draft.revision,5]);
        assert.equal(d.can_publish,mode==='full'||mode==='si',JSON.stringify(d.blockers));
        const before=await dump();
        if(d.can_publish){await par('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Preserve explicit override',true]);const after=await dump();assert.deepEqual(after.admin_catalog_tee_overrides,before.admin_catalog_tee_overrides);assert.equal(after.route_tees.find(x=>x.j.id===tee.id).j.par_total,mode==='full'?70:72);}
        else {await failure(()=>par('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Partial override blocked',true]),'23514');assert.deepEqual(await dump(),before);}
      });
    });
    await t.test('complete multi9 exact component IDs propagate to official combinations, not equal local numbers on other courses',async()=>{
      await rollback(async()=>{
        // Test-only complete subset. Production fixture above retains all its
        // uncovered repeated routes and blocks; nothing is silently filtered live.
        const referenced=new Set(parco.combinations.flatMap(c=>[c.front_route_id,c.back_route_id]));
        const routeRows=parco.routes.filter(r=>referenced.has(r.id));assert.equal(routeRows.length,3);
        const rowsByTable=[['clubs',[{...parco.club,created_by:admin}]],['course_routes',routeRows],['route_holes',parco.holes.filter(h=>referenced.has(h.route_id))],['route_combinations',parco.combinations],['route_combination_holes',parco.slots]];
        const ids=new Map(rowsByTable.flatMap(([,rows])=>rows.map(r=>[r.id,randomUUID()])));
        for(const [table,rows] of rowsByTable)for(const row of rows){const keys=Object.keys(row);await ownerQuery(`insert into public.${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>ids.get(row[k])||row[k]));}
        const clubId=ids.get(parco.club.id);
        for(const c of parco.combinations)await ownerQuery("insert into public.combination_tees(route_combination_id,tee_name,holes_count,par_total,course_rating,slope_rating) values($1,'Exact fixture tee',18,$2,70,125)",[ids.get(c.id),c.total_par]);
        const preview=await rpc('admin_catalog_multi9_club_preview',[clubId]);await rpc('admin_catalog_multi9_batch_register',[[preview],'Explicit complete test subset',true]);
        const tp=await par('tee_proposal',[clubId]);assert.equal(tp.tee_count,4);await par('tee_confirm',[clubId,tp.proposal_hash,'Explicit official combination rule',true]);
        const h=(await par('list',[clubId])).holes.find(h=>h.number===1);let d=await par('open',[h.id]);const newPar=h.par===4?5:4;d=await par('save',[d.draft.id,d.draft.revision,newPar]);assert.equal(d.can_publish,true,JSON.stringify(d.blockers));
        const before=await dump();await par('publish',[d.draft.id,d.draft.revision,d.baseline_hash,'Verified multi9 propagation',true]);const after=await dump();
        const changedIds=new Set(d.live_rows.map(r=>r.id));
        for(const table of ['route_holes','route_combination_holes'])for(const row of after[table]){const old=before[table].find(x=>x.j.id===row.j.id).j;assert.deepEqual({...row.j,par:old.par},old);assert.equal(row.j.par,changedIds.has(row.j.id)?newPar:old.par);}
        for(const c of d.configurations.filter(c=>c.combination_id)){assert.equal(after.route_combinations.find(x=>x.j.id===c.combination_id).j.total_par,c.after_total);assert.equal(after.combination_tees.find(x=>x.j.route_combination_id===c.combination_id).j.par_total,c.after_total);}
        assert.deepEqual(after.admin_catalog_configuration_components,before.admin_catalog_configuration_components);
      });
    });
    await t.test('lock/CAS contracts cover all live writers, inserts and drafts; response allowlists contain no raw snapshots',async()=>{
      assert.match(migration,/share row exclusive mode nowait/);assert.match(migration,/admin_catalog_structure_club_lock\(p_club_id\)/);assert.match(migration,/public\.admin_catalog_drafts,public\.admin_catalog_versions in share mode nowait/);
      assert.ok(!/disable trigger|session_replication_role|grant.*(?:insert|update|delete)/i.test(migration));
      const result=JSON.stringify(await par('list',[mare.id]));for(const term of ['source_payload','source_snapshot','registration_snapshot','base_snapshot','publication_xid'])assert.ok(!result.includes(term));
    });
  }finally{await db.close();}
});
