// Boundary regression independent of the uncommitted Task 6 implementation.
// The fixture intentionally models only the pre-existing RPC signature/errors.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {admin,player,role,rpc,sql,setup} from './helpers/existing-club-course-fixture.mjs';
const {PGlite}=await import(process.env.STABLR_PGLITE_MODULE||'@electric-sql/pglite');
const signature='(text,uuid,text,uuid,bigint,jsonb,text,text,uuid)';
const fail=(action,code)=>assert.rejects(action,e=>e.code===code);

test('PT409 boundary preserves Admin authorization, original body and atomic rollback without Task 6 modules',async t=>{
  const db=new PGlite();
  try{
    const {old}=await setup(db);
    await db.exec('reset role');
    await db.exec(`
      create table public.conflict_boundary_fixture(value text);
      insert into public.conflict_boundary_fixture values('unchanged');
      create function public.admin_catalog_metadata(p_kind text,p_target uuid,p_action text,p_draft_id uuid default null,
        p_expected_revision bigint default null,p_snapshot jsonb default null,p_confirmation_hash text default null,p_note text default null,p_version_id uuid default null)
      returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
      begin
        perform public.admin_catalog_require_admin();
        if p_expected_revision is distinct from 1::bigint then
          raise exception 'Bozza cambiata o chiusa' using errcode='40001';
        end if;
        if p_action='publish' then update public.conflict_boundary_fixture set value='candidate';end if;
        if p_note='changed' then raise exception 'Base live o versione cambiata' using errcode='40001';end if;
        if p_note='invalid' then raise exception 'Invalid fixture' using errcode='22023';end if;
        return jsonb_build_object('revision',p_expected_revision,'action',p_action);
      end $$;
      revoke all on function public.admin_catalog_metadata${signature} from public,anon,authenticated,service_role;
      grant execute on function public.admin_catalog_metadata${signature} to authenticated;
    `);
    const read=async statement=>{await db.exec('reset role');try{return await db.query(statement);}finally{await role(db);}};
    const body=async name=>(await read(`select prosrc body from pg_proc where oid='public.${name}${signature}'::regprocedure`)).rows[0].body;
    const original=await body('admin_catalog_metadata');
    const call=(action='preview',revision=1,note=null)=>rpc(db,'admin_catalog_metadata',['route',old.id,action,null,revision,null,null,note]);
    await role(db);await fail(()=>call('preview',0),'40001');
    const migration=await sql('admin-catalog-metadata-conflict-errors');
    await db.exec('reset role');await db.exec(migration);await role(db);
    await t.test('migration preserves original implementation and makes its direct API execution inaccessible',async()=>{
      assert.equal(await body('admin_catalog_metadata_before_conflict_errors'),original);
      for(const name of ['anon','authenticated','service_role']){
        const result=await read(`select has_function_privilege('${name}','public.admin_catalog_metadata_before_conflict_errors${signature}','EXECUTE') allowed`);
        assert.equal(result.rows[0].allowed,false);
      }
      await fail(()=>rpc(db,'admin_catalog_metadata_before_conflict_errors',['route',old.id,'preview']),'42501');
    });
    await t.test('anon, player, missing identity and service API remain denied',async()=>{
      for(const [name,id] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',admin]]){
        await role(db,name,id);await fail(()=>call(),'42501');
      }
      await role(db);
    });
    await t.test('stale revision returns PT409 even in read-only transaction; no retry or mutation',async()=>{
      await db.exec('begin read only');await fail(()=>call('preview',0),'PT409');await db.exec('rollback');
      const result=await call();assert.equal(result.action,'preview');
      assert.equal((await read('select value from public.conflict_boundary_fixture')).rows[0].value,'unchanged');
    });
    await t.test('conflict after mutation rolls back the whole operation; unrelated errors retain their code',async()=>{
      await fail(()=>call('publish',1,'changed'),'PT409');
      await fail(()=>call('publish',1,'invalid'),'22023');
      assert.equal((await read('select value from public.conflict_boundary_fixture')).rows[0].value,'unchanged');
      assert.equal((await call('publish')).action,'publish');
      assert.equal((await read('select value from public.conflict_boundary_fixture')).rows[0].value,'candidate');
    });
    await t.test('one-shot migration rejects reapplication without partial changes',async()=>{
      await db.exec('reset role');await fail(()=>db.exec(migration),'42723');await db.exec('rollback');await role(db);
      await fail(()=>call('preview',0),'PT409');
    });
  }finally{await db.close();}
});
