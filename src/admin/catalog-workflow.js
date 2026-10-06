// Integration seam for future Admin editors. Nothing invokes it from the UI yet.
// Authorization and snapshot/target validation are enforced by the database RPCs.
export function createCatalogWorkflow(client) {
  const invoke = async (name, parameters) => {
    if (!client) throw new Error("Catalog workflow client unavailable");
    const { data, error } = await client.rpc(name, parameters);
    if (error) throw error;
    // PostgREST may represent a composite PostgreSQL row as a one-item array.
    const draft = Array.isArray(data) && data.length === 1 ? data[0] : data;
    if (!draft?.draft_id || Array.isArray(draft)) throw new Error("Catalog workflow returned no single draft");
    return draft;
  };

  return {
    createDraft({ entityType, snapshot, liveEntityId = null, parentDraftId = null, baseVersionId = null, schemaVersion = 1 }) {
      return invoke("admin_catalog_create_draft", {
        p_entity_type: entityType,
        p_snapshot: snapshot,
        p_live_entity_id: liveEntityId,
        p_parent_draft_id: parentDraftId,
        p_base_version_id: baseVersionId,
        p_schema_version: schemaVersion
      });
    },
    saveDraft({ draftId, snapshot, expectedRevision, schemaVersion = 1 }) {
      return invoke("admin_catalog_save_draft", {
        p_draft_id: draftId,
        p_snapshot: snapshot,
        p_expected_revision: expectedRevision,
        p_schema_version: schemaVersion
      });
    },
    restoreVersion({ versionId, parentDraftId = null }) {
      return invoke("admin_catalog_restore_version", {
        p_version_id: versionId,
        p_parent_draft_id: parentDraftId
      });
    }
  };
}
