import { useCallback, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import TeeSiEditor from "./TeeSiEditor";
import { createTeeSiService, validTeeSi } from "./tee-si-data";
import { CourseTeeManager } from "./CourseTeeEditor";
import { supabase } from "../lib/supabase";
jest.mock("../lib/supabase",()=>({supabase:{rpc:jest.fn()}}));
const tee={id:"tee",tee_name:"Giallo"};
const holes=Array.from({length:9},(_,i)=>({slot_id:`slot-${i}`,live_hole_id:`hole-${i}`,position:i+1,occurrence:1,standard_si:i*2+1}));
const context={tee:{id:tee.id,holes_count:9},configuration:{label:"Nove verificata"},holes,allowed_si:holes.map(h=>h.standard_si),blockers:[],legacy_present:true,current:null};
function mockService(blockers=[],sourceContext=context) {
  let draft=null,current=null,history=[];
  return jest.fn(async(kind,id,action,p={})=>{
    expect(id).toBe(tee.id);expect(["route_tee","combination_tee"]).toContain(kind);
    const detail=()=>({context:{...sourceContext,blockers,current},draft,history});
    if(action==="detail")return detail();
    if(action==="open"){draft={draft_id:"draft",revision:1,snapshot:{mode:"legacy",holes:sourceContext.holes.map(h=>({slot_id:h.slot_id,si:null}))}};return detail();}
    if(action==="save"){expect(p.p_revision).toBe(draft.revision);draft={...draft,revision:draft.revision+1,snapshot:p.p_snapshot};return {draft};}
    if(action==="preview")return {context:detail().context,can_publish:validTeeSi(draft.snapshot,sourceContext),blockers:[],confirmation_hash:"server-only-preview",
      changes:sourceContext.holes.map(h=>({position:h.position,before:null,after:draft.snapshot.holes.find(r=>r.slot_id===h.slot_id).si,standard_si:h.standard_si}))};
    if(action==="publish"){
      expect(p.p_confirmation).toBe("server-only-preview");expect(p.p_note).toMatch(/^Controllo Admin/);
      history=[{version_id:"version",version_number:1,published_at:"2026-10-16T10:00:00Z",note:p.p_note,diff:{holes:[]}}];current={holes:draft.snapshot.holes};draft=null;return {version_id:"version"};
    }
    if(action==="archive"){draft=null;return {draft:{workflow_status:"archived"}};}
    if(action==="restore"){draft={draft_id:"restored",revision:1,snapshot:{mode:"managed",holes:holes.map(h=>({slot_id:h.slot_id,si:null}))}};return detail();}
    throw new Error(action);
  });
}
function Harness({service,onBack=jest.fn(),kind="course"}){
  const guard=useRef(null),registerExitGuard=useCallback(fn=>{guard.current=fn;},[]);
  const back=()=>guard.current?guard.current(onBack):onBack();
  return <><button onClick={back}>Esci</button><TeeSiEditor tee={tee} kind={kind} service={service} registerExitGuard={registerExitGuard} onBack={back}/></>;
}
async function open(){fireEvent.click(await screen.findByRole("button",{name:"Modifica override SI"}));await screen.findByLabelText("Override SI buca 1");}
function swap(){fireEvent.change(screen.getByLabelText("Override SI buca 1"),{target:{value:"3"}});fireEvent.change(screen.getByLabelText("Override SI buca 2"),{target:{value:"1"}});}
test.each(["course","combination"])("%s: private SI grid, signed server preview before confirm, closed draft and restore as new draft",async kind=>{
  const service=mockService();render(<Harness service={service} kind={kind}/>);
  await screen.findByText("Nove verificata · 9 buche");expect(service.mock.calls.map(c=>c[2])).toEqual(["detail"]);
  await open();swap();fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));
  const dialog=await screen.findByRole("dialog",{name:"Conferma pubblicazione SI"});
  expect(service.mock.calls.map(c=>c[2])).toEqual(["detail","open","save","preview"]);
  expect(within(dialog).getAllByText("Legacy non attribuito").length).toBeGreaterThan(0);
  const confirm=within(dialog).getByRole("button",{name:"Conferma pubblicazione"});expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("Motivazione"),{target:{value:"Controllo Admin"}});
  expect(confirm).toBeDisabled();fireEvent.click(within(dialog).getByRole("checkbox",{name:/Ho verificato gli avvisi/}));fireEvent.click(confirm);
  await screen.findByText("SI pubblicati. Bozza chiusa.");expect(screen.queryByText("Bozza SI in corso")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Ripristina in nuova bozza"}));expect(service.mock.calls.filter(c=>c[2]==="restore")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button",{name:"Crea bozza da versione"}));await screen.findByText("Bozza SI in corso");
  expect(service.mock.calls.filter(c=>c[2]==="publish")).toHaveLength(1);expect(service.mock.calls.filter(c=>c[2]==="restore")).toHaveLength(1);
});
test("duplicates block publication, removal is explicit, unsaved exit save/discard/stay and abandon confirmation",async()=>{
  const service=mockService(),onBack=jest.fn();render(<Harness service={service} onBack={onBack}/>);await open();
  expect(screen.getByRole("button",{name:"Abbandona bozza",exact:true})).toHaveClass("stablr-admin-abandon-button");
  fireEvent.change(screen.getByLabelText("Override SI buca 1"),{target:{value:"3"}});
  expect(screen.getByRole("alert")).toHaveTextContent("univoci");
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));
  const invalidPreview=await screen.findByRole("dialog",{name:"Conferma pubblicazione SI"});
  expect(within(invalidPreview).getByRole("button",{name:"Conferma pubblicazione"})).toBeDisabled();
  expect(within(invalidPreview).getAllByRole("alert").some(el=>el.textContent.includes("Duplicati"))).toBe(true);
  fireEvent.click(within(invalidPreview).getByRole("button",{name:"Annulla"}));
  fireEvent.change(screen.getByLabelText("Override SI buca 1"),{target:{value:"5"}});
  fireEvent.click(screen.getByRole("button",{name:"Esci"}));let dialog=screen.getByRole("dialog",{name:"Modifiche non salvate"});
  fireEvent.click(within(dialog).getByRole("button",{name:"Resta"}));expect(onBack).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Rimuovi override / Usa SI della configurazione"}));
  expect(screen.getByRole("button",{name:"Pubblica",exact:true})).toBeEnabled();
  fireEvent.click(screen.getByRole("button",{name:"Esci"}));dialog=screen.getByRole("dialog",{name:"Modifiche non salvate"});
  fireEvent.click(within(dialog).getByRole("button",{name:"Salva bozza"}));await waitFor(()=>expect(onBack).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button",{name:"Resta"})); // Harness intentionally remains mounted after exit.
  fireEvent.click(screen.getByRole("button",{name:"Abbandona bozza",exact:true}));
  expect(within(screen.getByRole("dialog",{name:"Abbandona bozza SI"})).getByRole("button",{name:"Annulla"})).toHaveClass("stablr-admin-abandon-button");
  expect(service.mock.calls.some(c=>c[2]==="archive")).toBe(false);fireEvent.click(screen.getByRole("button",{name:"Conferma abbandono"}));
  await waitFor(()=>expect(service.mock.calls.filter(c=>c[2]==="archive")).toHaveLength(1));
});
const fullContext=(scale)=>({...context,legacy_present:false,tee:{...context.tee,holes_count:scale.length},allowed_si:scale,
  holes:scale.map((si,i)=>({slot_id:`full-${i}`,position:i+1,occurrence:1,standard_si:si}))});
