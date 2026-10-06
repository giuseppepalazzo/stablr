import { useCallback, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import HoleGridEditor from "./HoleGridEditor";
import { RouteDetail } from "./RouteEditor";
import { createHoleGridEditorService, getHoleGridDiff, normalizeHoleGrid, validateHoleGrid } from "./hole-grid-editor-data";

const club = { name: "Club fixture" };
const route = { id: "combination-1", name: "Combinazione fixture" };
const snapshot = { holes: Array.from({ length: 18 }, (_, i) => ({ id: `hole-${i+1}`, round_hole_number: i+1, par: 4, stroke_index: i+1 })) };
const draft = { draft_id: "draft-1", live_entity_id: route.id, revision: 1, snapshot, base_snapshot: snapshot };
const context = {
  route: { holes_count: 18, total_par: 72 },
  origins: [{ position: 1, name: "Prime nove" }, { position: 2, name: "Seconde nove" }],
  holes: snapshot.holes.map((hole,i) => ({ ...hole, route_position: i<9 ? 1 : 2, physical_hole_number: i%9+1, source_stroke_index: i%9+1, display_label: `Origine ${i+1}` })),
  checks: { actual_holes: 18, expected_holes: 18, missing_round_numbers: [], duplicate_round_numbers: 0,
    duplicate_physical_holes: 0, invalid_origin_holes: 0, origins_valid: true, front_holes: 9, back_holes: 9, coherent: true }
};
const makeService = () => ({
  openDraft: jest.fn().mockResolvedValue({ draft, context }),
  getGrid: jest.fn().mockResolvedValue({ draft, context }),
  saveDraft: jest.fn().mockImplementation(async (current, fields) => ({ ...current, revision: current.revision+1, snapshot: normalizeHoleGrid(fields) })),
  publishDraft: jest.fn().mockResolvedValue({ version_id: "version-1", route_id: route.id, context }),
  abandonDraft: jest.fn().mockResolvedValue({ ...draft, workflow_status: "archived" })
});
function Harness({ service, onExit=jest.fn(), onPublished=jest.fn() }) {
  const guard=useRef(null);
  const registerExitGuard=useCallback((value)=>{guard.current=value;},[]);
  const exit=()=>guard.current ? guard.current(onExit) : onExit();
  return <><button onClick={exit}>Vai al catalogo</button><HoleGridEditor {...{club,route,service,onPublished,registerExitGuard}} onBack={exit} onBackToClub={exit} onBackToCatalog={exit} /></>;
}
const changeSi = () => {
  fireEvent.change(screen.getByLabelText("SI/HCP buca 1"),{target:{value:"2"}});
  fireEvent.change(screen.getByLabelText("SI/HCP buca 2"),{target:{value:"1"}});
};

test("whole-grid validation checks SI permutation, essential Par, total and real structural checks",()=>{
  expect(validateHoleGrid(context,snapshot).canPublish).toBe(true);
  const copy=JSON.parse(JSON.stringify(snapshot)); copy.holes[0].stroke_index=2;
  expect(validateHoleGrid(context,copy)).toMatchObject({ canSave:true,canPublish:false,duplicateSi:1,missingSi:[1] });
  copy.holes[0].stroke_index=1; copy.holes[0].par=null;
  expect(validateHoleGrid(context,copy)).toMatchObject({ canSave:true,canPublish:false,totalPar:68 });
  copy.holes[0].par=4.5; expect(validateHoleGrid(context,copy).canSave).toBe(false);
  expect(validateHoleGrid({ ...context,checks:{...context.checks,invalid_origin_holes:1}},snapshot).canPublish).toBe(false);
  expect(validateHoleGrid(context,{holes:snapshot.holes.slice(0,17)}).canPublish).toBe(false);
  expect(validateHoleGrid({ ...context,route:{...context.route,total_par:null}},snapshot).canPublish).toBe(true);
});

test("diff matches rows by immutable identity and includes only changed Par/SI",()=>{
  const fields=normalizeHoleGrid(snapshot); fields.holes.reverse(); fields.holes.find(h=>h.id==="hole-1").par=3;
  expect(getHoleGridDiff(snapshot,fields)).toEqual([{key:"hole-1-par",label:"Buca 1 · Par",before:4,after:3}]);
});

test("resumes one grid draft with exactly two editable fields per existing hole",async()=>{
  const service=makeService();
  const saved=normalizeHoleGrid(snapshot); saved.holes[0].par=3;
  service.openDraft.mockResolvedValue({draft:{...draft,snapshot:saved},context});
  render(<Harness service={service}/>);
  expect(await screen.findByLabelText("Par buca 1")).toHaveValue(3);
  expect(screen.getAllByRole("spinbutton")).toHaveLength(36);
  expect(screen.getByText("Bozza buche in corso")).toBeInTheDocument();
  expect(screen.getByText("Origine 1")).toBeInTheDocument();
  expect(screen.getByText("71 / 72")).toBeInTheDocument();
  expect(screen.queryByLabelText("Numero buca 1")).not.toBeInTheDocument();
  expect(service.openDraft).toHaveBeenCalledWith(route.id);
});

test("save preserves live, publication shows row-level Before/After and requires final confirmation",async()=>{
  const service=makeService(); const onPublished=jest.fn();
  render(<Harness service={service} onPublished={onPublished}/>);
  await screen.findByLabelText("Par buca 1"); changeSi();
  fireEvent.click(screen.getByRole("button",{name:"Salva bozza",exact:true}));
  await screen.findByText("Bozza salvata. Il catalogo pubblicato resta invariato.");
  expect(onPublished).not.toHaveBeenCalled();
  expect(snapshot.holes[0].stroke_index).toBe(1);
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));
  const dialog=await screen.findByRole("dialog",{name:"Conferma pubblicazione"});
  const table=within(dialog).getByRole("table",{name:"Differenze buche"});
  expect(within(table).getByText("Buca 1 · SI/HCP")).toBeInTheDocument();
  const firstChange=within(table).getAllByRole("row")[1];
  expect(within(firstChange).getAllByRole("cell").map(cell=>cell.textContent)).toEqual(["Buca 1 · SI/HCP","1","2"]);
  expect(service.publishDraft).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button",{name:"Conferma pubblicazione"}));
  await waitFor(()=>expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({version_id:"version-1"})));
  expect(service.publishDraft).toHaveBeenCalledWith(expect.objectContaining({revision:2}));
});

