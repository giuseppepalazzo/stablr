// Isolated PostgreSQL/WASM, or an optional temporary native PostgreSQL cluster.
// Never accepts a remote URL. Native mode also tests two independent Admin sessions.
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { test } from 'node:test';
const nativeModule = process.env.STABLR_EMBEDDED_POSTGRES_MODULE;
const { PGlite } = nativeModule ? {} : await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const sql = (name) => readFile(new URL(`../../supabase/${name}`, import.meta.url), 'utf8');
const [schema, extension, workflow, foundation, physical, playable, physical18, clubLock, migration, proposals, previewRepair] = await Promise.all([
  'shared-catalog-schema.sql', 'fig-whs-extension.sql', 'admin-catalog-workflow.sql', 'admin-catalog-physical-foundation.sql',
  'admin-catalog-physical-course-links.sql', 'admin-catalog-playable-configurations.sql', 'admin-catalog-physical-18-configurations.sql', 'admin-catalog-structure-club-lock.sql', 'admin-catalog-multi9.sql', 'admin-catalog-multi9-club-proposals.sql', 'admin-catalog-multi9-preview-repair.sql'
].map(sql));
const example = JSON.parse(await readFile(new URL('../../data/fig/normalized/parco-de-medici-example.json', import.meta.url), 'utf8'));
const admin = '11111111-1111-4111-8111-111111111111', player = '22222222-2222-4222-8222-222222222222';
const otherAdmin = '33333333-3333-4333-8333-333333333333';
const live = ['clubs', 'course_routes', 'route_holes', 'route_tees', 'route_combinations', 'route_combination_holes', 'combination_tees', 'rounds', 'round_holes', 'admin_catalog_drafts', 'admin_catalog_versions', 'admin_catalog_tee_overrides'];
const existing = ['admin_catalog_physical_structures', 'admin_catalog_physical_holes', 'admin_catalog_physical_course_links', 'admin_catalog_playable_configurations', 'admin_catalog_configuration_holes', 'admin_catalog_foundation_events'];

