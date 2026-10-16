import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setupSi,repeatedNine,physicalEighteen,call,owner,role,rpc,admin,other,player,dump} from './helpers/tee-si-fixture.mjs';
const {PGlite}=await import(process.env.STABLR_PGLITE_MODULE||'@electric-sql/pglite');
const fail=(action,code)=>assert.rejects(action,e=>e.code===code);
test('tee SI exact-ID workflow, private drafts, atomic projection/history, no rating/Par/grid/round changes',async t=>{
  const db=new PGlite();
  try {
    const {tee,courseTee,combination}=await setupSi(db);
    const change = (d,c) => ({mode:'managed',holes:d.snapshot.holes.map((h,i)=>({...h,si:i===0?c.holes[1].standard_si:i===1?c.holes[0].standard_si:null}))});
    let d,ctx,p,version;
    await t.test('detail and preview are truly read-only; no backfill or initial draft',async()=>{
      const before=await dump(db);await db.exec('begin read only');const detail=await call(db,tee,'detail');await db.exec('commit');
      assert.equal(detail.draft,null);assert.equal(detail.context.holes.length,18);assert.deepEqual(await dump(db),before);
      assert.ok(!/source_payload|source_external_id|TEST_NOT_EXPOSED/.test(JSON.stringify(detail)));
    });
    await t.test('anon/player/no UID/service and foreign-owner actions refused; no direct writes/private helper access',async()=>{
      ({draft:d,context:ctx}=await call(db,tee,'open'));
      for(const [name,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',admin]]) {
        await role(db,name,uid);for(const action of ['detail','open','save','preview','publish','archive','restore'])await fail(()=>call(db,tee,action,d),'42501');
        await fail(()=>db.query('insert into public.catalog_tee_si default values'),'42501');
      }
      await role(db,'authenticated',other);for(const action of ['save','preview','publish','archive'])await fail(()=>call(db,tee,action,d),'42501');
      await role(db);await fail(()=>rpc(db,'admin_tee_si_context',['combination_tee',tee.id]),'42501');
      for(const table of ['catalog_tee_si','admin_catalog_drafts','admin_catalog_versions'])assert.equal((await owner(db,`select has_table_privilege('authenticated','public.${table}','INSERT,UPDATE,DELETE') v`)).rows[0].v,false);
    });
    await t.test('resumption, allowlist, exact identity, schema and CAS; saves never touch live',async()=>{
      assert.equal((await call(db,tee,'open')).draft.draft_id,d.draft_id);
      for(const fields of [{...d.snapshot,par:4},{...d.snapshot,mode:null},{...d.snapshot,mode:'x'},{mode:'managed',holes:[]},
        {...change(d,ctx),holes:d.snapshot.holes.map(h=>({...h,par:4}))}])await fail(()=>call(db,tee,'save',d,fields),'22023');
      await fail(()=>call(db,tee,'save',d,{mode:'managed',holes:d.snapshot.holes.map(h=>({...h,si:19}))}),'23514');
      const before=await dump(db);d=(await call(db,tee,'save',d,change(d,ctx))).draft;
      assert.deepEqual((await dump(db)).combination_tees,before.combination_tees);
      await fail(()=>call(db,tee,'save',{...d,revision:1},d.snapshot),'40001');
    });
    await t.test('read-only signed preview, duplicates block, explicit confirmation/note required',async()=>{
      const saved=d.snapshot;d=(await call(db,tee,'save',d,{...saved,holes:saved.holes.map(h=>({...h,si:1}))})).draft;
      assert.equal((await call(db,tee,'preview',d)).can_publish,false);d=(await call(db,tee,'save',d,saved)).draft;
      const before=await dump(db);await db.exec('begin read only');p=await call(db,tee,'preview',d);await db.exec('commit');assert.deepEqual(await dump(db),before);
      assert.equal(p.can_publish,true);assert.equal(p.changes.length,18);
      await fail(()=>call(db,tee,'publish',d,null,'wrong','TEST'),'22023');await fail(()=>call(db,tee,'publish',d,null,p.confirmation_hash,''),'22023');
    });
    await t.test('projection, immutable version/audit and draft closure commit atomically; everything else unchanged',async()=>{
      const before=await dump(db);const result=await call(db,tee,'publish',d,null,p.confirmation_hash,'Explicit SI TEST');version=result.version_id;
      const after=await dump(db);for(const table of Object.keys(before).filter(k=>!['catalog_tee_si','admin_catalog_drafts','admin_catalog_versions'].includes(k)))assert.deepEqual(after[table],before[table],table);
      assert.equal(result.contract.holes[0].si,ctx.holes[1].standard_si);assert.equal((await call(db,tee,'detail')).draft,null);
      await fail(()=>call(db,tee,'publish',d,null,p.confirmation_hash,'TEST'),'42501');
      await fail(()=>owner(db,'delete from public.admin_catalog_versions where version_id=$1',[version]),'55000');
      await role(db,'authenticated',player);assert.equal((await db.query('select contract from public.catalog_tee_si')).rows.length,1);
      await fail(()=>db.query('update public.catalog_tee_si set revision=revision+1'),'42501');await role(db);
    });
    await t.test('remove override explicitly uses configuration; restoration creates only a draft and preserves versions',async()=>{
      d=(await call(db,tee,'open')).draft;d=(await call(db,tee,'save',d,{mode:'managed',holes:d.snapshot.holes.map(h=>({...h,si:null}))})).draft;
      p=await call(db,tee,'preview',d);assert.equal(p.can_publish,true);await call(db,tee,'publish',d,null,p.confirmation_hash,'Remove TEST override');
      const before=await dump(db);d=(await call(db,tee,'restore',null,null,null,null,version)).draft;
      assert.equal(d.base_version_id,version);assert.deepEqual((await dump(db)).catalog_tee_si,before.catalog_tee_si);
      p=await call(db,tee,'preview',d);assert.equal(p.can_publish,true);await call(db,tee,'archive',d);
      assert.equal((await call(db,tee,'detail')).draft,null);assert.equal((await call(db,tee,'detail')).history.length,2);
    });
    await t.test('course 9 uses exact verified SI scale; unchanged hole draft does not block, real SI edit does',async()=>{
      const r=await call(db,courseTee,'open');let cd=r.draft;
      cd=(await call(db,courseTee,'save',cd,change(cd,r.context))).draft;
      const grid=(await rpc(db,'admin_course_hole_grid_open_draft',[courseTee.route_id])).draft;
      assert.equal((await call(db,courseTee,'preview',cd)).can_publish,true);
      const edited={holes:grid.snapshot.holes.map((h,i,rows)=>({...h,stroke_index:i===0?rows[1].stroke_index:i===1?rows[0].stroke_index:h.stroke_index}))};
      await rpc(db,'admin_course_hole_grid_save_draft',[grid.draft_id,edited,grid.revision]);
      assert.ok((await call(db,courseTee,'preview',cd)).blockers.some(b=>b.includes('sovrapposte')));
      await call(db,courseTee,'archive',cd);
    });
    await t.test('9×2 occurrences use exact source IDs and verified base/base+1; scopes never cross',async()=>{
      const f=await repeatedNine(db);
      const a=await call(db,f.tees[0],'open'),b=await call(db,f.tees[1],'open');
      assert.deepEqual(a.context.allowed_si,[1,3,5,7,9,11,13,15,17]);assert.deepEqual(b.context.allowed_si,Array.from({length:18},(_,i)=>i+1));
      assert.equal(b.context.holes[0].live_hole_id,b.context.holes[9].live_hole_id);assert.equal(b.context.holes[9].occurrence,2);
      let cd=(await call(db,f.tees[1],'save',b.draft,change(b.draft,b.context))).draft;
      const cp=await call(db,f.tees[1],'preview',cd);assert.equal(cp.can_publish,true);
      await call(db,f.tees[1],'publish',cd,null,cp.confirmation_hash,'18 only TEST');assert.equal((await call(db,f.tees[0],'detail')).context.current,null);
    });
    await t.test('unverified links block without guessing; changed tee baseline blocks without rebase',async()=>{
      const old=(await owner(db,"select * from public.route_tees where tee_name='Storico'")).rows[0];
      assert.ok((await call(db,old,'detail')).context.blockers.length>0);await fail(()=>call(db,old,'open'),'23514');
      d=(await call(db,tee,'open')).draft;d=(await call(db,tee,'save',d,change(d,ctx))).draft;
      await owner(db,'update public.combination_tees set slope_rating=slope_rating+1 where id=$1',[tee.id]);
      assert.equal((await call(db,tee,'preview',d)).can_publish,false);await call(db,tee,'archive',d);
    });
    await t.test('Fiuggi 18 and independent first/second nines read their OWN verified source SI, never parent/offset ranks',async()=>{
      const f=await physicalEighteen(db);
      for(const tee of f.tees){const a=await call(db,tee,'open');
        assert.equal(a.context.blockers.length,0);assert.equal(a.context.holes.length,tee.holes_count);
        const edited=(await call(db,tee,'save',a.draft,change(a.draft,a.context))).draft;
        assert.equal((await call(db,tee,'preview',edited)).can_publish,true);await call(db,tee,'archive',edited);
      }
      assert.deepEqual((await call(db,f.tees[1],'detail')).context.allowed_si,[1,3,5,7,9,11,13,15,17]);
      assert.deepEqual((await call(db,f.tees[2],'detail')).context.allowed_si,[2,4,6,8,10,12,14,16,18]);
    });
    await t.test('audit/version failure rolls back projection and keeps draft open',async()=>{
      const a=await call(db,tee,'open');d=(await call(db,tee,'save',a.draft,change(a.draft,a.context))).draft;p=await call(db,tee,'preview',d);
      const before=await dump(db);await owner(db,`create function public.test_si_fail() returns trigger language plpgsql as $$begin raise exception 'TEST audit failure';end$$`);
      await owner(db,'create trigger test_si_fail before insert on public.admin_catalog_versions for each row execute function public.test_si_fail()');
      await fail(()=>call(db,tee,'publish',d,null,p.confirmation_hash,'TEST rollback'),'P0001');
      assert.deepEqual(await dump(db),before);await owner(db,'drop trigger test_si_fail on public.admin_catalog_versions');await owner(db,'drop function public.test_si_fail()');
      await owner(db,`create function public.test_si_fail() returns trigger language plpgsql as $$begin if new.workflow_status='published' then raise exception 'TEST late close failure';end if;return new;end$$`);
      await owner(db,'create trigger test_si_fail before update on public.admin_catalog_drafts for each row execute function public.test_si_fail()');
      await fail(()=>call(db,tee,'publish',d,null,p.confirmation_hash,'TEST late rollback'),'P0001');
      assert.deepEqual(await dump(db),before);await owner(db,'drop trigger test_si_fail on public.admin_catalog_drafts');await owner(db,'drop function public.test_si_fail()');
    });
    assert.ok(combination.id);
  }finally{await db.close();}
});
