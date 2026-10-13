const numberOrNull = value => value == null || value === "" ? null : Number(value);
const decimalOrNull = value => value == null || value === "" ? null : Number(String(value).trim().replace(",", "."));
export const ratingCategoryLabel = category => ({ men: "Uomini", women: "Donne", unspecified: "Non specificata" }[category] || "—");
export function normalizeNewTeeFields(fields) {
  return { name: String(fields.name || "").trim(), tee_color: String(fields.tee_color || "").trim() || null,
    rating_category: fields.rating_category, course_rating: decimalOrNull(fields.course_rating),
    slope_rating: numberOrNull(fields.slope_rating), is_active: fields.is_active, display_order: numberOrNull(fields.display_order) };
}
export function isNewTeeValid(fields) {
  const value = normalizeNewTeeFields(fields);
  return !!value.name && value.name.length <= 200 && (!value.tee_color || value.tee_color.length <= 100)
    && ["men", "women", "unspecified"].includes(value.rating_category)
    && (value.course_rating == null || Number.isFinite(value.course_rating))
    && (value.slope_rating == null || (Number.isInteger(value.slope_rating) && value.slope_rating >= 55 && value.slope_rating <= 155))
    && typeof value.is_active === "boolean" && Number.isInteger(value.display_order)
    && value.display_order >= -2147483648 && value.display_order <= 2147483647;
}
export function hasDuplicateNewTee(tees, fields, draftId) {
  const normalized = normalizeNewTeeFields(fields);
  return tees.some(tee => tee.draft_id !== draftId && tee.snapshot.name.trim().toLowerCase() === normalized.name.toLowerCase()
    && tee.snapshot.rating_category === normalized.rating_category);
}
export function createNewClubTeesService(client) {
  const invoke = async (name, params) => {
    if (!client) throw new Error("Private tee client required");
    const { data, error } = await client.rpc(name, params);
    if (error) throw error;
    return data;
  };
  const requireCourse = (course, owner) => {
    if (!owner || course?.entity_type !== "route" || course.created_by !== owner || course.live_entity_id !== null
      || course.workflow_status !== "draft" || !course.parent_draft_id) throw new Error("Owned private course required");
  };
  const requireTee = (tee, course, owner, status = "draft", requireValidRatings = false) => {
    if (!tee?.draft_id || tee.entity_type !== "new_course_tee" || tee.parent_draft_id !== course.draft_id
      || tee.created_by !== owner || tee.live_entity_id !== null || tee.base_snapshot != null || tee.base_version_id != null
      || tee.base_live_updated_at != null || tee.schema_version !== 1 || tee.workflow_status !== status
      || !Number.isInteger(tee.revision) || tee.revision < 1
      || !isNewTeeValid(requireValidRatings ? tee.snapshot || {} : { ...tee.snapshot, course_rating: null, slope_rating: null })
      || [tee.snapshot?.course_rating, tee.snapshot?.slope_rating].some(value => value != null && (typeof value !== "number" || !Number.isFinite(value)))
      || Object.keys(tee.snapshot).some(key => !["name", "tee_color", "rating_category", "course_rating", "slope_rating", "is_active", "display_order"].includes(key))) {
      throw new Error("Invalid private tee draft");
    }
    return tee;
  };
  const row = data => Array.isArray(data) && data.length === 1 ? data[0] : data;
  return {
    async listCourseTeeDrafts(course, owner) {
      requireCourse(course, owner);
      const result = await invoke("admin_new_course_tees", { p_course_draft_id: course.draft_id }), context = result?.context;
      if (context?.course_draft_id !== course.draft_id || ![9, 18].includes(context.holes_count)
        || !Number.isInteger(context.course_revision) || typeof context.configured !== "boolean"
        || (context.configured && (!context.grid_draft_id || !Number.isInteger(context.grid_revision) || !Number.isInteger(context.par_total)))
        || !Array.isArray(result.tees)) throw new Error("Invalid private tee context");
      return { context, tees: result.tees.map(tee => requireTee(tee, course, owner)) };
    },
    async saveCourseTeeDraft(course, context, tee, fields, owner) {
      requireCourse(course, owner);if (tee) requireTee(tee, course, owner);
      if (!context?.configured || context.course_draft_id !== course.draft_id || !isNewTeeValid(fields)) throw new Error("Valid grid and tee required");
      const saved = requireTee(row(await invoke("admin_new_course_tee_save", { p_course_draft_id: course.draft_id,
        p_snapshot: normalizeNewTeeFields(fields), p_course_revision: context.course_revision,
        p_grid_draft_id: context.grid_draft_id, p_grid_revision: context.grid_revision,
        p_draft_id: tee?.draft_id || null, p_expected_revision: tee?.revision || null })), course, owner, "draft", true);
      if (tee && saved.draft_id !== tee.draft_id) throw new Error("Private tee target mismatch");
      return saved;
    },
    async abandonCourseTeeDraft(course, tee, owner) {
      requireCourse(course, owner);requireTee(tee, course, owner);
      const archived = requireTee(row(await invoke("admin_new_course_tee_archive", { p_course_draft_id: course.draft_id,
        p_draft_id: tee.draft_id, p_expected_revision: tee.revision })), course, owner, "archived");
      if (archived.draft_id !== tee.draft_id) throw new Error("Private tee target mismatch");
      return archived;
    }
  };
}
