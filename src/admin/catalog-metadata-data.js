export const METADATA_LABELS = { name:"Nome visualizzato", holes_count:"Struttura", display_order:"Ordine", is_active:"Stato operativo", aliases:"Alias", notes:"Note catalogo" };
export function normalizeEditorialFields(fields) {
  const aliases=Array.isArray(fields.aliases)?fields.aliases:String(fields.aliases||"").split(/\r?\n/);
  return {aliases:aliases.map(value=>String(value).trim()).filter(Boolean),notes:String(fields.notes||"").trim()||null};
}
export function validEditorialFields(fields) {
  const {aliases,notes}=normalizeEditorialFields(fields);
  return aliases.length<=20&&aliases.every(value=>value.length<=200&&!/[\r\n]/.test(value))
    &&new Set(aliases.map(value=>value.toLowerCase())).size===aliases.length&&(!notes||notes.length<=5000);
}
export function metadataDiff(base,fields) {
  return Object.keys(fields).filter(key=>JSON.stringify(base[key])!==JSON.stringify(fields[key]))
    .map(key=>({key,label:METADATA_LABELS[key],before:base[key],after:fields[key]}));
}
export function metadataValue(key,value) {
  if(value==null||value===""||(Array.isArray(value)&&!value.length))return "—";
  if(key==="is_active")return value?"Attivo":"Disattivato";
  if(key==="holes_count")return `${value} buche`;
  return Array.isArray(value)?value.join(" · "):String(value);
}
export function metadataPreviewChanges(plan) {
  return Object.entries(plan.changes).filter(([key])=>METADATA_LABELS[key])
    .map(([key,change])=>({key,label:METADATA_LABELS[key],...change}));
}
export const METADATA_REQUEST_TIMEOUT_MS=15000;

