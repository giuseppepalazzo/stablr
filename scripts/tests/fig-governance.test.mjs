import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { extract, fetchPhotograph, FIG_URL } from '../../supabase/functions/fig-governance/source.mjs';
import { handler } from '../../supabase/functions/fig-governance/handler.mjs';
import { policy, verifier, ISSUER, WORKFLOW } from '../../supabase/functions/fig-governance/oidc.mjs';
import { run } from '../fig/governance-client.mjs';
test('weekly job gate defaults closed before any steps; manual dispatch remains available',async()=>{
  const workflow=await readFile(new URL('../../.github/workflows/fig-governance.yml',import.meta.url),'utf8');
  assert.match(workflow,/workflow_dispatch:/);assert.match(workflow,/schedule:/);
  const condition=workflow.match(/^    if: (.+)$/m)?.[1];assert.ok(condition);
  assert.ok(workflow.indexOf('    if:')<workflow.indexOf('    steps:'));
  const evaluate=(event,gate,overrides={})=>{
    const github={repository:'giuseppepalazzo/stablr',ref:'refs/heads/main',event_name:event,run_attempt:1,...overrides};
    return Function('github','vars',`return (${condition})`)(github,{FIGCHECK_WEEKLY_ENABLED:gate});
  };
  for(const gate of [undefined,'','false','TRUE','1',true])assert.equal(evaluate('schedule',gate),false);
  assert.equal(evaluate('schedule','true'),true);
  for(const gate of [undefined,'false','true'])assert.equal(evaluate('workflow_dispatch',gate),true);
  for(const event of ['push','pull_request','pull_request_target'])assert.equal(evaluate(event,'true'),false);
  for(const event of ['schedule','workflow_dispatch'])for(const overrides of [{repository:'fork/stablr'},{ref:'refs/heads/other'},{run_attempt:2}])assert.equal(evaluate(event,'true',overrides),false);
});
const html = (par=35) => `<table><tr><th>Circolo</th><th>Percorso</th><th>PAR</th><th>CR</th><th>Slope</th></tr><tr>${['TEST CLUB','9 Buche',par,34.2,120,...Array(12).fill('')].map(v=>`<td>${v}</td>`).join('')}</tr></table>`;
test('public source photographs use observations, not name-derived FIG identity; no row-order removals',async()=>{
  const a=await extract(html()),b=await extract(html().replace('TEST CLUB','TEST  CLUB'));
  assert.deepEqual(a,b);assert.equal(a.records[0].source_id,null);assert.match(a.records[0].key,/^[a-f0-9]{64}:1$/);
  const duplicated=html().replace('</table>',html().match(/<tr><td>[\s\S]*?<\/tr>/)[0]+'</table>');
  assert.equal((await extract(duplicated)).records.length,2);
  assert.notEqual((await extract(html(34))).source_hash,a.source_hash);
  for(const body of ['<html>login</html>',html().replace('<td>35</td>','<td>unknown</td>'),html().replace('<td>120</td>','')])await assert.rejects(()=>extract(body));
  await assert.rejects(()=>fetchPhotograph(async url=>{assert.equal(url,FIG_URL);return new Response('unavailable',{status:503});}));
  const got=await fetchPhotograph(async(url,options)=>{assert.equal(url,FIG_URL);assert.equal(options.redirect,'error');return new Response(html(),{headers:{'content-type':'text/html'}});});assert.deepEqual(got,a);
});
const admin='11111111-1111-4111-8111-111111111111', revision='a'.repeat(40);
const env={FIGCHECK_OIDC_AUDIENCE:'stablr:fig-governance:test',FIGCHECK_REPOSITORY_ID:'1193622237',FIGCHECK_OWNER_ID:'28347789',
  FIGCHECK_GITHUB_ADMIN_MAP:JSON.stringify({'28347789':admin}),FIGCHECK_WORKFLOW_SHAS:JSON.stringify([revision]),FIGCHECK_ADMIN_ORIGINS:'["https://admin.example"]'};
const config=policy(env),seconds=Math.floor(Date.now()/1000);
const claims={iss:ISSUER,aud:config.audience,sub:'repo:giuseppepalazzo/stablr:ref:refs/heads/main',iat:seconds,nbf:seconds,exp:seconds+300,jti:'fixture',
 repository:'giuseppepalazzo/stablr',repository_owner:'giuseppepalazzo',repository_id:'1193622237',repository_owner_id:'28347789',
 ref:'refs/heads/main',ref_type:'branch',event_name:'schedule',workflow_ref:WORKFLOW,workflow_sha:revision,sha:revision,
 runner_environment:'github-hosted',run_attempt:'1',run_id:'100',actor_id:'28347789'};