test.each([
  [[1,3,5,7,9,11,13,15,17]],[[2,4,6,8,10,12,14,16,18]],[Array.from({length:18},(_,i)=>i+1)]
])("SI arrows and keyboard wrap the actual scale without exposing native increments (%#)",async scale=>{
  const service=mockService([],fullContext(scale));render(<Harness service={service}/>);await open();
  const input=screen.getByLabelText("Override SI buca 1"),min=scale[0],max=scale[scale.length-1];
  expect(input).toHaveAttribute("min",String(min));expect(input).toHaveAttribute("max",String(max));
  fireEvent.change(input,{target:{value:String(max)}});fireEvent.click(screen.getByRole("button",{name:"SI buca 1 successivo"}));expect(input).toHaveValue(min);
  fireEvent.click(screen.getByRole("button",{name:"SI buca 1 precedente"}));expect(input).toHaveValue(max);
  fireEvent.keyDown(input,{key:"ArrowUp"});expect(input).toHaveValue(min);fireEvent.keyDown(input,{key:"ArrowDown"});expect(input).toHaveValue(max);
  for(const value of ["0","19","1.5"]){fireEvent.change(input,{target:{value}});expect(input).toHaveValue(max);}
  fireEvent.click(screen.getByRole("button",{name:"Salva bozza",exact:true}));await screen.findByText(/Bozza SI salvata/);
  expect(service.mock.calls.find(c=>c[2]==="save")[3].p_snapshot.holes[0].si).toBe(max);
});
test("nonconsecutive manual values are rejected; an even-scale digit prefix is never saved and is discarded on blur",async()=>{
  const service=mockService([],fullContext([2,4,6,8,10,12,14,16,18]));render(<Harness service={service}/>);await open();
  const input=screen.getByLabelText("Override SI buca 1");
  fireEvent.change(input,{target:{value:"3"}});expect(input).toHaveValue(null);
  fireEvent.change(input,{target:{value:"1"}});expect(screen.getByRole("button",{name:"Salva bozza",exact:true})).toBeDisabled();
  expect(screen.getByRole("button",{name:"Pubblica",exact:true})).toBeDisabled();
  fireEvent.change(input,{target:{value:"12"}});expect(input).toHaveValue(12);expect(screen.getByRole("button",{name:"Salva bozza",exact:true})).toBeEnabled();
  fireEvent.change(input,{target:{value:"1"}});fireEvent.blur(input);expect(input).toHaveValue(12);
  fireEvent.click(screen.getByRole("button",{name:"Salva bozza",exact:true}));await screen.findByText(/Bozza SI salvata/);
  expect(service.mock.calls.find(c=>c[2]==="save")[3].p_snapshot.holes[0].si).toBe(12);
});
test("18-hole preview expansion is styled and preserves Before/After; distribution warning requires explicit acknowledgement",async()=>{
  const service=mockService([],fullContext(Array.from({length:18},(_,i)=>i+1)));render(<Harness service={service}/>);await open();
  fireEvent.change(screen.getByLabelText("Override SI buca 1"),{target:{value:"10"}});fireEvent.change(screen.getByLabelText("Override SI buca 10"),{target:{value:"1"}});
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));const dialog=await screen.findByRole("dialog",{name:"Conferma pubblicazione SI"});
  const diff=within(dialog).getByRole("table",{name:"Differenze SI Prima Dopo"});expect(within(diff).getAllByRole("row")).toHaveLength(7);
  const expand=within(diff).getByRole("button",{name:"Mostra tutto · Differenze SI"});expect(expand).toHaveClass("stablr-admin-abandon-button");expect(expand).toHaveAttribute("aria-expanded","false");
  fireEvent.click(expand);expect(within(diff).getAllByRole("row")).toHaveLength(19);expect(within(diff).getByText("Prima")).toBeVisible();expect(within(diff).getByText("Dopo")).toBeVisible();
  fireEvent.click(within(diff).getByRole("button",{name:"Riduci · Differenze SI"}));expect(within(diff).getAllByRole("row")).toHaveLength(7);
  expect(within(dialog).getByText(/Distribuzione SI tra prime/)).toBeInTheDocument();
  const confirm=within(dialog).getByRole("button",{name:"Conferma pubblicazione"});fireEvent.change(within(dialog).getByLabelText("Motivazione"),{target:{value:"Controllo Admin"}});
  expect(confirm).toBeDisabled();fireEvent.click(within(dialog).getByRole("checkbox",{name:/Ho verificato gli avvisi/}));expect(confirm).toBeEnabled();fireEvent.click(confirm);
  await screen.findByText("SI pubblicati. Bozza chiusa.");expect(service.mock.calls.find(c=>c[2]==="publish")[3].p_note).toMatch(/Avvisi confermati:.*Distribuzione SI/);
});
test("incomplete verified coverage is explicit; no auto-open, no guessing",async()=>{
  const service=mockService(["Collegamento esatto non disponibile"]);render(<Harness service={service}/>);
  await screen.findByText("Collegamento esatto non disponibile");expect(screen.getByRole("button",{name:"Modifica override SI"})).toBeDisabled();
  expect(service.mock.calls).toHaveLength(1);
});
test("saved SI draft resumes on refresh; discard never archives or replaces the saved snapshot",async()=>{
  const service=mockService(),onBack=jest.fn();let view=render(<Harness service={service} onBack={onBack}/>);await open();swap();
  fireEvent.click(screen.getByRole("button",{name:"Salva bozza",exact:true}));await screen.findByText(/Bozza SI salvata/);view.unmount();
  view=render(<Harness service={service} onBack={onBack}/>);expect(await screen.findByLabelText("Override SI buca 1")).toHaveValue(3);
  expect(screen.getByText("Bozza SI in corso")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Override SI buca 1"),{target:{value:"5"}});fireEvent.click(screen.getByRole("button",{name:"Esci"}));
  fireEvent.click(within(screen.getByRole("dialog",{name:"Modifiche non salvate"})).getByRole("button",{name:"Scarta"}));
  expect(onBack).toHaveBeenCalledTimes(1);view.unmount();render(<Harness service={service}/>);
  expect(await screen.findByLabelText("Override SI buca 1")).toHaveValue(3);expect(service.mock.calls.filter(c=>c[2]==="archive")).toHaveLength(0);
});
test("service preserves exact RPC identity, server errors and 9-hole configuration SI scale",async()=>{
  const client={rpc:jest.fn().mockResolvedValue({data:{context},error:null})};const service=createTeeSiService(client);
  await service("route_tee","tee","detail");expect(client.rpc).toHaveBeenCalledWith("admin_tee_si",{p_kind:"route_tee",p_tee_id:"tee",p_action:"detail"});
  client.rpc.mockResolvedValue({data:null,error:{code:"40001"}});await expect(service("route_tee","tee","open")).rejects.toEqual({code:"40001"});
  expect(validTeeSi({mode:"managed",holes:holes.map(h=>({slot_id:h.slot_id,si:null}))},context)).toBe(true);
  expect(validTeeSi({mode:"managed",holes:holes.map((h,i)=>({slot_id:h.slot_id,si:i+1}))},context)).toBe(false);
});
test.each(["course","combination"])("%s tee detail opens the exact SI editor and returns to the same tee without metadata drafts",async kind=>{
  const selected={...tee,effective_holes_count:9,is_active:true},course={id:"route",name:"Percorso"},club={id:"club",name:"Club"};
  const metadata={listTees:jest.fn().mockResolvedValue({tees:[selected],new_drafts:[]}),openDraft:jest.fn()};
  supabase.rpc.mockReset().mockResolvedValue({data:{context,draft:null,history:[]},error:null});
  render(<CourseTeeManager course={course} club={club} service={metadata} kind={kind} registerExitGuard={()=>{}} navigate={fn=>fn()} onBack={()=>{}} onBackToClub={()=>{}} onBackToCatalog={()=>{}}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Apri tee Giallo · 9 buche"}));
  fireEvent.click(screen.getByRole("button",{name:"Gestisci override SI"}));await screen.findByRole("button",{name:"Modifica override SI"});
  expect(supabase.rpc).toHaveBeenCalledWith("admin_tee_si",{p_kind:kind==="course"?"route_tee":"combination_tee",p_tee_id:tee.id,p_action:"detail"});
  expect(metadata.openDraft).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:tee.tee_name,exact:true}));
  expect(screen.getByRole("heading",{name:tee.tee_name})).toBeInTheDocument();
});
