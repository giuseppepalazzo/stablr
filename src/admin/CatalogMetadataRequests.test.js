import {StrictMode} from "react";
import {act,fireEvent,render,screen,within} from "@testing-library/react";
import CourseEditor from "./CourseEditor";
import RouteEditor from "./RouteEditor";
import {createCatalogMetadataService} from "./catalog-metadata-data";
import {metadataPlan} from "./__fixtures__/metadata-editor";

function setup(kind,{stalled="preview",published=false}={}) {
  const target={id:"target",name:"Live",holes_count:9,is_active:true,display_order:0};
  const snapshot=kind==="route"?{name:"TEST salvato",holes_count:9,display_order:0,is_active:true,aliases:[],notes:null}
    :{name:"TEST salvato",display_order:0,is_active:true,aliases:[],notes:null};
  const draft={draft_id:"draft",entity_type:kind,live_entity_id:target.id,created_by:"owner",workflow_status:"draft",revision:1,
    snapshot,base_snapshot:{...snapshot,name:"Live"}};
  const context={can_edit_structure:false,route:{holes_count:18},checks:{coherent:true,origins_active:true},origins:[],holes:[]};
  const plan=metadataPlan(draft,kind),controls={stalled,late:null,failRead:false,lateSave:false};
  const client={rpc:jest.fn((_,p)=>{
    if(p.p_action===controls.stalled)return new Promise(resolve=>{controls.late=resolve;});
    if(p.p_action==="open")return Promise.resolve({data:{draft,context},error:null});
    if(p.p_action==="preview")return Promise.resolve({data:plan,error:null});
    if(p.p_action==="detail")return Promise.resolve({data:{kind,target_id:target.id,fields:snapshot,context},error:null});
    return Promise.resolve({data:null,error:{code:"23514"}});
  }),from:jest.fn(table=>{
    const query={select:jest.fn(()=>query),eq:jest.fn(()=>query),limit:jest.fn(()=>Promise.resolve(controls.failRead?{data:null,error:{code:"42501"}}:{error:null,data:
      table==="admin_catalog_drafts"?[{...draft,workflow_status:published?"published":"draft",revision:controls.lateSave?2:1}]:
      table==="admin_catalog_versions"?[{source_draft_id:draft.draft_id,entity_type:kind,live_entity_id:target.id,version_id:"version"}]:
      [{...target,club_id:"club",name:snapshot.name}] }))};return query;
  })};
  const service=createCatalogMetadataService(client,kind,{timeoutMs:1000});service.saveDraft=service.saveMetadataDraft;service.abandonDraft=jest.fn();
  const callbacks={onPublished:jest.fn(),registerExitGuard:jest.fn(),onBack:jest.fn(),onBackToClub:jest.fn(),onBackToCatalog:jest.fn()};
  const props={club:{id:"club",name:"Club"},service,...callbacks};
  const editor=kind==="route"?<CourseEditor {...props} course={target}/>:<RouteEditor {...props} route={target}/>;
  return {editor,client,service,draft,plan,controls,...callbacks};
}

beforeEach(()=>{jest.useFakeTimers();jest.spyOn(console,"error").mockImplementation(()=>{});});
afterEach(()=>{jest.useRealTimers();jest.restoreAllMocks();});
const flush=()=>act(async()=>{});
const expire=()=>act(async()=>{jest.advanceTimersByTime(1001);});
const publishRequests=client=>client.rpc.mock.calls.filter(([,p])=>p.p_action==="publish");

