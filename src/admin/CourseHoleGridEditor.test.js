import { useCallback,useRef,useState } from "react";
import { fireEvent,render,screen,waitFor,within } from "@testing-library/react";
import CourseHoleGridEditor from "./CourseHoleGridEditor";
import CourseEditor from "./CourseEditor";
import { createCourseHoleGridEditorService,getCourseHoleGridDiff,normalizeCourseHoleGrid,validateCourseHoleGrid } from "./course-hole-grid-editor-data";

const club={name:"Club nove fixture"};
const course={id:"course-9",name:"Percorso nove fixture"};
const snapshot={holes:Array.from({length:9},(_,i)=>({id:`physical-${i+1}`,physical_hole_number:i+1,
  par:[5,3,4,3,4,5,4,4,3][i],stroke_index:[11,17,1,7,9,5,3,13,15][i]}))};
const draft={draft_id:"physical-draft",live_entity_id:course.id,revision:1,snapshot,base_snapshot:snapshot};
const context={course:{id:course.id,name:course.name,holes_count:9,total_par:35,source_system:"fig"},
  holes:snapshot.holes.map(h=>({...h,display_label:`Buca ${h.physical_hole_number}`})),
  si_sequence:[1,3,5,7,9,11,13,15,17],checks:{actual_holes:9,expected_holes:9,duplicate_numbers:0,invalid_numbers:0,missing_numbers:[]}};
const makeService=()=>({openDraft:jest.fn().mockResolvedValue({draft,context}),
  saveDraft:jest.fn().mockImplementation(async(d,s)=>({...d,revision:d.revision+1,snapshot:normalizeCourseHoleGrid(s)})),
  publishDraft:jest.fn().mockResolvedValue({course_id:course.id,version_id:"version",context}),
  abandonDraft:jest.fn().mockResolvedValue({...draft,workflow_status:"archived"})});
test("Par edits use the dedicated workflow while the SI grid remains editable",async()=>{
  render(<Harness service={{...makeService(),parWorkflow:true}}/>);
  expect(await screen.findByLabelText("Par buca 1")).toBeDisabled();
  expect(screen.getByLabelText("SI/HCP buca 1")).not.toBeDisabled();
  expect(screen.getByText(/Per modificare il Par usa Avanzata/)).toBeInTheDocument();
});
function Harness({service,onExit=jest.fn(),onPublished=jest.fn()}) {
  const guard=useRef(null); const registerExitGuard=useCallback(value=>{guard.current=value;},[]);
  const exit=()=>guard.current?guard.current(onExit):onExit();
  return <><button onClick={exit}>Vai al catalogo</button><CourseHoleGridEditor {...{club,course,service,onPublished,registerExitGuard}} onBack={exit} onBackToClub={exit} onBackToCatalog={exit}/></>;
}
function PublishReturnHarness({gridService,courseService}) {
  const [editingHoles,setEditingHoles]=useState(true);
  const registerExitGuard=useCallback(()=>{},[]);
  const editorCourse={...course,holesCount:9,displayOrder:null,isActive:true};
  return editingHoles
    ? <CourseHoleGridEditor {...{club,course,service:gridService,registerExitGuard}} onBack={()=>setEditingHoles(false)} onBackToClub={jest.fn()} onBackToCatalog={jest.fn()} onPublished={()=>setEditingHoles(false)}/>
    : <CourseEditor club={club} course={editorCourse} service={courseService} registerExitGuard={registerExitGuard} onBack={jest.fn()} onBackToClub={jest.fn()} onBackToCatalog={jest.fn()} onPublished={jest.fn()}/>;
}
const swap=()=>{
  fireEvent.change(screen.getByLabelText("SI/HCP buca 1"),{target:{value:"17"}});
  fireEvent.change(screen.getByLabelText("SI/HCP buca 2"),{target:{value:"11"}});
};

