import { supabase } from "../lib/supabase";

export const initialTeeSiFields = context => context.current ? {
  mode: "managed", holes: context.current.holes.map(row => ({ slot_id: row.slot_id, si: row.si }))
} : { mode: "legacy", holes: context.holes.map(row => ({ slot_id: row.slot_id, si: null })) };
export function validTeeSi(fields, context) {
  return !!fields && !!context && fields.mode === "managed" && teeSiValidation(fields, context).blockers.length === 0;
}
export function cycleTeeSi(value, allowed, direction) {
  const scale = [...new Set(allowed)].sort((a,b) => a-b), index = scale.indexOf(value);
  if (!scale.length) return null;
  return scale[index < 0 ? (direction > 0 ? 0 : scale.length-1) : (index + direction + scale.length) % scale.length];
}
export function teeSiValidation(fields, context) {
  const blockers = [], warnings = [];
  const sorted = items => [...items].sort((a, b) => a - b).join(",");
  const holes = context?.holes, scale = context?.allowed_si, rows = fields?.holes;
  const count = context?.tee?.holes_count ?? holes?.length;
  if (![9,18].includes(count) || !Array.isArray(holes) || holes.length !== count || !Array.isArray(scale)
    || scale.length !== count || new Set(scale).size !== count || !scale.every(n => Number.isInteger(n) && n >= 1 && n <= 18)
    || !holes.every(h => h && typeof h === "object")
    || new Set(holes.map(h => h.slot_id)).size !== count || new Set(holes.map(h => h.position)).size !== count
    || !holes.every(h => Number.isInteger(h.position) && h.position >= 1 && h.position <= count)
    || !Array.isArray(rows) || rows.length !== count || !rows.every(h => h && typeof h === "object") || new Set(rows.map(h => h.slot_id)).size !== count
    || rows.some(h => !holes.some(slot => slot.slot_id === h.slot_id))) {
    return { blockers: ["Griglia, scala o collegamenti SI incompleti: pubblicazione bloccata."], warnings, effective: [] };
  }
  const ordered = [...holes].sort((a,b) => a.position-b.position);
  if (ordered.some(h => !Number.isInteger(h.standard_si) || !scale.includes(h.standard_si))
    || sorted(ordered.map(h => h.standard_si)) !== sorted(scale)) blockers.push("SI della configurazione mancanti o incoerenti: pubblicazione bloccata.");
  const effective = ordered.map(h => {
    const row = rows.find(r => r.slot_id === h.slot_id);
    return row.si === null ? h.standard_si : row.si;
  });
  const duplicates = [...new Set(effective.filter((n,i) => Number.isInteger(n) && effective.indexOf(n) !== i))];
  const missing = scale.filter(n => !effective.includes(n));
  if (effective.some(n => !Number.isInteger(n) || !scale.includes(n))) blockers.push("SI effettivi mancanti o fuori scala: pubblicazione bloccata.");
  if (duplicates.length) blockers.push(`SI effettivi non univoci. Duplicati: ${duplicates.join(", ")}.`);
  if (missing.length) blockers.push(`SI mancanti nella distribuzione effettiva: ${missing.join(", ")}.`);
  if (!blockers.length && fields.mode === "managed") {
    // A valid permutation may intentionally move ranks between halves. This is
    // an editorial warning relative to the actual base, not a universal SI rule.
    if (count === 18 && sorted(effective.slice(0,9)) !== sorted(ordered.slice(0,9).map(h => h.standard_si))) {
      warnings.push("Distribuzione SI tra prime e seconde nove diversa dalla configurazione: verifica e conferma la scelta editoriale.");
    }
    if (context.legacy_present && !context.current) warnings.push("Il fallback legacy non attribuito sarà sostituito per questo tee e ambito. Il valore Prima non è verificabile: conferma la sostituzione.");
  }
  return { blockers, warnings, effective };
}
export function createTeeSiService(client) {
  return async (kind, teeId, action, params = {}) => {
    const { data, error } = await client.rpc("admin_tee_si", { p_kind: kind, p_tee_id: teeId, p_action: action, ...params });
    if (error) throw error;
    if (!data || (!data.context && !data.draft && !data.version_id)) throw new Error("Invalid SI response");
    return data;
  };
}
export const teeSiService = createTeeSiService(supabase);
export function teeSiError(error) {
  if (error?.code === "40001") return "La bozza o la base sono cambiate. Riapri l’editor; nessun dato è stato pubblicato.";
  if (error?.code === "55P03") return "Dati temporaneamente occupati. Riprova: nessuna pubblicazione parziale.";
  if (error?.code === "42501") return "Operazione non autorizzata per questa bozza.";
  if (["22023", "23514"].includes(error?.code)) return "Verifica collegamenti, SI e conferma: nessun dato è stato pubblicato.";
  return "Impossibile caricare o salvare gli override SI. Riprova.";
}
