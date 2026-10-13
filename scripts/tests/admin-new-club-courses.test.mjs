// Isolated PostgreSQL. All identities/catalog/source records are test fixtures.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const sql = async name => readFile(new URL(`../../supabase/${name}.sql`, import.meta.url), 'utf8');
const migration = await sql('admin-new-club-courses');
const admin = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const player = '33333333-3333-4333-8333-333333333333', liveId = '44444444-4444-4444-8444-444444444444';
test('private new Club courses: ownership, domain, revisions, archival and unchanged catalog', async t => {
  const db = new PGlite();
  const role = async (name, uid = '') => {
    await db.exec(`reset role; set role ${name}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [uid,name]);
  };
  const createParent = async (snapshot = { name: 'Privato', city: null }) =>
    (await db.query("select * from public.admin_catalog_create_draft('club',$1::jsonb)", [JSON.stringify(snapshot)])).rows[0];
  const fields = { name: 'Percorso', holes_count: 9, display_order: 0 };
  const list = async parent => (await db.query('select * from public.admin_new_club_courses($1)', [parent.draft_id])).rows;
  const save = async (parent, child = null, snapshot = fields, revision = child?.revision ?? null) =>
    (await db.query('select * from public.admin_new_club_course_save($1,$2::jsonb,$3,$4::bigint)',
      [parent.draft_id, JSON.stringify(snapshot), child?.draft_id ?? null, revision])).rows[0];
  const archive = async (parent, child) => (await db.query('select * from public.admin_new_club_course_archive($1,$2,$3::bigint)', [parent.draft_id,child.draft_id,child.revision])).rows[0];
  const fails = (fn, code) => assert.rejects(fn, e => e.code === code);
  const unchanged = async () => {
    await db.exec('reset role');
    for (const table of ['clubs','course_routes','route_holes','route_tees','route_combinations','route_combination_holes','combination_tees','rounds','round_holes']) {
      assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n, 1, table);
    }
    assert.equal((await db.query('select count(*)::int n from public.admin_catalog_versions')).rows[0].n, 0);
    assert.equal((await db.query('select name from public.clubs')).rows[0].name, 'Live fixture');
  };
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users (id uuid primary key);
      create table public.profiles (id uuid primary key references auth.users,role text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
      create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),''); $$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function public.is_admin() returns boolean language sql stable security definer set search_path = pg_catalog as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;
      insert into auth.users values ('${admin}'),('${other}'),('${player}');
      insert into public.profiles values ('${admin}','admin'),('${other}','admin'),('${player}','user');
      create table public.clubs (id uuid primary key,name text,city text,is_active boolean,updated_at timestamptz default now());
      insert into public.clubs values ('${liveId}','Live fixture',null,true,now());
      create table public.course_routes (id uuid primary key,club_id uuid,name text,holes_count integer,total_par integer,display_order integer,is_active boolean,source_system text,source_external_id text,source_payload jsonb,updated_at timestamptz);
      create table public.route_holes (id uuid primary key,route_id uuid,par integer,stroke_index integer);
      create table public.route_tees (id uuid primary key,route_id uuid,holes_count integer,is_active boolean);
      create table public.route_combinations (id uuid primary key,front_route_id uuid,back_route_id uuid,is_active boolean);
      create table public.route_combination_holes (id uuid primary key,route_id uuid);
      create table public.combination_tees (id uuid primary key);
      create table public.rounds (id uuid primary key,selected_routes jsonb);
      create table public.round_holes (id uuid primary key,route_id uuid);
      insert into public.course_routes (id,club_id,name,holes_count,is_active) values ('${liveId}','${liveId}','Live course',9,true);
      insert into public.route_holes (id,route_id,par,stroke_index) values ('${liveId}','${liveId}',4,1);
      insert into public.route_tees (id) values ('${liveId}');
      insert into public.route_combinations (id) values ('${liveId}');
      insert into public.route_combination_holes (id) values ('${liveId}');
      insert into public.combination_tees values ('${liveId}');
      insert into public.rounds (id) values ('${liveId}');
      insert into public.round_holes (id) values ('${liveId}');
    `);
    for (const name of ['admin-catalog-workflow','admin-club-editor','admin-course-editor','admin-catalog-abandon-draft']) await db.exec(await sql(name));
    const policies = (await db.query('select * from pg_policies')).rows;
    await db.exec(migration);
    let parent, figParent, child, second;
    await t.test('one-shot migration creates only functions/scoped guard, no rows or permission widening', async () => {
      assert.deepEqual((await db.query('select * from pg_policies')).rows, policies);
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_drafts')).rows[0].n, 0);
      for (const name of ['admin_new_club_course_snapshot(jsonb)','admin_new_club_course_parent(uuid,boolean)','admin_new_club_course_guard()']) {
        assert.equal((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') allowed", ['public.'+name])).rows[0].allowed, false);
      }
      for (const api of ['anon','authenticated','service_role']) for (const permission of ['INSERT','UPDATE','DELETE','TRUNCATE'])
        assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed', [api,'public.admin_catalog_drafts',permission])).rows[0].allowed, false);
      await unchanged();await role('authenticated',admin);
      parent = await createParent();figParent = await createParent({ name: 'Fonte FIG', city: null, fig_source: { id: 'source-fixture', name: 'Fonte FIG' } });
    });
    await t.test('list is read-only; manual and FIG parent create only null-live child drafts', async () => {
      await db.exec('begin read only');assert.deepEqual(await list(parent), []);await db.exec('commit');
      child = await save(parent);second = await save(parent,null,{ name:'Secondo',holes_count:18,display_order:-1 });
      await save(figParent);
      assert.equal(child.entity_type,'route');assert.equal(child.live_entity_id,null);
      assert.equal(child.parent_draft_id,parent.draft_id);assert.equal(child.base_snapshot,null);
      assert.equal(child.created_by,admin);assert.equal(child.base_version_id,null);
      assert.deepEqual((await list(parent)).map(row=>row.draft_id), [second.draft_id,child.draft_id]);
      await unchanged();await role('authenticated',admin);
    });
    await t.test('allowlist and required 9/18/name/order reject malformed snapshots without partial writes', async () => {
      const before = (await list(parent)).length;
      for (const snapshot of [null,[],{}, { ...fields,name:'' },{ ...fields,name:'x'.repeat(201) },
        { ...fields,holes_count:12 },{ ...fields,holes_count:'9' },{ ...fields,holes_count:null },
        { ...fields,display_order:1.1 },{ ...fields,display_order:null },{ ...fields,display_order:'2' },{ ...fields,display_order:2147483648 },
        ...['is_active','club_id','route_holes','tees','course_rating','source_payload'].map(key=>({ ...fields,[key]:true }))])
        await fails(()=>save(parent,null,snapshot),'22023');
      assert.equal((await list(parent)).length,before);
    });
    await t.test('anon/player/service/missing identity and another Admin are denied all child RPCs', async () => {
      for (const [name,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',''],['service_role',admin],['authenticated',other]]) {
        await role(name,uid);
        await fails(()=>list(parent),'42501');await fails(()=>save(parent),'42501');await fails(()=>archive(parent,child),'42501');
      }
      await role('authenticated',other);const otherParent = await createParent();
      await fails(()=>save(otherParent,child),'42501');await fails(()=>archive(otherParent,child),'42501');
      await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3)', [child.draft_id,JSON.stringify(fields),child.revision]),'42501');
      await fails(()=>db.query("select public.admin_catalog_create_draft('route',$1::jsonb,null,$2)", [JSON.stringify(fields),parent.draft_id]),'42501');
      await role('authenticated',admin);
    });
    await t.test('renaming/reordering use optimistic revision; stale saves lose no data', async () => {
      const old = child;
      child = await save(parent,child,{ name:' Rinominato ',holes_count:18,display_order:3 });
      assert.deepEqual(child.snapshot,{ name:'Rinominato',holes_count:18,display_order:3 });
      assert.equal(child.revision,old.revision+1);
      await fails(()=>save(parent,old),'40001');await fails(()=>save(parent,child,fields,null),'22023');
      const race = await Promise.allSettled([save(parent,child),save(parent,child)]);
      assert.equal(race.filter(value=>value.status==='fulfilled').length,1);
      assert.equal(race.find(value=>value.status==='rejected').reason.code,'40001');
      child = race.find(value=>value.status==='fulfilled').value;
    });
    await t.test('generic RPC cannot add live fields, change owner, or publish these children', async () => {
      await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3)', [child.draft_id,JSON.stringify({ ...fields,is_active:true }),child.revision]),'22023');
      await fails(()=>db.query('select public.admin_course_publish_draft($1,$2)', [child.draft_id,child.revision]),'42501');
      const liveDraft = (await db.query("select * from public.admin_catalog_create_draft('route',$1::jsonb,$2)", [JSON.stringify(fields),liveId])).rows[0];
      await fails(()=>save(parent,liveDraft),'42501');
      const liveParent = (await db.query("select * from public.admin_catalog_create_draft('club',$1::jsonb,$2)", [JSON.stringify(parent.snapshot),liveId])).rows[0];
      await fails(()=>save(liveParent),'42501');
    });
    await t.test('archive retains the record, hides only this child and never creates a published version', async () => {
      const old = second;second = await archive(parent,second);
      assert.equal(second.workflow_status,'archived');assert.equal(second.revision,old.revision+1);
      assert.deepEqual((await list(parent)).map(row=>row.draft_id),[child.draft_id]);
      await fails(()=>save(parent,second),'40001');await fails(()=>archive(parent,old),'40001');
      await unchanged();await role('authenticated',admin);
    });
    await t.test('archived parent blocks all child changes; child and parent remain retained', async () => {
      await db.query("select public.admin_catalog_archive_draft($1,'club',$2)", [parent.draft_id,parent.revision]);
      await fails(()=>list(parent),'40001');await fails(()=>save(parent),'40001');await fails(()=>archive(parent,child),'40001');
      await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3)', [child.draft_id,JSON.stringify(fields),child.revision]),'40001');
      await unchanged();
      assert.equal((await db.query('select workflow_status from public.admin_catalog_drafts where draft_id=$1',[child.draft_id])).rows[0].workflow_status,'draft');
    });
    await t.test('no historic migration is modified or reapplied; second application rolls back', async () => {
      const before = (await db.query('select count(*)::int n from public.admin_catalog_drafts')).rows[0].n;
      await fails(()=>db.exec(migration),'42723');await db.exec('rollback');
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_drafts')).rows[0].n,before);
    });
  } finally { await db.close(); }
});