describe.each(["route","route_combination"])("%s resilient metadata editor",kind=>{
  test("pending preview times out, unlocks, retains saved fields and ignores late completion; retry still needs confirmation",async()=>{
    const f=setup(kind);render(f.editor);await flush();
    const publish=screen.getByRole("button",{name:"Pubblica",exact:true});
    fireEvent.click(publish);fireEvent.click(publish);await flush();
    expect(f.client.rpc.mock.calls.filter(([,p])=>p.p_action==="preview")).toHaveLength(1);
    expect(f.client.rpc).toHaveBeenLastCalledWith("admin_catalog_metadata",expect.objectContaining({p_action:"preview"}),{get:true});
    expect(publish).toBeDisabled();expect(screen.getByText("Operazione in corso…")).toBeInTheDocument();
    await expire();expect(screen.getByRole("alert")).toHaveTextContent("tempo massimo");expect(publish).toBeEnabled();
    expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("TEST salvato");expect(publishRequests(f.client)).toHaveLength(0);
    await act(async()=>f.controls.late({data:f.plan,error:null}));expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    f.controls.stalled=null;fireEvent.click(publish);await flush();
    expect(screen.getByRole("dialog",{name:"Conferma pubblicazione"})).toBeInTheDocument();expect(publishRequests(f.client)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button",{name:"Annulla"}));expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test.each([false,true])("uncertain publication reconciles only by exact readonly queries (server committed=%s), never resubmits",async published=>{
    const f=setup(kind,{stalled:"publish",published});render(f.editor);await flush();
    fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));await flush();
    const dialog=screen.getByRole("dialog");fireEvent.change(within(dialog).getByLabelText("Motivazione breve"),{target:{value:"Decisione test"}});
    const confirm=within(dialog).getByRole("button",{name:"Conferma pubblicazione"});fireEvent.click(confirm);fireEvent.click(confirm);await flush();
    expect(publishRequests(f.client)).toHaveLength(1);await expire();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Esito non verificato");expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole("button",{name:"Annulla"})).toBeEnabled();
    const callsBefore=f.client.rpc.mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button",{name:"Verifica esito e recupera bozza"}));await flush();
    expect(publishRequests(f.client)).toHaveLength(1);
    expect(f.client.rpc.mock.calls.slice(callsBefore).every(([,p])=>p.p_action==="detail")).toBe(true);
    if(published){expect(f.onPublished).toHaveBeenCalledWith(expect.objectContaining({id:"target",name:"TEST salvato"}));}
    else {expect(f.onPublished).not.toHaveBeenCalled();expect(screen.getByRole("status")).toHaveTextContent("Bozza recuperata");expect(screen.getByRole("button",{name:"Pubblica",exact:true})).toBeEnabled();}
  });

  test("server NOWAIT error is visible and controls unlock without clearing or rebasing the draft",async()=>{
    const f=setup(kind,{stalled:null}),original=f.client.rpc.getMockImplementation();
    f.client.rpc.mockImplementation((name,p)=>p.p_action==="preview"?Promise.resolve({data:null,error:{code:"55P03"}}):original(name,p));
    render(f.editor);await flush();fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Un’altra operazione");expect(screen.getByRole("button",{name:"Pubblica",exact:true})).toBeEnabled();
    expect(f.client.rpc.mock.calls.some(([,p])=>["save","publish","restore"].includes(p.p_action))).toBe(false);
  });

  test("auto-save timeout never starts preview/publish, and recovery preserves unsaved editor values",async()=>{
    const f=setup(kind,{stalled:"save"});render(f.editor);await flush();
    fireEvent.change(screen.getByLabelText("Note catalogo"),{target:{value:"Modifica non persa"}});
    fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));await flush();await expire();
    expect(f.client.rpc.mock.calls.filter(([,p])=>p.p_action==="preview")).toHaveLength(0);expect(publishRequests(f.client)).toHaveLength(0);
    expect(screen.getByRole("button",{name:"Salva bozza",exact:true})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"Verifica esito e recupera bozza"}));await flush();
    expect(screen.getByLabelText("Note catalogo")).toHaveValue("Modifica non persa");expect(screen.getByRole("button",{name:"Salva bozza",exact:true})).toBeEnabled();
  });

  test("failed recovery unlocks retry but still blocks mutation and abandon",async()=>{
    const f=setup(kind,{stalled:"publish"});render(f.editor);await flush();fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));await flush();
    fireEvent.change(screen.getByLabelText("Motivazione breve"),{target:{value:"Decisione test"}});fireEvent.click(screen.getByRole("button",{name:"Conferma pubblicazione"}));await flush();await expire();
    f.controls.failRead=true;const recover=screen.getByRole("button",{name:"Verifica esito e recupera bozza"});fireEvent.click(recover);await flush();
    expect(recover).toBeEnabled();expect(screen.getByRole("button",{name:"Conferma pubblicazione"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Abbandona bozza",exact:true})).toBeDisabled();expect(publishRequests(f.client)).toHaveLength(1);
  });

  test("StrictMode shares a single open RPC instead of contending on NOWAIT locks",async()=>{
    const f=setup(kind,{stalled:null});render(<StrictMode>{f.editor}</StrictMode>);await flush();
    expect(f.client.rpc.mock.calls.filter(([,p])=>p.p_action==="open")).toHaveLength(1);expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("TEST salvato");
  });

  test.each(["40001","PT409"])("preview conflict %s unlocks the editor without an idle, focus or clock retry",async code=>{
    const f=setup(kind,{stalled:null});
    f.client.rpc.mockImplementation((_,p)=>Promise.resolve(p.p_action==="open"
      ?{data:{draft:f.draft,context:{checks:{coherent:true,origins_active:true}}},error:null}
      :{data:null,error:{code,message:"Base live o versione cambiata"}}));
    render(<StrictMode>{f.editor}</StrictMode>);await flush();
    const publish=screen.getByRole("button",{name:"Pubblica",exact:true});
    // Idle editors do not execute preview/save/publish in the first place.
    await act(async()=>{jest.advanceTimersByTime(5*60*1000);});
    expect(f.client.rpc).toHaveBeenCalledTimes(1);
    fireEvent.click(publish);await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("cambiati");expect(publish).toBeEnabled();
    expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("TEST salvato");
    const calls=f.client.rpc.mock.calls.length;
    fireEvent.focus(window);fireEvent(document,new Event("visibilitychange"));
    await act(async()=>{jest.advanceTimersByTime(10*60*1000);});
    expect(f.client.rpc).toHaveBeenCalledTimes(calls);expect(publishRequests(f.client)).toHaveLength(0);
    expect(f.service.abandonDraft).not.toHaveBeenCalled();
  });

  test("PT409 after final confirmation is visible, unlocks the dialog and never resubmits or discards the draft",async()=>{
    const f=setup(kind,{stalled:null}),original=f.client.rpc.getMockImplementation();
    f.client.rpc.mockImplementation((name,p)=>p.p_action==="publish"
      ?Promise.resolve({data:null,error:{code:"PT409",message:"Base live o versione cambiata"}}):original(name,p));
    render(f.editor);await flush();fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));await flush();
    const dialog=screen.getByRole("dialog",{name:"Conferma pubblicazione"});
    fireEvent.change(within(dialog).getByLabelText("Motivazione breve"),{target:{value:"Decisione test"}});
    const confirm=within(dialog).getByRole("button",{name:"Conferma pubblicazione"});fireEvent.click(confirm);fireEvent.click(confirm);await flush();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("cambiati");
    expect(confirm).toBeEnabled();expect(within(dialog).getByRole("button",{name:"Annulla"})).toBeEnabled();
    expect(publishRequests(f.client)).toHaveLength(1);
    await act(async()=>{jest.advanceTimersByTime(10*60*1000);});expect(publishRequests(f.client)).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button",{name:"Annulla"}));
    expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("TEST salvato");
    expect(f.onPublished).not.toHaveBeenCalled();expect(f.service.abandonDraft).not.toHaveBeenCalled();
  });

  test("failed draft load can be retried in place without page refresh",async()=>{
    const f=setup(kind,{stalled:"open"});render(f.editor);await flush();await expire();
    expect(screen.getByRole("alert")).toHaveTextContent("tempo massimo");f.controls.stalled=null;
    fireEvent.click(screen.getByRole("button",{name:"Riprova caricamento bozza"}));await flush();
    expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("TEST salvato");expect(publishRequests(f.client)).toHaveLength(0);
  });
});