test("9/18 validation follows real SI sets, rejects incompatible/duplicate/missing values and bad structure",()=>{
  expect(validateCourseHoleGrid(context,snapshot)).toMatchObject({canSave:true,canPublish:true,totalPar:35});
  for(const sequence of [Array.from({length:9},(_,i)=>i+1),Array.from({length:9},(_,i)=>2*(i+1)),[2,3,4,5,8,10,14,15,17]]) {
    const fields={holes:snapshot.holes.map((h,i)=>({...h,stroke_index:sequence[8-i]}))};
    expect(validateCourseHoleGrid({...context,si_sequence:sequence},fields).canPublish).toBe(true);
  }
  const invalid=normalizeCourseHoleGrid(snapshot); invalid.holes[0].stroke_index=17;
  expect(validateCourseHoleGrid(context,invalid)).toMatchObject({canSave:true,canPublish:false,duplicateSi:1,missingSi:[11]});
  invalid.holes[0].stroke_index=2; expect(validateCourseHoleGrid(context,invalid).canPublish).toBe(false);
  invalid.holes[0].stroke_index=null; expect(validateCourseHoleGrid(context,invalid).canPublish).toBe(false);
  invalid.holes[0].stroke_index=11; invalid.holes[0].par=null;
  expect(validateCourseHoleGrid(context,invalid)).toMatchObject({canSave:true,canPublish:false});
  invalid.holes[0].par=4.5; expect(validateCourseHoleGrid(context,invalid).canSave).toBe(false);
  expect(validateCourseHoleGrid(context,{holes:snapshot.holes.slice(0,8)}).canPublish).toBe(false);
  invalid.holes[0].par=5; invalid.holes[0].physical_hole_number=2;
  expect(validateCourseHoleGrid(context,invalid)).toMatchObject({canPublish:false,duplicateNumbers:1,missingNumbers:[1]});
  invalid.holes[0].physical_hole_number=10; expect(validateCourseHoleGrid(context,invalid).canPublish).toBe(false);
  const all18=Array.from({length:18},(_,i)=>i+1);
  const context18={...context,course:{...context.course,holes_count:18,total_par:72},si_sequence:all18,checks:{...context.checks,actual_holes:18}};
  const fields18={holes:all18.map(n=>({id:`h-${n}`,physical_hole_number:n,par:4,stroke_index:n}))};
  expect(validateCourseHoleGrid(context18,fields18).canPublish).toBe(true);
  fields18.holes[17].stroke_index=9; expect(validateCourseHoleGrid(context18,fields18).canPublish).toBe(false);
});

test("diff uses physical identity and only Par/SI even when input order changes",()=>{
  const fields=normalizeCourseHoleGrid(snapshot); fields.holes.reverse(); fields.holes[8].par=4;
  expect(getCourseHoleGridDiff(snapshot,fields)).toEqual([{key:"physical-1-par",label:"Buca 1 · Par",before:5,after:4}]);
});

test("opens/resumes all nine physical rows and exposes only Par and single SI inputs",async()=>{
  const service=makeService(); const saved=normalizeCourseHoleGrid(snapshot); saved.holes[0].stroke_index=17; saved.holes[1].stroke_index=11;
  service.openDraft.mockResolvedValue({draft:{...draft,snapshot:saved},context});
  render(<Harness service={service}/>);
  expect(await screen.findByLabelText("SI/HCP buca 1")).toHaveValue(17);
  expect(screen.getAllByRole("spinbutton")).toHaveLength(18);
  expect(screen.getByRole("table",{name:"Griglia buche del Percorso"})).toBeInTheDocument();
  expect(screen.getByText("9 / 9")).toBeInTheDocument(); expect(screen.getByText("35 / 35")).toBeInTheDocument();
  expect(screen.getByText("1, 3, 5, 7, 9, 11, 13, 15, 17")).toBeInTheDocument();
  expect(screen.getByText("Bozza buche in corso")).toBeInTheDocument();
  expect(screen.queryByLabelText("Numero buca 1")).not.toBeInTheDocument();
  expect(service.openDraft).toHaveBeenCalledWith(course.id);
});

