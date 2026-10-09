export const TEE_ATTESTATIONS = { certificato: "Certificato", curato: "Curato", sconosciuto: "Sconosciuto" };
export const TEE_PAR_BEHAVIORS = { derivato: "Derivato", richiede_revisione: "Richiede revisione", sconosciuto: "Sconosciuto" };
export const TEE_CLASSIFICATION_STATES = { unclassified: "Non classificato", current: "Corrente", obsolete: "Obsoleta", target_missing: "Tee non più disponibile" };
export const TEE_PAR_RULE = "sum_configuration_effective_par";
const key = (row) => `${row.entity_type}:${row.tee_id}`;
const holesCount = (value) => [9, 18].includes(Number(value)) ? Number(value) : null;

export function teeScopeFromDetail(row, detail) {
  if (holesCount(row.holes_count)) return { holesCount: holesCount(row.holes_count), inherited: false };
  const configuration = detail?.classification?.configuration_id
    ? detail.configurations?.find((candidate) => candidate.id === detail.classification.configuration_id)
    : null;
  const configurationHolesCount = holesCount(configuration?.holes_count);
  if (configurationHolesCount) return { holesCount: configurationHolesCount, inherited: true };
  const parentHolesCount = holesCount(detail?.parent?.holes_count);
  return parentHolesCount ? { holesCount: parentHolesCount, inherited: true } : null;
}

export function teeScopeLabel(row) {
  const holes = holesCount(row.holes_count ?? row.resolved_holes_count);
  if (!holes) return "—";
  return row.holes_count == null && row.scope_from_parent ? `${holes} (dal percorso)` : String(holes);
}

export function filterTeeClassifications(items, attestation, behavior) {
  return items.filter((row) => (!attestation || row.attestation === attestation) && (!behavior || row.par_behavior === behavior));
}
export function newTeeDecision(detail) {
  const saved = detail.classification;
  return { attestation: saved?.attestation || "sconosciuto", par_behavior: saved?.par_behavior || "sconosciuto",
    provenance: saved?.provenance || "unknown", note: "", configuration_id: saved?.configuration_id || "",
    declared_holes_count: saved?.declared_holes_count ? String(saved.declared_holes_count) : "",
    declared_applicability: saved?.declared_applicability || "",
    evidence_reference: saved?.evidence?.reference || "", evidence_par: saved?.evidence?.par_total == null ? "" : String(saved.evidence.par_total) };
}
export function teeDecisionPayload(fields) {
  const attested = fields.attestation !== "sconosciuto";
  return { attestation: fields.attestation, par_behavior: fields.par_behavior, provenance: fields.provenance,
    note: fields.note.trim(), declared_holes_count: Number(fields.declared_holes_count), declared_applicability: fields.declared_applicability || null,
    configuration_id: fields.par_behavior === "derivato" ? fields.configuration_id || null : null,
    derivation_rule: fields.par_behavior === "derivato" ? TEE_PAR_RULE : null,
    evidence: { kind: fields.attestation === "certificato" ? "document" : fields.attestation === "curato" ? "admin_review" : "none",
      reference: attested ? fields.evidence_reference.trim() : "", par_total: attested && fields.evidence_par !== "" ? Number(fields.evidence_par) : null,
      holes_count: attested ? Number(fields.declared_holes_count) : null, applicability: attested ? fields.declared_applicability || null : null } };
}
export function validTeeDecision(fields, detail) {
  if (!detail?.exists || !fields.note.trim() || !["9", "18"].includes(fields.declared_holes_count)) return false;
  if (fields.attestation !== "sconosciuto" && !fields.evidence_reference.trim()) return false;
  if (fields.attestation === "certificato" && (fields.evidence_par === "" || fields.provenance === "unknown")) return false;
  if (fields.evidence_par !== "" && !/^[0-9]{1,3}$/.test(fields.evidence_par)) return false;
  return fields.par_behavior !== "derivato" || !!fields.configuration_id;
}
export function teeClassificationError(error) {
  if (error?.code === "42501") return "Non sei autorizzato a classificare il Par dei tee.";
  if (error?.code === "55P03") return "Il club o i dati sono occupati. Ricarica e riprova. Nessuna classificazione è stata registrata.";
  if (["40001", "23505"].includes(error?.code)) return "La classificazione o la base è cambiata. Ricarica il dettaglio e prepara una nuova anteprima.";
  if (["22023", "23514", "22P02"].includes(error?.code)) return "Verifica evidenza, Par, ambito, applicabilità e collegamento alla configurazione. Nessun dato live viene modificato.";
  return "Impossibile completare la classificazione. Riprova.";
}
export function createTeeClassificationService(client) {
  const invoke = async (method, params) => {
    if (!client) throw new Error("Tee classification client unavailable");
    const { data, error } = await client.rpc(`admin_catalog_tee_classification_${method}`, params);
    if (error) throw error;
    const result = Array.isArray(data) && data.length === 1 ? data[0] : data;
    if (!result || result.contract_version !== 1 || (result.club_id !== params.p_club_id && result.club?.id !== params.p_club_id)) throw new Error("Invalid tee classification response");
    if (params.p_tee_id && key(result) !== `${params.p_entity_type}:${params.p_tee_id}`) throw new Error("Tee classification target mismatch");
    return result;
  };
  const target = (clubId, row) => ({ p_club_id: clubId, p_entity_type: row.entity_type, p_tee_id: row.tee_id });
  return {
    list: async (clubId) => { const result = await invoke("list", { p_club_id: clubId }); if (!Array.isArray(result.items)) throw new Error("Invalid tee classification list"); return result.items; },
    detail: async (clubId, row) => { const result = await invoke("detail", target(clubId, row)); if (!Array.isArray(result.history) || !Array.isArray(result.configurations)) throw new Error("Invalid tee classification detail"); return result; },
    preview: (clubId, detail, fields) => invoke("preview", { ...target(clubId, detail), p_decision: teeDecisionPayload(fields), p_expected_revision: detail.revision }),
    confirm: (clubId, preview) => invoke("confirm", { ...target(clubId, preview), p_decision: preview.decision,
      p_expected_revision: preview.revision, p_expected_baseline: preview.baseline, p_confirm: true })
  };
}
