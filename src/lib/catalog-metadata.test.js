import {loadCatalogMetadata,publishedCombinationOrder} from "./catalog-metadata";

function clientFor(reply) {
  const calls=[];
  return {calls,from:jest.fn(table=>{const call={table};calls.push(call);const q={
    select:jest.fn(columns=>{call.columns=columns;return q;}),eq:jest.fn((key,value)=>{call.kind=value;return q;}),
    in:jest.fn((key,ids)=>{call.ids=ids;return q;}),order:jest.fn(()=>Promise.resolve(reply(call)))};return q;})};
}
test("reads only published public columns by exact entity type and IDs, chunked below API limits",async()=>{
  const client=clientFor(c=>({data:c.ids.map(id=>({entity_type:c.kind,live_entity_id:id,aliases:["Alias"],notes:null,display_order:0})),error:null}));
  const ids=Array.from({length:101},(_,i)=>`course-${i}`),data=await loadCatalogMetadata(client,[...ids,ids[0]],["comb-1"]);
  expect(data.courses.size).toBe(101);expect(data.combinations.size).toBe(1);expect(client.calls).toHaveLength(4);
  for(const c of client.calls){expect(c.table).toBe("catalog_editor_metadata");expect(c.columns).toBe("entity_type,live_entity_id,aliases,notes,display_order");expect(c.ids.length).toBeLessThanOrEqual(50);}
});
test("missing additive migration is compatible; permissions/network errors are never silently dropped",async()=>{
  for(const code of ["42P01","PGRST205"]){const data=await loadCatalogMetadata(clientFor(()=>({data:null,error:{code}})),["c"],[]);expect(data.courses.size).toBe(0);}
  await expect(loadCatalogMetadata(clientFor(()=>({data:null,error:{code:"42501"}})),["c"],[])).rejects.toEqual({code:"42501"});
  await expect(loadCatalogMetadata(clientFor(()=>({data:[{entity_type:"route_combination",live_entity_id:"c",aliases:[]}],error:null})),["c"],[])).rejects.toThrow("identity");
});
test("curated order preserves zero; absent curated order retains legacy source fallback",()=>{
  expect(publishedCombinationOrder({display_order:0},12)).toBe(0);
  expect(publishedCombinationOrder({display_order:4},12)).toBe(4);
  expect(publishedCombinationOrder({display_order:null},"3")).toBe(3);
  expect(publishedCombinationOrder(null,null)).toBeNull();
  for(const invalid of [1.5,2147483648,"invalid"])expect(publishedCombinationOrder({display_order:invalid},7)).toBeNull();
});
