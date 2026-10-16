import {useState} from "react";
import {fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {CatalogMetadataFields,CatalogMetadataHistory,CatalogMetadataPublication} from "./CatalogMetadata";
import {createCatalogMetadataService,normalizeEditorialFields,validEditorialFields} from "./catalog-metadata-data";
import {getCourseDiff,hasCourseDraftChanges} from "./course-editor-data";
import {getRouteDiff,applyRoutePublication} from "./route-editor-data";

function Fields() {
  const [fields,setFields]=useState({display_order:0,aliases:[],notes:null});
  return <CatalogMetadataFields fields={fields} update={(key,value)=>setFields(f=>({...f,[key]:value}))}/>;
}
const plan={kind:"route",can_publish:true,changes:{name:{before:"Originale",after:"Curato"},aliases:{before:[],after:["Nome alternativo"]}},
  blockers:[],warnings:["La modifica live può invalidare baseline verificate."],
  impact:{metadata_only:false,live_record_changes:true,source_links_count:1,foundation:Array.from({length:8},(_,i)=>({id:`cfg-${i}`,label:`Configurazione ${i+1}`,revision:2,review_status:"verified"}))}};
const version={version_id:"version-1",version_number:1,published_at:"2026-10-16T10:00:00Z",note:"Nota editoriale",
  changes:{name:{before:"Originale",after:"Curato"}}};

test("normalizes editorial fields once, including old drafts without metadata and exact array diffs",()=>{
  expect(normalizeEditorialFields({aliases:" Nove \n\n Altro ",notes:" Nota "})).toEqual({aliases:["Nove","Altro"],notes:"Nota"});
  const base={name:"Percorso",holes_count:9,display_order:null,is_active:true};
  expect(getCourseDiff(base,{...base,aliases:[],notes:" "})).toEqual([]);
  expect(hasCourseDraftChanges(base,{snapshot:{...base,aliases:["Alternativo"]}})).toBe(true);
  expect(getRouteDiff({name:"Combinazione",is_active:true},{name:"Combinazione",is_active:true,aliases:["Altro"],notes:"Nota",display_order:0}).map(c=>c.key)).toEqual(["display_order","aliases","notes"]);
  for(const aliases of [["A"," a "],Array(21).fill("a"),["x".repeat(201)]])expect(validEditorialFields({aliases})).toBe(false);
});

test("order is nullable/noncyclic int32; invalid attempts get feedback without silent clamping",()=>{
  render(<Fields/>);
  const order=screen.getByLabelText("Ordine");
  expect(order).toHaveAttribute("min","-2147483648");expect(order).toHaveAttribute("max","2147483647");
  fireEvent.change(order,{target:{value:"2147483647"}});expect(order).toHaveValue(2147483647);
  fireEvent.change(order,{target:{value:"2147483648"}});expect(order).toHaveValue(2147483647);expect(screen.getByRole("alert")).toHaveTextContent("Ordine rifiutato");
  fireEvent.change(order,{target:{value:"-2147483648"}});expect(order).toHaveValue(-2147483648);
  fireEvent.change(order,{target:{value:"1.5"}});expect(order).toHaveValue(-2147483648);
  fireEvent.change(order,{target:{value:""}});expect(order).toHaveValue(null);expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Alias (uno per riga)"),{target:{value:"A\na"}});expect(screen.getByRole("alert")).toHaveTextContent("alias distinti");
});

test("server preview retains before/after, themed expansion, mandatory note and visible baseline warning",()=>{
  const confirm=jest.fn(),cancel=jest.fn();
  const View=()=>{const[note,setNote]=useState("");return <CatalogMetadataPublication plan={plan} note={note} onNote={setNote} busy={false} onConfirm={confirm} onCancel={cancel} label="percorso"/>;};
  render(<View/>);const dialog=screen.getByRole("dialog",{name:"Conferma pubblicazione"});
  expect(within(dialog).getByRole("table")).toHaveTextContent("Nome alternativo");
  expect(within(dialog).getByText(/può invalidare baseline/)).toHaveClass("stablr-admin-metadata-warning");
  expect(screen.queryByText(/Configurazione 7/)).not.toBeInTheDocument();
  const expansion=within(dialog).getByRole("button",{name:"Mostra tutto · configurazioni interessate"});
  expect(expansion).toHaveClass("stablr-admin-abandon-button");fireEvent.click(expansion);expect(screen.getByText(/Configurazione 8/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button",{name:"Riduci · configurazioni interessate"}));expect(screen.queryByText(/Configurazione 7/)).not.toBeInTheDocument();
  const button=within(dialog).getByRole("button",{name:"Conferma pubblicazione"});expect(button).toBeDisabled();
  const note=within(dialog).getByLabelText("Motivazione breve");
  note.focus();fireEvent.keyDown(note,{key:"Tab"});expect(note).toHaveFocus();
  const last=within(dialog).getByRole("button",{name:"Annulla"});last.focus();fireEvent.keyDown(last,{key:"Tab"});expect(expansion).toHaveFocus();
  fireEvent.change(within(dialog).getByLabelText("Motivazione breve"),{target:{value:"Decisione esplicita"}});fireEvent.click(button);expect(confirm).toHaveBeenCalledTimes(1);
  const annul=within(dialog).getByRole("button",{name:"Annulla"});expect(annul).toHaveClass("stablr-admin-abandon-button");fireEvent.click(annul);expect(cancel).toHaveBeenCalledTimes(1);
});

test("structural server blockers cannot be bypassed by entering a confirmation note",()=>{
  render(<CatalogMetadataPublication plan={{...plan,can_publish:false,blockers:["Struttura non coerente"]}} note="Confermo" onNote={jest.fn()} onConfirm={jest.fn()} onCancel={jest.fn()} label="Route"/>);
  expect(screen.getByRole("alert")).toHaveTextContent("Struttura non coerente");
  expect(screen.getByRole("button",{name:"Conferma pubblicazione"})).toBeDisabled();
});

test.each(["route","route_combination"])("%s: aliases/notes and separate ordering show neutral information, not a physical-baseline warning",kind=>{
  const changes={aliases:{before:[],after:["Alternativo"]},notes:{before:null,after:"Nota"},
    ...(kind==="route_combination"?{display_order:{before:null,after:0}}:{})};
  render(<CatalogMetadataPublication plan={{...plan,kind,changes,warnings:[],impact:{...plan.impact,metadata_only:true,live_record_changes:false}}}
    note="Decisione" onNote={jest.fn()} onConfirm={jest.fn()} onCancel={jest.fn()} label={kind}/>);
  expect(screen.getByText(/il record live e la sua data di aggiornamento non cambiano/).closest(".stablr-admin-metadata-info")).not.toBeNull();
  expect(screen.queryByText(/Dipendenza coinvolta/)).not.toBeInTheDocument();
  expect(document.querySelector(".stablr-admin-metadata-warning")).toBeNull();
  expect(screen.getByRole("button",{name:"Mostra tutto · configurazioni collegate (non modificate)"})).toHaveClass("stablr-admin-abandon-button");
});

test.each(["route","route_combination"])("%s: curated name plus aliases/notes retains the server warning and explains the exact source dependency",kind=>{
  render(<CatalogMetadataPublication plan={{...plan,kind,impact:{...plan.impact,source_links_count:kind==="route"?1:0}}}
    note="Decisione" onNote={jest.fn()} onConfirm={jest.fn()} onCancel={jest.fn()} label={kind}/>);
  expect(screen.getByText(/Campi live modificati:/)).toHaveTextContent("Nome visualizzato");
  expect(screen.getByText(/Dipendenza coinvolta:/)).toHaveTextContent(`record ${kind==="route"?"Percorso":"combinazione"}`);
  expect(screen.getByText(/Dipendenza coinvolta:/)).toHaveTextContent("include nome e data di aggiornamento");
  expect(screen.getByText(/può invalidare baseline/)).toHaveClass("stablr-admin-metadata-warning");
  expect(screen.queryByText(/Collegamenti fisici del Percorso coinvolti/)!==null).toBe(kind==="route");
  expect(screen.getByText(/Configurazione 1 ·/)).toBeInTheDocument();
});

test("neutral editorial information never suppresses a server warning about other drafts",()=>{
  const warning="Sono presenti altre bozze sul record: le loro basi dovranno essere ricontrollate dopo la pubblicazione.";
  render(<CatalogMetadataPublication plan={{...plan,changes:{notes:{before:null,after:"Nota"}},warnings:[warning],
    impact:{...plan.impact,metadata_only:true,live_record_changes:false,other_drafts:1}}}
    note="Decisione" onNote={jest.fn()} onConfirm={jest.fn()} onCancel={jest.fn()} label="percorso"/>);
  expect(screen.getByText(warning)).toHaveClass("stablr-admin-metadata-warning");
  expect(screen.getByText(/il record live e la sua data di aggiornamento non cambiano/)).toBeInTheDocument();
});

test("history only reads until an explicit second confirmation restores a new draft",async()=>{
  const onRestored=jest.fn(),service={getHistory:jest.fn().mockResolvedValue({fields:{aliases:["Altro"],notes:"Nota",display_order:0},history:[version],has_open_draft:false}),restoreVersion:jest.fn().mockResolvedValue({draft:{draft_id:"new"}})};
  render(<CatalogMetadataHistory target="course-1" service={service} onRestored={onRestored}/>);
  const restore=await screen.findByRole("button",{name:"Ripristina versione 1 in nuova bozza"});
  expect(service.restoreVersion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Differenze versione 1"}));
  expect(screen.getByRole("table",{name:"Differenze versione 1"})).toHaveTextContent("Originale");
  fireEvent.click(restore);const dialog=screen.getByRole("dialog",{name:"Ripristina metadati in nuova bozza"});
  expect(within(dialog).getByText(/Il live non cambia/)).toBeInTheDocument();expect(service.restoreVersion).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button",{name:"Conferma nuova bozza"}));
  await waitFor(()=>expect(onRestored).toHaveBeenCalledTimes(1));expect(service.restoreVersion).toHaveBeenCalledWith("course-1",version);
});

test("restore never replaces a personal draft and empty history is explicit",async()=>{
  const service={getHistory:jest.fn().mockResolvedValue({fields:{},history:[version],has_open_draft:true}),restoreVersion:jest.fn()};
  const view=render(<CatalogMetadataHistory target="course-1" service={service} onRestored={jest.fn()}/>);
  expect(await screen.findByRole("button",{name:"Ripristina versione 1 in nuova bozza"})).toBeDisabled();expect(screen.getByText(/Nessuna bozza viene sovrascritta/)).toBeInTheDocument();
  service.getHistory.mockResolvedValue({fields:{},history:[],has_open_draft:false});view.rerender(<CatalogMetadataHistory target="course-2" service={service} onRestored={jest.fn()}/>);
  await screen.findByText("Nessuna versione pubblicata disponibile.");expect(service.restoreVersion).not.toHaveBeenCalled();
});

test("adapter requires exact server preview, draft ownership context and note before publication",async()=>{
  const draft={entity_type:"route",live_entity_id:"course-1",draft_id:"draft-1",workflow_status:"draft",revision:2};
  const preview={...plan,draft_id:draft.draft_id,target_id:draft.live_entity_id,revision:2,confirmation_hash:"a".repeat(64)};
  const client={rpc:jest.fn().mockResolvedValue({data:preview,error:null})},service=createCatalogMetadataService(client,"route");
  expect(await service.previewDraft(draft)).toBe(preview);
  for(const p of [null,{...preview,target_id:"other"},{...preview,revision:1},{...preview,can_publish:false}])await expect(service.publishDraft(draft,p,"Nota")).rejects.toThrow();
  await expect(service.publishDraft(draft,preview," ")).rejects.toThrow();expect(client.rpc).toHaveBeenCalledTimes(1);
  client.rpc.mockResolvedValue({data:{draft_id:"draft-1",version_id:"v1",course:{id:"course-1"}},error:null});
  await service.publishDraft(draft,preview," Nota ");expect(client.rpc).toHaveBeenLastCalledWith("admin_catalog_metadata",expect.objectContaining({p_action:"publish",p_confirmation_hash:preview.confirmation_hash,p_note:"Nota",p_expected_revision:2}));
});

test("combination publication immediately projects curated display order, aliases and notes",()=>{
  const club={routes:[],combinations:[{id:"c1",name:"B",isActive:true},{id:"c2",name:"A",isActive:true,displayOrder:2}]};
  const changed=applyRoutePublication(club,{id:"c1",name:"Curato",is_active:true,display_order:0,aliases:["Altro"],notes:"Nota"});
  expect(changed.combinations.map(c=>c.id)).toEqual(["c1","c2"]);expect(changed.combinations[0]).toMatchObject({aliases:["Altro"],notes:"Nota",displayOrder:0});
});
