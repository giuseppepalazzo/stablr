// Closed response contract shared by broker and runner. Never forward arbitrary RPC fields.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...keys].sort().join(',');
const number=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000;
const reasons=new Set(['incomplete_source_evidence','unsupported_header_layout','invalid_row_shape','invalid_cell_shape']);
export function safeResult(result,operation) {
  if (operation==='preview') {
    if (!exact(result,['proposal_id','approval_sha256','extractor_version','counts','reasons']) || typeof result.proposal_id!=='string' || !UUID.test(result.proposal_id)
      || typeof result.approval_sha256!=='string' || !HASH.test(result.approval_sha256) || result.extractor_version!=='fig-raw-tee-evidence/1.0.0'
      || !exact(result.counts,['total','complete','incomplete','excluded']) || !Object.values(result.counts).every(number)
      || result.counts.total!==result.counts.complete+result.counts.incomplete+result.counts.excluded
      || !Array.isArray(result.reasons) || result.reasons.length>4
      || !result.reasons.every(r=>exact(r,['reason','count'])&&reasons.has(r.reason)&&number(r.count))) throw new Error('Invalid result');
  } else if (operation!=='confirm' || !exact(result,['batch_id','total','inserted','existing','incomplete','excluded']) || typeof result.batch_id!=='string' || !UUID.test(result.batch_id)
    || !['total','inserted','existing','incomplete','excluded'].every(k=>number(result[k]))
    || result.total!==result.inserted+result.existing+result.excluded) throw new Error('Invalid receipt');
  return result;
}
