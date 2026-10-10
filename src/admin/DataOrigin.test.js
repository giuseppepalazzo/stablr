import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import DataOrigin from "./DataOrigin";
import StructureReview from "./StructureReview";
import { analyseOrigin, originTargets, validateOriginGraph } from "./data-origin";
import { createStructureReviewService } from "./structure-review-data";
// This existing fixture was captured with GET only. It is never a runtime source.
import parco from "../../scripts/tests/fixtures/parco-de-medici-multi9-preview.json";

const stamp = "2026-10-09T08:00:00+00:00";
const metadata = { revision: 2, review_status: "verified", source_system: "stablr", created_at: stamp, updated_at: stamp };
const empty = (name) => ({ contract_version: 2, read_only: true, publication: "not_assessed", read_at: stamp, club: { id: "club", name }, structures: [], physical_holes: [], physical_links: [], configurations: [], configuration_holes: [], components: [], tee_overrides: [], courses: [], course_holes: [], combinations: [], combination_holes: [], route_tees: [], combination_tees: [], drafts: [] });
const clone = (x) => JSON.parse(JSON.stringify(x));
const courses = (g, name, par, si) => {
  const r = { id: "course-" + g.courses.length, club_id: g.club.id, name, holes_count: par.length, total_par: par.reduce((n,p)=>n+p,0), is_active: true, source_system: "gesgolf", tee_matrix: null, created_at: stamp, updated_at: stamp };
  g.courses.push(r);
  g.course_holes.push(...par.map((p,i)=>({ id: `${r.id}-hole-${i+1}`, route_id: r.id, physical_hole_number: i+1, par: p, stroke_index: si[i], created_at: stamp, updated_at: stamp })));
  return r;
};
const linkPhysical = (g, r) => {
  const link = { ...metadata, id: "link-"+r.id, club_id: g.club.id, structure_id: "structure", course_id: r.id, holes_count: r.holes_count, source_state: "matched" };
  g.physical_links.push(link);
  g.physical_holes.push(...g.course_holes.filter(h=>h.route_id===r.id).map(h=>({ ...metadata, id: "physical-"+h.id, club_id:g.club.id,structure_id:"structure",physical_number:h.physical_hole_number,label:`Buca ${h.physical_hole_number}`,base_par:h.par,source_course_link_id:link.id,source_route_hole_id:h.id,source_position:h.physical_hole_number })));
  return link;
};
const register = (g, r, count, kind, parent = null) => {
  const c = { ...metadata,id:"config-"+g.configurations.length,club_id:g.club.id,structure_id:"structure",label:r.name+` · ${count} ${kind}`,holes_count:count,relationship_kind:parent?"derived":"autonomous",parent_configuration_id:parent?.id??null,parent_configuration_revision:parent?.revision??null,derivation_rule:parent?"repeat_same_9_si_base_then_plus_1_cap_18":null,legacy_course_route_id:r.id,legacy_combination_id:null,registration_kind:kind,source_state:"matched",tee_state:"not_recorded" };
  g.configurations.push(c);
  for(let i=0;i<count;i++) {
    const h=g.course_holes.find(h=>h.route_id===r.id&&h.physical_hole_number===i%r.holes_count+1),p=g.physical_holes.find(p=>p.source_route_hole_id===h.id);
    g.configuration_holes.push({...metadata,id:`slot-${c.id}-${i}`,configuration_id:c.id,club_id:g.club.id,structure_id:"structure",physical_hole_id:p.id,position:i+1,occurrence:1+Math.floor(i/r.holes_count),par_mode:"inherited",par_override:null,stroke_index:i>=r.holes_count?Math.min(18,h.stroke_index+1):h.stroke_index,legacy_route_hole_id:h.id,legacy_combination_hole_id:null});
  }
  return c;
};
const mare = () => {
  const g=empty("Mare di Roma");g.structures=[{...metadata,id:"structure",club_id:g.club.id,label:g.club.name,classification:"fisico_9"}];
  const r=courses(g,"Percorso",[4,4,4,4,4,4,3,4,4],[11,17,1,7,9,5,3,13,15]);linkPhysical(g,r);
  const nine=register(g,r,9,"autonomous_9");register(g,r,18,"repeated_18",nine);
  g.route_tees.push({id:"tee",route_id:r.id,tee_name:"Arancio",tee_color:"arancio",holes_count:18,gender:"women",par_total:70,course_rating:70,slope_rating:113,is_active:true,payload_present:false,created_at:stamp,updated_at:stamp});
  return g;
};
const fiuggi = () => {
  const g=empty("Fiuggi 1928");g.structures=[{...metadata,id:"structure",club_id:g.club.id,label:g.club.name,classification:"fisico_18"}];
  const pars=[5,4,3,4,3,4,4,5,3,5,3,4,3,4,5,3,4,4],si=[9,17,15,3,13,1,5,11,7,12,2,18,4,8,6,16,14,10];
  const r=courses(g,"18 Buche",pars,si);linkPhysical(g,r);register(g,r,18,"autonomous_18");
  courses(g,"Prime Nove",pars.slice(0,9),si.slice(0,9));courses(g,"Seconde Nove",pars.slice(9),si.slice(9));return g;
};
const multi = () => {
  const g=empty(parco.club.name);g.club={id:parco.club.id,name:parco.club.name};
  const minimized=(rows)=>clone(rows).map(({source_payload,source_external_id,...row})=>row);
  g.courses=minimized(parco.routes);g.course_holes=clone(parco.holes);g.combinations=minimized(parco.combinations);g.combination_holes=clone(parco.slots);
  g.structures=[{...metadata,id:"structure",club_id:g.club.id,label:g.club.name,classification:"multi_9"}];
  const parents=new Map();
  for(const r of g.courses.filter(r=>r.holes_count===9)) {linkPhysical(g,r);parents.set(r.id,register(g,r,9,"multi9_9"));}
  for(const r of g.combinations) {
    const c={...metadata,id:"config-"+r.id,club_id:g.club.id,structure_id:"structure",label:r.name,holes_count:18,relationship_kind:"derived",parent_configuration_id:null,parent_configuration_revision:null,derivation_rule:"multi9_exact_components",legacy_course_route_id:null,legacy_combination_id:r.id,registration_kind:"multi9_18",source_state:"matched",tee_state:"not_recorded"};
    g.configurations.push(c);
    [r.front_route_id,r.back_route_id].forEach((rid,i)=> {const l=g.physical_links.find(l=>l.course_id===rid),p=parents.get(rid);g.components.push({...metadata,id:`component-${c.id}-${i}`,configuration_id:c.id,component_position:i+1,physical_course_link_id:l.id,physical_course_link_revision:l.revision,parent_configuration_id:p.id,parent_configuration_revision:p.revision});});
    for(const h of g.combination_holes.filter(h=>h.route_combination_id===r.id)) {
      const physical=g.physical_holes.find(p=>g.course_holes.find(rh=>rh.id===p.source_route_hole_id&&rh.route_id===h.route_id&&rh.physical_hole_number===h.physical_hole_number));
      g.configuration_holes.push({...metadata,id:"slot-"+h.id,configuration_id:c.id,club_id:g.club.id,structure_id:"structure",physical_hole_id:physical.id,position:h.round_hole_number,occurrence:1,par_mode:"inherited",par_override:null,stroke_index:h.stroke_index,legacy_route_hole_id:null,legacy_combination_hole_id:h.id});
    }
  }
  return g;
};
const start = async (g) => {
  const service={originGraph:jest.fn().mockResolvedValue(g)};render(<DataOrigin clubId={g.club.id} service={service}/>);
  expect(service.originGraph).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Esplora impatto e origine"}));
  await screen.findByLabelText("Oggetto da esplorare");return service;
};
const select=(type,id)=>fireEvent.change(screen.getByLabelText("Oggetto da esplorare"),{target:{value:`${type}:${id}`}});

