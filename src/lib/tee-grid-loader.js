// Fixed published projections only; never a client-selected RPC or table proxy.
export async function loadTeeGridContracts(client, kind, ids, metric) {
  const table = {si:"catalog_tee_si",distances:"catalog_tee_distances"}[metric];
  if(!table || !["route_tee","combination_tee"].includes(kind))throw new Error("Unsupported tee grid");
  const result = new Map(), unique = [...new Set(ids.filter(Boolean))];
  for(let offset=0;offset<unique.length;offset+=50)for(let page=0;;page+=1000){
    const {data,error}=await client.from(table).select("tee_kind,tee_id,contract").eq("tee_kind",kind)
      .in("tee_id",unique.slice(offset,offset+50)).range(page,page+999);
    if(error){
      // Atomic migration not installed yet; no publisher could have run.
      // Auth/network errors are NEVER interpreted as an empty projection.
      if(["42P01","PGRST205"].includes(error.code))return new Map();
      throw error;
    }
    for(const row of data||[])result.set(row.tee_id,row.contract);
    if((data||[]).length<1000)break;
  }
  return result;
}