test("save leaves live untouched; dirty publish saves grid then requires row differences and final confirmation",async()=>{
  const service=makeService(); const onPublished=jest.fn(); render(<Harness service={service} onPublished={onPublished}/>);
  await screen.findByLabelText("SI/HCP buca 1"); swap();
  fireEvent.click(screen.getByRole("button",{name:"Salva bozza",exact:true}));
  await screen.findByText("Bozza salvata. Il catalogo pubblicato resta invariato.");
  expect(snapshot.holes[0].stroke_index).toBe(11); expect(onPublished).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Par buca 1"),{target:{value:"4"}});
  fireEvent.change(screen.getByLabelText("Par buca 2"),{target:{value:"4"}});
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));
  const dialog=await screen.findByRole("dialog",{name:"Conferma pubblicazione"});
  const diff=within(dialog).getByRole("table",{name:"Differenze buche del Percorso"});
  const parRow=within(diff).getByText("Buca 1 · Par").closest('[role="row"]');
  expect(within(parRow).getAllByRole("cell").map(c=>c.textContent)).toEqual(["Buca 1 · Par","5","4"]);
  expect(within(diff).getByText("Buca 1 · SI/HCP")).toBeInTheDocument();
  expect(service.saveDraft).toHaveBeenCalledTimes(2); expect(service.publishDraft).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button",{name:"Conferma pubblicazione"}));
  await waitFor(()=>expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({course_id:course.id})));
  expect(service.publishDraft).toHaveBeenCalledWith(expect.objectContaining({revision:3}));
});

test("successful hole publication returns to an identical Course draft without a misleading badge",async()=>{
  const gridService=makeService();
  const liveCourse={name:course.name,holes_count:9,display_order:null,is_active:true};
  const courseDraft={draft_id:"course-draft",revision:1,snapshot:liveCourse,base_snapshot:liveCourse};
  const courseService={openDraft:jest.fn().mockResolvedValue({draft:courseDraft,context:{can_edit_structure:false}})};
  render(<PublishReturnHarness gridService={gridService} courseService={courseService}/>);
  await screen.findByLabelText("SI/HCP buca 1"); swap();
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));
  const dialog=await screen.findByRole("dialog",{name:"Conferma pubblicazione"});
  fireEvent.click(within(dialog).getByRole("button",{name:"Conferma pubblicazione"}));
  await screen.findByLabelText("Nome visualizzato");
  expect(courseService.openDraft).toHaveBeenCalledWith(course.id);
  expect(screen.queryByText("Bozza in corso")).not.toBeInTheDocument();
  expect(screen.queryByText("Bozza buche in corso")).not.toBeInTheDocument();
});

test("cancel publication keeps the saved draft and does not publish",async()=>{
  const service=makeService(); render(<Harness service={service}/>); await screen.findByLabelText("Par buca 1"); swap();
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true})); const dialog=await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button",{name:"Annulla"}));
  expect(service.saveDraft).toHaveBeenCalledTimes(1); expect(service.publishDraft).not.toHaveBeenCalled();
  expect(screen.getByText("Bozza buche in corso")).toBeInTheDocument();
});

test("SI/Par alerts automatically block publication while incomplete drafts can still be saved",async()=>{
  render(<Harness service={makeService()}/>); await screen.findByLabelText("Par buca 1");
  fireEvent.change(screen.getByLabelText("SI/HCP buca 1"),{target:{value:"17"}});
  expect(screen.getByRole("button",{name:"Pubblica",exact:true})).toBeDisabled();
  expect(screen.getByText(/Gli SI\/HCP devono corrispondere/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Salva bozza",exact:true})).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Par buca 1"),{target:{value:"6"}});
  expect(screen.getByText("36 / 35")).toBeInTheDocument(); expect(screen.getByText(/Il Totale Par deve corrispondere/)).toBeInTheDocument();
});

test.each(["Resta","Scarta","Salva bozza"])("exit to the same Course is guarded with %s and beforeunload",async(action)=>{
  const service=makeService(); const onExit=jest.fn(); render(<Harness service={service} onExit={onExit}/>);
  await screen.findByLabelText("Par buca 1"); swap();
  const event=new Event("beforeunload",{cancelable:true}); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:course.name}));
  const dialog=await screen.findByRole("dialog",{name:"Modifiche non salvate"});
  fireEvent.click(within(dialog).getByRole("button",{name:action}));
  if(action==="Resta") expect(onExit).not.toHaveBeenCalled(); else await waitFor(()=>expect(onExit).toHaveBeenCalledTimes(1));
  expect(service.saveDraft).toHaveBeenCalledTimes(action==="Salva bozza"?1:0); expect(service.abandonDraft).not.toHaveBeenCalled();
});

