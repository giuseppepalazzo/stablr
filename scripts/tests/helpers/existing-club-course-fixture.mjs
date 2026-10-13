import { readFile } from 'node:fs/promises';
export const admin='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',player='33333333-3333-4333-8333-333333333333';
export const courseFields=(name='Nuovo nove',count=9)=>({name,holes_count:count,display_order:2});
export const grid=count=>({holes_count:count,holes:Array.from({length:count},(_,i)=>({physical_hole_number:i+1,par:4,stroke_index:count-i}))});
export const teeFields=(updates={})=>({name:'Giallo',tee_color:'giallo',rating_category:'men',course_rating:36,slope_rating:113,is_active:true,display_order:0,...updates});
export const sql=async name=>(await readFile(new URL(`../../../supabase/${name}.sql`,import.meta.url),'utf8')).replaceAll('create extension if not exists pgcrypto;','');
export async function role(db,name='authenticated',uid=admin) {
  await db.exec(`reset role;set role ${name}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,name]);
}
export async function rpc(db,name,args=[]) {
  return (await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) result`,args.map(value=>value!==null&&typeof value==='object'?JSON.stringify(value):value))).rows[0].result;
}
export async function setup(db) {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
    create table public.profiles(id uuid primary key references auth.users,player_name text,hcp numeric,role text not null default 'user',created_at timestamptz default now(),updated_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'');$$;
    grant usage on schema auth to anon,authenticated,service_role;insert into auth.users values('${admin}'),('${other}'),('${player}');`);
  for(const name of ['shared-catalog-schema','fig-whs-extension','fig-catalog-schema','fig-club-matching'])await db.exec(await sql(name));
  await db.exec(`insert into public.profiles(id,role) values('${admin}','admin'),('${other}','admin'),('${player}','user');`);
  for(const name of ['admin-catalog-workflow','admin-club-editor','admin-course-editor','admin-catalog-abandon-draft','admin-course-tee-editor',
    'admin-new-club-courses','admin-new-club-course-holes','admin-new-club-course-tees','admin-new-club-publish','admin-existing-club-new-courses'])await db.exec(await sql(name));
  const club=(await db.query("insert into public.clubs(name,name_normalized,created_by,source_payload) values('Club esistente','club esistente',$1,'{\"historical\":true}') returning *",[admin])).rows[0];
  const old=(await db.query("insert into public.course_routes(club_id,name,holes_count,total_par,display_order,source_payload) values($1,'Percorso storico',9,36,0,'{\"source\":\"unchanged\"}') returning *",[club.id])).rows[0];
  await db.query('insert into public.route_holes(route_id,physical_hole_number,par,stroke_index) select $1,n,4,n from generate_series(1,9)n',[old.id]);
  await db.query("insert into public.route_tees(route_id,tee_name,holes_count,course_rating,slope_rating,par_total,source_payload) values($1,'Storico',9,36,113,36,'{\"distances_m\":[100]}')",[old.id]);
  const round=(await db.query("insert into public.rounds(user_id,club_id,holes_count,total_par,round_type,selected_routes) values($1,$2,9,36,'single_9',$3::jsonb) returning id",[player,club.id,JSON.stringify([{route_id:old.id}])])).rows[0];
  await db.query('insert into public.round_holes(round_id,user_id,club_id,route_id,round_hole_number,route_position,physical_hole_number,par,stroke_index) values($1,$2,$3,$4,1,1,1,4,1)',[round.id,player,club.id,old.id]);
  await role(db);return {club,old};
}
export async function create(db,club,fields=courseFields()) { return rpc(db,'admin_existing_club_course_save',[club.id,fields]); }
export async function configure(db,draft,fields=teeFields()) {
  const opened=await rpc(db,'admin_new_course_holes_open',[draft.draft_id]);
  const holes=await rpc(db,'admin_new_course_holes_save',[opened.draft.draft_id,grid(draft.snapshot.holes_count),opened.draft.revision,draft.revision]);
  const tee=await rpc(db,'admin_new_course_tee_save',[draft.draft_id,fields,draft.revision,holes.draft_id,holes.revision]);
  return {holes,tee};
}
export const preview=(db,draft)=>rpc(db,'admin_existing_club_course_preview',[draft.draft_id]);
export const publish=(db,draft,plan,note='Conferma esplicita test')=>rpc(db,'admin_existing_club_course_publish',[draft.draft_id,draft.revision,plan.confirmation_hash,note]);
export const tables=['clubs','course_routes','route_holes','route_tees','route_combinations','route_combination_holes','combination_tees','rounds','round_holes','fig_clubs',
  'admin_catalog_drafts','admin_catalog_versions','admin_new_club_publications','admin_existing_club_course_contexts','admin_existing_club_course_publications'];
export async function state(db) {
  await db.exec('reset role');const result={};
  for(const table of tables)result[table]=(await db.query(`select * from public.${table} order by ${table==='admin_catalog_drafts'||table==='admin_existing_club_course_contexts'?'draft_id':table==='admin_catalog_versions'?'version_id':table.endsWith('publications')?'publication_id':'id'}`)).rows;
  await role(db);return result;
}