test("Mare read-only explorer shows 9×2 occurrences, inherited Par and own SI, with no workflow action",async()=>{
  const g=mare(),service=await start(g);select("physical_hole",g.physical_holes[0].id);
  expect(screen.getByText("SI non appartiene alla buca fisica: è mostrato per ciascuna configurazione.")).toBeInTheDocument();
  const tables=screen.getAllByRole("table");expect(tables).toHaveLength(2);expect(within(tables[0]).getAllByRole("row")).toHaveLength(2);expect(within(tables[1]).getAllByRole("row")).toHaveLength(3);
  expect(tables[1]).toHaveTextContent("Ereditato");expect(screen.getAllByText("Verificato registrato").length).toBeGreaterThan(0);
  expect(screen.getByText("Non valutata")).toBeInTheDocument();expect(screen.queryByRole("button",{name:/Salva|Pubblica|Abbandona|Conferma|Modifica/})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:g.configurations[1].label}));expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(screen.getAllByRole("row")).toHaveLength(7);
  fireEvent.click(screen.getByRole("button", { name: "Mostra tutto · Origine e valori buche" }));
  expect(screen.getAllByRole("row")).toHaveLength(19);
  fireEvent.click(within(screen.getByRole("table")).getAllByRole("button")[0]);expect(screen.getByText("Origine della buca fisica")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Copertura del club"}));expect(service.originGraph).toHaveBeenCalledTimes(1);
});

