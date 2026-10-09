import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractFigEvidence, evidenceCounts, EXTRACTOR_VERSION, sha256, verifyFigManifest } from '../evidence/fig-tee-evidence.mjs';
import { confirmFigBatch, prepareFigBatch, stageFigBatch, verifyPreparation } from '../evidence/fig-tee-batch.mjs';

export const figFixture = () => Buffer.from(JSON.stringify({ schema_version: '1.0', source_system: 'fig',
  source_url: 'https://areariservata.federgolf.it/SlopeAndCourseRating/Index', scraped_at: '2026-05-16T10:04:11Z',
  tables: [{ table_index: 0, rows: [
    { row_index: 0, cells: ['', 'TEE UOMINI', 'TEE DONNE'] },
    { row_index: 1, cells: ['', 'GIALLO', 'ARANCIO'] },
    { row_index: 2, cells: ['Circolo', 'Percorso', 'PAR', 'CR', 'Slope', 'CR', 'Slope'] },
    { row_index: 3, cells: ['Club fixture', '18 Buche', '72', '71,2', '130', '73,4', '135'] },
    { row_index: 4, cells: ['Club fixture', 'Percorso fixture', '35', '34,1', '110', '', ''] },
    { row_index: 5, cells: ['Malformed fixture'] }
  ] }] }));

