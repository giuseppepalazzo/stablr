import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setupSi,repeatedNine,physicalEighteen,owner,role,rpc,sql,admin,other,player,dump} from './helpers/tee-si-fixture.mjs';
const {PGlite}=await import(process.env.STABLR_PGLITE_MODULE||'@electric-sql/pglite');
const call=(db,tee,action,d=null,snapshot=null,hash=null,note=null,version=null)=>rpc(db,'admin_tee_distances',[
  tee.route_id?'route_tee':'combination_tee',tee.id,action,d?.draft_id??null,d?.revision??null,snapshot,hash,note,version]);
const fail=(fn,code)=>assert.rejects(fn,e=>e.code===code);
const values=(d,fill=i=>300+i)=>({mode:'managed',holes:d.snapshot.holes.map((h,i)=>({...h,distance_m:fill(i)}))});
test('tee distances: exact identities, metres/null/zero, isolated atomic workflow and every physical model',async t=>{
  const db=new PGlite();
  try{
    const {tee,courseTee}=await setupSi(db);const initial=await dump(db);
    await db.exec('reset role');await db.exec(await sql('admin-tee-distances'));await role(db);
    let d,p,version;
    await t.test('additive, no backfill/live changes; detail and preview do not write',async()=>{
      const after=await dump(db);assert.deepEqual(after,{...initial,catalog_tee_distances:[]});
      await db.exec('begin read only');const detail=await call(db,tee,'detail');await db.exec('commit');assert.equal(detail.draft,null);
      assert.equal(detail.context.holes.length,18);assert.equal(detail.context.current,null);
      assert.ok(!/standard_si|source_payload|TEST_NOT_EXPOSED/.test(JSON.stringify(detail)));assert.deepEqual(await dump(db),after);
    });
    await t.test('anon/player/service/no UID/JWT-role mismatch and foreign drafts refused; no API DML/private helper access',async()=>{
      d=(await call(db,tee,'open')).draft;
      for(const [name,uid] of [['anon',''],['authenticated',player],['authenticated',''],['service_role',admin]]){
        await role(db,name,uid);for(const action of ['detail','open','save','preview','publish','archive','restore'])await fail(()=>call(db,tee,action,d),'42501');
        await fail(()=>db.query('insert into public.catalog_tee_distances default values'),'42501');
      }
      await role(db);await db.query("select set_config('request.jwt.claim.role','service_role',false)");await fail(()=>call(db,tee,'detail'),'42501');await role(db);
      await role(db,'authenticated',other);for(const action of ['save','preview','publish','archive'])await fail(()=>call(db,tee,action,d),'42501');await role(db);
      for(const helper of ['admin_tee_distance_context'])await fail(()=>rpc(db,helper,['combination_tee',tee.id]),'42501');
      for(const table of ['catalog_tee_distances','admin_catalog_drafts','admin_catalog_versions'])assert.equal((await owner(db,`select has_table_privilege('authenticated','public.${table}','INSERT,UPDATE,DELETE') v`)).rows[0].v,false);
    });
    await t.test('personal resume, snapshot allowlist, immutable exact slots, numeric limits and optimistic revisions',async()=>{
      assert.equal((await call(db,tee,'open')).draft.draft_id,d.draft_id);
      for(const f of [{...values(d),total_m:42},{...values(d),par:4},{mode:'managed',holes:[]},
        {mode:'managed',holes:d.snapshot.holes.map(h=>({...h,si:1}))},{...values(d),mode:null}])await fail(()=>call(db,tee,'save',d,f),'22023');
      for(const number of [-1,1.25,2147483648])await fail(()=>call(db,tee,'save',d,values(d,()=>number)),'23514');
      const duplicate=values(d);duplicate.holes[1].slot_id=duplicate.holes[0].slot_id;await fail(()=>call(db,tee,'save',d,duplicate),'23514');
      const before=await dump(db);d=(await call(db,tee,'save',d,values(d,i=>i===0?0:i===1?null:300))).draft;
      assert.deepEqual((await dump(db)).combination_tees,before.combination_tees);await fail(()=>call(db,tee,'save',{...d,revision:1},d.snapshot),'40001');
    });
    await t.test('server-only totals distinguish zero and missing; preview read-only, signed confirmation and note required',async()=>{
      const before=await dump(db);await db.exec('begin read only');p=await call(db,tee,'preview',d);await db.exec('commit');assert.deepEqual(await dump(db),before);
      assert.equal(p.can_publish,true);assert.equal(p.totals_after.total_m,null);assert.equal(p.totals_after.known_count,17);assert.equal(p.totals_after.known_sum_m,4800);
      assert.equal(p.totals_after.front_m,null);assert.equal(p.totals_after.back_m,2700);assert.equal(p.changes[0].after,0);assert.equal(p.changes[1].after,null);
      assert.equal(p.warnings.length,2);await fail(()=>call(db,tee,'publish',d,null,'wrong','TEST'),'22023');await fail(()=>call(db,tee,'publish',d,null,p.confirmation_hash,''),'22023');
    });
    await t.test('atomic version/projection/closure only; Par, SI, ratings, foundation, classifications, rounds and sources untouched',async()=>{
      const before=await dump(db),result=await call(db,tee,'publish',d,null,p.confirmation_hash,'Explicit TEST metres');version=result.version_id;
      const after=await dump(db);for(const table of Object.keys(before).filter(k=>!['catalog_tee_distances','admin_catalog_drafts','admin_catalog_versions'].includes(k)))assert.deepEqual(after[table],before[table],table);
      assert.equal((await call(db,tee,'detail')).draft,null);assert.equal(result.contract.holes[0].distance_m,0);assert.equal(result.contract.holes[1].distance_m,null);
      assert.ok(!/fingerprint|revision|source_payload|published_by|standard_si/.test(JSON.stringify(result.contract)));
      await role(db,'authenticated',player);assert.equal((await db.query('select contract from public.catalog_tee_distances')).rows.length,1);
      await fail(()=>db.query('update public.catalog_tee_distances set revision=revision+1'),'42501');await role(db);
      await fail(()=>owner(db,'update public.admin_catalog_versions set snapshot=\'{}\' where version_id=$1',[version]),'55000');
    });
    await t.test('restore creates a new draft only; late closure error rolls back both projection and immutable version',async()=>{
      const before=await dump(db);d=(await call(db,tee,'restore',null,null,null,null,version)).draft;
      assert.equal(d.base_version_id,version);assert.deepEqual((await dump(db)).catalog_tee_distances,before.catalog_tee_distances);
      d=(await call(db,tee,'save',d,values(d,()=>0))).draft;p=await call(db,tee,'preview',d);
      assert.equal(p.totals_after.total_m,0);assert.equal(p.totals_after.known_count,18);
      const ready=await dump(db);await owner(db,`create function public.fail_distance_close() returns trigger language plpgsql as $$begin if new.workflow_status='published' then raise exception 'TEST late failure';end if;return new;end$$`);
      await owner(db,'create trigger fail_distance_close before update on public.admin_catalog_drafts for each row execute function public.fail_distance_close()');
      await fail(()=>call(db,tee,'publish',d,null,p.confirmation_hash,'TEST rollback'),'P0001');assert.deepEqual(await dump(db),ready);
      await owner(db,'drop trigger fail_distance_close on public.admin_catalog_drafts');await owner(db,'drop function public.fail_distance_close()');
      await call(db,tee,'archive',d);assert.equal((await call(db,tee,'detail')).draft,null);assert.equal((await call(db,tee,'detail')).history.length,1);
    });
    await t.test('Mare-shaped 9×2: exact same source IDs, separate occurrences and tee scopes; no implicit repetition',async()=>{
      const f=await repeatedNine(db),a=await call(db,f.tees[1],'open');
      assert.equal(a.context.holes[0].live_hole_id,a.context.holes[9].live_hole_id);assert.equal(a.context.holes[9].occurrence,2);
      const saved=(await call(db,f.tees[1],'save',a.draft,values(a.draft,i=>i<9?100:200))).draft;
      const preview=await call(db,f.tees[1],'preview',saved);assert.equal(preview.totals_after.total_m,2700);assert.equal(preview.totals_after.front_m,900);assert.equal(preview.totals_after.back_m,1800);
      await call(db,f.tees[1],'publish',saved,null,preview.confirmation_hash,'Explicit TEST two occurrences');assert.equal((await call(db,f.tees[0],'detail')).context.current,null);
    });
    await t.test('Fiuggi-shaped 18, first and second nine: distinct verified slot sources preserved',async()=>{
      const f=await physicalEighteen(db);for(const tee of f.tees){const a=await call(db,tee,'open');assert.equal(a.context.blockers.length,0);
        const saved=(await call(db,tee,'save',a.draft,values(a.draft))).draft;const preview=await call(db,tee,'preview',saved);
        assert.equal(preview.can_publish,true);assert.equal(preview.totals_after.known_count,tee.holes_count);await call(db,tee,'archive',saved);}
    });
    await t.test('multi9 course tee and combination tee independent; SI-only differences do not become distance conflicts',async()=>{
      // Existing fixture uses exact captured Parco multi9 slots; no name matching.
      await owner(db,'update public.route_holes set stroke_index=case physical_hole_number when 1 then 2 when 2 then 1 else stroke_index end where route_id=$1',[courseTee.route_id]);
      const a=await call(db,courseTee,'open');assert.equal(a.context.blockers.length,0);
      const saved=(await call(db,courseTee,'save',a.draft,values(a.draft))).draft;assert.equal((await call(db,courseTee,'preview',saved)).can_publish,true);await call(db,courseTee,'archive',saved);
      assert.equal((await call(db,tee,'detail')).context.current.tee_id,tee.id);
    });
    await t.test('changed tee baseline and absent verified links block without automatic rebase/matching',async()=>{
      const a=await call(db,tee,'open');d=(await call(db,tee,'save',a.draft,values(a.draft))).draft;
      await owner(db,'update public.combination_tees set slope_rating=slope_rating+1 where id=$1',[tee.id]);
      p=await call(db,tee,'preview',d);assert.equal(p.can_publish,false);const before=await dump(db);
      await fail(()=>call(db,tee,'publish',d,null,p.confirmation_hash,'TEST stale'),'40001');assert.deepEqual(await dump(db),before);await call(db,tee,'archive',d);
      const old=(await owner(db,"select * from public.route_tees where tee_name='Storico'")).rows[0];assert.ok((await call(db,old,'detail')).context.blockers.length>0);await fail(()=>call(db,old,'open'),'23514');
    });
    await t.test('existing SI workflow still publishes under new guard; distance base and projection never change from SI publication',async()=>{
      const before=await call(db,tee,'detail'),projection=(await dump(db)).catalog_tee_distances;
      const a=await rpc(db,'admin_tee_si',['combination_tee',tee.id,'open']);
      const fields={mode:'managed',holes:a.draft.snapshot.holes.map(h=>({...h,si:null}))};
      const saved=(await rpc(db,'admin_tee_si',['combination_tee',tee.id,'save',a.draft.draft_id,a.draft.revision,fields])).draft;
      const p=await rpc(db,'admin_tee_si',['combination_tee',tee.id,'preview',saved.draft_id,saved.revision]);
      assert.equal(p.can_publish,true);await rpc(db,'admin_tee_si',['combination_tee',tee.id,'publish',saved.draft_id,saved.revision,null,p.confirmation_hash,'TEST separate SI publication']);
      assert.deepEqual((await call(db,tee,'detail')).context.base,before.context.base);assert.deepEqual((await dump(db)).catalog_tee_distances,projection);
    });
    await t.test('changed parent/source payload invalidates a prepared confirmation without any partial publication',async()=>{
      const a=await call(db,tee,'open');d=(await call(db,tee,'save',a.draft,values(a.draft))).draft;p=await call(db,tee,'preview',d);
      await owner(db,"update public.route_combinations set source_payload=coalesce(source_payload,'{}')||'{\"test_source_revision\":2}' where id=$1",[tee.route_combination_id]);
      const before=await dump(db);await fail(()=>call(db,tee,'publish',d,null,p.confirmation_hash,'TEST stale source'),'40001');
      assert.deepEqual(await dump(db),before);assert.equal((await call(db,tee,'detail')).draft.draft_id,d.draft_id);
    });
  }finally{await db.close();}
});
