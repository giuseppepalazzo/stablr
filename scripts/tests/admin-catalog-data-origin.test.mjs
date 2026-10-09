// Phase 4 runs only against isolated PostgreSQL/WASM. No network connection.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || '@electric-sql/pglite');
const read = (f) => readFile(new URL('../../supabase/' + f, import.meta.url), 'utf8');
const schema = await read('shared-catalog-schema.sql'), extension = await read('fig-whs-extension.sql');
const migration = await read('admin-catalog-data-origin.sql');
const migrations = await Promise.all(['admin-catalog-workflow.sql', 'admin-club-editor.sql', 'admin-course-editor.sql',
  'admin-catalog-abandon-draft.sql', 'admin-route-editor.sql', 'admin-hole-grid-editor.sql', 'admin-course-hole-grid-editor.sql',
  'admin-course-tee-editor.sql',
  'admin-catalog-physical-foundation.sql', 'admin-catalog-physical-course-links.sql', 'admin-catalog-playable-configurations.sql',
  'admin-catalog-physical-18-configurations.sql', 'admin-catalog-structure-club-lock.sql', 'admin-catalog-multi9.sql',
  'admin-catalog-multi9-club-proposals.sql', 'admin-catalog-multi9-preview-repair.sql'].map(read));
const source = await readFile(new URL('../../src/admin/data-origin.js', import.meta.url), 'utf8');
const { analyseOrigin, validateOriginGraph } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const parco = JSON.parse(await readFile(new URL('./fixtures/parco-de-medici-multi9-preview.json', import.meta.url), 'utf8'));
const matrixSource = JSON.parse(await readFile(new URL('../../data/gesgolf/imports/campodoglio-normalized.json', import.meta.url), 'utf8')).routes[0].source_payload.tee_specific_hole_matrix;
const admin = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', player = '33333333-3333-4333-8333-333333333333';
const mareSI = [11,17,1,7,9,5,3,13,15], marePar = [4,4,4,4,4,4,3,4,4];
const fiuggiSI = [9,17,15,3,13,1,5,11,7,12,2,18,4,8,6,16,14,10];
const fiuggiPar = [5,4,3,4,3,4,4,5,3,5,3,4,3,4,5,3,4,4];

