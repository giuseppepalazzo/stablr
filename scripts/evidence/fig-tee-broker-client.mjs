// GitHub runner: no Supabase SDK, Admin session, service credential or arbitrary path/command.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { safeResult } from '../../supabase/functions/_shared/tee-broker-results.mjs';
export { safeResult } from '../../supabase/functions/_shared/tee-broker-results.mjs';
const RAW_PATH = 'data/fig/raw/fig-slope-course-rating-raw.json';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
export async function runBroker(env=process.env,{fetcher=fetch,read=readFile,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const operation=env.EVIDENCE_OPERATION;
  if (!['preview','confirm'].includes(operation) || env.GITHUB_REF!=='refs/heads/main' || env.GITHUB_EVENT_NAME!=='workflow_dispatch'
    || env.GITHUB_RUN_ATTEMPT!=='1') throw new Error('Execution rejected');
  const broker=new URL(env.EVIDENCE_BROKER_URL);
  if (broker.protocol!=='https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(broker.hostname) || broker.username || broker.password
    || broker.pathname!=='/functions/v1/tee-evidence-broker' || broker.search || broker.hash) throw new Error('Invalid broker');
  const audience=env.EVIDENCE_OIDC_AUDIENCE;
  if (!/^stablr:tee-evidence:[a-z0-9-]{1,80}$/.test(audience||'')) throw new Error('Invalid audience');
  let body;
  if (operation==='preview') {
    if (env.EVIDENCE_PROPOSAL_ID || env.EVIDENCE_APPROVAL_SHA256 || env.EVIDENCE_NOTE) throw new Error('Preview takes no approval');
    const bytes=await read(RAW_PATH);
    if (!bytes.length || bytes.length>1024*1024) throw new Error('Source exceeds pilot limit');
    const raw=bytes.toString('utf8');
    if (!Buffer.from(raw,'utf8').equals(bytes)) throw new Error('Source must be UTF-8');
    body={operation,raw,raw_sha256:createHash('sha256').update(bytes).digest('hex')};
  } else {
    if (!UUID.test(env.EVIDENCE_PROPOSAL_ID||'') || !HASH.test(env.EVIDENCE_APPROVAL_SHA256||'')
      || !env.EVIDENCE_NOTE?.trim() || env.EVIDENCE_NOTE.length>2000) throw new Error('Explicit approval required');
    body={operation,proposal_id:env.EVIDENCE_PROPOSAL_ID,approval_sha256:env.EVIDENCE_APPROVAL_SHA256,note:env.EVIDENCE_NOTE.trim()};
  }
  const tokenUrl=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (tokenUrl.protocol!=='https:' || !tokenUrl.hostname.endsWith('.actions.githubusercontent.com') || tokenUrl.username || tokenUrl.password
    || tokenUrl.hash || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error('OIDC unavailable');
  tokenUrl.searchParams.set('audience',audience);
  const oidc=await fetcher(tokenUrl,{headers:{Authorization:`Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`},redirect:'error',signal:AbortSignal.timeout(15000)});
  if (!oidc.ok) throw new Error('OIDC unavailable');
  const {value:token}=await oidc.json();
  if (typeof token!=='string' || token.length>16384 || token.split('.').length!==3) throw new Error('OIDC unavailable');
  const text=JSON.stringify(body);
  for (let attempt=0;attempt<3;attempt++) {
    let response;
    try {
      response=await fetcher(broker,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:text,redirect:'error',signal:AbortSignal.timeout(120000)});
    } catch {
      if (attempt===2) throw new Error('Broker unavailable');
      await wait(1000*(attempt+1)); continue;
    }
    if (response.ok) return safeResult(await response.json(),operation);
    if (![502,503,504].includes(response.status) || attempt===2) throw new Error('Broker request rejected');
    await wait(1000*(attempt+1));
  }
}
if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (process.argv.length!==2) { process.stderr.write('No command/path arguments permitted.\n'); process.exitCode=1; }
  else runBroker().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{
    process.stderr.write('Evidence broker request failed; no sensitive output is logged.\n');process.exitCode=1;
  });
}
