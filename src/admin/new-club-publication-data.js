export function validateNewClubPublicationPreview(plan, draft) {
  if (!plan || plan.draft_id !== draft.draft_id || plan.revision !== draft.revision || !/^[a-f0-9]{64}$/.test(plan.confirmation_hash || "")
    || typeof plan.can_publish !== "boolean" || !Array.isArray(plan.blockers) || !Array.isArray(plan.courses)
    || !plan.club || typeof plan.club.name !== "string" || !plan.checklist || !plan.counts
    || ["club_name", "unique_name", "provenance", "courses", "holes", "tees"].some(key => typeof plan.checklist[key] !== "boolean")
    || ["courses", "holes", "tees"].some(key => !Number.isInteger(plan.counts[key]) || plan.counts[key] < 0)
    || plan.counts.courses !== plan.courses.length
    || plan.courses.some(course => !course.draft_id || !course.fields?.name || ![9, 18].includes(course.fields.holes_count)
      || !Array.isArray(course.tees) || !Array.isArray(course.blockers) || (course.holes != null && !Array.isArray(course.holes)))) {
    throw new Error("Invalid private Club publication preview");
  }
  return plan;
}
export function createNewClubPublicationService(client) {
  const requireDraft = (draft, ownerId) => {
    if (!client || !ownerId || draft?.created_by !== ownerId || draft.entity_type !== "club" || draft.live_entity_id !== null
      || draft.workflow_status !== "draft" || draft.parent_draft_id != null || draft.base_snapshot != null
      || draft.base_version_id != null) throw new Error("Owned private Club required");
  };
  const invoke = async (name, params) => { const { data, error } = await client.rpc(name, params);if (error) throw error;return data; };
  return {
    async previewClubPublication(draft, ownerId) {
      requireDraft(draft, ownerId);
      return validateNewClubPublicationPreview(await invoke("admin_new_club_preview", { p_draft_id: draft.draft_id }), draft);
    },
    async publishNewClub(draft, plan, note, ownerId) {
      requireDraft(draft, ownerId);validateNewClubPublicationPreview(plan, draft);
      const reason = String(note || "").trim();
      if (!plan.can_publish || !reason || reason.length > 500) throw new Error("Complete preview and publication note required");
      const result = await invoke("admin_new_club_publish", { p_draft_id: draft.draft_id, p_expected_revision: draft.revision,
        p_confirmation_hash: plan.confirmation_hash, p_note: reason });
      if (result?.draft_id !== draft.draft_id || !result.publication_id || !result.version_id || !result.club?.id
        || !Array.isArray(result.club.course_routes) || result.club.playable !== true) throw new Error("Invalid new Club publication result");
      return result;
    }
  };
}
