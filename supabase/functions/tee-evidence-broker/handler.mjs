import { Buffer } from 'node:buffer';
import { extractFigEvidence, sha256 } from '../_shared/fig-tee-evidence.mjs';
import { safeResult } from '../_shared/tee-broker-results.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_BODY = 2 * 1024 * 1024; // bounded pilot; no silent truncation
const MAX_RAW = 1024 * 1024;
const json = (body,status=200) => new Response(JSON.stringify(body), { status, headers: {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
} });
const exact = (o,fields) => o && !Array.isArray(o) && typeof o === 'object' && Object.keys(o).sort().join(',') === [...fields].sort().join(',');
async function readBounded(request) {
  if (!request.body || (Number(request.headers.get('content-length')) || 0) > MAX_BODY) throw new Error('Invalid body');
  const reader = request.body.getReader(), parts = []; let size = 0;
  try { for (;;) { const { done,value } = await reader.read(); if (done) break; size += value.byteLength;
    if (size > MAX_BODY) throw new Error('Invalid body'); parts.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(parts.map(p => Buffer.from(p))).toString('utf8'));
}
export function proposalId(context,rawHash) {
  const hex = sha256(Buffer.from(JSON.stringify([context.repository_id,context.run_id,context.actor_id,rawHash]))).slice(0,32).split('');
  hex[12]='4'; hex[16]=((parseInt(hex[16],16)&3)|8).toString(16);
  const h=hex.join(''); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
// Only this handler can construct the service client; verifier always runs first.
export function createBroker({ verify, serviceFactory, policy }) {
  return async request => {
    if (request.method !== 'POST' || request.headers.has('origin')) return json({ error:'Request rejected' },403);
    let identity, token;
    try {
      const auth=request.headers.get('authorization');
      if (!auth?.startsWith('Bearer ')) throw new Error('OIDC required');
      token=auth.slice(7); identity=await verify(token);
    } catch { return json({ error:'Authorization rejected' },403); }
    let body;
    try {
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new Error('JSON required');
      body=await readBounded(request);
      if (body.operation === 'preview') {
        if (!exact(body,['operation','raw','raw_sha256']) || typeof body.raw !== 'string' || !HASH.test(body.raw_sha256)) throw new Error('Invalid preview');
        const bytes=Buffer.from(body.raw,'utf8');
        if (!bytes.length || bytes.length > MAX_RAW || sha256(bytes) !== body.raw_sha256) throw new Error('Invalid source hash');
      } else if (body.operation === 'confirm') {
        if (!exact(body,['operation','proposal_id','approval_sha256','note']) || typeof body.proposal_id !== 'string' || !UUID.test(body.proposal_id)
          || typeof body.approval_sha256 !== 'string' || !HASH.test(body.approval_sha256)
          || typeof body.note !== 'string' || !body.note.trim() || body.note.length > 2000) throw new Error('Invalid confirm');
      } else throw new Error('Operation rejected');
    } catch { return json({ error:'Invalid request' },400); }
    // A slow request must not turn an expired token into a privileged operation.
    try { identity=await verify(token); } catch { return json({error:'Authorization rejected'},403); }
    try {
      const tokenHash=sha256(Buffer.from(identity.jti));
      const invoke=async (client,name,args) => {
        const {data,error}=await client.rpc(name,args); if (error) throw error; if (!data) throw new Error('Missing receipt'); return data;
      };
      if (body.operation === 'preview') {
        const bytes=Buffer.from(body.raw,'utf8'), manifest=extractFigEvidence(bytes);
        const id=proposalId(identity.context,body.raw_sha256);
        const preparation=JSON.stringify({contract_version:1,batch_id:id,manifest},null,2)+'\n';
        if (Buffer.byteLength(preparation)>12582912) return json({error:'Source exceeds supported batch'},400);
        const service=serviceFactory();
        const args={p_preparation_text:preparation,p_context:identity.context,p_token_hash:tokenHash,p_operator_id:identity.operatorId};
        // Read-only authorization/run preflight BEFORE any Storage write.
        await invoke(service,'admin_catalog_tee_broker_preflight',args);
        const bucket=service.storage.from('admin-catalog-evidence');
        const check=async () => {
          const result=await bucket.download(manifest.artifact.object_path);
          if (!result.error && sha256(Buffer.from(await result.data.arrayBuffer()))!==body.raw_sha256) throw new Error('Archive mismatch');
          return result;
        };
        const existing=await check();
        if (existing.error) {
          if (![400,'400',404,'404'].includes(existing.error.statusCode) || !/not found|does not exist/i.test(existing.error.message || '')) throw existing.error;
          const uploaded=await bucket.upload(manifest.artifact.object_path,bytes,{contentType:'application/json',upsert:false});
          const stored=await check(); if (stored.error) throw uploaded.error || stored.error;
        }
        return json(safeResult(await invoke(service,'admin_catalog_tee_broker_stage',args),'preview'));
      }
      const service=serviceFactory();
      const prepared=await invoke(service,'admin_catalog_tee_broker_prepared',{p_proposal_id:body.proposal_id,p_operator_id:identity.operatorId});
      if (!policy.revisions.includes(prepared.workflow_sha) || prepared.actor_id!==identity.context.actor_id
        || prepared.approval_sha256!==body.approval_sha256) throw new Error('Approval mismatch');
      return json(safeResult(await invoke(service,'admin_catalog_tee_broker_confirm',{
        p_proposal_id:body.proposal_id,p_approved_sha256:body.approval_sha256,p_note:body.note.trim(),
        p_context:identity.context,p_token_hash:tokenHash,p_operator_id:identity.operatorId
      }),'confirm'));
    } catch (error) {
      // Never log tokens/raw/manifests/backend errors. Narrow, constant responses only.
      const status=error?.code==='55P03'?503:error?.code==='42501'?403:409;
      return json({error:status===503?'Batch busy; retry identical request':'Batch rejected'},status);
    }
  };
}
