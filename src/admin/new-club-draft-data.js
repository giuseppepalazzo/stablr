import { createCatalogWorkflow } from "./catalog-workflow";
import { normalizeClubFields } from "./club-editor-data";

export function createNewClubDraftService(client) {
  const workflow = createCatalogWorkflow(client);
  const requireOwner = (ownerId) => {
    if (!client || !ownerId) throw new Error("Authenticated Admin required");
  };
  const requireDraft = (draft, ownerId) => {
    if (!draft?.draft_id || draft.entity_type !== "club" || draft.live_entity_id !== null ||
      draft.created_by !== ownerId || draft.workflow_status !== "draft" || draft.schema_version !== 1 ||
      draft.parent_draft_id != null || draft.base_version_id != null || draft.base_snapshot != null ||
      !Number.isInteger(draft.revision) || draft.revision < 1 ||
      typeof draft.snapshot?.name !== "string" ||
      (draft.snapshot.city != null && typeof draft.snapshot.city !== "string") ||
      Object.keys(draft.snapshot).some((key) => !["name", "city"].includes(key))) {
      throw new Error("Invalid owned new Club draft");
    }
    return draft;
  };
  const query = (ownerId) => {
    requireOwner(ownerId);
    return client.from("admin_catalog_drafts")
      .select("draft_id,entity_type,live_entity_id,parent_draft_id,base_version_id,base_snapshot,schema_version,snapshot,workflow_status,revision,created_by,created_at,updated_at")
      .eq("entity_type", "club").eq("created_by", ownerId).eq("workflow_status", "draft")
      .eq("schema_version", 1).is("live_entity_id", null).is("parent_draft_id", null)
      .is("base_version_id", null).is("base_snapshot", null);
  };
  return {
    async listDrafts(ownerId) {
      const { data, error } = await query(ownerId).order("updated_at", { ascending: false });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Invalid new Club draft list");
      return data.map((draft) => requireDraft(draft, ownerId));
    },
    async openDraft(draftId, ownerId) {
      requireOwner(ownerId);
      if (!draftId) return requireDraft(await workflow.createDraft({
        entityType: "club", snapshot: { name: "", city: null }
      }), ownerId);
      const { data, error } = await query(ownerId).eq("draft_id", draftId).single();
      if (error) throw error;
      const draft = requireDraft(data, ownerId);
      if (draft.draft_id !== draftId) throw new Error("New Club draft target mismatch");
      return draft;
    },
    async saveDraft(draft, fields, ownerId) {
      requireOwner(ownerId);requireDraft(draft, ownerId);
      const snapshot = normalizeClubFields(fields);
      if (!snapshot.name || snapshot.name.length > 200 || (snapshot.city?.length || 0) > 200) {
        throw new Error("Club name and city validation failed");
      }
      const saved = requireDraft(await workflow.saveDraft({
        draftId: draft.draft_id, snapshot, expectedRevision: draft.revision
      }), ownerId);
      if (saved.draft_id !== draft.draft_id) throw new Error("New Club draft target mismatch");
      return saved;
    },
    async abandonDraft(draft, ownerId) {
      requireOwner(ownerId);requireDraft(draft, ownerId);
      const { data, error } = await client.rpc("admin_catalog_archive_draft", {
        p_draft_id: draft.draft_id, p_entity_type: "club", p_expected_revision: draft.revision
      });
      if (error) throw error;
      const row = Array.isArray(data) && data.length === 1 ? data[0] : data;
      if (row?.draft_id !== draft.draft_id || row.workflow_status !== "archived" ||
        row.live_entity_id !== null || row.created_by !== ownerId) throw new Error("New Club draft was not archived");
      return row;
    }
  };
}
