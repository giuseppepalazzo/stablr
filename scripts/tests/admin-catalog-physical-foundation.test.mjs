// PostgreSQL/WASM only. Every identity and row below is an isolated fixture.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const readSql = (name) => readFile(new URL(`../../supabase/${name}`, import.meta.url), 'utf8');
const schema = await readSql('shared-catalog-schema.sql');
const extension = await readSql('fig-whs-extension.sql');
const migration = await readSql('admin-catalog-physical-foundation.sql');
const prior = await Promise.all(['admin-catalog-workflow.sql','admin-club-editor.sql','admin-course-editor.sql',
  'admin-catalog-abandon-draft.sql','admin-route-editor.sql','admin-hole-grid-editor.sql',
  'admin-course-hole-grid-editor.sql','admin-course-tee-editor.sql'].map(readSql));
const admin = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const player = '33333333-3333-4333-8333-333333333333', club = '44444444-4444-4444-8444-444444444444';
const foreignClub = '55555555-5555-4555-8555-555555555555', nine = '66666666-6666-4666-8666-666666666666';
const back = '77777777-7777-4777-8777-777777777777', combination = '88888888-8888-4888-8888-888888888888';
const tee = '99999999-9999-4999-8999-999999999999', round = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tables = ['admin_catalog_physical_structures','admin_catalog_physical_holes','admin_catalog_playable_configurations',
  'admin_catalog_configuration_holes','admin_catalog_tee_overrides','admin_catalog_foundation_events'];
const liveTables = ['clubs','course_routes','route_holes','route_combinations','route_combination_holes',
  'route_tees','combination_tees','rounds','round_holes','admin_catalog_drafts','admin_catalog_versions'];

