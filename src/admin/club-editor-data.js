export function normalizeClubFields(fields) {
  return { name: String(fields.name || "").trim(), city: String(fields.city || "").trim() || null };
}

export function getClubDiff(base, fields) {
  const values = normalizeClubFields(fields);
  return [{ key: "name", label: "Nome", before: base.name, after: values.name },
    { key: "city", label: "Località / città", before: base.city ?? null, after: values.city }]
    .filter((change) => change.before !== change.after);
}

export function getClubEditorError(error) {
  if (error?.code === "40001") return "La bozza o i dati del club sono cambiati. Riapri l’editor per verificare la base; la pubblicazione è stata bloccata.";
  if (error?.code === "42501") return "Non sei autorizzato a modificare questa bozza.";
  return "Impossibile completare l’operazione. Riprova.";
}

export function createClubEditorService(client) {
  const invoke = async (name, parameters, allowEmpty = false) => {
    if (!client) throw new Error("Club editor client unavailable");
    const { data, error } = await client.rpc(name, parameters);
    if (error) throw error;
    const row = Array.isArray(data) && data.length <= 1 ? data[0] : data;
    if (Array.isArray(row)) throw new Error("Club editor returned multiple results");
    if (allowEmpty && (!row || !row.draft_id)) return null;
    if (!row?.draft_id) throw new Error("Club editor returned no single result");
    return row;
  };
  return {
    getDraft: (clubId) => invoke("admin_club_get_draft", { p_club_id: clubId }, true),
    openDraft: (clubId) => invoke("admin_club_open_draft", { p_club_id: clubId }),
    saveDraft: (draft, fields) => invoke("admin_club_save_draft", {
      p_draft_id: draft.draft_id, p_snapshot: normalizeClubFields(fields), p_expected_revision: draft.revision
    }),
    publishDraft: (draft) => invoke("admin_club_publish_draft", {
      p_draft_id: draft.draft_id, p_expected_revision: draft.revision
    }),
    abandonDraft: (draft) => invoke("admin_catalog_archive_draft", {
      p_draft_id: draft.draft_id, p_entity_type: "club", p_expected_revision: draft.revision
    })
  };
}
