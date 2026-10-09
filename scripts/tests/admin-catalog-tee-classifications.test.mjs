// Isolated PostgreSQL/WASM fixtures only. Never connects to a remote database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const sql = (name) => readFile(new URL('../../supabase/' + name, import.meta.url), 'utf8');
const schema = await sql('shared-catalog-schema.sql'), extension = await sql('fig-whs-extension.sql');
const migration = await sql('admin-catalog-tee-classifications.sql');
const prerequisites = await Promise.all(['admin-catalog-workflow.sql','admin-club-editor.sql','admin-course-editor.sql',
  'admin-catalog-abandon-draft.sql','admin-route-editor.sql','admin-hole-grid-editor.sql','admin-course-hole-grid-editor.sql','admin-course-tee-editor.sql',
  'admin-catalog-physical-foundation.sql','admin-catalog-physical-course-links.sql','admin-catalog-playable-configurations.sql',
  'admin-catalog-physical-18-configurations.sql','admin-catalog-structure-club-lock.sql','admin-catalog-multi9.sql',
  'admin-catalog-multi9-club-proposals.sql','admin-catalog-multi9-preview-repair.sql','admin-catalog-data-origin.sql'].map(sql));
const parco = JSON.parse(await readFile(new URL('./fixtures/parco-de-medici-multi9-preview.json', import.meta.url), 'utf8'));
const admin = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', player = '33333333-3333-4333-8333-333333333333';
test('isolated tee Par classifications: narrow decisions, exact derivation and append-only audit', async (t) => {
  const db = new PGlite();
  const role = async (name='authenticated',uid=admin,claim=name) => { await db.exec('reset role;set role '+name); await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,claim]); };
  const rpc = async (name,args=[]) => (await db.query(`select public.admin_catalog_tee_classification_${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
  const foundation = async (name,args=[]) => {
    const row=(await db.query(`select * from public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args)).rows[0];
    return row[name] ?? row;
  };
  const failure = (f,code) => assert.rejects(f,e=>e.code===code);
  const insert = async (table,rows) => { await db.exec('reset role'); for(const r of rows){ const k=Object.keys(r);await db.query(`insert into public.${table}(${k.join(',')}) values(${k.map((_,i)=>'$'+(i+1)).join(',')})`,k.map(x=>r[x])); } await role(); };
  const dump = async (excludeNew=false) => { await db.exec('reset role');const out={};for(const {tablename} of (await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows){if(excludeNew&&tablename.startsWith('admin_catalog_tee_classification'))continue;out[tablename]=(await db.query(`select to_jsonb(t) v from public.${tablename} t order by to_jsonb(t)::text`)).rows;}await role();return out; };
  const unknown = (overrides={}) => ({attestation:'sconosciuto',par_behavior:'sconosciuto',provenance:'unknown',
    evidence:{kind:'none',reference:'',par_total:null,holes_count:null,applicability:null},note:'Explicit test-only decision',
    configuration_id:null,derivation_rule:null,declared_holes_count:9,declared_applicability:null,...overrides});
  const attested = (kind='curato',overrides={}) => unknown({attestation:kind,par_behavior:'richiede_revisione',provenance:'stablr',
    evidence:{kind:kind==='certificato'?'document':'admin_review',reference:'Fixture targeted evidence',par_total:35,holes_count:9,applicability:null},...overrides});
  const preview = (tee,decision,revision=0) => rpc('preview',[tee.club_id,tee.kind,tee.id,decision,revision]);
  const confirm = (p,changes={}) => rpc('confirm',[p.club_id,p.entity_type,p.tee_id,changes.decision??p.decision,changes.revision??p.revision,changes.baseline??p.baseline,changes.confirm??true]);
  let club,course,tee,nine,eighteen,second,combinationTee,combinationConfig;
  try {
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key references auth.users,role text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;grant usage on schema auth to anon,authenticated,service_role;create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;");
    await db.query('insert into auth.users values($1),($2),($3)',[admin,other,player]);await db.query("insert into public.profiles values($1,'admin'),($2,'admin'),($3,'user')",[admin,other,player]);
    for(const name of ['clubs','course_routes','route_holes','route_combinations','route_combination_holes','rounds','round_holes'])await db.exec(schema.match(new RegExp('create table public\\.'+name+' \\([\\s\\S]*?\\n\\);'))[0]);
    for(const name of ['route_tees','combination_tees'])await db.exec(extension.match(new RegExp('create table if not exists public\\.'+name+' \\([\\s\\S]*?\\n\\);'))[0]);
    for(const name of ['clubs','course_routes','route_combinations'])await db.exec('alter table public.'+name+' add column source_system text,add column source_external_id text,add column source_payload jsonb');
    for(const p of prerequisites)await db.exec(p);
    club=(await db.query("insert into public.clubs(name,name_normalized,created_by) values('Mare-shaped fixture','fixture',$1) returning *",[admin])).rows[0];
    course=(await db.query("insert into public.course_routes(club_id,name,holes_count,total_par,source_system) values($1,'Physical nine fixture',9,35,'stablr') returning *",[club.id])).rows[0];
    const pars=[4,4,4,4,4,4,3,4,4],si=[11,17,1,7,9,5,3,13,15];
    for(let i=0;i<9;i++)await db.query('insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) values($1,$2,$3,$4)',[course.id,i+1,pars[i],si[i]]);
    tee=(await db.query("insert into public.route_tees(route_id,tee_name,holes_count,par_total,course_rating,slope_rating,source_system,source_payload) values($1,'Yellow fixture',9,35,34.8,125,'fig','{\"secret\":\"PRIVATE_FIXTURE\"}') returning *",[course.id])).rows[0];tee={...tee,kind:'route_tee',club_id:club.id};
    second=(await db.query("insert into public.route_tees(route_id,tee_name,holes_count,par_total) values($1,'Repeated fixture',18,70) returning *",[course.id])).rows[0];second={...second,kind:'route_tee',club_id:club.id};
    await role();let s=await foundation('admin_catalog_foundation_create_structure',[club.id,'Physical fixture','stablr','Fixture explicit evidence','Manual fixture']);
    s=await foundation('admin_catalog_foundation_review_structure',[s.id,s.revision,'fisico_9','stablr','Fixture explicit evidence','Manual fixture',true]);
    let p=await foundation('admin_catalog_physical_course_preview',[s.id,course.id]);p=await foundation('admin_catalog_physical_course_register',[s.id,course.id,s.revision,p.source,'Manual fixture',true]);
    p=await foundation('admin_catalog_physical_course_verify',[p.link.id,p.link.revision,p.mapping,'Manual fixture',true]);
    for(const kind of ['autonomous_9','repeated_18']){let c=await foundation('admin_catalog_playable_preview',[s.id,p.link.id,kind]);c=await foundation('admin_catalog_playable_register',[s.id,p.link.id,kind,c.baseline,'Manual fixture',true]);c=await foundation('admin_catalog_playable_verify',[c.configuration.id,c.configuration.revision,c.baseline,c.saved_holes,'Manual fixture',true]);if(kind==='autonomous_9')nine=c.configuration;else eighteen=c.configuration;}
    await insert('clubs',[{...parco.club,created_by:admin}]);await insert('course_routes',parco.routes);await insert('route_holes',parco.holes);await insert('route_combinations',parco.combinations);await insert('route_combination_holes',parco.slots);
    const proposal=await foundation('admin_catalog_multi9_club_preview',[parco.club.id]);await foundation('admin_catalog_multi9_batch_register',[[proposal],'Explicit local fixture',true]);
    await db.exec('reset role');combinationTee=(await db.query("insert into public.combination_tees(route_combination_id,tee_name,par_total,holes_count) values($1,'Combination fixture',72,18) returning *",[parco.combinations[0].id])).rows[0];
    combinationTee={...combinationTee,kind:'combination_tee',club_id:parco.club.id};combinationConfig=(await db.query('select * from public.admin_catalog_playable_configurations where legacy_combination_id=$1',[parco.combinations[0].id])).rows[0];await role();
    await t.test('one-shot additive migration: no backfill, live FK, old policy/trigger/function changes or rows',async()=>{
      const before=await dump();await db.exec('reset role');const old=(await db.query("select 'policy' kind,tablename||policyname item from pg_policies union all select 'trigger',pg_get_triggerdef(oid) from pg_trigger where not tgisinternal order by kind,item")).rows;
      await db.exec(migration);const after=(await db.query("select 'policy' kind,tablename||policyname item from pg_policies where tablename not like 'admin_catalog_tee_classification%' union all select 'trigger',pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not tgisinternal and c.relname not like 'admin_catalog_tee_classification%' order by kind,item")).rows;assert.deepEqual(after,old);assert.deepEqual(await dump(true),before);
      await db.exec('reset role');const fks=(await db.query("select confrelid::regclass::text target from pg_constraint where contype='f' and conrelid in ('public.admin_catalog_tee_classifications'::regclass,'public.admin_catalog_tee_classification_events'::regclass)")).rows;assert.ok(fks.every(f=>['auth.users','admin_catalog_tee_classifications'].includes(f.target)));
      await failure(()=>db.exec(migration),'42P07');await db.exec('rollback');await role();
    });
    await t.test('anon/player/service/missing UID/forged role cannot use any RPC/helper or write tables',async()=>{
      for(const args of [['anon',''],['authenticated',player],['service_role',admin],['service_role',admin,'authenticated'],['authenticated',''],['authenticated',admin,'service_role']]){
        await role(...args);for(const [name,a] of [['list',[club.id]],['detail',[club.id,tee.kind,tee.id]],['preview',[club.id,tee.kind,tee.id,unknown(),0]],['confirm',[club.id,tee.kind,tee.id,unknown(),0,{},true]]])await failure(()=>rpc(name,a),'42501');
        await failure(()=>rpc('context',[club.id,tee.kind,tee.id,null]),'42501');await failure(()=>db.exec('insert into public.admin_catalog_tee_classifications default values'),'42501');
        if(args[0]==='authenticated')assert.equal((await db.query('select * from public.admin_catalog_tee_classifications')).rows.length,0);
        else await failure(()=>db.query('select * from public.admin_catalog_tee_classification_events'),'42501');
      }await role();await failure(()=>db.exec('insert into public.admin_catalog_tee_classifications default values'),'42501');
    });
    await t.test('list/detail/preview are read-only; FIG/equal/name/color never create or propose a classification',async()=>{
      const before=await dump();await db.exec('begin read only');const list=await rpc('list',[club.id]);assert.equal(list.items.length,2);assert.ok(list.items.every(i=>i.attestation==='sconosciuto'&&i.par_behavior==='sconosciuto'));
      const d=await rpc('detail',[club.id,tee.kind,tee.id]);assert.equal(d.classification,null);assert.equal(d.revision,0);assert.equal(d.state,'unclassified');await preview(tee,unknown());await db.exec('commit');assert.deepEqual(await dump(),before);
      const text=JSON.stringify(d);assert.ok(!text.includes('PRIVATE_FIXTURE'));assert.ok(!text.includes('source_payload'));assert.ok(!text.includes('snapshot'));assert.ok(!text.includes(admin));
      await failure(()=>rpc('detail',[parco.club.id,tee.kind,tee.id]),'22023');
    });
    await t.test('allowlist, mandatory note, scope/applicability and tee-specific document reject weak certification',async()=>{
      for(const d of [unknown({note:' '}),unknown({source_payload:{secret:true}}),unknown({declared_holes_count:18}),unknown({declared_holes_count:'9'}),attested('certificato',{provenance:'unknown'}),attested('certificato',{evidence:{kind:'document',reference:'FIG generic',par_total:36,holes_count:9,applicability:null}}),attested('certificato',{evidence:{kind:'document',reference:'FIG generic',par_total:35,holes_count:null,applicability:null}})])await assert.rejects(()=>preview(tee,d));
      await failure(()=>preview(tee,unknown({configuration_id:nine.id,derivation_rule:'sum_configuration_effective_par'})),'23514');
      const p=await preview(tee,attested('certificato'));const saved=await confirm(p);assert.equal(saved.classification.attestation,'certificato');assert.equal(saved.history.length,1);assert.equal(saved.revision,1);
      assert.equal(saved.classification.evidence.reference,'Fixture targeted evidence');assert.ok(!JSON.stringify(saved).includes('PRIVATE_FIXTURE'));
    });
    await t.test('two Admins: CAS, explicit confirmation, exact preview baseline and duplicate confirmation',async()=>{
      const p=await preview(tee,attested(),1);await failure(()=>confirm(p,{confirm:false}),'22023');
      await role('authenticated',other);const q=await preview(tee,attested('curato',{note:'Second Admin decision'}),1);const saved=await confirm(q);assert.equal(saved.revision,2);assert.equal(saved.history[0].actor_current_admin,true);await role();
      await failure(()=>confirm(p),'40001');await failure(()=>confirm(q),'40001');const fresh=await preview(tee,attested(),2);
      await failure(()=>confirm(fresh,{baseline:{...fresh.baseline,par_total:99}}),'40001');
      assert.equal((await rpc('detail',[club.id,tee.kind,tee.id])).history[0].actor_current_admin,false);
    });
    await t.test('derived 9 and repeated 18 require verified exact configuration + explicit rule',async()=>{
      const derived=(cfg,scope=9)=>unknown({par_behavior:'derivato',configuration_id:cfg.id,derivation_rule:'sum_configuration_effective_par',declared_holes_count:scope});
      await failure(()=>preview(tee,derived(eighteen),2),'23514');await failure(()=>preview(tee,{...derived(nine),derivation_rule:'same_par'} ,2),'23514');
      const p=await preview(tee,derived(nine),2);assert.equal(p.configuration.total_par,35);await confirm(p);
      const r=await preview(second,derived(eighteen,18));assert.equal(r.configuration.total_par,70);await confirm(r);
      await failure(()=>preview(combinationTee,derived(nine,18)),'22023');
      const c=await preview(combinationTee,derived(combinationConfig,18));assert.equal(c.configuration.total_par,72);await confirm(c);
    });
    await t.test('NULL live Par/scope/applicability remain untouched and require manual declared scope',async()=>{
      await db.exec('reset role');
      const missing=(await db.query("insert into public.route_tees(route_id,tee_name,par_total,holes_count,gender) values($1,'Incomplete historical fixture',null,null,null) returning id",[course.id])).rows[0];
      await role();const target={...missing,kind:'route_tee',club_id:club.id};
      const d=await rpc('detail',[club.id,target.kind,target.id]);assert.equal(d.tee.holes_count,null);assert.equal(d.tee.applicability,null);assert.equal(d.tee.par_total,null);
      await failure(()=>preview(target,unknown({declared_holes_count:null})),'22023');
      await failure(()=>preview(target,attested('certificato',{evidence:{kind:'document',reference:'Specific fixture',par_total:null,holes_count:9,applicability:null}})),'23514');
      const p=await preview(target,attested('curato',{evidence:{kind:'admin_review',reference:'Admin decision on missing Par',par_total:null,holes_count:9,applicability:null}}));
      const saved=await confirm(p);assert.equal(saved.state,'current');assert.equal(saved.tee.par_total,null);assert.equal(saved.tee.holes_count,null);assert.equal(saved.tee.applicability,null);
      await db.exec('reset role');await db.query("update public.route_tees set gender='women' where id=$1",[target.id]);await role();
      await failure(()=>preview(target,unknown(),1),'23514');
      assert.equal((await preview(target,unknown({declared_applicability:'women'}),1)).decision.declared_applicability,'women');
    });
    await t.test('normalized Par overrides are never flattened or changed by derivation',async()=>{
      await db.exec('reset role');
      const slot=(await db.query('select id from public.admin_catalog_configuration_holes where configuration_id=$1 order by position limit 1',[nine.id])).rows[0];
      await db.query("insert into public.admin_catalog_tee_overrides(configuration_id,configuration_hole_id,route_tee_id,par_override,source_system,source_reference,reason) values($1,$2,$3,5,'stablr','Explicit fixture override','Fixture only')",[nine.id,slot.id,tee.id]);await role();
      const before=await dump(true),d=await rpc('detail',[club.id,tee.kind,tee.id]);assert.equal(d.state,'obsolete');assert.equal(d.baseline.tee_par_override_present,true);
      await failure(()=>preview(tee,unknown({par_behavior:'derivato',configuration_id:nine.id,derivation_rule:'sum_configuration_effective_par'}),d.revision),'23514');
      await preview(tee,unknown(),d.revision);assert.deepEqual(await dump(true),before);
    });
    await t.test('source changes make classification obsolete; reconfirmation cannot silently bypass unverified matrix/override',async()=>{
      const before=await preview(second,unknown({declared_holes_count:18}),1);
      await db.exec('reset role');await db.query('update public.route_tees set slope_rating=126 where id=$1',[second.id]);await role();
      await failure(()=>confirm(before),'40001');const d=await rpc('detail',[club.id,second.kind,second.id]);assert.equal(d.state,'obsolete');assert.equal(d.effective_behavior,'sconosciuto');
      await db.exec('reset role');await db.query("update public.course_routes set source_payload='{\"tee_specific_hole_matrix\":{\"secret\":\"PRIVATE_FIXTURE\"}}' where id=$1",[course.id]);await role();
      await failure(()=>preview(second,unknown({par_behavior:'derivato',configuration_id:eighteen.id,derivation_rule:'sum_configuration_effective_par',declared_holes_count:18}),1),'23514');
      assert.ok(!JSON.stringify(await rpc('detail',[club.id,second.kind,second.id])).includes('PRIVATE_FIXTURE'));
      await db.exec('reset role');await db.query('update public.course_routes set source_payload=null where id=$1',[course.id]);await db.query('update public.route_tees set slope_rating=null where id=$1',[second.id]);await role();
    });
    await t.test('a source matrix on a multi-9 component cannot be associated by tee name or color',async()=>{
      const routeId=parco.combinations[0].front_route_id;
      await db.exec('reset role');const original=(await db.query('select source_payload from public.course_routes where id=$1',[routeId])).rows[0].source_payload;
      await db.query("update public.course_routes set source_payload=coalesce(source_payload,'{}')||'{\"tee_specific_hole_matrix\":{\"tees\":{\"yellow\":{\"secret\":\"PRIVATE_MATRIX\"}}}}' where id=$1",[routeId]);await role();
      const d=await rpc('detail',[parco.club.id,combinationTee.kind,combinationTee.id]);assert.equal(d.state,'obsolete');assert.equal(d.baseline.tee_matrix_present,true);assert.ok(!JSON.stringify(d).includes('PRIVATE_MATRIX'));
      await failure(()=>preview(combinationTee,unknown({par_behavior:'derivato',configuration_id:combinationConfig.id,derivation_rule:'sum_configuration_effective_par',declared_holes_count:18}),1),'23514');
      await db.exec('reset role');await db.query('update public.course_routes set source_payload=$1 where id=$2',[original,routeId]);await role();
    });
    await t.test('removed UUID is obsolete; import recreation neither blocked nor inherits classification',async()=>{
      await db.exec('reset role');await db.query('delete from public.combination_tees where id=$1',[combinationTee.id]);const fresh=(await db.query("insert into public.combination_tees(route_combination_id,tee_name,holes_count,par_total) values($1,'Combination fixture',18,72) returning id",[combinationTee.route_combination_id])).rows[0];await role();
      const old=await rpc('detail',[parco.club.id,combinationTee.kind,combinationTee.id]);assert.equal(old.state,'target_missing');assert.equal(old.history.length,1);assert.equal(old.effective_attestation,'sconosciuto');
      const current=await rpc('detail',[parco.club.id,combinationTee.kind,fresh.id]);assert.equal(current.state,'unclassified');assert.equal(current.classification,null);
      const list=await rpc('list',[parco.club.id]);assert.equal(list.items.length,2);assert.equal(list.items.filter(i=>i.state==='target_missing').length,1);
    });
    await t.test('audit append-only and failure rolls back classification atomically; all other tables unchanged',async()=>{
      const before=await dump(true),d=await rpc('detail',[club.id,tee.kind,tee.id]),p=await preview(tee,attested(),d.revision);
      await db.exec("reset role;create function public.reject_classification_audit_fixture() returns trigger language plpgsql as $$begin raise exception 'fixture audit failure';end$$;create trigger reject_classification_audit_fixture before insert on public.admin_catalog_tee_classification_events for each row execute function public.reject_classification_audit_fixture();");await role();
      await assert.rejects(()=>confirm(p));assert.equal((await rpc('detail',[club.id,tee.kind,tee.id])).revision,d.revision);assert.deepEqual(await dump(true),before);
      await db.exec('reset role;drop trigger reject_classification_audit_fixture on public.admin_catalog_tee_classification_events;drop function public.reject_classification_audit_fixture();');await role();await confirm(p);assert.deepEqual(await dump(true),before);
      await db.exec('reset role');await failure(()=>db.exec('update public.admin_catalog_tee_classification_events set revision=99'),'55000');await failure(()=>db.exec('delete from public.admin_catalog_tee_classifications'),'55000');await failure(()=>db.exec('truncate public.admin_catalog_tee_classification_events'),'55000');await role();
      const history=(await rpc('detail',[club.id,tee.kind,tee.id])).history;assert.ok(history.every(e=>!('baseline' in e.after)&&!('source_payload' in e.after)));
      await role('authenticated',player);assert.equal((await db.query('select * from public.admin_catalog_tee_classifications')).rows.length,0);assert.equal((await db.query('select * from public.admin_catalog_tee_classification_events')).rows.length,0);await role();
      await db.exec('reset role');
      const f=(await db.query("select prosrc,prosecdef,proconfig from pg_proc where oid='public.admin_catalog_tee_classification_confirm(uuid,text,uuid,jsonb,bigint,jsonb,boolean)'::regprocedure")).rows[0];
      assert.equal(f.prosecdef,true);assert.deepEqual(f.proconfig,['search_path=pg_catalog']);assert.match(f.prosrc,/in share mode nowait/i);assert.match(f.prosrc,/for update nowait/i);assert.match(f.prosrc,/admin_catalog_structure_club_lock/);
      await role();
    });
  } finally { await db.close(); }
});
