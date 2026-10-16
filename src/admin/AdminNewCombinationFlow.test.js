import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminShell } from "./AdminApp";
import { supabase } from "../lib/supabase";
jest.mock("../lib/supabase",()=>({hasSupabaseConfig:true,supabase:{from:jest.fn(),rpc:jest.fn()}}));
test("Club entry resumes a private combination, confirms its server preview and adds only the published receipt",async()=>{
  const routes=[0,1].map(i=>({id:`course${i}`,name:`Percorso ${i+1}`,holes_count:9,is_active:true,route_holes:[],route_tees:[]}));
  const club={id:"club",name:"Club pubblicato",playable:true,is_active:true,data_status:"verified",course_routes:routes,route_combinations:[]};
  const original=JSON.stringify(club);
  const sections=routes.map((r,i)=>({id:`cfg${i}`,course_id:r.id,label:r.name,structure_id:"structure",source_hash:"a".repeat(64),
    holes:Array.from({length:9},(_,n)=>({position:n+1,physical_hole_number:n+1,par:4}))}));
  const snapshot={club_id:club.id,name:"Combinazione nuova",front_configuration_id:"cfg0",back_configuration_id:"cfg1",source_hash:"a".repeat(128),
    holes:Array.from({length:18},(_,i)=>({position:i+1,si:i+1})),tees:[{name:"Giallo",tee_color:"giallo",rating_category:"men",course_rating:72,slope_rating:113,is_active:true,display_order:0}]};
  const draft={draft_id:"private",entity_type:"route_combination",live_entity_id:null,created_by:"admin",schema_version:1,revision:1,workflow_status:"draft",snapshot};
  const holes=snapshot.holes.map((h,i)=>({...h,par:4,physical_hole_number:i%9+1,occurrence:1,component_position:i<9?1:2}));
  const plan={draft_id:draft.draft_id,revision:1,club:{id:club.id,name:club.name},name:snapshot.name,holes_count:18,total_par:72,can_publish:true,blockers:[],front:sections[0],back:sections[1],holes,tees:snapshot.tees,confirmation_hash:"b".repeat(64)};
  const live={id:"new-combination",club_id:club.id,name:snapshot.name,front_route_id:"course0",back_route_id:"course1",holes_count:18,is_active:true,total_par:72,route_combination_holes:holes,combination_tees:[{id:"new-tee",tee_name:"Giallo",holes_count:18,course_rating:72,slope_rating:113,par_total:72}]};
  supabase.from.mockImplementation(table=>{const q={select:jest.fn(()=>q),eq:jest.fn(()=>q),is:jest.fn(()=>q),in:jest.fn(()=>q),order:jest.fn(async()=>({data:table==="clubs"?[club]:[],error:null}))};return q;});
  supabase.rpc.mockImplementation(async(name,params)=>{
    if(name==="admin_user_directory")return{data:[],error:null};
    if(["admin_club_get_draft","admin_course_get_draft"].includes(name))return{data:null,error:null};
    if(name==="admin_route_get_draft")return{data:{draft:null,context:{checks:{coherent:true}}},error:null};
    if(name==="admin_new_combinations")return{data:{club_id:club.id,sections,drafts:[draft],excluded:[]},error:null};
    if(name==="admin_new_combination_preview")return{data:plan,error:null};
    if(name==="admin_new_combination_publish"){
      expect(params).toEqual({p_draft_id:draft.draft_id,p_expected_revision:1,p_confirmation_hash:plan.confirmation_hash,p_note:"Conferma combinazione"});
      return{data:{draft_id:draft.draft_id,publication_id:"receipt",version_id:"version",combination:live},error:null};
    }
    throw new Error(`Unexpected test RPC ${name}`);
  });
  render(<AdminShell adminUserId="admin" onSignOut={jest.fn()}/>);
  const nav=screen.getByRole("navigation",{name:"Navigazione amministrazione"});fireEvent.click(within(nav).getByRole("button",{name:"Club e percorsi"}));
  fireEvent.click(await screen.findByText(club.name,{selector:"strong"}));fireEvent.click(screen.getByRole("button",{name:"Aggiungi combinazione"}));
  fireEvent.click(await screen.findByRole("button",{name:"Riprendi Combinazione nuova"}));
  expect(supabase.rpc.mock.calls.some(([name])=>name.includes("publish"))).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"Anteprima pubblicazione"}));const modal=await screen.findByRole("dialog",{name:"Anteprima pubblicazione combinazione"});
  fireEvent.click(within(modal).getByRole("button",{name:"Pubblica combinazione"}));fireEvent.change(screen.getByLabelText("Motivazione breve"),{target:{value:"Conferma combinazione"}});
  fireEvent.click(screen.getByRole("button",{name:"Conferma pubblicazione combinazione"}));
  await screen.findByRole("heading",{name:club.name});expect(screen.getByRole("button",{name:/Combinazione nuova.*18 buche/})).toBeInTheDocument();
  expect(JSON.stringify(club)).toBe(original);expect(screen.getByRole("button",{name:/^Percorso 1 9 buche/})).toBeInTheDocument();
  fireEvent.click(within(nav).getByRole("button",{name:"Club e percorsi"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:/Club pubblicato.*2 percorsi · 1 combinazione/})).toBeInTheDocument());
});
