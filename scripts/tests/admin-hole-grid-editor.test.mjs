// Isolated PostgreSQL fixtures. No remote SQL or production writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const readSql = (file) => readFile(new URL(`../../supabase/${file}`,import.meta.url),'utf8');
const schema = await readSql('shared-catalog-schema.sql');
const extension = await readSql('fig-whs-extension.sql');
const migrations = await Promise.all(['admin-catalog-workflow.sql','admin-club-editor.sql','admin-course-editor.sql',
  'admin-catalog-abandon-draft.sql','admin-route-editor.sql','admin-hole-grid-editor.sql'].map(readSql));
const admin = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const player = '33333333-3333-4333-8333-333333333333';
const club = '44444444-4444-4444-8444-444444444444';
const front = '55555555-5555-4555-8555-555555555555';
const back = '66666666-6666-4666-8666-666666666666';
const route = '77777777-7777-4777-8777-777777777777';
const clone = (value) => structuredClone(value);

test('atomic existing-combination hole grid, using actual table definitions', async (t) => {
  const db = new PGlite();
  const role = async (name='authenticated',uid=admin) => {
    await db.exec(`reset role; set role ${name}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,name]);
  };
  const fails = (fn,code) => assert.rejects(fn,(error) => error.code === code);
  const get = async () => (await db.query('select public.admin_hole_grid_get_draft($1) result',[route])).rows[0].result;
  const open = async () => (await db.query('select public.admin_hole_grid_open_draft($1) result',[route])).rows[0].result;
  const save = async (d,snapshot) => (await db.query('select * from public.admin_hole_grid_save_draft($1,$2::jsonb,$3::bigint)',[d.draft_id,JSON.stringify(snapshot),d.revision])).rows[0];
  const publish = async (d,revision=d.revision) => (await db.query('select public.admin_hole_grid_publish_draft($1,$2::bigint) result',[d.draft_id,revision])).rows[0].result;
  const archive = async (d) => (await db.query('select * from public.admin_hole_grid_archive_draft($1,$2::bigint)',[d.draft_id,d.revision])).rows[0];
  const countVersions = async () => (await db.query('select count(*)::integer n from public.admin_catalog_versions')).rows[0].n;
  const holes = async () => (await db.query('select * from public.route_combination_holes order by round_hole_number')).rows;
  const dependencies = async () => Promise.all(['clubs','course_routes','route_holes','route_combinations','route_tees','combination_tees','rounds','round_holes']
    .map(async (name) => (await db.query(`select * from public.${name} order by id`)).rows));
  const changed = (d) => {
    const result = clone(d.snapshot);
    result.holes[0].stroke_index = 2; result.holes[1].stroke_index = 1;
    return result;
  };
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.profiles(id uuid primary key references auth.users,role text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
      create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),''); $$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$
        select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;
      insert into auth.users values('${admin}'),('${other}'),('${player}');
      insert into public.profiles values('${admin}','admin'),('${other}','admin'),('${player}','user');
    `);
    // Execute the real CREATE TABLE statements (no historical DROP/seed SQL).
    for (const name of ['clubs','course_routes','route_holes','route_combinations','route_combination_holes','rounds','round_holes']) {
      const statement = schema.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];
      assert.ok(statement,`actual schema for ${name}`); await db.exec(statement);
    }
    for (const name of ['route_tees','combination_tees']) {
      await db.exec(extension.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    }
    await db.exec(`
      alter table public.route_holes add constraint route_holes_route_id_physical_hole_number_key unique(route_id,physical_hole_number);
      alter table public.route_combination_holes add constraint route_combination_holes_round_hole_number_key unique(route_combination_id,round_hole_number);
      alter table public.route_combinations add constraint route_combinations_club_id_front_route_id_back_route_id_key unique(club_id,front_route_id,back_route_id);
      alter table public.clubs add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.course_routes add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.route_combinations add column source_system text,add column source_external_id text,add column source_payload jsonb;
      insert into public.clubs(id,name,name_normalized,created_by) values('${club}','Club fixture','club fixture','${admin}');
      insert into public.course_routes(id,club_id,name,holes_count,total_par,source_system)
        values('${front}','${club}','Prime nove',9,36,'fig'),('${back}','${club}','Seconde nove',9,36,'gesgolf');
      insert into public.route_holes(route_id,physical_hole_number,par,stroke_index)
        select r,n,4,n from unnest(array['${front}'::uuid,'${back}'::uuid]) r cross join generate_series(1,9)n;
      insert into public.route_combinations(id,club_id,name,front_route_id,back_route_id,total_par,source_system,source_payload)
        values('${route}','${club}','Combinazione fixture','${front}','${back}',72,'fig','{"note":"Source fixture"}');
      insert into public.route_combination_holes(route_combination_id,round_hole_number,route_id,route_position,physical_hole_number,par,stroke_index,source_stroke_index,display_label)
        select '${route}',n,case when n<=9 then '${front}'::uuid else '${back}'::uuid end,
          case when n<=9 then 1 else 2 end,(n-1)%9+1,4,n,(n-1)%9+1,'Buca '||n from generate_series(1,18)n;
      insert into public.route_tees(route_id,tee_name,holes_count,par_total,course_rating,slope_rating)
        values('${front}','Gialli',9,36,35.5,123);
      insert into public.combination_tees(route_combination_id,tee_name,holes_count,par_total,course_rating,slope_rating)
        values('${route}','Gialli',18,72,72.1,125);
      alter table public.route_combination_holes enable row level security;
      grant select on public.route_combination_holes to authenticated;
      create policy existing_read on public.route_combination_holes for select to authenticated using(true);
    `);
    const original = await holes();
    const originalDependencies = await dependencies();
    const policies = (await db.query('select * from pg_policies order by tablename,policyname')).rows;
    for (const sql of migrations) await db.exec(sql);

    await t.test('migration preserves live schema, records, policies and grants; no fabricated workflow',async () => {
      assert.deepEqual(await holes(),original); assert.deepEqual(await dependencies(),originalDependencies);
      assert.deepEqual((await db.query('select * from pg_policies where tablename not like $1 order by tablename,policyname',['admin_catalog_%'])).rows,policies);
      assert.equal(await countVersions(),0);
      assert.equal((await db.query('select count(*)::integer n from public.admin_catalog_drafts')).rows[0].n,0);
      assert.equal((await db.query("select has_table_privilege('authenticated','public.route_combination_holes','UPDATE') allowed")).rows[0].allowed,false);
    });

    await t.test('anon, player, null authenticated identity and service_role cannot use RPCs/helpers',async () => {
      for (const [name,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',admin]]) {
        await role(name,uid);
        await fails(get,'42501'); await fails(open,'42501');
        await fails(()=>save({draft_id:route,revision:1},{holes:[]}),'42501');
        await fails(()=>publish({draft_id:route,revision:1}),'42501');
        await fails(()=>archive({draft_id:route,revision:1}),'42501');
        await fails(()=>db.query('select public.admin_hole_grid_context($1)',[route]),'42501');
        await fails(()=>db.query('select public.admin_hole_grid_lock_target($1)',[route]),'42501');
        if (name==='authenticated') assert.equal((await db.query('select * from public.admin_catalog_drafts')).rows.length,0);
      }
      await role();
    });

    let draft;
    await t.test('get does not create; open/resume creates exactly one whole-grid draft per owner',async () => {
      assert.equal((await get()).draft,null);
      const opened = await open(); draft = opened.draft;
      assert.equal(draft.entity_type,'combination_holes_grid'); assert.equal(draft.live_entity_id,route);
      assert.equal(draft.snapshot.holes.length,18); assert.equal(opened.context.holes[0].source_stroke_index,1);
      assert.equal((await open()).draft.draft_id,draft.draft_id);
      const concurrent=await Promise.all([open(),open()]);
      assert.equal(concurrent[0].draft.draft_id,concurrent[1].draft.draft_id);
      assert.equal((await get()).draft.draft_id,draft.draft_id);
      assert.equal(await countVersions(),0); assert.deepEqual(await holes(),original);
      await fails(()=>db.query('select public.admin_catalog_create_draft($1,$2::jsonb,$3)',
        ['combination_holes_grid','{"holes":[]}',route]),'22023');
    });

    await t.test('another Admin cannot save, publish, archive or generic-save owned grid',async () => {
      await role('authenticated',other);
      assert.equal((await get()).draft,null);
      await fails(()=>save(draft,draft.snapshot),'42501'); await fails(()=>publish(draft),'42501');
      await fails(()=>archive(draft),'40001');
      await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3::bigint)',[draft.draft_id,JSON.stringify(draft.snapshot),draft.revision]),'42501');
      await role();
    });

    await t.test('allowlist, immutable IDs/numbers, complete row set and integer ranges',async () => {
      const invalid = [];
      invalid.push({...draft.snapshot,source_payload:{}});
      for (const mutate of [
        s=>s.holes[0].route_id=back,s=>s.holes[0].display_label='Changed',s=>s.holes[0].source_stroke_index=18,
        s=>s.holes[0].id=route,s=>s.holes[0].round_hole_number=2,
        s=>s.holes[0]=clone(s.holes[1]),s=>s.holes.pop(),s=>s.holes[0].par=2,
        s=>s.holes[0].par=4.5,s=>s.holes[0].stroke_index=19,s=>s.holes[0].stroke_index='1'
      ]) {const s=clone(draft.snapshot); mutate(s); invalid.push(s);}
      for(const s of invalid) await fails(()=>save(draft,s),'22023');
      await fails(()=>publish(draft,null),'40001');
      assert.deepEqual(await holes(),original);
    });

    await t.test('save accepts incomplete/duplicate SI as draft; publish rejects missing essential data and wrong Par total',async () => {
      for(const mutate of [s=>s.holes[0].par=null,s=>s.holes[0].stroke_index=null,
        s=>s.holes[0].stroke_index=2,s=>s.holes[0].par=5]) {
        const s=clone(draft.snapshot); mutate(s); const old=draft;
        draft=await save(draft,s); await fails(()=>save(old,s),'40001');
        await fails(()=>publish(draft),'23514');
        assert.deepEqual(await holes(),original); assert.equal(await countVersions(),0);
        draft=await save(draft,{holes:original.map(h=>({id:h.id,round_hole_number:h.round_hole_number,par:h.par,stroke_index:h.stroke_index}))});
      }
      await fails(()=>publish(draft),'22023');
      await archive(draft);
    });

    await t.test('abandon only archives the saved grid; no live/version writes; next open starts fresh',async () => {
      await fails(()=>save(draft,draft.snapshot),'40001'); await fails(()=>publish(draft),'40001');
      assert.equal((await get()).draft,null); assert.deepEqual(await holes(),original); assert.equal(await countVersions(),0);
      const next=(await open()).draft; assert.notEqual(next.draft_id,draft.draft_id); draft=next;
      await archive(draft);
    });

    await t.test('conflict includes full live rows, dependent source holes, combination metadata and technical origins',async () => {
      for(const [sql,undo] of [
        ["update public.route_combination_holes set display_label='External' where round_hole_number=1","update public.route_combination_holes set display_label='Buca 1' where round_hole_number=1"],
        ["update public.route_holes set par=5 where route_id=$1 and physical_hole_number=1","update public.route_holes set par=4 where route_id=$1 and physical_hole_number=1"],
        ["update public.route_combinations set name='External'","update public.route_combinations set name='Combinazione fixture'"],
        ["update public.course_routes set name='External' where id=$1","update public.course_routes set name='Prime nove' where id=$1"]
      ]) {
        draft=(await open()).draft; draft=await save(draft,changed(draft));
        await db.exec('reset role'); await db.query(sql,sql.includes('$1')?[front]:[]);
        await role(); await fails(()=>publish(draft),'40001'); await archive(draft);
        await db.exec('reset role'); await db.query(undo,undo.includes('$1')?[front]:[]); await role();
      }
      assert.deepEqual(await holes(),original); assert.equal(await countVersions(),0);
    });

    await t.test('missing rows, duplicate physical origins and invalid origin references block publication',async () => {
      for(const mutate of [
        "delete from public.route_combination_holes where round_hole_number=18",
        "update public.route_combination_holes set physical_hole_number=2 where round_hole_number=1",
        `update public.route_combination_holes set route_id='${back}' where round_hole_number=1`,
        "update public.route_combination_holes set route_position=2 where round_hole_number=1"
      ]) {
        await db.exec('reset role'); await db.exec(mutate); await role();
        draft=(await open()).draft; draft=await save(draft,changed(draft));
        await fails(()=>publish(draft),'23514'); await archive(draft);
        await db.exec('reset role');
        // Restore only isolated test rows with their original IDs and all real fields.
        await db.exec('delete from public.route_combination_holes');
        await db.query(`insert into public.route_combination_holes select * from jsonb_populate_recordset(null::public.route_combination_holes,$1::jsonb)`,[JSON.stringify(original)]);
        await role();
      }
    });

    await t.test('a history insertion failure rolls back every live hole and leaves draft open',async () => {
      draft=(await open()).draft; draft=await save(draft,changed(draft));
      await db.exec('reset role');
      await db.exec(`create function public.fixture_fail_history() returns trigger language plpgsql as $$ begin raise exception 'fixture rollback' using errcode='P0001'; end; $$;
        create trigger fixture_fail_history before insert on public.admin_catalog_versions for each row execute function public.fixture_fail_history();`);
      await role(); await fails(()=>publish(draft),'P0001');
      assert.deepEqual(await holes(),original); assert.equal(await countVersions(),0);
      assert.equal((await get()).draft.workflow_status,'draft');
      await db.exec('reset role'); await db.exec('drop trigger fixture_fail_history on public.admin_catalog_versions'); await role();
      await archive(draft);
    });

    await t.test('atomic multi-row publish records a single immutable grid version and closes draft',async () => {
      draft=(await open()).draft;
      const s=changed(draft); s.holes[0].par=3; s.holes[1].par=5;
      draft=await save(draft,s);
      await role('authenticated',other); const competing=(await open()).draft;
      await role();
      const result=await publish(draft);
      assert.equal(result.route_id,route); assert.equal(result.version_number,1); assert.equal(result.diff.holes.length,2);
      const rows=await holes();
      assert.equal(rows[0].par,3); assert.equal(rows[1].par,5); assert.equal(rows[0].stroke_index,2); assert.equal(rows[1].stroke_index,1);
      assert.deepEqual(rows.map(({par,stroke_index,...rest})=>rest),original.map(({par,stroke_index,...rest})=>rest));
      assert.deepEqual(rows.slice(2),original.slice(2));
      assert.equal((await get()).draft,null);
      await fails(()=>publish(draft),'40001'); await fails(()=>save(draft,draft.snapshot),'40001');
      await role('authenticated',other);
      const otherSaved=await save(competing,changed(competing)); await fails(()=>publish(otherSaved),'40001'); await archive(otherSaved);
      await db.exec('reset role');
      const version=(await db.query('select * from public.admin_catalog_versions')).rows[0];
      assert.equal(version.entity_type,'combination_holes_grid'); assert.equal(version.published_by,admin); assert.ok(version.published_at);
      assert.deepEqual(version.snapshot,draft.snapshot); assert.deepEqual(version.diff,result.diff);
      assert.equal((await db.query('select workflow_status from public.admin_catalog_drafts where draft_id=$1',[draft.draft_id])).rows[0].workflow_status,'published');
      await fails(()=>db.exec("update public.admin_catalog_versions set diff='{}'"),'55000');
      await fails(()=>db.exec('delete from public.admin_catalog_versions'),'55000');
      assert.deepEqual(await dependencies(),originalDependencies);
      await role();
      const next=(await open()).draft; assert.equal(next.base_version_id,version.version_id);
      assert.equal(next.snapshot.holes[0].par,3); await archive(next);
    });

    await t.test('simultaneous saves of one revision allow only one result; second publication advances lineage',async () => {
      draft=(await open()).draft;
      const s=clone(draft.snapshot); s.holes[0].stroke_index=1; s.holes[1].stroke_index=2;
      const outcomes=await Promise.allSettled([save(draft,s),save(draft,s)]);
      assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(outcomes.find(r=>r.status==='rejected').reason.code,'40001');
      const saved=outcomes.find(r=>r.status==='fulfilled').value;
      assert.equal((await publish(saved)).version_number,2);
      await role('authenticated',player);
      assert.deepEqual((await db.query('select * from public.admin_catalog_drafts')).rows,[]);
      assert.deepEqual((await db.query('select * from public.admin_catalog_versions')).rows,[]);
      await fails(()=>db.query('select * from public.admin_hole_grid_save_draft($1,$2::jsonb,$3::bigint)',[saved.draft_id,JSON.stringify(s),saved.revision]),'42501');
      await role();
    });
  } finally { await db.close(); }
});