test("dirty publish saves the whole grid first; cancelling confirmation retains draft",async()=>{
  const service=makeService(); render(<Harness service={service}/>);
  await screen.findByLabelText("Par buca 1"); changeSi();
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));
  const dialog=await screen.findByRole("dialog");
  expect(service.saveDraft).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button",{name:"Annulla"}));
  expect(screen.getByText("Bozza buche in corso")).toBeInTheDocument();
  expect(service.publishDraft).not.toHaveBeenCalled();
});

test("SI duplicate/missing and Par total errors block publication but allow draft saving",async()=>{
  render(<Harness service={makeService()}/>);
  await screen.findByLabelText("Par buca 1");
  fireEvent.change(screen.getByLabelText("SI/HCP buca 1"),{target:{value:"2"}});
  expect(screen.getByRole("button",{name:"Pubblica",exact:true})).toBeDisabled();
  expect(screen.getByRole("button",{name:"Salva bozza",exact:true})).toBeEnabled();
  expect(screen.getByText(/Gli SI\/HCP devono contenere/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Par buca 1"),{target:{value:"5"}});
  expect(screen.getByText("73 / 72")).toBeInTheDocument();
  expect(screen.getByText(/Il Totale Par deve corrispondere/)).toBeInTheDocument();
});

test.each(["Resta","Scarta","Salva bozza"])("unsaved exit supports %s and browser unload protection",async(action)=>{
  const service=makeService(); const onExit=jest.fn(); render(<Harness service={service} onExit={onExit}/>);
  await screen.findByLabelText("Par buca 1"); changeSi();
  const event=new Event("beforeunload",{cancelable:true}); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Vai al catalogo"}));
  const dialog=await screen.findByRole("dialog",{name:"Modifiche non salvate"});
  fireEvent.click(within(dialog).getByRole("button",{name:action}));
  if(action==="Resta") { expect(onExit).not.toHaveBeenCalled(); expect(service.saveDraft).not.toHaveBeenCalled(); }
  else { await waitFor(()=>expect(onExit).toHaveBeenCalledTimes(1)); expect(service.saveDraft).toHaveBeenCalledTimes(action==="Salva bozza"?1:0); }
  expect(service.abandonDraft).not.toHaveBeenCalled();
});

test("abandon requires explicit confirmation, archives grid and returns without badge",async()=>{
  const service=makeService(); const onExit=jest.fn(); render(<Harness service={service} onExit={onExit}/>);
  await screen.findByLabelText("Par buca 1"); changeSi();
  fireEvent.click(screen.getByRole("button",{name:"Abbandona bozza"}));
  let dialog=await screen.findByRole("dialog",{name:"Abbandona bozza"});
  expect(within(dialog).getByText(/Abbandonare la bozza\?/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button",{name:"Annulla"})); expect(service.abandonDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Abbandona bozza"}));
  dialog=await screen.findByRole("dialog",{name:"Abbandona bozza"});
  fireEvent.click(within(dialog).getByRole("button",{name:"Conferma abbandono"}));
  await waitFor(()=>expect(onExit).toHaveBeenCalledTimes(1));
  expect(service.abandonDraft).toHaveBeenCalledWith(draft);
  expect(screen.queryByText("Bozza buche in corso")).not.toBeInTheDocument();
  expect(service.saveDraft).not.toHaveBeenCalled(); expect(service.publishDraft).not.toHaveBeenCalled();
});

test.each(["40001","23514","42501","55P03"])("publication failure %s retains grid/confirmation and never claims success",async(code)=>{
  const logged=jest.spyOn(console,"error").mockImplementation(()=>{});
  const service=makeService(); service.publishDraft.mockRejectedValue({code}); const onPublished=jest.fn();
  render(<Harness service={service} onPublished={onPublished}/>);
  await screen.findByLabelText("Par buca 1"); changeSi();
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true})); const dialog=await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button",{name:"Conferma pubblicazione"}));
  await within(dialog).findByRole("alert"); expect(onPublished).not.toHaveBeenCalled(); expect(screen.getByText("Bozza buche in corso")).toBeInTheDocument();
  logged.mockRestore();
});

