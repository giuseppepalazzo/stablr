import { validateOriginGraph } from "./data-origin";
import { createTeeClassificationService } from "./tee-classification-data";
import { createTeeEvidenceService } from "./tee-evidence-data";

export const PHYSICAL_CLASSIFICATIONS = ["non_classificato", "fisico_9", "fisico_18", "multi_9"];
export const STRUCTURE_SOURCES = ["fig", "gesgolf", "stablr", "other"];
export const reviewTypeLabel = (type) => type === "structure" ? "Classificazione struttura" : "Collegamento buche";
export const reviewStatusLabel = (item) => item.status !== "verified" ? "Da revisionare"
  : item.target_type === "structure" ? "Classificata" : "Collegamenti verificati";

export function filterStructureReviews(items, status, type, search) {
  const query = search.trim().toLocaleLowerCase("it");
  return items.filter((item) => (status === "Tutti" || (status === "Da revisionare" ? item.status !== "verified" : item.status === "verified"))
    && (type === "Tutti i tipi" || reviewTypeLabel(item.target_type) === type)
    && (!query || `${item.club_name} ${item.title}`.toLocaleLowerCase("it").includes(query)));
}

export function structureReviewError(error) {
  if (error?.code === "42501") return "Non sei autorizzato a revisionare la struttura.";
  if (error?.code === "40001") return "La struttura è cambiata. Ricarica il dettaglio prima di confermare.";
  if (error?.code === "23505") return "La struttura esiste già. Ricarica il dettaglio per riprenderla.";
  if (error?.code === "55000") return "La struttura verificata è in sola lettura.";
  return "Impossibile completare l’operazione. Riprova.";
}

export function createStructureReviewService(client) {
  const invoke = async (name, params) => {
    if (!client) throw new Error("Structure review client unavailable");
    const { data, error } = await client.rpc(name, params);
    if (error) throw error;
    const result = Array.isArray(data) && data.length === 1 ? data[0] : data;
    if (!result || Array.isArray(result)) throw new Error("Missing structure review response");
    return result;
  };
  return {
    teeEvidence: createTeeEvidenceService(client),
    teeClassifications: createTeeClassificationService(client),
    originGraph: async (clubId) => validateOriginGraph(await invoke("admin_catalog_data_origin", { p_club_id: clubId }), clubId),
    list: async () => {
      const result = await invoke("admin_catalog_structure_review_queue");
      if (!Array.isArray(result.items)) throw new Error("Invalid structure queue");
      return result.items;
    },
    detail: async (item) => {
      const result = await invoke("admin_catalog_structure_review_detail", { p_target_type: item.target_type, p_target_id: item.target_id });
      if (!result.club?.id || !Array.isArray(result.structures) || !Array.isArray(result.events)) throw new Error("Invalid structure evidence");
      return result;
    },
    createStructure: async (clubId, fields) => invoke("admin_catalog_foundation_create_structure", {
      p_club_id: clubId, p_label: fields.label.trim(), p_source_system: fields.source,
      p_source_reference: fields.reference.trim(), p_reason: fields.note.trim()
    }),
    reviewStructure: async (structure, fields) => invoke("admin_catalog_foundation_review_structure", {
      p_structure_id: structure.id, p_expected_revision: structure.revision, p_classification: fields.classification,
      p_source_system: fields.source, p_source_reference: fields.reference.trim(), p_reason: fields.note.trim(),
      p_confirm_verified: fields.classification !== "non_classificato"
    }),
    physicalPreview: (structureId, courseId = null) => invoke("admin_catalog_physical_course_preview", {
      p_structure_id: structureId, p_course_id: courseId
    }),
    registerPhysicalHoles: (context, note) => invoke("admin_catalog_physical_course_register", {
      p_structure_id: context.structure.id, p_course_id: context.source.course.id,
      p_expected_structure_revision: context.structure.revision, p_expected_source: context.source,
      p_reason: note.trim(), p_confirm: true
    }),
    verifyPhysicalCourse: (context, note) => invoke("admin_catalog_physical_course_verify", {
      p_link_id: context.link.id, p_expected_revision: context.link.revision,
      p_expected_mapping: context.mapping, p_reason: note.trim(), p_confirm: true
    }),
    playablePreview: (structureId, linkId = null, kind = null) => invoke("admin_catalog_playable_preview", {
      p_structure_id: structureId, p_source_link_id: linkId, p_kind: kind
    }),
    registerPlayable: (context, note) => invoke("admin_catalog_playable_register", {
      p_structure_id: context.structure.id, p_source_link_id: context.source_link_id, p_kind: context.kind,
      p_expected_baseline: context.baseline, p_reason: note.trim(), p_confirm: true
    }),
    verifyPlayable: (context, note) => invoke("admin_catalog_playable_verify", {
      p_configuration_id: context.configuration.id, p_expected_revision: context.configuration.revision,
      p_expected_baseline: context.baseline, p_expected_holes: context.saved_holes,
      p_reason: note.trim(), p_confirm: true
    }),
    multi9Preview: (structureId) => invoke("admin_catalog_multi9_preview", { p_structure_id: structureId }),
    multi9BatchPreview: async (structureIds = null) => {
      const result = await invoke("admin_catalog_multi9_proposal_preview", { p_structure_ids: structureIds });
      if (result.preview_contract !== 2 || result.discovery_scope !== "clubs_with_combinations") {
        throw new Error("Incompatible multi9 proposal preview contract");
      }
      return result;
    },
    registerMulti9Batch: (candidates, note) => invoke("admin_catalog_multi9_batch_register", {
      p_candidates: candidates.map((c) => ({ club_id: c.club_id, structure_id: c.structure_id, club_name: c.club_name, baseline: c.baseline })),
      p_reason: note.trim(), p_confirm: true
    }),
    physical18Preview: (structureId, linkId = null, kind = null, courseId = null, parSelection = null) => invoke("admin_catalog_physical18_preview", {
      p_structure_id: structureId, p_source_link_id: linkId, p_kind: kind, p_course_id: courseId, p_par_selection: parSelection
    }),
    registerPhysical18: (context, note) => invoke("admin_catalog_physical18_register", {
      p_structure_id: context.structure.id, p_source_link_id: context.source_link_id, p_kind: context.kind,
      p_course_id: context.source_course_id, p_par_selection: context.par_selection,
      p_expected_baseline: context.baseline, p_reason: note.trim(), p_confirm: true
    }),
    verifyPhysical18: (context, note) => invoke("admin_catalog_physical18_verify", {
      p_configuration_id: context.configuration.id, p_expected_revision: context.configuration.revision,
      p_expected_baseline: context.baseline, p_expected_holes: context.saved_holes, p_reason: note.trim(), p_confirm: true
    })
  };
}
