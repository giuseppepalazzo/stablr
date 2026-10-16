import { setupCombinationTees, owner, role, rpc, sql, admin } from './combination-tee-fixture.mjs';
export { owner, role, rpc, sql, admin, other, player, dump } from './combination-tee-fixture.mjs';
export const call = (db, tee, action, draft = null, snapshot = null, confirmation = null, note = null, version = null) =>
  rpc(db,'admin_tee_si',[tee.route_id ? 'route_tee' : 'combination_tee',tee.id,action,draft?.draft_id ?? null,draft?.revision ?? null,snapshot,confirmation,note,version]);
export const swapped = draft => ({mode:'managed',holes:draft.snapshot.holes.map((h,i,all)=>({...h,si:i===0?all.length:i===all.length-1?1:null}))});
export async function setupSi(db) {
  const f=await setupCombinationTees(db);
  await db.exec('reset role');
  for(const name of ['admin-combination-tee-crud','admin-hole-grid-editor','admin-course-hole-grid-editor','admin-tee-si-overrides'])await db.exec(await sql(name));
  // Supabase's existing API SELECT grants, not provided by bare local Postgres.
  await db.exec('grant select on public.clubs,public.course_routes,public.route_combinations,public.route_tees,public.combination_tees to authenticated');
  await role(db);
  // Exact captured multi-9 relations, not names/offsets.
  const courseTee=(await owner(db,"insert into public.route_tees(route_id,tee_name,holes_count,par_total,course_rating,slope_rating) values($1,'SI test',9,36,36,113) returning *",[f.combination.front_route_id])).rows[0];
  return {...f,courseTee};
}
export async function repeatedNine(db) {
  const club=(await owner(db,"insert into public.clubs(name,name_normalized,created_by) values('Mare shape TEST','mare shape test',$1) returning *",[admin])).rows[0];
  const course=(await owner(db,"insert into public.course_routes(club_id,name,holes_count,total_par,source_system) values($1,'Nove TEST',9,36,'stablr') returning *",[club.id])).rows[0];
  await owner(db,'insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) select $1,n,4,n*2-1 from generate_series(1,9)n',[course.id]);
  let structure=await rpc(db,'admin_catalog_foundation_create_structure',[club.id,'Physical TEST','stablr','test:exact','Explicit TEST']);
  structure=await rpc(db,'admin_catalog_foundation_review_structure',[structure.id,structure.revision,'fisico_9','stablr','test:exact','Explicit TEST',true]);
  let p=await rpc(db,'admin_catalog_physical_course_preview',[structure.id,course.id]);
  p=await rpc(db,'admin_catalog_physical_course_register',[structure.id,course.id,structure.revision,p.source,'Explicit TEST',true]);
  p=await rpc(db,'admin_catalog_physical_course_verify',[p.link.id,p.link.revision,p.mapping,'Explicit TEST',true]);
  for(const kind of ['autonomous_9','repeated_18']){
    let c=await rpc(db,'admin_catalog_playable_preview',[structure.id,p.link.id,kind]);
    c=await rpc(db,'admin_catalog_playable_register',[structure.id,p.link.id,kind,c.baseline,'Explicit TEST',true]);
    await rpc(db,'admin_catalog_playable_verify',[c.configuration.id,c.configuration.revision,c.baseline,c.saved_holes,'Explicit TEST',true]);
  }
  const tees=[];
  for(const count of [9,18])tees.push((await owner(db,"insert into public.route_tees(route_id,tee_name,holes_count,par_total,course_rating,slope_rating) values($1,$2,$3,$4,36,113) returning *",[course.id,'Giallo '+count,count,count*4])).rows[0]);
  return {course,tees};
}
export async function physicalEighteen(db) {
  const pars=[5,4,3,4,3,4,4,5,3,5,3,4,3,4,5,3,4,4],si=[9,17,15,3,13,1,5,11,7,12,2,18,4,8,6,16,14,10];
  const club=(await owner(db,"insert into public.clubs(name,name_normalized,created_by) values('Fiuggi shape TEST','fiuggi shape test',$1) returning *",[admin])).rows[0];
  const courses=[],tees=[];
  for(const [label,from,to] of [['18',0,18],['Prime',0,9],['Seconde',9,18]]) {
    const c=(await owner(db,"insert into public.course_routes(club_id,name,holes_count,total_par,source_system) values($1,$2,$3,$4,'stablr') returning *",[club.id,label,to-from,pars.slice(from,to).reduce((a,b)=>a+b,0)])).rows[0];courses.push(c);
    for(let i=from;i<to;i++)await owner(db,'insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) values($1,$2,$3,$4)',[c.id,i-from+1,pars[i],si[i]]);
    tees.push((await owner(db,"insert into public.route_tees(route_id,tee_name,holes_count,course_rating,slope_rating) values($1,'Giallo',$2,36,113) returning *",[c.id,to-from])).rows[0]);
  }
  let s=await rpc(db,'admin_catalog_foundation_create_structure',[club.id,'Physical18 TEST','stablr','test:exact','Explicit TEST']);
  s=await rpc(db,'admin_catalog_foundation_review_structure',[s.id,s.revision,'fisico_18','stablr','test:exact','Explicit TEST',true]);
  let p=await rpc(db,'admin_catalog_physical_course_preview',[s.id,courses[0].id]);
  p=await rpc(db,'admin_catalog_physical_course_register',[s.id,courses[0].id,s.revision,p.source,'Explicit TEST',true]);
  p=await rpc(db,'admin_catalog_physical_course_verify',[p.link.id,p.link.revision,p.mapping,'Explicit TEST',true]);
  for(const [i,kind] of ['autonomous_18','front_9','back_9'].entries()){
    let c=await rpc(db,'admin_catalog_physical18_preview',[s.id,p.link.id,kind,courses[i].id,'inherited']);
    c=await rpc(db,'admin_catalog_physical18_register',[s.id,p.link.id,kind,courses[i].id,'inherited',c.baseline,'Explicit TEST',true]);
    await rpc(db,'admin_catalog_physical18_verify',[c.configuration.id,c.configuration.revision,c.baseline,c.saved_holes,'Explicit TEST',true]);
  }
  return {tees,courses};
}
