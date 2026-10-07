import { fireEvent,render,screen,waitFor,within } from "@testing-library/react";
import { supabase } from "../lib/supabase";
import { AdminShell } from "./AdminApp";
jest.mock("../lib/supabase",()=>({hasSupabaseConfig:true,supabase:{from:jest.fn(),rpc:jest.fn()}}));

test("simple nine-hole course opens its own physical grid, guards metadata exit, resumes, publishes and returns to CourseEditor",async()=>{
  const holes=Array.from({length:9},(_,i)=>({id:`physical-${i+1}`,physical_hole_number:i+1,
    par:[5,3,4,3,4,5,4,4,3][i],stroke_index:[11,17,1,7,9,5,3,13,15][i],display_label:`Buca ${i+1}`}));
  const course={id:"course-nine",name:"Percorso nove fixture",holes_count:9,total_par:35,display_order:1,is_active:true,route_holes:holes,route_tees:[]};
  const empty={...course,id:"course-empty",name:"Percorso senza buche",route_holes:[]};
  const club={id:"club-nine",name:"Club nove fixture",city:"Roma",playable:true,is_active:true,data_status:"needs_review",source_type:"fig_import",
    source_payload:{},course_routes:[course,empty],route_combinations:[]};
  const drafts=new Map(); let gridDraft=null;
  const context=()=>({course:{id:course.id,name:course.name,holes_count:9,total_par:35},holes,
    si_sequence:[1,3,5,7,9,11,13,15,17],checks:{actual_holes:9,duplicate_numbers:0,invalid_numbers:0,missing_numbers:[]}});
  supabase.from.mockImplementation(table=>{const query={select:jest.fn(()=>query),eq:jest.fn(()=>query),in:jest.fn(()=>query),
    order:jest.fn(()=>Promise.resolve({data:table==="clubs"?[club]:[],error:null}))}; return query;});
  supabase.rpc.mockImplementation(async(name,params)=>{
    if(name==="admin_user_directory")return {data:[],error:null};
    if(name==="admin_club_get_draft")return {data:null,error:null};
    if(name==="admin_course_get_draft")return {data:drafts.get(params.p_course_id)||null,error:null};
    if(name==="admin_course_open_draft") {
      const live=[course,empty].find(c=>c.id===params.p_course_id);
      if(!drafts.has(live.id)) {const snapshot={name:live.name,holes_count:live.holes_count,display_order:live.display_order,is_active:live.is_active};
        drafts.set(live.id,{draft_id:live.id,live_entity_id:live.id,revision:1,snapshot,base_snapshot:snapshot});}
      return {data:{draft:drafts.get(live.id),context:{can_edit_structure:false}},error:null};
    }
    if(name==="admin_course_save_draft") {const d=drafts.get(params.p_draft_id); const saved={...d,revision:d.revision+1,snapshot:params.p_snapshot}; drafts.set(d.live_entity_id,saved); return {data:saved,error:null};}
    if(name==="admin_course_hole_grid_open_draft") {
      expect(params.p_course_id).toBe(course.id);
      if(!gridDraft) {const snapshot={holes:holes.map(({id,physical_hole_number,par,stroke_index})=>({id,physical_hole_number,par,stroke_index}))};
        gridDraft={draft_id:"grid-nine",live_entity_id:course.id,revision:1,snapshot,base_snapshot:snapshot};}
      return {data:{draft:gridDraft,context:context()},error:null};
    }
    if(name==="admin_course_hole_grid_save_draft") {gridDraft={...gridDraft,revision:gridDraft.revision+1,snapshot:params.p_snapshot};return {data:gridDraft,error:null};}
    if(name==="admin_course_hole_grid_publish_draft") {
      gridDraft.snapshot.holes.forEach(h=>Object.assign(holes.find(live=>live.id===h.id),h));gridDraft=null;
      return {data:{course_id:course.id,version_id:"physical-version",context:context()},error:null};
    }
    if(name==="admin_course_hole_grid_archive_draft") {const archived={...gridDraft,workflow_status:"archived"};gridDraft=null;return {data:archived,error:null};}
    throw new Error(`Unexpected test RPC ${name}`);
  });
  render(<AdminShell onSignOut={jest.fn()}/>);
  const navigation=screen.getByRole("navigation",{name:"Navigazione amministrazione"});
  fireEvent.click(within(navigation).getByRole("button",{name:"Club e percorsi"}));
  fireEvent.click(await screen.findByText(club.name,{selector:"strong"}));
  fireEvent.click(screen.getByRole("button",{name:`Modifica percorso ${course.name}`}));
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"),{target:{value:"Bozza Percorso"}});
  fireEvent.click(screen.getByRole("button",{name:"Modifica buche"}));
  let dialog=await screen.findByRole("dialog",{name:"Modifiche non salvate"});
  fireEvent.click(within(dialog).getByRole("button",{name:"Resta"}));
  expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("Bozza Percorso");
  fireEvent.click(screen.getByRole("button",{name:"Modifica buche"}));
  dialog=await screen.findByRole("dialog",{name:"Modifiche non salvate"});
  fireEvent.click(within(dialog).getByRole("button",{name:"Salva bozza"}));
  expect(await screen.findByLabelText("SI/HCP buca 1")).toHaveValue(11);
  expect(screen.getAllByRole("spinbutton")).toHaveLength(18); expect(screen.getByText("9 / 9")).toBeInTheDocument();
  expect(course.name).toBe("Percorso nove fixture");

  fireEvent.change(screen.getByLabelText("SI/HCP buca 1"),{target:{value:"17"}});
  fireEvent.change(screen.getByLabelText("SI/HCP buca 2"),{target:{value:"11"}});
  fireEvent.click(screen.getByRole("button",{name:course.name}));
  dialog=await screen.findByRole("dialog",{name:"Modifiche non salvate"});
  fireEvent.click(within(dialog).getByRole("button",{name:"Salva bozza"}));
  expect(await screen.findByLabelText("Nome visualizzato")).toHaveValue("Bozza Percorso");
  expect(holes[0].stroke_index).toBe(11);
  fireEvent.change(screen.getByLabelText("Nome visualizzato"),{target:{value:"Non salvato"}});
  fireEvent.click(screen.getByRole("button",{name:"Modifica buche"}));
  dialog=await screen.findByRole("dialog",{name:"Modifiche non salvate"});
  fireEvent.click(within(dialog).getByRole("button",{name:"Scarta"}));
  expect(await screen.findByLabelText("SI/HCP buca 1")).toHaveValue(17);
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));
  dialog=await screen.findByRole("dialog",{name:"Conferma pubblicazione"});
  const row=within(dialog).getByText("Buca 1 · SI/HCP").closest('[role="row"]');
  expect(within(row).getAllByRole("cell").map(c=>c.textContent)).toEqual(["Buca 1 · SI/HCP","11","17"]);
  fireEvent.click(within(dialog).getByRole("button",{name:"Conferma pubblicazione"}));
  expect(await screen.findByLabelText("Nome visualizzato")).toHaveValue("Bozza Percorso");
  expect(holes[0].stroke_index).toBe(17); expect(course.total_par).toBe(35);

  fireEvent.click(screen.getByRole("button",{name:"Modifica buche"})); await screen.findByLabelText("Par buca 1");
  fireEvent.click(screen.getByRole("button",{name:"Abbandona bozza"})); dialog=await screen.findByRole("dialog",{name:"Abbandona bozza"});
  fireEvent.click(within(dialog).getByRole("button",{name:"Conferma abbandono"})); await screen.findByLabelText("Nome visualizzato");
  expect(gridDraft).toBeNull(); expect(holes[0].stroke_index).toBe(17);
  fireEvent.click(within(screen.getByRole("navigation",{name:"Percorso di navigazione"})).getByRole("button",{name:"Club e percorsi"}));
  fireEvent.click(screen.getByText(club.name,{selector:"strong"}));
  fireEvent.click(screen.getByRole("button",{name:`Modifica percorso ${empty.name}`}));
  await waitFor(()=>expect(screen.getByLabelText("Nome visualizzato")).toHaveValue(empty.name));
  expect(screen.queryByRole("button",{name:"Modifica buche"})).not.toBeInTheDocument();
  expect(supabase.rpc.mock.calls.some(([name])=>name.startsWith("admin_hole_grid_"))).toBe(false);
});
