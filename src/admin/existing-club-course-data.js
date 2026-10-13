import { createNewClubHolesService } from "./new-club-holes-data";
import { createNewClubTeesService } from "./new-club-tees-data";
import { isNewCourseValid, normalizeNewCourseFields } from "./new-club-course-data";

export function createExistingClubCourseService(client) {
  const invoke = async (name, params) => {
    if (!client) throw new Error("New course client required");
    const { data, error } = await client.rpc(name, params);
    if (error) throw error;
    return Array.isArray(data) && data.length === 1 ? data[0] : data;
  };
  const requireClub = (club, owner) => { if (!club?.club_id || !owner) throw new Error("Existing Club and Admin required"); };
  const requireDraft = (draft, owner, status = "draft") => {
    if (!draft?.draft_id || draft.entity_type !== "route" || draft.live_entity_id !== null || !draft.parent_draft_id
      || draft.created_by !== owner || draft.workflow_status !== status || draft.schema_version !== 1
      || draft.base_snapshot != null || draft.base_version_id != null || draft.base_live_updated_at != null
      || !Number.isInteger(draft.revision) || draft.revision < 1 || !isNewCourseValid(draft.snapshot || {})) {
      throw new Error("Owned private new course required");
    }
    return draft;
  };
  return {
    ...createNewClubHolesService(client), ...createNewClubTeesService(client),
    async listCourseDrafts(club, owner) {
      requireClub(club, owner);
      const result = await invoke("admin_existing_club_courses", { p_club_id: club.club_id });
      if (result?.club_id !== club.club_id || !Array.isArray(result.courses) || !Array.isArray(result.grid_summaries)) throw new Error("Invalid new course list");
      return result.courses.map(draft => {
        requireDraft(draft, owner);
        const summary = result.grid_summaries.find(item => item.course_draft_id === draft.draft_id);
        return summary ? { ...draft, hole_grid: summary } : draft;
      });
    },
    async saveCourseDraft(club, draft, fields, owner) {
      requireClub(club, owner);if (draft) requireDraft(draft, owner);
      if (!isNewCourseValid(fields)) throw new Error("Valid new course fields required");
      const saved = requireDraft(await invoke("admin_existing_club_course_save", { p_club_id: club.club_id,
        p_snapshot: normalizeNewCourseFields(fields), p_draft_id: draft?.draft_id || null, p_expected_revision: draft?.revision || null }), owner);
      if (draft && saved.draft_id !== draft.draft_id) throw new Error("New course target mismatch");
      return saved;
    },
    async abandonCourseDraft(club, draft, owner) {
      requireClub(club, owner);requireDraft(draft, owner);
      const archived = requireDraft(await invoke("admin_existing_club_course_archive", {
        p_club_id: club.club_id, p_draft_id: draft.draft_id, p_expected_revision: draft.revision }), owner, "archived");
      if (archived.draft_id !== draft.draft_id) throw new Error("New course target mismatch");
      return archived;
    },
    async previewCoursePublication(club, draft, owner) {
      requireClub(club, owner);requireDraft(draft, owner);
      const plan = await invoke("admin_existing_club_course_preview", { p_draft_id: draft.draft_id });
      if (plan?.draft_id !== draft.draft_id || plan.revision !== draft.revision || plan.club?.id !== club.club_id
        || typeof plan.can_publish !== "boolean" || !Array.isArray(plan.blockers) || !plan.checklist
        || !plan.course?.fields || !Array.isArray(plan.course.tees) || !/^[a-f0-9]{64}$/.test(plan.confirmation_hash)) throw new Error("Invalid new course preview");
      return plan;
    },
    async publishCourse(club, draft, plan, note, owner) {
      requireClub(club, owner);requireDraft(draft, owner);
      if (!plan?.can_publish || plan.draft_id !== draft.draft_id || plan.revision !== draft.revision
        || plan.club?.id !== club.club_id || !/^[a-f0-9]{64}$/.test(plan.confirmation_hash) || !note.trim() || note.trim().length > 500) throw new Error("Complete preview and note required");
      const result = await invoke("admin_existing_club_course_publish", { p_draft_id: draft.draft_id,
        p_expected_revision: draft.revision, p_confirmation_hash: plan.confirmation_hash, p_note: note.trim() });
      if (result?.draft_id !== draft.draft_id || !result.publication_id || !result.version_id
        || !result.course?.id || result.course.club_id !== club.club_id || !Array.isArray(result.course.route_holes) || !Array.isArray(result.course.route_tees)) throw new Error("Invalid new course publication receipt");
      return result;
    }
  };
}
