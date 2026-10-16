import { cycleTeeSi, teeSiValidation, validTeeSi } from "./tee-si-data";
const make = scale => {
  const context={tee:{holes_count:scale.length},allowed_si:scale,holes:scale.map((si,i)=>({slot_id:`s${i}`,position:i+1,standard_si:si}))};
  const fields={mode:"managed",holes:context.holes.map(h=>({slot_id:h.slot_id,si:null}))};
  return {context,fields};
};
test.each([
  [1,3,5,7,9,11,13,15,17],[2,4,6,8,10,12,14,16,18],Array.from({length:18},(_,i)=>i+1)
].map(scale=>[scale]))("circular SI steps use the actual scale, both endpoints and only allowed values (%#)",scale=>{
  expect(cycleTeeSi(scale[scale.length-1],scale,1)).toBe(scale[0]);
  expect(cycleTeeSi(scale[0],scale,-1)).toBe(scale[scale.length-1]);
  for(const value of scale)expect(scale).toContain(cycleTeeSi(value,scale,1));
});
test("empty override is inherited, never missing; duplicates and absent/out-of-scale/unknown slots remain blocking",()=>{
  const {fields,context}=make([1,3,5,7,9,11,13,15,17]);
  expect(validTeeSi(fields,context)).toBe(true);expect(teeSiValidation(fields,context).warnings).toEqual([]);
  const duplicate={...fields,holes:fields.holes.map((h,i)=>({...h,si:i===0?3:null}))};
  expect(teeSiValidation(duplicate,context).blockers.join(" ")).toMatch(/Duplicati: 3.*mancanti.*1/);
  for(const value of [0,2,19,1.5,undefined]){
    const f={...fields,holes:fields.holes.map((h,i)=>i===0?{...h,si:value}:h)};
    expect(validTeeSi(f,context)).toBe(false);expect(teeSiValidation(f,context).blockers.length).toBeGreaterThan(0);
  }
  expect(teeSiValidation({...fields,holes:fields.holes.slice(1)},context).blockers.join()).toMatch(/incompleti/);
  expect(validTeeSi(fields,{...context,holes:context.holes.map((h,i)=>({...h,standard_si:i===0?null:h.standard_si}))})).toBe(false);
});
test("cross-half SI distribution is a warning, not a forbidden permutation; no universal odd/even assumption",()=>{
  const scale=Array.from({length:18},(_,i)=>i+1),{fields,context}=make(scale);
  const swap=(a,b)=>({...fields,holes:fields.holes.map((h,i)=>({...h,si:i===a?scale[b]:i===b?scale[a]:null}))});
  expect(teeSiValidation(swap(0,1),context).warnings).toEqual([]);
  const result=teeSiValidation(swap(0,9),context);expect(result.blockers).toEqual([]);expect(result.warnings.join()).toMatch(/Distribuzione SI/);
  expect(validTeeSi(swap(0,9),context)).toBe(true);
  const actual={...context,holes:context.holes.map((h,i)=>({...h,standard_si:(i%9)*2+(i<9?1:2)}))};
  expect(teeSiValidation(fields,actual).warnings).toEqual([]);
});
test("unattributed legacy replacement is an explicit warning only, never guessed or silently migrated",()=>{
  const {fields,context}=make([1,3,5,7,9,11,13,15,17]);
  const result=teeSiValidation(fields,{...context,legacy_present:true});expect(result.blockers).toEqual([]);expect(result.warnings.join()).toMatch(/legacy non attribuito/);
  expect(teeSiValidation(fields,{...context,legacy_present:true,current:{mode:"managed"}}).warnings).toEqual([]);
});
