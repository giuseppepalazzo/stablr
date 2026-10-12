// Separate policy: never changes the evidence broker's dispatch-only boundary.
export const ISSUER = 'https://token.actions.githubusercontent.com';
export const WORKFLOW = 'giuseppepalazzo/stablr/.github/workflows/fig-governance.yml@refs/heads/main';
const id = s => typeof s === 'string' && /^[1-9][0-9]{0,19}$/.test(s);
const uuid = s => typeof s === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(s);
export function policy(env) {
  let actors, shas, origins;
  try { actors = JSON.parse(env.FIGCHECK_GITHUB_ADMIN_MAP); shas = JSON.parse(env.FIGCHECK_WORKFLOW_SHAS); origins = JSON.parse(env.FIGCHECK_ADMIN_ORIGINS); } catch { throw new Error('Invalid governance policy'); }
  if (!/^stablr:fig-governance:[a-z0-9-]+$/.test(env.FIGCHECK_OIDC_AUDIENCE || '') ||
    env.FIGCHECK_REPOSITORY_ID !== '1193622237' || env.FIGCHECK_OWNER_ID !== '28347789' ||
    !actors || Array.isArray(actors) || !Object.keys(actors).length || !Object.entries(actors).every(([k,v]) => id(k) && uuid(v)) ||
    !Array.isArray(shas) || !shas.length || !shas.every(s => /^[a-f0-9]{40}$/.test(s)) ||
    !Array.isArray(origins) || !origins.length || !origins.every(s => { try { const u = new URL(s);return u.origin === s && (u.protocol === 'https:' || (u.hostname === 'localhost' && u.protocol === 'http:')); } catch { return false; } })) throw new Error('Invalid governance policy');
  return { audience: env.FIGCHECK_OIDC_AUDIENCE, actors, shas, origins };
}
export function verifier({ jwtVerify, keys, config, onReject = () => {} }) {
  return async token => {
    try {
      if (typeof token !== 'string' || token.length > 16384 || token.split('.').length !== 3) throw new Error();
      const { payload:p, protectedHeader:h } = await jwtVerify(token, keys, { algorithms:['RS256'], issuer:ISSUER,
        audience:config.audience, maxTokenAge:'10m', clockTolerance:15, requiredClaims:['iss','aud','sub','iat','nbf','exp','jti'] });
      const subjects = ['repo:giuseppepalazzo/stablr:ref:refs/heads/main', 'repo:giuseppepalazzo@28347789/stablr@1193622237:ref:refs/heads/main'];
      if (h.typ !== 'JWT' || !h.kid || !subjects.includes(p.sub) || p.aud !== config.audience ||
        p.repository !== 'giuseppepalazzo/stablr' || p.repository_owner !== 'giuseppepalazzo' || p.repository_id !== '1193622237' || p.repository_owner_id !== '28347789' ||
        p.ref !== 'refs/heads/main' || p.ref_type !== 'branch' || !['schedule','workflow_dispatch'].includes(p.event_name) ||
        p.workflow_ref !== WORKFLOW || !config.shas.includes(p.workflow_sha) || p.sha !== p.workflow_sha ||
        p.runner_environment !== 'github-hosted' || p.run_attempt !== '1' || !id(p.run_id) || !id(p.actor_id) || !Object.hasOwn(config.actors,p.actor_id) ||
        p.head_ref || p.base_ref || p.environment !== undefined ||
        ((p.job_workflow_ref !== undefined || p.job_workflow_sha !== undefined) && (p.job_workflow_ref !== WORKFLOW || p.job_workflow_sha !== p.workflow_sha)) ||
        ![p.iat,p.nbf,p.exp].every(Number.isSafeInteger) || p.exp <= p.iat || p.exp-p.iat > 600 || p.nbf > p.exp ||
        typeof p.jti !== 'string' || !p.jti || p.jti.length > 200) throw new Error();
      return { operator: config.actors[p.actor_id], channel:'weekly', key:`github:${p.repository_id}:${p.run_id}` };
    } catch { onReject('FIGCHECK_OIDC_REJECTED'); throw new Error('Authorization rejected'); }
  };
}