test("Fiuggi keeps complete live front/back nines uncovered, without deducing links or SI",async()=>{
  const g=fiuggi();await start(g);expect(screen.getAllByText("Non certificato")).toHaveLength(2);
  expect(screen.getByText("Prime Nove")).toBeInTheDocument();expect(screen.getByText("Seconde Nove")).toBeInTheDocument();
  const a=analyseOrigin(g);expect(a.coverage_complete).toBe(false);expect(a.uncovered_live.every(r=>r.cardinality_complete)).toBe(true);
  expect(a.configurations[0].total_par).toBe(70);expect(a.configurations[0].issues).toEqual([]);
});

test("Parco displays two exact multi9 parents, independent SI and distinct physical identities",async()=>{
  const g=multi();await start(g);const c=g.configurations.find(c=>c.registration_kind==="multi9_18");select("configuration",c.id);
  const component=screen.getByRole("table",{name:`Componenti ${c.label}`});expect(within(component).getAllByRole("row")).toHaveLength(3);
  const a=analyseOrigin(g,{type:"configuration",id:c.id});expect(a.configurations[0].components.every(p=>p.valid)).toBe(true);expect(a.configurations[0].issues).toEqual([]);
  expect(g.physical_holes.filter(h=>h.physical_number===1)).toHaveLength(3);expect(analyseOrigin(g).uncovered_live).toHaveLength(3);
  const holesTable = screen.getByRole("table",{name:`Origine e valori ${c.label}`});
  fireEvent.click(within(holesTable).getByRole("button", { name: "Mostra tutto · Origine e valori buche" }));
  expect(within(holesTable).getAllByRole("row")).toHaveLength(19);
});

test("tee normalized overrides are joined by foreign keys, raw matrices never by tee name or color",async()=>{
  const g=mare(),c=g.configurations[1],s=g.configuration_holes.find(s=>s.configuration_id===c.id);
  g.tee_overrides=[{...metadata,id:"override",configuration_id:c.id,configuration_hole_id:s.id,route_tee_id:"tee",combination_tee_id:null,par_override:5,stroke_index_override:17}];
  g.courses[0].tee_matrix={present:true,source:"official_club_site",physical_hole_count:9,tees:[{source_key:"orange",holes:[{physical_hole_number:1,par:3,stroke_indexes:[2]}]}]};
  await start(g);select("route_tee","tee");expect(screen.getByText("Arancio",{selector:"h3"})).toBeInTheDocument();expect(screen.getByText("women")).toBeInTheDocument();
  expect(screen.getByText(/payload read-only, senza assegnazione/)).toBeInTheDocument();
  const a=analyseOrigin(g,{type:"route_tee",id:"tee"});expect(a.overrides[0].explicit_link).toBe(true);expect(a.overrides[0].foundation_par).toBe(5);expect(a.overrides[0].foundation_si).toBe(17);
  expect(a.matrices[0].association_verified).toBe(false);expect(a.configurations[0].slots[0].effective_par).toBe(4);expect(a.coverage_complete).toBe(false);
  expect(screen.getByText(/Valori della fondazione, non override attivati/)).toBeInTheDocument();
});

test("missing/ambiguous relationships do not become no impact, even with complete cardinality",async()=>{
  const g=mare();g.physical_links=[];await start(g);select("configuration",g.configurations[0].id);
  const a=analyseOrigin(g,{type:"configuration",id:g.configurations[0].id});expect(a.configurations[0].cardinality_complete).toBe(true);expect(a.configurations[0].linkage_verified).toBe(false);expect(a.coverage_complete).toBe(false);
  expect(screen.getAllByText("Copertura incompleta")).toHaveLength(6);
  fireEvent.click(screen.getByRole("button", { name: "Mostra tutto · Origine e valori buche" }));
  expect(screen.getAllByText("Copertura incompleta")).toHaveLength(9);
  const emptyGraph=empty("Non classificato");expect(analyseOrigin(emptyGraph).issues).toContain("impact_not_certified");
  g.configurations=[];g.configuration_holes=[];expect(analyseOrigin(g,{type:"physical_hole",id:g.physical_holes[0].id}).issues).toContain("impact_not_certified");
});

