import {createCatalogMetadataService,getMetadataRequestError,metadataDiff,normalizeEditorialFields} from "./catalog-metadata-data";

export function normalizeCourseFields(fields) {
  return {
    name: String(fields.name || "").trim(),
    holes_count: Number(fields.holes_count),
    display_order: fields.display_order === "" || fields.display_order == null ? null : Number(fields.display_order),
    is_active: fields.is_active === true,
    ...normalizeEditorialFields(fields)
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
    is_active: readField("isActive", "is_active"),aliases:course.aliases,notes:course.notes
  });
  const saved = normalizeCourseFields(draft.snapshot);
  return Object.keys(live).some((key) => JSON.stringify(live[key]) !== JSON.stringify(saved[key]));
}

export function getCourseDiff(base, fields) {
  return metadataDiff(normalizeCourseFields(base),normalizeCourseFields(fields));
}

export function formatCourseValue(key, value) {
  if (value == null || value === "") return "—";
  if (key === "is_active") return value ? "Attivo" : "Disattivato";
  if (key === "holes_count") return `${value} buche`;
  return String(value);
}

export function getCourseEditorError(error) {
  const requestError=getMetadataRequestError(error);if(requestError)return requestError;
  if (["40001","PT409"].includes(error?.code)) return "La bozza o i dati del percorso sono cambiati. Riapri l’editor per verificare la base; la pubblicazione è stata bloccata.";
  if (error?.code === "42501") return "Non sei autorizzato a modificare questa bozza.";
  if (error?.code === "23514") return "La struttura del percorso ha dati collegati e non può essere modificata. Nessun dato è stato pubblicato.";
  return "Impossibile completare l’operazione. Riprova.";
}

export function createCourseEditorService(client) {
  const metadata=createCatalogMetadataService(client,"route");
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
    ...metadata,
    getDraft: async (courseId) => {
      const row = await invoke("admin_course_get_draft", { p_course_id: courseId });
      return row?.draft_id ? row : null;
    },
    saveDraft: (draft,fields) => metadata.saveMetadataDraft(draft,normalizeCourseFields(fields)),
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
    isActive: live.is_active, status: live.is_active ? "Attivo" : "Disattivato",aliases:live.aliases??course.aliases??[],notes:live.notes??null
  }).sort((left, right) => (left.displayOrder ?? 2147483648) - (right.displayOrder ?? 2147483648) || left.name.localeCompare(right.name, "it"));
  const routes = allCourses.filter((course) => course.isActive);
  return { ...club, allCourses, routes,
    courses: `${routes.length} ${routes.length === 1 ? "percorso" : "percorsi"} · ${routes.length + club.combinations.length} route`,
    courseNames: [...routes.map((course) => course.name), ...club.combinations.map((combination) => combination.name)] };
}
