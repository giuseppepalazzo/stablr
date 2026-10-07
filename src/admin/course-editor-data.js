export function normalizeCourseFields(fields) {
  return {
    name: String(fields.name || "").trim(),
    holes_count: Number(fields.holes_count),
    display_order: fields.display_order === "" || fields.display_order == null ? null : Number(fields.display_order),
    is_active: fields.is_active === true
  };
}

// Catalog views use camelCase; SQL/RPC snapshots use the persisted snake_case
// fields. Compare only editable values, normalizing both sides identically.
export function hasCourseDraftChanges(course, draft) {
  if (!draft?.snapshot) return false;
  const readField = (camelCase, snakeCase) => Object.prototype.hasOwnProperty.call(course, camelCase)
    ? course[camelCase] : course[snakeCase];
  const live = normalizeCourseFields({
    name: course.name,
    holes_count: readField("holesCount", "holes_count"),
    display_order: readField("displayOrder", "display_order"),
    is_active: readField("isActive", "is_active")
  });
  const saved = normalizeCourseFields(draft.snapshot);
  return Object.keys(live).some((key) => live[key] !== saved[key]);
}

export function getCourseDiff(base, fields) {
  const values = normalizeCourseFields(fields);
  return [
    ["name", "Nome visualizzato"], ["holes_count", "Struttura"],
    ["display_order", "Ordine"], ["is_active", "Stato operativo"]
  ].map(([key, label]) => ({ key, label, before: base[key] ?? null, after: values[key] }))
    .filter((change) => change.before !== change.after);
}

export function formatCourseValue(key, value) {
  if (value == null || value === "") return "—";
  if (key === "is_active") return value ? "Attivo" : "Disattivato";
  if (key === "holes_count") return `${value} buche`;
  return String(value);
}

export function getCourseEditorError(error) {
  if (error?.code === "40001") return "La bozza o i dati del percorso sono cambiati. Riapri l’editor per verificare la base; la pubblicazione è stata bloccata.";
  if (error?.code === "42501") return "Non sei autorizzato a modificare questa bozza.";
  if (error?.code === "23514") return "La struttura del percorso ha dati collegati e non può essere modificata. Nessun dato è stato pubblicato.";
  return "Impossibile completare l’operazione. Riprova.";
}

export function createCourseEditorService(client) {
  const invoke = async (name, parameters) => {
    if (!client) throw new Error("Course editor client unavailable");
    const { data, error } = await client.rpc(name, parameters);
    if (error) throw error;
    const row = Array.isArray(data) && data.length <= 1 ? data[0] : data;
    if (Array.isArray(row)) throw new Error("Course editor returned multiple results");
    return row;
  };
  const requireDraft = (draft) => {
    if (!draft?.draft_id) throw new Error("Course editor returned no single draft");
    return draft;
  };
  return {
    getDraft: async (courseId) => {
      const row = await invoke("admin_course_get_draft", { p_course_id: courseId });
      return row?.draft_id ? row : null;
    },
    openDraft: async (courseId) => {
      const result = await invoke("admin_course_open_draft", { p_course_id: courseId });
      requireDraft(result?.draft);
      return result;
    },
    saveDraft: async (draft, fields) => requireDraft(await invoke("admin_course_save_draft", {
      p_draft_id: draft.draft_id, p_snapshot: normalizeCourseFields(fields), p_expected_revision: draft.revision
    })),
    publishDraft: async (draft) => {
      const result = await invoke("admin_course_publish_draft", {
        p_draft_id: draft.draft_id, p_expected_revision: draft.revision
      });
      if (!result?.course?.id || !result.version_id) throw new Error("Course publication returned no live result");
      return result;
    },
    abandonDraft: async (draft) => {
      const archived = await invoke("admin_catalog_archive_draft", {
        p_draft_id: draft.draft_id, p_entity_type: "route", p_expected_revision: draft.revision
      });
      return requireDraft(archived);
    }
  };
}

// Keep inactive records reachable for reactivation without changing the active
// catalog counts or adding any synthetic course data.
export function applyCoursePublication(club, live) {
  const allCourses = (club.allCourses || club.routes).map((course) => course.id !== live.id ? course : {
    ...course, name: live.name, holesCount: live.holes_count, displayOrder: live.display_order,
    isActive: live.is_active, status: live.is_active ? "Attivo" : "Disattivato"
  }).sort((left, right) => (left.displayOrder ?? 2147483648) - (right.displayOrder ?? 2147483648) || left.name.localeCompare(right.name, "it"));
  const routes = allCourses.filter((course) => course.isActive);
  return { ...club, allCourses, routes,
    courses: `${routes.length} ${routes.length === 1 ? "percorso" : "percorsi"} · ${routes.length + club.combinations.length} route`,
    courseNames: [...routes.map((course) => course.name), ...club.combinations.map((combination) => combination.name)] };
}