test("adapter allowlists row fields and rejects empty or mismatched publication responses",async()=>{
  const client={rpc:jest.fn().mockResolvedValue({data:[draft],error:null})}; const service=createHoleGridEditorService(client);
  const fields={holes:snapshot.holes.map(h=>({...h,source_stroke_index:3,route_id:"forbidden"})),source_payload:{}};
  await service.saveDraft(draft,fields);
  expect(client.rpc).toHaveBeenCalledWith("admin_hole_grid_save_draft",{p_draft_id:draft.draft_id,p_snapshot:snapshot,p_expected_revision:1});
  client.rpc.mockResolvedValue({data:null,error:null}); await expect(service.openDraft(route.id)).rejects.toThrow("no single result");
  client.rpc.mockResolvedValue({data:{version_id:"v1",route_id:"other",context},error:null}); await expect(service.publishDraft(draft)).rejects.toThrow("no live result");
  client.rpc.mockResolvedValue({data:{...draft,workflow_status:"archived"},error:null}); await service.abandonDraft(draft);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_hole_grid_archive_draft",{p_draft_id:draft.draft_id,p_expected_revision:1});
});

test("Route detail shows management entry and saved grid badge using read-only get",async()=>{
  const service={getRoute:jest.fn().mockResolvedValue({draft:null,context})}; const holeService=makeService(); const onManageHoles=jest.fn();
  render(<RouteDetail {...{club,route,service,holeService,onManageHoles}} onEdit={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button",{name:"Gestisci buche"}));
  await screen.findByText("Bozza buche in corso");
  expect(onManageHoles).toHaveBeenCalledTimes(1); expect(holeService.getGrid).toHaveBeenCalledWith(route.id);
  expect(holeService.openDraft).not.toHaveBeenCalled();
});

test("empty real grid remains explicit and cannot publish or create any rows",async()=>{
  const service=makeService(); service.openDraft.mockResolvedValue({draft:{...draft,snapshot:{holes:[]}},context:{...context,holes:[],checks:{...context.checks,actual_holes:0}}});
  render(<Harness service={service}/>);
  await screen.findByText(/Nessuna buca esistente disponibile/);
  expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  expect(screen.getByRole("button",{name:"Pubblica",exact:true})).toBeDisabled();
});
