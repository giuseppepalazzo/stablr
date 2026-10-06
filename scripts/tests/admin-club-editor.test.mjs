// PostgreSQL in-memory integration tests; fixtures only, no remote connections.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const foundation = await readFile(new URL('../../supabase/admin-catalog-workflow.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../supabase/admin-club-editor.sql', import.meta.url), 'utf8');
const admin = '11111111-1111-4111-8111-111111111111';
const secondAdmin = '22222222-2222-4222-8222-222222222222';
const player = '33333333-3333-4333-8333-333333333333';
const clubId = '44444444-4444-4444-8444-444444444444';

test('existing Club editor publication contract', async (t) => {
  const db = new PGlite();
  const asRole = async (role, uid = '') => {
    await db.exec(`reset role; set role ${role};`);
    await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [uid, role]);
  };
  const open = async () => (await db.query('select * from public.admin_club_open_draft($1)', [clubId])).rows[0];
  const save = async (draft, snapshot) => (await db.query('select * from public.admin_club_save_draft($1, $2::jsonb, $3::bigint)', [draft.draft_id, JSON.stringify(snapshot), draft.revision])).rows[0];
  const publish = async (draft) => (await db.query('select public.admin_club_publish_draft($1, $2::bigint) as result', [draft.draft_id, draft.revision])).rows[0].result;
  const fails = (fn, code) => assert.rejects(fn, (error) => error.code === code);
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create table public.profiles (id uuid primary key references auth.users, role text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
      create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), ''); $$;
      grant usage on schema auth to anon, authenticated, service_role;
      create function public.is_admin() returns boolean language sql stable security definer set search_path = pg_catalog as $$
        select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
      $$;
      insert into auth.users values ('${admin}'), ('${secondAdmin}'), ('${player}');
      insert into public.profiles values ('${admin}', 'admin'), ('${secondAdmin}', 'admin'), ('${player}', 'user');
      create table public.clubs (
        id uuid primary key, name text not null, city text, name_normalized text not null,
        is_active boolean not null default true, data_status text, playable boolean,
        source_type text, source_payload jsonb, fig_club_id uuid, fig_match_status text,
        updated_at timestamptz not null default now()
      );
      insert into public.clubs values ('${clubId}', 'Club fixture', null, 'club fixture', true,
        'needs_review', true, 'fig_import', '{"figClubCode":"FIG-1"}', '${player}', 'matched', now());
      create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
      create trigger clubs_set_updated_at before update on public.clubs for each row execute function public.set_updated_at();
      create table public.course_routes (id uuid primary key);
      create table public.route_combinations (id uuid primary key);
      create table public.route_holes (id uuid primary key);
      create table public.route_combination_holes (id uuid primary key);
      create table public.route_tees (id uuid primary key);
      create table public.combination_tees (id uuid primary key);
    `);
    const original = (await db.query('select * from public.clubs')).rows[0];
    await db.exec(foundation);
    await db.exec(migration);
    let draft;
    let otherDraft;

    await t.test('migration adds no fake drafts or published versions', async () => {
      assert.equal((await db.query('select count(*)::int as n from public.admin_catalog_drafts')).rows[0].n, 0);
      assert.equal((await db.query('select count(*)::int as n from public.admin_catalog_versions')).rows[0].n, 0);
    });

    await t.test('Admin opens and resumes a server-based draft without changing live', async () => {
      await asRole('authenticated', admin);
      draft = await open();
      const resumed = await open();
      assert.equal(resumed.draft_id, draft.draft_id);
      assert.deepEqual(draft.base_snapshot, { name: 'Club fixture', city: null });
      assert.deepEqual(draft.snapshot, draft.base_snapshot);
      await db.exec('reset role');
      assert.deepEqual((await db.query('select * from public.clubs')).rows[0], original);
      await asRole('authenticated', admin);
      await fails(() => publish(draft), '22023');
    });

    await t.test('saves only allowed fields and rejects malformed and technical payloads', async () => {
      for (const payload of [[], {}, { name: '', city: null }, { name: 'Club', city: 5 },
        { name: 'Club', city: null, fig_club_id: player }, { name: 'Club', city: null, data_status: 'verified' },
        { name: 'Club', city: null, playable: false }, { name: 'Club', city: null, source_type: 'stablr' }]) {
        await fails(() => save(draft, payload), '22023');
      }
      const initial = draft;
      draft = await save(draft, { name: ' Club nuovo ', city: ' Roma ' });
      assert.deepEqual(draft.snapshot, { name: 'Club nuovo', city: 'Roma' });
      assert.deepEqual(draft.base_snapshot, initial.base_snapshot);
      await fails(() => save(initial, { name: 'Stale', city: null }), '40001');
      await db.exec('reset role');
      assert.deepEqual((await db.query('select * from public.clubs')).rows[0], original);
    });

    await t.test('player, anon and service API cannot invoke Club editor RPCs', async () => {
      for (const [role, uid] of [['anon', ''], ['authenticated', player], ['service_role', '']]) {
        await asRole(role, uid);
        await fails(() => open(), '42501');
        await fails(() => db.query('select public.admin_club_get_draft($1)', [clubId]), '42501');
        await fails(() => save(draft, { name: 'Denied', city: null }), '42501');
        await fails(() => publish(draft), '42501');
      }
    });

    await t.test('another Admin cannot save or publish an owned editor draft', async () => {
      await asRole('authenticated', secondAdmin);
      await fails(() => save(draft, { name: 'Denied', city: null }), '42501');
      await fails(() => publish(draft), '42501');
      await fails(() => db.query('select public.admin_catalog_save_draft($1, $2::jsonb, $3::bigint)', [draft.draft_id, '{"name":"Generic denied","city":null}', draft.revision]), '42501');
      otherDraft = await open();
      assert.notEqual(otherDraft.draft_id, draft.draft_id);
      await asRole('authenticated', admin);
    });

    await t.test('generic draft creation cannot spoof the server baseline for publication', async () => {
      const forged = (await db.query('select * from public.admin_catalog_create_draft($1, $2::jsonb, $3)', ['club', '{"name":"Forged","city":null}', clubId])).rows[0];
      await fails(() => publish(forged), '22023');
      await fails(() => db.query("update public.admin_catalog_drafts set base_snapshot = '{}' where draft_id = $1", [draft.draft_id]), '42501');
    });

    await t.test('publication commits only name/city, immutable version/diff, and closed draft', async () => {
      const result = await publish(draft);
      assert.equal(result.club.name, 'Club nuovo');
      assert.equal(result.club.city, 'Roma');
      assert.deepEqual(result.diff, { name: { before: 'Club fixture', after: 'Club nuovo' }, city: { before: null, after: 'Roma' } });
      const closed = (await db.query('select * from public.admin_catalog_drafts where draft_id = $1', [draft.draft_id])).rows[0];
      assert.equal(closed.workflow_status, 'published');
      const version = (await db.query('select * from public.admin_catalog_versions where version_id = $1', [result.version_id])).rows[0];
      assert.equal(version.published_by, admin);
      assert.ok(version.published_at);
      assert.deepEqual(version.diff, result.diff);
      assert.deepEqual(version.snapshot, draft.snapshot);
      await fails(() => publish(draft), '40001');
      await fails(() => save(draft, { name: 'Closed', city: null }), '40001');
      await db.exec('reset role');
      const live = (await db.query('select * from public.clubs')).rows[0];
      for (const key of ['name_normalized', 'data_status', 'playable', 'source_type', 'source_payload', 'fig_club_id', 'fig_match_status']) assert.deepEqual(live[key], original[key]);
      await fails(() => db.query("update public.admin_catalog_versions set diff = '{}'"), '55000');
    });

    await t.test('publication rejects another Admin draft based on the earlier live record', async () => {
      await asRole('authenticated', secondAdmin);
      otherDraft = await save(otherDraft, { name: 'Club concorrente', city: null });
      await fails(() => publish(otherDraft), '40001');
      await asRole('authenticated', admin);
      draft = await open();
      assert.ok(draft.base_version_id);
      assert.equal(draft.base_snapshot.name, 'Club nuovo');
    });

    await t.test('external catalog changes block publication without partial writes', async () => {
      draft = await save(draft, { name: 'Next', city: 'Milano' });
      await db.exec('reset role');
      await db.query("update public.clubs set city = 'External' where id = $1", [clubId]);
      const before = (await db.query('select * from public.clubs')).rows[0];
      await asRole('authenticated', admin);
      await fails(() => publish(draft), '40001');
      assert.equal((await db.query('select count(*)::int as n from public.admin_catalog_versions')).rows[0].n, 1);
      assert.equal((await db.query('select workflow_status from public.admin_catalog_drafts where draft_id = $1', [draft.draft_id])).rows[0].workflow_status, 'draft');
      await db.exec('reset role');
      assert.deepEqual((await db.query('select * from public.clubs')).rows[0], before);
    });

    await t.test('version insertion failure rolls back live update and draft closure', async () => {
      // Reset the live record to this draft's captured base only within the test DB.
      await db.exec('alter table public.clubs disable trigger clubs_set_updated_at');
      await db.query('update public.clubs set name = $1, city = $2, updated_at = $3 where id = $4', [draft.base_snapshot.name, draft.base_snapshot.city, draft.base_live_updated_at, clubId]);
      await db.exec('alter table public.clubs enable trigger clubs_set_updated_at');
      await db.exec("create function public.test_reject_version() returns trigger language plpgsql as $$ begin raise exception 'Fixture failure' using errcode = '23514'; end; $$; create trigger test_reject_version before insert on public.admin_catalog_versions for each row execute function public.test_reject_version();");
      const before = (await db.query('select * from public.clubs')).rows[0];
      await asRole('authenticated', admin);
      await fails(() => publish(draft), '23514');
      await db.exec('reset role');
      assert.deepEqual((await db.query('select * from public.clubs')).rows[0], before);
      assert.equal((await db.query('select workflow_status from public.admin_catalog_drafts where draft_id = $1', [draft.draft_id])).rows[0].workflow_status, 'draft');
      await db.exec('drop trigger test_reject_version on public.admin_catalog_versions');
    });

    await t.test('two confirmations publish a single second version', async () => {
      await asRole('authenticated', admin);
      const results = await Promise.allSettled([publish(draft), publish(draft)]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.find((result) => result.status === 'fulfilled').value.version_number, 2);
      assert.equal(results.find((result) => result.status === 'rejected').reason.code, '40001');
      assert.equal((await db.query('select count(*)::int as n from public.admin_catalog_versions')).rows[0].n, 2);
    });
  } finally { await db.close(); }
});
