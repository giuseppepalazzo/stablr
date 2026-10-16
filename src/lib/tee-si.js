import { loadTeeGridContracts } from "./tee-grid-loader";
// New exact-ID contract takes precedence only after an explicit publication.
// Legacy matrices are never matched or migrated here.
export function resolveTeeSi(tee, { parentId, holesCount, liveHoleId, occurrence, standardSi }, legacySi) {
  const contract = tee?.siContract;
  if (contract == null) return { strokeIndex: legacySi, error: false };
  const bad = () => ({ strokeIndex: null, error: true });
  const integer = value => Number.isInteger(value) && value >= 1 && value <= 18;
  if (contract.schema_version !== 1 || contract.mode !== "managed" || contract.tee_id !== tee.id
    || contract.parent_id !== parentId || contract.holes_count !== Number(holesCount)
    || contract.tee_kind !== tee.teeKind || !contract.configuration_id || !Array.isArray(contract.holes)
    || contract.holes.length !== Number(holesCount)) return bad();
  const rows = contract.holes, positions = new Set(), identities = new Set(), standard = [], effective = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || typeof row.slot_id !== "string" || !row.slot_id
      || typeof row.live_hole_id !== "string" || !row.live_hole_id || !Number.isInteger(row.position) || row.position < 1 || row.position > Number(holesCount)
      || !Number.isInteger(row.occurrence) || row.occurrence < 1 || !integer(row.standard_si)
      || (row.si !== null && !integer(row.si))) return bad();
    positions.add(row.position); identities.add(`${row.live_hole_id}:${row.occurrence}`);
    standard.push(row.standard_si);effective.push(row.si ?? row.standard_si);
  }
  const sorted = values => [...values].sort((a, b) => a - b).join(",");
  if (positions.size !== rows.length || identities.size !== rows.length || new Set(rows.map(row => row.slot_id)).size !== rows.length
    || new Set(standard).size !== rows.length || new Set(effective).size !== rows.length || sorted(standard) !== sorted(effective)) return bad();
  const matches = rows.filter(row => row.live_hole_id === liveHoleId && (occurrence == null || row.occurrence === occurrence));
  if (matches.length !== 1 || matches[0].standard_si !== Number(standardSi)) return bad();
  // Explicit null means configuration SI, not "fall back to a legacy matrix".
  return { strokeIndex: matches[0].si ?? matches[0].standard_si, error: false };
}

export async function loadTeeSiContracts(client, kind, ids) {
  return loadTeeGridContracts(client,kind,ids,"si");
}
