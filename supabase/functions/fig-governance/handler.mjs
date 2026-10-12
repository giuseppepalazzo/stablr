import { fetchPhotograph } from './source.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function handler({ verifyGithub, authenticateAdmin, serviceFactory, config, photograph = fetchPhotograph }) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Vary':'Origin' };
    if (origin && config.origins.includes(origin)) Object.assign(headers, { 'Access-Control-Allow-Origin':origin,
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods':'POST, OPTIONS' });
    const reply = (body, status=200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !config.origins.includes(origin)) return reply({error:'Request rejected'},403);
    if (request.method === 'OPTIONS' && origin) return new Response(null,{status:204,headers});
    if (request.method !== 'POST') return reply({error:'Request rejected'},403);
    let identity, authenticate;
    try {
      const auth = request.headers.get('authorization'); if (!auth?.startsWith('Bearer ') || auth.length > 16400) throw new Error();
      // An Admin can also call without Origin; token type is selected by the
      // explicit channel header, never by an unverified JWT issuer or claim.
      if (request.headers.get('x-fig-channel') === 'github') {
        if (origin) throw new Error();authenticate = () => verifyGithub(auth.slice(7));
      } else authenticate = () => authenticateAdmin(auth.slice(7));
      identity = await authenticate();
    } catch { return reply({error:'Authorization rejected'},403); }
    let body;
    try {
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new Error();
      const reader = request.body?.getReader(); if (!reader) throw new Error();let text='',size=0;const decoder=new TextDecoder();
      try { for (;;) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024)throw new Error();text+=decoder.decode(value,{stream:true});}text+=decoder.decode(); }
      finally { await reader.cancel().catch(()=>{}); }
      body=JSON.parse(text);
      const fields=Object.keys(body).sort().join(',');
      if (body.operation !== 'check' || (identity.channel === 'weekly' ? fields !== 'operation' : fields !== 'operation,request_id' || !UUID.test(body.request_id || ''))) throw new Error();
      if (identity.channel === 'manual') identity.key=`admin:${identity.operator}:${body.request_id}`;
    } catch { return reply({error:'Invalid request'},400); }
    const authorizationRejected = Symbol('authorization rejected');
    const reauthorize = async () => {
      try {
        // Re-run the complete verifier, not just an unverified exp check. The
        // same token must still identify the originally authorized operator/run.
        const current = await authenticate();
        if (current.operator !== identity.operator || current.channel !== identity.channel ||
          (identity.channel === 'weekly' && current.key !== identity.key)) throw new Error();
      } catch { throw authorizationRejected; }
    };
    // A slow body must never turn an expired token into a privileged client.
    try { await reauthorize(); } catch { return reply({error:'Authorization rejected'},403); }
    const service = serviceFactory();let started;
    const invoke = async (name,args) => {
      // Includes begin, successful finish, source-failure finish and cleanup.
      // No mutating RPC can reuse authorization obtained before an await.
      await reauthorize();
      const {data,error}=await service.rpc(name,args);if(error)throw error;return data;
    };
    try {
      started=await invoke('admin_fig_check_begin',{p_operator:identity.operator,p_channel:identity.channel,p_request_key:identity.key});
      if (started.replay) return reply({id:started.id,status:started.status});
      let snapshot;
      try { snapshot=await photograph(); }
      catch (e) {
        const failure=e?.message==='SOURCE_INVALID'?'SOURCE_INVALID':'SOURCE_UNAVAILABLE';
        const result=await invoke('admin_fig_check_finish',{p_operator:identity.operator,p_check_id:started.id,p_photograph:null,p_failure:failure});
        return reply({id:result.id,status:result.status});
      }
      const result=await invoke('admin_fig_check_finish',{p_operator:identity.operator,p_check_id:started.id,p_photograph:snapshot,p_failure:null});
      return reply({id:result.id,status:result.status});
    } catch(e) {
      if (e === authorizationRejected) return reply({error:'Authorization rejected'},403);
      // A rejected/partial photograph is a failed check, never a new baseline.
      if(started && !started.replay) {
        try {await invoke('admin_fig_check_finish',{p_operator:identity.operator,p_check_id:started.id,p_photograph:null,p_failure:'SOURCE_INVALID'});}
        catch (failure) {
          if (failure === authorizationRejected) return reply({error:'Authorization rejected'},403);
          /* Lease expiration records an interrupted run. */
        }
      }
      return reply({error:e?.code==='55P03'?'Check busy':'Check failed'},e?.code==='55P03'?409:503);
    }
  };
}
