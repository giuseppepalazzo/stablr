// PostgreSQL in memory only. Every record is an automatic-test fixture.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const readSql = (name) => readFile(new URL(`../../supabase/${name}`, import.meta.url), 'utf8');
const schema = await readSql('shared-catalog-schema.sql'), extension = await readSql('fig-whs-extension.sql');
const sql = await readSql('admin-course-tee-editor.sql');
const migrations = await Promise.all(['admin-catalog-workflow.sql', 'admin-club-editor.sql', 'admin-course-editor.sql',
  'admin-catalog-abandon-draft.sql', 'admin-route-editor.sql', 'admin-hole-grid-editor.sql', 'admin-course-hole-grid-editor.sql'].map(readSql));
const admin = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', player = '33333333-3333-4333-8333-333333333333';
const club = '44444444-4444-4444-8444-444444444444', course = '55555555-5555-4555-8555-555555555555', empty = '66666666-6666-4666-8666-666666666666';
const tee = '77777777-7777-4777-8777-777777777777', legacy = '88888888-8888-4888-8888-888888888888';
const combination = '99999999-9999-4999-8999-999999999999';
const freshTee = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('single-course tee editor: actual nullable rating schema, narrow grants and atomic workflow', async (t) => {
  const db = new PGlite();
  const role = async (name = 'authenticated', uid = admin) => {
    await db.exec(`reset role; set role ${name}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [uid, name]);
  };
  const fails = (fn, code) => assert.rejects(fn, (error) => error.code === code);
  const invoke = async (method, params, casts) => (await db.query(`select public.admin_course_tee_${method}(${casts}) result`, params)).rows[0].result;
  const list = (id = course) => invoke('list', [id], '$1::uuid');
  const get = (id = tee) => invoke('get_draft', [id], '$1::uuid');
  const open = (id = tee) => invoke('open_draft', [id], '$1::uuid');
  const save = async (draft, snapshot) => (await db.query('select * from public.admin_course_tee_save_draft($1,$2::jsonb,$3::bigint)', [draft.draft_id, JSON.stringify(snapshot), draft.revision])).rows[0];
  const publish = (draft, rev = draft.revision) => invoke('publish_draft', [draft.draft_id, rev], '$1::uuid,$2::bigint');
  const archive = async (draft) => (await db.query('select * from public.admin_course_tee_archive_draft($1,$2::bigint)', [draft.draft_id, draft.revision])).rows[0];
  const live = async (id = tee) => { await db.exec('reset role'); const row = (await db.query('select * from public.route_tees where id=$1', [id])).rows[0]; await role(); return row; };
  const countVersions = async () => (await db.query('select count(*)::integer n from public.admin_catalog_versions')).rows[0].n;
  let draft, original, baseline, unrelated;
  const otherTables = ['clubs','course_routes','route_holes','route_combinations','route_combination_holes','combination_tees','rounds','round_holes'];
  const readOtherTables = () => Promise.all(otherTables.map(async (name) => (await db.query(`select * from public.${name} order by id`)).rows));
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.profiles(id uuid primary key references auth.users,role text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
      insert into auth.users values('${admin}'),('${other}'),('${player}');
      insert into public.profiles values('${admin}','admin'),('${other}','admin'),('${player}','user');`);
    for (const name of ['clubs','course_routes','route_holes','route_combinations','route_combination_holes','rounds','round_holes']) {
      await db.exec(schema.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    }
    for (const name of ['route_tees','combination_tees']) await db.exec(extension.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    await db.exec(`alter table public.clubs add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.course_routes add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.route_combinations add column source_system text,add column source_external_id text,add column source_payload jsonb;
      insert into public.clubs(id,name,name_normalized,created_by) values('${club}','Club fixture','club fixture','${admin}');
      insert into public.course_routes(id,club_id,name,holes_count,total_par) values('${course}','${club}','Nove fixture',9,35),('${empty}','${club}','Vuoto fixture',18,72);
      insert into public.route_tees(id,route_id,tee_name,tee_color,gender,holes_count,par_total,course_rating,slope_rating,source_payload)
        values('${tee}','${course}','Giallo','yellow',null,null,35,34.8,125,'{"distances":[100,200],"source":"unchanged"}'),
        ('${legacy}','${course}','Storico','white',null,18,70,null,null,'{"distances":[80,90],"note":"legacy"}');
      insert into public.route_tees(id,route_id,tee_name,tee_color,holes_count,course_rating,slope_rating,is_active)
        values('${freshTee}','${empty}','Giallo fixture 18','yellow',18,72.10,129,true);
      insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) select '${course}',n,4,n from generate_series(1,9)n;
      insert into public.route_combinations(id,club_id,name,front_route_id,back_route_id,total_par)
        values('${combination}','${club}','Combinazione fixture','${course}','${empty}',72);
      insert into public.route_combination_holes(route_combination_id,round_hole_number,route_id,route_position,physical_hole_number,par,stroke_index)
        select '${combination}',n,case when n<=9 then '${course}'::uuid else '${empty}'::uuid end,
          case when n<=9 then 1 else 2 end,case when n<=9 then n else n-9 end,4,n from generate_series(1,18)n;
      insert into public.combination_tees(route_combination_id,tee_name,holes_count,par_total,course_rating,slope_rating,source_payload)
        values('${combination}','Combinazione Giallo',18,72,72.1,125,'{"distances":[300,400]}');
      alter table public.route_tees enable row level security;
      grant select on public.route_tees to authenticated;
      create policy existing_tee_read on public.route_tees for select to authenticated using(true);`);
    for (const migration of migrations) await db.exec(migration);
    original = (await db.query('select * from public.route_tees order by id')).rows;
    baseline = (await db.query('select * from pg_policies order by tablename,policyname')).rows;
    unrelated = await readOtherTables();
    await db.exec(sql);
    await t.test('one-shot migration creates no records, changes no policies or live privileges', async () => {
      assert.deepEqual((await db.query('select * from public.route_tees order by id')).rows, original);
      assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows, baseline);
      assert.deepEqual(await readOtherTables(), unrelated);
      assert.equal(await countVersions(), 0);
      assert.equal((await db.query('select count(*)::integer n from public.admin_catalog_drafts')).rows[0].n, 0);
      assert.equal((await db.query("select has_table_privilege('authenticated','public.route_tees','UPDATE') allowed")).rows[0].allowed, false);
      assert.equal((await db.query("select has_table_privilege('anon','public.admin_catalog_drafts','SELECT') allowed")).rows[0].allowed, false);
    });
    await t.test('all RPCs reject anon, players, missing identity and service API; helpers private', async () => {
      for (const [name, uid] of [['anon',''], ['authenticated',player], ['authenticated',''], ['service_role',admin]]) {
        await role(name, uid);
        for (const fn of [list,get,open, () => save({draft_id:tee,revision:1},{}), () => publish({draft_id:tee,revision:1}), () => archive({draft_id:tee,revision:1})]) await fails(fn, '42501');
        for (const helper of ['context','lock_target']) await fails(() => db.query(`select public.admin_course_tee_${helper}($1)`, [tee]), '42501');
        await fails(() => db.query("select public.admin_course_tee_validate_snapshot('{}')"), '42501');
      }
      await role();
    });
    await t.test('read-only list/get: real scope inheritance, explicit 18 scope on nine, null ratings and no synthetic drafts', async () => {
      const result = await list(); assert.equal(result.tees.length,2);
      assert.equal(result.tees[0].effective_holes_count,9); assert.equal(result.tees[1].effective_holes_count,18);
      assert.equal(result.tees[1].course_rating,null); assert.equal(result.tees[0].source_payload,undefined);
      assert.equal(result.tees[0].has_draft_changes,false); assert.equal((await list(empty)).tees[0].id,freshTee);
      assert.equal((await get()).draft,null); assert.equal(await countVersions(),0);
    });
    await t.test('open/resume is personal, one draft, base captures all readonly data; generic creation blocked', async () => {
      draft = (await open()).draft; assert.equal(draft.entity_type,'route_tee');
      assert.deepEqual(draft.snapshot,{course_rating:34.8,slope_rating:125,is_active:true});
      assert.equal(draft.base_snapshot._context.tee.source_payload.distances[0],100);
      assert.equal((await open()).draft.draft_id,draft.draft_id);
      const concurrent = await Promise.all([open(),open()]); assert.equal(concurrent[0].draft.draft_id,concurrent[1].draft.draft_id);
      await fails(() => db.query('select public.admin_catalog_create_draft($1,$2::jsonb,$3)', ['route_tee',JSON.stringify(draft.snapshot),tee]), '42501');
      await fails(() => open(player),'22023'); assert.equal((await list()).tees[0].has_draft_changes,false);
    });
    await t.test('owner isolation also enforced through generic save, identity and base immutable', async () => {
      await role('authenticated',other); assert.equal((await get()).draft,null);
      await fails(() => save(draft,draft.snapshot),'42501'); await fails(() => publish(draft),'42501'); await fails(() => archive(draft),'40001');
      await fails(() => db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3)', [draft.draft_id,JSON.stringify(draft.snapshot),draft.revision]),'42501');
      const personal = (await open()).draft; assert.notEqual(personal.draft_id,draft.draft_id); await archive(personal); await role();
      await db.exec('reset role');
      await fails(() => db.query("update public.admin_catalog_drafts set base_snapshot='{}',revision=revision+1 where draft_id=$1", [draft.draft_id]),'42501');
      await role();
    });
    await t.test('exact three-field allowlist, typed numeric domains and nullable legacy ratings', async () => {
      for (const key of ['tee_name','tee_color','gender','holes_count','par_total','route_id','source_payload','tee_order']) {
        await fails(() => save(draft,{...draft.snapshot,[key]:'forbidden'}),'22023');
      }
      for (const snapshot of [{},{...draft.snapshot,course_rating:'34.8'},{...draft.snapshot,slope_rating:'125'},
        {...draft.snapshot,is_active:1},{...draft.snapshot,course_rating:true}]) await fails(() => save(draft,snapshot),'22023');
      for (const slope of [54,156,125.5]) await fails(() => save(draft,{...draft.snapshot,slope_rating:slope}),'23514');
      await fails(() => publish(draft),'22023'); await fails(() => publish(draft,null),'40001');
      // No invented CR bounds or precision: existing schema accepts finite numeric.
      for (const cr of [0,-1,34.812345,null]) draft = await save(draft,{...draft.snapshot,course_rating:cr});
      draft = await save(draft,{course_rating:34.8,slope_rating:125,is_active:true});
    });
    await t.test('optimistic saves keep live untouched and actual changes badge; stale confirmation blocked', async () => {
      const before = await live(); const old = draft;
      const attempts = await Promise.allSettled([save(old,{...old.snapshot,course_rating:35}),save(old,{...old.snapshot,course_rating:36})]);
      assert.equal(attempts.filter((r) => r.status==='fulfilled').length,1);
      assert.equal(attempts.find((r) => r.status==='rejected').reason.code,'40001'); draft = attempts.find((r) => r.status==='fulfilled').value;
      assert.deepEqual(await live(),before); assert.equal((await list()).tees[0].has_draft_changes,true);
      await fails(() => publish(draft,old.revision),'40001');
    });
    await t.test('atomic publication changes only CR/Slope/active, authors immutable version and closes draft immediately', async () => {
      const before = await live(); const result = await publish(draft);
      assert.ok(result.version_id); assert.equal(result.version_number,1); assert.equal(result.context.tee.course_rating,draft.snapshot.course_rating);
      const after = await live(); for (const key of Object.keys(before).filter((key) => !['course_rating','slope_rating','is_active','updated_at'].includes(key))) assert.deepEqual(after[key],before[key]);
      assert.equal((await get()).draft,null); assert.equal((await list()).tees[0].has_draft_changes,false);
      const version = (await db.query('select * from public.admin_catalog_versions where version_id=$1',[result.version_id])).rows[0];
      assert.equal(version.published_by,admin); assert.ok(version.published_at); assert.deepEqual(version.snapshot,draft.snapshot); assert.equal(version.diff.course_rating.before,34.8);
      const closed = (await db.query('select workflow_status from public.admin_catalog_drafts where draft_id=$1',[draft.draft_id])).rows[0]; assert.equal(closed.workflow_status,'published');
      await fails(() => publish(draft),'40001'); await fails(() => save(draft,draft.snapshot),'40001');
      await db.exec('reset role');
      await fails(() => db.query("update public.admin_catalog_versions set snapshot='{}' where version_id=$1",[result.version_id]),'55000'); await role();
    });
    await t.test('historical incomplete tee can be deactivated with both ratings null, or one missing', async () => {
      let d = (await open(legacy)).draft; const before = await live(legacy);
      d = await save(d,{...d.snapshot,is_active:false}); await publish(d);
      const after = await live(legacy); assert.equal(after.is_active,false); assert.equal(after.course_rating,null); assert.equal(after.slope_rating,null);
      assert.deepEqual(after.source_payload,before.source_payload); assert.equal(after.holes_count,18);
      assert.equal((await list()).tees.find((row) => row.id===legacy).is_active,false);
      d = (await open(legacy)).draft; d = await save(d,{...d.snapshot,course_rating:34.5}); await publish(d);
      assert.equal((await live(legacy)).slope_rating,null);
    });
    await t.test('conflict base includes ratings, readonly source/distances, parent and publication lineage', async () => {
      for (const [statement, params, restore] of [
        ["update public.route_tees set tee_name='External' where id=$1",[tee],"update public.route_tees set tee_name='Giallo' where id=$1"],
        ["update public.route_tees set source_payload='{}' where id=$1",[tee],"update public.route_tees set source_payload='{\"distances\":[100,200],\"source\":\"unchanged\"}' where id=$1"],
        ["update public.course_routes set name='External' where id=$1",[course],"update public.course_routes set name='Nove fixture' where id=$1"]
      ]) {
        let d = (await open()).draft; d = await save(d,{...d.snapshot,slope_rating:126}); await db.exec('reset role'); await db.query(statement,params); await role();
        await fails(() => publish(d),'40001'); await archive(d); await db.exec('reset role'); await db.query(restore,params); await role();
      }
      let d = (await open()).draft; d = await save(d,{...d.snapshot,slope_rating:126});
      await role('authenticated',other); let competitor = (await open()).draft; competitor = await save(competitor,{...competitor.snapshot,course_rating:40}); await publish(competitor); await role();
      await fails(() => publish(d),'40001'); await archive(d);
    });
    await t.test('history insertion failure rolls back live and draft closure', async () => {
      let d = (await open()).draft; d = await save(d,{...d.snapshot,slope_rating:127}); const before = await live(); const versions = await countVersions();
      await db.exec(`reset role; create function public.test_tee_fail() returns trigger language plpgsql as $$begin raise exception 'test rollback'; end$$;
        create trigger test_tee_fail before insert on public.admin_catalog_versions for each row execute function public.test_tee_fail();`); await role();
      await fails(() => publish(d),'P0001'); assert.deepEqual(await live(),before); assert.equal((await get()).draft.workflow_status,'draft'); assert.equal(await countVersions(),versions);
      await db.exec('reset role; drop trigger test_tee_fail on public.admin_catalog_versions; drop function public.test_tee_fail();'); await role(); await archive(d);
    });
    await t.test('abandon is non-destructive, scoped, CAS and preserves live/history; new open has fresh base', async () => {
      let d = (await open()).draft; assert.ok(d.base_version_id); d = await save(d,{...d.snapshot,is_active:false});
      const before = await live(), versions = await countVersions(); await fails(() => archive({...d,revision:d.revision-1}),'40001');
      const archived = await archive(d); assert.equal(archived.workflow_status,'archived'); assert.equal((await get()).draft,null);
      assert.deepEqual(await live(),before); assert.equal(await countVersions(),versions); await fails(() => archive(d),'40001');
      const next = (await open()).draft; assert.notEqual(next.draft_id,d.draft_id); assert.equal(next.snapshot.is_active,true); await archive(next);
    });
    await t.test('first access to an unchanged eighteen-hole tee and full-refresh RPC sequence preserves draft/base/revision without conflict', async () => {
      const before = await live(freshTee), versions = await countVersions();
      assert.equal((await get(freshTee)).draft,null);
      const opened = await open(freshTee); assert.equal(opened.draft.revision,1);
      assert.deepEqual(opened.draft.snapshot,{course_rating:72.1,slope_rating:129,is_active:true});
      assert.deepEqual(opened.draft.base_snapshot._context,opened.context.base);
      // Each call is a separate autocommitted RPC transaction, as when returning
      // to detail then refreshing the browser. No abandoned/rebased draft needed.
      const resumed = await get(freshTee), refreshed = await open(freshTee);
      assert.deepEqual(resumed.draft,opened.draft); assert.deepEqual(refreshed.draft,opened.draft);
      assert.deepEqual(refreshed.context,opened.context); assert.deepEqual(await live(freshTee),before);
      assert.equal((await list(empty)).tees[0].has_draft_changes,false); assert.equal(await countVersions(),versions);
      // A valid subsequent publication demonstrates that the captured base is
      // usable, not merely that opening hides a false publication conflict.
      const saved = await save(refreshed.draft,{...refreshed.draft.snapshot,slope_rating:130});
      await publish(saved); assert.equal((await get(freshTee)).draft,null);
    });
    await t.test('all unrelated live tables unchanged; migration cannot accidentally be reapplied', async () => {
      await db.exec('reset role');
      assert.equal((await db.query('select name from public.course_routes where id=$1',[course])).rows[0].name,'Nove fixture');
      assert.deepEqual(await readOtherTables(), unrelated);
      await assert.rejects(() => db.exec(sql)); await db.exec('rollback');
      assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows,baseline);
    });
  } finally { await db.close(); }
});
