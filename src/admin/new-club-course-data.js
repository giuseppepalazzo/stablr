import { createNewClubHolesService } from "./new-club-holes-data";
import { createNewClubTeesService } from "./new-club-tees-data";

export function normalizeNewCourseFields(fields) {
  return { name: String(fields.name || "").trim(),
    holes_count: fields.holes_count === "" ? null : Number(fields.holes_count),
    display_order: fields.display_order === "" ? null : Number(fields.display_order) };
}

export function isNewCourseValid(fields) {
  const value = normalizeNewCourseFields(fields);
  return !!value.name && value.name.length <= 200 && [9, 18].includes(value.holes_count)
    && Number.isInteger(value.display_order) && value.display_order >= -2147483648 && value.display_order <= 2147483647;
}

export function createNewClubCourseService(client) {
  const holes = createNewClubHolesService(client);
  const requireParent = (parent, ownerId) => {
    if (!client || !ownerId || !parent?.draft_id || parent.created_by !== ownerId ||
      parent.entity_type !== "club" || parent.live_entity_id !== null || parent.workflow_status !== "draft") {
      throw new Error("Owned private Club required");
    }
  };
  const requireChild = (child, parent, ownerId, status = "draft") => {
    if (!child?.draft_id || child.entity_type !== "route" || child.parent_draft_id !== parent.draft_id
      || child.created_by !== ownerId || child.workflow_status !== status || child.live_entity_id !== null
      || child.base_version_id != null || child.base_snapshot != null || child.base_live_updated_at != null
      || child.schema_version !== 1 || !Number.isInteger(child.revision) || child.revision < 1
      || typeof child.snapshot?.name !== "string" || !Number.isInteger(child.snapshot?.holes_count)
      || !Number.isInteger(child.snapshot?.display_order)
      || !isNewCourseValid(child.snapshot || {})
      || Object.keys(child.snapshot).some((key) => !["name", "holes_count", "display_order"].includes(key))) {
      throw new Error("Invalid private Percorso draft");
    }
    return child;
  };
  const invoke = async (name, params) => {
    const { data, error } = await client.rpc(name, params);
    if (error) throw error;
    return data;
  };
  const row = (value) => Array.isArray(value) && value.length === 1 ? value[0] : value;
  return {
    ...holes,
    ...createNewClubTeesService(client),
    async listCourseDrafts(parent, ownerId) {
      requireParent(parent, ownerId);
      const data = await invoke("admin_new_club_courses", { p_club_draft_id: parent.draft_id });
      if (!Array.isArray(data)) throw new Error("Invalid private Percorso list");
      const courses = data.map((child) => requireChild(child, parent, ownerId));
      if (!courses.length) return courses;
      const summaries = await holes.getCourseGridSummaries(parent, ownerId);
      if (summaries.some((summary) => !courses.some((course) => course.draft_id === summary.course_draft_id))) {
        throw new Error("Private grid summary target mismatch");
      }
      return courses.map((child) => {
        const summary = summaries.find((item) => item.course_draft_id === child.draft_id);
        return summary ? { ...child, hole_grid: summary } : child;
      });
    },
    async saveCourseDraft(parent, child, fields, ownerId) {
      requireParent(parent, ownerId);
      if (child) requireChild(child, parent, ownerId);
      if (!isNewCourseValid(fields)) throw new Error("Invalid private Percorso fields");
      const result = requireChild(row(await invoke("admin_new_club_course_save", {
        p_club_draft_id: parent.draft_id, p_snapshot: normalizeNewCourseFields(fields),
        p_draft_id: child?.draft_id || null, p_expected_revision: child?.revision || null
      })), parent, ownerId);
      if (child && result.draft_id !== child.draft_id) throw new Error("Percorso draft target mismatch");
      return result;
    },
    async abandonCourseDraft(parent, child, ownerId) {
      requireParent(parent, ownerId);requireChild(child, parent, ownerId);
      const result = requireChild(row(await invoke("admin_new_club_course_archive", {
        p_club_draft_id: parent.draft_id, p_draft_id: child.draft_id, p_expected_revision: child.revision
      })), parent, ownerId, "archived");
      if (result.draft_id !== child.draft_id) throw new Error("Percorso draft target mismatch");
      return result;
    }
  };
}