test("abandon only archives after confirmation and removes grid badge on return",async()=>{
  const service=makeService(); const onExit=jest.fn(); render(<Harness service={service} onExit={onExit}/>);
  await screen.findByLabelText("Par buca 1"); swap(); fireEvent.click(screen.getByRole("button",{name:"Abbandona bozza"}));
  let dialog=await screen.findByRole("dialog",{name:"Abbandona bozza"}); fireEvent.click(within(dialog).getByRole("button",{name:"Annulla"}));
  expect(service.abandonDraft).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button",{name:"Abbandona bozza"}));
  dialog=await screen.findByRole("dialog",{name:"Abbandona bozza"}); fireEvent.click(within(dialog).getByRole("button",{name:"Conferma abbandono"}));
  await waitFor(()=>expect(onExit).toHaveBeenCalledTimes(1)); expect(service.abandonDraft).toHaveBeenCalledWith(draft);
  expect(screen.queryByText("Bozza buche in corso")).not.toBeInTheDocument(); expect(service.saveDraft).not.toHaveBeenCalled(); expect(service.publishDraft).not.toHaveBeenCalled();
});

test.each(["40001","42501","23514","55P03"])("publication failure %s retains draft and reports no success",async(code)=>{
  const logged=jest.spyOn(console,"error").mockImplementation(()=>{});
  const service=makeService(); const onPublished=jest.fn(); service.publishDraft.mockRejectedValue({code});
  render(<Harness service={service} onPublished={onPublished}/>); await screen.findByLabelText("Par buca 1"); swap();
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true})); const dialog=await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button",{name:"Conferma pubblicazione"})); await within(dialog).findByRole("alert");
  expect(onPublished).not.toHaveBeenCalled(); expect(screen.getByText("Bozza buche in corso")).toBeInTheDocument(); logged.mockRestore();
});

test("loading error is explicit and retry opens the real grid",async()=>{
  const logged=jest.spyOn(console,"error").mockImplementation(()=>{});
  const service=makeService(); service.openDraft.mockRejectedValueOnce({code:"42501"}); render(<Harness service={service}/>);
  await screen.findByRole("alert"); expect(screen.queryByRole("table")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Riprova"})); await screen.findByLabelText("Par buca 1");
  expect(service.openDraft).toHaveBeenCalledTimes(2); logged.mockRestore();
});

test("adapter only calls physical-course RPCs, allowlists snapshots and verifies target identity",async()=>{
  const client={rpc:jest.fn().mockResolvedValue({data:[draft],error:null})}; const service=createCourseHoleGridEditorService(client);
  await service.saveDraft(draft,{holes:snapshot.holes.map(h=>({...h,route_id:"forbidden",display_label:"forbidden"})),source_payload:{}});
  expect(client.rpc).toHaveBeenCalledWith("admin_course_hole_grid_save_draft",{p_draft_id:draft.draft_id,p_snapshot:snapshot,p_expected_revision:1});
  client.rpc.mockResolvedValue({data:{draft,context},error:null}); await service.openDraft(course.id);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_course_hole_grid_open_draft",{p_course_id:course.id});
  await expect(service.openDraft("wrong-target")).rejects.toThrow("target mismatch");
  client.rpc.mockResolvedValue({data:{course_id:"wrong-target",version_id:"v",context},error:null}); await expect(service.publishDraft(draft)).rejects.toThrow("target mismatch");
  client.rpc.mockResolvedValue({data:null,error:null}); await expect(service.openDraft(course.id)).rejects.toThrow("no single result");
  client.rpc.mockResolvedValue({data:{...draft,workflow_status:"archived"},error:null}); await service.abandonDraft(draft);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_course_hole_grid_archive_draft",{p_draft_id:draft.draft_id,p_expected_revision:1});
});
