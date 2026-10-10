// Entire PostgreSQL archive + incremental broker migration, isolated WASM, no remote calls.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { extractFigEvidence,sha256 } from '../evidence/fig-tee-evidence.mjs';
import { proposalId,createBroker } from '../../supabase/functions/tee-evidence-broker/handler.mjs';
const {PGlite}=await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const base=await readFile(new URL('../../supabase/admin-catalog-tee-evidence.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('../../supabase/admin-catalog-tee-evidence-broker.sql',import.meta.url),'utf8');
const admin='11111111-1111-4111-8111-111111111111',player='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const ctx=(run='100',changes={})=>({repository:'giuseppepalazzo/stablr',repository_id:'123',repository_owner_id:'456',ref:'refs/heads/main',
  event_name:'workflow_dispatch',workflow_ref:'giuseppepalazzo/stablr/.github/workflows/tee-evidence-batch.yml@refs/heads/main',workflow_sha:'a'.repeat(40),
  runner_environment:'github-hosted',actor_id:'789',run_id:run,run_attempt:'1',audience:'stablr:tee-evidence:test',...changes});
const raw=JSON.stringify({schema_version:'1.0',source_system:'fig',source_url:'https://areariservata.federgolf.it/SlopeAndCourseRating/Index',tables:[{table_index:0,rows:[
  {row_index:0,cells:['','TEE']},{row_index:1,cells:['','GIALLO']},{row_index:2,cells:['Circolo','Percorso','PAR','CR','Slope']},
  {row_index:3,cells:['PRIVATE_RAW_LABEL','9 Buche','35','34,8','120']},{row_index:4,cells:['invalid']}
]}]});
const bytes=Buffer.from(raw),manifest=extractFigEvidence(bytes);
const prep=(context=ctx(),m=manifest)=>JSON.stringify({contract_version:1,batch_id:proposalId(context,m.artifact.sha256),manifest:m},null,2)+'\n';
const token=run=>sha256(Buffer.from('fixture-jti-'+run));
test('incremental broker SQL authorization, exact preparation, replay, one receipt and atomic audit',async t=>{
  const db=new PGlite();
  const role=async(name='service_role',uid='',claim=name)=>{
    await db.exec('reset role;set role '+name);await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,claim]);
  };
  const rpc=async(name,args)=>(await db.query(`select public.admin_catalog_tee_broker_${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).rows[0].r;
  const fail=(f,code)=>assert.rejects(f,e=>e.code===code);
  const names=['admin_catalog_tee_source_artifacts','admin_catalog_tee_source_evidence','admin_catalog_tee_evidence_batches','admin_catalog_tee_evidence_batch_items',
    'admin_catalog_tee_broker_preparations','admin_catalog_tee_broker_requests'];
  const counts=async()=>{await db.exec('reset role');const out={};for(const name of names)out[name]=(await db.query('select count(*) n from public.'+name)).rows[0].n;await role();return out;};
  const stage=(context=ctx(),text=prep(context),oidcHash=token(context.run_id),operator=admin)=>rpc('stage',[text,context,oidcHash,operator]);
  const confirm=(p,context=ctx('200'),note='Explicit approval',hash=p.approval_sha256,operator=admin,oidcHash=token(context.run_id))=>
    rpc('confirm',[p.proposal_id,hash,note,context,oidcHash,operator]);
  let p,r;
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      grant usage on schema auth to anon,authenticated,service_role;
      create table public.profiles(id uuid primary key,role text);
      create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
      create function public.admin_catalog_require_admin() returns uuid language plpgsql security definer set search_path=pg_catalog as $$begin
        if auth.uid() is null or auth.role() is distinct from 'authenticated' or public.is_admin() is distinct from true then
        raise exception 'Admin required' using errcode='42501';end if;return auth.uid();end$$;
      revoke all on function public.admin_catalog_require_admin() from public,anon,authenticated,service_role;
      create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text,metadata jsonb,unique(bucket_id,name));
      alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;
      grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
      create policy broad on storage.objects for all to anon,authenticated using(true) with check(true);
      create table public.route_tees(id integer,par_total integer);insert into public.route_tees values(1,35);
      create table public.route_holes(id integer,par integer,stroke_index integer);insert into public.route_holes values(1,4,7);
      create table public.rounds(id integer,source_snapshot jsonb);insert into public.rounds values(1,'{"immutable":true}');`);
    await db.query("insert into public.profiles values($1,'admin'),($2,'user'),($3,'admin')",[admin,player,other]);
    await db.exec(base);await db.exec(migration);await role();
    await t.test('one-shot, narrow service ACLs, RLS no direct DML, internal-only FKs, read-only preflight',async()=>{
      const before=await counts();await db.exec('begin read only');assert.deepEqual(await rpc('preflight',[prep(),ctx(),token('100'),admin]),{authorized:true});await db.exec('commit');assert.deepEqual(await counts(),before);
      for(const args of [['anon',''],['authenticated',player],['authenticated',admin],['authenticated',''],['authenticated',admin,'service_role'],['service_role','', 'authenticated']]){
        await role(...args);for(const [name,a] of [['preflight',[prep(),ctx(),token('100'),admin]],['stage',[prep(),ctx(),token('100'),admin]],
          ['prepared',[admin,admin]],['confirm',[admin,'c'.repeat(64),'note',ctx(),token('100'),admin]]])await fail(()=>rpc(name,a),'42501');
      }
      for(const args of [['anon',''],['authenticated',admin],['service_role','']]) {
        await role(...args);for(const name of names.slice(4)){await fail(()=>db.exec('select * from public.'+name),'42501');await fail(()=>db.exec('insert into public.'+name+' default values'),'42501');
          await fail(()=>db.exec('update public.'+name+' set operator_id=operator_id'),'42501');await fail(()=>db.exec('delete from public.'+name),'42501');}
      }
      await db.exec('reset role');const fks=(await db.query("select confrelid::regclass::text target from pg_constraint where contype='f' and conrelid::regclass::text like 'admin_catalog_tee_broker_%'")).rows;
      assert.ok(fks.every(f=>names.includes(f.target)));
      await fail(()=>db.exec(migration),'42P07');await db.exec('rollback');await role();
    });
    await t.test('SQL rejects invalid context/extra payload/unauthorized operator before writes',async()=>{
      const before=await counts();
      for(const changes of [{event_name:'pull_request'},{repository:'fork/stablr'},{ref:'refs/heads/other'},{run_attempt:'2'},
        {workflow_ref:'attacker'},{runner_environment:'self-hosted'},{source_payload:{secret:true}},{actor_id:789},{workflow_sha:'unknown'}])await assert.rejects(()=>stage(ctx('100',changes)));
      await fail(()=>stage(ctx(),prep(),token('100'),player),'42501');assert.deepEqual(await counts(),before);
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('admin-catalog-evidence',$1,$2)",[manifest.artifact.object_path,{size:bytes.length}]);
    });
    await t.test('stage persists exact bytes and signed context, retry has no extra preparation or request',async()=>{
      p=await stage();assert.equal(p.approval_sha256,sha256(Buffer.from(prep())));assert.equal(p.counts.incomplete,1);assert.equal(p.counts.excluded,1);
      const before=await counts();assert.deepEqual(await stage(),p);assert.deepEqual(await stage(ctx(),prep(),token('fresh-token')),p);assert.deepEqual(await counts(),before);
      const internal=await rpc('prepared',[p.proposal_id,admin]);assert.deepEqual(internal,{approval_sha256:p.approval_sha256,actor_id:'789',workflow_sha:'a'.repeat(40)});
      await fail(()=>rpc('prepared',[p.proposal_id,other]),'42501');await fail(()=>rpc('prepared',[other,admin]),'42501');
      for(const secret of ['PRIVATE_RAW_LABEL','preparation_text','github_context','object_path',admin]) {
        assert.ok(!JSON.stringify(p).includes(secret));assert.ok(!JSON.stringify(internal).includes(secret));
      }
      await db.exec('reset role');const rows=(await db.query('select * from public.admin_catalog_tee_broker_preparations')).rows;
      assert.equal(rows.length,1);assert.equal(rows[0].preparation_text,prep());assert.deepEqual(rows[0].github_context,ctx());await role();
    });
    await t.test('run/token replay cannot swap manifest, operation, actor or context, even with another valid preparation',async()=>{
      const before=await counts();
      await fail(()=>stage(ctx(),JSON.stringify(JSON.parse(prep())),token('100')),'40001');
      await fail(()=>stage(ctx('101'),prep(ctx('101')),token('100')),'40001');
      await fail(()=>confirm(p,ctx()),'40001');
      await fail(()=>stage(ctx('100',{actor_id:'888'})),'40001');
      await fail(()=>stage(ctx(),prep(),token('100'),other),'40001');assert.deepEqual(await counts(),before);
    });
    await t.test('confirm atomic audit + evidence + receipt; identical technical retry returns ONE receipt',async()=>{
      const before=await counts();await fail(()=>confirm(p,ctx('200'),'Explicit approval','0'.repeat(64)),'40001');assert.deepEqual(await counts(),before);
      await fail(()=>confirm(p,ctx('200',{actor_id:'888'})),'42501');await fail(()=>confirm(p,ctx('200'),'Explicit approval',p.approval_sha256,other),'42501');
      r=await confirm(p);assert.equal(r.inserted,1);const after=await counts();assert.deepEqual(await confirm(p),r);assert.deepEqual(await counts(),after);
      assert.deepEqual(await confirm(p,ctx('201')),r);assert.equal((await counts()).admin_catalog_tee_evidence_batches,2);
      await fail(()=>confirm(p,ctx('200'),'Different decision'),'40001');await fail(()=>confirm({...p,proposal_id:other},ctx('200')),'40001');
      await role('authenticated',admin);const ui=(await db.query('select public.admin_catalog_tee_evidence_detail($1,0) r',[r.batch_id])).rows[0].r;
      for(const forbidden of ['preparation_text','object_path','github_context','approval_sha256',admin,token('200')])assert.ok(!JSON.stringify(ui).includes(forbidden));await role();
    });
    await t.test('new preview requires NEW manifest identity/hash; old approval cannot consume it',async()=>{
      const second=await stage(ctx('300'));assert.notEqual(second.proposal_id,p.proposal_id);assert.notEqual(second.approval_sha256,p.approval_sha256);
      const before=await counts();await fail(()=>confirm(second,ctx('301'),'Explicit new approval',p.approval_sha256),'40001');assert.deepEqual(await counts(),before);
      const next=await confirm(second,ctx('301'),'Explicit new approval');assert.notEqual(next.batch_id,r.batch_id);assert.equal(next.existing,1);assert.equal(next.inserted,0);
    });
    await t.test('append-only preparations/context/audit; locks and uniqueness; current Admin revocation',async()=>{
      await db.exec('reset role');for(const name of names.slice(4)) {await fail(()=>db.exec('update public.'+name+' set operator_id=operator_id'),'55000');
        await fail(()=>db.exec('delete from public.'+name),'55000');await fail(()=>db.exec('truncate public.'+name+' cascade'),'55000');}
      const funcs=(await db.query("select prosecdef,proconfig from pg_proc where proname like 'admin_catalog_tee_broker_%'")).rows;
      assert.ok(funcs.every(f=>f.prosecdef&&f.proconfig.includes('search_path=pg_catalog')));assert.match(migration,/pg_try_advisory_xact_lock/);assert.match(migration,/for share nowait/);
      await db.query("update public.profiles set role='user' where id=$1",[admin]);await role();await fail(()=>stage(ctx('400')),'42501');await fail(()=>confirm(p,ctx('401')),'42501');
      await db.exec('reset role');await db.query("update public.profiles set role='admin' where id=$1",[admin]);await role();
    });
    await t.test('failure creating broker audit rolls back stage and all confirmation rows, no partial consumption',async()=>{
      await db.exec("reset role;create function public.fixture_broker_fail() returns trigger language plpgsql as $$begin raise exception 'fixture' using errcode='23514';end$$;create trigger fixture_fail before insert on public.admin_catalog_tee_broker_requests for each row execute function public.fixture_broker_fail()");await role();
      let before=await counts();await fail(()=>stage(ctx('500')),'23514');assert.deepEqual(await counts(),before);
      await db.exec('reset role;drop trigger fixture_fail on public.admin_catalog_tee_broker_requests');await role();
      const fresh=await stage(ctx('500'));before=await counts();
      await db.exec('reset role;create trigger fixture_fail before insert on public.admin_catalog_tee_broker_requests for each row execute function public.fixture_broker_fail()');await role();
      await fail(()=>confirm(fresh,ctx('501'),'Retry approval'),'23514');assert.deepEqual(await counts(),before);
      await db.exec('reset role;drop trigger fixture_fail on public.admin_catalog_tee_broker_requests');await role();const receipt=await confirm(fresh,ctx('501'),'Retry approval');assert.deepEqual(await confirm(fresh,ctx('501'),'Retry approval'),receipt);
    });
    await t.test('HTTP handler + real PostgreSQL RPCs, minimized response and idempotent retry',async()=>{
      let context=ctx('600'),jti='http600';const stored=new Map([[manifest.artifact.object_path,bytes]]);
      const client={rpc:async(name,a)=>{try {await role();let data;
        if(name.endsWith('preflight')||name.endsWith('stage'))data=await rpc(name.split('broker_')[1],[a.p_preparation_text,a.p_context,a.p_token_hash,a.p_operator_id]);
        else if(name.endsWith('prepared'))data=await rpc('prepared',[a.p_proposal_id,a.p_operator_id]);
        else data=await rpc('confirm',[a.p_proposal_id,a.p_approved_sha256,a.p_note,a.p_context,a.p_token_hash,a.p_operator_id]);
        return {data,error:null};}catch(error){return {data:null,error};}},storage:{from:()=>({
          download:async path=>({data:new Blob([stored.get(path)]),error:null}),upload:async()=>{throw new Error('No real upload');}
        })}};
      const handler=createBroker({verify:async()=>({operatorId:admin,context,jti}),policy:{revisions:['a'.repeat(40)]},serviceFactory:()=>client});
      const req=body=>new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(body)});
      const previewBody={operation:'preview',raw,raw_sha256:manifest.artifact.sha256};const response=await handler(req(previewBody));assert.equal(response.status,200);const result=await response.json();
      assert.deepEqual(await(await handler(req(previewBody))).json(),result);context=ctx('601');jti='http601';
      const confirmBody={operation:'confirm',proposal_id:result.proposal_id,approval_sha256:result.approval_sha256,note:'HTTP fixture approval'};
      const receipt=await(await handler(req(confirmBody))).json();assert.equal(receipt.existing,1);assert.deepEqual(await(await handler(req(confirmBody))).json(),receipt);
    });
    await t.test('no catalog/import/editor/round/version linkage or writes and all existing live fixtures unchanged',async()=>{
      assert.ok(!/(?:insert into|update|delete from)\s+(?:public\.)?(route_tees|route_holes|course_routes|combination_tees|route_combinations|rounds|profiles|admin_catalog_drafts|admin_catalog_versions)\b/i.test(migration));
      await db.exec('reset role');assert.deepEqual((await db.query('select * from public.route_tees')).rows,[{id:1,par_total:35}]);
      assert.deepEqual((await db.query('select * from public.route_holes')).rows,[{id:1,par:4,stroke_index:7}]);assert.deepEqual((await db.query('select * from public.rounds')).rows,[{id:1,source_snapshot:{immutable:true}}]);
    });
  } finally {await db.close();}
});
