import { supabase } from "../lib/supabase";
import { createTeeGridService } from "./tee-si-data";
export const MAX_DISTANCE_M = 2147483647; // int32 contract, not an invented golf limit.
export const teeDistanceService = createTeeGridService(supabase,"distances");
export const validDistance = value => value === null || (Number.isInteger(value) && value >= 0 && value <= MAX_DISTANCE_M);
export const formatMetres = value => value == null ? "—" : `${value} m`;
export function distanceTotals(rows) {
  const values=rows.map(row=>row.distance_m),known=values.filter(v=>v!==null && validDistance(v));
  const sum=items=>items.length && items.every(v=>v!==null && validDistance(v)) ? items.reduce((a,b)=>a+b,0) : null;
  return {holes_count:rows.length,known_count:known.length,known_sum_m:known.reduce((a,b)=>a+b,0),
    total_m:sum(values),front_m:values.length>=9?sum(values.slice(0,9)):null,back_m:values.length===18?sum(values.slice(9)):null};
}
export function teeDistanceValidation(fields,context) {
  const rows=fields?.holes,slots=context?.holes,n=context?.tee?.holes_count,blockers=[];
  if(![9,18].includes(n)||!Array.isArray(rows)||!Array.isArray(slots)||rows.length!==n||slots.length!==n
    ||!rows.every(h=>h && typeof h==='object')||new Set(rows.map(h=>h.slot_id)).size!==n
    ||rows.some(h=>!slots.some(s=>s.slot_id===h.slot_id))||new Set(slots.map(h=>h.position)).size!==n) {
    blockers.push("Griglia o collegamenti distanze incompleti: pubblicazione bloccata.");
  }else if(rows.some(h=>!validDistance(h.distance_m)))blockers.push("Distanze in metri interi da 0 a 2147483647, oppure mancanti (—).");
  return {blockers,warnings:[]}; // Completeness/zero/legacy warnings come from the server preview.
}
export function parseDistanceBatch(text,slots) {
  const lines=text.replace(/\r\n/g,"\n").replace(/\n$/," ").split(/[\n\t]/).map(v=>v.trim());
  if(lines.length!==slots.length)throw new Error(`Inserisci esattamente ${slots.length} celle, una per buca nell’ordine mostrato.`);
  return {mode:"managed",holes:lines.map((value,i)=>{
    const number=["","—","-"].includes(value)?null:/^(0|[1-9]\d*)$/.test(value)?Number(value):NaN;
    if(!validDistance(number))throw new Error(`Buca ${i+1}: distanza non valida. Usa metri interi non negativi o —.`);
    return {slot_id:slots[i].slot_id,distance_m:number};
  })};
}
