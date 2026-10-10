// Real RSA/JWKS verification + isolated/mocked network. Never calls GitHub or Supabase.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { brokerPolicy,githubVerifier,ISSUER,JWKS_URL,WORKFLOW_REF } from '../../supabase/functions/tee-evidence-broker/oidc.mjs';
import { createBroker,proposalId } from '../../supabase/functions/tee-evidence-broker/handler.mjs';
import { extractFigEvidence,sha256 } from '../evidence/fig-tee-evidence.mjs';
import { runBroker,safeResult } from '../evidence/fig-tee-broker-client.mjs';
const jose=await import(process.env.STABLR_JOSE_MODULE || 'jose');
const {jwtVerify,generateKeyPair,exportJWK,SignJWT,createLocalJWKSet,createRemoteJWKSet,customFetch}=jose;
const operator='11111111-1111-4111-8111-111111111111', revision='a'.repeat(40);
const env={EVIDENCE_OIDC_AUDIENCE:'stablr:tee-evidence:test',EVIDENCE_GITHUB_REPOSITORY_ID:'123',EVIDENCE_GITHUB_OWNER_ID:'456',
  EVIDENCE_GITHUB_ADMIN_MAP:JSON.stringify({'789':operator}),EVIDENCE_GITHUB_WORKFLOW_SHAS:JSON.stringify([revision])};
const policy=brokerPolicy(env), clock=new Date('2026-10-10T10:00:00Z'), seconds=clock.getTime()/1000;
const {privateKey,publicKey}=await generateKeyPair('RS256');
const key={...await exportJWK(publicKey),kid:'fixture-key',alg:'RS256',use:'sig'};
const claims={iss:ISSUER,aud:policy.audience,sub:'repo:giuseppepalazzo/stablr:ref:refs/heads/main',iat:seconds,nbf:seconds,exp:seconds+300,jti:'fixture-jti',
  repository:'giuseppepalazzo/stablr',repository_owner:'giuseppepalazzo',repository_id:'123',repository_owner_id:'456',ref:'refs/heads/main',ref_type:'branch',
  event_name:'workflow_dispatch',workflow_ref:WORKFLOW_REF,workflow_sha:revision,sha:revision,runner_environment:'github-hosted',run_attempt:'1',run_id:'100',actor_id:'789'};
const sign=(p=claims,h={alg:'RS256',kid:'fixture-key',typ:'JWT'},k=privateKey)=>new SignJWT(p).setProtectedHeader(h).sign(k);
const verify=githubVerifier({jwtVerify,keys:createLocalJWKSet({keys:[key]}),policy,now:()=>clock});
const raw=JSON.stringify({schema_version:'1.0',source_system:'fig',source_url:'https://areariservata.federgolf.it/SlopeAndCourseRating/Index',tables:[{table_index:0,rows:[
  {row_index:0,cells:['','TEE']},{row_index:1,cells:['','GIALLO']},{row_index:2,cells:['Circolo','Percorso','PAR','CR','Slope']},
  {row_index:3,cells:['PRIVATE_RAW_LABEL','9 Buche','35','34,8','120']},{row_index:4,cells:['malformed']}
]}]});
const body={operation:'preview',raw,raw_sha256:sha256(Buffer.from(raw))};
const request=(token,value=body,headers={})=>new Request('https://fixture.supabase.co/functions/v1/tee-evidence-broker',{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},body:JSON.stringify(value)
});
test('OIDC real RSA/JWKS signature and exact authorized policy',async()=>{
  const identity=await verify(await sign());assert.equal(identity.operatorId,operator);assert.equal(identity.context.actor_id,'789');
  assert.equal(identity.context.run_id,'100');assert.ok(!JSON.stringify(identity.context).includes('fixture-jti'));
  const immutable={...claims,sub:'repo:giuseppepalazzo@456/stablr@123:ref:refs/heads/main'};await verify(await sign(immutable));
  let fetchCount=0;
  const remote=createRemoteJWKSet(new URL(JWKS_URL),{[customFetch]:async(url)=>{assert.equal(String(url),JWKS_URL);fetchCount++;
    return new Response(JSON.stringify({keys:[key]}),{headers:{'Content-Type':'application/json'}});}});
  const fromJwks=githubVerifier({jwtVerify,keys:remote,policy,now:()=>clock});await fromJwks(await sign());assert.equal(fetchCount,1);
});
const invalid={iss:'https://attacker.invalid',aud:'wrong',sub:'repo:fork/stablr:ref:refs/heads/main',exp:seconds-60,iat:seconds+60,nbf:seconds+60,
  jti:'',repository:'fork/stablr',repository_owner:'fork',repository_id:'999',repository_owner_id:'999',ref:'refs/pull/1/merge',ref_type:'tag',
  event_name:'pull_request',workflow_ref:WORKFLOW_REF.replace('tee-evidence-batch','attacker'),workflow_sha:'b'.repeat(40),sha:'b'.repeat(40),
  runner_environment:'self-hosted',run_attempt:'2',run_id:'',actor_id:'999'};