test("explicit Par override remains explicit even when equal to base; SI differences alone are not anomalies",()=>{
  const g=fiuggi(),s=g.configuration_holes[0];s.par_mode="override";s.par_override=g.physical_holes[0].base_par;
  const a=analyseOrigin(g);expect(a.configurations[0].slots[0].par_mode).toBe("override");expect(a.configurations[0].slots[0].effective_par).toBe(5);expect(a.configurations[0].issues).toEqual([]);
});

test("pertinent drafts consume only server summaries, never snapshots; stale base remains a read-only diagnosis",async()=>{
  const g=mare(),r=g.courses[0];
  g.drafts=[{draft_id:"draft",entity_type:"route_holes_grid",live_entity_id:r.id,revision:3,workflow_status:"draft",has_changes:false,base_status:"checked_fields",updated_at:stamp,is_owner:false,author:"other_admin"}];
  let a=analyseOrigin(g);expect(a.drafts[0].has_changes).toBe(false);expect(a.drafts[0].base_status).toBe("checked_fields");
  g.drafts[0].base_status="changed";a=analyseOrigin(g);expect(a.drafts[0].base_status).toBe("changed");expect(a.issues).toContain("stale_draft");
  const saved=clone(g);await start(g);expect(screen.getByText("Altro Admin")).toBeInTheDocument();expect(screen.getByText("Divergente dal live")).toBeInTheDocument();expect(g).toEqual(saved);
});

test("stale parent revisions or multi9 components remain incomplete coverage",()=>{
  const g=multi(),c=g.configurations.find(c=>c.registration_kind==="multi9_18");g.components.find(p=>p.configuration_id===c.id).parent_configuration_revision=999;
  const a=analyseOrigin(g,{type:"configuration",id:c.id});expect(a.configurations[0].linkage_verified).toBe(false);expect(a.issues).toContain("components_incomplete");
  const m=mare();m.configurations[1].parent_configuration_revision=999;expect(analyseOrigin(m).coverage_complete).toBe(false);
});

test("duplicate declared live associations and duplicate exact references are incomplete, never selected silently",()=>{
  const g=mare(),c=clone(g.configurations[0]);c.id="ambiguous-config";c.label="Seconda dichiarazione";g.configurations.push(c);
  g.configuration_holes.push(...g.configuration_holes.filter(s=>s.configuration_id===g.configurations[0].id).map(s=>({...s,id:"duplicate-"+s.id,configuration_id:c.id})));
  expect(analyseOrigin(g).issues).toContain("ambiguous_live_link");expect(analyseOrigin(g).coverage_complete).toBe(false);
  const m=mare();m.course_holes.push({...m.course_holes[0],id:"duplicate-live-hole"});const a=analyseOrigin(m,{type:"physical_hole",id:m.physical_holes[0].id});
  expect(a.selected.origin.exact).toBe(false);expect(a.selected.exact_live_references).toEqual([]);expect(a.coverage_complete).toBe(false);
});

test("explicit tee override with an incompatible live scope remains unverified coverage",()=>{
  const g=mare(),c=g.configurations[0],s=g.configuration_holes.find(s=>s.configuration_id===c.id);
  g.tee_overrides=[{...metadata,id:"wrong-scope",configuration_id:c.id,configuration_hole_id:s.id,route_tee_id:"tee",par_override:5,stroke_index_override:null}];
  const a=analyseOrigin(g,{type:"route_tee",id:"tee"});expect(a.overrides[0].explicit_link).toBe(false);expect(a.issues).toContain("unverified_tee_override");expect(a.coverage_complete).toBe(false);
});

test("an unmatched tee with no certified configuration is incomplete, while NULL gender remains absent",async()=>{
  const g=mare();g.route_tees[0].holes_count=9;g.route_tees[0].gender=null;g.route_tees[0].route_id="missing";await start(g);select("route_tee","tee");
  expect(screen.getByText(/Nessun utilizzo certificato in questa fotografia/)).toBeInTheDocument();expect(analyseOrigin(g,{type:"route_tee",id:"tee"}).coverage_complete).toBe(false);
});