test('FIG v1 keeps common Par, explicit scope, original values and no synthetic/native/live identities', () => {
  const bytes = figFixture(), manifest = extractFigEvidence(bytes);
  assert.equal(manifest.extractor_version, EXTRACTOR_VERSION);
  assert.equal(manifest.artifact.sha256, sha256(bytes));
  assert.deepEqual(evidenceCounts(manifest), { total: 4, complete: 0, incomplete: 3, excluded: 1 });
  const e = manifest.items[0].evidence;
  assert.equal(e.par_original, '72'); assert.equal(e.par_normalized, 72); assert.equal(e.par_state, 'esplicito');
  assert.equal(e.par_origin, 'comune_configurazione'); assert.equal(e.scope_normalized, 18);
  assert.equal(e.external_tee_id, null); assert.equal(e.external_configuration_id, null); assert.equal(e.synthetic_tee_id, null);
  assert.equal(e.applicability_state, 'assente'); assert.equal(manifest.items[1].evidence.applicability_normalized, null);
  assert.equal(manifest.items[2].evidence.scope_normalized, null); // Never infer 9 from Par 35.
  assert.equal(manifest.items[3].reason, 'invalid_row_shape');
  assert.deepEqual(verifyFigManifest(bytes, manifest), manifest);
});
test('same extraction is deterministic; changed bytes change hash; same Par/name never links observations', () => {
  const bytes=figFixture(), a=extractFigEvidence(bytes), b=extractFigEvidence(bytes);
  assert.deepEqual(a,b); assert.notEqual(a.items[0].observation_id,a.items[1].observation_id);
  assert.notEqual(extractFigEvidence(Buffer.from(bytes.toString()+' ')).artifact.sha256,a.artifact.sha256);
  const changed=structuredClone(a);changed.items[0].evidence.par_origin='dichiarato';
  assert.throws(()=>verifyFigManifest(bytes,changed),/trusted/);
});
test('unsupported headers remain an explicit exclusion, invalid locators/formats fail before any remote action', () => {
  const raw=JSON.parse(figFixture());raw.tables[0].rows[2].cells=['Unsupported'];
  assert.equal(extractFigEvidence(Buffer.from(JSON.stringify(raw))).items[0].reason,'unsupported_header_layout');
  const duplicate=JSON.parse(figFixture());duplicate.tables[0].rows.push(duplicate.tables[0].rows[3]);
  assert.throws(()=>extractFigEvidence(Buffer.from(JSON.stringify(duplicate))),/duplicate row/i);
  assert.throws(()=>extractFigEvidence(Buffer.from('{}')),/Unsupported/);
  const bad=JSON.parse(figFixture());bad.source_url='https://other.invalid/';
  assert.throws(()=>extractFigEvidence(Buffer.from(JSON.stringify(bad))),/URL/);
});
test('invalid explicit Par is preserved as an original source value, never labeled inferred or replaced by fallback',()=>{
  const raw=JSON.parse(figFixture());raw.tables[0].rows[3].cells[2]='n/d';
  const e=extractFigEvidence(Buffer.from(JSON.stringify(raw))).items[0].evidence;
  assert.equal(e.par_original,'n/d');assert.equal(e.par_normalized,null);assert.equal(e.par_state,'esplicito');
  assert.equal(e.par_origin,'comune_configurazione');assert.ok(e.limitations.includes('par_not_numeric'));
  raw.tables[0].rows[3].cells[2]=' ';
  const absent=extractFigEvidence(Buffer.from(JSON.stringify(raw))).items[0].evidence;
  assert.equal(absent.par_state,'assente');assert.equal(absent.par_original,null);assert.equal(absent.par_origin,null);
});
test('protected process authorizes Admin before privilege/upload; client manifest edits are rejected', async () => {
  const bytes=figFixture(), manifestBytes=Buffer.from(JSON.stringify(prepareFigBatch(bytes)));
  const base={bytes,manifestBytes,approvedHash:sha256(manifestBytes),note:'Explicit test approval',env:{SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'anon-fixture',SUPABASE_SERVICE_ROLE_KEY:'private-fixture',STABLR_ADMIN_ACCESS_TOKEN:'admin-fixture'}};
  const calls=[];
  const denied=(...args)=>{calls.push(args[1]);return {auth:{getUser:async()=>({data:{user:{id:'admin'}}})},rpc:async()=>({error:{code:'42501'}})};};
  await assert.rejects(()=>confirmFigBatch({...base,clientFactory:denied}),/42501/);
  assert.deepEqual(calls,['anon-fixture']);
  await assert.rejects(()=>confirmFigBatch({...base,approvedHash:'0'.repeat(64),clientFactory:denied}),/reviewed/);
  const edited=JSON.parse(manifestBytes);edited.manifest.items[0].evidence.applicability_normalized='men';
  const modified=Buffer.from(JSON.stringify(edited));
  await assert.rejects(()=>confirmFigBatch({...base,manifestBytes:modified,approvedHash:sha256(modified),clientFactory:denied}),/trusted/);
});
test('server verifies upload bytes and staged hash; BOTH mutations use only the private server credential', async () => {
  const bytes=figFixture(), prepared=prepareFigBatch(bytes), manifestBytes=Buffer.from(JSON.stringify(prepared)), calls=[];
  let uploaded=false;
  const factory=(url,key)=> key==='server' ? {storage:{from:(bucket)=>{assert.equal(bucket,'admin-catalog-evidence');return {
    download:async()=>uploaded?{data:new Blob([bytes])}:{error:{statusCode:404,message:'Object not found'}},
    upload:async(path,data,opts)=>{calls.push('upload');assert.equal(opts.upsert,false);assert.equal(sha256(data),sha256(bytes));uploaded=true;return {};}
  };}},rpc:async(name,args)=>{calls.push(name);if(name.endsWith('stage')){assert.equal(args.p_preparation_text,manifestBytes.toString());return {data:{proposal_id:prepared.batch_id,artifact_id:'artifact',approval_sha256:sha256(manifestBytes)}};}
    assert.equal(name,'admin_catalog_tee_evidence_confirm');assert.equal(args.p_proposal_id,prepared.batch_id);assert.equal(args.p_approved_sha256,sha256(manifestBytes));assert.equal(args.p_operator_id,'admin');return {data:{batch_id:'receipt'}};}}
  : {auth:{getUser:async()=>({data:{user:{id:'admin'}}})},rpc:async(name)=>{calls.push(name);assert.equal(name,'admin_catalog_tee_evidence_preview');return {data:{admin_id:'admin'}};}};
  const result=await confirmFigBatch({bytes,manifestBytes,approvedHash:sha256(manifestBytes),note:'Approved fixture',env:{SUPABASE_URL:'fixture',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'server',STABLR_ADMIN_ACCESS_TOKEN:'token'},clientFactory:factory});
  assert.equal(result.batch_id,'receipt');assert.deepEqual(calls,['admin_catalog_tee_evidence_preview','upload','admin_catalog_tee_evidence_stage','admin_catalog_tee_evidence_confirm']);
});
test('batch identity belongs to approval hash; new batch is a new manifest even with identical evidence',()=>{
  const bytes=figFixture(),a=prepareFigBatch(bytes),b=prepareFigBatch(bytes);
  assert.notEqual(a.batch_id,b.batch_id);assert.deepEqual(a.manifest,b.manifest);
  assert.notEqual(sha256(JSON.stringify(a)),sha256(JSON.stringify(b)));
  assert.deepEqual(verifyPreparation(bytes,Buffer.from(JSON.stringify(a))),a);
  assert.throws(()=>verifyPreparation(bytes,Buffer.from(JSON.stringify({...a,extra:'secret'}))),/identity/);
});
test('stage does not approve; mismatched SERVER-side manifest hash or raw bytes cannot reach confirm',async()=>{
  const bytes=figFixture(),prepared=prepareFigBatch(bytes),manifestBytes=Buffer.from(JSON.stringify(prepared)),calls=[];
  const env={SUPABASE_URL:'fixture',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'server',STABLR_ADMIN_ACCESS_TOKEN:'token'};
  const factory=(url,key)=>key==='server'?{storage:{from:()=>({download:async()=>({data:new Blob([bytes])})})},rpc:async(name)=>{calls.push(name);return {data:{proposal_id:prepared.batch_id,artifact_id:'artifact',approval_sha256:'0'.repeat(64)}};}}
    :{auth:{getUser:async()=>({data:{user:{id:'admin'}}})},rpc:async()=>({data:{admin_id:'admin'}})};
  await assert.rejects(()=>confirmFigBatch({bytes,manifestBytes,approvedHash:sha256(manifestBytes),note:'Approved fixture',env,clientFactory:factory}),/Server manifest hash/);
  assert.deepEqual(calls,['admin_catalog_tee_evidence_stage']);
  calls.length=0;
  const stageFactory=(url,key)=>key==='server'?{storage:{from:()=>({download:async()=>({data:new Blob([bytes])})})},rpc:async(name)=>{calls.push(name);return {data:{proposal_id:prepared.batch_id,artifact_id:'artifact',approval_sha256:sha256(manifestBytes)}};}}
    :{auth:{getUser:async()=>({data:{user:{id:'admin'}}})},rpc:async()=>({data:{admin_id:'admin'}})};
  await stageFigBatch({bytes,manifestBytes,env,clientFactory:stageFactory});assert.deepEqual(calls,['admin_catalog_tee_evidence_stage']);
  const corrupt=(url,key)=>key==='server'?{storage:{from:()=>({download:async()=>({data:new Blob(['different bytes'])})})},rpc:async()=>{throw new Error('Must not mutate');}}:stageFactory(url,key);
  await assert.rejects(()=>confirmFigBatch({bytes,manifestBytes,approvedHash:sha256(manifestBytes),note:'Approved',env,clientFactory:corrupt}),/hash mismatch/);
});
