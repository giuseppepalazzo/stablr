// Isolated PostgreSQL/WASM plus Storage metadata fixtures; never connects to Supabase.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { extractFigEvidence, sha256 } from '../evidence/fig-tee-evidence.mjs';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const migration=await readFile(new URL('../../supabase/admin-catalog-tee-evidence.sql',import.meta.url),'utf8');
const admin='11111111-1111-4111-8111-111111111111', player='22222222-2222-4222-8222-222222222222';
const bytes=Buffer.from(JSON.stringify({schema_version:'1.0',source_system:'fig',source_url:'https://areariservata.federgolf.it/SlopeAndCourseRating/Index',tables:[{table_index:0,rows:[
  {row_index:0,cells:['','TEE UOMINI','TEE DONNE']},{row_index:1,cells:['','GIALLO']},
  {row_index:2,cells:['Circolo','Percorso','PAR','CR','Slope']},{row_index:3,cells:['Fixture','9 Buche','35','34,8','120']},
  {row_index:4,cells:['Malformed fixture']}
]}]}));
const manifest=extractFigEvidence(bytes);
const preparation=(m=manifest,id=randomUUID())=>JSON.stringify({contract_version:1,batch_id:id,manifest:m},null,2)+'\n';
test('tee evidence security: raw/server-only, one-use approval and exactly one append-only receipt',async(t)=>{
  const db=new PGlite();
  const role=async(name='authenticated',uid=admin,claim=name)=>{await db.exec('reset role;set role '+name);await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,claim]);};
  const rpc=async(name,args=[]) => (await db.query(`select public.admin_catalog_tee_evidence_${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).rows[0].r;
  const fail=(f,code)=>assert.rejects(f,e=>e.code===code);
  const tables=['admin_catalog_tee_source_artifacts','admin_catalog_tee_source_evidence','admin_catalog_tee_evidence_batches','admin_catalog_tee_evidence_batch_items'];
  const counts=async()=>{await db.exec('reset role');const out={};for(const table of tables)out[table]=(await db.query('select count(*) n from public.'+table)).rows[0].n;await role();return out;};
  const upload=async(m)=>{await role('service_role','');await db.query("insert into storage.objects(bucket_id,name,metadata) values('admin-catalog-evidence',$1,$2)",[m.artifact.object_path,{size:m.artifact.byte_size}]);};
  const stage=async(text=preparation(),operator=admin)=>{await role('service_role','');return rpc('stage',[text,operator]);};
  const confirm=async(s,note='Explicit fixture approval',overrides={})=>{await role('service_role','');return rpc('confirm',[overrides.proposal??s.proposal_id,overrides.hash??s.approval_sha256,overrides.actor??admin,note,overrides.confirm??true]);};
  const text=preparation();let staged,receipt;
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      create table public.profiles(id uuid primary key,role text);grant usage on schema auth to anon,authenticated,service_role;
      create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
      create function public.admin_catalog_require_admin() returns uuid language plpgsql security definer set search_path=pg_catalog as $$begin if auth.uid() is null or auth.role() is distinct from 'authenticated' or public.is_admin() is distinct from true then raise exception 'Admin required' using errcode='42501';end if;return auth.uid();end$$;
      revoke all on function public.admin_catalog_require_admin() from public,anon,authenticated,service_role;
      create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text,metadata jsonb,unique(bucket_id,name));
      alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;
      grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;grant select on storage.buckets to anon,authenticated,service_role;
      create policy existing_broad_policy on storage.objects for all to anon,authenticated using(true) with check(true);
      create table public.route_tees(id integer,par_total integer);insert into public.route_tees values(1,35);
      create table public.combination_tees(id integer,par_total integer);insert into public.combination_tees values(1,72);`);
    await db.query("insert into public.profiles values($1,'admin'),($2,'user')",[admin,player]);
    await t.test('additive one-shot: private bucket, internal-only FKs, no live or classification writes',async()=>{
      await db.exec(migration);assert.equal((await db.query("select public from storage.buckets where id='admin-catalog-evidence'")).rows[0].public,false);
      const fks=(await db.query("select confrelid::regclass::text target from pg_constraint where contype='f' and conrelid::regclass::text like 'admin_catalog_tee_%'")).rows;
      assert.ok(fks.every(f=>tables.includes(f.target)));assert.equal((await db.query('select par_total from public.route_tees')).rows[0].par_total,35);
      await fail(()=>db.exec(migration),'23505');await db.exec('rollback');await role();
    });
    await t.test('raw SELECT/download authorization denied to ALL browser roles, including Admin despite broad policies',async()=>{
      await upload(manifest);
      assert.equal((await db.query("select * from storage.objects where bucket_id='admin-catalog-evidence'")).rows.length,1);
      for(const args of [['anon',''],['authenticated',player],['authenticated',admin]]){
        await role(...args);
        assert.equal((await db.query("select * from storage.objects where bucket_id='admin-catalog-evidence'")).rows.length,0);
        await fail(()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('admin-catalog-evidence','forbidden','{}')"),'42501');
        assert.equal((await db.query("update storage.objects set name='forbidden' where bucket_id='admin-catalog-evidence' returning id")).rows.length,0);
        assert.equal((await db.query("delete from storage.objects where bucket_id='admin-catalog-evidence' returning id")).rows.length,0);
      }
      await db.exec("reset role;insert into storage.buckets(id,name,public) values('other-bucket','other-bucket',false)");
      await role('authenticated',player);await db.exec("insert into storage.objects(bucket_id,name,metadata) values('other-bucket','unchanged-policy','{}')");
      assert.equal((await db.query("select * from storage.objects where bucket_id='other-bucket'")).rows.length,1);await role();
    });
    await t.test('Admin browser/anon/player cannot stage or confirm, even with known hashes or forged claims',async()=>{
      for(const args of [['anon',''],['authenticated',player],['authenticated',admin],['authenticated',''],['authenticated',admin,'service_role'],['service_role',admin,'authenticated']]){
        await role(...args);await fail(()=>rpc('stage',[text,admin]),'42501');
        await fail(()=>rpc('confirm',[admin,'a'.repeat(64),admin,'note',true]),'42501');
      }
      for(const args of [['anon',''],['authenticated',player],['service_role',admin],['authenticated',''],['authenticated',admin,'service_role']]){
        await role(...args);for(const [name,a] of [['list',[0]],['detail',[admin,0]],['preview',[null]]])await fail(()=>rpc(name,a),'42501');
      }
      for(const args of [['anon',''],['authenticated',admin],['service_role','']]){await role(...args);for(const table of tables){await fail(()=>db.exec('select * from public.'+table),'42501');await fail(()=>db.exec('insert into public.'+table+' default values'),'42501');}}
      await role('service_role','');await fail(()=>rpc('stage',[text,player]),'42501');
      await fail(()=>rpc('confirm',[admin,'a'.repeat(64),player,'note',true]),'42501');
      staged=await stage(text);assert.deepEqual(await stage(text),staged);
      assert.equal(staged.approval_sha256,sha256(Buffer.from(text)));assert.equal(staged.proposal_id,JSON.parse(text).batch_id);await role();
    });
    await t.test('Admin preview/list are read-only and cannot expose staged manifests, storage paths or approval capabilities',async()=>{
      const before=await counts();await db.exec('begin read only');const p=await rpc('preview',[staged.artifact_id]);const list=await rpc('list',[0]);await db.exec('commit');
      assert.equal(p.counts.incomplete,1);assert.equal(p.counts.excluded,1);assert.deepEqual(list.items,[]);assert.equal(list.total,0);assert.deepEqual(await counts(),before);
      const response=JSON.stringify(p);for(const forbidden of ['Fixture','extraction_manifest','object_path','approval_sha256','source_payload','snapshot'])assert.ok(!response.includes(forbidden));
      await fail(()=>rpc('detail',[staged.proposal_id,0]),'22023');
    });
    await t.test('tampered/unknown/false-complete evidence and mutation of a prepared identity are rejected',async()=>{
      for(const mutate of [m=>{m.items[0].evidence.source_payload={secret:true};},m=>{m.items[0].outcome='complete';},m=>{m.items[0].evidence.applicability_normalized='men';},m=>{m.items[0].evidence.par_origin='dichiarato';},m=>{m.items.push(m.items[0]);},m=>{delete m.contract_version;},m=>{m.items[0].evidence.par_original={secret:'Nested payload'};},m=>{m.items[0].evidence.scope_normalized=27;},m=>{m.items[0].outcome=null;}]){
        const m=structuredClone(manifest);mutate(m);await assert.rejects(()=>stage(preparation(m)));
      }
      const changed=structuredClone(manifest);changed.artifact.source_version='Changed without new source hash';await fail(()=>stage(preparation(changed)),'40001');
      const reformatted=JSON.stringify(JSON.parse(text));await fail(()=>stage(reformatted),'40001');await role();
    });
    await t.test('service confirmation validates exact approval server-side and consumes it once; retry returns SAME receipt',async()=>{
      await fail(()=>confirm(staged,'note',{confirm:false}),'22023');
      await fail(()=>confirm(staged,'note',{hash:'0'.repeat(64)}),'40001');
      receipt=await confirm(staged);assert.equal(receipt.inserted,1);assert.equal(receipt.excluded,1);
      const before=await counts();assert.deepEqual(await confirm(staged),receipt);assert.deepEqual(await counts(),before);
      await fail(()=>confirm(staged,'Different note pretending new approval'),'40001');
      await role();const d=await rpc('detail',[receipt.batch_id,0]);assert.equal(d.items.length,2);assert.equal(d.items[1].reason,'invalid_row_shape');
      assert.equal(d.items[0].evidence.par_origin,'comune_configurazione');assert.equal(d.items[0].evidence.applicability_normalized,null);
      const response=JSON.stringify(d);for(const forbidden of ['extraction_manifest','object_path','source_payload','snapshot','approval_sha256','proposal_id',admin,'PRIVATE_SECRET','storage/v1','sign/'])assert.ok(!response.includes(forbidden));
      assert.equal((await rpc('list',[0])).total,1);
    });
    await t.test('a reused approval cannot authorize another batch; NEW reviewed identity/hash is required',async()=>{
      const second=await stage(preparation());assert.notEqual(second.approval_sha256,staged.approval_sha256);
      const before=await counts();await fail(()=>confirm(second,'New batch',{hash:staged.approval_sha256}),'40001');assert.deepEqual(await counts(),before);
      const r=await confirm(second,'New explicit approval');assert.notEqual(r.batch_id,receipt.batch_id);assert.equal(r.inserted,0);assert.equal(r.existing,1);
      assert.deepEqual(await confirm(second,'New explicit approval'),r);await role();assert.equal((await rpc('list',[0])).total,2);
    });
    await t.test('fixed paths, narrow ACLs, NOWAIT locks, operator isolation and receipt uniqueness',async()=>{
      await db.exec('reset role');const funcs=(await db.query("select proname,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname like 'admin_catalog_tee_evidence_%'")).rows;
      assert.ok(funcs.every(f=>f.prosecdef&&f.proconfig.includes('search_path=pg_catalog')));assert.match(migration,/pg_try_advisory_xact_lock/);assert.match(migration,/for share nowait/);assert.match(migration,/unique\(proposal_id\)/);
      const other='33333333-3333-4333-8333-333333333333';await db.query("insert into public.profiles values($1,'admin')",[other]);
      await fail(()=>confirm(staged,'Explicit fixture approval',{actor:other}),'42501');
      await role();await fail(()=>db.query('select public.admin_catalog_tee_evidence_receipt(null::public.admin_catalog_tee_evidence_batches)'),'42501');
    });
    await t.test('archive records and registered objects remain append-only for every API role and owner updates',async()=>{
      await db.exec('reset role');for(const table of tables){await fail(()=>db.exec(`update public.${table} set id=id`),'55000');await fail(()=>db.exec('delete from public.'+table),'55000');await fail(()=>db.exec('truncate public.'+table+' cascade'),'55000');}
      await role('service_role','');await fail(()=>db.query("update storage.objects set name='replace' where bucket_id='admin-catalog-evidence'"),'55000');await fail(()=>db.exec("delete from storage.objects where bucket_id='admin-catalog-evidence'"),'55000');
      await db.exec('reset role');await fail(()=>db.exec("update storage.buckets set public=true where id='admin-catalog-evidence'"),'55000');await role();
    });
    await t.test('failed item/audit creation rolls back consumption, receipt and evidence; same approval can retry',async()=>{
      const pending=await stage(preparation());const before=await counts();
      await db.exec("reset role;create function public.fixture_fail_item() returns trigger language plpgsql as $$begin raise exception 'Fixture fault' using errcode='23514';end$$;create trigger fixture_item_failure before insert on public.admin_catalog_tee_evidence_batch_items for each row execute function public.fixture_fail_item()");
      await fail(()=>confirm(pending,'Rollback approval'),'23514');assert.deepEqual(await counts(),before);
      await db.exec('reset role;drop trigger fixture_item_failure on public.admin_catalog_tee_evidence_batch_items');
      const r=await confirm(pending,'Rollback approval');assert.deepEqual(await confirm(pending,'Rollback approval'),r);
    });
    await t.test('changed source hash creates evidence, no live UUID inheritance or unrelated writes',async()=>{
      const changed=extractFigEvidence(Buffer.from(bytes.toString()+' '));await upload(changed);const s=await stage(preparation(changed));await confirm(s,'New artifact version fixture');
      await db.exec('reset role');assert.equal((await db.query('select count(*) n from public.admin_catalog_tee_source_evidence')).rows[0].n,2);
      assert.equal((await db.query('select count(*) n from public.admin_catalog_tee_source_evidence where predecessor_id is not null')).rows[0].n,0);
      assert.equal((await db.query('select par_total from public.route_tees')).rows[0].par_total,35);assert.equal((await db.query('select par_total from public.combination_tees')).rows[0].par_total,72);await role();
    });
  }finally{await db.close();}
});
