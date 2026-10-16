import {getRouteDistanceOccurrence,readLegacyTeeDistance,resolveTeeDistance,loadTeeDistanceContracts} from "./tee-distances";
function data(n=9,repeated=false){
  const holes=Array.from({length:n},(_,i)=>({slot_id:`s${i}`,position:i+1,occurrence:repeated&&i>=9?2:1,live_hole_id:`h${repeated?i%9:i}`,distance_m:i===0?0:i===1?null:300+i}));
  const tee={id:"tee",teeKind:"route_tee",distanceContract:{schema_version:1,mode:"managed",tee_kind:"route_tee",tee_id:"tee",parent_id:"route",holes_count:n,configuration_id:"cfg",holes}};
  return {tee,ctx:{parentId:"route",holesCount:n,liveHoleId:"h0",occurrence:1},holes};
}
test.each([1, 10, 5, 18])("9×2 shotgun start %i resolves configuration occurrences without changing the played hole order", start => {
  const {tee, ctx, holes} = data(18, true);
  holes.forEach((hole, i) => { hole.distance_m = 200 + i; });
  const played = Array.from({length:18}, (_, index) => {
    const liveHoleId = `h${(start - 1 + index) % 9}`;
    const occurrence = getRouteDistanceOccurrence(9, 18, start, index);
    return {liveHoleId, occurrence, distance:resolveTeeDistance(tee, {...ctx, liveHoleId, occurrence}, 999).distanceM};
  });
  expect(played.map(h => h.liveHoleId)).toEqual(Array.from({length:18}, (_, i) => `h${(start - 1 + i) % 9}`));
  expect(played.map(h => h.distance)).toEqual(Array.from({length:18}, (_, i) => 200 + (start - 1 + i) % 18));
  expect(played.map(h => h.occurrence)).toEqual(Array.from({length:18}, (_, i) => (start - 1 + i) % 18 < 9 ? 1 : 2));
});
test.each([9,18])("independent %i-hole routes keep occurrence 1 across shotgun rotation", n => {
  const {tee, ctx} = data(n);
  for (let i = 0; i < n; i++) {
    const occurrence = getRouteDistanceOccurrence(n, n, n, i);
    expect(occurrence).toBe(1);
    const liveHoleId = `h${(n - 1 + i) % n}`;
    expect(resolveTeeDistance(tee, {...ctx, holesCount:n, liveHoleId, occurrence}, 999).error).toBe(false);
  }
});
test("legacy distances preserve zero and never borrow the first occurrence when the second is missing", () => {
  for (const missing of [null, undefined, ""]) {
    expect(readLegacyTeeDistance([320, missing], 1)).toBeNull();
  }
  expect(readLegacyTeeDistance([320], 1)).toBeNull();
  expect(readLegacyTeeDistance([0, 0], 0)).toBe(0);
  expect(readLegacyTeeDistance([320, "0"], 1)).toBe(0);
  expect(readLegacyTeeDistance([320, "340"], 1)).toBe(340);
  for (const start of [1, 10]) {
    const index = getRouteDistanceOccurrence(9, 18, start, 0) - 1;
    expect(readLegacyTeeDistance([0, null], index)).toBe(start === 1 ? 0 : null);
  }
});
test("published combinations keep exact live hole identity when rotated, and managed values outrank legacy", () => {
  const {tee, ctx, holes} = data(18);
  tee.teeKind = tee.distanceContract.tee_kind = "combination_tee";
  for (const start of [1, 10]) {
    for (let i = 0; i < 18; i++) {
      const hole = holes[(start - 1 + i) % 18];
      expect(resolveTeeDistance(tee, {...ctx, holesCount:18, liveHoleId:hole.live_hole_id, occurrence:null}, 999))
        .toEqual({distanceM:hole.distance_m, error:false});
    }
  }
});
test("published zero/missing are preserved; managed missing never revives legacy, absent projection retains legacy",()=>{
  const {tee,ctx}=data();expect(resolveTeeDistance(tee,ctx,150)).toEqual({distanceM:0,error:false});
  expect(resolveTeeDistance(tee,{...ctx,liveHoleId:"h1"},150)).toEqual({distanceM:null,error:false});
  expect(resolveTeeDistance({...tee,distanceContract:null},ctx,150).distanceM).toBe(150);expect(resolveTeeDistance(null,ctx,0).distanceM).toBe(0);
});
test("9×2 and multi9 identify exact hole occurrence; no cross-tee/scope propagation or first-round fallback",()=>{
  const {tee,ctx}=data(18,true);expect(resolveTeeDistance(tee,{...ctx,occurrence:2},150).distanceM).toBe(309);
  expect(resolveTeeDistance(tee,{...ctx,holesCount:9},150).error).toBe(true);expect(resolveTeeDistance({...tee,id:"other"},ctx,150).error).toBe(true);
  tee.teeKind="combination_tee";tee.distanceContract.tee_kind="combination_tee";
  expect(resolveTeeDistance(tee,{...ctx,occurrence:null},150).error).toBe(true); // shared ID is ambiguous without occurrence
  const c=data(18);c.tee.teeKind="combination_tee";c.tee.distanceContract.tee_kind="combination_tee";
  expect(resolveTeeDistance(c.tee,{...c.ctx,occurrence:null},null).distanceM).toBe(0);
});
test.each([
  t=>{t.distanceContract.holes.pop();},t=>{t.distanceContract.holes[0]=null;},t=>{t.distanceContract.holes[0].distance_m=-1;},
  t=>{t.distanceContract.holes[0].distance_m=1.5;},t=>{t.distanceContract.parent_id="wrong";},t=>{t.distanceContract.holes[0].live_hole_id="missing";},
  t=>{t.distanceContract.holes[1].slot_id="s0";}
])("invalid contract yields unavailable distance, not a wrong legacy value or a change to game data (%#)",mutate=>{
  const {tee,ctx}=data(),snapshot=[{par:4,strokeIndex:7,courseRating:36,slopeRating:113,distanceM:150}],before=JSON.stringify(snapshot);
  mutate(tee);expect(resolveTeeDistance(tee,ctx,150)).toEqual({distanceM:null,error:true});expect(JSON.stringify(snapshot)).toBe(before);
});
test("loader reads only exact published distance projection; permission/network failures never become a legacy fallback",async()=>{
  const q={select:jest.fn(()=>q),eq:jest.fn(()=>q),in:jest.fn(()=>q),range:jest.fn().mockResolvedValue({data:[],error:null})},client={from:jest.fn(()=>q)};
  await loadTeeDistanceContracts(client,"route_tee",["tee"]);expect(client.from).toHaveBeenCalledWith("catalog_tee_distances");expect(q.in).toHaveBeenCalledWith("tee_id",["tee"]);
  q.range.mockResolvedValue({data:null,error:{code:"42501"}});await expect(loadTeeDistanceContracts(client,"route_tee",["tee"])).rejects.toEqual({code:"42501"});
});