test('Phase 1 physical catalog: explicit, isolated Admin evidence and verified links', async (t) => {
  const db = new PGlite();
  const role = async (name = 'authenticated', uid = admin, claim = name) => {
    await db.exec(`reset role; set role ${name}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,claim]);
  };
  const fail = (fn, code) => assert.rejects(fn, error => error.code === code);
  const rpc = async (name, params) => (await db.query(`select * from public.admin_catalog_foundation_${name}(${params.map((_,i)=>`$${i+1}`).join(',')})`,params)).rows[0];
  const structure = (id = club) => rpc('create_structure',[id,'Structure fixture','stablr','fixture:club','Classification pending']);
  const config = (count = 9, id = club, legacy = nine) => rpc('create_configuration',[id,`Configuration ${count}`,count,'stablr','fixture:configuration','Review pending',legacy,null]);
  const getConfig = async (id) => (await db.query('select * from public.admin_catalog_playable_configurations where id=$1',[id])).rows[0];
  const reviewConfig = async (c, group, kind = 'autonomous', parent = null, confirm = false) =>
    rpc('review_configuration',[c.id,c.revision,group,kind,parent,kind==='derived'?'Explicit fixture reuse':null,
      'stablr','fixture:review','Reviewed configuration',confirm]);
  const slot = async (c, position, hole = null, si = position, options = {}) => rpc('record_configuration_hole',[
    c.id,c.revision,position,options.occurrence ?? 1,hole,options.mode ?? (hole ? 'inherited' : null),
    options.override ?? null,si,'stablr',options.reference ?? 'fixture:hole',options.reason ?? 'Explicit manual evidence',
    options.confirm ?? Boolean(hole),options.legacyHole ?? null,options.legacyCombinationHole ?? null]);
  const oldRows = async () => {
    await db.exec('reset role');
    const rows = await Promise.all(liveTables.map(async name => (await db.query(`select * from public.${name} order by ${name==='admin_catalog_drafts'?'draft_id':name==='admin_catalog_versions'?'version_id':'id'}`)).rows));
    await role(); return rows;
  };
  let baseline, structureRow, configuration, physical = [], legacyCombinationHole;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.profiles(id uuid primary key references auth.users,role text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$
        select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
      insert into auth.users values('${admin}'),('${other}'),('${player}');
      insert into public.profiles values('${admin}','admin'),('${other}','admin'),('${player}','user');`);
    for (const name of ['clubs','course_routes','route_holes','route_combinations','route_combination_holes','rounds','round_holes']) {
      const statement = schema.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];
      assert.ok(statement, `actual catalog table ${name}`); await db.exec(statement);
    }
    for (const name of ['route_tees','combination_tees']) await db.exec(extension.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    await db.exec(`alter table public.clubs add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.course_routes add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.route_combinations add column source_system text,add column source_external_id text,add column source_payload jsonb;
      insert into public.clubs(id,name,name_normalized,created_by,source_payload) values
        ('${club}','Physical nine fixture','physical nine fixture','${admin}','{"physical_hole_count":9,"protected_manual":true}'),
        ('${foreignClub}','Other fixture','other fixture','${admin}','{}');
      insert into public.course_routes(id,club_id,name,holes_count,total_par) values
        ('${nine}','${club}','Nine fixture',9,36),('${back}','${club}','Back fixture',9,36);
      insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) select '${nine}',n,4,n from generate_series(1,9)n;
      -- Same shape as the audited mismatch: origin 10..18, combination 1..9.
      insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) select '${back}',n,4,n from generate_series(10,18)n;
      insert into public.route_combinations(id,club_id,name,front_route_id,back_route_id,total_par) values
        ('${combination}','${club}','Combination fixture','${nine}','${back}',72);
      insert into public.route_combination_holes(route_combination_id,round_hole_number,route_id,route_position,physical_hole_number,par,stroke_index)
        select '${combination}',n,case when n<=9 then '${nine}'::uuid else '${back}'::uuid end,
        case when n<=9 then 1 else 2 end,case when n<=9 then n else n-9 end,4,n from generate_series(1,18)n;
      insert into public.route_tees(id,route_id,tee_name,holes_count,course_rating,slope_rating) values
        ('${tee}','${nine}','Yellow fixture',9,35.5,120);
      insert into public.rounds(id,user_id,club_id,holes_count,total_par,round_type,selected_routes) values
        ('${round}','${player}','${club}',9,36,'single_9','[{"route_id":"${nine}","tee_snapshot":{"course_rating":35.5}}]');
      insert into public.round_holes(round_id,user_id,club_id,route_id,round_hole_number,route_position,physical_hole_number,par,stroke_index)
        select '${round}','${player}','${club}','${nine}',n,1,n,4,n from generate_series(1,9)n;
      alter table public.route_holes enable row level security;
      grant select on public.route_holes to authenticated;
      create policy fixture_existing_read on public.route_holes for select to authenticated using(true);`);
    for (const sql of prior) await db.exec(sql);
    await role();
    const historical = (await db.query("select * from public.admin_catalog_create_draft('club','{\"name\":\"Historical fixture\"}'::jsonb,$1)",[club])).rows[0];
    await db.exec('reset role');
    await db.query(`insert into public.admin_catalog_versions(entity_type,entity_key,live_entity_id,source_draft_id,
      version_number,schema_version,snapshot,published_by) values('club',$1,$2,$3,1,1,'{"name":"Published fixture"}',$4)`,
      [historical.entity_key,club,historical.draft_id,admin]);
    const policies = (await db.query('select * from pg_policies order by tablename,policyname')).rows;
    const functions = (await db.query("select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid")).rows;
    const privileges = (await db.query("select * from information_schema.role_table_grants where table_schema='public' order by table_name,grantee,privilege_type")).rows;
    baseline = await oldRows(); await db.exec('reset role');
    await db.exec(migration); await role();

    await t.test('one-shot migration is empty and leaves old records, functions, policies and grants intact', async () => {
      for (const name of tables) assert.equal((await db.query(`select count(*)::int n from public.${name}`)).rows[0].n,0);
      assert.deepEqual(await oldRows(),baseline);
      await db.exec('reset role');
      assert.deepEqual((await db.query('select * from pg_policies where tablename <> all($1::text[]) order by tablename,policyname',[tables])).rows,policies);
      assert.deepEqual((await db.query("select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname not like 'admin_catalog_foundation_%' order by p.oid")).rows,functions);
      assert.deepEqual((await db.query("select * from information_schema.role_table_grants where table_schema='public' and table_name <> all($1::text[]) order by table_name,grantee,privilege_type",[tables])).rows,privileges);
      await fail(()=>db.exec(migration),'42P07'); await db.exec('rollback'); await role();
    });

    await t.test('all RPCs reject player, anon, service API, missing UID and wrong JWT role', async () => {
      const calls = [()=>structure(),()=>rpc('review_structure',[club,1,'fisico_9','fig','fixture','reason',true]),
        ()=>rpc('create_physical_hole',[club,1,'Hole',4,'fig','fixture','reason',true]),
        ()=>rpc('review_physical_hole',[club,1,4,'fig','fixture','reason',true]),()=>config(),
        ()=>reviewConfig({id:club,revision:1},club),()=>slot({id:club,revision:1},1)];
      for (const [name,uid,claim] of [['anon','','anon'],['authenticated',player,'authenticated'],['service_role',admin,'service_role'],
        ['authenticated','','authenticated'],['authenticated',admin,'anon']]) {
        await role(name,uid,claim); for (const fn of calls) await fail(fn,'42501');
      }
      await role(); structureRow = await structure();
      await role('authenticated',player);
      for (const name of tables) assert.equal((await db.query(`select count(*)::int n from public.${name}`)).rows[0].n,0);
      for (const name of tables) await fail(()=>db.query(`insert into public.${name} default values`),'42501');
      await role('anon'); for (const name of tables) await fail(()=>db.query(`select * from public.${name}`),'42501');
      await role('service_role',admin); await fail(()=>db.query('select * from public.admin_catalog_physical_structures'),'42501');
      await role();
      for (const name of tables) {
        assert.equal((await db.query("select has_table_privilege('authenticated',$1,'INSERT,UPDATE,DELETE,TRUNCATE') allowed",[`public.${name}`])).rows[0].allowed,false);
      }
      for (const name of ['guard','audit','no_removal']) await fail(()=>db.query(`select public.admin_catalog_foundation_${name}()`),'42501');
    });

    await t.test('no classification or physical identity is inferred from existing live nine-hole data', async () => {
      assert.equal(structureRow.classification,'non_classificato'); assert.equal(structureRow.review_status,'needs_review');
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_physical_holes')).rows[0].n,0);
      configuration = await config(); assert.equal(configuration.structure_id,null); assert.equal(configuration.relationship_kind,'unresolved');
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_configuration_holes')).rows[0].n,0);
      await fail(()=>rpc('create_physical_hole',[structureRow.id,1,'Hole',4,'fig','fixture','reason',true]),'22023');
      await fail(()=>rpc('review_structure',[structureRow.id,1,'non_classificato','fig','fixture','reason',true]),'22023');
      await fail(()=>rpc('review_structure',[structureRow.id,1,'inferred_from_name','fig','fixture','reason',true]),'23514');
    });

    await t.test('only explicit evidence confirms classification; stale reviews and silent live sync are rejected', async () => {
      structureRow = await rpc('review_structure',[structureRow.id,structureRow.revision,'fisico_9','fig','fixture:official-evidence','Manual review',true]);
      assert.equal(structureRow.classification,'fisico_9');
      await fail(()=>rpc('review_structure',[structureRow.id,1,'fisico_18','fig','fixture','reason',true]),'40001');
      await fail(()=>rpc('review_structure',[structureRow.id,structureRow.revision,'fisico_18','fig','fixture','reason',true]),'55000');
      await fail(()=>rpc('create_physical_hole',[structureRow.id,10,'Hole',4,'fig','fixture','reason',true]),'22023');
      await fail(()=>rpc('create_physical_hole',[structureRow.id,1,'Hole',null,'fig','fixture','reason',true]),'23514');
      const pending = await rpc('create_physical_hole',[structureRow.id,1,'Hole 1',null,'fig','fixture','Unresolved base',false]);
      physical.push(await rpc('review_physical_hole',[pending.id,pending.revision,4,'fig','fixture:manual','Reviewed base',true]));
      for (let i=2;i<=9;i++) physical.push(await rpc('create_physical_hole',[structureRow.id,i,`Hole ${i}`,4,'fig','fixture:manual','Reviewed base',true]));
      assert.equal(physical[0].base_par,4); assert.equal(Object.hasOwn(physical[0],'stroke_index'),false);
      await fail(()=>rpc('review_physical_hole',[physical[0].id,physical[0].revision,5,'fig','fixture','Change outside phase',true]),'55000');
    });

    await t.test('pending legacy combination references remain unresolved; no numeric offset or physical link is inferred', async () => {
      const c = await rpc('create_configuration',[club,'Unresolved combination',18,'stablr','fixture:legacy','Needs mapping',null,combination]);
      await db.exec('reset role'); legacyCombinationHole = (await db.query('select id from public.route_combination_holes where route_combination_id=$1 and round_hole_number=10',[combination])).rows[0].id; await role();
      const h = await slot(c,10,null,10,{legacyCombinationHole});
      assert.equal(h.physical_hole_id,null); assert.equal(h.structure_id,null); assert.equal(h.par_mode,null); assert.equal(h.review_status,'needs_review');
      await fail(async()=>reviewConfig(await getConfig(c.id),structureRow.id,'autonomous',null,true),'23514');
      const missing = (await db.query('select count(*)::int n from public.admin_catalog_configuration_holes where physical_hole_id is null')).rows[0].n;
      assert.equal(missing,1);
    });

    await t.test('same-club, verified physical identities and explicit Par mode are mandatory', async () => {
      await fail(()=>config(9,foreignClub,nine),'22023');
      const fsRow = await structure(foreignClub);
      const verified = await rpc('review_structure',[fsRow.id,1,'multi_9','fig','fixture','Reviewed',true]);
      const fh = await rpc('create_physical_hole',[verified.id,1,'Foreign hole',4,'fig','fixture','Reviewed',true]);
      await fail(()=>reviewConfig(configuration,verified.id),'22023');
      configuration = await reviewConfig(configuration,structureRow.id);
      await fail(()=>slot(configuration,1,physical[0].id,1,{confirm:false}),'22023');
      await fail(()=>slot(configuration,1,fh.id),'22023');
      await fail(()=>slot(configuration,10,physical[0].id),'22023');
      await fail(()=>slot(configuration,1,physical[0].id,1,{mode:'inherited',override:5}),'23514');
      await fail(()=>slot(configuration,1,physical[0].id,1,{mode:'override'}),'23514');
      await fail(()=>slot(configuration,1,physical[0].id,1,{reference:' '}),'23514');
      await fail(()=>slot(configuration,1,null,1,{override:5}),'23514');
      await fail(()=>slot(configuration,1,physical[0].id,19),'23514');
      const first = await slot(configuration,1,physical[0].id);
      configuration = await getConfig(configuration.id);
      await fail(()=>slot(configuration,2,physical[0].id),'23505');
      await fail(()=>slot({...configuration,revision:1},2,physical[1].id),'40001');
      assert.equal(first.par_mode,'inherited'); assert.equal(first.par_override,null);
    });

    await t.test('cardinality, physical mapping, SI and explicit overrides are separate checks', async () => {
      for(let i=2;i<=9;i++){await slot(configuration,i,physical[i-1].id,i===9?8:i,{...(i===2?{mode:'override',override:5}:{})});configuration=await getConfig(configuration.id);}
      await fail(()=>reviewConfig(configuration,structureRow.id,'autonomous',null,true),'23514');
      await slot(configuration,9,physical[8].id,9);configuration=await getConfig(configuration.id);
      const h = (await db.query('select * from public.admin_catalog_configuration_holes where configuration_id=$1 and position=2',[configuration.id])).rows[0];
      assert.equal(h.par_override,5);assert.equal(physical[1].base_par,4);
      configuration=await reviewConfig(configuration,structureRow.id,'autonomous',null,true);
      assert.equal(configuration.review_status,'verified');
      await fail(()=>slot(configuration,1,physical[0].id),'22023');
    });

    await t.test('derived 18 explicitly reuses nine physical IDs twice and has its own SI, without generating live routes', async () => {
      let c = await config(18);
      await fail(()=>reviewConfig(c,structureRow.id,'derived',c.id),'22023');
      c = await reviewConfig(c,structureRow.id,'derived',configuration.id);
      assert.equal(c.parent_configuration_revision,configuration.revision);
      for(let i=1;i<=18;i++){await slot(c,i,physical[(i-1)%9].id,i,{occurrence:i<=9?1:2});c=await getConfig(c.id);}
      c = await reviewConfig(c,structureRow.id,'derived',configuration.id,true);
      assert.equal(c.holes_count,18);assert.equal(c.review_status,'verified');
      const result = (await db.query('select count(*)::int n,count(distinct physical_hole_id)::int physical from public.admin_catalog_configuration_holes where configuration_id=$1',[c.id])).rows[0];
      assert.deepEqual(result,{n:18,physical:9});
      assert.deepEqual(await oldRows(),baseline);
    });

    await t.test('tee Par/SI override representation exists but no API can create or edit it', async () => {
      const h=(await db.query('select * from public.admin_catalog_configuration_holes where configuration_id=$1 order by position limit 1',[configuration.id])).rows[0];
      const params=[configuration.id,h.id,tee,5,2,'stablr','fixture:override','Explicit reviewed evidence'];
      const stmt=`insert into public.admin_catalog_tee_overrides(configuration_id,configuration_hole_id,route_tee_id,
        par_override,stroke_index_override,source_system,source_reference,reason) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`;
      await fail(()=>db.query(stmt,params),'42501');
      await db.exec('reset role');
      await fail(()=>db.query(stmt,[...params.slice(0,3),null,null,...params.slice(5)]),'23514');
      const fixture=(await db.query(stmt,params)).rows[0]; // representation tested by owner, never a public RPC
      assert.equal(fixture.par_override,5);assert.equal(fixture.stroke_index_override,2);assert.equal(fixture.created_by,admin);
      await role();
      assert.equal((await db.query("select count(*)::int n from pg_proc where proname like 'admin_catalog_foundation_%tee%'")).rows[0].n,0);
    });

    await t.test('events are append-only; a failed audit rolls back both slot and revision', async () => {
      let c=await config();c=await reviewConfig(c,structureRow.id);
      const count=(await db.query('select count(*)::int n from public.admin_catalog_configuration_holes')).rows[0].n;
      await db.exec('reset role');
      await db.exec(`create function public.fixture_reject_evidence() returns trigger language plpgsql as $$begin raise exception 'Fixture audit failure' using errcode='23514';end$$;
        create trigger fixture_audit_failure before insert on public.admin_catalog_foundation_events for each row execute function public.fixture_reject_evidence();`);
      await role();await fail(()=>slot(c,1,physical[0].id),'23514');
      assert.equal((await getConfig(c.id)).revision,c.revision);
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_configuration_holes')).rows[0].n,count);
      await db.exec('reset role');await db.exec('drop trigger fixture_audit_failure on public.admin_catalog_foundation_events');
      await fail(()=>db.query("update public.admin_catalog_foundation_events set operation='UPDATE'"),'55000');
      for(const name of tables){await fail(()=>db.query(`delete from public.${name}`),'55000');await fail(()=>db.query(`truncate public.${name} cascade`),'55000');}
      await role('authenticated',other);
      assert.ok((await db.query('select count(*)::int n from public.admin_catalog_foundation_events')).rows[0].n>0);
      await role();
    });

    await t.test('all live data, rounds, drafts and published history remain byte-for-byte equivalent', async () => {
      assert.deepEqual(await oldRows(),baseline);
      await db.exec('reset role');
      await fail(()=>db.query("update public.admin_catalog_versions set snapshot='{}'"),'55000');
      await role();
      const events=(await db.query('select * from public.admin_catalog_foundation_events')).rows;
      assert.ok(events.every(e=>e.actor_id===admin&&e.after_snapshot.updated_by===admin));
      assert.ok(events.some(e=>e.before_snapshot&&e.before_snapshot.revision+1===e.after_snapshot.revision));
    });
  } finally { await db.close(); }
});
