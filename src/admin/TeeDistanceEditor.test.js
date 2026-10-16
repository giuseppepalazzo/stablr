import {useCallback,useRef} from "react";
import {fireEvent,render,screen,within,waitFor} from "@testing-library/react";
import TeeSiEditor from "./TeeSiEditor";
import {CourseTeeManager} from "./CourseTeeEditor";
import {distanceTotals,parseDistanceBatch,teeDistanceValidation,MAX_DISTANCE_M,formatMetres} from "./tee-distance-data";
import {supabase} from "../lib/supabase";
jest.mock("../lib/supabase",()=>({supabase:{rpc:jest.fn()}}));
const tee={id:"tee",tee_name:"Giallo",is_active:true,effective_holes_count:9};
const context=(n=9,repeated=false)=>({tee:{id:tee.id,holes_count:n},configuration:{label:"Configurazione verificata"},parent_id:"route",legacy_present:false,current:null,blockers:[],
  holes:Array.from({length:n},(_,i)=>({slot_id:`slot-${i}`,position:i+1,occurrence:repeated&&i>=9?2:1,live_hole_id:`source-${repeated?i%9:i}`}))});
function server(ctx=context()){
  let draft=null,current=null,history=[];
  const api=jest.fn(async(kind,id,action,p={})=>{
    expect(id).toBe(tee.id);expect(["route_tee","combination_tee"]).toContain(kind);
    const detail=()=>({context:{...ctx,current},draft,history});
    if(action==="detail")return detail();
    if(action==="open"){draft={draft_id:"private",revision:1,snapshot:{mode:"legacy",holes:ctx.holes.map(h=>({slot_id:h.slot_id,distance_m:null}))}};return detail();}
    if(action==="save"){expect(p.p_revision).toBe(draft.revision);draft={...draft,revision:draft.revision+1,snapshot:p.p_snapshot};return {draft};}
    if(action==="preview"){const totals=distanceTotals(draft.snapshot.holes);return {context:detail().context,changes:ctx.holes.map((h,i)=>({position:h.position,occurrence:h.occurrence,before:current?.holes[i].distance_m??null,after:draft.snapshot.holes[i].distance_m})),
      confirmation_hash:`preview-${draft.revision}`,can_publish:ctx.blockers.length===0,blockers:ctx.blockers,
      warnings:totals.known_count<ctx.holes.length?["Distanze mancanti: il totale completo non è disponibile."]:[],totals_before:current?.totals,totals_after:totals};}
    if(action==="publish"){
      expect(p.p_confirmation).toBe(`preview-${draft.revision}`);expect(p.p_note).toMatch(/^Verifica distanze/);
      current={holes:draft.snapshot.holes,totals:distanceTotals(draft.snapshot.holes)};
      history=[{version_id:"v1",version_number:1,published_at:"2026-10-16T10:00:00Z",note:p.p_note,diff:{holes:ctx.holes.map((h,i)=>({position:h.position,before:null,after:current.holes[i].distance_m}))}}];draft=null;return {version_id:"v1"};
    }
    if(action==="restore"){draft={draft_id:"restored",revision:1,snapshot:{mode:"managed",holes:current.holes}};return detail();}
    if(action==="archive"){draft=null;return {draft:{workflow_status:"archived"}};}
    throw new Error(action);
  });return api;
}
function Harness({service,kind="course",onBack=jest.fn()}){
  const guard=useRef(null),registerExitGuard=useCallback(fn=>{guard.current=fn;},[]);
  const back=()=>guard.current?guard.current(onBack):onBack();
  return <><button onClick={back}>Esci</button><TeeSiEditor tee={tee} kind={kind} metric="distances" service={service} registerExitGuard={registerExitGuard} onBack={back}/></>;
}
async function open(){fireEvent.click(await screen.findByRole("button",{name:"Modifica distanze"}));await screen.findByLabelText("Metri buca 1");}
function batch(text){fireEvent.click(screen.getByText("Inserimento batch distanze"));fireEvent.change(screen.getByLabelText("Incolla distanze in metri"),{target:{value:text}});fireEvent.click(screen.getByRole("button",{name:"Applica alla bozza"}));}
test.each([["course",9,false],["course",18,true],["combination",18,false]])("%s %i: reused private workflow, exact grid, batch/totals, signed preview, publish closure and restore",async(kind,n,repeated)=>{
  const api=server(context(n,repeated));render(<Harness service={api} kind={kind}/>);await screen.findByRole("heading",{name:"Distanze tee"});expect(api.mock.calls.map(c=>c[2])).toEqual(["detail"]);
  await open();expect(screen.getByLabelText("Metri buca 1")).toHaveValue(null);if(repeated)expect(screen.getByText("Buca 10 · occorrenza 2")).toBeVisible();
  batch(Array(n).fill("300").join("\n"));expect(screen.getByText("Batch applicato alla sola bozza non salvata.")).toBeVisible();
  expect(screen.getByText(new RegExp(`Totale ${n}: ${300*n} m`))).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));const modal=await screen.findByRole("dialog",{name:"Conferma pubblicazione distanze"});
  expect(api.mock.calls.map(c=>c[2])).toEqual(["detail","open","save","preview"]);expect(within(modal).getByText(new RegExp(`Totale dopo: ${300*n} m`))).toBeVisible();
  const confirm=within(modal).getByRole("button",{name:"Conferma pubblicazione"});expect(confirm).toBeDisabled();
  fireEvent.change(within(modal).getByLabelText("Motivazione"),{target:{value:"Verifica distanze"}});fireEvent.click(confirm);
  await screen.findByText("Distanze pubblicate. Bozza chiusa.");expect(screen.queryByText("Bozza distanze in corso")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Ripristina in nuova bozza"}));expect(api.mock.calls.filter(c=>c[2]==="restore")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button",{name:"Crea bozza da versione"}));await screen.findByText("Bozza distanze in corso");expect(api.mock.calls.filter(c=>c[2]==="publish")).toHaveLength(1);
});
test("metres are noncyclic and nonnegative; zero differs from missing, invalid batch is all-or-nothing and requires applying before save",async()=>{
  const api=server();render(<Harness service={api}/>);await open();const input=screen.getByLabelText("Metri buca 1");
  fireEvent.change(input,{target:{value:"0"}});fireEvent.keyDown(input,{key:"ArrowDown"});expect(input).toHaveValue(0);
  for(const raw of ["-1","1.5",String(MAX_DISTANCE_M+1)]){fireEvent.change(input,{target:{value:raw}});expect(input).toHaveValue(0);}
  fireEvent.change(input,{target:{value:String(MAX_DISTANCE_M)}});fireEvent.keyDown(input,{key:"ArrowUp"});expect(input).toHaveValue(MAX_DISTANCE_M);
  batch("100\n200");expect(screen.getByRole("alert")).toHaveTextContent("esattamente 9");expect(input).toHaveValue(MAX_DISTANCE_M);
  expect(screen.getByRole("button",{name:"Salva bozza",exact:true})).toBeDisabled();expect(api.mock.calls.filter(c=>c[2]==="save")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Incolla distanze in metri"),{target:{value:["0","—",...Array(7).fill("300")].join("\n")}});fireEvent.click(screen.getByRole("button",{name:"Applica alla bozza"}));
  expect(input).toHaveValue(0);expect(screen.getByLabelText("Metri buca 2")).toHaveValue(null);expect(screen.getByText(/Totale 9: —/)).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));const modal=await screen.findByRole("dialog",{name:"Conferma pubblicazione distanze"});
  fireEvent.change(within(modal).getByLabelText("Motivazione"),{target:{value:"Verifica distanze parziali"}});expect(within(modal).getByRole("button",{name:"Conferma pubblicazione"})).toBeDisabled();
  fireEvent.click(within(modal).getByRole("checkbox",{name:/Ho verificato gli avvisi/}));fireEvent.click(within(modal).getByRole("button",{name:"Conferma pubblicazione"}));await screen.findByText("Distanze pubblicate. Bozza chiusa.");
  expect(api.mock.calls.find(c=>c[2]==="publish")[3].p_note).toMatch(/Avvisi confermati/);
});
test("saved distance draft resumes; exit stays/discards without deleting it, abandonment requires explicit confirmation",async()=>{
  const api=server(),onBack=jest.fn();let view=render(<Harness service={api} onBack={onBack}/>);await open();fireEvent.change(screen.getByLabelText("Metri buca 1"),{target:{value:"123"}});
  fireEvent.click(screen.getByRole("button",{name:"Esci"}));let modal=screen.getByRole("dialog",{name:"Modifiche non salvate"});fireEvent.click(within(modal).getByRole("button",{name:"Resta"}));
  fireEvent.click(screen.getByRole("button",{name:"Salva bozza",exact:true}));await screen.findByText(/Bozza distanze salvata/);view.unmount();
  view=render(<Harness service={api} onBack={onBack}/>);expect(await screen.findByLabelText("Metri buca 1")).toHaveValue(123);
  fireEvent.change(screen.getByLabelText("Metri buca 1"),{target:{value:"200"}});fireEvent.click(screen.getByRole("button",{name:"Esci"}));modal=screen.getByRole("dialog",{name:"Modifiche non salvate"});
  fireEvent.click(within(modal).getByRole("button",{name:"Scarta"}));expect(onBack).toHaveBeenCalledTimes(1);view.unmount();render(<Harness service={api} onBack={onBack}/>);
  expect(await screen.findByLabelText("Metri buca 1")).toHaveValue(123);fireEvent.click(screen.getByRole("button",{name:"Abbandona bozza",exact:true}));
  modal=screen.getByRole("dialog",{name:"Abbandona bozza distanze"});expect(within(modal).getByRole("button",{name:"Annulla"})).toHaveClass("stablr-admin-abandon-button");
  expect(api.mock.calls.filter(c=>c[2]==="archive")).toHaveLength(0);fireEvent.click(within(modal).getByRole("button",{name:"Conferma abbandono"}));await waitFor(()=>expect(api.mock.calls.filter(c=>c[2]==="archive")).toHaveLength(1));
});
test.each(["course","combination"])("%s: published tee → distance editor uses exact dedicated RPC, returns to same tee; no metadata/SI writes",async kind=>{
  const c=context(),metadata={listTees:jest.fn().mockResolvedValue({tees:[tee],new_drafts:[]})};supabase.rpc.mockReset().mockResolvedValue({data:{context:c,draft:null,history:[]},error:null});
  render(<CourseTeeManager club={{name:"Club"}} course={{id:"route",name:"Percorso"}} service={metadata} kind={kind} navigate={fn=>fn()} registerExitGuard={()=>{}} onBack={()=>{}}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Apri tee Giallo · 9 buche"}));fireEvent.click(screen.getByRole("button",{name:"Gestisci distanze"}));await screen.findByRole("button",{name:"Modifica distanze"});
  expect(supabase.rpc).toHaveBeenCalledWith("admin_tee_distances",{p_kind:kind==="course"?"route_tee":"combination_tee",p_tee_id:tee.id,p_action:"detail"});
  fireEvent.click(screen.getByRole("button",{name:"Giallo",exact:true}));expect(screen.getByRole("heading",{name:"Giallo"})).toBeVisible();
});
test("batch parser accepts only explicit cells for every verified slot and never accepts a client total or comma decimal",()=>{
  const slots=context().holes;const f=parseDistanceBatch(["0","—",...Array(7).fill("300")].join("\t"),slots);
  expect(distanceTotals(f.holes)).toEqual({holes_count:9,known_count:8,known_sum_m:2100,total_m:null,front_m:null,back_m:null});expect(formatMetres(0)).toBe("0 m");expect(formatMetres(null)).toBe("—");
  expect(teeDistanceValidation(f,context()).blockers).toEqual([]);
  expect(()=>parseDistanceBatch(Array(9).fill("300,5").join("\n"),slots)).toThrow(/non valida/);
  expect(()=>parseDistanceBatch(Array(9).fill("300").join("\n")+"\n2700",slots)).toThrow(/esattamente/);
});
