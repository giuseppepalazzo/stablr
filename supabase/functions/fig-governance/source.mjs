// Fixed public source. Observation hashes are NOT FIG identities or matching keys.
export const FIG_URL = 'https://areariservata.federgolf.it/SlopeAndCourseRating/Index';
export const EXTRACTOR = 'fig-governance/1';
const clean = s => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();
export async function hash(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
const numeric = s => s === '' ? null : /^\d+(?:[.,]\d+)?$/.test(s) ? Number(s.replace(',', '.')) : NaN;
export async function extract(html) {
  if (typeof html !== 'string' || html.length > 3000000) throw new Error('SOURCE_INVALID');
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(m => m[0]);
  const candidates = tables.filter(t => /Circolo/i.test(t) && /Percorso/i.test(t) && /Slope/i.test(t));
  if (candidates.length !== 1) throw new Error('SOURCE_INVALID');
  const rows = [...candidates[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(m => m[0]);
  const header = rows.findIndex(r => /Circolo/i.test(r) && /Percorso/i.test(r) && /Slope/i.test(r));
  if (header < 0) throw new Error('SOURCE_INVALID');
  const observations = [];
  for (const row of rows.slice(header + 1)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1]));
    if (!cells.length) continue;
    // Any malformed data row invalidates the entire photograph. Never silently
    // discard rows and manufacture removals from a partial/changed page format.
    if (cells.length !== 17 || !cells[0] || !cells[1] || cells.some(c => c.length > 250)) throw new Error('SOURCE_INVALID');
    const values = cells.slice(2).map(numeric);
    if (!Number.isInteger(values[0]) || values[0] <= 0 || values.some(v => Number.isNaN(v))) throw new Error('SOURCE_INVALID');
    observations.push({ name: cells[0], city: null, course: cells[1], par: values[0], ratings: values.slice(1) });
  }
  if (!observations.length || observations.length > 10000) throw new Error('SOURCE_INVALID');
  const counts = new Map(), records = [];
  for (const row of observations) {
    const fingerprint = await hash(JSON.stringify(row));
    const occurrence = (counts.get(fingerprint) || 0) + 1; counts.set(fingerprint, occurrence);
    // No slug/name/row-offset to external ID conversion. This provider exposes
    // no native IDs, so every observation deliberately remains unidentified.
    records.push({ key: `${fingerprint}:${occurrence}`, source_id: null, ...row });
  }
  records.sort((a, b) => a.key.localeCompare(b.key));
  return { extractor: EXTRACTOR, source_hash: await hash(JSON.stringify(records)), records };
}
export async function fetchPhotograph(fetcher = fetch) {
  const response = await fetcher(FIG_URL, { redirect: 'error', signal: AbortSignal.timeout(25000),
    headers: { 'User-Agent': 'STABLR FIG governance (read-only)' } });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('SOURCE_UNAVAILABLE');
  if (Number(response.headers.get('content-length')) > 3000000) throw new Error('SOURCE_INVALID');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let html = '', size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
    if (size > 3000000) throw new Error('SOURCE_INVALID'); html += decoder.decode(value, { stream: true }); }
    html += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
  return extract(html);
}
