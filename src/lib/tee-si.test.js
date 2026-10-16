import { loadTeeSiContracts, resolveTeeSi } from "./tee-si";

function fixture(n = 9, repeated = false) {
  const holes = Array.from({ length: n }, (_, i) => ({ slot_id: `slot-${i}`, position: i + 1,
    occurrence: repeated && i >= 9 ? 2 : 1, live_hole_id: `hole-${repeated ? i % 9 : i}`,
    physical_hole_id: `physical-${repeated ? i % 9 : i}`, standard_si: repeated ? (i % 9) * 2 + (i >= 9 ? 2 : 1) : i + 1, si: null }));
  const tee = { id: "tee", teeKind: "route_tee", siContract: { schema_version: 1, mode: "managed", tee_kind: "route_tee",
    tee_id: "tee", parent_id: "route", configuration_id: "config", holes_count: n, holes } };
  const ctx = { parentId: "route", holesCount: n, liveHoleId: "hole-0", occurrence: 1, standardSi: 1 };
  return { tee, ctx, holes };
}
test("exact managed override precedes legacy; explicit removal uses configuration, not matrix", () => {
  const { tee, ctx, holes } = fixture();
  expect(resolveTeeSi(tee, ctx, 8)).toEqual({strokeIndex: 1, error: false});
  holes[0].si = 2;holes[1].si = 1;
  expect(resolveTeeSi(tee, ctx, 8)).toEqual({strokeIndex: 2, error: false});
  expect(resolveTeeSi({...tee, siContract: null}, ctx, 8)).toEqual({strokeIndex: 8, error: false});
  expect(resolveTeeSi(null, ctx, 8)).toEqual({strokeIndex: 8, error: false});
});
test("9×2 keeps source identity and both occurrences distinct without another tee/scope propagation", () => {
  const {tee,ctx,holes} = fixture(18,true);holes[0].si=2;holes[9].si=1;
  expect(resolveTeeSi(tee,ctx,17)).toEqual({strokeIndex:2,error:false});
  expect(resolveTeeSi(tee,{...ctx,occurrence:2,standardSi:2},18)).toEqual({strokeIndex:1,error:false});
  expect(resolveTeeSi(tee,{...ctx,holesCount:9},1).error).toBe(true);
  expect(resolveTeeSi({...tee,id:"other"},ctx,1).error).toBe(true);
});
test("9-hole odd SI set and exact combination hole IDs are supported, never normalized to 1–9", () => {
  const {tee,ctx,holes} = fixture();holes.forEach((h,i)=>{h.standard_si=i*2+1;});holes[0].si=17;holes[8].si=1;
  expect(resolveTeeSi(tee,ctx,1).strokeIndex).toBe(17);
  tee.teeKind="combination_tee";tee.siContract.tee_kind="combination_tee";
  expect(resolveTeeSi(tee,{...ctx,occurrence:null},1).strokeIndex).toBe(17);
});
test.each([
  t=>{t.siContract.holes[0].si=2;},t=>{t.siContract.holes.pop();},t=>{t.siContract.holes[1].position=1;},
  t=>{t.siContract.holes[0].si=19;},t=>{t.siContract.holes[0].si="1";},t=>{t.siContract.parent_id="wrong";},
  t=>{t.siContract.holes[0].live_hole_id="missing";},t=>{t.siContract.schema_version=2;},t=>{t.siContract={};},t=>{t.siContract.holes[0]=null;}
])("invalid/stale managed data blocks instead of falling back (%#)", mutate => {
  const {tee,ctx}=fixture();mutate(tee);expect(resolveTeeSi(tee,ctx,7)).toEqual({strokeIndex:null,error:true});
});
test("changed live standard SI blocks without rewriting historical round snapshots", () => {
  const {tee,ctx}=fixture();const snapshot=[{par:4,strokeIndex:7,distanceM:123}];const before=JSON.stringify(snapshot);
  expect(resolveTeeSi(tee,{...ctx,standardSi:9},7).error).toBe(true);expect(JSON.stringify(snapshot)).toBe(before);
});
test("projection loader uses kind and exact IDs; missing migration alone permits legacy, other errors propagate", async () => {
  const q={select:jest.fn(()=>q),eq:jest.fn(()=>q),in:jest.fn(()=>q),range:jest.fn().mockResolvedValue({data:[{tee_id:"tee",contract:{schema_version:1}}],error:null})};
  const client={from:jest.fn(()=>q)};
  expect((await loadTeeSiContracts(client,"route_tee",["tee","tee"])).get("tee")).toEqual({schema_version:1});
  expect(q.in).toHaveBeenCalledWith("tee_id",["tee"]);expect(q.eq).toHaveBeenCalledWith("tee_kind","route_tee");
  q.range.mockResolvedValue({data:null,error:{code:"PGRST205"}});expect((await loadTeeSiContracts(client,"route_tee",["tee"])).size).toBe(0);
  for(const code of ["42501","network"]){q.range.mockResolvedValue({data:null,error:{code}});await expect(loadTeeSiContracts(client,"route_tee",["tee"])).rejects.toEqual({code});}
});
