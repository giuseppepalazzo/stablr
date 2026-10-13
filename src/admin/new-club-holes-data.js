const numberOrNull = (value) => value == null || value === "" ? null : Number(value);
export function normalizeNewClubHoles(snapshot) {
  return { holes_count: snapshot.holes_count, holes: (snapshot.holes || []).map((hole) => ({
    physical_hole_number: hole.physical_hole_number, par: numberOrNull(hole.par), stroke_index: numberOrNull(hole.stroke_index)
  })) };
}
export function validateNewClubHoles(snapshot) {
  const { holes_count: count, holes } = normalizeNewClubHoles(snapshot);
  const shape = [9, 18].includes(count) && holes.length === count
    && holes.every((hole, index) => hole.physical_hole_number === index + 1);
  const parValid = holes.every((hole) => hole.par == null || [3, 4, 5].includes(hole.par));
  const siValid = holes.every((hole) => hole.stroke_index == null || (Number.isInteger(hole.stroke_index) && hole.stroke_index >= 1 && hole.stroke_index <= count));
  const si = holes.map((hole) => hole.stroke_index).filter((value) => value != null);
  const missingSi = Array.from({ length: [9, 18].includes(count) ? count : 0 }, (_, i) => i + 1).filter((value) => !si.includes(value));
  const duplicateSi = si.length !== new Set(si).size;
  const completePar = holes.every((hole) => hole.par != null);
  const totalPar = holes.some((hole) => hole.par != null) ? holes.reduce((sum, hole) => sum + (hole.par || 0), 0) : null;
  return { canSave: shape && parValid && siValid && !duplicateSi, configured: shape && parValid && siValid && completePar && si.length === count && !duplicateSi,
    totalPar, completePar, missingSi, duplicateSi, parValid, siValid };
}

export function createNewClubHolesService(client) {
  const invoke = async (name, params) => {
    if (!client) throw new Error("Private hole grid client required");
    const { data, error } = await client.rpc(name, params);
    if (error) throw error;
    return data;
  };
  const requireCourse = (course, owner) => {
    if (!owner || course?.entity_type !== "route" || course.live_entity_id !== null || course.created_by !== owner
      || course.workflow_status !== "draft" || !course.parent_draft_id || ![9, 18].includes(course.snapshot?.holes_count)) {
      throw new Error("Owned private Percorso required");
    }
  };
  const requireGrid = (draft, course, owner, status = "draft") => {
    if (!draft?.draft_id || draft.entity_type !== "new_course_holes_grid" || draft.created_by !== owner
      || draft.parent_draft_id !== course.draft_id || draft.live_entity_id !== null || draft.base_snapshot != null
      || draft.base_version_id != null || draft.schema_version !== 1 || draft.workflow_status !== status
      || !Number.isInteger(draft.revision) || draft.revision < 1 || draft.snapshot?.holes_count !== course.snapshot.holes_count
      || !validateNewClubHoles(draft.snapshot).canSave || Object.keys(draft.snapshot).some((key) => !["holes_count", "holes"].includes(key))
      || draft.snapshot.holes.some((hole) => Object.keys(hole).some((key) => !["physical_hole_number", "par", "stroke_index"].includes(key)))) {
      throw new Error("Invalid private hole grid");
    }
    return draft;
  };
  const single = (value) => Array.isArray(value) && value.length === 1 ? value[0] : value;
  return {
    async getCourseGridSummaries(parent, owner) {
      if (!owner || parent.created_by !== owner || parent.entity_type !== "club" || parent.live_entity_id !== null) throw new Error("Owned private Club required");
      const result = await invoke("admin_new_course_holes_summaries", { p_club_draft_id: parent.draft_id });
      if (!Array.isArray(result) || result.some((row) => !row.course_draft_id || !row.grid_draft_id || typeof row.configured !== "boolean"
        || (row.total_par != null && !Number.isInteger(row.total_par)))) throw new Error("Invalid private grid summaries");
      return result;
    },
    async openCourseHoleDraft(course, owner) {
      requireCourse(course, owner);
      const result = await invoke("admin_new_course_holes_open", { p_course_draft_id: course.draft_id });
      requireCourse(result?.course, owner);
      if (result.course.draft_id !== course.draft_id || result.course.parent_draft_id !== course.parent_draft_id) throw new Error("Private grid target mismatch");
      return { course: result.course, draft: requireGrid(result.draft, result.course, owner) };
    },
    async saveCourseHoleDraft(course, draft, snapshot, owner) {
      requireCourse(course, owner);requireGrid(draft, course, owner);
      if (!validateNewClubHoles(snapshot).canSave) throw new Error("Invalid Par/SI or private grid structure");
      const saved = requireGrid(single(await invoke("admin_new_course_holes_save", { p_draft_id: draft.draft_id,
        p_snapshot: normalizeNewClubHoles(snapshot), p_expected_revision: draft.revision, p_course_revision: course.revision })), course, owner);
      if (saved.draft_id !== draft.draft_id) throw new Error("Private grid target mismatch");
      return saved;
    },
    async abandonCourseHoleDraft(course, draft, owner) {
      requireCourse(course, owner);requireGrid(draft, course, owner);
      const archived = requireGrid(single(await invoke("admin_new_course_holes_archive", { p_draft_id: draft.draft_id,
        p_expected_revision: draft.revision, p_course_revision: course.revision })), course, owner, "archived");
      if (archived.draft_id !== draft.draft_id) throw new Error("Private grid target mismatch");
      return archived;
    }
  };
}
