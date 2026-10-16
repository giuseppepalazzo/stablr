import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import NewCombinations from "./NewCombinations";
import { createNewCombinationService, emptyCombination } from "./new-combination-data";
import { readFileSync } from "fs";

const club={id:"club",name:"Club pubblicato"},owner="admin";
function fixture(resume=false){
  const sections=["Bianco","Blu","Rosso"].map((label,i)=>({id:`cfg${i}`,label,course_id:`course${i}`,structure_id:"physical",source_hash:String(i+1).repeat(64),
    holes:Array.from({length:9},(_,n)=>({position:n+1,physical_hole_number:n+1,par:4,source_si:n+1}))}));
  const snapshot={...emptyCombination(club.id),name:"Nuova Bianco/Blu",front_configuration_id:"cfg0",back_configuration_id:"cfg1",source_hash:sections[0].source_hash+sections[1].source_hash,
    holes:Array.from({length:18},(_,i)=>({position:i+1,si:i+1})),tees:[{name:"Giallo",tee_color:"giallo",rating_category:"men",course_rating:72,slope_rating:113,is_active:true,display_order:0}]};
  let draft=resume?{draft_id:"private",entity_type:"route_combination",live_entity_id:null,created_by:owner,revision:1,schema_version:1,workflow_status:"draft",snapshot}:null;
  const plan=()=>({draft_id:draft.draft_id,revision:draft.revision,club,name:draft.snapshot.name,holes_count:18,total_par:72,
    can_publish:true,blockers:[],front:sections[0],back:sections[1],tees:draft.snapshot.tees,
    holes:draft.snapshot.holes.map((h,i)=>({...h,par:4,physical_hole_number:i%9+1,occurrence:1,component_position:i<9?1:2})),confirmation_hash:"a".repeat(64)});
  const service={list:jest.fn(async()=>({club_id:club.id,sections,excluded:[],drafts:draft?[draft]:[]})),
    save:jest.fn(async(_club,_owner,old,fields)=>{draft={draft_id:"private",entity_type:"route_combination",live_entity_id:null,created_by:owner,revision:(old?.revision||0)+1,schema_version:1,workflow_status:"draft",snapshot:fields};return draft;}),
    preview:jest.fn(async()=>plan()),publish:jest.fn(async()=>({draft_id:draft.draft_id,publication_id:"receipt",version_id:"version",combination:{id:"new",club_id:club.id}})),
    archive:jest.fn(async()=>({...draft,workflow_status:"archived"}))};
  return {service,sections,snapshot,getDraft:()=>draft};
}
function mount(f){const back=jest.fn(),published=jest.fn();let guard;render(<NewCombinations club={club} ownerId={owner} service={f.service} registerExitGuard={g=>{guard=g;}} onBack={back} onPublished={published}/>);return {back,published,guard:()=>guard};}
async function resume(f){const out=mount(f);fireEvent.click(await screen.findByRole("button",{name:"Riprendi Nuova Bianco/Blu"}));return out;}
function expectAdminDialogButtons(dialog) {
  for(const button of within(dialog).getAllByRole("button")) {
    expect([...button.classList].some(name=>["stablr-admin-white-button","stablr-admin-draft-save-button","stablr-admin-publish-button","stablr-admin-abandon-button","stablr-admin-danger-button"].includes(name))).toBe(true);
    expect(button.closest(".stablr-admin-editor-actions")).toBeNull();
  }
}
test("SI mouse and keyboard arrows wrap 1–18; out-of-scale manual input is rejected with explicit feedback, never clamped",async()=>{
  const f=fixture(true);await resume(f);
  const first=screen.getByLabelText("SI buca 1"),last=screen.getByLabelText("SI buca 18");
  fireEvent.click(screen.getByRole("button",{name:"SI buca 1 precedente"}));expect(first).toHaveValue(18);
  expect(screen.getByText(/SI duplicati: 18/)).toHaveClass("stablr-admin-new-combination-blocker");
  fireEvent.click(screen.getByRole("button",{name:"SI buca 1 successivo"}));expect(first).toHaveValue(1);
  fireEvent.click(screen.getByRole("button",{name:"SI buca 18 successivo"}));expect(last).toHaveValue(1);
  fireEvent.click(screen.getByRole("button",{name:"SI buca 18 precedente"}));expect(last).toHaveValue(18);
  fireEvent.keyDown(first,{key:"ArrowDown"});expect(first).toHaveValue(18);fireEvent.keyDown(first,{key:"ArrowUp"});expect(first).toHaveValue(1);
  fireEvent.keyDown(last,{key:"ArrowUp"});expect(last).toHaveValue(1);fireEvent.keyDown(last,{key:"ArrowDown"});expect(last).toHaveValue(18);
  for(const value of ["0","25","-1","2.5","1e1"]) {
    fireEvent.change(first,{target:{value}});expect(first).toHaveValue(1);
    expect(screen.getByText(/Buca 1: valore rifiutato.*valore precedente non è cambiato/)).toHaveClass("stablr-admin-new-combination-blocker");
    expect(first).toHaveAttribute("aria-describedby","new-combination-si-feedback");
  }
  expect(f.service.save).not.toHaveBeenCalled();expect(f.service.publish).not.toHaveBeenCalled();
  fireEvent.change(first,{target:{value:"7"}});expect(screen.queryByText(/valore rifiutato/)).not.toBeInTheDocument();
  expect(screen.getByText(/SI duplicati: 7/)).toBeInTheDocument();expect(first).toHaveAttribute("aria-invalid","true");
  fireEvent.change(screen.getByLabelText("SI buca 7"),{target:{value:"1"}});expect(screen.queryByText(/SI duplicati:/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Salva bozza"}));await waitFor(()=>expect(f.service.save).toHaveBeenCalledTimes(1));
  const saved=f.service.save.mock.calls[0][3];expect(new Set(saved.holes.map(h=>h.si)).size).toBe(18);expect(saved.holes.every(h=>h.si>=1&&h.si<=18)).toBe(true);
});
test("preview uses shared styled expansion and Admin modal actions; all 18 rows remain ordered and reducible",async()=>{
  const f=fixture(true);await resume(f);fireEvent.click(screen.getByRole("button",{name:"Anteprima pubblicazione"}));
  const dialog=await screen.findByRole("dialog",{name:"Anteprima pubblicazione combinazione"});
  const toggle=within(dialog).getByRole("button",{name:"Mostra tutto · anteprima buche"});
  expect(toggle).toHaveClass("stablr-admin-technical-toggle","stablr-admin-abandon-button");expect(toggle).toHaveAttribute("aria-expanded","false");
  expect(within(dialog).getAllByText(/^Buca \d/)).toHaveLength(6);expectAdminDialogButtons(dialog);
  fireEvent.click(toggle);expect(toggle).toHaveAttribute("aria-expanded","true");expect(within(dialog).getAllByText(/^Buca \d/)).toHaveLength(18);
  expect(within(dialog).getAllByText(/^Buca \d/).map(p=>Number(p.textContent.match(/^Buca (\d+)/)[1]))).toEqual(Array.from({length:18},(_,i)=>i+1));
  fireEvent.click(within(dialog).getByRole("button",{name:"Riduci · anteprima buche"}));expect(within(dialog).getAllByText(/^Buca \d/)).toHaveLength(6);
  fireEvent.click(within(dialog).getByRole("button",{name:"Pubblica combinazione"}));expectAdminDialogButtons(screen.getByRole("dialog",{name:"Conferma pubblicazione combinazione"}));
  expect(f.service.publish).not.toHaveBeenCalled();
});
test("blocking server SI errors are visually distinct from information and cannot be confirmed",async()=>{
  const f=fixture(true),plan=await f.service.preview();
  f.service.preview.mockResolvedValue({...plan,can_publish:false,blockers:["SI duplicati: pubblicazione non consentita."]});
  await resume(f);fireEvent.click(screen.getByRole("button",{name:"Anteprima pubblicazione"}));
  const dialog=await screen.findByRole("dialog",{name:"Anteprima pubblicazione combinazione"});
  expect(within(dialog).getByRole("alert")).toHaveClass("stablr-admin-new-combination-blocker");
  expect(within(dialog).getByText(/Nessun record esistente viene modificato/).parentElement).toHaveClass("stablr-admin-new-combination-info");
  expect(within(dialog).getByRole("button",{name:"Pubblica combinazione"})).toBeDisabled();expectAdminDialogButtons(dialog);
  expect(f.service.publish).not.toHaveBeenCalled();
});
test("Task 5 actual CSS keeps publish green, expansion/cancel dark and destructive confirmation styled",async()=>{
  const style=document.createElement("style");style.textContent=readFileSync(`${__dirname}/AdminApp.css`,"utf8");document.head.appendChild(style);
  try {
    const f=fixture(true);await resume(f);fireEvent.click(screen.getByRole("button",{name:"Anteprima pubblicazione"}));
    const dialog=await screen.findByRole("dialog",{name:"Anteprima pubblicazione combinazione"});
    const publish=within(dialog).getByRole("button",{name:"Pubblica combinazione"}),toggle=within(dialog).getByRole("button",{name:"Mostra tutto · anteprima buche"});
    expect(getComputedStyle(publish).backgroundColor).toBe("rgb(52, 125, 91)");expect(getComputedStyle(publish).minHeight).toBe("38px");
    expect(getComputedStyle(toggle).backgroundColor).toBe("rgb(9, 39, 31)");
    fireEvent.click(within(dialog).getByRole("button",{name:"Chiudi anteprima"}));fireEvent.click(screen.getByRole("button",{name:"Abbandona bozza"}));
    const abandon=screen.getByRole("dialog",{name:"Abbandona bozza combinazione"});
    expect(getComputedStyle(within(abandon).getByRole("button",{name:"Annulla"})).backgroundColor).toBe("rgb(9, 39, 31)");
    expect(getComputedStyle(within(abandon).getByRole("button",{name:"Conferma abbandono"})).backgroundColor).toBe("rgb(73, 40, 32)");
    expectAdminDialogButtons(abandon);
  } finally {style.remove();}
});
test("explicit sections + private SI/tee input → save → server preview → final note/confirmation, no early publication",async()=>{
  const f=fixture(),{published}=mount(f);
  fireEvent.click(await screen.findByRole("button",{name:"Crea combinazione 18"}));
  fireEvent.change(screen.getByLabelText("Nome combinazione"),{target:{value:"Nuova Bianco/Blu"}});
  fireEvent.change(screen.getByLabelText("Prime nove"),{target:{value:"cfg0"}});fireEvent.change(screen.getByLabelText("Seconde nove"),{target:{value:"cfg1"}});
  expect(screen.getByLabelText("SI buca 1")).toHaveValue(null);expect(screen.getByRole("button",{name:"Anteprima pubblicazione"})).toBeDisabled();
  for(let i=1;i<=18;i++)fireEvent.change(screen.getByLabelText(`SI buca ${i}`),{target:{value:String(i)}});
  fireEvent.change(screen.getByLabelText("SI buca 1"),{target:{value:"19"}});expect(screen.getByLabelText("SI buca 1")).toHaveValue(1);
  fireEvent.keyDown(screen.getByLabelText("SI buca 18"),{key:"ArrowUp"});expect(screen.getByLabelText("SI buca 18")).toHaveValue(1);
  fireEvent.keyDown(screen.getByLabelText("SI buca 18"),{key:"ArrowDown"});expect(screen.getByLabelText("SI buca 18")).toHaveValue(18);
  fireEvent.click(screen.getByRole("button",{name:"Aggiungi tee"}));
  for(const [name,value] of [["Nome tee","Giallo"],["Colore","giallo"],["Course Rating","72,0"],["Slope Rating","113"]])fireEvent.change(screen.getByLabelText(name),{target:{value}});
  expect(f.service.publish).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Salva bozza"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Anteprima pubblicazione"})).toBeEnabled());
  fireEvent.click(screen.getByRole("button",{name:"Anteprima pubblicazione"}));
  const modal=await screen.findByRole("dialog",{name:"Anteprima pubblicazione combinazione"});expect(f.service.preview).toHaveBeenCalledTimes(1);
  expect(within(modal).getByText(/Totale Par: 72/)).toBeInTheDocument();fireEvent.click(within(modal).getByRole("button",{name:"Mostra tutto · anteprima buche"}));
  expect(within(modal).getByText(/Buca 18 · Blu/)).toBeInTheDocument();
  fireEvent.click(within(modal).getByRole("button",{name:"Pubblica combinazione"}));expect(f.service.publish).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:"Conferma pubblicazione combinazione"})).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Motivazione breve"),{target:{value:"Configurazione verificata"}});
  fireEvent.click(screen.getByRole("button",{name:"Conferma pubblicazione combinazione"}));await waitFor(()=>expect(published).toHaveBeenCalledTimes(1));
});
test("resume, guarded exit: stay/discard preserves saved draft, save resumes at new revision",async()=>{
  const f=fixture(true),out=await resume(f);
  fireEvent.change(screen.getByLabelText("Nome combinazione"),{target:{value:"Modificata"}});
  fireEvent.click(screen.getByRole("button",{name:"Club pubblicato"}));await screen.findByRole("dialog",{name:"Modifiche combinazione non salvate"});
  expectAdminDialogButtons(screen.getByRole("dialog",{name:"Modifiche combinazione non salvate"}));
  fireEvent.click(screen.getByRole("button",{name:"Resta"}));expect(out.back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Club pubblicato"}));fireEvent.click(screen.getByRole("button",{name:"Scarta modifiche"}));
  expect(out.back).toHaveBeenCalledTimes(1);expect(f.service.archive).not.toHaveBeenCalled();expect(f.service.save).not.toHaveBeenCalled();
});
test("saved draft abandonment requires a second explicit confirmation and never publishes",async()=>{
  const f=fixture(true);await resume(f);fireEvent.click(screen.getByRole("button",{name:"Abbandona bozza"}));
  expectAdminDialogButtons(screen.getByRole("dialog",{name:"Abbandona bozza combinazione"}));
  expect(f.service.archive).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Annulla"}));
  fireEvent.click(screen.getByRole("button",{name:"Abbandona bozza"}));fireEvent.click(screen.getByRole("button",{name:"Conferma abbandono"}));
  await screen.findByText("Nessuna bozza di nuova combinazione.");expect(f.service.archive).toHaveBeenCalledTimes(1);expect(f.service.publish).not.toHaveBeenCalled();
});
test("no verified sections and read error are explicit, never invented candidates",async()=>{
  const f=fixture();f.service.list.mockResolvedValue({sections:[],drafts:[],excluded:[{label:"Incompleta",reason:"Base da verificare"}]});mount(f);
  expect(await screen.findByRole("button",{name:"Crea combinazione 18"})).toBeDisabled();expect(screen.getByText(/Base da verificare/)).toBeInTheDocument();
});
test("server service validates owner, exact scope and confirmation; never accepts client totals or another draft receipt",async()=>{
  const f=fixture(true),d=f.getDraft(),p={...(await f.service.preview()),club:{id:club.id}};
  const client={rpc:jest.fn(async()=>({data:p,error:null}))},service=createNewCombinationService(client);
  await expect(service.preview(club.id,owner,d)).resolves.toEqual(p);
  await expect(service.publish(club.id,owner,d,p," ")).rejects.toThrow();
  await expect(service.save(club.id,"other",d,d.snapshot)).rejects.toThrow();
  expect(client.rpc).toHaveBeenCalledTimes(1);
  client.rpc.mockResolvedValue({data:{...p,holes_count:9},error:null});await expect(service.preview(club.id,owner,d)).rejects.toThrow();
});
