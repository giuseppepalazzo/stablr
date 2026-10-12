import { createClient } from 'npm:@supabase/supabase-js@2.103.0';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0';
import { policy, verifier, ISSUER } from './oidc.mjs';
import { handler } from './handler.mjs';
const config = policy(Deno.env.toObject());
const serviceFactory = () => createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
});
const verifyGithub = verifier({jwtVerify,keys:createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`)),config,
  onReject:code=>console.warn(code)});
Deno.serve(handler({config,verifyGithub,serviceFactory,authenticateAdmin:async token=>{
  const {data,error}=await serviceFactory().auth.getUser(token);
  if(error||!data.user?.id)throw new Error('Admin required');
  const userClient=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{
    global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
  const checked=await userClient.rpc('admin_fig_overview',{p_offset:0,p_show_resolved:false});
  if(checked.error)throw new Error('Admin required');
  return {operator:data.user.id,channel:'manual'};
}}));
