import { createClient } from 'npm:@supabase/supabase-js@2.103.0';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0';
import { brokerPolicy, githubVerifier, JWKS_URL } from './oidc.mjs';
import { createBroker } from './handler.mjs';

// Missing/malformed policy fails closed at startup. No secrets are returned or logged.
const policy = brokerPolicy(Deno.env.toObject());
const verify = githubVerifier({ jwtVerify, keys: createRemoteJWKSet(new URL(JWKS_URL), {
  timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 300000
}), policy, onReject: code => console.warn('tee_broker_oidc_rejected',code) });
Deno.serve(createBroker({ verify, policy, serviceFactory: () => {
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Broker unavailable');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
} }));
