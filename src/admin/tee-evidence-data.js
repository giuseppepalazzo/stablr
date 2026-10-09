// Browser capability is read-only: never imports server extraction/upload/confirmation code.
export function createTeeEvidenceService(client) {
  const invoke = async (name, params) => {
    if (!client) throw new Error("Evidence client unavailable");
    const { data, error } = await client.rpc(name, params);
    if (error) throw error;
    if (!data || !Array.isArray(data.items)) throw new Error("Invalid evidence response");
    return data;
  };
  return {
    list: (offset = 0) => invoke("admin_catalog_tee_evidence_list", { p_offset: offset }),
    detail: (batchId, offset = 0) => invoke("admin_catalog_tee_evidence_detail", { p_batch_id: batchId, p_offset: offset })
  };
}

export const evidenceReason = (reason) => ({
  incomplete_source_evidence: "Evidenza sorgente incompleta",
  unsupported_header_layout: "Intestazioni non interpretabili in modo certo",
  invalid_row_shape: "Struttura della riga non supportata",
  invalid_cell_shape: "Formato della cella non supportato",
  native_tee_id_absent: "Identità esterna nativa del tee assente",
  native_configuration_id_absent: "Identità esterna nativa della configurazione assente",
  applicability_header_spans_unavailable: "Applicabilità non attestabile dalle intestazioni conservate",
  par_common_configuration: "Par comune alla configurazione, non dichiarato per il singolo tee",
  scope_not_explicit: "Ambito non esplicito",
  ambiguous_scope: "Ambito ambiguo",
  par_not_numeric: "Par assente o non interpretabile"
}[reason] || "Limite documentale non riconosciuto");