test('multi_9: scoped identities, exact official configurations and explicit per-club atomic batch', async (t) => {
  let runtime, db;
  if (nativeModule) {
    const { default: EmbeddedPostgres } = await import(nativeModule);
    const socket = createServer();
    await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    runtime = new EmbeddedPostgres({
      databaseDir: join(await mkdtemp(join(tmpdir(), 'stablr-multi9-concurrency-')), 'cluster'),
      user: 'postgres', password: 'isolated-fixture-only', port, persistent: true,
      initdbFlags: ['--locale=C', '--encoding=UTF8'],
      postgresFlags: ['-h', '127.0.0.1'], onLog() {}, onError() {},
    });
    await runtime.initialise(); await runtime.start();
    db = runtime.getPgClient('postgres', '127.0.0.1'); await db.connect();
    db.exec = (text) => db.query(text); db.close = () => db.end();
  } else db = new PGlite();
  const role = async (name = 'authenticated', uid = admin, claim = name) => {
    await db.exec(`reset role;set role ${name}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [uid, claim]);
  };
  const call = async (client, name, args = []) => (await client.query(`select to_jsonb(public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')})) j`,
    nativeModule ? args.map((v) => v && typeof v === 'object' && name !== 'admin_catalog_multi9_batch_preview' ? JSON.stringify(v) : v) : args)).rows[0].j;
  const rpc = (name, args = []) => call(db, name, args);
  const fail = (fn, code) => assert.rejects(fn, (e) => e.code === code);
  const dump = async (tables = [...live, ...existing]) => {
    await db.exec('reset role'); const result = {};
    for (const name of tables) result[name] = (await db.query(`select to_jsonb(t) j from public.${name} t order by to_jsonb(t)::text`)).rows;
    await role(); return result;
  };
  const fixture = async (label, classification = 'multi_9') => {
    await db.exec('reset role');
    const club = (await db.query("insert into public.clubs(name,name_normalized,created_by,source_system,source_payload) values($1,$1,$2,'fig',$3) returning *", [label, admin, example.club.source_payload])).rows[0];
    const routes = {}, combinations = [];
    // Exact Parco-shaped data, with unrelated local UUIDs; never production rows.
    for (const source of example.routes) {
      const c = (await db.query('insert into public.course_routes(club_id,name,holes_count,total_par,source_system,source_payload) values($1,$2,$3,$4,$5,$6) returning *', [club.id, source.name, source.holes_count, source.total_par, source.source_system, source.source_payload])).rows[0];
      routes[source.external_key] = c;
      for (const h of source.holes) await db.query('insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) values($1,$2,$3,$4)', [c.id, h.physical_hole_number, h.par, h.stroke_index]);
      await db.query("insert into public.route_tees(route_id,tee_name,tee_color,holes_count,course_rating,slope_rating) values($1,'Giallo','yellow',$2,70,113)", [c.id, c.holes_count]);
    }
    for (const source of example.route_combinations) {
      const b = (await db.query('insert into public.route_combinations(club_id,name,front_route_id,back_route_id,holes_count,total_par,source_system,source_payload) values($1,$2,$3,$4,$5,$6,$7,$8) returning *', [club.id, source.name, routes[source.front_route_external_key].id, routes[source.back_route_external_key].id, 18, source.total_par, source.source_system, source.source_payload])).rows[0];
      combinations.push(b);
      for (const h of source.holes) await db.query('insert into public.route_combination_holes(route_combination_id,round_hole_number,route_id,route_position,physical_hole_number,par,stroke_index,source_stroke_index) values($1,$2,$3,$4,$5,$6,$7,$8)', [b.id, h.round_hole_number, routes[h.route_external_key].id, h.route_position, h.physical_hole_number, h.par, h.stroke_index, h.source_stroke_index]);
    }
    await role();
    if (classification === null) return { club, routes, combinations, structure: null };
    let structure = await rpc('admin_catalog_foundation_create_structure', [club.id, label, 'stablr', 'fixture:explicit', 'Manual classification']);
    structure = await rpc('admin_catalog_foundation_review_structure', [structure.id, structure.revision, classification, 'stablr', 'fixture:explicit', 'Manual classification confirmed', true]);
    return { club, routes, combinations, structure };
  };
  const preview = (f) => rpc('admin_catalog_multi9_preview', [f.structure.id]);
  const register = (candidates, confirm = true, note = 'Explicit fixture batch approval') => rpc('admin_catalog_multi9_batch_register', [candidates, note, confirm]);
  let pilot, stale, invalid, rollback, good, old, oldPlayable, old18, beforeLive;
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
      create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key references auth.users,role text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
      insert into auth.users values('${admin}'),('${player}'),('${otherAdmin}');insert into public.profiles values('${admin}','admin'),('${player}','user'),('${otherAdmin}','admin');`);
    for (const name of ['clubs', 'course_routes', 'route_holes', 'route_combinations', 'route_combination_holes', 'rounds', 'round_holes']) await db.exec(schema.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    for (const name of ['route_tees', 'combination_tees']) await db.exec(extension.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    for (const name of ['clubs', 'course_routes', 'route_combinations']) await db.exec(`alter table public.${name} add column source_system text,add column source_external_id text,add column source_payload jsonb`);
    for (const text of [workflow, foundation, physical, playable, physical18]) await db.exec(text);
    pilot = await fixture('Parco-shaped fixture'); stale = await fixture('Stale fixture'); invalid = await fixture('Invalid reference fixture'); rollback = await fixture('Rollback fixture'); good = await fixture('Good fixture');
    old = await fixture('Old physical nine fixture', 'fisico_9');
    let p = await rpc('admin_catalog_physical_course_preview', [old.structure.id, old.routes['bianco-9'].id]);
    p = await rpc('admin_catalog_physical_course_register', [old.structure.id, old.routes['bianco-9'].id, old.structure.revision, p.source, 'Explicit', true]);
    p = await rpc('admin_catalog_physical_course_verify', [p.link.id, p.link.revision, p.mapping, 'Explicit', true]);
    let c = await rpc('admin_catalog_playable_preview', [old.structure.id, p.link.id, 'autonomous_9']);
    oldPlayable = await rpc('admin_catalog_playable_register', [old.structure.id, p.link.id, 'autonomous_9', c.baseline, 'Explicit', true]);
    // A Phase 3c snapshot saved BEFORE migration must still verify afterwards.
    await db.exec('reset role');
    const eighteen = (await db.query("insert into public.course_routes(club_id,name,holes_count,total_par,source_system,source_payload) values($1,'Physical eighteen fixture',18,72,'stablr','{}') returning *", [old.club.id])).rows[0];
    for (let n = 1; n <= 18; n++) await db.query('insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) values($1,$2,4,$2)', [eighteen.id, n]);
    await role();
    let s18 = await rpc('admin_catalog_foundation_create_structure', [old.club.id, 'Legacy eighteen', 'stablr', 'fixture:18', 'Manual']);
    s18 = await rpc('admin_catalog_foundation_review_structure', [s18.id, s18.revision, 'fisico_18', 'stablr', 'fixture:18', 'Explicit', true]);
    let ph18 = await rpc('admin_catalog_physical_course_preview', [s18.id, eighteen.id]);
    ph18 = await rpc('admin_catalog_physical_course_register', [s18.id, eighteen.id, s18.revision, ph18.source, 'Explicit', true]);
    ph18 = await rpc('admin_catalog_physical_course_verify', [ph18.link.id, ph18.link.revision, ph18.mapping, 'Explicit', true]);
    let ctx18 = await rpc('admin_catalog_physical18_preview', [s18.id, ph18.link.id, 'autonomous_18', eighteen.id, 'inherited']);
    old18 = await rpc('admin_catalog_physical18_register', [s18.id, ph18.link.id, 'autonomous_18', eighteen.id, 'inherited', ctx18.baseline, 'Explicit', true]);
    const draft = await rpc('admin_catalog_create_draft', ['club', { name: 'Unchanged historical draft' }, pilot.club.id]);
    await db.exec('reset role');
    await db.query("insert into public.admin_catalog_versions(entity_type,entity_key,live_entity_id,source_draft_id,version_number,schema_version,snapshot,published_by) values('club',$1,$2,$3,1,1,'{}',$4)", [draft.entity_key, pilot.club.id, draft.draft_id, admin]);
    await db.query("insert into public.rounds(user_id,club_id,holes_count,total_par,round_type,selected_routes) values($1,$2,18,72,'combined_9x2','[]')", [player, pilot.club.id]);
    const before = await dump();
    await db.exec('reset role');
    // The unapplied multi9 script must refuse deployment before the lock patch.
    await assert.rejects(() => db.exec(migration), /Apply admin-catalog-structure-club-lock.sql first/);
    await db.exec('rollback');
    await db.exec(clubLock); await db.exec(migration); await db.exec(proposals); await db.exec(previewRepair); await role(); beforeLive = await dump(live);

    await t.test('one-shot migration has no backfill or existing-row changes', async () => {
      assert.deepEqual(await dump(), before);
      await db.exec('reset role'); await assert.rejects(() => db.exec(clubLock)); await db.exec('rollback'); await role();
      await db.exec('reset role'); await assert.rejects(() => db.exec(proposals)); await db.exec('rollback'); await role();
      await db.exec('reset role'); await assert.rejects(() => db.exec(migration)); await db.exec('rollback'); await role();
      assert.deepEqual(await dump(), before);
    });
    await t.test('all authorized structure writers share the private club lock before DML; batch locks before inspection', async () => {
      const writers = (await db.query(`select proname,prosrc,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace
        and (prosrc ilike '%insert into public.admin_catalog_physical_structures%'
        or prosrc ilike '%update public.admin_catalog_physical_structures set%') order by proname`)).rows;
      assert.deepEqual(writers.map((f) => f.proname), ['admin_catalog_foundation_create_structure', 'admin_catalog_foundation_review_structure']);
      for (const f of writers) {
        assert.equal(f.prosecdef, true); assert.ok(f.proconfig.includes('search_path=pg_catalog'));
        const locking = f.prosrc.indexOf('perform public.admin_catalog_structure_club_lock(');
        assert.ok(locking >= 0 && locking < f.prosrc.search(/(?:insert into|update) public\.admin_catalog_physical_structures/));
      }
      const body = (await db.query("select prosrc from pg_proc where oid='public.admin_catalog_multi9_apply(uuid,jsonb,text)'::regprocedure")).rows[0].prosrc;
      assert.ok(body.indexOf('perform public.admin_catalog_multi9_lock(') < body.indexOf('public.admin_catalog_multi9_inspect('));
      await fail(() => db.exec('insert into public.admin_catalog_physical_structures default values'), '42501');
      await fail(() => db.exec("update public.admin_catalog_physical_structures set classification='multi_9'"), '42501');
    });
    await t.test('anon, player, service role, missing identity and forged role cannot invoke endpoints or helpers', async () => {
      for (const args of [['anon', '', 'anon'], ['authenticated', player, 'authenticated'], ['service_role', admin, 'service_role'], ['authenticated', '', 'authenticated'], ['authenticated', admin, 'service_role']]) {
        await role(...args);
        for (const [name, args] of [['admin_catalog_multi9_preview', [pilot.structure.id]], ['admin_catalog_multi9_club_preview', [pilot.club.id]], ['admin_catalog_multi9_batch_preview', [null]], ['admin_catalog_multi9_batch_register', [[], 'Bad', true]]]) await fail(() => rpc(name, args), '42501');
        await fail(() => rpc('admin_catalog_foundation_create_structure', [pilot.club.id, 'Forbidden', 'stablr', 'fixture:forbidden', 'Forbidden']), '42501');
        await fail(() => rpc('admin_catalog_foundation_review_structure', [pilot.structure.id, 1, 'multi_9', 'stablr', 'fixture:forbidden', 'Forbidden', true]), '42501');
        await fail(() => rpc('admin_catalog_structure_club_lock', [pilot.club.id]), '42501');
        if (args[0] === 'authenticated') for (const n of ['admin_catalog_multi9_batches', 'admin_catalog_configuration_components']) assert.equal((await db.query(`select * from public.${n}`)).rows.length, 0);
        else await fail(() => db.query('select * from public.admin_catalog_multi9_batches'), '42501');
      }
      await role();
      await fail(() => rpc('admin_catalog_structure_club_lock', [pilot.club.id]), '42501');
      for (const [name, args] of [['admin_catalog_multi9_inspect', [pilot.structure.id]], ['admin_catalog_multi9_club_inspect', [pilot.club.id]], ['admin_catalog_multi9_club_apply', [pilot.club.id, {}, 'Bad']], ['admin_catalog_multi9_lock', [pilot.structure.id]], ['admin_catalog_multi9_apply', [pilot.structure.id, {}, 'Bad']]]) await fail(() => rpc(name, args), '42501');
      await fail(() => db.exec('insert into public.admin_catalog_configuration_components default values'), '42501');
    });
    await t.test('Parco-shaped club without a structure is a complete readonly proposal, approved with exactly one confirmation', async () => {
      const f = await fixture('Parco De Medici proposal fixture', null), before = await dump();
      const c = await rpc('admin_catalog_multi9_club_preview', [f.club.id]);
      assert.equal(c.can_register, true); assert.equal(c.structure_id, null);
      assert.equal(c.classification_proposal, 'multi_9'); assert.equal(c.structure_proposal.action, 'create');
      assert.equal(c.baseline.contract, 2); assert.deepEqual(c.baseline.structures, []);
      assert.equal(c.physical_hole_count, 27); assert.equal(c.configuration_count, 7);
      const batch = await rpc('admin_catalog_multi9_batch_preview', [null]);
      assert.ok(batch.candidates.some((x) => x.club_id === f.club.id)); assert.deepEqual(await dump(), before);
      await fail(() => register([c], false), '22023'); await fail(() => register([c], true, ' '), '22023');
      assert.deepEqual(await dump(), before);
      const result = await register([c]); assert.equal(result.registered.length, 1); assert.equal(result.registered[0].structure_action, 'create');
      const structures = (await db.query('select * from public.admin_catalog_physical_structures where club_id=$1', [f.club.id])).rows;
      assert.equal(structures.length, 1); assert.equal(structures[0].classification, 'multi_9'); assert.equal(structures[0].review_status, 'verified');
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_physical_holes where club_id=$1', [f.club.id])).rows[0].n, 27);
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_playable_configurations where club_id=$1', [f.club.id])).rows[0].n, 7);
      const events = (await db.query("select * from public.admin_catalog_foundation_events where entity_table='admin_catalog_physical_structures' and entity_id=$1 order by revision", [structures[0].id])).rows;
      assert.deepEqual(events.map((e) => e.operation), ['INSERT', 'UPDATE']); assert.ok(events.every((e) => e.actor_id === admin));
      assert.deepEqual(await dump(live), Object.fromEntries(live.map((name) => [name, before[name]])));
      const replay = await register([c]); assert.equal(replay.registered.length, 0); assert.equal(replay.excluded[0].code, '40001');
    });
    await t.test('manual verified structures are reused unchanged; an empty pending structure is only classified on confirmation', async () => {
      const manual = await fixture('Existing manual structure fixture');
      let c = await rpc('admin_catalog_multi9_club_preview', [manual.club.id]);
      assert.equal(c.structure_proposal.action, 'reuse'); assert.equal(c.structure_id, manual.structure.id);
      assert.equal((await register([c])).registered.length, 1);
      assert.deepEqual((await db.query('select to_jsonb(s) j from public.admin_catalog_physical_structures s where id=$1', [manual.structure.id])).rows[0].j, manual.structure);
      const pending = await fixture('Empty pending structure fixture', null);
      const s = await rpc('admin_catalog_foundation_create_structure', [pending.club.id, 'Manual pending', 'fig', 'fixture:source', 'Existing pending']);
      c = await rpc('admin_catalog_multi9_club_preview', [pending.club.id]);
      assert.equal(c.structure_proposal.action, 'review'); assert.equal(c.can_register, true);
      assert.equal((await db.query('select classification from public.admin_catalog_physical_structures where id=$1', [s.id])).rows[0].classification, 'non_classificato');
      assert.equal((await register([c])).registered.length, 1);
      assert.equal((await db.query('select classification from public.admin_catalog_physical_structures where id=$1', [s.id])).rows[0].classification, 'multi_9');
    });
    await t.test('stale sources, new structures, tampered proposals, incompatible models and duplicate clubs cannot create or reclassify anything', async () => {
      const f = await fixture('Stale proposal fixture', null); let c = await rpc('admin_catalog_multi9_club_preview', [f.club.id]);
      const tampered = { ...c, baseline: { ...c.baseline, proposal: { ...c.baseline.proposal, classification: 'fisico_18' } } };
      assert.equal((await register([tampered])).excluded[0].code, '40001');
      await db.exec('reset role'); await db.query("update public.course_routes set name=name||' changed' where id=$1", [f.routes['bianco-9'].id]); await role();
      assert.equal((await register([c])).excluded[0].code, '40001');
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_physical_structures where club_id=$1', [f.club.id])).rows[0].n, 0);
      c = await rpc('admin_catalog_multi9_club_preview', [f.club.id]);
      let s = await rpc('admin_catalog_foundation_create_structure', [f.club.id, 'Other model', 'stablr', 'fixture:other', 'Explicit']);
      s = await rpc('admin_catalog_foundation_review_structure', [s.id, s.revision, 'fisico_9', 'stablr', 'fixture:other', 'Explicit', true]);
      assert.equal((await register([c])).excluded[0].code, '40001');
      const rejected = await rpc('admin_catalog_multi9_club_preview', [f.club.id]); assert.equal(rejected.can_register, false);
      assert.ok(rejected.reasons.includes('conflicting_classification'));
      assert.equal((await register([rejected])).registered.length, 0);
      assert.equal((await db.query('select classification from public.admin_catalog_physical_structures where id=$1', [s.id])).rows[0].classification, 'fisico_9');
      const dup = await fixture('Duplicate club proposal fixture', null), d = await rpc('admin_catalog_multi9_club_preview', [dup.club.id]);
      const result = await register([d, d]); assert.equal(result.registered.length, 1); assert.equal(result.excluded[0].code, '22023');
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_physical_structures where club_id=$1', [dup.club.id])).rows[0].n, 1);
      await fail(() => register(Array(51).fill(d)), '22023');
    });
    await t.test('incomplete Par, invalid SI, missing exact references and ambiguous structures are excluded with reasons, without writes', async () => {
      const f = await fixture('Incomplete proposal fixture', null);
      await db.exec('reset role');
      await fail(() => db.query('update public.route_holes set par=null where route_id=$1 and physical_hole_number=1', [f.routes['bianco-9'].id]), '23502');
      const removed = (await db.query('delete from public.route_holes where route_id=$1 and physical_hole_number=1 returning *', [f.routes['bianco-9'].id])).rows[0]; await role();
      let c = await rpc('admin_catalog_multi9_club_preview', [f.club.id]); assert.equal(c.can_register, false); assert.ok(c.courses.some((x) => x.reasons.includes('invalid_nine_grid')));
      assert.equal((await register([c])).registered.length, 0);
      await db.exec('reset role'); await db.query('insert into public.route_holes(id,route_id,physical_hole_number,par,stroke_index) values($1,$2,1,$3,$4)', [removed.id, removed.route_id, removed.par, removed.stroke_index]);
      await db.query('update public.route_holes set stroke_index=(select stroke_index from public.route_holes where route_id=$1 and physical_hole_number=2) where route_id=$1 and physical_hole_number=1', [f.routes['bianco-9'].id]); await role();
      c = await rpc('admin_catalog_multi9_club_preview', [f.club.id]); assert.equal(c.can_register, false);
      await db.exec('reset role'); await db.query('update public.route_combination_holes set physical_hole_number=18 where route_combination_id=$1 and round_hole_number=1', [f.combinations[0].id]); await role();
      c = await rpc('admin_catalog_multi9_club_preview', [f.club.id]); assert.ok(c.combinations.some((x) => x.reasons.includes('non_unique_exact_reference')));
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_physical_structures where club_id=$1', [f.club.id])).rows[0].n, 0);
      await rpc('admin_catalog_foundation_create_structure', [f.club.id, 'Ambiguous A', 'stablr', 'fixture:a', 'Explicit']);
      await rpc('admin_catalog_foundation_create_structure', [f.club.id, 'Ambiguous B', 'stablr', 'fixture:b', 'Explicit']);
      c = await rpc('admin_catalog_multi9_club_preview', [f.club.id]); assert.ok(c.reasons.includes('ambiguous_structure'));
    });
    await t.test('failure after classification rolls back the entire new club including structure and audit, while another club succeeds', async () => {
      const bad = await fixture('Partial rollback proposal fixture', null), good = await fixture('Independent proposal fixture', null);
      const a = await rpc('admin_catalog_multi9_club_preview', [bad.club.id]), b = await rpc('admin_catalog_multi9_club_preview', [good.club.id]);
      const before = await dump(live);
      await db.exec(`reset role;create function public.fixture_reject_new_multi9() returns trigger language plpgsql as $$begin
        if new.club_id='${bad.club.id}'::uuid and new.position=5 then raise exception 'Fixture failure after structure' using errcode='23514';end if;return new;end$$;
        create trigger fixture_new_multi9_failure before insert on public.admin_catalog_configuration_holes for each row execute function public.fixture_reject_new_multi9();`); await role();
      const result = await register([a, b]); assert.equal(result.registered.length, 1); assert.equal(result.registered[0].club_id, good.club.id);
      assert.equal(result.excluded.length, 1); assert.equal(result.excluded[0].club_id, bad.club.id);
      for (const table of [...existing.filter((x) => x !== 'admin_catalog_foundation_events'), 'admin_catalog_configuration_components']) {
        assert.equal((await db.query(`select count(*)::int n from public.${table} where club_id=$1`, [bad.club.id])).rows[0].n, 0);
      }
      assert.equal((await db.query("select count(*)::int n from public.admin_catalog_foundation_events where after_snapshot->>'club_id'=$1", [bad.club.id])).rows[0].n, 0);
      assert.deepEqual(await dump(live), before);
      await db.exec('reset role;drop trigger fixture_new_multi9_failure on public.admin_catalog_configuration_holes;drop function public.fixture_reject_new_multi9()'); await role();
    });
    if (runtime) {
      await t.test('two Admin sessions: new proposals share the club lock before the first structure exists and keep it through approval COMMIT', async () => {
        const f = await fixture('Concurrent no-structure proposal fixture', null), c = await rpc('admin_catalog_multi9_club_preview', [f.club.id]);
        const second = runtime.getPgClient('postgres', '127.0.0.1'); await second.connect();
        try {
          await second.query(`set role authenticated;select set_config('request.jwt.claim.sub','${otherAdmin}',false),set_config('request.jwt.claim.role','authenticated',false);set statement_timeout='2s'`);
          await second.query('begin');
          await call(second, 'admin_catalog_foundation_create_structure', [f.club.id, 'Concurrent structure', 'stablr', 'fixture:other', 'Explicit']);
          assert.equal((await register([c])).excluded[0].code, '55P03');
          assert.equal((await db.query('select count(*)::int n from public.admin_catalog_physical_structures where club_id=$1', [f.club.id])).rows[0].n, 0);
          await second.query('rollback'); await db.exec('begin');
          assert.equal((await register([c])).registered.length, 1);
          await fail(() => call(second, 'admin_catalog_foundation_create_structure', [f.club.id, 'Concurrent phantom', 'stablr', 'fixture:other', 'Explicit']), '55P03');
          await db.exec('commit');
          assert.equal((await register([c])).excluded[0].code, '40001');
        } finally { await db.exec('rollback'); await second.query('rollback'); await second.end(); }
      });
      await t.test('two Admin sessions: successful batch holds the club lock until COMMIT, blocking structure creation and classification without writes', async () => {
        const f = await fixture('Concurrent batch fixture');
        const pending = await rpc('admin_catalog_foundation_create_structure', [f.club.id, 'Other structure', 'stablr', 'fixture:other', 'Explicit']);
        const candidate = await preview(f), before = await dump(live);
        const eventsBefore = (await db.query("select count(*)::int n from public.admin_catalog_foundation_events where entity_table='admin_catalog_physical_structures' and after_snapshot->>'club_id'=$1", [f.club.id])).rows[0].n;
        const second = runtime.getPgClient('postgres', '127.0.0.1'); await second.connect();
        try {
          await second.query(`set role authenticated;select set_config('request.jwt.claim.sub','${otherAdmin}',false),set_config('request.jwt.claim.role','authenticated',false);set statement_timeout='2s'`);
          await db.exec('begin');
          const result = await register([candidate]); assert.equal(result.registered.length, 1);
          for (const [name, args] of [
            ['admin_catalog_foundation_create_structure', [f.club.id, 'Concurrent phantom', 'stablr', 'fixture:other', 'Explicit']],
            ['admin_catalog_foundation_review_structure', [pending.id, pending.revision, 'multi_9', 'stablr', 'fixture:other', 'Explicit', true]],
          ]) await fail(() => call(second, name, args), '55P03');
          // A different club is not excluded by the club-scoped namespace.
          await call(second, 'admin_catalog_foundation_create_structure', [old.club.id, 'Different club', 'stablr', 'fixture:other', 'Explicit']);
          assert.equal((await second.query('select count(*)::int n from public.admin_catalog_physical_structures where club_id=$1', [f.club.id])).rows[0].n, 2);
          assert.equal((await second.query('select revision from public.admin_catalog_physical_structures where id=$1', [pending.id])).rows[0].revision, '1');
          assert.equal((await second.query("select count(*)::int n from public.admin_catalog_foundation_events where entity_table='admin_catalog_physical_structures' and after_snapshot->>'club_id'=$1", [f.club.id])).rows[0].n, eventsBefore);
          await db.exec('commit');
          const created = await call(second, 'admin_catalog_foundation_create_structure', [f.club.id, 'After commit', 'stablr', 'fixture:other', 'Explicit']);
          assert.ok(created.id); assert.deepEqual(await dump(live), before);
        } finally { await db.exec('rollback'); await second.end(); }
      });
      await t.test('two Admin sessions: competing creation/classification excludes only the busy club; rollback releases the lock', async () => {
        const busy = await fixture('Concurrent writer fixture'), free = await fixture('Concurrent independent fixture');
        const pending = await rpc('admin_catalog_foundation_create_structure', [busy.club.id, 'Pending structure', 'stablr', 'fixture:pending', 'Explicit']);
        const a = await preview(busy), b = await preview(free);
        const second = runtime.getPgClient('postgres', '127.0.0.1'); await second.connect();
        try {
          await second.query(`set role authenticated;select set_config('request.jwt.claim.sub','${otherAdmin}',false),set_config('request.jwt.claim.role','authenticated',false);set statement_timeout='2s'`);
          for (const [name, args] of [
            ['admin_catalog_foundation_create_structure', [busy.club.id, 'Uncommitted phantom', 'stablr', 'fixture:other', 'Explicit']],
            ['admin_catalog_foundation_review_structure', [pending.id, pending.revision, 'multi_9', 'stablr', 'fixture:other', 'Explicit', true]],
          ]) {
            await second.query('begin'); await call(second, name, args);
            const result = await register(name.endsWith('create_structure') ? [a, b] : [a]);
            assert.equal(result.excluded.length, 1); assert.equal(result.excluded[0].code, '55P03');
            assert.equal(result.registered.length, name.endsWith('create_structure') ? 1 : 0);
            assert.equal((await db.query('select count(*)::int n from public.admin_catalog_physical_holes where structure_id=$1', [busy.structure.id])).rows[0].n, 0);
            assert.equal((await db.query('select count(*)::int n from public.admin_catalog_foundation_events where entity_table<>\'admin_catalog_multi9_batches\' and after_snapshot->>\'structure_id\'=$1', [busy.structure.id])).rows[0].n, 0);
            await second.query('rollback');
          }
          assert.equal((await register([a])).registered.length, 1);
        } finally { await second.query('rollback'); await second.end(); }
      });
      await t.test('uniqueness is rechecked after a competing Admin COMMIT, and stale-snapshot isolation is rejected', async () => {
        const f = await fixture('Committed ambiguity fixture'), candidate = await preview(f);
        const second = runtime.getPgClient('postgres', '127.0.0.1'); await second.connect();
        try {
          await second.query(`set role authenticated;select set_config('request.jwt.claim.sub','${otherAdmin}',false),set_config('request.jwt.claim.role','authenticated',false)`);
          await second.query('begin');
          let other = await call(second, 'admin_catalog_foundation_create_structure', [f.club.id, 'Second verified structure', 'stablr', 'fixture:other', 'Explicit']);
          other = await call(second, 'admin_catalog_foundation_review_structure', [other.id, other.revision, 'multi_9', 'stablr', 'fixture:other', 'Explicit', true]);
          await second.query('commit');
          const result = await register([candidate]); assert.equal(result.registered.length, 0); assert.equal(result.excluded.length, 1);
          assert.ok((await preview(f)).reasons.includes('ambiguous_structure'));
          assert.equal((await db.query('select count(*)::int n from public.admin_catalog_physical_holes where structure_id=$1', [f.structure.id])).rows[0].n, 0);
          await db.exec('begin isolation level repeatable read');
          await fail(() => rpc('admin_catalog_foundation_create_structure', [f.club.id, 'Stale snapshot', 'stablr', 'fixture:other', 'Explicit']), '25001');
          await db.exec('rollback');
        } finally { await db.exec('rollback'); await second.query('rollback'); await second.end(); }
      });
      await t.test('club locking remains compatible with player foreign-key KEY SHARE', async () => {
        const f = await fixture('Player FK fixture');
        const second = runtime.getPgClient('postgres', '127.0.0.1'); await second.connect();
        try {
          await second.query(`begin;set local statement_timeout='2s'`);
          await second.query('select id from public.clubs where id=$1 for key share', [f.club.id]);
          await rpc('admin_catalog_foundation_create_structure', [f.club.id, 'FK compatible', 'stablr', 'fixture:other', 'Explicit']);
        } finally { await second.query('rollback'); await second.end(); }
      });
    }
    await t.test('club and batch previews are read-only and exact, excluding repeat-18 without hiding it', async () => {
      const before = await dump([...existing, 'admin_catalog_multi9_batches', 'admin_catalog_configuration_components']);
      const c = await preview(pilot);
      assert.equal(c.can_register, true); assert.equal(c.courses.length, 3); assert.equal(c.physical_hole_count, 27); assert.equal(c.new_physical_hole_count, 27); assert.equal(c.configuration_count, 7);
      assert.equal(c.combinations.length, 4); assert.equal(c.excluded.length, 3); assert.ok(c.excluded.every((x) => x.reason === 'repeated_or_other_18_out_of_scope'));
      assert.ok(c.combinations.every((x) => x.sequence.length === 18 && x.sequence.every((h) => h.source_hole_id && h.par_mode === 'inherited')));
      const b = await rpc('admin_catalog_multi9_batch_preview', [[pilot.structure.id, old.structure.id]]);
      assert.equal(b.club_count, 1); assert.equal(b.configuration_count, 7); assert.equal(b.excluded.length, 1); assert.ok(b.excluded[0].reasons.includes('ambiguous_structure'));
      assert.deepEqual(await dump(Object.keys(before)), before);
      await fail(() => register([c], false), '22023'); await fail(() => register([c], true, ' '), '22023'); await fail(() => register([]), '22023');
    });
    await t.test('SI differences are retained; incorrect references, duplicates, Par overrides, order and incomplete grids exclude the whole club', async () => {
      const f = invalid, b = f.combinations[0];
      const mutate = async (text, args) => { await db.exec('reset role'); await db.query(text, args); await role(); };
      await mutate('update public.route_combination_holes set physical_hole_number=18 where route_combination_id=$1 and round_hole_number=1', [b.id]);
      let c = await preview(f); assert.equal(c.can_register, false); assert.ok(c.combinations.find((x) => x.id === b.id).reasons.includes('non_unique_exact_reference'));
      await mutate('update public.route_combination_holes set physical_hole_number=1 where route_combination_id=$1 and round_hole_number=1', [b.id]);
      await mutate('update public.route_combination_holes set par=3 where route_combination_id=$1 and round_hole_number=1', [b.id]);
      assert.ok((await preview(f)).combinations.find((x) => x.id === b.id).reasons.includes('explicit_par_override_required'));
      await mutate('update public.route_combination_holes set par=4,route_position=2 where route_combination_id=$1 and round_hole_number=1', [b.id]);
      assert.ok((await preview(f)).combinations.find((x) => x.id === b.id).reasons.includes('component_order_mismatch'));
      await mutate('update public.route_combination_holes set route_position=1 where route_combination_id=$1 and round_hole_number=1', [b.id]);
      await mutate('update public.route_holes set physical_hole_number=2 where route_id=$1 and physical_hole_number=1', [f.routes['bianco-9'].id]);
      c = await preview(f); assert.equal(c.can_register, false); assert.ok(c.courses.some((x) => x.reasons.includes('invalid_nine_grid')));
      const before = await dump(existing); const result = await register([c]); assert.equal(result.registered.length, 0); assert.equal(result.excluded.length, 1); assert.deepEqual((await dump(existing)).admin_catalog_physical_holes, before.admin_catalog_physical_holes);
      beforeLive = await dump(live);
    });
    await t.test('explicit batch approval creates three scoped nines and four official combinations, atomically verified with audit', async () => {
      const c = await preview(pilot); const result = await register([c]);
      assert.equal(result.registered.length, 1); assert.deepEqual(result.excluded, []); assert.ok(result.batch_id);
      const rows = (await db.query('select * from public.admin_catalog_physical_holes where structure_id=$1', [pilot.structure.id])).rows;
      assert.equal(rows.length, 27); assert.equal(new Set(rows.map((h) => h.id)).size, 27);
      assert.equal(rows.filter((h) => h.physical_number === 1).length, 3); assert.ok(rows.every((h) => h.review_status === 'verified'));
      const cfg = (await db.query('select * from public.admin_catalog_playable_configurations where structure_id=$1', [pilot.structure.id])).rows;
      assert.equal(cfg.length, 7); assert.ok(cfg.every((c) => c.review_status === 'verified'));
      assert.equal((await db.query('select * from public.admin_catalog_configuration_components where structure_id=$1', [pilot.structure.id])).rows.length, 8);
      for (const b of c.combinations) {
        const config = cfg.find((x) => x.legacy_combination_id === b.id);
        const holes = (await db.query('select * from public.admin_catalog_configuration_holes where configuration_id=$1 order by position', [config.id])).rows;
        assert.deepEqual(holes.map((h) => h.stroke_index), b.sequence.map((h) => h.stroke_index));
        assert.ok(holes.every((h) => h.par_mode === 'inherited' && h.par_override === null && h.occurrence === 1));
        assert.equal(config.parent_configuration_id, null); assert.equal(config.relationship_kind, 'derived');
      }
      const replay = await register([c]); assert.equal(replay.registered.length, 0); assert.equal(replay.excluded[0].code, '40001');
      assert.ok((await preview(pilot)).reasons.includes('configuration_already_registered'));
      assert.deepEqual(await dump(live), beforeLive);
    });
    await t.test('stale club rolls back alone; another validated club succeeds in the same batch', async () => {
      const a = await preview(stale), b = await preview(good);
      await db.exec('reset role'); await db.query("update public.course_routes set name=name||' changed' where id=$1", [stale.routes['bianco-9'].id]); await role();
      beforeLive = await dump(live);
      const result = await register([a, b]); assert.equal(result.excluded.length, 1); assert.equal(result.excluded[0].code, '40001'); assert.equal(result.registered.length, 1);
      assert.equal((await db.query('select * from public.admin_catalog_physical_holes where structure_id=$1', [stale.structure.id])).rows.length, 0);
      assert.equal((await db.query('select * from public.admin_catalog_playable_configurations where structure_id=$1', [good.structure.id])).rows.length, 7);
    });
    await t.test('failure halfway through a club rolls back identities, configurations, components and their audit', async () => {
      const c = await preview(rollback);
      const before = await dump(existing);
      await db.exec(`reset role;create function public.fixture_reject_multi9() returns trigger language plpgsql as $$begin if new.position=5 then raise exception 'Fixture failure' using errcode='23514';end if;return new;end$$;
        create trigger fixture_multi9_failure before insert on public.admin_catalog_configuration_holes for each row execute function public.fixture_reject_multi9();`); await role();
      const result = await register([c]); assert.equal(result.registered.length, 0); assert.equal(result.excluded.length, 1);
      const after = await dump(existing);
      for (const name of existing.filter((n) => n !== 'admin_catalog_foundation_events')) assert.deepEqual(after[name], before[name]);
      const addedEvents = after.admin_catalog_foundation_events.filter((e) => !before.admin_catalog_foundation_events.some((old) => old.j.id === e.j.id));
      assert.ok(addedEvents.every((e) => e.j.entity_table === 'admin_catalog_multi9_batches'));
      await db.exec('reset role;drop trigger fixture_multi9_failure on public.admin_catalog_configuration_holes;drop function public.fixture_reject_multi9()'); await role();
    });
    await t.test('legacy pending Phase 3b remains verifiable and snapshots stay byte-equivalent', async () => {
      const c = oldPlayable;
      const verified = await rpc('admin_catalog_playable_verify', [c.configuration.id, c.configuration.revision, c.baseline, c.saved_holes, 'Still valid', true]);
      assert.equal(verified.configuration.review_status, 'verified'); assert.deepEqual(verified.baseline, c.baseline); assert.deepEqual(verified.saved_holes, c.saved_holes);
    });
    await t.test('legacy Phase 3c pending snapshot and source verification remain compatible', async () => {
      const c = old18;
      const verified = await rpc('admin_catalog_physical18_verify', [c.configuration.id, c.configuration.revision, c.baseline, c.saved_holes, 'Still valid', true]);
      assert.equal(verified.configuration.review_status, 'verified'); assert.deepEqual(verified.baseline, c.baseline); assert.deepEqual(verified.saved_holes, c.saved_holes);
      const physical = await rpc('admin_catalog_physical_course_preview', [c.structure.id, c.source_course_id]);
      assert.deepEqual(physical.reasons, []); assert.equal(physical.physical_holes.length, 18);
    });
    await t.test('Phase 3a explicit multi-nine source numbered 10..18 remains usable without renumbering', async () => {
      await db.exec('reset role');
      const route = (await db.query("insert into public.course_routes(club_id,name,holes_count,total_par,source_system,source_payload) values($1,'Legacy numbering fixture',9,36,'stablr','{}') returning *", [old.club.id])).rows[0];
      for (let n = 10; n <= 18; n++) await db.query('insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) values($1,$2,4,$3)', [route.id, n, n - 9]);
      await role(); beforeLive = await dump(live);
      let s = await rpc('admin_catalog_foundation_create_structure', [old.club.id, 'Legacy explicit numbering', 'stablr', 'fixture:legacy', 'Manual']);
      s = await rpc('admin_catalog_foundation_review_structure', [s.id, s.revision, 'multi_9', 'stablr', 'fixture:legacy', 'Explicit', true]);
      let p = await rpc('admin_catalog_physical_course_preview', [s.id, route.id]);
      assert.equal(p.can_register, true);
      p = await rpc('admin_catalog_physical_course_register', [s.id, route.id, s.revision, p.source, 'Explicit', true]);
      p = await rpc('admin_catalog_physical_course_verify', [p.link.id, p.link.revision, p.mapping, 'Explicit', true]);
      assert.equal(p.link.review_status, 'verified'); assert.deepEqual(p.mapping.map((h) => h.physical_number), [10, 11, 12, 13, 14, 15, 16, 17, 18]);
      assert.deepEqual(await dump(live), beforeLive);
    });
    await t.test('registered mappings, receipt and audit cannot be rewritten; source locks are NOWAIT', async () => {
      const c = (await db.query("select * from public.admin_catalog_playable_configurations where structure_id=$1 and registration_kind='multi9_9' limit 1", [pilot.structure.id])).rows[0];
      const h = (await db.query('select * from public.admin_catalog_configuration_holes where configuration_id=$1 limit 1', [c.id])).rows[0];
      await fail(() => rpc('admin_catalog_foundation_record_configuration_hole', [c.id, c.revision, h.position, 1, h.physical_hole_id, 'inherited', null, 1, 'stablr', 'fixture:bad', 'Bad', true, h.legacy_route_hole_id, null]), '22023');
      await fail(() => db.exec('delete from public.admin_catalog_multi9_batches'), '42501');
      await db.exec('reset role'); await fail(() => db.exec("update public.admin_catalog_multi9_batches set reason='changed'"), '55000');
      await fail(() => db.exec("update public.admin_catalog_foundation_events set operation='UPDATE'"), '55000'); await role();
      assert.match(migration, /in share mode nowait/); assert.match(migration, /for update nowait/); assert.match(migration, /exception when others/);
      assert.deepEqual(await dump(live), beforeLive);
    });
  } finally { await db.close(); if (runtime) await runtime.stop(); }
});