// A pending fetch/auth lock must never leave the editor permanently busy. An
// abort is NOT proof that a server-side mutation rolled back: reconcile it first.
async function metadataRequest(build,{timeoutMs,action}) {
  const controller=new AbortController();let timer;
  try {
    const built=build();
    // One explicit operation must not amplify transient errors into SDK retries.
    // This also covers exact draft/version reads used to reconcile an outcome.
    const request=typeof built.retry==="function"?built.retry(false):built;
    const response=await Promise.race([
      Promise.resolve(request.abortSignal?request.abortSignal(controller.signal):request),
      new Promise((_,reject)=>{timer=setTimeout(()=>{
        const failure=Object.assign(new Error("Metadata request deadline exceeded"),{code:"METADATA_TIMEOUT",action});
        reject(failure);controller.abort();
      },timeoutMs);})
    ]);
    if(response.error)throw response.error;
    return response.data;
  }catch(failure){
    console.error("Admin metadata request failed",action,failure?.code||"network_error");
    throw failure;
  }finally{clearTimeout(timer);}
}
export function getMetadataRequestError(error) {
  if(error?.requiresRecovery)return "Esito non verificato. Verifica l’esito e recupera la bozza prima di inviare altre modifiche; la pubblicazione potrebbe essere già riuscita.";
  if(error?.code==="METADATA_TIMEOUT")return error.action==="preview"
    ?"La richiesta ha superato il tempo massimo. Nessuna pubblicazione è stata inviata dall’anteprima. Riprova."
    :"La richiesta ha superato il tempo massimo. Riprova la lettura o la verifica dell’esito; non presumere che una pubblicazione pendente sia fallita.";
  if(error?.code==="55P03"||error?.code==="40P01")return "Un’altra operazione sta usando questi dati. Attendi e riprova; la bozza rimane disponibile.";
  if(error?.code==="57014")return "Il server ha interrotto la richiesta per timeout. La bozza rimane disponibile: riprova.";
  return null;
}
export function createCatalogMetadataService(client,kind,{timeoutMs=METADATA_REQUEST_TIMEOUT_MS}={}) {
  const uncertain=new Set(),pending=new Set(),opening=new Map(),lastDrafts=new Map();
  const read=(build,action)=>metadataRequest(build,{timeoutMs,action});
  const invoke=async(target,action,params={})=>{
    if(!client||!target)throw new Error("Published target required");
    const mutating=["open","save","publish","restore"].includes(action);
    if(mutating&&(uncertain.has(target)||pending.has(target)))throw Object.assign(new Error("Reconcile metadata operation first"),{code:"METADATA_UNCERTAIN",requiresRecovery:true});
    if(mutating)pending.add(target);
    try{
      const parameters={p_kind:kind,p_target:target,p_action:action,...params};
      const data=await read(()=>mutating?client.rpc("admin_catalog_metadata",parameters)
        :client.rpc("admin_catalog_metadata",parameters,{get:true}),action);
      const value=Array.isArray(data)&&data.length===1?data[0]:data;
      if(!value||Array.isArray(value))throw new Error("Single metadata result required");return value;
    }catch(failure){
      if(["save","publish"].includes(action)&&(failure.code==="METADATA_TIMEOUT"||!failure.code)){
        uncertain.add(target);throw Object.assign(new Error("Metadata mutation outcome unknown"),{code:failure.code||"METADATA_UNCERTAIN",requiresRecovery:true});
      }
      throw failure;
    }finally{if(mutating)pending.delete(target);}
  };
  const requireDraft=d=>{if(!d?.draft_id||!d.live_entity_id||d.entity_type!==kind||d.workflow_status!=="draft"||!Number.isInteger(d.revision))throw new Error("Existing editor draft required");lastDrafts.set(d.live_entity_id,d);};
  const service={
    openDraft(target){
      // React StrictMode mounts effects twice: share the same open request rather
      // than racing two mutating RPCs for the same NOWAIT locks.
      if(opening.has(target))return opening.get(target);
      const request=(async()=>{
        if(uncertain.has(target)&&lastDrafts.has(target)){
          const recovered=await service.recoverDraft(lastDrafts.get(target));
          if(recovered.status==="published")throw Object.assign(new Error("Publication already completed"),{code:"METADATA_ALREADY_PUBLISHED",live:recovered.live});
          return {draft:recovered.draft,context:(await invoke(target,"detail")).context};
        }
        const result=await invoke(target,"open");requireDraft(result.draft);if(result.draft.live_entity_id!==target||!result.context)throw new Error("Wrong metadata target");return result;
      })();
      const shared=request.then(result=>{opening.delete(target);return result;},failure=>{opening.delete(target);throw failure;});
      opening.set(target,shared);return shared;
    },
    async saveMetadataDraft(draft,fields){
      requireDraft(draft);
      try{
        const result=await invoke(draft.live_entity_id,"save",{p_draft_id:draft.draft_id,p_expected_revision:draft.revision,p_snapshot:fields});requireDraft(result);
        if(result.draft_id!==draft.draft_id||result.live_entity_id!==draft.live_entity_id)throw new Error("Wrong saved draft");return result;
      }catch(failure){
        if(!failure.code&&!failure.requiresRecovery){uncertain.add(draft.live_entity_id);throw Object.assign(new Error("Cannot verify saved receipt"),{requiresRecovery:true});}
        throw failure;
      }
    },
    async previewDraft(draft){requireDraft(draft);const result=await invoke(draft.live_entity_id,"preview",{p_draft_id:draft.draft_id,p_expected_revision:draft.revision});
      if(result.draft_id!==draft.draft_id||result.target_id!==draft.live_entity_id||result.kind!==kind||result.revision!==draft.revision
        ||typeof result.can_publish!=="boolean"||!result.changes||!Array.isArray(result.blockers)||!Array.isArray(result.warnings)
        ||!Array.isArray(result.impact?.foundation)||!/^[a-f0-9]{64}$/.test(result.confirmation_hash))throw new Error("Invalid server metadata preview");return result;},
    async publishDraft(draft,plan,note){requireDraft(draft);
      if(!plan?.can_publish||plan.draft_id!==draft.draft_id||plan.revision!==draft.revision||plan.target_id!==draft.live_entity_id||plan.kind!==kind
        ||!/^[a-f0-9]{64}$/.test(plan.confirmation_hash)||!note?.trim()||note.trim().length>500)throw new Error("Server preview, confirmation and note required");
      const result=await invoke(draft.live_entity_id,"publish",{p_draft_id:draft.draft_id,p_expected_revision:draft.revision,p_confirmation_hash:plan.confirmation_hash,p_note:note.trim()});
      const live=kind==="route"?result.course:result.route;
      if(!result.version_id||result.draft_id!==draft.draft_id||live?.id!==draft.live_entity_id){uncertain.add(draft.live_entity_id);throw Object.assign(new Error("Invalid metadata publication receipt"),{requiresRecovery:true});}return result;},
    async recoverDraft(draft){
      // Exact saved draft only; never use open/restore here (they can create rows).
      const rows=await read(()=>client.from("admin_catalog_drafts")
        .select("draft_id,entity_type,live_entity_id,workflow_status,revision,schema_version,snapshot,base_snapshot,base_version_id,base_live_updated_at,created_by")
        .eq("draft_id",draft.draft_id).eq("entity_type",kind).eq("live_entity_id",draft.live_entity_id).limit(2),"recover_draft");
      const current=rows?.length===1?rows[0]:null;
      if(!current||current.draft_id!==draft.draft_id||current.entity_type!==kind||current.live_entity_id!==draft.live_entity_id
        ||(draft.created_by&&current.created_by!==draft.created_by))throw new Error("Cannot verify exact saved draft");
      if(current.workflow_status==="draft"){requireDraft(current);uncertain.delete(draft.live_entity_id);return {status:"draft",draft:current};}
      if(current.workflow_status!=="published")throw new Error("Draft is closed: review its summary before proceeding");
      const versions=await read(()=>client.from("admin_catalog_versions").select("version_id,source_draft_id,entity_type,live_entity_id")
        .eq("source_draft_id",draft.draft_id).eq("entity_type",kind).eq("live_entity_id",draft.live_entity_id).limit(2),"recover_version");
      if(versions?.length!==1||!versions[0].version_id||versions[0].source_draft_id!==draft.draft_id||versions[0].entity_type!==kind
        ||versions[0].live_entity_id!==draft.live_entity_id)throw new Error("Cannot verify publication version");
      const details=await invoke(draft.live_entity_id,"detail");
      const liveRows=await read(()=>client.from(kind==="route"?"course_routes":"route_combinations")
        .select(kind==="route"?"id,club_id,name,holes_count,display_order,is_active,updated_at":"id,club_id,name,is_active,updated_at")
        .eq("id",draft.live_entity_id).limit(2),"recover_live");
      if(liveRows?.length!==1||liveRows[0].id!==draft.live_entity_id||details.kind!==kind||details.target_id!==draft.live_entity_id||!details.fields)throw new Error("Cannot verify published live target");
      uncertain.delete(draft.live_entity_id);
      return {status:"published",version_id:versions[0].version_id,live:{...liveRows[0],...details.fields}};
    },
    async getHistory(target){const result=await invoke(target,"history");if(result.kind!==kind||result.target_id!==target||!Array.isArray(result.history)||typeof result.has_open_draft!=="boolean")throw new Error("Invalid metadata history");return result;},
    async restoreVersion(target,version){if(!version?.version_id)throw new Error("Published version required");const result=await invoke(target,"restore",{p_version_id:version.version_id});requireDraft(result.draft);if(result.draft.live_entity_id!==target)throw new Error("Wrong restored target");return result;}
  };
  return service;
}
