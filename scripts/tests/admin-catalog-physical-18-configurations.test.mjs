// Isolated PostgreSQL/WASM fixtures. No network or production connection.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite }=await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const sql=(file)=>readFile(new URL(`../../supabase/${file}`,import.meta.url),'utf8');
const [schema,extension,workflow,foundation,physical,playable,migration]=await Promise.all([
  'shared-catalog-schema.sql','fig-whs-extension.sql','admin-catalog-workflow.sql','admin-catalog-physical-foundation.sql',
  'admin-catalog-physical-course-links.sql','admin-catalog-playable-configurations.sql','admin-catalog-physical-18-configurations.sql'].map(sql));
const admin='11111111-1111-4111-8111-111111111111',player='22222222-2222-4222-8222-222222222222',club='33333333-3333-4333-8333-333333333333';
// Same real field shape, Par and independent SI sequences as the Fiuggi pilot;
// UUIDs and all rows are local test fixtures, never imported into the catalog.
const par=[5,4,3,4,3,4,4,5,3,5,3,4,3,4,5,3,4,4];
const si=[9,17,15,3,13,1,5,11,7,12,2,18,4,8,6,16,14,10];
const live=['clubs','course_routes','route_holes','route_tees','route_combinations','route_combination_holes','combination_tees','rounds','round_holes','admin_catalog_drafts','admin_catalog_versions','admin_catalog_tee_overrides'];
test('Phase 3c: explicit physical 18 / front nine / back nine with independent source SI',async(t)=>{
  const db=new PGlite();
  const role=async(name='authenticated',uid=admin,claim=name)=>{await db.exec(`reset role;set role ${name}`);await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,claim]);};
  const rpc=async(name,args=[])=> (await db.query(`select * from public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args)).rows[0];
  const fail=(fn,code)=>assert.rejects(fn,e=>e.code===code);
  const dump=async(tables)=>{await db.exec('reset role');const out={};for(const name of tables)out[name]=(await db.query(`select to_jsonb(t) j from public.${name} t order by to_jsonb(t)::text`)).rows;await role();return out;};
  const preview=async(f,kind=null,course=null,mode=null)=>(await rpc('admin_catalog_physical18_preview',[f.s.id,f.link?.id||null,kind,course?.id||null,mode])).admin_catalog_physical18_preview;
  const register=async(c,o={})=>(await rpc('admin_catalog_physical18_register',[c.structure.id,c.source_link_id,c.kind,c.source_course_id,c.par_selection,o.baseline??c.baseline,o.note??'Manual fixture decision',o.confirm??true])).admin_catalog_physical18_register;
  const verify=async(c,o={})=>(await rpc('admin_catalog_physical18_verify',[c.configuration.id,o.revision??c.configuration.revision,o.baseline??c.baseline,o.holes??c.saved_holes,o.note??'Manual fixture review',o.confirm??true])).admin_catalog_physical18_verify;
  const course=async(name,pars,indexes)=>{
    await db.exec('reset role');
    const c=(await db.query("insert into public.course_routes(club_id,name,holes_count,total_par,source_system,source_payload) values($1,$2,$3,$4,'gesgolf',$5) returning *",[club,name,pars.length,pars.reduce((a,b)=>a+b,0),{fixture:true,round_variant:pars.length===9?'explicit source segment':'18'}])).rows[0];
    for(let i=0;i<pars.length;i++)await db.query('insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) values($1,$2,$3,$4)',[c.id,i+1,pars[i],indexes[i]]);
    await db.query("insert into public.route_tees(route_id,tee_name,tee_color,holes_count,course_rating,slope_rating) values($1,'Giallo','yellow',$2,70,113)",[c.id,pars.length]);await role();return c;
  };
  const fixture=async(key,verified=true)=>{
    const eighteen=await course(`18 Buche fixture ${key}`,par,si),front=await course(`Prime Nove fixture ${key}`,par.slice(0,9),si.slice(0,9)),back=await course(`Seconde Nove fixture ${key}`,par.slice(9),si.slice(9));
    let s=await rpc('admin_catalog_foundation_create_structure',[club,`Fisico 18 fixture ${key}`,'fig','fixture:explicit','Manual classification']);
    s=await rpc('admin_catalog_foundation_review_structure',[s.id,s.revision,'fisico_18','fig','fixture:explicit','Confirmed classification',true]);
    let p=(await rpc('admin_catalog_physical_course_preview',[s.id,eighteen.id])).admin_catalog_physical_course_preview;
    p=(await rpc('admin_catalog_physical_course_register',[s.id,eighteen.id,s.revision,p.source,'Physical source confirmed',true])).admin_catalog_physical_course_register;
    assert.equal(p.physical_holes.length,18);assert.equal(p.mapping.length,18);
    if(verified)p=(await rpc('admin_catalog_physical_course_verify',[p.link.id,p.link.revision,p.mapping,'One-to-one reviewed',true])).admin_catalog_physical_course_verify;
    return {s,eighteen,front,back,link:p.link};
  };
  let f,pending,other,rollback,oldNine,oldPreview,registered18,verified18,registeredBack,base;
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
      create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key references auth.users,role text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
      insert into auth.users values('${admin}'),('${player}');insert into public.profiles values('${admin}','admin'),('${player}','user');`);
    for(const name of ['clubs','course_routes','route_holes','route_combinations','route_combination_holes','rounds','round_holes'])await db.exec(schema.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    for(const name of ['route_tees','combination_tees'])await db.exec(extension.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    await db.exec(`alter table public.clubs add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.course_routes add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.route_combinations add column source_system text,add column source_external_id text,add column source_payload jsonb;
      insert into public.clubs(id,name,name_normalized,created_by) values('${club}','Fiuggi-shaped fixture','fixture','${admin}');`);
    await db.exec(workflow);await db.exec(foundation);await db.exec(physical);await db.exec(playable);await role();
    f=await fixture('pilot');pending=await fixture('pending',false);other=await fixture('other');rollback=await fixture('rollback');
    // Persist a Phase 3b proposal BEFORE this migration to prove compatible review.
    oldNine=await course('Old physical nine fixture',par.slice(0,9),[1,3,5,7,9,11,13,15,17]);
    let s=await rpc('admin_catalog_foundation_create_structure',[club,'Old nine structure','stablr','fixture:9','Manual']);
    s=await rpc('admin_catalog_foundation_review_structure',[s.id,s.revision,'fisico_9','stablr','fixture:9','Manual',true]);
    let p=(await rpc('admin_catalog_physical_course_preview',[s.id,oldNine.id])).admin_catalog_physical_course_preview;
    p=(await rpc('admin_catalog_physical_course_register',[s.id,oldNine.id,s.revision,p.source,'Manual',true])).admin_catalog_physical_course_register;
    p=(await rpc('admin_catalog_physical_course_verify',[p.link.id,p.link.revision,p.mapping,'Manual',true])).admin_catalog_physical_course_verify;
    let c=(await rpc('admin_catalog_playable_preview',[s.id,p.link.id,'autonomous_9'])).admin_catalog_playable_preview;
    oldPreview=(await rpc('admin_catalog_playable_register',[s.id,p.link.id,'autonomous_9',c.baseline,'Manual',true])).admin_catalog_playable_register;
    const draft=await rpc('admin_catalog_create_draft',['club',{name:'Historic draft fixture'},club]);await db.exec('reset role');
    await db.query("insert into public.admin_catalog_versions(entity_type,entity_key,live_entity_id,source_draft_id,version_number,schema_version,snapshot,published_by) values('club',$1,$2,$3,1,1,'{}',$4)",[draft.entity_key,club,draft.draft_id,admin]);
    await db.exec(`insert into public.rounds(user_id,club_id,holes_count,total_par,round_type,selected_routes) values('${player}','${club}',18,70,'single_18','[]');
      insert into public.round_holes(round_id,user_id,club_id,route_id,round_hole_number,route_position,physical_hole_number,par,stroke_index) select id,user_id,club_id,'${f.eighteen.id}',1,1,1,5,9 from public.rounds;`);
    const before=await dump([...live,'admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_physical_structures','admin_catalog_physical_holes','admin_catalog_physical_course_links','admin_catalog_foundation_events']);
    await db.exec('reset role');const policies=(await db.query('select * from pg_policies order by tablename,policyname')).rows;await db.exec(migration);await role();base=await dump(live);
    await t.test('one-shot additive migration changes no rows, policies, history, drafts, rounds or live data',async()=>{
      assert.deepEqual(await dump(Object.keys(before)),before);await db.exec('reset role');assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows,policies);
      await fail(()=>db.exec(migration),'42710');await db.exec('rollback');await role();
      assert.deepEqual(await dump(Object.keys(before)),before);
    });
    await t.test('RPCs and helpers deny player, anon, service role, absent identity and forged JWT role',async()=>{
      for(const args of [['anon','','anon'],['authenticated',player,'authenticated'],['service_role',admin,'service_role'],['authenticated','','authenticated'],['authenticated',admin,'service_role']]){
        await role(...args);
        await fail(()=>rpc('admin_catalog_physical18_preview',[f.s.id,f.link.id,'autonomous_18',f.eighteen.id,'inherited']),'42501');
        await fail(()=>rpc('admin_catalog_physical18_register',[f.s.id,f.link.id,'autonomous_18',f.eighteen.id,'inherited',{},'Note',true]),'42501');
        await fail(()=>rpc('admin_catalog_physical18_verify',[oldPreview.configuration.id,1,{},[],'Note',true]),'42501');
        if(args[0]==='authenticated')assert.equal((await db.query('select * from public.admin_catalog_playable_configurations')).rows.length,0);
        else await fail(()=>db.query('select * from public.admin_catalog_playable_configurations'),'42501');
      }
      await role();await fail(()=>rpc('admin_catalog_physical18_inspect',[f.s.id,f.link.id,null,null,null]),'42501');await fail(()=>rpc('admin_catalog_physical18_lock',[f.s.id,f.link.id,f.eighteen.id]),'42501');
      await fail(()=>db.exec('insert into public.admin_catalog_playable_configurations default values'),'42501');
    });
    await t.test('preview is read-only and requires explicit link, kind, source and Par provenance',async()=>{
      const before=await dump(['admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_foundation_events']);
      const empty=(await rpc('admin_catalog_physical18_preview',[f.s.id])).admin_catalog_physical18_preview;
      assert.equal(empty.can_register,false);assert.equal(empty.kind,null);assert.equal(empty.source_course_id,null);assert.equal(empty.par_selection,null);assert.deepEqual(empty.sequence,[]);
      for(const params of [[null,null,null],['autonomous_18',null,'inherited'],['front_9',f.front,null]])assert.equal((await preview(f,...params)).can_register,false);
      const c=await preview(f,'autonomous_18',f.eighteen,'inherited');assert.equal(c.can_register,true);assert.equal(c.sequence.length,18);
      assert.deepEqual(c.sequence.map(h=>h.stroke_index),si);assert.equal(c.sequence.reduce((s,h)=>s+h.effective_par,0),70);
      assert.deepEqual(await dump(Object.keys(before)),before);
    });
    await t.test('cardinality, interval, missing Par/SI, totals and unverified physical sources block registration',async()=>{
      assert.ok((await preview(pending,'autonomous_18',pending.eighteen,'inherited')).reasons.includes('verified_eighteen_source_required'));
      assert.ok((await preview(f,'autonomous_18',f.front,'inherited')).reasons.includes('wrong_cardinality_or_source'));
      assert.ok((await preview(f,'autonomous_18',other.eighteen,'inherited')).reasons.includes('wrong_cardinality_or_source'));
      const wrong=await preview(f,'back_9',f.front,'inherited');assert.ok(wrong.reasons.includes('par_mismatch'));await fail(()=>register(wrong),'23514');
      await db.exec('reset role');await db.query('update public.route_holes set stroke_index=null where route_id=$1 and physical_hole_number=1',[f.front.id]);await role();
      assert.ok((await preview(f,'front_9',f.front,'inherited')).reasons.includes('invalid_source_grid'));
      await db.exec('reset role');await db.query('update public.route_holes set stroke_index=$2 where route_id=$1 and physical_hole_number=1',[f.front.id,si[0]]);
      await db.query('update public.course_routes set total_par=36 where id=$1',[f.front.id]);await role();
      assert.ok((await preview(f,'front_9',f.front,'source')).reasons.includes('invalid_source_grid'));
      await db.exec('reset role');await db.query('update public.course_routes set total_par=35 where id=$1',[f.front.id]);await role();
      await db.exec('reset role');await fail(()=>db.query('update public.route_holes set par=null where route_id=$1 and physical_hole_number=1',[f.front.id]),'23502');
      await db.query('update public.route_holes set stroke_index=17 where route_id=$1 and physical_hole_number=1',[f.front.id]);await role();
      assert.ok((await preview(f,'front_9',f.front,'source')).reasons.includes('invalid_source_grid'));
      await db.exec('reset role');await db.query('update public.route_holes set stroke_index=9,physical_hole_number=10 where route_id=$1 and physical_hole_number=1',[f.front.id]);await role();
      const incomplete=await preview(f,'front_9',f.front,'inherited');assert.ok(incomplete.reasons.includes('invalid_source_grid'));assert.ok(incomplete.reasons.includes('incomplete_sequence'));
      await db.exec('reset role');await db.query('update public.route_holes set physical_hole_number=1 where route_id=$1 and physical_hole_number=10',[f.front.id]);
      const hole=(await db.query('select id from public.route_holes where route_id=$1 and physical_hole_number=1',[f.front.id])).rows[0];
      await db.query('update public.route_holes set physical_hole_number=2 where id=$1',[hole.id]);await role();
      const duplicate=await preview(f,'front_9',f.front,'inherited');assert.ok(duplicate.reasons.includes('invalid_source_grid'));await fail(()=>register(duplicate),'23514');
      await db.exec('reset role');await db.query('update public.route_holes set physical_hole_number=1 where id=$1',[hole.id]);await role();
      await fail(()=>preview(f,'offset_guess',f.front,'inherited'),'22023');await fail(()=>preview(f,'front_9',f.front,'implicit'),'22023');
      await fail(()=>rpc('admin_catalog_physical18_preview',[other.s.id,f.link.id,'front_9',f.front.id,'source']),'22023');
    });
    await t.test('explicit confirmation, note, baseline and verified autonomous parent are mandatory',async()=>{
      let c=await preview(f,'front_9',f.front,'source');assert.ok(c.reasons.includes('verified_parent_required'));await fail(()=>register(c),'23514');
      c=await preview(f,'autonomous_18',f.eighteen,'source');await fail(()=>register(c,{confirm:false}),'22023');await fail(()=>register(c,{note:' '}),'22023');await fail(()=>register(c,{baseline:{}}),'40001');
      registered18=await register(c);assert.equal(registered18.configuration.review_status,'needs_review');assert.equal(registered18.saved_holes.length,18);
      assert.ok(registered18.saved_holes.every((h,i)=>h.par_mode==='override'&&h.par_override===par[i]&&h.stroke_index===si[i]));
      assert.equal(registered18.events.length,19);await fail(()=>register(c),'23514');
      await fail(()=>verify(registered18,{revision:0}),'40001');await fail(()=>verify(registered18,{holes:[] }),'40001');await fail(()=>verify(registered18,{confirm:false}),'22023');await fail(()=>verify(registered18,{note:''}),'22023');
      verified18=await verify(registered18);assert.equal(verified18.configuration.review_status,'verified');assert.equal(verified18.configuration.revision,2);await fail(()=>verify(registered18),'40001');
    });
    await t.test('front/back link explicit physical intervals; copy each nine own SI exactly, not parent SI or +9',async()=>{
      const front=await preview(f,'front_9',f.front,'inherited');assert.equal(front.can_register,true);
      assert.deepEqual(front.sequence.map(h=>h.physical_number),[1,2,3,4,5,6,7,8,9]);assert.deepEqual(front.sequence.map(h=>h.stroke_index),si.slice(0,9));
      const vf=await verify(await register(front));assert.equal(vf.configuration.parent_configuration_id,verified18.configuration.id);assert.equal(vf.configuration.parent_configuration_revision,2);
      assert.equal(vf.sequence.reduce((s,h)=>s+h.effective_par,0),35);assert.ok(vf.saved_holes.every(h=>h.par_mode==='inherited'&&h.par_override===null));
      // Distinct source SI is deliberate and legal, even if it differs from the physical parent's SI.
      const ownSi=[18,16,14,12,10,8,6,4,2];await db.exec('reset role');for(let i=0;i<9;i++)await db.query('update public.route_holes set stroke_index=$3 where route_id=$1 and physical_hole_number=$2',[f.back.id,i+1,ownSi[i]]);await role();
      base=await dump(live);
      const back=await preview(f,'back_9',f.back,'source');assert.equal(back.can_register,true);assert.deepEqual(back.sequence.map(h=>h.physical_number),[10,11,12,13,14,15,16,17,18]);
      assert.deepEqual(back.sequence.map(h=>h.stroke_index),ownSi);assert.deepEqual(back.sequence.map(h=>h.source_number),[1,2,3,4,5,6,7,8,9]);
      registeredBack=await register(back);assert.equal(registeredBack.sequence.reduce((s,h)=>s+h.effective_par,0),35);
      assert.ok(registeredBack.saved_holes.every(h=>h.occurrence===1));assert.deepEqual(await dump(live),base);
    });
    await t.test('source mutation and stale source/revision cannot be verified or silently rebased',async()=>{
      const before=registeredBack;await db.exec('reset role');await db.query("update public.course_routes set source_payload='{}' where id=$1",[f.back.id]);await role();
      await fail(()=>verify(before),'40001');const c=await preview(f,'back_9',f.back,'source');assert.ok(c.reasons.includes('registration_base_changed'));await fail(()=>verify(c),'23514');
      await db.exec('reset role');await db.query('update public.course_routes set source_payload=$2 where id=$1',[f.back.id,f.back.source_payload]);await role();
      registeredBack=await verify(await preview(f,'back_9',f.back,'source'));
      await db.exec('reset role');await db.query('update public.route_holes set par=4 where route_id=$1 and physical_hole_number=1',[other.eighteen.id]);await role();
      const changed=await preview(other,'autonomous_18',other.eighteen,'inherited');assert.ok(changed.reasons.includes('physical_source_changed'));await fail(()=>register(changed),'23514');
      await db.exec('reset role');await db.query('update public.route_holes set par=5 where route_id=$1 and physical_hole_number=1',[other.eighteen.id]);await role();
      assert.deepEqual(await dump(live),base);
    });
    await t.test('generic APIs cannot alter a registered mapping, move slots or change provenance/parent',async()=>{
      const c=registeredBack.configuration,h=registeredBack.saved_holes[0];
      await fail(()=>rpc('admin_catalog_foundation_record_configuration_hole',[c.id,c.revision,h.position,1,h.physical_hole_id,'inherited',null,1,'stablr','fixture:bad','Bad',true,h.legacy_route_hole_id,null]),'22023');
      await fail(()=>rpc('admin_catalog_foundation_review_configuration',[c.id,c.revision,c.structure_id,'autonomous',null,null,'stablr','fixture:bad','Bad',false]),'55000');
      await fail(()=>rpc('admin_catalog_physical18_verify',[oldPreview.configuration.id,1,{},[],'Bad',true]),'22023');
    });
    await t.test('collisions with already used sources or independently linked configurations block, without name-based matching',async()=>{
      const c=await rpc('admin_catalog_foundation_create_configuration',[club,'Unrelated name fixture',9,'stablr','fixture:conflict','Manual',other.front.id,null]);
      const p=await preview(f,'front_9',other.front,'inherited');assert.ok(p.reasons.includes('configuration_collision'));assert.ok(c.id);
      await fail(()=>register(p),'23514');
    });
    await t.test('failure halfway through registration rolls back header, slots and append-only audit atomically',async()=>{
      const c=await preview(rollback,'autonomous_18',rollback.eighteen,'inherited');const before=await dump(['admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_foundation_events']);
      await db.exec(`reset role;create function public.fixture_reject_slot() returns trigger language plpgsql as $$begin if new.position=5 then raise exception 'Fixture failure' using errcode='23514';end if;return new;end$$;
        create trigger fixture_failure before insert on public.admin_catalog_configuration_holes for each row execute function public.fixture_reject_slot();`);await role();
      await fail(()=>register(c),'23514');assert.deepEqual(await dump(Object.keys(before)),before);
      await db.exec('reset role;drop trigger fixture_failure on public.admin_catalog_configuration_holes;drop function public.fixture_reject_slot()');await role();
    });
    await t.test('Phase 3b pending snapshot still verifies unchanged; new locks are NOWAIT and audit is immutable',async()=>{
      const c=oldPreview.configuration;const p=(await rpc('admin_catalog_playable_verify',[c.id,c.revision,oldPreview.baseline,oldPreview.saved_holes,'Still valid after Phase3c',true])).admin_catalog_playable_verify;
      assert.equal(p.configuration.review_status,'verified');assert.deepEqual(p.baseline,oldPreview.baseline);assert.deepEqual(p.saved_holes,oldPreview.saved_holes);
      assert.match(migration,/lock table public\.course_routes in share mode nowait/);assert.match(playable,/route_holes,public\.route_tees in share mode nowait/);assert.match(migration,/for update nowait/);
      await fail(()=>db.exec('delete from public.admin_catalog_foundation_events'),'42501');
      await db.exec('reset role');await fail(()=>db.exec("update public.admin_catalog_foundation_events set operation='UPDATE'"),'55000');await role();
      const events=(await db.query('select * from public.admin_catalog_foundation_events')).rows;assert.ok(events.every(e=>e.actor_id===admin));
    });
  }finally{await db.close();}
});
