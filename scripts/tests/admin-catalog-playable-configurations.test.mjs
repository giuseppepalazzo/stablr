// PostgreSQL/WASM, isolated fixtures only. Never connects to the production DB.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite }=await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const sql=(file)=>readFile(new URL(`../../supabase/${file}`,import.meta.url),'utf8');
const [schema,extension,workflow,foundation,physical,migration]=await Promise.all([
  'shared-catalog-schema.sql','fig-whs-extension.sql','admin-catalog-workflow.sql',
  'admin-catalog-physical-foundation.sql','admin-catalog-physical-course-links.sql',
  'admin-catalog-playable-configurations.sql'].map(sql));
const admin='11111111-1111-4111-8111-111111111111',player='22222222-2222-4222-8222-222222222222';
const club='33333333-3333-4333-8333-333333333333';
const protectedTables=['clubs','course_routes','route_holes','route_tees','route_combinations','route_combination_holes',
  'combination_tees','rounds','round_holes','admin_catalog_drafts','admin_catalog_versions',
  'admin_catalog_physical_structures','admin_catalog_physical_holes','admin_catalog_physical_course_links','admin_catalog_tee_overrides'];
test('Phase 3b explicit 9 / repeated 18, physical inheritance, configuration SI and isolated audit',async(t)=>{
  const db=new PGlite();
  const role=async(name='authenticated',uid=admin,claim=name)=>{
    await db.exec(`reset role;set role ${name}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,claim]);
  };
  const rpc=async(name,args=[])=> (await db.query(`select * from public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args)).rows[0];
  const preview=async(s,link=null,kind=null)=>(await rpc('admin_catalog_playable_preview',[s.id,link?.id||null,kind])).admin_catalog_playable_preview;
  const register=async(c,o={})=>(await rpc('admin_catalog_playable_register',[c.structure.id,c.source_link_id,c.kind,o.baseline ?? c.baseline,o.note ?? 'Manual fixture registration',o.confirm ?? true])).admin_catalog_playable_register;
  const verify=async(c,o={})=>(await rpc('admin_catalog_playable_verify',[c.configuration.id,o.revision ?? c.configuration.revision,o.baseline ?? c.baseline,o.holes ?? c.saved_holes,o.note ?? 'Manual fixture verification',o.confirm ?? true])).admin_catalog_playable_verify;
  const fail=(fn,code)=>assert.rejects(fn,error=>error.code===code);
  const dump=async(tables)=>{await db.exec('reset role');const rows={};for(const table of tables) rows[table]=(await db.query(`select to_jsonb(t) j from public.${table} t order by to_jsonb(t)::text`)).rows;await role();return rows;};
  const createSource=async(key,si=Array.from({length:9},(_,i)=>i*2+1),verified=true)=>{
    await db.exec('reset role');
    const c=(await db.query("insert into public.course_routes(club_id,name,holes_count,total_par,source_system,source_payload) values($1,$2,9,35,'stablr',$3) returning *",[club,`Source fixture ${key}`,{fixture_key:key,...(key==='pilot'?{tee_specific_hole_matrix:{physical_hole_count:9,source:'official fixture',tees:{giallo:{holes:[{physical_hole_number:1,par:5,stroke_indexes:[9,10],distances_m:[100,101]}]}}}}:{})}])).rows[0];
    for(let i=0;i<9;i++) await db.query('insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) values($1,$2,$3,$4)',[c.id,i+1,[4,4,3,4,4,5,4,3,4][i],si[i]]);
    await db.query("insert into public.route_tees(route_id,tee_name,tee_color,holes_count,course_rating,slope_rating) values($1,'Giallo','yellow',18,70,113)",[c.id]);
    await role();
    let s=await rpc('admin_catalog_foundation_create_structure',[club,`Structure fixture ${key}`,'stablr','fixture:source','Manual fixture']);
    s=await rpc('admin_catalog_foundation_review_structure',[s.id,s.revision,'fisico_9','stablr','fixture:source','Manual classification',true]);
    let p=(await rpc('admin_catalog_physical_course_preview',[s.id,c.id])).admin_catalog_physical_course_preview;
    p=(await rpc('admin_catalog_physical_course_register',[s.id,c.id,s.revision,p.source,'Manual fixture physical registration',true])).admin_catalog_physical_course_register;
    if(verified) p=(await rpc('admin_catalog_physical_course_verify',[p.link.id,p.link.revision,p.mapping,'Manual physical verification',true])).admin_catalog_physical_course_verify;
    return {s,c,link:p.link,physical:p};
  };
  let pilot,scale,missing,pending,rollback,collision,unclassified,base,oldConfig,oldSlot,registered9,verified9,registered18;
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key references auth.users,role text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
      insert into auth.users values('${admin}'),('${player}');insert into public.profiles values('${admin}','admin'),('${player}','user');`);
    for(const name of ['clubs','course_routes','route_holes','route_combinations','route_combination_holes','rounds','round_holes']) await db.exec(schema.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    for(const name of ['route_tees','combination_tees']) await db.exec(extension.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    await db.exec(`alter table public.clubs add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.course_routes add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.route_combinations add column source_system text,add column source_external_id text,add column source_payload jsonb;
      insert into public.clubs(id,name,name_normalized,created_by) values('${club}','Fixture club','fixture club','${admin}');`);
    await db.exec(workflow);await db.exec(foundation);await db.exec(physical);await role();
    pilot=await createSource('pilot');scale=await createSource('scale',Array.from({length:9},(_,i)=>i+1));
    missing=await createSource('missing',[null,3,5,7,9,11,13,15,17]);pending=await createSource('pending',undefined,false);
    rollback=await createSource('rollback');collision=await createSource('collision');
    unclassified=await rpc('admin_catalog_foundation_create_structure',[club,'Unclassified fixture','stablr','fixture:pending','Not yet classified']);
    oldConfig=await rpc('admin_catalog_foundation_create_configuration',[club,'Existing pending fixture',9,'stablr','fixture:old','Historical fixture',collision.c.id,null]);
    oldSlot=await rpc('admin_catalog_foundation_record_configuration_hole',[oldConfig.id,oldConfig.revision,1,1,null,null,null,null,'stablr','fixture:old','Pending fixture',false,null,null]);
    // An already persisted tee override stays separate, including when its
    // unresolved source configuration blocks registration rather than adoption.
    await db.exec('reset role');
    await db.query(`insert into public.admin_catalog_tee_overrides(configuration_id,configuration_hole_id,route_tee_id,par_override,stroke_index_override,source_system,source_reference,reason)
      select $1,$2,t.id,5,17,'stablr','fixture:old-override','Existing override fixture' from public.route_tees t where t.route_id=$3`,[oldConfig.id,oldSlot.id,collision.c.id]);await role();
    const draft=await rpc('admin_catalog_create_draft',['club',{name:'Existing draft'},club]);await db.exec('reset role');
    await db.query(`insert into public.admin_catalog_versions(entity_type,entity_key,live_entity_id,source_draft_id,version_number,schema_version,snapshot,published_by) values('club',$1,$2,$3,1,1,'{"name":"Existing version"}',$4)`,[draft.entity_key,club,draft.draft_id,admin]);
    await db.exec(`insert into public.rounds(user_id,club_id,holes_count,total_par,round_type,selected_routes) values('${player}','${club}',9,35,'single_9','[{"par":35}]');
      insert into public.round_holes(round_id,user_id,club_id,route_id,round_hole_number,route_position,physical_hole_number,par,stroke_index) select id,user_id,club_id,'${pilot.c.id}',1,1,1,4,1 from public.rounds;`);
    const policies=(await db.query('select * from pg_policies order by tablename,policyname')).rows;
    const grants=(await db.query("select * from information_schema.role_table_grants where table_schema='public' order by table_name,grantee,privilege_type")).rows;
    const functions=(await db.query("select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid")).rows;
    const before=await dump([...protectedTables,'admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_foundation_events']);
    await db.exec('reset role');await db.exec(migration);await role();base=await dump(protectedTables);

    await t.test('one-shot migration is additive; no backfill, new policies, changed grants, RPC redefinitions or old history rewrites',async()=>{
      const after=await dump(Object.keys(before));
      const configs=after.admin_catalog_playable_configurations.map(({j})=>{const {physical_source_link_id,registration_kind,registration_snapshot,...old}=j;assert.equal(physical_source_link_id,null);assert.equal(registration_kind,null);assert.equal(registration_snapshot,null);return {j:old};});
      assert.deepEqual({...after,admin_catalog_playable_configurations:configs},before);
      await db.exec('reset role');assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows,policies);
      assert.deepEqual((await db.query("select * from information_schema.role_table_grants where table_schema='public' order by table_name,grantee,privilege_type")).rows,grants);
      assert.deepEqual((await db.query('select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p where p.oid=any($1::oid[]) order by p.oid',[functions.map(f=>f.oid)])).rows,functions);await role();
    });
    await t.test('new RPCs and helpers reject anon, players, missing UID, wrong role and service API',async()=>{
      for(const args of [['anon','','anon'],['authenticated',player,'authenticated'],['service_role',admin,'service_role'],['authenticated','','authenticated'],['authenticated',admin,'anon']]){
        await role(...args);await fail(()=>rpc('admin_catalog_playable_preview',[pilot.s.id,pilot.link.id,'autonomous_9']),'42501');
        await fail(()=>rpc('admin_catalog_playable_register',[pilot.s.id,pilot.link.id,'autonomous_9',{},'note',true]),'42501');
        await fail(()=>rpc('admin_catalog_playable_verify',[oldConfig.id,1,{},[],'note',true]),'42501');
      }
      await role();await fail(()=>rpc('admin_catalog_playable_inspect',[pilot.s.id,pilot.link.id,'autonomous_9']),'42501');await fail(()=>rpc('admin_catalog_playable_lock',[pilot.s.id,pilot.link.id]),'42501');
      await fail(()=>db.query('insert into public.admin_catalog_playable_configurations default values'),'42501');
    });
    await t.test('preview has no implicit selection or writes and shows exact 9 and repeated 18 with separate tee evidence',async()=>{
      const before=await dump(['admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_foundation_events']);
      const empty=await preview(pilot.s);assert.equal(empty.source_link_id,null);assert.equal(empty.kind,null);assert.deepEqual(empty.sequence,[]);assert.equal(empty.can_register,false);
      const nine=await preview(pilot.s,pilot.link,'autonomous_9');assert.equal(nine.sequence.length,9);assert.equal(nine.can_register,true);
      assert.deepEqual(nine.sequence.map(h=>h.stroke_index),[1,3,5,7,9,11,13,15,17]);assert.ok(nine.sequence.every(h=>h.par_mode==='inherited'&&h.par_override===null));
      assert.equal(nine.sequence[0].effective_par,4);assert.equal(nine.tee_matrix.tees.giallo.holes[0].par,5);assert.equal(nine.sequence[0].stroke_index,1);
      const eighteen=await preview(pilot.s,pilot.link,'repeated_18');assert.equal(eighteen.sequence.length,18);assert.ok(eighteen.reasons.includes('verified_parent_required'));
      assert.deepEqual(eighteen.sequence.slice(9).map(h=>h.stroke_index),[2,4,6,8,10,12,14,16,18]);
      assert.deepEqual(await dump(['admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_foundation_events']),before);
    });
    await t.test('unverified physical source, wrong types, invalid SI and legacy collisions block explicitly',async()=>{
      assert.ok((await preview(unclassified)).reasons.includes('verified_nine_required'));
      const p=await preview(pending.s,pending.link,'autonomous_9');assert.ok(p.reasons.includes('verified_source_required'));await fail(()=>register(p),'23514');
      const invalid=await preview(missing.s,missing.link,'autonomous_9');assert.ok(invalid.reasons.includes('invalid_configuration_si'));assert.equal(invalid.sequence[0].stroke_index,null);await fail(()=>register(invalid),'23514');
      const dup=await preview(scale.s,scale.link,'repeated_18');assert.ok(dup.reasons.includes('invalid_configuration_si'));await fail(()=>register(dup),'23514');
      const coll=await preview(collision.s,collision.link,'autonomous_9');assert.ok(coll.reasons.includes('configuration_collision'));assert.equal(coll.tee_overrides.length,1);assert.equal(coll.tee_overrides[0].par_override,5);assert.equal(coll.sequence[0].effective_par,4);await fail(()=>register(coll),'23514');
      await fail(()=>preview(pilot.s,pilot.link,'inferred'),'22023');await fail(()=>preview(scale.s,pilot.link,'autonomous_9'),'22023');
    });
    await t.test('explicit confirmation, note and exact baseline/revisions are mandatory before atomic registration',async()=>{
      const p=await preview(pilot.s,pilot.link,'autonomous_9');
      await fail(()=>register(p,{confirm:false}),'22023');await fail(()=>register(p,{note:' '}),'22023');
      await fail(()=>register(p,{baseline:{...p.baseline,structure:{...p.structure,revision:0}}}),'40001');
      await fail(()=>register(p,{baseline:{...p.baseline,physical_mapping:[]}}),'40001');
      registered9=await register(p);assert.equal(registered9.configuration.review_status,'needs_review');assert.equal(registered9.configuration.revision,1);
      assert.equal(registered9.saved_holes.length,9);assert.ok(registered9.saved_holes.every(h=>h.review_status==='verified'&&h.par_mode==='inherited'&&h.par_override===null));
      assert.equal(registered9.events.length,10);assert.ok(registered9.events.every(e=>e.actor_id===admin));assert.equal(registered9.can_verify,true);
      await fail(()=>register(p),'23514');assert.deepEqual(await dump(protectedTables),base);
    });
    await t.test('verification needs second confirmation, exact slots and CAS; derived requires a verified parent',async()=>{
      const p=await preview(pilot.s,pilot.link,'repeated_18');await fail(()=>register(p),'23514');
      await fail(()=>verify(registered9,{confirm:false}),'22023');await fail(()=>verify(registered9,{note:''}),'22023');
      await fail(()=>verify(registered9,{revision:0}),'40001');await fail(()=>verify(registered9,{holes:[...registered9.saved_holes].reverse()}),'40001');
      verified9=await verify(registered9);assert.equal(verified9.configuration.review_status,'verified');assert.equal(verified9.configuration.revision,2);
      await fail(()=>verify(registered9),'40001');await fail(()=>verify(verified9),'23514');
    });
    await t.test('derived registration repeats the exact nine physical IDs, inherited Par and base/+1 SI with explicit parent revision',async()=>{
      const p=await preview(pilot.s,pilot.link,'repeated_18');assert.equal(p.can_register,true);registered18=await register(p);
      const c=registered18.configuration;assert.equal(c.holes_count,18);assert.equal(c.relationship_kind,'derived');assert.equal(c.parent_configuration_id,verified9.configuration.id);assert.equal(c.parent_configuration_revision,2);
      assert.deepEqual(registered18.sequence.slice(0,9).map(h=>h.physical_hole_id),registered18.sequence.slice(9).map(h=>h.physical_hole_id));
      assert.deepEqual(registered18.saved_holes.map(h=>h.occurrence),[...Array(9).fill(1),...Array(9).fill(2)]);
      assert.equal(new Set(registered18.saved_holes.map(h=>h.stroke_index)).size,18);
      assert.ok(registered18.saved_holes.every(h=>h.par_override===null&&h.par_mode==='inherited'));
      assert.equal(registered18.sequence.reduce((sum,h)=>sum+h.effective_par,0),70);
      assert.deepEqual(await dump(protectedTables),base);
    });
    await t.test('old generic slot/review APIs cannot mutate or silently rebase registered configurations',async()=>{
      const c=registered18.configuration,h=registered18.saved_holes[0];
      await fail(()=>rpc('admin_catalog_foundation_record_configuration_hole',[c.id,c.revision,h.position,h.occurrence,h.physical_hole_id,'override',5,18,'stablr','fixture:bad','Attempted override',true,h.legacy_route_hole_id,null]),'23514');
      await fail(()=>rpc('admin_catalog_foundation_review_configuration',[c.id,c.revision,c.structure_id,'autonomous',null,null,'stablr','fixture:bad','Attempted rebase',false]),'55000');
      const p=await preview(pilot.s,pilot.link,'repeated_18');assert.deepEqual(p.saved_holes,registered18.saved_holes);assert.equal(p.configuration.revision,1);
    });
    await t.test('source metadata, SI/Par and tee changes invalidate preview and registered base without flattening overrides',async()=>{
      const p=await preview(pilot.s,pilot.link,'repeated_18');await db.exec('reset role');
      await db.query("update public.route_tees set course_rating=71 where route_id=$1",[pilot.c.id]);await role();
      await fail(()=>verify(p),'40001');const changed=await preview(pilot.s,pilot.link,'repeated_18');assert.ok(changed.reasons.includes('registration_base_changed'));await fail(()=>verify(changed),'23514');
      await db.exec('reset role');await db.query('update public.route_tees set course_rating=70 where route_id=$1',[pilot.c.id]);
      await db.query('update public.route_holes set par=5 where route_id=$1 and physical_hole_number=1',[pilot.c.id]);await role();
      const par=await preview(pilot.s,pilot.link,'repeated_18');assert.ok(par.reasons.includes('physical_source_changed'));await fail(()=>verify(par),'23514');
      await db.exec('reset role');await db.query('update public.route_holes set par=4 where route_id=$1 and physical_hole_number=1',[pilot.c.id]);
      await db.query("update public.course_routes set source_payload=jsonb_set(source_payload,'{fixture_key}','\"changed\"'::jsonb) where id=$1",[pilot.c.id]);await role();
      const metadata=await preview(pilot.s,pilot.link,'repeated_18');assert.ok(metadata.reasons.includes('physical_source_changed'));await fail(()=>verify(metadata),'23514');
      await db.exec('reset role');await db.query('update public.course_routes set source_payload=$2 where id=$1',[pilot.c.id,pilot.c.source_payload]);
      await db.query('update public.route_holes set physical_hole_number=10 where route_id=$1 and physical_hole_number=1',[pilot.c.id]);await role();
      const numbering=await preview(pilot.s,pilot.link,'repeated_18');assert.ok(numbering.reasons.includes('physical_source_changed'));await fail(()=>verify(numbering),'23514');
      await db.exec('reset role');await db.query('update public.route_holes set physical_hole_number=1 where route_id=$1 and physical_hole_number=10',[pilot.c.id]);
      await db.query('update public.route_holes set stroke_index=2 where route_id=$1 and physical_hole_number=1',[pilot.c.id]);await role();
      const si=await preview(pilot.s,pilot.link,'repeated_18');assert.ok(si.reasons.includes('physical_source_changed'));assert.ok(si.reasons.includes('invalid_configuration_si'));await fail(()=>verify(si),'23514');
      await db.exec('reset role');await db.query('update public.route_holes set stroke_index=1 where route_id=$1 and physical_hole_number=1',[pilot.c.id]);await role();
      const done=await verify(await preview(pilot.s,pilot.link,'repeated_18'));assert.equal(done.configuration.review_status,'verified');assert.equal(done.saved_holes.length,18);
      assert.deepEqual(await dump(protectedTables),base);
    });
    await t.test('audit failures roll back whole registration and verification, including all slots and review revision',async()=>{
      const p=await preview(rollback.s,rollback.link,'autonomous_9');const before=await dump(['admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_foundation_events']);
      await db.exec('reset role');await db.exec(`create function public.fixture_fail_playable_audit() returns trigger language plpgsql as $$begin if new.entity_table='admin_catalog_configuration_holes' and (new.after_snapshot->>'position')::integer=5 then raise exception 'Fixture audit error' using errcode='23514';end if;return new;end$$;
        create trigger fixture_playable_audit_fail before insert on public.admin_catalog_foundation_events for each row execute function public.fixture_fail_playable_audit();`);
      await role();await fail(()=>register(p),'23514');assert.deepEqual(await dump(['admin_catalog_playable_configurations','admin_catalog_configuration_holes','admin_catalog_foundation_events']),before);
      await db.exec('reset role');await db.exec('drop trigger fixture_playable_audit_fail on public.admin_catalog_foundation_events');await role();
      const saved=await register(p);await db.exec('reset role');await db.exec(`create function public.fixture_fail_playable_verify() returns trigger language plpgsql as $$begin if new.entity_table='admin_catalog_playable_configurations' and new.operation='UPDATE' then raise exception 'Fixture verify audit error' using errcode='23514';end if;return new;end$$;
        create trigger fixture_playable_verify_fail before insert on public.admin_catalog_foundation_events for each row execute function public.fixture_fail_playable_verify();`);
      await role();await fail(()=>verify(saved),'23514');const still=await preview(rollback.s,rollback.link,'autonomous_9');assert.equal(still.configuration.review_status,'needs_review');assert.equal(still.configuration.revision,1);
      await db.exec('reset role');await db.exec('drop trigger fixture_playable_verify_fail on public.admin_catalog_foundation_events');await role();
    });
    await t.test('race-style repeated requests allow one registration and one verified revision only',async()=>{
      const p=await preview(scale.s,scale.link,'autonomous_9');const results=await Promise.allSettled([register(p),register(p)]);
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);const saved=results.find(x=>x.status==='fulfilled').value;
      const reviews=await Promise.allSettled([verify(saved),verify(saved)]);assert.equal(reviews.filter(x=>x.status==='fulfilled').length,1);
    });
    await t.test('RLS hides populated configurations from player and anon; history cannot be rewritten or removed',async()=>{
      await role('authenticated',player);assert.equal((await db.query('select count(*)::int n from public.admin_catalog_playable_configurations')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from public.admin_catalog_configuration_holes')).rows[0].n,0);
      await role('anon');await fail(()=>db.query('select * from public.admin_catalog_playable_configurations'),'42501');await role();
      await fail(()=>db.exec('delete from public.admin_catalog_configuration_holes'),'42501');await db.exec('reset role');
      await fail(()=>db.exec('delete from public.admin_catalog_configuration_holes'),'55000');await fail(()=>db.exec("update public.admin_catalog_foundation_events set operation='UPDATE'"),'55000');await role();
    });
    await t.test('preexisting proposals remain usable, live/dependencies unchanged and repeated application fails atomically',async()=>{
      const current=(await db.query('select * from public.admin_catalog_playable_configurations where id=$1',[oldConfig.id])).rows[0];
      const changed=await rpc('admin_catalog_foundation_record_configuration_hole',[current.id,current.revision,oldSlot.position,1,null,null,null,3,'stablr','fixture:old','Manual old proposal',false,null,null]);assert.equal(changed.stroke_index,3);
      assert.deepEqual(await dump(protectedTables),base);await db.exec('reset role');await fail(()=>db.exec(migration),'42701');await db.exec('rollback');await role();
      assert.equal((await preview(pilot.s,pilot.link,'repeated_18')).configuration.review_status,'verified');assert.deepEqual(await dump(protectedTables),base);
    });
  }finally{await db.close();}
});
