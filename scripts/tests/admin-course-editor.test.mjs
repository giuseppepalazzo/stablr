// Local PostgreSQL only. All users/catalog rows below are test fixtures.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const foundation = await readFile(new URL('../../supabase/admin-catalog-workflow.sql', import.meta.url), 'utf8');
const clubMigration = await readFile(new URL('../../supabase/admin-club-editor.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../supabase/admin-course-editor.sql', import.meta.url), 'utf8');
const abandonMigration = await readFile(new URL('../../supabase/admin-catalog-abandon-draft.sql', import.meta.url), 'utf8');
const admin = '11111111-1111-4111-8111-111111111111';
const secondAdmin = '22222222-2222-4222-8222-222222222222';
const player = '33333333-3333-4333-8333-333333333333';
const clubId = '44444444-4444-4444-8444-444444444444';
const courseId = '55555555-5555-4555-8555-555555555555';
const otherCourseId = '66666666-6666-4666-8666-666666666666';

test('existing Percorso editor atomic publication and security', async (t) => {
  const db = new PGlite();
  const asRole = async (role, uid = '') => {
    await db.exec(`reset role; set role ${role};`);
    await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [uid, role]);
  };
  const open = async (id = courseId) => (await db.query('select public.admin_course_open_draft($1) as result', [id])).rows[0].result;
  const save = async (draft, snapshot) => (await db.query('select * from public.admin_course_save_draft($1, $2::jsonb, $3::bigint)', [draft.draft_id, JSON.stringify(snapshot), draft.revision])).rows[0];
  const publish = async (draft, revision = draft.revision) => (await db.query('select public.admin_course_publish_draft($1, $2::bigint) as result', [draft.draft_id, revision])).rows[0].result;
  const fails = (fn, code) => assert.rejects(fn, (error) => error.code === code);
  const live = async (id = courseId) => (await db.query('select * from public.course_routes where id = $1', [id])).rows[0];
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
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
      create table public.clubs (id uuid primary key, name text not null, city text, is_active boolean default true, updated_at timestamptz default now());
      insert into public.clubs values ('${clubId}', 'Club fixture', null, true, now());
      create table public.course_routes (
        id uuid primary key, club_id uuid references public.clubs, name text not null,
        holes_count integer not null check (holes_count in (9,18)), total_par integer,
        display_order integer, is_active boolean not null default true,
        source_system text, source_external_id text, source_payload jsonb,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      );
      insert into public.course_routes (id,club_id,name,holes_count,display_order,source_system,source_external_id,source_payload)
        values ('${courseId}','${clubId}','Percorso fixture',9,0,'fig','FIG-route-1',
          '{"fig_display_name":"Originale FIG","gesgolf":{"route_name":"Originale GesGolf","percorso_id":42}}'),
          ('${otherCourseId}','${clubId}','Altro percorso',9,null,'stablr',null,null);
      create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
      create trigger course_routes_set_updated_at before update on public.course_routes for each row execute function public.set_updated_at();
      create table public.route_holes (id uuid primary key default gen_random_uuid(), route_id uuid references public.course_routes, par integer, stroke_index integer);
      create table public.route_tees (id uuid primary key default gen_random_uuid(), route_id uuid references public.course_routes, holes_count integer, is_active boolean);
      create table public.route_combinations (id uuid primary key default gen_random_uuid(), front_route_id uuid references public.course_routes, back_route_id uuid references public.course_routes, is_active boolean);
      create table public.route_combination_holes (id uuid primary key default gen_random_uuid(), route_id uuid references public.course_routes);
      create table public.combination_tees (id uuid primary key);
      create table public.rounds (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users, selected_routes jsonb not null default '[]');
      create table public.round_holes (id uuid primary key default gen_random_uuid(), route_id uuid references public.course_routes);
      alter table public.course_routes enable row level security;
      grant select on public.course_routes to authenticated;
      create policy existing_course_read on public.course_routes for select to authenticated using (true);
    `);
    const original = await live();
    const policiesBefore = (await db.query("select * from pg_policies where tablename = 'course_routes'")).rows;
    await db.exec(foundation);
    await db.exec(clubMigration);
    await db.exec(migration);
    await db.exec(abandonMigration);
    let draft;
    let otherDraft;

    await t.test('no backfill and no live grants or policy changes', async () => {
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_drafts')).rows[0].n, 0);
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_versions')).rows[0].n, 0);
      assert.deepEqual((await db.query("select * from pg_policies where tablename = 'course_routes'")).rows, policiesBefore);
      assert.equal((await db.query("select has_table_privilege('authenticated','public.course_routes','UPDATE') as allowed")).rows[0].allowed, false);
    });

    await t.test('open/resume captures server live and source context, makes no version', async () => {
      await asRole('authenticated', admin);
      const opened = await open();
      draft = opened.draft;
      assert.equal((await open()).draft.draft_id, draft.draft_id);
      assert.equal(opened.context.can_edit_structure, true);
      assert.equal(opened.context.original_name, 'Originale FIG');
      assert.equal(opened.context.gesgolf_name, 'Originale GesGolf');
      assert.equal(draft.entity_type, 'route');
      assert.equal(draft.base_snapshot._context.club_id, clubId);
      assert.deepEqual(await live(), original);
      await fails(() => publish(draft), '22023');
    });

    await t.test('exact typed allowlist and 9/18 validation, draft CAS', async () => {
      for (const payload of [null, [], {}, { ...draft.snapshot, name: '' },
        { ...draft.snapshot, name: 'x'.repeat(201) }, { ...draft.snapshot, holes_count: 12 },
        { ...draft.snapshot, holes_count: '18' }, { ...draft.snapshot, holes_count: null },
        { ...draft.snapshot, display_order: 1.5 }, { ...draft.snapshot, display_order: 2147483648 },
        { ...draft.snapshot, display_order: '2' }, { ...draft.snapshot, is_active: 'false' },
        ...['source_payload','club_id','source_external_id','total_par','fig_club_id','notes','aliases'].map((key) => ({ ...draft.snapshot, [key]: 'forbidden' }))]) {
        await fails(() => save(draft, payload), '22023');
      }
      const first = draft;
      draft = await save(draft, { name: ' Nuovo percorso ', holes_count: 18, display_order: null, is_active: false });
      assert.deepEqual(draft.snapshot, { name: 'Nuovo percorso', holes_count: 18, display_order: null, is_active: false });
      assert.deepEqual(draft.base_snapshot, first.base_snapshot);
      await fails(() => save(first, first.snapshot), '40001');
      assert.deepEqual(await live(), original);
    });

    await t.test('player/anon/service denied all RPCs and private helpers', async () => {
      for (const [role, uid] of [['anon',''], ['authenticated',player], ['service_role','']]) {
        await asRole(role, uid);
        await fails(() => open(), '42501');
        await fails(() => db.query('select public.admin_course_get_draft($1)', [courseId]), '42501');
        await fails(() => save(draft, draft.snapshot), '42501');
        await fails(() => publish(draft), '42501');
        await fails(() => db.query('select public.admin_course_structure_editable($1)', [courseId]), '42501');
        if (role === 'authenticated') {
          assert.deepEqual(await live(), original);
          assert.equal((await db.query('select * from public.admin_catalog_drafts')).rows.length, 0);
          assert.equal((await db.query('select * from public.admin_catalog_versions')).rows.length, 0);
        }
      }
    });

    await t.test('another Admin cannot edit owner draft, including generic saver', async () => {
      await asRole('authenticated', secondAdmin);
      assert.equal((await db.query('select (public.admin_course_get_draft($1)).draft_id id', [courseId])).rows[0].id, null);
      await fails(() => save(draft, draft.snapshot), '42501');
      await fails(() => publish(draft), '42501');
      await fails(() => db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3::bigint)', [draft.draft_id, JSON.stringify(draft.snapshot), draft.revision]), '42501');
      otherDraft = (await open()).draft;
      await asRole('authenticated', admin);
    });

    await t.test('generic workflows cannot spoof base, schema, identity or allowlist', async () => {
      const generic = (await db.query('select * from public.admin_catalog_create_draft($1,$2::jsonb,$3)', ['route', JSON.stringify(draft.snapshot), courseId])).rows[0];
      await fails(() => publish(generic), '42501');
      await fails(() => db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3::bigint)', [draft.draft_id, JSON.stringify({ ...draft.snapshot, source_system: 'other' }), draft.revision]), '22023');
      await fails(() => db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3::bigint,2)', [draft.draft_id, JSON.stringify(draft.snapshot), draft.revision]), '22023');
      await fails(() => db.query("update public.admin_catalog_drafts set base_snapshot = '{}' where draft_id = $1", [draft.draft_id]), '42501');
    });

    await t.test('atomic publication updates only four fields, closes draft, immutable diff', async () => {
      const result = await publish(draft);
      assert.deepEqual(result.diff, {
        name: { before: original.name, after: 'Nuovo percorso' },
        holes_count: { before: 9, after: 18 }, display_order: { before: 0, after: null },
        is_active: { before: true, after: false }
      });
      assert.equal(result.course.is_active, false);
      const updated = await live();
      for (const key of ['club_id','total_par','source_system','source_external_id','source_payload','created_at']) assert.deepEqual(updated[key], original[key]);
      const version = (await db.query('select * from public.admin_catalog_versions where version_id = $1', [result.version_id])).rows[0];
      assert.deepEqual(version.snapshot, draft.snapshot);
      assert.deepEqual(version.diff, result.diff);
      assert.equal(version.published_by, admin);
      assert.ok(version.published_at);
      assert.equal((await db.query('select workflow_status from public.admin_catalog_drafts where draft_id = $1', [draft.draft_id])).rows[0].workflow_status, 'published');
      await fails(() => publish(draft), '40001');
      await fails(() => save(draft, draft.snapshot), '40001');
      await db.exec('reset role');
      await fails(() => db.query("update public.admin_catalog_versions set diff = '{}'"), '55000');
      await asRole('authenticated', secondAdmin);
      otherDraft = await save(otherDraft, { ...otherDraft.snapshot, name: 'Conflicting Admin' });
      await fails(() => publish(otherDraft), '40001');
    });

    await t.test('inactive live course can be reopened and reactivated, no deletion', async () => {
      await asRole('authenticated', admin);
      draft = (await open()).draft;
      assert.ok(draft.base_version_id);
      assert.equal(draft.snapshot.is_active, false);
      draft = await save(draft, { ...draft.snapshot, is_active: true, display_order: 3 });
      const result = await publish(draft);
      assert.equal(result.course.is_active, true);
      assert.equal(result.version_number, 2);
    });

    await t.test('each real dependency, even inactive, blocks changing structure', async () => {
      await db.exec('reset role');
      const dependencies = [
        ["insert into public.route_holes(route_id,par,stroke_index) values ($1,4,1)", 'route_holes'],
        ["insert into public.route_tees(route_id,holes_count,is_active) values ($1,9,false)", 'route_tees'],
        [`insert into public.route_combinations(front_route_id,back_route_id,is_active) values ($1,'${otherCourseId}',false)`, 'route_combinations'],
        ["insert into public.route_combination_holes(route_id) values ($1)", 'route_combination_holes'],
        ["insert into public.round_holes(route_id) values ($1)", 'round_holes'],
        ["insert into public.rounds(selected_routes) values (jsonb_build_array(jsonb_build_object('route_id',$1::text)))", 'rounds']
      ];
      await asRole('authenticated', admin);
      draft = (await open()).draft;
      draft = await save(draft, { ...draft.snapshot, holes_count: 9 });
      for (const [insert, table] of dependencies) {
        await db.exec('reset role');
        await db.query(insert, [courseId]);
        const before = await live();
        await asRole('authenticated', admin);
        assert.equal((await open()).context.can_edit_structure, false);
        await fails(() => publish(draft), '23514');
        assert.deepEqual(await live(), before);
        await db.exec(`reset role; delete from public.${table};`);
      }
      // No dependencies: the same draft can publish without changing children.
      await asRole('authenticated', admin);
      assert.equal((await publish(draft)).course.holes_count, 9);
    });

    await t.test('source/derived configuration prevents structural editing', async () => {
      await db.exec('reset role');
      await db.query('update public.course_routes set total_par = 36 where id = $1', [otherCourseId]);
      await asRole('authenticated', admin);
      assert.equal((await open(otherCourseId)).context.can_edit_structure, false);
      await db.exec('reset role');
      await db.query("update public.course_routes set total_par = null, source_payload = '{\"round_variant\":{\"holes_count\":9}}' where id = $1", [otherCourseId]);
      await asRole('authenticated', admin);
      assert.equal((await open(otherCourseId)).context.can_edit_structure, false);
    });

    await t.test('source or live changes since base block publication', async () => {
      draft = (await open()).draft;
      draft = await save(draft, { ...draft.snapshot, name: 'Next' });
      await db.exec('reset role');
      // Keep timestamp unchanged to specifically exercise the captured context.
      await db.exec('alter table public.course_routes disable trigger course_routes_set_updated_at');
      await db.query("update public.course_routes set source_external_id = 'Changed source' where id = $1", [courseId]);
      await asRole('authenticated', admin);
      await fails(() => publish(draft), '40001');
      await db.exec('reset role');
      await db.query('update public.course_routes set source_external_id = $1 where id = $2', [original.source_external_id, courseId]);
      await db.exec('alter table public.course_routes enable trigger course_routes_set_updated_at');
    });

    await t.test('version insertion failure rolls back live and closure', async () => {
      await db.exec("create function public.test_reject_version() returns trigger language plpgsql as $$ begin raise exception 'Test failure' using errcode = '23514'; end; $$; create trigger test_reject_version before insert on public.admin_catalog_versions for each row execute function public.test_reject_version();");
      const before = await live();
      await asRole('authenticated', admin);
      await fails(() => publish(draft), '23514');
      assert.deepEqual(await live(), before);
      assert.equal((await db.query('select workflow_status from public.admin_catalog_drafts where draft_id = $1', [draft.draft_id])).rows[0].workflow_status, 'draft');
      await db.exec('reset role; drop trigger test_reject_version on public.admin_catalog_versions');
    });

    await t.test('two confirmations publish exactly one version; stale/null revision rejected', async () => {
      await asRole('authenticated', admin);
      await fails(() => publish(draft, null), '40001');
      await fails(() => publish(draft, draft.revision - 1), '40001');
      const results = await Promise.allSettled([publish(draft), publish(draft)]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.find((result) => result.status === 'rejected').reason.code, '40001');
      assert.equal((await db.query("select count(*)::int n from public.admin_catalog_versions where entity_type = 'route'")).rows[0].n, 4);
    });

    await t.test('only the owning Admin archives open Club and Percorso drafts without touching live or versions', async () => {
      await asRole('authenticated', admin);
      const clubDraft = (await db.query('select * from public.admin_club_open_draft($1)', [clubId])).rows[0];
      const routeDraft = (await open()).draft;
      await db.exec('reset role');
      const clubBefore = (await db.query('select * from public.clubs where id = $1', [clubId])).rows[0];
      const routeBefore = await live();
      const versionsBefore = (await db.query('select count(*)::int n from public.admin_catalog_versions')).rows[0].n;
      const archive = (current, type, revision = current.revision) => db.query(
        'select * from public.admin_catalog_archive_draft($1,$2,$3::bigint)',
        [current.draft_id, type, revision]
      );

      await asRole('authenticated', admin);
      await fails(() => archive(routeDraft, 'invalid'), '22023');
      await fails(() => archive(routeDraft, 'club'), '40001');
      await fails(() => archive(routeDraft, 'route', routeDraft.revision + 1), '40001');
      await asRole('authenticated', secondAdmin);
      await fails(() => archive(routeDraft, 'route'), '40001');
      for (const [role, uid] of [['authenticated', player], ['anon', ''], ['service_role', '']]) {
        await asRole(role, uid);
        await fails(() => archive(routeDraft, 'route'), '42501');
      }

      await asRole('authenticated', admin);
      const archivedRoute = (await archive(routeDraft, 'route')).rows[0];
      const archivedClub = (await archive(clubDraft, 'club')).rows[0];
      assert.equal(archivedRoute.workflow_status, 'archived');
      assert.equal(archivedRoute.revision, routeDraft.revision + 1);
      assert.equal(archivedClub.workflow_status, 'archived');
      assert.equal((await db.query('select (public.admin_course_get_draft($1)).draft_id id', [courseId])).rows[0].id, null);
      assert.equal((await db.query('select (public.admin_club_get_draft($1)).draft_id id', [clubId])).rows[0].id, null);
      await db.exec('reset role');
      assert.deepEqual(await live(), routeBefore);
      assert.deepEqual((await db.query('select * from public.clubs where id = $1', [clubId])).rows[0], clubBefore);
      assert.equal((await db.query('select count(*)::int n from public.admin_catalog_versions')).rows[0].n, versionsBefore);
      await asRole('authenticated', admin);
      await fails(() => archive(routeDraft, 'route'), '40001');
    });

    await t.test('one-shot reapplication aborts without modifying existing objects', async () => {
      await db.exec('reset role');
      await fails(() => db.exec(migration), '42P07');
      await db.exec('rollback');
      await fails(() => db.exec(abandonMigration), '42723');
      await db.exec('rollback');
      assert.equal((await db.query("select count(*)::int n from public.admin_catalog_versions where entity_type = 'route'")).rows[0].n, 4);
    });
  } finally { await db.close(); }
});
