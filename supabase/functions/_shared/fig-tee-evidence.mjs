// Independent archival extractor. Never imports a seed, matches a live UUID or classifies a tee.
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const EXTRACTOR_VERSION = 'fig-raw-tee-evidence/1.0.0';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ITEMS = 10000;
const bounded = (v, max = 300) => typeof v === 'string' && v.length <= max;
const locator = (table, row, column) => `table:${table}/row:${row}/tee-column:${column}`;
const integer = (text) => /^\d{1,3}$/.test(String(text).trim()) ? Number(String(text).trim()) : null;

export function extractFigEvidence(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw new Error('Artifact must be 1–16 MiB');
  const raw = JSON.parse(bytes.toString('utf8'));
  if (raw.source_system !== 'fig' || raw.schema_version !== '1.0' || !Array.isArray(raw.tables)) throw new Error('Unsupported FIG raw schema');
  const url = new URL(raw.source_url);
  if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'federgolf.it' || url.hostname.endsWith('.federgolf.it')) || url.search || url.hash) throw new Error('Unsupported FIG source URL');
  const items = [], refs = new Set();
  const append = (item) => {
    if (refs.has(item.observation_id)) throw new Error('Duplicate artifact locator');
    refs.add(item.observation_id); items.push(item);
    if (items.length > MAX_ITEMS) throw new Error('Split archive batch: maximum 10000 observations');
  };
  for (const table of raw.tables) {
    if (!Number.isSafeInteger(table.table_index) || table.table_index < 0 || !Array.isArray(table.rows)) throw new Error('Invalid table locator');
    const header = table.rows.find(r => Array.isArray(r.cells) && r.cells[0] === 'Circolo' && r.cells[1] === 'Percorso' && r.cells[2] === 'PAR');
    const teeHeader = header && table.rows.find(r => r.row_index === header.row_index - 1);
    if (!header || !teeHeader || !Array.isArray(teeHeader.cells) || (header.cells.length - 3) !== (teeHeader.cells.length - 1) * 2) {
      append({ observation_id: locator(table.table_index, 0, 0), outcome: 'excluded', reason: 'unsupported_header_layout', evidence: null });
      continue;
    }
    const rowIds = new Set();
    for (const row of table.rows) {
      if (!Number.isSafeInteger(row.row_index) || row.row_index < 0 || rowIds.has(row.row_index)) throw new Error('Invalid or duplicate row locator');
      rowIds.add(row.row_index);
      if (row.row_index <= header.row_index) continue;
      const cells = row.cells;
      if (!Array.isArray(cells) || cells.length !== header.cells.length || !bounded(cells[0]) || !bounded(cells[1])) {
        append({ observation_id: locator(table.table_index, row.row_index, 0), outcome: 'excluded', reason: 'invalid_row_shape', evidence: null });
        continue;
      }
      for (let column = 0; column < teeHeader.cells.length - 1; column++) {
        const cr = cells[3 + column * 2], slope = cells[4 + column * 2];
        // Both empty means no source tee observation. Never create missing tee records.
        if (![cr, slope].some(v => typeof v === 'string' && v.trim())) continue;
        const ref = locator(table.table_index, row.row_index, column + 1);
        if (!bounded(teeHeader.cells[column + 1]) || !bounded(cells[2], 100) || !bounded(cr, 100) || !bounded(slope, 100)) {
          append({ observation_id: ref, outcome: 'excluded', reason: 'invalid_cell_shape', evidence: null }); continue;
        }
        const par = integer(cells[2]);
        const matches = [...cells[1].matchAll(/\b(9|18)\s*buche\b/gi)].map(m => Number(m[1]));
        const scope = matches.length && new Set(matches).size === 1 ? matches[0] : null;
        const limits = ['native_tee_id_absent', 'native_configuration_id_absent', 'applicability_header_spans_unavailable', 'par_common_configuration'];
        if (scope === null) limits.push(matches.length ? 'ambiguous_scope' : 'scope_not_explicit');
        if (par === null || par <= 0) limits.push('par_not_numeric');
        const numericPar = par > 0 ? par : null;
        append({ observation_id: ref, outcome: 'incomplete', reason: 'incomplete_source_evidence', evidence: {
          internal_reference: ref, external_tee_id: null, external_configuration_id: null, synthetic_tee_id: null,
          club_label: cells[0], configuration_label: cells[1], tee_label: teeHeader.cells[column + 1],
          par_original: cells[2].trim() ? cells[2] : null, par_normalized: numericPar, par_state: cells[2].trim() ? 'esplicito' : 'assente',
          scope_original: cells[1] || null, scope_normalized: scope, scope_state: scope === null ? 'assente' : 'esplicito',
          applicability_original: null, applicability_normalized: null, applicability_state: 'assente',
          par_origin: cells[2].trim() ? 'comune_configurazione' : null, completeness: 'incomplete', certainty: 'limited',
          limitations: limits, transformations: ['trim_integer_par', 'explicit_scope_token_only', 'no_gender_defaults'],
          predecessor_id: null
        } });
      }
    }
  }
  if (!items.length) throw new Error('No archival observations or exclusions');
  const sourceDate = typeof raw.scraped_at === 'string' && Number.isFinite(Date.parse(raw.scraped_at)) ? new Date(raw.scraped_at).toISOString() : null;
  return { contract_version: 1, extractor_version: EXTRACTOR_VERSION, artifact: {
    source_system: 'fig', source_url: url.href, source_version: sourceDate?.slice(0, 10) ?? null,
    acquired_at: sourceDate, published_at: null, sha256: sha256(bytes), byte_size: bytes.length,
    object_path: `fig/${sha256(bytes)}.json`, content_type: 'application/json'
  }, items };
}

export function evidenceCounts(manifest) {
  return manifest.items.reduce((counts, item) => {
    counts.total++; counts[item.outcome]++; return counts;
  }, { total: 0, complete: 0, incomplete: 0, excluded: 0 });
}

export function verifyFigManifest(bytes, manifest) {
  const expected = extractFigEvidence(bytes);
  if (JSON.stringify(expected) !== JSON.stringify(manifest)) throw new Error('Manifest differs from trusted versioned extraction; regenerate and review it');
  return expected;
}
