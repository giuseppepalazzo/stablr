// Authorization policy is server configuration, never request input.
export const ISSUER = 'https://token.actions.githubusercontent.com';
export const JWKS_URL = `${ISSUER}/.well-known/jwks`;
export const REPOSITORY = 'giuseppepalazzo/stablr';
export const WORKFLOW_REF = `${REPOSITORY}/.github/workflows/tee-evidence-batch.yml@refs/heads/main`;
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
export function brokerPolicy(env) {
  const audience = env.EVIDENCE_OIDC_AUDIENCE;
  const repositoryId = env.EVIDENCE_GITHUB_REPOSITORY_ID;
  const ownerId = env.EVIDENCE_GITHUB_OWNER_ID;
  let actors, revisions;
  try {
    actors = JSON.parse(env.EVIDENCE_GITHUB_ADMIN_MAP || 'null');
    revisions = JSON.parse(env.EVIDENCE_GITHUB_WORKFLOW_SHAS || 'null');
  } catch { throw new Error('Invalid broker policy'); }
  if (!audience || !/^stablr:tee-evidence:[a-z0-9-]{1,80}$/.test(audience) || !id(repositoryId) || !id(ownerId)
    || !actors || Array.isArray(actors) || typeof actors !== 'object' || !Object.keys(actors).length
    || !Object.entries(actors).every(([actor,admin]) => id(actor) && uuid(admin))
    || !Array.isArray(revisions) || !revisions.length || !revisions.every(sha)) throw new Error('Invalid broker policy');
  return Object.freeze({ audience, repositoryId, ownerId, actors: Object.freeze({ ...actors }), revisions: Object.freeze([...revisions]) });
}

// jwtVerify/createRemoteJWKSet come from pinned jose, not from the request.
export function githubVerifier({ jwtVerify, keys, policy, now = () => new Date() }) {
  return async token => {
    if (typeof token !== 'string' || token.length > 16384 || token.split('.').length !== 3) throw new Error('OIDC rejected');
    const { payload: p, protectedHeader: header } = await jwtVerify(token, keys, {
      issuer: ISSUER, audience: policy.audience, algorithms: ['RS256'], clockTolerance: 15,
      maxTokenAge: '10m', currentDate: now(), requiredClaims: ['iss','aud','sub','exp','iat','nbf','jti']
    });
    const subjects = [
      `repo:${REPOSITORY}:ref:refs/heads/main`,
      `repo:giuseppepalazzo@${policy.ownerId}/stablr@${policy.repositoryId}:ref:refs/heads/main`
    ];
    if (header.typ !== 'JWT' || typeof header.kid !== 'string' || !header.kid || p.aud !== policy.audience
      || !subjects.includes(p.sub) || p.repository !== REPOSITORY || p.repository_owner !== 'giuseppepalazzo'
      || p.repository_id !== policy.repositoryId || p.repository_owner_id !== policy.ownerId
      || p.ref !== 'refs/heads/main' || p.ref_type !== 'branch' || p.event_name !== 'workflow_dispatch'
      || p.workflow_ref !== WORKFLOW_REF || !policy.revisions.includes(p.workflow_sha) || p.sha !== p.workflow_sha
      || p.runner_environment !== 'github-hosted' || p.run_attempt !== '1' || !id(p.run_id) || !id(p.actor_id)
      || !Object.hasOwn(policy.actors,p.actor_id) || p.head_ref || p.base_ref || p.job_workflow_ref || p.job_workflow_sha
      || p.environment !== undefined || typeof p.jti !== 'string' || p.jti.length < 1 || p.jti.length > 200
      || ![p.iat,p.nbf,p.exp].every(Number.isSafeInteger) || p.exp <= p.iat || p.exp-p.iat > 600 || p.nbf > p.exp) throw new Error('OIDC rejected');
    // No JWT/token/username is persisted. All context fields are signed and allowlisted.
    return { operatorId: policy.actors[p.actor_id], jti: p.jti, context: {
      repository: p.repository, repository_id: p.repository_id, repository_owner_id: p.repository_owner_id,
      ref: p.ref, event_name: p.event_name, workflow_ref: p.workflow_ref, workflow_sha: p.workflow_sha,
      runner_environment: p.runner_environment, actor_id: p.actor_id, run_id: p.run_id,
      run_attempt: p.run_attempt, audience: p.aud
    } };
  };
}