for (const [field,value] of Object.entries(invalid)) test(`OIDC rejects invalid ${field}`,async()=>assert.rejects(()=>sign({...claims,[field]:value}).then(verify)));
for (const field of Object.keys(claims)) test(`OIDC rejects missing ${field}`,async()=>{const p={...claims};delete p[field];await assert.rejects(()=>sign(p).then(verify));});
test('OIDC rejects unsigned/tampered/wrong algorithm or key/header, PR target, environment and reusable context',async()=>{
  const token=await sign();await assert.rejects(()=>verify(token.slice(0,-4)+'AAAA'));
  await assert.rejects(()=>verify(token.split('.').slice(0,2).join('.')+'.'));
  const other=await generateKeyPair('RS256');await assert.rejects(()=>sign(claims,{alg:'RS256',kid:'fixture-key',typ:'JWT'},other.privateKey).then(verify));
  for(const h of [{alg:'RS256',kid:'unknown',typ:'JWT'},{alg:'RS256',kid:'fixture-key',typ:'other'},{alg:'RS256',typ:'JWT'}])await assert.rejects(()=>sign(claims,h).then(verify));
  const hs=new SignJWT(claims).setProtectedHeader({alg:'HS256',kid:'fixture-key',typ:'JWT'});await assert.rejects(()=>hs.sign(new Uint8Array(32)).then(verify));
  for(const changes of [{aud:[policy.audience]},{exp:seconds+601},{head_ref:'feature'},{base_ref:'main'},{event_name:'pull_request_target'},
    {environment:'production'},{job_workflow_ref:'other'},{job_workflow_sha:revision},{actor_id:789},{run_attempt:1}])await assert.rejects(()=>sign({...claims,...changes}).then(verify));
});
test('configuration absent, empty or malformed fails closed',()=>{
  for(const [field,value] of Object.entries({...env,EVIDENCE_OIDC_AUDIENCE:'',EVIDENCE_GITHUB_REPOSITORY_ID:'0',EVIDENCE_GITHUB_OWNER_ID:'',
    EVIDENCE_GITHUB_ADMIN_MAP:'{}',EVIDENCE_GITHUB_WORKFLOW_SHAS:'[]'}))assert.throws(()=>brokerPolicy({...env,[field]:value}));
  assert.throws(()=>brokerPolicy({...env,EVIDENCE_GITHUB_ADMIN_MAP:JSON.stringify({'789':'not-uuid'})}));
  assert.throws(()=>brokerPolicy({...env,EVIDENCE_GITHUB_ADMIN_MAP:'PRIVATE_SECRET malformed'}),e=>!e.message.includes('PRIVATE_SECRET'));
});
function fixtureService() {
  const objects=new Map(),preparations=new Map(),runs=new Map(),receipts=new Map(),calls=[];let writes=0,uploads=0;
  const error=code=>({data:null,error:{code,message:'PRIVATE_SECRET full manifest raw source_payload'}});
  const client={storage:{from:name=>{assert.equal(name,'admin-catalog-evidence');return {
    download:async path=>objects.has(path)?{data:new Blob([objects.get(path)]),error:null}:{error:{statusCode:404,message:'not found'}},
    upload:async(path,bytes,options)=>{assert.equal(options.upsert,false);uploads++;objects.set(path,bytes);return {error:null};}
  };}},rpc:async(name,a)=>{
    calls.push(name);if(a.p_operator_id!==operator)return error('42501');
    if(name==='admin_catalog_tee_broker_prepared') {
      const p=preparations.get(a.p_proposal_id);return p?{data:{approval_sha256:sha256(Buffer.from(p.text)),actor_id:p.context.actor_id,workflow_sha:p.context.workflow_sha}}:error('42501');
    }
    const context=a.p_context,run=context.run_id;
    const fingerprint=name.endsWith('confirm')?JSON.stringify([a.p_proposal_id,a.p_approved_sha256,a.p_note]):a.p_preparation_text;
    if(runs.has(run)&&runs.get(run)!==fingerprint)return error('40001');
    if(name==='admin_catalog_tee_broker_preflight')return {data:{authorized:true}};
    if(name==='admin_catalog_tee_broker_stage') {
      const p=JSON.parse(a.p_preparation_text),m=p.manifest;
      const result={proposal_id:p.batch_id,approval_sha256:sha256(Buffer.from(a.p_preparation_text)),extractor_version:m.extractor_version,
        counts:{total:2,complete:0,incomplete:1,excluded:1},reasons:[{reason:'invalid_row_shape',count:1},{reason:'incomplete_source_evidence',count:1}]};
      if(!preparations.has(p.batch_id)){writes++;preparations.set(p.batch_id,{text:a.p_preparation_text,context,result});}runs.set(run,fingerprint);return {data:result};
    }
    if(name==='admin_catalog_tee_broker_confirm') {
      const p=preparations.get(a.p_proposal_id);if(!p||sha256(Buffer.from(p.text))!==a.p_approved_sha256)return error('40001');
      if(receipts.has(a.p_proposal_id)&&receipts.get(a.p_proposal_id).note!==a.p_note)return error('40001');
      if(!receipts.has(a.p_proposal_id)){writes++;receipts.set(a.p_proposal_id,{note:a.p_note,result:{batch_id:'33333333-3333-4333-8333-333333333333',total:2,inserted:1,existing:0,incomplete:1,excluded:1}});}
      runs.set(run,fingerprint);return {data:receipts.get(a.p_proposal_id).result};
    }
    throw new Error('Generic RPC denied');
  }};
  return {client,calls,stats:()=>({writes,uploads,receipts:receipts.size})};
}
test('browser/anon/player and every bad OIDC claim are rejected BEFORE service construction or Storage',async()=>{
  let constructions=0;const broker=createBroker({verify,policy,serviceFactory:()=>{constructions++;throw new Error('Forbidden');}});
  for(const token of ['','browser.admin.jwt','anon','service_role',await sign({...claims,actor_id:'999'})])assert.equal((await broker(request(token))).status,403);
  for(const [field,value] of Object.entries(invalid))assert.equal((await broker(request(await sign({...claims,[field]:value})))).status,403);
  assert.equal((await broker(request(await sign(),body,{Origin:'https://admin.example'}))).status,403);assert.equal(constructions,0);
});
test('fixed operations and fields, raw hash, bounds and manipulated operator rejected before privilege',async()=>{
  let constructions=0;const broker=createBroker({verify,policy,serviceFactory:()=>{constructions++;throw new Error('Forbidden');}}),token=await sign();
  for(const bad of [{...body,raw_sha256:'0'.repeat(64)},{...body,operator_id:operator},{...body,path:'other'},
    {operation:'sql',command:'select'},{operation:'confirm',proposal_id:operator,approval_sha256:'0'.repeat(64),note:'',operator_id:operator},
    {operation:'confirm',proposal_id:[operator],approval_sha256:'0'.repeat(64),note:'Approval'},
    {...body,raw:'x'.repeat(1024*1024+1)},null])assert.equal((await broker(request(token,bad))).status,400);
  assert.equal(constructions,0);
});
test('token expiry while receiving body is rechecked before any privileged client',async()=>{
  let checks=0,constructions=0;
  const broker=createBroker({policy,verify:async()=>{if(++checks===2)throw new Error('Expired');return await verify(await sign());},
    serviceFactory:()=>{constructions++;throw new Error('Forbidden');}});
  assert.equal((await broker(request(await sign()))).status,403);assert.equal(constructions,0);
});
test('broker stages exact immutable preparation; confirms from SERVER; retries same receipt; no sensitive responses/logs',async()=>{
  const fixture=fixtureService(),broker=createBroker({verify,policy,serviceFactory:()=>fixture.client});
  const token=await sign(),preview=await(await broker(request(token))).json();assert.equal(preview.proposal_id,proposalId((await verify(token)).context,body.raw_sha256));
  assert.deepEqual(await(await broker(request(token))).json(),preview);assert.equal(fixture.stats().writes,1);assert.equal(fixture.stats().uploads,1);
  const confirmBody={operation:'confirm',proposal_id:preview.proposal_id,approval_sha256:preview.approval_sha256,note:'Explicit fixture approval'};
  const ct=await sign({...claims,run_id:'101',jti:'confirm-jti'});
  const receipt=await(await broker(request(ct,confirmBody))).json();assert.equal(receipt.inserted,1);
  assert.deepEqual(await(await broker(request(ct,confirmBody))).json(),receipt);assert.equal(fixture.stats().receipts,1);
  assert.deepEqual(await(await broker(request(await sign({...claims,run_id:'102',jti:'new-jti'}),confirmBody))).json(),receipt);
  assert.equal((await broker(request(ct,{...confirmBody,approval_sha256:'0'.repeat(64)}))).status,409);
  assert.equal((await broker(request(ct,{...confirmBody,note:'Changed decision'}))).status,409);
  assert.equal((await broker(request(token,{...body,raw:raw+' ',raw_sha256:sha256(Buffer.from(raw+' '))}))).status,409);
  for(const name of fixture.calls)assert.match(name,/^admin_catalog_tee_broker_(preflight|stage|prepared|confirm)$/);
  for(const output of [preview,receipt])for(const forbidden of ['PRIVATE_RAW_LABEL','PRIVATE_SECRET','preparation_text','source_payload','object_path','signed_url',operator,raw,token])assert.ok(!JSON.stringify(output).includes(forbidden));
  const handler=await readFile(new URL('../../supabase/functions/tee-evidence-broker/handler.mjs',import.meta.url),'utf8');assert.ok(!/console\.|process\.stdout/.test(handler));
});
test('service errors never leak backend details; suspended Admin never uploads; revoked preview revision blocks confirm',async()=>{
  const fixture=fixtureService(),token=await sign();
  const denied=createBroker({verify,policy,serviceFactory:()=>({...fixture.client,rpc:async()=>({error:{code:'42501',message:raw+' PRIVATE_SECRET'}})})});
  const response=await denied(request(token));assert.equal(response.status,403);assert.ok(!(await response.text()).includes('PRIVATE'));assert.equal(fixture.stats().uploads,0);
  const leaking=createBroker({verify,policy,serviceFactory:()=>({...fixture.client,rpc:async(name,a)=>{
    const result=await fixture.client.rpc(name,a);
    return name.endsWith('stage')?{data:{...result.data,raw,object_path:'PRIVATE_SECRET'}}:result;
  }})});
  const leakResponse=await leaking(request(token));assert.equal(leakResponse.status,409);assert.equal(await leakResponse.text(),'{"error":"Batch rejected"}');
  const broker=createBroker({verify,policy,serviceFactory:()=>fixture.client}),p=await(await broker(request(token))).json();
  const revoked=createBroker({verify,policy:{...policy,revisions:[]},serviceFactory:()=>fixture.client});
  assert.equal((await revoked(request(await sign({...claims,run_id:'103',jti:'jti-103'}),{operation:'confirm',proposal_id:p.proposal_id,approval_sha256:p.approval_sha256,note:'Approval'}))).status,409);
});
test('runner uses fixed checkout path, OIDC only, narrow output, identical retries, no raw during confirm',async()=>{
  const settings={GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',EVIDENCE_OPERATION:'preview',
    EVIDENCE_BROKER_URL:'https://fixture.supabase.co/functions/v1/tee-evidence-broker',EVIDENCE_OIDC_AUDIENCE:policy.audience,
    ACTIONS_ID_TOKEN_REQUEST_URL:'https://run.actions.githubusercontent.com/idtoken',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'ephemeral-fixture'};
  const result={proposal_id:operator,approval_sha256:'c'.repeat(64),extractor_version:'fig-raw-tee-evidence/1.0.0',counts:{total:2,complete:0,incomplete:1,excluded:1},reasons:[]};
  const calls=[];let attempts=0;
  const fetcher=async(url,options)=>{calls.push({url:String(url),options});if(String(url).includes('/idtoken'))return Response.json({value:'signed.fixture.jwt'});
    attempts++;return attempts===1?new Response(null,{status:503}):Response.json(result);};
  const read=async path=>{assert.equal(path,'data/fig/raw/fig-slope-course-rating-raw.json');return Buffer.from(raw);};
  assert.deepEqual(await runBroker(settings,{fetcher,read,wait:async()=>{}}),result);assert.equal(calls[1].options.body,calls[2].options.body);
  assert.equal(calls[1].options.headers.Authorization,'Bearer signed.fixture.jwt');assert.match(calls[0].url,/audience=stablr/);
  assert.throws(()=>safeResult({...result,raw,service_key:'PRIVATE_SECRET'},'preview'));assert.throws(()=>safeResult({...result,reasons:[{reason:'PRIVATE_SECRET',count:1}]},'preview'));
  const receipt={batch_id:operator,total:2,inserted:1,existing:0,incomplete:1,excluded:1};
  const ct={...settings,EVIDENCE_OPERATION:'confirm',EVIDENCE_PROPOSAL_ID:operator,EVIDENCE_APPROVAL_SHA256:'c'.repeat(64),EVIDENCE_NOTE:'Approved'};
  await runBroker(ct,{read:async()=>{throw new Error('Confirm must not read raw');},fetcher:async(url,options)=>{
    if(String(url).includes('/idtoken'))return Response.json({value:'signed.fixture.jwt'});
    assert.ok(!options.body.includes(raw));return Response.json(receipt);
  }});
  for(const changes of [{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_REF:'refs/heads/other'},{EVIDENCE_BROKER_URL:'https://attacker.invalid'},
    {EVIDENCE_OPERATION:'shell'},{EVIDENCE_PROPOSAL_ID:operator}])await assert.rejects(()=>runBroker({...settings,...changes},{fetcher,read}));
});
test('workflow/auth boundary static audit and real raw extraction (local read only)',async()=>{
  const workflow=await readFile(new URL('../../.github/workflows/tee-evidence-batch.yml',import.meta.url),'utf8');
  assert.match(workflow,/workflow_dispatch:/);assert.match(workflow,/id-token: write/);assert.match(workflow,/persist-credentials: false/);
  assert.ok(!/secrets\.|upload-artifact|pull_request:|push:|schedule:|npm install|npm ci/.test(workflow.replace(/^\s*#.*$/gm,'')));
  assert.equal((workflow.match(/uses:/g)||[]).length,2);assert.equal((workflow.match(/uses: .*@[a-f0-9]{40}/g)||[]).length,2);
  const config=await readFile(new URL('../../supabase/config.toml',import.meta.url),'utf8');assert.match(config,/\[functions\.tee-evidence-broker\]\s+verify_jwt = false/);
  const index=await readFile(new URL('../../supabase/functions/tee-evidence-broker/index.ts',import.meta.url),'utf8');assert.match(index,/npm:jose@6\.1\.0/);assert.match(index,/new URL\(JWKS_URL\)/);
  const client=await readFile(new URL('../evidence/fig-tee-broker-client.mjs',import.meta.url),'utf8');assert.ok(!/SERVICE_ROLE|ADMIN_ACCESS_TOKEN|supabase-js|console\.log/.test(client));
  const rawBytes=await readFile(new URL('../../data/fig/raw/fig-slope-course-rating-raw.json',import.meta.url));
  const start=performance.now(),m=extractFigEvidence(rawBytes);assert.ok(m.items.length>0);assert.ok(rawBytes.length<1024*1024);
  // Local timing is diagnostic, not an attestation of deployed Edge CPU limits.
  assert.ok(performance.now()-start<10000);
});
test('runner lost-response retry is identical and CLI failure logs contain no supplied token/raw/secrets',async()=>{
  const settings={GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',EVIDENCE_OPERATION:'confirm',
    EVIDENCE_BROKER_URL:'https://fixture.supabase.co/functions/v1/tee-evidence-broker',EVIDENCE_OIDC_AUDIENCE:policy.audience,
    ACTIONS_ID_TOKEN_REQUEST_URL:'https://run.actions.githubusercontent.com/idtoken',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'PRIVATE_TOKEN',
    EVIDENCE_PROPOSAL_ID:operator,EVIDENCE_APPROVAL_SHA256:'c'.repeat(64),EVIDENCE_NOTE:'PRIVATE_RAW_LABEL'};
  const bodies=[];const receipt={batch_id:operator,total:2,inserted:1,existing:0,incomplete:1,excluded:1};
  await runBroker(settings,{wait:async()=>{},fetcher:async(url,options)=>{
    if(String(url).includes('/idtoken'))return Response.json({value:'signed.fixture.jwt'});
    bodies.push(options.body);if(bodies.length===1)throw new Error('PRIVATE_SECRET lost response');return Response.json(receipt);
  }});assert.equal(bodies[0],bodies[1]);
  const script=new URL('../evidence/fig-tee-broker-client.mjs',import.meta.url);
  const child=spawnSync(process.execPath,[script.pathname],{env:{...settings,GITHUB_RUN_ATTEMPT:'2'},encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.stdout,'');
  for(const secret of ['PRIVATE_TOKEN','PRIVATE_RAW_LABEL','PRIVATE_SECRET',operator])assert.ok(!child.stderr.includes(secret));
});