test('Phase 4 origin/impact: actual foundation contracts and live row shapes', async (t) => {
  const db = new PGlite();
  const role = async (name = 'authenticated', uid = admin, claim = name) => {
    await db.exec('reset role;set role ' + name);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [uid,claim]);
  };
  const rpc = async (name, args = []) => (await db.query('select to_jsonb(public.' + name + '(' + args.map((_,i) => '$' + (i+1)).join(',') + ')) result', args)).rows[0].result;
  const graph = async (club) => validateOriginGraph(await rpc('admin_catalog_data_origin',[club.id]),club.id);
  const insert = async (table, rows) => {
    await db.exec('reset role');
    for (const row of rows) {
      const keys = Object.keys(row);
      await db.query('insert into public.' + table + '(' + keys.join(',') + ') values(' + keys.map((_,i)=>'$'+(i+1)).join(',') + ')',keys.map(k=>row[k]));
    }
    await role();
  };
  const createClub = async (name) => {
    await db.exec('reset role');
    const c = (await db.query('insert into public.clubs(name,name_normalized,created_by) values($1,$1,$2) returning *',[name,admin])).rows[0];
    await role();return c;
  };
  const createCourse = async (club, name, pars, si, payload = null) => {
    await db.exec('reset role');
    const c = (await db.query("insert into public.course_routes(club_id,name,holes_count,total_par,source_system,source_payload) values($1,$2,$3,$4,'gesgolf',$5) returning *",[club.id,name,pars.length,pars.reduce((n,p)=>n+p,0),payload])).rows[0];
    for(let i=0;i<pars.length;i++) await db.query('insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) values($1,$2,$3,$4)',[c.id,i+1,pars[i],si[i]]);
    await db.query("insert into public.route_tees(route_id,tee_name,tee_color,gender,holes_count,course_rating,slope_rating) values($1,'Giallo','yellow',null,null,34.8,125)",[c.id]);
    await role();return c;
  };
  const physical = async (club, c, classification) => {
    let s = await rpc('admin_catalog_foundation_create_structure',[club.id,club.name,'fig','Fixture explicit source','Fixture manual creation']);
    s = await rpc('admin_catalog_foundation_review_structure',[s.id,s.revision,classification,'fig','Fixture explicit source','Fixture manual classification',true]);
    let p = await rpc('admin_catalog_physical_course_preview',[s.id,c.id]);
    p = await rpc('admin_catalog_physical_course_register',[s.id,c.id,s.revision,p.source,'Fixture confirmed source',true]);
    p = await rpc('admin_catalog_physical_course_verify',[p.link.id,p.link.revision,p.mapping,'Fixture verified mapping',true]);
    return {s,p};
  };
  const register9 = async (f, kind) => {
    let c = await rpc('admin_catalog_playable_preview',[f.s.id,f.p.link.id,kind]);
    c = await rpc('admin_catalog_playable_register',[f.s.id,f.p.link.id,kind,c.baseline,'Fixture manual configuration',true]);
    return rpc('admin_catalog_playable_verify',[c.configuration.id,c.configuration.revision,c.baseline,c.saved_holes,'Fixture manual verification',true]);
  };
  const dump = async () => {
    await db.exec('reset role');
    const names = (await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
    const out = {};
    for (const {tablename} of names) out[tablename] = (await db.query('select to_jsonb(t) j from public.'+tablename+' t order by to_jsonb(t)::text')).rows;
    await role();return out;
  };
  try {
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key references auth.users,role text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;grant usage on schema auth to anon,authenticated,service_role;create function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;");
    await db.query('insert into auth.users values($1),($2),($3)',[admin,other,player]);
    await db.query("insert into public.profiles values($1,'admin'),($2,'admin'),($3,'user')",[admin,other,player]);
    for(const name of ['clubs','course_routes','route_holes','route_combinations','route_combination_holes','rounds','round_holes']) await db.exec(schema.match(new RegExp('create table public\\.'+name+' \\([\\s\\S]*?\\n\\);'))[0]);
    for(const name of ['route_tees','combination_tees']) await db.exec(extension.match(new RegExp('create table if not exists public\\.'+name+' \\([\\s\\S]*?\\n\\);'))[0]);
    for(const name of ['clubs','course_routes','route_combinations']) await db.exec('alter table public.'+name+' add column source_system text,add column source_external_id text,add column source_payload jsonb');
    for(const sql of migrations) await db.exec(sql);
    await role();
    const mare = await createClub('Mare di Roma'), mc = await createCourse(mare,'Percorso',marePar,mareSI);
    const mf = await physical(mare,mc,'fisico_9');await register9(mf,'autonomous_9');await register9(mf,'repeated_18');
    const fiuggi = await createClub('Fiuggi 1928'), fc = await createCourse(fiuggi,'18 Buche',fiuggiPar,fiuggiSI);
    await createCourse(fiuggi,'Prime Nove',fiuggiPar.slice(0,9),fiuggiSI.slice(0,9));
    await createCourse(fiuggi,'Seconde Nove',fiuggiPar.slice(9),fiuggiSI.slice(9));
    const ff = await physical(fiuggi,fc,'fisico_18');
    let cfg = await rpc('admin_catalog_physical18_preview',[ff.s.id,ff.p.link.id,'autonomous_18',fc.id,'inherited']);
    cfg = await rpc('admin_catalog_physical18_register',[ff.s.id,ff.p.link.id,'autonomous_18',fc.id,'inherited',cfg.baseline,'Fixture explicit 18',true]);
    await rpc('admin_catalog_physical18_verify',[cfg.configuration.id,cfg.configuration.revision,cfg.baseline,cfg.saved_holes,'Fixture verified 18',true]);
    await insert('clubs',[{...parco.club,created_by:admin}]);await insert('course_routes',parco.routes);
    await insert('route_holes',parco.holes);await insert('route_combinations',parco.combinations);await insert('route_combination_holes',parco.slots);
    const proposal = await rpc('admin_catalog_multi9_club_preview',[parco.club.id]);
    const batch = await rpc('admin_catalog_multi9_batch_register',[[proposal],'Fixture explicit pilot approval',true]);
    assert.equal(batch.registered.length,1);
    const courseDraft = await rpc('admin_course_open_draft',[mc.id]);
    await rpc('admin_course_hole_grid_open_draft',[mc.id]);
    let mg;
    await t.test('one-shot migration changes no rows, tables, policies, triggers, editor definitions or permissions', async () => {
      const before = await dump();await db.exec('reset role');
      const catalogs = async () => (await db.query("select 'policy' kind,to_jsonb(p)::text item from pg_policies p union all select 'trigger',pg_get_triggerdef(oid) from pg_trigger where not tgisinternal union all select 'function',pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname <> 'admin_catalog_data_origin' order by kind,item")).rows;
      const old = await catalogs();await db.exec(migration);
      assert.deepEqual(await catalogs(),old);assert.deepEqual(await dump(),before);
      await db.exec('reset role');await assert.rejects(()=>db.exec(migration),e=>e.code==='42723');await db.exec('rollback');await role();
      assert.deepEqual(await dump(),before);
    });
    await t.test('Admin-only: denies anon, player, service API, absent identity and forged role claims', async () => {
      for(const a of [['anon',''],['authenticated',player],['service_role',admin],['service_role',admin,'authenticated'],['authenticated',''],['authenticated',admin,'service_role']]) {
        await role(...a);await assert.rejects(()=>graph(mare),e=>e.code==='42501');
      }
      await role();await assert.rejects(()=>rpc('admin_catalog_data_origin',['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']),e=>e.code==='22023');
      await db.exec('reset role');const p=(await db.query("select prosecdef,provolatile,proconfig from pg_proc where oid='public.admin_catalog_data_origin(uuid)'::regprocedure")).rows[0];
      assert.equal(p.prosecdef,true);assert.equal(p.provolatile,'s');assert.deepEqual(p.proconfig,['search_path=pg_catalog']);await role();
    });
    await t.test('Admin reads work in an enforced read-only transaction and leave every table unchanged', async () => {
      const before=await dump();await db.exec('begin read only');
      mg=await graph(mare);await graph(fiuggi);await graph(parco.club);await db.exec('commit');
      assert.deepEqual(await dump(),before);assert.equal(mg.read_only,true);
      assert.equal(mg.drafts.length,2);assert.ok(mg.drafts.every(d=>d.is_owner));
      await role('authenticated',other);assert.ok((await graph(mare)).drafts.every(d=>!d.is_owner));await role();
      assert.ok(mg.courses.every(c=>c.club_id===mare.id));assert.equal(mg.combinations.length,0);
      assert.ok(mg.physical_holes.every(h=>h.club_id===mare.id));assert.ok(mg.drafts.every(d=>d.live_entity_id===mc.id));
    });
    await t.test('Mare: 9 + repeated 18, inherited Par 35/70 and own SI base/base+1; null tee scope uses exact parent', async () => {
      const a=analyseOrigin(mg);assert.equal(a.configurations.length,2);assert.equal(a.uncovered_live.length,0);assert.equal(a.coverage_complete,true);
      assert.ok(a.configurations.every(c=>c.issues.length===0&&c.linkage_verified&&c.cardinality_complete));
      const c=a.configurations.find(c=>c.holes_count===18);assert.equal(c.total_par,70);
      assert.deepEqual(c.slots.map(h=>h.stroke_index),[...mareSI,...mareSI.map(n=>Math.min(18,n+1))]);
      const hole=analyseOrigin(mg,{type:'physical_hole',id:mg.physical_holes[0].id});
      assert.equal(hole.configurations.length,2);assert.equal(hole.configurations.flatMap(c=>c.slots.filter(s=>s.physical_hole_id===hole.selected.record.id)).length,3);
      const tee=analyseOrigin(mg,{type:'route_tee',id:mg.route_tees[0].id});assert.equal(tee.selected.effective_holes_count,9);assert.equal(tee.configurations.length,1);
      assert.ok(a.drafts.every(d=>d.base_status==='checked_fields'&&!d.has_changes));assert.equal(a.publication,'not_assessed');
    });
    await t.test('Fiuggi: complete 18 does not certify persisted Prime/Seconde Nove or infer links from equal Par', async () => {
      const a=analyseOrigin(await graph(fiuggi));assert.equal(a.configurations.length,1);assert.equal(a.configurations[0].total_par,70);
      assert.equal(a.uncovered_live.length,2);assert.ok(a.uncovered_live.every(r=>r.cardinality_complete));assert.equal(a.coverage_complete,false);
      assert.ok(a.issues.includes('incomplete_coverage'));assert.deepEqual(a.configurations[0].slots.map(h=>h.stroke_index),fiuggiSI);
    });
    await t.test('Parco real live fixture: distinct local identities, exact references, seven configurations and two components per 18', async () => {
      const pg=await graph(parco.club),a=analyseOrigin(pg);assert.equal(pg.physical_holes.length,27);assert.equal(a.configurations.length,7);
      assert.equal(pg.configuration_holes.length,99);assert.ok(a.configurations.every(c=>c.linkage_verified&&c.cardinality_complete&&c.issues.length===0));
      assert.equal(a.uncovered_live.length,3,'the actual three repeated-18 live routes have no verified links: do not invent coverage');
      for(const c of a.configurations.filter(c=>c.holes_count===18)) {assert.equal(c.components.length,2);assert.ok(c.components.every(p=>p.valid));assert.deepEqual(c.slots.map(s=>s.stroke_index),pg.combination_holes.filter(h=>h.route_combination_id===c.legacy_combination_id).sort((a,b)=>a.round_hole_number-b.round_hole_number).map(h=>h.stroke_index));}
      const firsts=pg.physical_holes.filter(h=>h.physical_number===1);assert.equal(firsts.length,3);assert.equal(new Set(firsts.map(h=>h.source_course_link_id)).size,3);
      const aHole=analyseOrigin(pg,{type:'physical_hole',id:firsts[0].id});assert.ok(aHole.selected.exact_live_references.every(r=>r.registered));
      assert.ok(aHole.configurations.every(c=>c.slots.some(s=>s.physical_hole_id===firsts[0].id)));
    });
    await t.test('live divergence and pertinent stale drafts are diagnosed without writing or blocking existing editors', async () => {
      await db.exec('reset role');await db.query('update public.route_holes set par=5 where route_id=$1 and physical_hole_number=1',[mc.id]);await role();
      const changed=await graph(mare),before=await dump(),a=analyseOrigin(changed);
      assert.ok(a.issues.includes('source_changed'));assert.ok(a.issues.includes('source_snapshot_changed'));
      assert.ok(a.issues.includes('stale_draft'));assert.equal(a.drafts.find(d=>d.entity_type==='route_holes_grid').base_status,'changed');
      assert.equal(a.drafts.find(d=>d.draft_id===courseDraft.draft.draft_id).base_status,'checked_fields');
      assert.equal(a.publication,'not_assessed');await graph(mare);assert.deepEqual(await dump(),before);
    });
    await t.test('explicit response allowlists reject future columns, arbitrary nested secrets, free text, URLs and foreign payloads', async () => {
      const marker='PRIVATE_FIXTURE_ONLY@example.invalid',matrix=structuredClone(matrixSource);
      matrix.note=marker;matrix.source_links=['https://example.invalid/?token='+marker];
      matrix.tees.bianco.label=marker;matrix.tees.bianco.holes[0].email=marker;
      matrix.tees.bianco.holes[0].par={email:marker};matrix.tees.bianco.holes[0].stroke_indexes[1]={token:marker};
      matrix.tees[marker]={holes:[{par:4,email:marker}]};
      await db.exec('reset role');await db.query('alter table public.course_routes add column private_future_column text');
      await db.query('update public.course_routes set private_future_column=$1',[marker]);await role();
      const privacy=await createClub('Privacy fixture');
      const pc=await createCourse(privacy,'Percorso fixture',marePar,mareSI,{secret:marker,foreign_club:{id:fiuggi.id,token:marker},tee_specific_hole_matrix:matrix});
      await db.exec('reset role');await db.query('update public.route_tees set source_payload=$1 where route_id=$2',[{email:marker,nested:{password:marker},distances:[400,500]},pc.id]);await role();
      const pf=await physical(privacy,pc,'fisico_9');await register9(pf,'autonomous_9');
      await rpc('admin_course_open_draft',[pc.id]);await rpc('admin_course_hole_grid_open_draft',[pc.id]);
      await db.exec('reset role');const ph=(await db.query('select id from public.route_holes where route_id=$1 order by physical_hole_number',[pc.id])).rows[0];await role();
      await rpc('admin_catalog_create_draft',['hole',{private_snapshot:{email:marker,club:fiuggi.id}},ph.id]);
      const before=await dump();await db.exec('begin read only');const g=await graph(privacy);await db.exec('commit');
      assert.deepEqual(await dump(),before);
      const json=JSON.stringify(g);assert.ok(!json.includes(marker));assert.ok(!json.includes(fiuggi.id));assert.ok(!json.includes(admin));assert.ok(!json.includes(other));
      const keys={
        club:'id name',
        structures:'id club_id label classification review_status revision created_at updated_at',
        physical_holes:'id club_id structure_id physical_number base_par review_status revision source_system source_course_link_id source_route_hole_id source_position created_at updated_at',
        physical_links:'id club_id structure_id course_id holes_count review_status revision created_at updated_at source_state',
        configurations:'id club_id structure_id label holes_count relationship_kind parent_configuration_id parent_configuration_revision derivation_rule legacy_course_route_id legacy_combination_id registration_kind review_status revision created_at updated_at source_state tee_state',
        configuration_holes:'id club_id structure_id configuration_id physical_hole_id position occurrence par_mode par_override stroke_index review_status revision legacy_route_hole_id legacy_combination_hole_id created_at updated_at',
        components:'id club_id configuration_id component_position parent_configuration_id parent_configuration_revision physical_course_link_id physical_course_link_revision review_status revision created_at updated_at',
        tee_overrides:'id configuration_id configuration_hole_id route_tee_id combination_tee_id par_override stroke_index_override review_status revision source_system created_at updated_at',
        courses:'id club_id name holes_count total_par is_active source_system created_at updated_at tee_matrix',
        course_holes:'id route_id physical_hole_number par stroke_index',
        combinations:'id club_id name holes_count total_par front_route_id back_route_id is_active source_system created_at updated_at',
        combination_holes:'id route_combination_id round_hole_number route_id route_position physical_hole_number par stroke_index',
        route_tees:'id route_id tee_name tee_color gender holes_count par_total course_rating slope_rating is_active source_system created_at updated_at payload_present',
        combination_tees:'id route_combination_id tee_name tee_color gender holes_count par_total course_rating slope_rating is_active source_system created_at updated_at payload_present',
        drafts:'draft_id entity_type live_entity_id workflow_status revision created_at updated_at is_owner author has_changes base_status'
      };
      assert.deepEqual(Object.keys(g).sort(),['contract_version','read_only','read_at','publication',...Object.keys(keys)].sort());
      for(const response of [g,mg,await graph(parco.club)]) for(const [key,allowed] of Object.entries(keys)) {
        for(const row of key==='club'?[response.club]:response[key]) assert.deepEqual(Object.keys(row).sort(),allowed.split(' ').sort(),key);
      }
      const output=g.courses[0].tee_matrix;
      assert.equal(output.present,true);assert.equal(output.source,'official_club_site');assert.equal(output.physical_hole_count,9);assert.equal(output.has_unrecognized_entries,true);
      const first=output.tees.find(t=>t.source_key==='bianco').holes[0];assert.deepEqual(first,{physical_hole_number:1,par:null,stroke_indexes:[4,null]});
      assert.ok(output.tees.every(t=>Object.keys(t).sort().join(',')==='holes,source_key'));
      assert.ok(output.tees.every(t=>t.holes.every(h=>Object.keys(h).sort().join(',')==='par,physical_hole_number,stroke_indexes')));
      assert.ok(g.route_tees[0].payload_present);assert.equal(g.route_tees[0].gender,null);
      const legacy=g.drafts.find(d=>d.entity_type==='hole');assert.equal(legacy.has_changes,true);assert.equal(legacy.base_status,'unknown');
      assert.ok(g.drafts.filter(d=>d.entity_type!=='hole').every(d=>!d.has_changes&&d.base_status==='checked_fields'));
      assert.ok(g.configurations.every(c=>c.source_state==='matched'));
    });
    await t.test('malformed matrix shapes and values are never echoed; presence still means unverified coverage', async () => {
      await db.exec('reset role');await db.query('update public.course_routes set source_payload=$1 where id=$2',[{tee_specific_hole_matrix:{source:{email:'PRIVATE'},physical_hole_count:{token:'PRIVATE'},tees:['PRIVATE']}},mc.id]);await role();
      const g=await graph(mare),m=g.courses[0].tee_matrix;
      assert.equal(m.present,true);assert.equal(m.source,null);assert.equal(m.physical_hole_count,null);assert.equal(m.has_unrecognized_entries,true);assert.deepEqual(m.tees,[]);
      assert.ok(!JSON.stringify(g).includes('PRIVATE'));assert.equal(analyseOrigin(g).coverage_complete,false);
      assert.ok(analyseOrigin(g).issues.includes('matrix_association_unverified'));
    });
    await t.test('draft differences and base revision summaries stay meaningful without snapshots or publication history in the response', async () => {
      const saved=await rpc('admin_course_save_draft',[courseDraft.draft.draft_id,{...courseDraft.draft.snapshot,name:'Explicit fixture rename'},courseDraft.draft.revision]);
      let g=await graph(mare),d=g.drafts.find(d=>d.draft_id===saved.draft_id);
      assert.equal(d.has_changes,true);assert.equal(d.base_status,'checked_fields');assert.equal(d.workflow_status,'draft');
      await db.exec('reset role');await db.query('update public.course_routes set display_order=5 where id=$1',[mc.id]);await role();
      g=await graph(mare);d=g.drafts.find(d=>d.draft_id===saved.draft_id);assert.equal(d.base_status,'changed');
      assert.ok(!('snapshot' in d));assert.ok(!('base_snapshot' in d));assert.ok(!('versions' in g));
      await db.exec('reset role');const body=(await db.query("select pg_get_functiondef('public.admin_catalog_data_origin(uuid)'::regprocedure) body")).rows[0].body;
      assert.ok(!/\bto_jsonb\s*\(/i.test(body));assert.ok(!/\b(insert\s+into|update\s+public\.|delete\s+from|execute\s|for\s+(update|share))\b/i.test(body));await role();
    });
  } finally {await db.close();}
});
