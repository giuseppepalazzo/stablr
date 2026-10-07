// Local PostgreSQL only. All records below are automatic-test fixtures.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const readSql = (name) => readFile(new URL(`../../supabase/${name}`,import.meta.url),'utf8');
const schema = await readSql('shared-catalog-schema.sql');
const extension = await readSql('fig-whs-extension.sql');
const migrations = await Promise.all(['admin-catalog-workflow.sql','admin-club-editor.sql','admin-course-editor.sql',
  'admin-catalog-abandon-draft.sql','admin-route-editor.sql','admin-hole-grid-editor.sql','admin-course-hole-grid-editor.sql'].map(readSql));
const admin='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const player='33333333-3333-4333-8333-333333333333';
const club='44444444-4444-4444-8444-444444444444';
const nine='55555555-5555-4555-8555-555555555555';
const eighteen='66666666-6666-4666-8666-666666666666';
const combination='77777777-7777-4777-8777-777777777777';
const empty='88888888-8888-4888-8888-888888888888';
const odd=[1,3,5,7,9,11,13,15,17];
const clone=(value)=>structuredClone(value);

test('physical course holes: dedicated atomic grid, live 9/18 schemas and existing workflows',async(t)=>{
  const db=new PGlite();
  const role=async(name='authenticated',uid=admin)=>{
    await db.exec(`reset role; set role ${name}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,name]);
  };
  const fails=(fn,code)=>assert.rejects(fn,error=>error.code===code);
  const get=async(id=nine)=>(await db.query('select public.admin_course_hole_grid_get_draft($1) result',[id])).rows[0].result;
  const open=async(id=nine)=>(await db.query('select public.admin_course_hole_grid_open_draft($1) result',[id])).rows[0].result;
  const save=async(d,s)=>(await db.query('select * from public.admin_course_hole_grid_save_draft($1,$2::jsonb,$3::bigint)',[d.draft_id,JSON.stringify(s),d.revision])).rows[0];
  const publish=async(d,revision=d.revision)=>(await db.query('select public.admin_course_hole_grid_publish_draft($1,$2::bigint) result',[d.draft_id,revision])).rows[0].result;
  const archive=async(d)=>(await db.query('select * from public.admin_course_hole_grid_archive_draft($1,$2::bigint)',[d.draft_id,d.revision])).rows[0];
  const holes=async(id=nine)=>(await db.query('select * from public.route_holes where route_id=$1 order by physical_hole_number,id',[id])).rows;
  const versions=async()=>(await db.query('select * from public.admin_catalog_versions order by version_number')).rows;
  const unchanged=async()=>{
    const previous=(await db.query('select current_user actor')).rows[0].actor;
    await db.exec('reset role');
    try { return await Promise.all(['clubs','course_routes','route_combinations','route_combination_holes','route_tees','combination_tees','rounds','round_holes']
      .map(async name=>(await db.query(`select * from public.${name} order by id`)).rows)); }
    finally {await db.exec(`set role ${previous}`);}
  };
  const swap=(d)=>{const s=clone(d.snapshot); [s.holes[0].stroke_index,s.holes[1].stroke_index]=[s.holes[1].stroke_index,s.holes[0].stroke_index]; return s;};
  let original,original18,baseline,draft;
  const restoreNine=async()=>{
    await db.exec('reset role'); await db.query('delete from public.route_holes where route_id=$1',[nine]);
    await db.query('insert into public.route_holes select * from jsonb_populate_recordset(null::public.route_holes,$1::jsonb)',[JSON.stringify(original)]); await role();
  };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.profiles(id uuid primary key references auth.users,role text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
      create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),''); $$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$
        select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;
      insert into auth.users values('${admin}'),('${other}'),('${player}');
      insert into public.profiles values('${admin}','admin'),('${other}','admin'),('${player}','user');`);
    for(const name of ['clubs','course_routes','route_holes','route_combinations','route_combination_holes','rounds','round_holes']) {
      const statement=schema.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];
      assert.ok(statement,`actual schema ${name}`); await db.exec(statement);
    }
    for(const name of ['route_tees','combination_tees']) await db.exec(extension.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    await db.exec(`
      alter table public.route_holes add constraint route_holes_route_id_physical_hole_number_key unique(route_id,physical_hole_number);
      alter table public.route_combination_holes add constraint route_combination_holes_round_hole_number_key unique(route_combination_id,round_hole_number);
      alter table public.clubs add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.course_routes add column source_system text,add column source_external_id text,add column source_payload jsonb;
      alter table public.route_combinations add column source_system text,add column source_external_id text,add column source_payload jsonb;
      insert into public.clubs(id,name,name_normalized,created_by) values('${club}','Club fixture','club fixture','${admin}');
      insert into public.course_routes(id,club_id,name,holes_count,total_par,source_system,source_payload)
        values('${nine}','${club}','Nove fixture',9,35,'fig','{"note":"Source fixture"}'),
          ('${eighteen}','${club}','Diciotto fixture',18,72,'fig','{}'),('${empty}','${club}','Senza buche fixture',9,null,'fig','{}');
      insert into public.route_holes(route_id,physical_hole_number,par,stroke_index,display_label)
        select '${nine}',n,(array[5,3,4,3,4,5,4,4,3])[n],(array[11,17,1,7,9,5,3,13,15])[n],'Buca '||n from generate_series(1,9)n;
      insert into public.route_holes(route_id,physical_hole_number,par,stroke_index,display_label)
        select '${eighteen}',n,4,n,'Buca '||n from generate_series(1,18)n;
      insert into public.route_combinations(id,club_id,name,front_route_id,back_route_id,total_par)
        values('${combination}','${club}','Combinazione fixture','${nine}','${eighteen}',71);
      insert into public.route_combination_holes(route_combination_id,round_hole_number,route_id,route_position,physical_hole_number,par,stroke_index)
        select '${combination}',n,case when n<=9 then '${nine}'::uuid else '${eighteen}'::uuid end,
          case when n<=9 then 1 else 2 end,case when n<=9 then n else n-9 end,4,n from generate_series(1,18)n;
      insert into public.route_tees(route_id,tee_name,holes_count,par_total,course_rating,slope_rating)
        values('${nine}','Gialli',9,35,35.5,123);
      insert into public.combination_tees(route_combination_id,tee_name,holes_count,par_total,course_rating,slope_rating)
        values('${combination}','Gialli',18,71,72.1,125);
      alter table public.route_holes enable row level security;
      grant select on public.route_holes to authenticated;
      create policy existing_read on public.route_holes for select to authenticated using(true);
    `);
    original=await holes(); original18=await holes(eighteen); baseline=await unchanged();
    const policies=(await db.query('select * from pg_policies order by tablename,policyname')).rows;
    for(const sql of migrations) await db.exec(sql);

    await t.test('migration preserves every live table, policy and grant; no artificial workflow',async()=>{
      assert.deepEqual(await holes(),original); assert.deepEqual(await unchanged(),baseline);
      assert.deepEqual((await db.query('select * from pg_policies where tablename not like $1 order by tablename,policyname',['admin_catalog_%'])).rows,policies);
      assert.equal((await versions()).length,0);
      assert.equal((await db.query('select count(*)::integer n from public.admin_catalog_drafts')).rows[0].n,0);
      assert.equal((await db.query("select has_table_privilege('authenticated','public.route_holes','UPDATE') allowed")).rows[0].allowed,false);
    });

    await t.test('RPCs and private helpers reject anon, player, missing JWT identity and service API',async()=>{
      for(const [name,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',admin]]) {
        await role(name,uid); await fails(get,'42501'); await fails(open,'42501');
        await fails(()=>save({draft_id:nine,revision:1},{holes:[]}),'42501');
        await fails(()=>publish({draft_id:nine,revision:1}),'42501'); await fails(()=>archive({draft_id:nine,revision:1}),'42501');
        await fails(()=>db.query('select public.admin_course_hole_grid_context($1)',[nine]),'42501');
        await fails(()=>db.query('select public.admin_course_hole_grid_lock_target($1)',[nine]),'42501');
        await fails(()=>db.query('select public.admin_course_hole_grid_validate_snapshot($1::jsonb,$2::jsonb)',['{"holes":[]}','{"holes":[]}']),'42501');
      }
      await role();
    });

    await t.test('get is read-only, open/resume captures one physical grid including imported odd SI',async()=>{
      assert.equal((await get()).draft,null); const result=await open(); draft=result.draft;
      assert.equal(draft.entity_type,'route_holes_grid'); assert.equal(draft.live_entity_id,nine);
      assert.equal(draft.snapshot.holes.length,9); assert.deepEqual(result.context.si_sequence,odd);
      assert.deepEqual(draft.base_snapshot._si_sequence,odd);
      assert.equal((await open()).draft.draft_id,draft.draft_id);
      const concurrent=await Promise.all([open(),open()]); assert.equal(concurrent[0].draft.draft_id,concurrent[1].draft.draft_id);
      assert.deepEqual(await holes(),original); assert.equal((await versions()).length,0);
      await fails(()=>db.query('select public.admin_catalog_create_draft($1,$2::jsonb,$3)', ['route_holes_grid','{"holes":[]}',nine]),'22023');
      assert.equal((await get(empty)).context.holes.length,0); await fails(()=>open(empty),'22023');
      await fails(()=>open(player),'22023');
    });

    await t.test('ownership enforced by dedicated RPCs and generic saver',async()=>{
      await role('authenticated',other); assert.equal((await get()).draft,null);
      await fails(()=>save(draft,draft.snapshot),'42501'); await fails(()=>publish(draft),'42501'); await fails(()=>archive(draft),'40001');
      await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3::bigint)',[draft.draft_id,JSON.stringify(draft.snapshot),draft.revision]),'42501');
      await role();
    });

    await t.test('typed allowlist forbids identity/order/source changes, new/deleted rows and invalid domains',async()=>{
      const bad=[{...draft.snapshot,source_payload:{}}];
      for(const mutate of [s=>s.holes[0].route_id=eighteen,s=>s.holes[0].display_label='Edited',
        s=>s.holes[0].source_stroke_index=1,s=>s.holes[0].id=eighteen,s=>s.holes[0].physical_hole_number=2,
        s=>s.holes[0]=clone(s.holes[1]),s=>s.holes.pop(),s=>s.holes.push(clone(s.holes[0])),
        s=>s.holes[0].par=2,s=>s.holes[0].par=4.5,s=>s.holes[0].stroke_index=19,s=>s.holes[0].stroke_index='11']) {
        const s=clone(draft.snapshot); mutate(s); bad.push(s);
      }
      for(const s of bad) await fails(()=>save(draft,s),'22023');
      await fails(()=>publish(draft,null),'40001');
      await fails(()=>db.query('select public.admin_catalog_save_draft($1,$2::jsonb,$3::bigint)',[draft.draft_id,JSON.stringify(bad[0]),draft.revision]),'22023');
      // Even a privileged internal caller cannot mutate a captured base via UPDATE.
      await db.exec('reset role');
      await fails(()=>db.query("update public.admin_catalog_drafts set base_snapshot='{}',revision=revision+1 where draft_id=$1",[draft.draft_id]),'22023');
      await role();
    });

    await t.test('draft accepts incomplete/duplicate SI; publication enforces essential fields, actual SI set and Par total',async()=>{
      const start=clone(draft.snapshot);
      for(const mutate of [s=>s.holes[0].par=null,s=>s.holes[0].stroke_index=null,s=>s.holes[0].stroke_index=17,
        s=>s.holes[0].stroke_index=2,s=>s.holes[0].par=6]) {
        const s=clone(start); mutate(s); const old=draft; draft=await save(draft,s);
        await fails(()=>save(old,s),'40001'); await fails(()=>publish(draft),'23514');
        assert.deepEqual(await holes(),original); assert.equal((await versions()).length,0);
        draft=await save(draft,start);
      }
      await fails(()=>publish(draft),'22023'); await archive(draft);
    });

    await t.test('archive closes only this grid; next open creates a fresh draft without changing live',async()=>{
      assert.equal((await get()).draft,null); await fails(()=>save(draft,draft.snapshot),'40001'); await fails(()=>publish(draft),'40001');
      const next=(await open()).draft; assert.notEqual(next.draft_id,draft.draft_id); await archive(next);
      assert.deepEqual(await holes(),original); assert.equal((await versions()).length,0);
    });

    await t.test('base conflicts cover external Par/SI, labels, row membership and full course metadata',async()=>{
      for(const sql of [
        "update public.route_holes set par=6 where route_id=$1 and physical_hole_number=1",
        "update public.route_holes set stroke_index=2 where route_id=$1 and physical_hole_number=1",
        "update public.route_holes set display_label='External' where route_id=$1 and physical_hole_number=1",
        "delete from public.route_holes where route_id=$1 and physical_hole_number=9"
      ]) {
        draft=(await open()).draft; draft=await save(draft,swap(draft));
        await db.exec('reset role'); await db.query(sql,[nine]); await role();
        await fails(()=>publish(draft),'40001'); await archive(draft); await restoreNine();
      }
      draft=(await open()).draft; draft=await save(draft,swap(draft));
      await db.exec('reset role'); await db.query("update public.course_routes set name='External' where id=$1",[nine]); await role();
      await fails(()=>publish(draft),'40001'); await archive(draft);
      await db.exec('reset role'); await db.query("update public.course_routes set name='Nove fixture' where id=$1",[nine]); await role();
    });

    await t.test('missing holes, unexpected numbers and logical duplicates block entire publication',async()=>{
      for(const sql of [
        "delete from public.route_holes where route_id=$1 and physical_hole_number=9",
        "update public.route_holes set physical_hole_number=10 where route_id=$1 and physical_hole_number=9"
      ]) {
        await db.exec('reset role'); await db.query(sql,[nine]); await role();
        draft=(await open()).draft; draft=await save(draft,swap(draft));
        await fails(()=>publish(draft),'23514'); await archive(draft); await restoreNine();
      }
      // Fault injection only in this isolated DB: verify logical checks as well as UNIQUE.
      await db.exec('reset role'); await db.exec('alter table public.route_holes drop constraint route_holes_route_id_physical_hole_number_key');
      await db.query('update public.route_holes set physical_hole_number=8 where route_id=$1 and physical_hole_number=9',[nine]); await role();
      draft=(await open()).draft; draft=await save(draft,swap(draft)); await fails(()=>publish(draft),'23514'); await archive(draft);
      await restoreNine(); await db.exec('reset role');
      await db.exec('alter table public.route_holes add constraint route_holes_route_id_physical_hole_number_key unique(route_id,physical_hole_number)'); await role();
    });

    await t.test('history failure rolls back all physical-hole changes and keeps draft open',async()=>{
      draft=(await open()).draft; draft=await save(draft,swap(draft));
      await db.exec('reset role'); await db.exec(`create function public.fixture_fail_history() returns trigger language plpgsql as $$ begin raise exception 'fixture rollback' using errcode='P0001'; end; $$;
        create trigger fixture_fail_history before insert on public.admin_catalog_versions for each row execute function public.fixture_fail_history();`);
      await role(); await fails(()=>publish(draft),'P0001'); assert.deepEqual(await holes(),original);
      assert.equal((await get()).draft.workflow_status,'draft'); assert.equal((await versions()).length,0);
      await db.exec('reset role'); await db.exec('drop trigger fixture_fail_history on public.admin_catalog_versions'); await role(); await archive(draft);
    });

    await t.test('9-hole publication updates only Par/SI atomically, creates one immutable authored version and closes draft',async()=>{
      draft=(await open()).draft;
      const s=swap(draft); s.holes[0].par=4; s.holes[1].par=4; draft=await save(draft,s);
      await role('authenticated',other); const competing=(await open()).draft; await role();
      const result=await publish(draft); assert.equal(result.course_id,nine); assert.equal(result.version_number,1); assert.equal(result.diff.holes.length,2);
      const rows=await holes(); assert.equal(rows[0].par,4); assert.equal(rows[1].par,4); assert.equal(rows[0].stroke_index,17);
      assert.deepEqual(rows.map(({par,stroke_index,...rest})=>rest),original.map(({par,stroke_index,...rest})=>rest));
      assert.deepEqual(rows.slice(2),original.slice(2)); assert.deepEqual(await holes(eighteen),original18); assert.deepEqual(await unchanged(),baseline);
      assert.equal((await get()).draft,null); await fails(()=>publish(draft),'40001'); await fails(()=>save(draft,s),'40001');
      await role('authenticated',other); const otherSaved=await save(competing,swap(competing)); await fails(()=>publish(otherSaved),'40001'); await archive(otherSaved); await role();
      const version=(await versions())[0]; assert.equal(version.entity_type,'route_holes_grid'); assert.equal(version.published_by,admin); assert.ok(version.published_at);
      assert.deepEqual(version.snapshot,s); assert.deepEqual(version.diff,result.diff);
      await db.exec('reset role'); await fails(()=>db.exec("update public.admin_catalog_versions set diff='{}'"),'55000');
      await fails(()=>db.exec('delete from public.admin_catalog_versions'),'55000'); await role();
    });

    await t.test('optimistic concurrent saves allow one result, next publish advances immutable lineage',async()=>{
      draft=(await open()).draft; assert.equal(draft.base_version_id,(await versions())[0].version_id);
      const s=swap(draft); const outcomes=await Promise.allSettled([save(draft,s),save(draft,s)]);
      assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1); assert.equal(outcomes.find(r=>r.status==='rejected').reason.code,'40001');
      const saved=outcomes.find(r=>r.status==='fulfilled').value;
      assert.equal((await publish(saved)).version_number,2);
      await role('authenticated',player); assert.deepEqual((await db.query('select * from public.admin_catalog_drafts')).rows,[]);
      assert.deepEqual((await db.query('select * from public.admin_catalog_versions')).rows,[]);
      await role('anon',''); await fails(()=>db.query('select * from public.admin_catalog_drafts'),'42501');
      await fails(()=>db.query('select * from public.admin_catalog_versions'),'42501'); await role();
    });

    await t.test('18 holes require exact complete 1..18; publication does not touch 9-hole course or combinations',async()=>{
      const beforeNine=await holes(); draft=(await open(eighteen)).draft; assert.equal(draft.snapshot.holes.length,18);
      assert.deepEqual(draft.base_snapshot._si_sequence,Array.from({length:18},(_,i)=>i+1));
      draft=await save(draft,swap(draft)); const result=await publish(draft); assert.equal(result.version_number,1);
      assert.equal((await holes(eighteen))[0].stroke_index,2); assert.deepEqual(await holes(),beforeNine); assert.deepEqual(await unchanged(),baseline);
    });

    await t.test('9-hole numbered/even/mixed imported sets preserved; null/duplicate SI repairs use 1..9',async()=>{
      for(const sequence of [Array.from({length:9},(_,i)=>i+1),Array.from({length:9},(_,i)=>2*(i+1)),[2,3,4,5,8,10,14,15,17],Array(9).fill(null),Array(9).fill(1)]) {
        await db.exec('reset role');
        for(let i=0;i<9;i++) await db.query('update public.route_holes set stroke_index=$1 where route_id=$2 and physical_hole_number=$3',[sequence[i],nine,i+1]);
        await role(); draft=(await open()).draft;
        const expected=new Set(sequence).size===9 && sequence[0]!=null ? sequence : Array.from({length:9},(_,i)=>i+1);
        assert.deepEqual(draft.base_snapshot._si_sequence,expected);
        const s=clone(draft.snapshot); s.holes.forEach((h,i)=>{h.stroke_index=expected[8-i];});
        draft=await save(draft,s); await publish(draft);
      }
      assert.deepEqual(await unchanged(),baseline);
    });

    await t.test('missing live Par total stays null; inactive course remains editable without changing visibility',async()=>{
      await db.exec('reset role'); await db.query('update public.course_routes set total_par=null,is_active=false where id=$1',[nine]); await role();
      draft=(await open()).draft; const s=swap(draft); s.holes[0].par=5;
      draft=await save(draft,s); await publish(draft);
      await db.exec('reset role');
      const live=(await db.query('select total_par,is_active from public.course_routes where id=$1',[nine])).rows[0];
      assert.deepEqual(live,{total_par:null,is_active:false});
      await role();
    });

    await t.test('new migration is one-shot, failure on reapplication leaves history/live unchanged',async()=>{
      await db.exec('reset role'); const before=await holes(); const history=await versions();
      await fails(()=>db.exec(migrations.at(-1)),'42P07'); await db.exec('rollback');
      assert.deepEqual(await holes(),before); assert.deepEqual(await versions(),history);
    });
  } finally {await db.close();}
});
