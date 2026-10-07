const FIELDS = [["course_rating", "CR"], ["slope_rating", "Slope"], ["is_active", "Stato operativo"]];

// Visual mapping only: never infer a missing color from the tee's name.
export function courseTeeColor(value) {
  const color = String(value ?? "").trim().toLowerCase();
  const colors = { yellow: "#ffff00", giallo: "#ffff00", gialli: "#ffff00", white: "#ffffff", bianco: "#ffffff", bianchi: "#ffffff",
    red: "#ff0000", rosso: "#ff0000", rossi: "#ff0000", blue: "#0000ff", blu: "#0000ff", black: "#000000", nero: "#000000", neri: "#000000",
    green: "#008000", verde: "#008000", verdi: "#008000", orange: "#ffa500", arancio: "#ffa500", arancione: "#ffa500", pink: "#ffc0cb", rosa: "#ffc0cb", purple: "#800080", viola: "#800080" };
  return colors[color] || (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(color) ? color : "#85918b");
}

const numeric = (value) => value == null || String(value).trim() === "" ? null : Number(value);
export function normalizeCourseTeeFields(fields) {
  return { course_rating: numeric(fields.course_rating), slope_rating: numeric(fields.slope_rating), is_active: fields.is_active === true };
}
export function validCourseTeeFields(fields) {
  const { course_rating: cr, slope_rating: slope } = normalizeCourseTeeFields(fields);
  return (cr === null || Number.isFinite(cr)) && (slope === null || (Number.isInteger(slope) && slope >= 55 && slope <= 155));
}
export function courseTeeDiff(base, fields) {
  const before = normalizeCourseTeeFields(base), after = normalizeCourseTeeFields(fields);
  return FIELDS.map(([key, label]) => ({ key, label, before: before[key], after: after[key] })).filter((row) => row.before !== row.after);
}
export function formatCourseTeeValue(key, value) {
  if (value == null || value === "") return "—";
  return key === "is_active" ? (value ? "Attivo" : "Disattivato") : String(value);
}
export function courseTeeError(error) {
  if (error?.code === "55P03") return "Il tee o il percorso sono temporaneamente occupati. Torna al tee e riprova. Nessun dato è stato pubblicato.";
  if (error?.code === "40001") return "La bozza, il tee o il percorso sono cambiati. Riapri l’editor per verificare la base. Nessun dato è stato pubblicato.";
  if (error?.code === "42501") return "Non sei autorizzato a modificare questa bozza.";
  if (["22023", "23514"].includes(error?.code)) return "Verifica CR, Slope e stato operativo. Slope deve essere un intero da 55 a 155 oppure assente. Nessun dato è stato pubblicato.";
  return "Impossibile completare l’operazione. Riprova.";
}
export function createCourseTeeEditorService(client) {
  const invoke = async (method, params) => {
    if (!client) throw new Error("Course tee client unavailable");
    const { data, error } = await client.rpc(`admin_course_tee_${method}`, params);
    if (error) throw error;
    const result = Array.isArray(data) && data.length === 1 ? data[0] : data;
    if (!result || Array.isArray(result)) throw new Error("Missing single course tee response");
    return result;
  };
  const draftRow = (row) => { if (!row?.draft_id) throw new Error("Missing course tee draft"); return row; };
  return {
    listTees: async (courseId) => {
      const result = await invoke("list", { p_course_id: courseId });
      if (!result.course?.id || !Array.isArray(result.tees)) throw new Error("Invalid course tee list");
      return result;
    },
    getDraft: (teeId) => invoke("get_draft", { p_tee_id: teeId }),
    openDraft: async (teeId) => { const result = await invoke("open_draft", { p_tee_id: teeId }); draftRow(result.draft); return result; },
    saveDraft: async (draft, fields) => {
      if (!validCourseTeeFields(fields)) throw Object.assign(new Error("Invalid ratings"), { code: "23514" });
      return draftRow(await invoke("save_draft", { p_draft_id: draft.draft_id, p_snapshot: normalizeCourseTeeFields(fields), p_expected_revision: draft.revision }));
    },
    publishDraft: async (draft) => {
      const result = await invoke("publish_draft", { p_draft_id: draft.draft_id, p_expected_revision: draft.revision });
      if (!result.version_id || !result.context?.tee?.id) throw new Error("Missing published course tee");
      return result;
    },
    abandonDraft: async (draft) => draftRow(await invoke("archive_draft", { p_draft_id: draft.draft_id, p_expected_revision: draft.revision }))
  };
}
