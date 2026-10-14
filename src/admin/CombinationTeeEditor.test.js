import { StrictMode, useCallback, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CourseTeeManager } from "./CourseTeeEditor";
import { createCombinationTeeEditorService, courseTeeColor, normalizeCourseTeeFields, courseTeeDiff } from "./course-tee-editor-data";
const club={id:"parco",name:"Parco De' Medici"},combination={id:"combination",name:"Championship Bianco/Blu",holesCount:18};
const tee={id:"combo-tee",route_combination_id:combination.id,tee_name:"Giallo",tee_color:"yellow",gender:null,display_order:null,
  holes_count:18,effective_holes_count:18,par_total:72,course_rating:72.1,slope_rating:125,is_active:true};
const fields=normalizeCourseTeeFields(tee);
function fixtureService(){
  let live={...tee},draft=null,newDraft=null;
  const make=(isNew=false)=>{
    const snapshot=isNew?{...fields,tee_name:"",tee_color:null,gender:null,display_order:0,course_rating:null,slope_rating:null}:normalizeCourseTeeFields(live);
    return {draft_id:isNew?"new-combination-draft":"combination-draft",entity_type:"combination_tee",live_entity_id:isNew?null:tee.id,workflow_status:"draft",revision:1,snapshot,
      base_snapshot:{...snapshot,_context:{tee:isNew?null:{...live},combination}}};
  };
  const context=(isNew=false)=>({tee:isNew?{holes_count:18,effective_holes_count:18,par_total:72}:live,combination});
  const result=()=>({course:combination,tees:[live],new_drafts:newDraft?[newDraft]:[]});
  return {
    listTees:jest.fn().mockImplementation(async()=>result()),
    openDraft:jest.fn().mockImplementation(async()=>({draft:draft||(draft=make()),context:context()})),
    openNewDraft:jest.fn().mockImplementation(async()=>({draft:newDraft||(newDraft=make(true)),context:context(true)})),
    resumeNewDraft:jest.fn().mockImplementation(async()=>({draft:newDraft,context:context(true)})),
    saveDraft:jest.fn().mockImplementation(async(d,value)=>{const saved={...d,revision:d.revision+1,snapshot:normalizeCourseTeeFields(value)};if(d.live_entity_id)draft=saved;else newDraft=saved;return saved;}),
    previewDraft:jest.fn().mockImplementation(async d=>({draft_id:d.draft_id,revision:d.revision,can_publish:true,blockers:[],
      diff:Object.fromEntries(courseTeeDiff(d.base_snapshot,d.snapshot).map(row=>[row.key,{before:row.before,after:row.after}])),
      foundation_impact:{may_block_par:true,configurations:[{id:"verified-config",label:combination.name,holes_count:18,source_state:"matched",tee_state:"not_recorded",reason:d.live_entity_id?"tee_classification_baseline":"new_tee_unclassified"}],classification_count:1,coverage:"verified_links",baselines_updated:false}})),
    publishDraft:jest.fn().mockImplementation(async d=>{live={...tee,...d.snapshot,id:d.live_entity_id||"created-combination-tee"};if(d.live_entity_id)draft=null;else newDraft=null;return {draft_id:d.draft_id,version_id:"version",context:{tee:live,combination}};}),
    abandonDraft:jest.fn().mockImplementation(async d=>{if(d.live_entity_id)draft=null;else newDraft=null;return {...d,workflow_status:"archived"};})
  };
}
function Harness({service,onBack=jest.fn()}){
  const guard=useRef(null),registerExitGuard=useCallback(value=>{guard.current=value;},[]),navigate=action=>guard.current?guard.current(action):action();
  return <CourseTeeManager club={club} course={combination} service={service} kind="combination" registerExitGuard={registerExitGuard} navigate={navigate}
    onBack={()=>navigate(onBack)} onBackToClub={()=>navigate(onBack)} onBackToCatalog={()=>navigate(onBack)}/>;
}
test("combination list/detail is read-only; explicit editor covers all fields, server impact and final confirmation",async()=>{
  const service=fixtureService();render(<Harness service={service}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Apri tee Giallo · 18 buche"}));expect(service.openDraft).not.toHaveBeenCalled();
  expect(screen.getByRole("heading",{name:"Giallo"}).querySelector(".stablr-admin-tee-dot")).toHaveStyle({backgroundColor:courseTeeColor("yellow")});
  fireEvent.click(screen.getByRole("button",{name:"Modifica dati"}));await screen.findByLabelText("Nome tee");
  for(const [label,value]of[["Nome tee","Giallo curato"],["Colore tee","arancio"],["Categoria del rating","women"],["Ordine","2"],["CR","72,25"],["Slope","126"],["Stato operativo","false"]])fireEvent.change(screen.getByLabelText(label),{target:{value}});
  expect(screen.getByText("Par totale · sola lettura")).toBeInTheDocument();expect(screen.getByText(/tee dei Percorsi non vengono modificati/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));const dialog=await screen.findByRole("dialog",{name:"Conferma pubblicazione"});
  expect(service.saveDraft).toHaveBeenCalledTimes(1);expect(service.previewDraft).toHaveBeenCalledWith(expect.objectContaining({revision:2}));expect(service.publishDraft).not.toHaveBeenCalled();
  expect(within(dialog).getByText(/bloccare successive pubblicazioni Par/)).toBeInTheDocument();expect(within(dialog).getByText("Donne")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button",{name:"Conferma pubblicazione"}));await screen.findByRole("heading",{name:"Giallo curato"});
  expect(service.publishDraft).toHaveBeenCalledTimes(1);expect(screen.queryByText("Bozza in corso")).not.toBeInTheDocument();expect(tee.par_total).toBe(72);
});
test("new combination tee opens once in StrictMode, stays private, resumes with color and abandons without live publication",async()=>{
  const service=fixtureService();render(<StrictMode><Harness service={service}/></StrictMode>);
  fireEvent.click(await screen.findByRole("button",{name:"+ Nuovo tee"}));await screen.findByLabelText("Nome tee");expect(service.openNewDraft).toHaveBeenCalledTimes(1);
  for(const [label,value]of[["Nome tee","Arancio privato"],["Colore tee","arancio"],["CR","70"],["Slope","113"]])fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.click(screen.getByRole("button",{name:"Salva bozza"}));await screen.findByText(/Bozza salvata/);
  fireEvent.click(screen.getByRole("button",{name:"Tee e rating",exact:true}));const row=await screen.findByRole("button",{name:/Arancio privato.*Riprendi bozza/});
  expect(row.querySelector(".stablr-admin-tee-dot")).toHaveStyle({backgroundColor:courseTeeColor("arancio")});fireEvent.click(row);
  expect(await screen.findByLabelText("Nome tee")).toHaveValue("Arancio privato");expect(service.resumeNewDraft).toHaveBeenCalledWith("new-combination-draft");
  fireEvent.click(screen.getByRole("button",{name:"Abbandona bozza"}));const dialog=await screen.findByRole("dialog",{name:"Abbandona bozza"});
  expect(service.abandonDraft).not.toHaveBeenCalled();fireEvent.click(within(dialog).getByRole("button",{name:"Conferma abbandono"}));
  await screen.findByRole("heading",{name:"Tee e rating"});await waitFor(()=>expect(screen.queryByText("Bozze nuovi tee")).not.toBeInTheDocument());expect(service.publishDraft).not.toHaveBeenCalled();
});
test("new combination tee is created only after saved server preview and final confirmation, then closes its private draft",async()=>{
  const service=fixtureService();render(<Harness service={service}/>);
  fireEvent.click(await screen.findByRole("button",{name:"+ Nuovo tee"}));await screen.findByLabelText("Nome tee");
  for(const [label,value]of[["Nome tee","Nuovo verde"],["Colore tee","green"],["CR","70,0"],["Slope","113"]])fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));const dialog=await screen.findByRole("dialog",{name:"Conferma pubblicazione"});
  expect(service.openNewDraft).toHaveBeenCalledWith(combination.id);expect(service.saveDraft).toHaveBeenCalledTimes(1);expect(service.previewDraft).toHaveBeenCalledTimes(1);expect(service.publishDraft).not.toHaveBeenCalled();
  expect(within(dialog).getByText(/nuovo tee della combinazione/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button",{name:"Conferma pubblicazione"}));await screen.findByRole("heading",{name:"Nuovo verde"});
  expect(service.publishDraft).toHaveBeenCalledWith(expect.objectContaining({live_entity_id:null,revision:2}));expect(screen.queryByText("Bozza nuovo tee · privata")).not.toBeInTheDocument();
  expect(screen.getByText("18 buche",{selector:"dd"})).toBeInTheDocument();
});
test.each(["Resta","Scarta","Salva bozza"])("unsaved combination tee exit: %s",async action=>{
  const service=fixtureService(),onBack=jest.fn();render(<Harness service={service} onBack={onBack}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Apri tee Giallo · 18 buche"}));fireEvent.click(screen.getByRole("button",{name:"Modifica dati"}));await screen.findByLabelText("CR");
  fireEvent.change(screen.getByLabelText("CR"),{target:{value:"73"}});fireEvent.click(screen.getByRole("button",{name:combination.name,exact:true}));
  const dialog=await screen.findByRole("dialog",{name:"Modifiche non salvate"});fireEvent.click(within(dialog).getByRole("button",{name:action}));
  if(action==="Resta")expect(onBack).not.toHaveBeenCalled();else await waitFor(()=>expect(onBack).toHaveBeenCalledTimes(1));
  expect(service.saveDraft).toHaveBeenCalledTimes(action==="Salva bozza"?1:0);expect(service.publishDraft).not.toHaveBeenCalled();
});
test("combination collision in preview blocks confirmation; failed preview never publishes",async()=>{
  const service=fixtureService(),logged=jest.spyOn(console,"error").mockImplementation(()=>{});
  try{
    service.previewDraft.mockResolvedValueOnce({can_publish:false,blockers:["Nome tee già presente nello stesso ambito."],diff:{tee_name:{before:"Giallo",after:"Duplicato"}},
      foundation_impact:{may_block_par:false,configurations:[],coverage:"incomplete",baselines_updated:false}});
    render(<Harness service={service}/>);fireEvent.click(await screen.findByRole("button",{name:"Apri tee Giallo · 18 buche"}));fireEvent.click(screen.getByRole("button",{name:"Modifica dati"}));await screen.findByLabelText("Nome tee");
    fireEvent.change(screen.getByLabelText("Nome tee"),{target:{value:"Duplicato"}});fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));
    let dialog=await screen.findByRole("dialog");expect(within(dialog).getByRole("button",{name:"Conferma pubblicazione"})).toBeDisabled();fireEvent.click(within(dialog).getByRole("button",{name:"Annulla"}));
    service.previewDraft.mockRejectedValueOnce(new Error("RPC unavailable"));fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));await screen.findByRole("alert");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();expect(service.publishDraft).not.toHaveBeenCalled();
  }finally{logged.mockRestore();}
});
test("shared service uses only combination-specific RPCs/parameters and the seven-field allowlist",async()=>{
  const d={draft_id:"draft",revision:2,snapshot:fields},client={rpc:jest.fn()},service=createCombinationTeeEditorService(client);
  client.rpc.mockResolvedValue({data:{combination,tees:[tee],new_drafts:[]},error:null});expect((await service.listTees(combination.id)).course.id).toBe(combination.id);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_combination_tee_list",{p_combination_id:combination.id});
  client.rpc.mockResolvedValue({data:{draft:d,context:{tee,combination}},error:null});await service.openNewDraft(combination.id);expect(client.rpc).toHaveBeenLastCalledWith("admin_combination_tee_open_new_draft",{p_combination_id:combination.id});
  await service.openDraft(tee.id);expect(client.rpc).toHaveBeenLastCalledWith("admin_combination_tee_open_draft",{p_tee_id:tee.id});
  client.rpc.mockResolvedValue({data:d,error:null});await service.saveDraft(d,{...fields,course_rating:"72,25",par_total:999,holes_count:9});
  expect(client.rpc).toHaveBeenLastCalledWith("admin_combination_tee_save_draft",{p_draft_id:d.draft_id,p_expected_revision:2,p_snapshot:{...fields,course_rating:72.25}});
  client.rpc.mockResolvedValue({data:{draft_id:d.draft_id,revision:2,can_publish:true,blockers:[],diff:{},foundation_impact:{may_block_par:false,configurations:[],coverage:"incomplete",baselines_updated:false}},error:null});
  await service.previewDraft(d);expect(client.rpc).toHaveBeenLastCalledWith("admin_combination_tee_preview_draft",{p_draft_id:d.draft_id});
  client.rpc.mockResolvedValue({data:{version_id:"version",context:{tee,combination}},error:null});await service.publishDraft(d);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_combination_tee_publish_draft",{p_draft_id:d.draft_id,p_expected_revision:2});
  expect(client.rpc.mock.calls.every(([name])=>name.startsWith("admin_combination_tee_"))).toBe(true);
});
