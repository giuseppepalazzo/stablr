import { fireEvent, render, screen, within } from "@testing-library/react";
import { supabase } from "../lib/supabase";
import { AdminShell } from "./AdminApp";
import { courseTeeDiff, normalizeCourseTeeFields } from "./course-tee-editor-data";
jest.mock("../lib/supabase",()=>({hasSupabaseConfig:true,supabase:{from:jest.fn(),rpc:jest.fn()}}));

test("Admin Club → actual combination → Gestisci tee → saved resume → preview/confirm → same combination, with no course tee writes",async()=>{
  const courses=[0,1].map(i=>({id:`course-${i}`,name:`Percorso ${i}`,holes_count:9,is_active:true,route_holes:[],route_tees:[]}));
  const combination={id:"combo",name:"Championship Bianco/Blu",holes_count:18,total_par:72,front_route_id:courses[0].id,back_route_id:courses[1].id,is_active:true};
  const tee={id:"combination-tee",route_combination_id:combination.id,tee_name:"Giallo",tee_color:"yellow",gender:null,display_order:null,
    holes_count:18,effective_holes_count:18,par_total:72,course_rating:72.1,slope_rating:125,is_active:true};
  const club={id:"club",name:"Parco De' Medici",playable:true,is_active:true,source_payload:{},course_routes:courses,route_combinations:[combination]};
  const context={route:{holes_count:18,total_par:72},origins:[],holes:[],checks:{}};
  let draft=null;
  supabase.from.mockImplementation(table=>{const q={select:jest.fn(()=>q),eq:jest.fn(()=>q),in:jest.fn(()=>q),order:jest.fn(()=>Promise.resolve({data:table==="clubs"?[club]:[],error:null}))};return q;});
  supabase.rpc.mockImplementation(async(name,p)=>{
    if(name==="admin_user_directory")return{data:[],error:null};
    if(["admin_club_get_draft","admin_course_get_draft"].includes(name))return{data:null,error:null};
    if(name==="admin_route_get_draft")return{data:{draft:null,context},error:null};
    if(name==="admin_hole_grid_get_draft")return{data:{draft:null,context},error:null};
    if(name==="admin_combination_tee_list"){
      expect(p.p_combination_id).toBe(combination.id);return{data:{combination,tees:[tee],new_drafts:[]},error:null};
    }
    if(name==="admin_combination_tee_open_draft"){
      expect(p.p_tee_id).toBe(tee.id);
      if(!draft){const s=normalizeCourseTeeFields(tee);draft={draft_id:"tee-draft",entity_type:"combination_tee",live_entity_id:tee.id,revision:1,snapshot:s,base_snapshot:{...s,_context:{tee:{...tee},combination}}};}
      return{data:{draft,context:{tee,combination}},error:null};
    }
    if(name==="admin_combination_tee_save_draft"){draft={...draft,revision:draft.revision+1,snapshot:p.p_snapshot};return{data:draft,error:null};}
    if(name==="admin_combination_tee_preview_draft")return{data:{draft_id:draft.draft_id,revision:draft.revision,can_publish:true,blockers:[],
      diff:Object.fromEntries(courseTeeDiff(draft.base_snapshot,draft.snapshot).map(row=>[row.key,{before:row.before,after:row.after}])),
      foundation_impact:{may_block_par:true,coverage:"verified_links",baselines_updated:false,classification_count:1,
        configurations:[{id:"config",label:combination.name,holes_count:18,source_state:"matched",tee_state:"not_recorded",reason:"tee_classification_baseline"}]}},error:null};
    if(name==="admin_combination_tee_publish_draft"){
      expect(p).toEqual({p_draft_id:draft.draft_id,p_expected_revision:draft.revision});const id=draft.draft_id;
      Object.assign(tee,draft.snapshot);draft=null;return{data:{draft_id:id,version_id:"version",context:{tee,combination}},error:null};
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  render(<AdminShell onSignOut={jest.fn()}/>);const sidebar=screen.getByRole("navigation",{name:"Navigazione amministrazione"});
  fireEvent.click(within(sidebar).getByRole("button",{name:"Club e percorsi"}));fireEvent.click(await screen.findByText(club.name,{selector:"strong"}));
  fireEvent.click(screen.getByText(combination.name,{selector:"strong"}).closest("button"));
  await screen.findByRole("button",{name:"Gestisci tee"});expect(draft).toBeNull();fireEvent.click(screen.getByRole("button",{name:"Gestisci tee"}));
  fireEvent.click(await screen.findByRole("button",{name:"Apri tee Giallo · 18 buche"}));fireEvent.click(screen.getByRole("button",{name:"Modifica dati"}));
  await screen.findByLabelText("CR");fireEvent.change(screen.getByLabelText("CR"),{target:{value:"72,5"}});
  fireEvent.click(screen.getByRole("button",{name:"Salva bozza"}));await screen.findByText(/Bozza salvata/);expect(tee.course_rating).toBe(72.1);
  fireEvent.click(screen.getByRole("button",{name:"Tee e rating",exact:true}));fireEvent.click(await screen.findByRole("button",{name:"Apri tee Giallo · 18 buche"}));
  fireEvent.click(screen.getByRole("button",{name:"Modifica dati"}));expect(await screen.findByLabelText("CR")).toHaveValue("72.5");
  fireEvent.click(screen.getByRole("button",{name:"Pubblica",exact:true}));const dialog=await screen.findByRole("dialog",{name:"Conferma pubblicazione"});
  expect(tee.course_rating).toBe(72.1);expect(within(dialog).getByText(/bloccare successive pubblicazioni Par/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button",{name:"Conferma pubblicazione"}));await screen.findByRole("button",{name:"Modifica dati"});expect(tee.course_rating).toBe(72.5);expect(draft).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:combination.name,exact:true}));await screen.findByRole("heading",{name:combination.name});await screen.findByText("72.5");
  expect(combination.total_par).toBe(72);expect(courses.map(c=>c.holes_count)).toEqual([9,9]);
  expect(supabase.rpc.mock.calls.some(([name])=>name.startsWith("admin_course_tee_")||name.startsWith("admin_hole_grid_save")||name.startsWith("admin_hole_grid_publish"))).toBe(false);
});
