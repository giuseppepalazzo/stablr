import { isNewTeeValid, normalizeNewTeeFields } from "./new-club-tees-data";

export const emptyCombination = clubId => ({club_id:clubId, name:"", front_configuration_id:"", back_configuration_id:"", source_hash:"",
  holes:Array.from({length:18}, (_,i)=>({position:i+1,si:null})), tees:[]});
export const newCombinationFields = fields => ({...fields, name:fields.name.trim(),
  tees:fields.tees.map(normalizeNewTeeFields)});
export function validNewCombination(fields) {
  return !!fields?.name.trim() && fields.name.trim().length<=200 && !!fields.front_configuration_id && !!fields.back_configuration_id
    && fields.front_configuration_id!==fields.back_configuration_id && /^[a-f0-9]{128}$/.test(fields.source_hash)
    && fields.holes.length===18 && fields.holes.every((h,i)=>h.position===i+1 && (h.si===null || (Number.isInteger(h.si)&&h.si>=1&&h.si<=18)))
    && fields.tees.length<=40 && fields.tees.every(isNewTeeValid)
    && new Set(fields.tees.map(t=>t.name.trim().toLowerCase())).size===fields.tees.length;
}
export function newCombinationError(error) {
  if (["40001","55P03","40P01"].includes(error?.code)) return "La bozza o le origini sono cambiate o occupate. Riapri e verifica la base; nessuna pubblicazione eseguita.";
  if (error?.code==="23505") return "Nome tee o coppia ordinata di Percorsi già presente. Nessun dato pubblicato.";
  if (["23514","22023"].includes(error?.code)) return "Combinazione incompleta o origini non compatibili. Verifica SI, tee e sezioni fisiche.";
  if (error?.code==="42501") return "Operazione non autorizzata per questa bozza.";
  return "Impossibile caricare o salvare la nuova combinazione. Riprova.";
}
export function createNewCombinationService(client) {
  const call=async(name,params)=>{
    if(!client) throw new Error("Admin client required");
    const {data,error}=await client.rpc(name,params);if(error)throw error;
    return Array.isArray(data)&&data.length===1?data[0]:data;
  };
  const requireDraft=(draft,clubId,owner,status="draft")=>{
    if(!owner||!draft?.draft_id||draft.entity_type!=="route_combination"||draft.created_by!==owner||draft.live_entity_id!==null
      ||draft.parent_draft_id!=null||draft.base_snapshot!=null||draft.base_version_id!=null||draft.schema_version!==1
      ||draft.workflow_status!==status||draft.snapshot?.club_id!==clubId||!Number.isInteger(draft.revision)||draft.revision<1
      ||!validNewCombination(draft.snapshot))throw new Error("Owned new combination required");
    return draft;
  };
  return {
    async list(clubId,owner){
      if(!owner)throw new Error("Admin required");
      const result=await call("admin_new_combinations",{p_club_id:clubId});
      if(result?.club_id!==clubId||!Array.isArray(result.sections)||!Array.isArray(result.drafts)||!Array.isArray(result.excluded))throw new Error("Invalid new combination list");
      result.drafts.forEach(d=>requireDraft(d,clubId,owner));return result;
    },
    async save(clubId,owner,draft,fields){
      if(draft)requireDraft(draft,clubId,owner);
      if(!owner||fields.club_id!==clubId||!validNewCombination(fields))throw new Error("Valid private fields required");
      const result=requireDraft(await call("admin_new_combination_save",{p_snapshot:newCombinationFields(fields),p_draft_id:draft?.draft_id||null,p_expected_revision:draft?.revision||null}),clubId,owner);
      if(draft&&result.draft_id!==draft.draft_id)throw new Error("Wrong draft target");return result;
    },
    async archive(clubId,owner,draft){
      requireDraft(draft,clubId,owner);
      return requireDraft(await call("admin_catalog_archive_draft",{p_draft_id:draft.draft_id,p_entity_type:"route_combination",p_expected_revision:draft.revision}),clubId,owner,"archived");
    },
    async preview(clubId,owner,draft){
      requireDraft(draft,clubId,owner);
      const plan=await call("admin_new_combination_preview",{p_draft_id:draft.draft_id});
      if(plan?.draft_id!==draft.draft_id||plan.revision!==draft.revision||plan.club?.id!==clubId||plan.holes_count!==18
        ||plan.holes?.length!==18||!Array.isArray(plan.tees)||!Array.isArray(plan.blockers)||typeof plan.can_publish!=="boolean"
        ||!/^[a-f0-9]{64}$/.test(plan.confirmation_hash))throw new Error("Invalid publication preview");return plan;
    },
    async publish(clubId,owner,draft,plan,note){
      requireDraft(draft,clubId,owner);
      if(!plan?.can_publish||plan.draft_id!==draft.draft_id||plan.revision!==draft.revision||plan.club?.id!==clubId
        ||!/^[a-f0-9]{64}$/.test(plan.confirmation_hash)||!note.trim()||note.trim().length>500)throw new Error("Preview and explicit note required");
      const result=await call("admin_new_combination_publish",{p_draft_id:draft.draft_id,p_expected_revision:draft.revision,p_confirmation_hash:plan.confirmation_hash,p_note:note.trim()});
      if(result?.draft_id!==draft.draft_id||!result.publication_id||!result.version_id||result.combination?.club_id!==clubId
        ||!result.combination.id||result.combination.route_combination_holes?.length!==18||!result.combination.combination_tees?.length)throw new Error("Invalid publication receipt");
      return result;
    }
  };
}