test("loading/error never fabricate empty coverage, refresh keeps previous data, missing RPC offers retry",async()=>{
  const spy=jest.spyOn(console,"error").mockImplementation(()=>{}),g=mare(),service={originGraph:jest.fn().mockRejectedValue(new Error("RPC unavailable"))};
  render(<DataOrigin clubId={g.club.id} service={service}/>);fireEvent.click(screen.getByRole("button",{name:"Esplora impatto e origine"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Impossibile caricare impatto e origine dati");expect(screen.queryByLabelText("Oggetto da esplorare")).not.toBeInTheDocument();
  service.originGraph.mockResolvedValueOnce(g);fireEvent.click(screen.getByRole("button",{name:"Riprova lettura"}));await screen.findByLabelText("Oggetto da esplorare");
  let resolve;service.originGraph.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));fireEvent.click(screen.getByRole("button",{name:"Ricarica impatto e origine"}));
  expect(screen.getByRole("status")).toHaveTextContent("Dati precedenti mantenuti");expect(screen.getAllByRole("table")).toHaveLength(2);resolve(g);
  await waitFor(()=>expect(screen.queryByRole("status")).not.toBeInTheDocument());spy.mockRestore();
});

test("graph contract and service reject partial, cross-club and failed RPC responses",async()=>{
  const g=mare();expect(validateOriginGraph(g,g.club.id)).toBe(g);expect(()=>validateOriginGraph(g,"other-club")).toThrow();expect(()=>validateOriginGraph({...g,components:undefined},g.club.id)).toThrow();
  expect(()=>validateOriginGraph({...g,contract_version:1},g.club.id)).toThrow();
  const client={rpc:jest.fn().mockResolvedValue({data:g,error:null})},service=createStructureReviewService(client);
  expect(await service.originGraph(g.club.id)).toBe(g);expect(client.rpc).toHaveBeenCalledWith("admin_catalog_data_origin",{p_club_id:g.club.id});
  client.rpc.mockResolvedValueOnce({data:null,error:{code:"42501"}});await expect(service.originGraph(g.club.id)).rejects.toEqual({code:"42501"});
  client.rpc.mockResolvedValueOnce({data:{...g,read_only:false},error:null});await expect(service.originGraph(g.club.id)).rejects.toThrow();
});

test("unchanged UI presents minimized matrices and draft metadata without requiring any raw payload or snapshot",async()=>{
  const g=mare();g.courses[0].tee_matrix={present:true,source:"official_club_site",physical_hole_count:9,par_variant:70,evidence_status:"verified",has_unrecognized_entries:true,tees:[{source_key:"orange",holes:[{physical_hole_number:1,par:4,stroke_indexes:[11,12]}]}]};
  g.drafts=[{draft_id:"personal",entity_type:"route",live_entity_id:g.courses[0].id,workflow_status:"draft",revision:2,has_changes:true,base_status:"changed",author:"current_admin",is_owner:true,updated_at:stamp}];
  await start(g);expect(screen.getByText("Personale")).toBeInTheDocument();expect(screen.getByText("Con differenze")).toBeInTheDocument();expect(screen.getByText("Divergente dal live")).toBeInTheDocument();
  expect(screen.getByText(/"source_key": "orange"/)).toBeInTheDocument();expect(screen.getByText(/"stroke_indexes"/)).toBeInTheDocument();expect(screen.getByText("Non valutata")).toBeInTheDocument();
  expect(JSON.stringify(g)).not.toMatch(/"(snapshot|base_snapshot|source_payload|registration_snapshot|source_snapshot)"/);
});

test("explorer is reachable only inside existing Structure review detail and never invokes a mutation",async()=>{
  const g=mare(),item={target_type:"structure",target_id:g.club.id,club_id:g.club.id,club_name:g.club.name,title:g.club.name,status:"needs_review"};
  const service={list:jest.fn().mockResolvedValue([item]),detail:jest.fn().mockResolvedValue({club:g.club,structures:[],configurations:[],courses:[],combinations:[],events:[],fig:null}),originGraph:jest.fn().mockResolvedValue(g),createStructure:jest.fn(),reviewStructure:jest.fn()};
  render(<StructureReview service={service} onRoot={jest.fn()}/>);
  fireEvent.click(await screen.findByRole("button",{name:/Club \/ combinazione Mare di Roma/}));
  const section=await screen.findByRole("region",{name:"Impatto e origine dati"});fireEvent.click(within(section).getByRole("button",{name:"Esplora impatto e origine"}));
  await screen.findByLabelText("Oggetto da esplorare");expect(service.createStructure).not.toHaveBeenCalled();expect(service.reviewStructure).not.toHaveBeenCalled();
  expect(service.originGraph).toHaveBeenCalledTimes(1);
});
