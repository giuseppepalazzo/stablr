import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { admin,setup,role,rpc,sql } from './existing-club-course-fixture.mjs';
export {admin,other,player,role,rpc,sql} from './existing-club-course-fixture.mjs';
export const fields=(updates={})=>({tee_name:'Nuovo tee',tee_color:'orange',gender:'men',display_order:2,course_rating:72.1,slope_rating:125,is_active:true,...updates});
export const open=(db,id)=>rpc(db,'admin_combination_tee_open_draft',[id]);
export const openNew=(db,id)=>rpc(db,'admin_combination_tee_open_new_draft',[id]);
export const save=(db,d,updates)=>rpc(db,'admin_combination_tee_save_draft',[d.draft_id,{...d.snapshot,...updates},d.revision]);
export const preview=(db,d)=>rpc(db,'admin_combination_tee_preview_draft',[d.draft_id]);
export const publish=(db,d)=>rpc(db,'admin_combination_tee_publish_draft',[d.draft_id,d.revision]);
export const archive=(db,d)=>rpc(db,'admin_combination_tee_archive_draft',[d.draft_id,d.revision]);
export async function dump(db){await db.exec('reset role');const out={};for(const {tablename} of(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows)
  out[tablename]=(await db.query(`select to_jsonb(t) j from public.${tablename} t order by to_jsonb(t)::text`)).rows;await role(db);return out;}
export async function owner(db,text,args=[]){await db.exec('reset role');try{return await db.query(text,args);}finally{await role(db);}}
export async function setupCombinationTees(db){
  await setup(db);await db.exec('reset role');await db.exec(await sql('admin-route-editor'));
  const par=await sql('admin-catalog-physical-par-source-drafts');
  await db.exec(par.slice(par.indexOf('create function public.admin_catalog_par_overlapping_drafts('),par.indexOf('-- Retain the old fingerprint')));
  for(const name of ['admin-catalog-physical-foundation','admin-catalog-physical-course-links','admin-catalog-playable-configurations',
    'admin-catalog-physical-18-configurations','admin-catalog-structure-club-lock','admin-catalog-multi9','admin-catalog-multi9-club-proposals',
    'admin-catalog-multi9-preview-repair','admin-catalog-data-origin','admin-catalog-tee-classifications','admin-course-tee-crud','admin-course-tee-foundation-impact'])await db.exec(await sql(name));
  await role(db);
  // Captured real model, remapped to fresh TEST UUIDs; no remote reads/writes.
  // Use only the exact three physical routes referenced by the official slots.
  const f=JSON.parse(await readFile(new URL('../fixtures/parco-de-medici-multi9-preview.json',import.meta.url),'utf8'));
  const referenced=new Set(f.combinations.flatMap(c=>[c.front_route_id,c.back_route_id]));
  const rows=[['clubs',[{...f.club,created_by:admin}]],['course_routes',f.routes.filter(r=>referenced.has(r.id))],
    ['route_holes',f.holes.filter(h=>referenced.has(h.route_id))],['route_combinations',f.combinations],['route_combination_holes',f.slots]];
  const ids=new Map(rows.flatMap(([,records])=>records.map(r=>[r.id,randomUUID()])));
  for(const [table,records] of rows)for(const row of records){const keys=Object.keys(row),values=keys.map(k=>ids.get(row[k])||row[k]);
    await owner(db,`insert into public.${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,values.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v));}
  const clubId=ids.get(f.club.id),combinationId=ids.get(f.combinations[0].id);
  const combination=(await owner(db,'select * from public.route_combinations where id=$1',[combinationId])).rows[0];
  const tee=(await owner(db,"insert into public.combination_tees(route_combination_id,tee_name,tee_color,holes_count,par_total,course_rating,slope_rating,source_system,source_payload) values($1,'Giallo','yellow',18,$2,72.1,125,'fig','{\"distances_m\":[100],\"private\":\"TEST_NOT_EXPOSED\"}') returning *",[combinationId,combination.total_par])).rows[0];
  const proposal=await rpc(db,'admin_catalog_multi9_club_preview',[clubId]);
  await rpc(db,'admin_catalog_multi9_batch_register',[[proposal],'Explicit TEST-only physical registration',true]);
  const cfg=(await owner(db,'select * from public.admin_catalog_playable_configurations where legacy_combination_id=$1 and review_status=\'verified\'',[combinationId])).rows[0];
  const detail=await rpc(db,'admin_catalog_tee_classification_detail',[clubId,'combination_tee',tee.id]);
  const decision={attestation:'curato',par_behavior:'derivato',provenance:'stablr',note:'Explicit test-only verified rule',
    evidence:{kind:'admin_review',reference:'verified_configuration:'+cfg.id,par_total:tee.par_total,holes_count:18,applicability:null},
    configuration_id:cfg.id,derivation_rule:'sum_configuration_effective_par',declared_holes_count:18,declared_applicability:null};
  const p=await rpc(db,'admin_catalog_tee_classification_preview',[clubId,'combination_tee',tee.id,decision,detail.revision]);
  await rpc(db,'admin_catalog_tee_classification_confirm',[clubId,'combination_tee',tee.id,p.decision,p.revision,p.baseline,true]);
  return {clubId,combination,tee,configuration:cfg};
}
