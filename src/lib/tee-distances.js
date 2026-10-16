import { loadTeeGridContracts } from "./tee-grid-loader";
export const loadTeeDistanceContracts = (client,kind,ids) => loadTeeGridContracts(client,kind,ids,"distances");

// Distance occurrence belongs to the configuration, not the order of play.
export function getRouteDistanceOccurrence(courseHoleCount, totalHoles, startHole, playIndex) {
  const configurationIndex = (Number(startHole) - 1 + playIndex) % Number(totalHoles);
  return Math.floor(configurationIndex / Number(courseHoleCount)) + 1;
}

export function readLegacyTeeDistance(distances, occurrenceIndex) {
  const value = distances[occurrenceIndex];
  if (value == null || String(value).trim() === "") return null;
  const distance = Number(value);
  return Number.isFinite(distance) ? distance : null;
}

export function resolveTeeDistance(tee,{parentId,holesCount,liveHoleId,occurrence},legacyDistance) {
  const c=tee?.distanceContract,bad=()=>({distanceM:null,error:true});
  if(c==null)return {distanceM:legacyDistance ?? null,error:false};
  if(c.schema_version!==1||c.mode!=="managed"||c.tee_id!==tee.id||c.tee_kind!==tee.teeKind||c.parent_id!==parentId
    ||c.holes_count!==Number(holesCount)||!c.configuration_id||!Array.isArray(c.holes)||c.holes.length!==Number(holesCount))return bad();
  const positions=new Set(),identities=new Set(),slots=new Set();
  for(const h of c.holes){
    if(!h||!h.slot_id||!h.live_hole_id||!Number.isInteger(h.position)||h.position<1||h.position>Number(holesCount)
      ||!Number.isInteger(h.occurrence)||h.occurrence<1||(h.distance_m!==null&&(!Number.isInteger(h.distance_m)||h.distance_m<0||h.distance_m>2147483647)))return bad();
    positions.add(h.position);identities.add(`${h.live_hole_id}:${h.occurrence}`);slots.add(h.slot_id);
  }
  if([positions.size,identities.size,slots.size].some(size=>size!==c.holes.length))return bad();
  const matches=c.holes.filter(h=>h.live_hole_id===liveHoleId&&(occurrence==null||h.occurrence===occurrence));
  // A managed null is explicitly missing, never an invitation to another tee,
  // scope, first occurrence or a legacy color/name-based fallback.
  return matches.length===1?{distanceM:matches[0].distance_m,error:false}:bad();
}
