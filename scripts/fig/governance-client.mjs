import { pathToFileURL } from 'node:url';
export async function run(env=process.env,fetcher=fetch) {
  if(env.GITHUB_REPOSITORY!=='giuseppepalazzo/stablr'||env.GITHUB_REF!=='refs/heads/main'||
    !['schedule','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)||env.GITHUB_RUN_ATTEMPT!=='1')throw new Error();
  const endpoint=new URL(env.FIGCHECK_BROKER_URL), tokenUrl=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if(endpoint.protocol!=='https:'||!/^sziakyhacffwvirhzboy\.supabase\.co$/.test(endpoint.hostname)||endpoint.pathname!=='/functions/v1/fig-governance'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password||
    tokenUrl.protocol!=='https:'||!tokenUrl.hostname.endsWith('.actions.githubusercontent.com')||tokenUrl.username||tokenUrl.password||!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN||
    !/^stablr:fig-governance:[a-z0-9-]+$/.test(env.FIGCHECK_OIDC_AUDIENCE||''))throw new Error();
  tokenUrl.searchParams.set('audience',env.FIGCHECK_OIDC_AUDIENCE);
  const oidc=await fetcher(tokenUrl,{headers:{Authorization:`Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!oidc.ok)throw new Error();const {value}=await oidc.json();
  if(typeof value!=='string'||value.length>16384||value.split('.').length!==3)throw new Error();
  const response=await fetcher(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{
    Authorization:`Bearer ${value}`,'Content-Type':'application/json','x-fig-channel':'github'},body:JSON.stringify({operation:'check'})});
  if(!response.ok)throw new Error();const result=await response.json();
  if(!/^[a-f0-9-]{36}$/.test(result.id||'')||!['running','success','failed'].includes(result.status))throw new Error();
  // No raw, claims, source rows, payloads or credentials in runner output.
  return {id:result.id,status:result.status};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.argv.length!==2) {process.stderr.write('Arguments not allowed\n');process.exitCode=1;}
  else run().then(r=>{process.stdout.write(JSON.stringify(r)+'\n');if(r.status!=='success')process.exitCode=1;})
    .catch(()=>{process.stderr.write('FIG governance check failed\n');process.exitCode=1;});
}
