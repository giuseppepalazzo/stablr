import {getCourseDiff} from "../course-editor-data";
import {getRouteDiff} from "../route-editor-data";

export function metadataPlan(draft,kind) {
  const changes=(kind==="route"?getCourseDiff:getRouteDiff)(draft.base_snapshot,draft.snapshot);
  return {draft_id:draft.draft_id,revision:draft.revision,kind,target_id:draft.live_entity_id,can_publish:!!changes.length,
    confirmation_hash:"a".repeat(64),fields:draft.snapshot,changes:Object.fromEntries(changes.map(c=>[c.key,{before:c.before,after:c.after}])),
    warnings:[],blockers:[],impact:{metadata_only:false,foundation:[],other_drafts:0}};
}
// Existing test scenarios retain their stateful mock implementation; this maps
// the new reviewed API onto those fixtures without any production fallback.
export function metadataMockRequest(name,params,getDraft) {
  if(name!=="admin_catalog_metadata")return {name,params};
  const kind=params.p_kind,prefix=kind==="route"?"admin_course":"admin_route",d=getDraft(params.p_target);
  if(params.p_action==="history")return {reply:{data:{kind,target_id:params.p_target,fields:d?.snapshot||{},context:{},history:[],has_open_draft:!!d},error:null}};
  if(params.p_action==="preview")return {reply:{data:metadataPlan(d,kind),error:null}};
  if(params.p_action==="open")return {name:`${prefix}_open_draft`,params:{[kind==="route"?"p_course_id":"p_route_id"]:params.p_target}};
  return {name:`${prefix}_${params.p_action}_draft`,params};
}