test("deadline aborts the actual PostgREST request and never accepts a late response",async()=>{
  let signal;const builder={abortSignal:jest.fn(s=>{signal=s;return new Promise(()=>{});})},client={rpc:jest.fn(()=>builder)};
  const service=createCatalogMetadataService(client,"route",{timeoutMs:1000});
  const pending=service.openDraft("target");const rejected=expect(pending).rejects.toMatchObject({code:"METADATA_TIMEOUT"});await expire();await rejected;
  expect(signal.aborted).toBe(true);expect(client.rpc).toHaveBeenCalledTimes(1);
});

test("uncertain mutation cannot be repeated; reopening reconciles the known draft without creating another",async()=>{
  const f=setup("route",{stalled:"publish",published:true});const pending=f.service.publishDraft(f.draft,f.plan,"Decisione test");
  const rejected=expect(pending).rejects.toMatchObject({requiresRecovery:true});await expire();await rejected;
  await expect(f.service.publishDraft(f.draft,f.plan,"Decisione test")).rejects.toMatchObject({requiresRecovery:true});
  await expect(f.service.openDraft("target")).rejects.toMatchObject({code:"METADATA_ALREADY_PUBLISHED"});
  expect(publishRequests(f.client)).toHaveLength(1);expect(f.client.rpc.mock.calls.some(([,p])=>p.p_action==="open")).toBe(false);
});
