// Run only in a protected server/operator environment. No env loader, browser code or implicit remote action.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { extractFigEvidence, evidenceCounts, sha256, verifyFigManifest } from './fig-tee-evidence.mjs';

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const rpc = async (client, name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.code || 'RPC_ERROR'}`);
  return data;
};

export function prepareFigBatch(bytes, batchId = randomUUID()) {
  return { contract_version: 1, batch_id: batchId, manifest: extractFigEvidence(bytes) };
}

export function verifyPreparation(bytes, manifestBytes) {
  const preparation = JSON.parse(manifestBytes.toString('utf8'));
  if (!preparation || Object.keys(preparation).sort().join(',') !== 'batch_id,contract_version,manifest'
    || preparation.contract_version !== 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(preparation.batch_id || '')) throw new Error('Explicit immutable batch identity required');
  verifyFigManifest(bytes, preparation.manifest);
  return preparation;
}

// This is a server entrypoint, not a browser API. Service credentials are never returned.
async function prepareOnServer({ bytes, manifestBytes, env, clientFactory }) {
  const preparation = verifyPreparation(bytes, manifestBytes), manifest = preparation.manifest;
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: serviceKey, STABLR_ADMIN_ACCESS_TOKEN: token } = env;
  if (!url || !anon || !serviceKey || !token) throw new Error('Protected server credentials and current Admin access token required');
  const admin = clientFactory(url, anon, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: identity, error } = await admin.auth.getUser(token);
  if (error || !identity?.user?.id) throw new Error('Invalid Admin session');
  // Authorize BEFORE constructing the privileged client or attempting any upload.
  const session = await rpc(admin, 'admin_catalog_tee_evidence_preview', { p_artifact_id: null });
  if (session.admin_id !== identity.user.id) throw new Error('Admin identity mismatch');
  const server = clientFactory(url, serviceKey, options);
  const bucket = server.storage.from('admin-catalog-evidence');
  // Same object on retry is reusable only if its bytes have the expected hash. Never upsert.
  const existing = await bucket.download(manifest.artifact.object_path);
  if (!existing.error) {
    if (sha256(Buffer.from(await existing.data.arrayBuffer())) !== manifest.artifact.sha256) throw new Error('Archived object hash mismatch');
  } else {
    if (![404, '404', 400, '400'].includes(existing.error.statusCode) || !/not found|does not exist/i.test(existing.error.message || '')) throw new Error('Unable to verify archived object');
    const upload = await bucket.upload(manifest.artifact.object_path, bytes, { contentType: 'application/json', upsert: false });
    if (upload.error) {
      // Handle only a create race by re-reading and verifying; never overwrite.
      const retry = await bucket.download(manifest.artifact.object_path);
      if (retry.error || sha256(Buffer.from(await retry.data.arrayBuffer())) !== manifest.artifact.sha256) throw new Error('Immutable artifact upload failed');
    }
    const uploaded = await bucket.download(manifest.artifact.object_path);
    if (uploaded.error || sha256(Buffer.from(await uploaded.data.arrayBuffer())) !== manifest.artifact.sha256) throw new Error('Uploaded archive bytes do not match reviewed artifact');
  }
  const staged = await rpc(server, 'admin_catalog_tee_evidence_stage', { p_preparation_text: manifestBytes.toString('utf8'), p_operator_id: identity.user.id });
  if (staged.proposal_id !== preparation.batch_id || staged.approval_sha256 !== sha256(manifestBytes)) throw new Error('Server manifest hash/identity mismatch');
  return { server, staged, operatorId: identity.user.id };
}

export async function stageFigBatch({ bytes, manifestBytes, env, clientFactory = createClient }) {
  const { staged } = await prepareOnServer({ bytes, manifestBytes, env, clientFactory });
  return staged;
}

export async function confirmFigBatch({ bytes, manifestBytes, approvedHash, note, env, clientFactory = createClient }) {
  if (!/^[a-f0-9]{64}$/.test(approvedHash || '') || sha256(manifestBytes) !== approvedHash || !note?.trim() || note.length > 2000) throw new Error('Explicit reviewed manifest hash and note required');
  const { server, staged, operatorId } = await prepareOnServer({ bytes, manifestBytes, env, clientFactory });
  return rpc(server, 'admin_catalog_tee_evidence_confirm', {
    p_proposal_id: staged.proposal_id, p_approved_sha256: approvedHash, p_operator_id: operatorId, p_note: note.trim(), p_confirm: true
  });
}

export async function main(args = process.argv.slice(2)) {
  const command = args[0];
  if (!['preview','stage','confirm'].includes(command)) throw new Error('Use preview, stage or confirm; no remote action by default');
  const get = flag => args[args.indexOf(flag) + 1];
  for (const flag of ['--input', ...(command === 'preview' ? ['--out'] : command === 'stage' ? ['--manifest'] : ['--manifest', '--approve-sha256', '--note'])]) {
    if (args.indexOf(flag) < 0 || !get(flag) || get(flag).startsWith('--')) throw new Error(`Required ${flag}`);
  }
  const bytes = await readFile(get('--input'));
  if (command === 'preview') {
    const preparation = prepareFigBatch(bytes), output = Buffer.from(JSON.stringify(preparation, null, 2) + '\n');
    await writeFile(get('--out'), output, { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ mode: 'local_read_only_preview', batch_id: preparation.batch_id, extractor: preparation.manifest.extractor_version, counts: evidenceCounts(preparation.manifest), approval_sha256: sha256(output) }) + '\n');
  } else if (command === 'stage') {
    const result = await stageFigBatch({ bytes, manifestBytes: await readFile(get('--manifest')), env: process.env });
    process.stdout.write(JSON.stringify(result) + '\n');
  } else if (command === 'confirm') {
    const result = await confirmFigBatch({ bytes, manifestBytes: await readFile(get('--manifest')), approvedHash: get('--approve-sha256'), note: get('--note'), env: process.env });
    process.stdout.write(JSON.stringify(result) + '\n');
  } else throw new Error('Use preview or confirm; no remote action by default');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  // Never log auth/session, raw SQL errors, source contents or credentials.
  process.stderr.write('Evidence batch failed. Check protected credentials, reviewed manifest and server authorization; no live data was changed.\n');
  process.exitCode = 1;
});