test('strict independent weekly OIDC policy, every invalid claim rejected; existing evidence policy untouched',async()=>{
  let p=claims;const codes=[];
  const v=verifier({config,keys:'jwks',onReject:c=>codes.push(c),jwtVerify:async(token,keys,options)=>{
    assert.equal(keys,'jwks');assert.deepEqual(options.algorithms,['RS256']);assert.equal(options.issuer,ISSUER);assert.equal(options.audience,config.audience);
    if(p.iss!==ISSUER||p.exp<seconds||p.nbf>seconds||p.iat>seconds)throw new Error();return {payload:p,protectedHeader:{typ:'JWT',kid:'key'}};
  }});
  assert.equal((await v('a.b.c')).operator,admin);p={...claims,event_name:'workflow_dispatch'};await v('a.b.c');
  const invalid={iss:'attacker',aud:'other',sub:'fork',iat:seconds+60,nbf:seconds+60,exp:seconds-60,jti:'',
    repository:'fork/stablr',repository_owner:'fork',repository_id:'1',repository_owner_id:'2',ref:'refs/heads/other',ref_type:'tag',
    event_name:'pull_request',workflow_ref:'other',workflow_sha:'b'.repeat(40),sha:'b'.repeat(40),runner_environment:'self-hosted',run_attempt:'2',run_id:'',actor_id:'999'};
  for(const [key,value] of Object.entries(invalid)){p={...claims,[key]:value};await assert.rejects(()=>v('a.b.c'),undefined,key);}
  for(const key of Object.keys(claims)){p={...claims};delete p[key];await assert.rejects(()=>v('a.b.c'),undefined,`missing ${key}`);}
  for(const bad of [{job_workflow_ref:WORKFLOW},{job_workflow_sha:revision},{job_workflow_ref:'other',job_workflow_sha:revision},
    {job_workflow_ref:WORKFLOW,job_workflow_sha:'b'.repeat(40)},{head_ref:'branch'},{base_ref:'main'},{environment:'production'},{exp:seconds+700},{aud:[config.audience]}]){p={...claims,...bad};await assert.rejects(()=>v('a.b.c'));}
  p={...claims,job_workflow_ref:WORKFLOW,job_workflow_sha:revision};await v('a.b.c');
  assert.ok(codes.every(c=>c==='FIGCHECK_OIDC_REJECTED'));
  for(const key of Object.keys(env)){assert.throws(()=>policy({...env,[key]:''}),undefined,key);}
  const prior=await readFile(new URL('../../supabase/functions/tee-evidence-broker/oidc.mjs',import.meta.url),'utf8');assert.match(prior,/p.event_name !== 'workflow_dispatch'/);
});
test('real RSA/JWKS OIDC signatures; unsigned/tampered/wrong-key/claims rejected',async()=>{
  const {generateKeyPair,exportJWK,SignJWT,jwtVerify,createLocalJWKSet}=await import(process.env.STABLR_JOSE_MODULE||'jose');
  const {privateKey,publicKey}=await generateKeyPair('RS256');const key={...await exportJWK(publicKey),kid:'fixture-key',alg:'RS256',use:'sig'};
  const verify=verifier({jwtVerify,keys:createLocalJWKSet({keys:[key]}),config});
  const sign=(p=claims,k=privateKey,h={alg:'RS256',kid:'fixture-key',typ:'JWT'})=>new SignJWT(p).setProtectedHeader(h).sign(k);
  assert.equal((await verify(await sign())).operator,admin);
  await verify(await sign({...claims,event_name:'workflow_dispatch'}));
  const invalid={iss:'https://evil.example',aud:'other',sub:'fork',exp:seconds-60,nbf:seconds+60,iat:seconds+60,jti:'',repository:'fork/stablr',repository_owner:'fork',repository_id:'1',repository_owner_id:'2',ref:'refs/pull/1/merge',ref_type:'tag',event_name:'pull_request_target',workflow_ref:'other',workflow_sha:'b'.repeat(40),sha:'b'.repeat(40),runner_environment:'self-hosted',run_attempt:'2',run_id:'',actor_id:'9'};
  for(const [k,v] of Object.entries(invalid))await assert.rejects(()=>sign({...claims,[k]:v}).then(verify),undefined,k);
  for(const k of Object.keys(claims)){const p={...claims};delete p[k];await assert.rejects(()=>sign(p).then(verify),undefined,k);}
  const token=await sign();await assert.rejects(()=>verify(token.slice(0,-8)+'tampered'));await assert.rejects(()=>verify(token.split('.').slice(0,2).join('.')+'.'));
  const other=await generateKeyPair('RS256');await assert.rejects(()=>sign(claims,other.privateKey).then(verify));
  for(const h of [{alg:'RS256',kid:'unknown',typ:'JWT'},{alg:'RS256',kid:'fixture-key',typ:'other'},{alg:'RS256',typ:'JWT'}])await assert.rejects(()=>sign(claims,privateKey,h).then(verify));
  for(const changes of [{job_workflow_ref:WORKFLOW},{job_workflow_sha:revision},{job_workflow_ref:WORKFLOW,job_workflow_sha:'b'.repeat(40)},
    {head_ref:'feature'},{base_ref:'main'},{environment:'production'},{actor_id:28347789},{run_attempt:1},{aud:[config.audience]}])await assert.rejects(()=>sign({...claims,...changes}).then(verify));
});
test('broker verifies Admin/OIDC before service, failure preserves baseline, responses never expose raw/source/secrets',async()=>{
  const calls=[], snapshot=await extract(html()),id='44444444-4444-4444-8444-444444444444';let allowed=false,failSource=false,fetches=0,replay=false;
  const endpoint=handler({config,verifyGithub:async()=>{if(!allowed)throw new Error();return {operator:admin,channel:'weekly',key:'github:run'};},
    authenticateAdmin:async()=>{if(!allowed)throw new Error();return {operator:admin,channel:'manual'};},
    photograph:async()=>{fetches++;if(failSource)throw new Error('SECRET SOURCE_UNAVAILABLE');return snapshot;},
    serviceFactory:()=>{calls.push('service');return {rpc:async(name,args)=>{calls.push({name,args});return {data:name.endsWith('begin')?{id,status:'running',replay}:{id,status:args.p_failure?'failed':'success'},error:null};}};}});
  const req=(body={operation:'check',request_id:id},headers={})=>new Request('https://project/functions/v1/fig-governance',{method:'POST',headers:{Authorization:'Bearer a.b.c','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await endpoint(req())).status,403);assert.equal(calls.length,0);
  assert.equal((await endpoint(req({}, {Origin:'https://evil.example'}))).status,403);assert.equal(calls.length,0);allowed=true;
  let response=await endpoint(req());assert.deepEqual(await response.json(),{id,status:'success'});assert.equal(fetches,1);
  failSource=true;response=await endpoint(req());const text=await response.text();assert.equal(JSON.parse(text).status,'failed');assert.ok(!text.includes('TEST CLUB'));assert.ok(!text.includes('SECRET'));
  assert.equal(calls.at(-1).args.p_failure,'SOURCE_UNAVAILABLE');
  replay=true;await endpoint(req());assert.equal(fetches,2);
  assert.equal((await endpoint(req({operation:'confirm',request_id:id}))).status,400);
  assert.equal((await endpoint(req({operation:'check',request_id:id,operator:admin}))).status,400);
  assert.equal((await endpoint(req({operation:'check'},{'x-fig-channel':'github'}))).status,200);
  assert.equal((await endpoint(req({operation:'check'},{'x-fig-channel':'github',Origin:'https://admin.example'}))).status,403);
});
test('slow request: real signed OIDC expires after first verification; 403, zero privileged calls and zero writes',async()=>{
  const {generateKeyPair,exportJWK,SignJWT,jwtVerify,createLocalJWKSet}=await import(process.env.STABLR_JOSE_MODULE||'jose');
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const key={...await exportJWK(publicKey),kid:'slow-request-key',alg:'RS256',use:'sig'};
  const token=await new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:key.kid,typ:'JWT'}).sign(privateKey);
  let clock=seconds,verifications=0,factories=0,rpcs=0,fetches=0,controller,ready;
  const firstVerification=new Promise(resolve=>{ready=resolve;});const writes=[];
  const fullVerify=verifier({config,keys:createLocalJWKSet({keys:[key]}),jwtVerify:async(value,keys,options)=>{
    verifications++;return jwtVerify(value,keys,{...options,currentDate:new Date(clock*1000)});
  }});
  const endpoint=handler({config,verifyGithub:async value=>{const identity=await fullVerify(value);ready();return identity;},
    authenticateAdmin:async()=>{throw new Error('Wrong channel');},
    photograph:async()=>{fetches++;return extract(html());},serviceFactory:()=>{factories++;return {rpc:async(name,args)=>{
      rpcs++;writes.push({name,args});return {data:{id:admin,status:'running',replay:false},error:null};
    }};}});
  const body=new ReadableStream({start(c){controller=c;}});
  const pending=endpoint(new Request('https://fixture.invalid',{method:'POST',duplex:'half',body,headers:{
    Authorization:`Bearer ${token}`,'Content-Type':'application/json','x-fig-channel':'github'
  }}));
  await firstVerification;clock=claims.exp+60;
  controller.enqueue(new TextEncoder().encode(JSON.stringify({operation:'check'})));controller.close();
  const response=await pending;
  assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'Authorization rejected'});
  assert.equal(verifications,2);assert.equal(factories,0);assert.equal(rpcs,0);assert.equal(fetches,0);assert.deepEqual(writes,[]);
});
test('reauthorization protects EVERY mutation, including failure/cleanup; no writes after expiration',async()=>{
  const snapshot=await extract(html());
  for(const phase of ['factory','success_finish','failure_finish','cleanup']) {
    let expired=false,verifications=0,factories=0;const writes=[];
    const endpoint=handler({config,verifyGithub:async()=>{verifications++;if(expired)throw new Error('Expired');return {operator:admin,channel:'weekly',key:'github:run'};},
      authenticateAdmin:async()=>{throw new Error();},
      serviceFactory:()=>{factories++;if(phase==='factory')expired=true;return {rpc:async(name,args)=>{
        if(expired)assert.fail('Privileged RPC reached after expiration');
        if(name.endsWith('begin')) {writes.push(name);return {data:{id:admin,status:'running',replay:false},error:null};}
        if(phase==='cleanup') {expired=true;return {error:{code:'23514'}};}
        writes.push(name);return {data:{id:admin,status:'success'},error:null};
      }};},
      photograph:async()=>{if(phase==='success_finish'||phase==='failure_finish')expired=true;if(phase==='failure_finish')throw new Error('SOURCE_UNAVAILABLE');return snapshot;}
    });
    const response=await endpoint(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer a.b.c','Content-Type':'application/json','x-fig-channel':'github'},body:'{"operation":"check"}'}));
    assert.equal(response.status,403,phase);assert.deepEqual(await response.json(),{error:'Authorization rejected'});
    assert.equal(factories,1);assert.deepEqual(writes,phase==='factory'?[]:['admin_fig_check_begin']);
    assert.equal(verifications,phase==='factory'?3:phase==='cleanup'?5:4);
  }
});
test('valid requests reverify same operator/run at each boundary; changed identity is rejected',async()=>{
  const events=[];let invalidAt=Infinity;
  const endpoint=handler({config,verifyGithub:async()=>{events.push('verify');const count=events.filter(e=>e==='verify').length;
    return {operator:count===invalidAt?'22222222-2222-4222-8222-222222222222':admin,channel:'weekly',key:'github:run'};},
    authenticateAdmin:async()=>{throw new Error();},photograph:async()=>{events.push('source');return extract(html());},
    serviceFactory:()=>{events.push('service');return {rpc:async name=>{events.push(name);return {data:{id:admin,status:name.endsWith('begin')?'running':'success',replay:false},error:null};}};}
  });
  const request=()=>new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer a.b.c','Content-Type':'application/json','x-fig-channel':'github'},body:'{"operation":"check"}'});
  assert.equal((await endpoint(request())).status,200);
  assert.deepEqual(events,['verify','verify','service','verify','admin_fig_check_begin','source','verify','admin_fig_check_finish']);
  events.length=0;invalidAt=2;assert.equal((await endpoint(request())).status,403);assert.deepEqual(events,['verify','verify']);
});
test('GitHub client fixed endpoint/operation; minimized output; no server credential',async()=>{
 const vars={GITHUB_REPOSITORY:'giuseppepalazzo/stablr',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'schedule',GITHUB_RUN_ATTEMPT:'1',
  FIGCHECK_BROKER_URL:'https://sziakyhacffwvirhzboy.supabase.co/functions/v1/fig-governance',FIGCHECK_OIDC_AUDIENCE:config.audience,
  ACTIONS_ID_TOKEN_REQUEST_URL:'https://fixture.actions.githubusercontent.com/token',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'runner-only'};
 let count=0;const result=await run(vars,async(url,options)=>{count++;if(count===1)return Response.json({value:'a.b.c'});
  assert.deepEqual(JSON.parse(options.body),{operation:'check'});assert.equal(options.headers['x-fig-channel'],'github');return Response.json({id:admin,status:'success',raw:'should not escape'});});
 assert.deepEqual(result,{id:admin,status:'success'});for(const changes of [{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_RUN_ATTEMPT:'2'},{FIGCHECK_BROKER_URL:'https://evil.example/functions/v1/fig-governance'}])await assert.rejects(()=>run({...vars,...changes}));
});
