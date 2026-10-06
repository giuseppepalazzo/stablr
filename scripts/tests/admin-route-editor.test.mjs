// Local PostgreSQL integration. Every record is an isolated test fixture.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const migrations = await Promise.all(['admin-catalog-workflow.sql','admin-club-editor.sql',
  'admin-course-editor.sql','admin-catalog-abandon-draft.sql','admin-route-editor.sql']
  .map((file) => readFile(new URL(`../../supabase/${file}`, import.meta.url), 'utf8')));
const admin = '11111111-1111-4111-8111-111111111111';
const otherAdmin = '22222222-2222-4222-8222-222222222222';
const player = '33333333-3333-4333-8333-333333333333';
const club = '44444444-4444-4444-8444-444444444444';
const front = '55555555-5555-4555-8555-555555555555';
const back = '66666666-6666-4666-8666-666666666666';
const route = '77777777-7777-4777-8777-777777777777';

test('existing Route atomic editor with actual relational constraints', async (t) => {
  const db = new PGlite();
  const asRole = async (role, uid = '') => {
    await db.exec(`reset role; set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [uid,role]);
  };
  const get = async () => (await db.query('select public.admin_route_get_draft($1) result', [route])).rows[0].result;
  const open = async (id = route) => (await db.query('select public.admin_route_open_draft($1) result', [id])).rows[0].result;
  const save = async (draft, snapshot) => (await db.query('select * from public.admin_route_save_draft($1,$2::jsonb,$3::bigint)', [draft.draft_id,JSON.stringify(snapshot),draft.revision])).rows[0];
  const publish = async (draft, revision = draft.revision) => (await db.query('select public.admin_route_publish_draft($1,$2::bigint) result', [draft.draft_id,revision])).rows[0].result;
  const archive = async (draft) => (await db.query('select * from public.admin_catalog_archive_draft($1,$2,$3::bigint)', [draft.draft_id,'route_combination',draft.revision])).rows[0];
  const fails = (fn, code) => assert.rejects(fn, (failure) => failure.code === code);
  const live = async () => (await db.query('select * from public.route_combinations where id = $1', [route])).rows[0];
  const versionCount = async () => (await db.query('select count(*)::integer n from public.admin_catalog_versions')).rows[0].n;
  const dependencies = async () => Promise.all(['course_routes','route_holes','route_combination_holes','route_tees','combination_tees']
    .map(async (table) => (await db.query(`select * from public.${table} order by id`)).rows));
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
      insert into auth.users values ('${admin}'),('${otherAdmin}'),('${player}');
      insert into public.profiles values ('${admin}','admin'),('${otherAdmin}','admin'),('${player}','user');
      create table public.clubs(id uuid primary key,name text not null,city text,is_active boolean not null default true,updated_at timestamptz default now());
      insert into public.clubs values ('${club}','Club fixture',null,true,now());
      create table public.course_routes(id uuid primary key,club_id uuid not null references public.clubs,
        name text not null,holes_count integer not null check(holes_count in(9,18)),total_par integer,
        display_order integer,is_active boolean not null default true,source_system text,source_external_id text,
        source_payload jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
      insert into public.course_routes(id,club_id,name,holes_count,total_par,is_active,source_system)
        values('${front}','${club}','Prime nove fixture',9,36,true,'fig'),('${back}','${club}','Diciotto fixture',18,72,true,'fig');
      create table public.route_holes(id uuid primary key default gen_random_uuid(),route_id uuid not null references public.course_routes,
        physical_hole_number integer not null check(physical_hole_number between 1 and 18),
        par integer not null check(par between 3 and 6),stroke_index integer check(stroke_index between 1 and 18),
        display_label text,created_at timestamptz default now(),unique(route_id,physical_hole_number));
      insert into public.route_holes(route_id,physical_hole_number,par,stroke_index)
        select '${front}',n,4,n from generate_series(1,9)n;
      insert into public.route_holes(route_id,physical_hole_number,par,stroke_index)
        select '${back}',n,4,n from generate_series(1,18)n;
      create table public.route_combinations(id uuid primary key,club_id uuid not null references public.clubs,
        name text not null,front_route_id uuid not null references public.course_routes,back_route_id uuid not null references public.course_routes,
        holes_count integer not null default 18 check(holes_count=18),total_par integer,is_active boolean not null default true,
        source_system text,source_external_id text,source_payload jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),
        check(front_route_id<>back_route_id),unique(club_id,front_route_id,back_route_id));
      insert into public.route_combinations(id,club_id,name,front_route_id,back_route_id,total_par,source_system,source_external_id,source_payload)
        values('${route}','${club}','Route fixture','${front}','${back}',72,'fig','FIG-combination-1','{"display_order":7,"note":"Nota reale fixture"}');
      create table public.route_combination_holes(id uuid primary key default gen_random_uuid(),
        route_combination_id uuid not null references public.route_combinations,
        round_hole_number integer not null check(round_hole_number between 1 and 18),
        route_id uuid not null references public.course_routes,route_position integer not null check(route_position in(1,2)),
        physical_hole_number integer not null check(physical_hole_number between 1 and 18),
        par integer not null check(par between 3 and 6),stroke_index integer not null check(stroke_index between 1 and 18),
        source_stroke_index integer,display_label text,
        constraint fixture_round_number_unique unique(route_combination_id,round_hole_number));
      insert into public.route_combination_holes(route_combination_id,round_hole_number,route_id,route_position,physical_hole_number,par,stroke_index)
        select '${route}',n,case when n<=9 then '${front}'::uuid else '${back}'::uuid end,
        case when n<=9 then 1 else 2 end,n,4,n from generate_series(1,18)n;
      create table public.route_tees(id uuid primary key default gen_random_uuid(),route_id uuid references public.course_routes,holes_count integer,is_active boolean,course_rating numeric);
      create table public.combination_tees(id uuid primary key default gen_random_uuid(),route_combination_id uuid references public.route_combinations,course_rating numeric,slope_rating integer,is_active boolean);
      insert into public.route_tees(route_id,holes_count,is_active,course_rating) values('${front}',9,true,35.5);
      insert into public.combination_tees(route_combination_id,course_rating,slope_rating,is_active) values('${route}',72.3,125,true);
      create table public.rounds(id uuid primary key,selected_routes jsonb);
      create table public.round_holes(id uuid primary key,route_id uuid references public.course_routes);
      create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
      create trigger route_combinations_set_updated_at before update on public.route_combinations for each row execute function public.set_updated_at();
      create trigger course_routes_set_updated_at before update on public.course_routes for each row execute function public.set_updated_at();
      alter table public.route_combinations enable row level security;
      grant select on public.route_combinations to authenticated;
      create policy existing_read on public.route_combinations for select to authenticated using(true);
    `);
    const original = await live();
    const originalDependencies = await dependencies();
    const policies = (await db.query("select * from pg_policies where tablename='route_combinations'")).rows;
    for (const migration of migrations) await db.exec(migration);
    let draft;
    let competing;

    await t.test('migration preserves policies, grants, live and children; no fake workflow', async () => {
      assert.deepEqual(await live(),original);
      assert.deepEqual(await dependencies(),originalDependencies);
      assert.deepEqual((await db.query("select * from pg_policies where tablename='route_combinations'")).rows,policies);
      assert.equal((await db.query("select has_table_privilege('authenticated','public.route_combinations','UPDATE') allowed")).rows[0].allowed,false);
      assert.equal((await db.query('select count(*)::integer n from public.admin_catalog_drafts')).rows[0].n,0);
      assert.equal(await versionCount(),0);
    });

    await t.test('read-only get reports real 18 holes from 9/18 origins without opening a draft', async () => {
      await asRole('authenticated',admin);
      const result = await get();
      assert.equal(result.draft,null);
      assert.equal(result.context.checks.coherent,true);
      assert.equal(result.context.checks.actual_holes,18);
      assert.deepEqual(result.context.checks.missing_round_numbers,[]);
      assert.equal(result.context.checks.duplicate_physical_holes,0);
      assert.equal(result.context.route.order,7);
      assert.equal(result.context.route.notes,'Nota reale fixture');
      assert.deepEqual(result.context.origins.map((origin)=>origin.holes_count),[9,18]);
    });

    await t.test('open resumes own server-based Route draft with unchanged live', async () => {
      draft = (await open()).draft;
      assert.equal((await open()).draft.draft_id,draft.draft_id);
      assert.equal(draft.entity_type,'route_combination');
      assert.equal(draft.base_snapshot._context.holes.length,18);
      assert.equal(draft.base_snapshot._context.origin_holes.length,27);
      assert.deepEqual(draft.snapshot,{name:'Route fixture',is_active:true});
      assert.deepEqual(await live(),original);
      await fails(()=>publish(draft),'22023');
    });

    await t.test('typed two-field allowlist and CAS reject technical writes', async () => {
      for (const snapshot of [null,[],{}, {name:'',is_active:true},{name:'x'.repeat(201),is_active:true},
        {name:'Route',is_active:'false'},...['display_order','holes_count','total_par','notes','source_payload','source_system',
          'front_route_id','back_route_id','club_id','holes','tees'].map((field)=>({...draft.snapshot,[field]:'forbidden'}))]) {
        await fails(()=>save(draft,snapshot),'22023');
      }
      const first=draft;
      draft=await save(draft,{name:' Nome nuovo ',is_active:false});
      assert.deepEqual(draft.snapshot,{name:'Nome nuovo',is_active:false});
      assert.deepEqual(draft.base_snapshot,first.base_snapshot);
      await fails(()=>save(first,first.snapshot),'40001');
      assert.deepEqual(await live(),original);
    });

    await t.test('anon, players and service API cannot invoke editor or read workflow', async () => {
      for (const [role,uid] of [['anon',''],['authenticated',player],['service_role','']]) {
        await asRole(role,uid);
        await fails(()=>get(),'42501'); await fails(()=>open(),'42501');
        await fails(()=>save(draft,draft.snapshot),'42501'); await fails(()=>publish(draft),'42501');
        await fails(()=>archive(draft),'42501');
        await fails(()=>db.query('select public.admin_route_context($1)',[route]),'42501');
        if(role==='authenticated') {
          assert.equal((await db.query('select * from public.admin_catalog_drafts')).rows.length,0);
          assert.equal((await db.query('select * from public.admin_catalog_versions')).rows.length,0);
        }
      }
      await asRole('authenticated',admin);
      await fails(()=>db.query('select public.admin_route_lock_target($1)',[route]),'42501');
    });

    await t.test('another Admin has own draft but cannot save/publish/archive owner draft', async () => {
      await asRole('authenticated',otherAdmin);
      assert.equal((await get()).draft,null);
      await fails(()=>save(draft,draft.snapshot),'42501'); await fails(()=>publish(draft),'42501');
      await fails(()=>archive(draft),'40001');
      await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3::bigint)',[draft.draft_id,JSON.stringify(draft.snapshot),draft.revision]),'42501');
      competing=(await open()).draft;
      await asRole('authenticated',admin);
    });

    await t.test('generic drafts/saves cannot spoof base, schema or allowlist', async () => {
      const forged=(await db.query('select * from public.admin_catalog_create_draft($1,$2::jsonb,$3)', ['route_combination',JSON.stringify(draft.snapshot),route])).rows[0];
      await fails(()=>publish(forged),'42501');
      await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3::bigint)',[draft.draft_id,JSON.stringify({...draft.snapshot,total_par:99}),draft.revision]),'22023');
      await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3::bigint,2)',[draft.draft_id,JSON.stringify(draft.snapshot),draft.revision]),'22023');
      await fails(()=>db.query("update public.admin_catalog_drafts set base_snapshot='{}' where draft_id=$1",[draft.draft_id]),'42501');
      const clubDraft=(await db.query('select * from public.admin_club_open_draft($1)',[club])).rows[0];
      await fails(()=>save(clubDraft,draft.snapshot),'42501');
    });

    await t.test('atomic publication changes only name/active and adds immutable authored diff', async () => {
      const result=await publish(draft);
      assert.deepEqual(result.diff,{name:{before:'Route fixture',after:'Nome nuovo'},is_active:{before:true,after:false}});
      assert.equal(result.route.is_active,false);
      const updated=await live();
      for(const key of ['club_id','front_route_id','back_route_id','holes_count','total_par','source_system','source_external_id','source_payload','created_at']) assert.deepEqual(updated[key],original[key]);
      const version=(await db.query('select * from public.admin_catalog_versions where version_id=$1',[result.version_id])).rows[0];
      assert.equal(version.published_by,admin); assert.ok(version.published_at);
      assert.deepEqual(version.snapshot,draft.snapshot); assert.deepEqual(version.diff,result.diff);
      assert.equal((await db.query('select workflow_status from public.admin_catalog_drafts where draft_id=$1',[draft.draft_id])).rows[0].workflow_status,'published');
      await fails(()=>publish(draft),'40001'); await fails(()=>save(draft,draft.snapshot),'40001');
      await db.exec('reset role');
      assert.deepEqual(await dependencies(),originalDependencies);
      await fails(()=>db.query("update public.admin_catalog_versions set diff='{}'"),'55000');
      await asRole('authenticated',otherAdmin);
      competing=await save(competing,{...competing.snapshot,name:'Conflicting'});
      await fails(()=>publish(competing),'40001');
      await asRole('authenticated',admin);
    });

    await t.test('reactivation of an existing inactive Route publishes a second version', async () => {
      draft=(await open()).draft;
      assert.equal(draft.snapshot.is_active,false); assert.ok(draft.base_version_id);
      draft=await save(draft,{...draft.snapshot,is_active:true});
      assert.equal((await publish(draft)).version_number,2);
    });

    const invalidCase = async (mutate, restore, verify) => {
      await db.exec('reset role'); await mutate();
      const before=await live(); const countBefore=await versionCount();
      await asRole('authenticated',admin);
      const opened=await open(); verify(opened.context.checks);
      const invalidDraft=await save(opened.draft,{...opened.draft.snapshot,name:'Invalid publication'});
      await fails(()=>publish(invalidDraft),'23514');
      assert.deepEqual(await live(),before); assert.equal(await versionCount(),countBefore);
      assert.equal((await db.query('select workflow_status from public.admin_catalog_drafts where draft_id=$1',[invalidDraft.draft_id])).rows[0].workflow_status,'draft');
      await archive(invalidDraft);
      await db.exec('reset role'); await restore(); await asRole('authenticated',admin);
    };

    await t.test('missing holes block metadata publication and can still be saved/abandoned', async () => {
      const removed=(await db.exec('reset role'),await db.query('select * from public.route_combination_holes where round_hole_number=18')).rows[0];
      await invalidCase(()=>db.query('delete from public.route_combination_holes where id=$1',[removed.id]),
        ()=>db.query('insert into public.route_combination_holes select * from jsonb_populate_record(null::public.route_combination_holes,$1::jsonb)',[JSON.stringify(removed)]),
        (checks)=>{assert.equal(checks.actual_holes,17);assert.deepEqual(checks.missing_round_numbers,[18]);});
    });

    await t.test('duplicate physical references are detected despite distinct round numbers', async () => {
      await invalidCase(()=>db.exec('update public.route_combination_holes set physical_hole_number=1 where round_hole_number=2'),
        ()=>db.exec('update public.route_combination_holes set physical_hole_number=2 where round_hole_number=2'),
        (checks)=>{assert.equal(checks.duplicate_physical_holes,1);assert.equal(checks.duplicate_round_numbers,0);});
    });

    await t.test('logical duplicate detection is robust beyond the existing UNIQUE constraint', async () => {
      await db.exec('reset role; alter table public.route_combination_holes drop constraint fixture_round_number_unique');
      const hole=(await db.query('select id from public.route_combination_holes where round_hole_number=2')).rows[0];
      await invalidCase(()=>db.query('update public.route_combination_holes set round_hole_number=1 where id=$1',[hole.id]),
        ()=>db.query('update public.route_combination_holes set round_hole_number=2 where id=$1',[hole.id]),
        (checks)=>{assert.equal(checks.duplicate_round_numbers,1);assert.deepEqual(checks.missing_round_numbers,[2]);});
      await db.exec('reset role; alter table public.route_combination_holes add constraint fixture_round_number_unique unique(route_combination_id,round_hole_number)');
      await asRole('authenticated',admin);
    });

    await t.test('wrong origins/positions and references beyond the source cardinality are rejected', async () => {
      await invalidCase(()=>db.query('update public.route_combination_holes set route_id=$1 where round_hole_number=1',[back]),
        ()=>db.query('update public.route_combination_holes set route_id=$1 where round_hole_number=1',[front]),
        (checks)=>assert.equal(checks.invalid_origin_holes,1));
      await invalidCase(()=>db.exec('update public.route_combination_holes set physical_hole_number=10 where round_hole_number=1'),
        ()=>db.exec('update public.route_combination_holes set physical_hole_number=1 where round_hole_number=1'),
        (checks)=>assert.equal(checks.invalid_origin_holes,1));
      await invalidCase(()=>db.exec('update public.route_combination_holes set route_position=2 where round_hole_number=1'),
        ()=>db.exec('update public.route_combination_holes set route_position=1 where round_hole_number=1'),
        (checks)=>assert.equal(checks.invalid_origin_holes,1));
    });

    await t.test('Par inconsistency blocks publication; absent total remains absent', async () => {
      await invalidCase(()=>db.exec('update public.route_combinations set total_par=73'),
        ()=>db.exec('update public.route_combinations set total_par=72'),
        (checks)=>assert.equal(checks.par_consistent,false));
      await db.exec('reset role; update public.route_combinations set total_par=null');
      await asRole('authenticated',admin);
      assert.equal((await get()).context.checks.par_consistent,null);
      assert.equal((await get()).context.checks.coherent,true);
      await db.exec('reset role; update public.route_combinations set total_par=72');
      await asRole('authenticated',admin);
    });

    await t.test('missing physical source holes and origins belonging to another Club block publication', async () => {
      await db.exec('reset role');
      const removed=(await db.query('select * from public.route_holes where route_id=$1 and physical_hole_number=9',[front])).rows[0];
      await invalidCase(()=>db.query('delete from public.route_holes where id=$1',[removed.id]),
        ()=>db.query('insert into public.route_holes select * from jsonb_populate_record(null::public.route_holes,$1::jsonb)',[JSON.stringify(removed)]),
        (checks)=>assert.equal(checks.invalid_origin_holes,1));
      await db.exec(`reset role; insert into public.clubs(id,name) values('${player}','Another Club fixture')`);
      await invalidCase(()=>db.query('update public.course_routes set club_id=$1 where id=$2',[player,back]),
        ()=>db.query('update public.course_routes set club_id=$1 where id=$2',[club,back]),
        (checks)=>assert.equal(checks.origins_valid,false));
    });

    await t.test('activation requires active origins, but deactivation leaves origins unchanged', async () => {
      await db.exec(`reset role; update public.course_routes set is_active=false where id='${front}'`);
      await asRole('authenticated',admin);
      draft=(await open()).draft;
      assert.equal((await get()).context.checks.origins_active,false);
      draft=await save(draft,{...draft.snapshot,name:'Inactive origin'});
      await fails(()=>publish(draft),'23514');
      draft=await save(draft,{...draft.snapshot,is_active:false});
      await publish(draft);
      await db.exec(`reset role; update public.course_routes set is_active=true where id='${front}'`);
      await asRole('authenticated',admin);
    });

    await t.test('dependent/source changes since base block publication without partial writes', async () => {
      for(const mutate of [
        ()=>db.exec("update public.route_combinations set source_external_id='Changed'"),
        ()=>db.exec(`update public.course_routes set name='Changed origin' where id='${front}'`),
        ()=>db.exec('update public.route_combination_holes set par=5 where round_hole_number=1'),
        ()=>db.exec('update public.route_holes set par=5 where physical_hole_number=1')
      ]) {
        draft=(await open()).draft; draft=await save(draft,{...draft.snapshot,name:'Stale'});
        await db.exec('reset role'); await mutate(); const before=await live();
        await asRole('authenticated',admin); await fails(()=>publish(draft),'40001');
        assert.deepEqual(await live(),before); await archive(draft);
        await db.exec(`reset role; update public.route_combinations set source_external_id='FIG-combination-1';
          update public.course_routes set name='Prime nove fixture' where id='${front}';
          update public.route_combination_holes set par=4 where round_hole_number=1;
          update public.route_holes set par=4 where physical_hole_number=1;`);
        await asRole('authenticated',admin);
      }
    });

    await t.test('version insert failure rolls back live and closed state; double confirmation yields one version', async () => {
      draft=(await open()).draft; draft=await save(draft,{...draft.snapshot,name:'Final name',is_active:true});
      await db.exec("reset role; create function public.test_reject_version() returns trigger language plpgsql as $$ begin raise exception 'Test rollback' using errcode='23514'; end; $$; create trigger test_reject_version before insert on public.admin_catalog_versions for each row execute function public.test_reject_version();");
      const before=await live(); const countBefore=await versionCount();
      await asRole('authenticated',admin);
      await fails(()=>publish(draft),'23514'); assert.deepEqual(await live(),before); assert.equal(await versionCount(),countBefore);
      assert.equal((await db.query('select workflow_status from public.admin_catalog_drafts where draft_id=$1',[draft.draft_id])).rows[0].workflow_status,'draft');
      await db.exec('reset role; drop trigger test_reject_version on public.admin_catalog_versions');
      await asRole('authenticated',admin);
      await fails(()=>publish(draft,null),'40001');
      const attempts=await Promise.allSettled([publish(draft),publish(draft)]);
      assert.equal(attempts.filter((attempt)=>attempt.status==='fulfilled').length,1);
      assert.equal(attempts.find((attempt)=>attempt.status==='rejected').reason.code,'40001');
      assert.equal(await versionCount(),countBefore+1);
    });

    await t.test('abandon archives, returns no badge and opens a fresh draft from current live', async () => {
      draft=(await open()).draft;
      const before=await live(); const countBefore=await versionCount();
      assert.equal((await archive(draft)).workflow_status,'archived'); assert.equal((await get()).draft,null);
      assert.deepEqual(await live(),before);assert.equal(await versionCount(),countBefore);
      const fresh=(await open()).draft;assert.notEqual(fresh.draft_id,draft.draft_id);assert.equal(fresh.snapshot.name,before.name);
    });

    await t.test('one-shot second application rolls back', async () => {
      await db.exec('reset role');await fails(()=>db.exec(migrations.at(-1)),'42P07');await db.exec('rollback');
      assert.ok((await db.query('select * from public.route_combinations')).rows.length);
    });
  } finally { await db.close(); }
});
