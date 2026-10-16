// Published editorial values only: exact kind/UUID, no drafts, authors or guessing.
export async function loadCatalogMetadata(client, courseIds, combinationIds) {
  const result={courses:new Map(),combinations:new Map()};
  for(const [kind,ids,map] of [["route",courseIds,result.courses],["route_combination",combinationIds,result.combinations]]){
    const unique=[...new Set((ids||[]).filter(Boolean))];
    for(let i=0;i<unique.length;i+=50){
      const chunk=unique.slice(i,i+50);
      // The composite primary key guarantees at most 50 rows per request.
      const {data,error}=await client.from("catalog_editor_metadata").select("entity_type,live_entity_id,aliases,notes,display_order")
        .eq("entity_type",kind).in("live_entity_id",chunk).order("live_entity_id");
      if(error){if(["42P01","PGRST205"].includes(error.code))return {courses:new Map(),combinations:new Map()};throw error;}
      for(const row of data||[]){
        if(row.entity_type!==kind||!chunk.includes(row.live_entity_id)||!Array.isArray(row.aliases))throw new Error("Invalid published metadata identity");
        map.set(row.live_entity_id,row);
      }
    }
  }
  return result;
}
export function publishedCombinationOrder(metadata,legacy) {
  const raw=metadata?.display_order??legacy;
  if(raw==null||raw==="")return null;
  const value=Number(raw);return Number.isInteger(value)&&value>=-2147483648&&value<=2147483647?value:null;
}
