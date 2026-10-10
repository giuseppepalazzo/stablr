// Authorization policy is server configuration, never request input.
export const ISSUER = 'https://token.actions.githubusercontent.com';
export const JWKS_URL = `${ISSUER}/.well-known/jwks`;
export const REPOSITORY = 'giuseppepalazzo/stablr';
export const WORKFLOW_REF = `${REPOSITORY}/.github/workflows/tee-evidence-batch.yml@refs/heads/main`;
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
// Optional GitHub job context must identify the same explicitly authorized workflow revision.
function permittedJobWorkflow(p, policy) {
  if (p.job_workflow_ref === undefined && p.job_workflow_sha === undefined) return true;
  return p.job_workflow_ref === WORKFLOW_REF && p.job_workflow_sha === p.workflow_sha
    && policy.revisions.includes(p.job_workflow_sha);
}
// Diagnostic codes are fixed literals. Never forward errors, values or JWT claims.
function verificationCode(error) {
  const claims = { iss:'OIDC_CLAIM_ISS', aud:'OIDC_CLAIM_AUD', sub:'OIDC_CLAIM_SUB',
    exp:'OIDC_CLAIM_EXP', iat:'OIDC_CLAIM_IAT', nbf:'OIDC_CLAIM_NBF', jti:'OIDC_CLAIM_JTI' };
  if (error?.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && Object.hasOwn(claims,error.claim)) return claims[error.claim];
  const codes = { ERR_JWT_EXPIRED:'OIDC_EXPIRED', ERR_JWKS_TIMEOUT:'OIDC_JWKS_TIMEOUT',
    ERR_JWKS_NO_MATCHING_KEY:'OIDC_JWKS_KEY', ERR_JWS_SIGNATURE_VERIFICATION_FAILED:'OIDC_SIGNATURE',
    ERR_JOSE_ALG_NOT_ALLOWED:'OIDC_ALGORITHM' };
  return Object.hasOwn(codes,error?.code) ? codes[error.code] : 'OIDC_CRYPTO_VERIFICATION';
}
function policyCode(p,header,policy,subjects) {
  if (header.typ !== 'JWT') return 'OIDC_HEADER_TYP';
  if (typeof header.kid !== 'string' || !header.kid) return 'OIDC_HEADER_KID';
  if (p.aud !== policy.audience) return 'OIDC_AUDIENCE';
  if (!subjects.includes(p.sub)) return 'OIDC_SUBJECT';
  if (p.repository !== REPOSITORY) return 'OIDC_REPOSITORY';
  if (p.repository_owner !== 'giuseppepalazzo') return 'OIDC_OWNER';
  if (p.repository_id !== policy.repositoryId) return 'OIDC_REPOSITORY_ID';
  if (p.repository_owner_id !== policy.ownerId) return 'OIDC_OWNER_ID';
  if (p.ref !== 'refs/heads/main') return 'OIDC_REF';
  if (p.ref_type !== 'branch') return 'OIDC_REF_TYPE';
  if (p.event_name !== 'workflow_dispatch') return 'OIDC_EVENT';
  if (p.workflow_ref !== WORKFLOW_REF) return 'OIDC_WORKFLOW_REF';
  if (!policy.revisions.includes(p.workflow_sha)) return 'OIDC_WORKFLOW_SHA';
  if (p.sha !== p.workflow_sha) return 'OIDC_SOURCE_SHA';
  if (p.runner_environment !== 'github-hosted') return 'OIDC_RUNNER';
  if (p.run_attempt !== '1') return 'OIDC_RUN_ATTEMPT';
  if (!id(p.run_id)) return 'OIDC_RUN_ID';
  if (!id(p.actor_id)) return 'OIDC_ACTOR_ID';
  if (!Object.hasOwn(policy.actors,p.actor_id)) return 'OIDC_ACTOR';
  if (p.head_ref) return 'OIDC_HEAD_REF';
  if (p.base_ref) return 'OIDC_BASE_REF';
  if (!permittedJobWorkflow(p,policy)) {
    if (p.job_workflow_ref !== WORKFLOW_REF) return 'OIDC_REUSABLE_REF';
    return 'OIDC_REUSABLE_SHA';
  }
  if (p.environment !== undefined) return 'OIDC_ENVIRONMENT';
  if (typeof p.jti !== 'string' || p.jti.length < 1 || p.jti.length > 200) return 'OIDC_JTI';
  if (![p.iat,p.nbf,p.exp].every(Number.isSafeInteger)) return 'OIDC_TIME_FORMAT';
  if (p.exp <= p.iat || p.exp-p.iat > 600) return 'OIDC_LIFETIME';
  if (p.nbf > p.exp) return 'OIDC_TIME_ORDER';
  return 'OIDC_POLICY';
}
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
const silentDiagnostic = (/** @type {string} */ _code) => {};
export function githubVerifier({ jwtVerify, keys, policy, now = () => new Date(), onReject = silentDiagnostic }) {
  const report = code => { try { onReject(code); } catch { /* Diagnostics cannot change authorization. */ } };
  return async token => {
    if (typeof token !== 'string' || token.length > 16384 || token.split('.').length !== 3) {
      report('OIDC_TOKEN_FORMAT'); throw new Error('OIDC rejected');
    }
    let verified;
    try { verified = await jwtVerify(token, keys, {
      issuer: ISSUER, audience: policy.audience, algorithms: ['RS256'], clockTolerance: 15,
      maxTokenAge: '10m', currentDate: now(), requiredClaims: ['iss','aud','sub','exp','iat','nbf','jti']
    }); } catch (error) { report(verificationCode(error)); throw error; }
    const { payload: p, protectedHeader: header } = verified;
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
      || !Object.hasOwn(policy.actors,p.actor_id) || p.head_ref || p.base_ref || !permittedJobWorkflow(p,policy)
      || p.environment !== undefined || typeof p.jti !== 'string' || p.jti.length < 1 || p.jti.length > 200
      || ![p.iat,p.nbf,p.exp].every(Number.isSafeInteger) || p.exp <= p.iat || p.exp-p.iat > 600 || p.nbf > p.exp) {
      report(policyCode(p,header,policy,subjects)); throw new Error('OIDC rejected');
    }
    // No JWT/token/username is persisted. All context fields are signed and allowlisted.
    return { operatorId: policy.actors[p.actor_id], jti: p.jti, context: {
      repository: p.repository, repository_id: p.repository_id, repository_owner_id: p.repository_owner_id,
      ref: p.ref, event_name: p.event_name, workflow_ref: p.workflow_ref, workflow_sha: p.workflow_sha,
      runner_environment: p.runner_environment, actor_id: p.actor_id, run_id: p.run_id,
      run_attempt: p.run_attempt, audience: p.aud
    } };
  };
}
