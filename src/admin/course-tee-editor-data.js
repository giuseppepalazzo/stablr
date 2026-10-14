const FIELDS = [["tee_name", "Nome tee"], ["tee_color", "Colore"], ["gender", "Categoria del rating"], ["display_order", "Ordine"], ["course_rating", "CR"], ["slope_rating", "Slope"], ["is_active", "Stato operativo"]];

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
  const ratings = { course_rating: fields.course_rating == null || fields.course_rating === "" ? null : Number(String(fields.course_rating).replace(",", ".")), slope_rating: numeric(fields.slope_rating), is_active: fields.is_active === true };
  if (!("tee_name" in fields)) return ratings;
  return { tee_name: String(fields.tee_name || "").trim(), tee_color: String(fields.tee_color || "").trim() || null,
    gender: fields.gender == null || fields.gender === "" ? null : fields.gender,
    display_order: numeric(fields.display_order ?? fields.source_payload?.admin_display_order), ...ratings };
}
export function validCourseTeeFields(fields) {
  const value = normalizeCourseTeeFields(fields), { course_rating: cr, slope_rating: slope } = value;
  return (!("tee_name" in value) || (!!value.tee_name && value.tee_name.length <= 200 && (!value.tee_color || value.tee_color.length <= 100)
    && (value.display_order == null || (Number.isInteger(value.display_order) && value.display_order >= -2147483648 && value.display_order <= 2147483647))))
    && (cr === null || Number.isFinite(cr)) && (slope === null || (Number.isInteger(slope) && slope >= 55 && slope <= 155));
}
export function courseTeeDiff(base, fields) {
  const before = normalizeCourseTeeFields(base), after = normalizeCourseTeeFields({ ...base, ...fields });
  return FIELDS.map(([key, label]) => ({ key, label, before: before[key], after: after[key] })).filter((row) => row.before !== row.after);
}
export function courseTeeDraftFields(draft, live) {
  return normalizeCourseTeeFields({ ...(draft.base_snapshot?._context?.tee || live), ...draft.snapshot });
}
export function courseTeePreviewChanges(plan) {
  return FIELDS.filter(([key]) => plan.diff?.[key]).map(([key, label]) => ({ key, label, ...plan.diff[key] }));
}
export function formatCourseTeeValue(key, value) {
  if (value == null || value === "") return "—";
  if (key === "is_active") return value ? "Attivo" : "Disattivato";
  if (key === "gender") return { men: "Uomini", women: "Donne" }[value] || value;
  return String(value);
}
export function courseTeeError(error, kind = "course") {
  const parent = kind === "combination" ? "la combinazione" : "il percorso";
  if (error?.code === "55P03") return `Il tee o ${parent} sono temporaneamente occupati. Torna al tee e riprova. Nessun dato è stato pubblicato.`;
  if (error?.code === "40001") return `La bozza, il tee o ${parent} sono cambiati. Riapri l’editor per verificare la base. Nessun dato è stato pubblicato.`;
  if (error?.code === "42501") return "Non sei autorizzato a modificare questa bozza.";
  if (error?.code === "23505") return "Nome tee già presente nello stesso ambito, anche in un’altra categoria o se disattivato.";
  if (["22023", "23514"].includes(error?.code)) return "Verifica nome, categoria, ordine, CR, Slope e stato operativo. Slope deve essere un intero da 55 a 155 oppure assente. Nessun dato è stato pubblicato.";
  return "Impossibile completare l’operazione. Riprova.";
}
export function createCourseTeeEditorService(client) {
  return createTeeEditorService(client, "course");
}
export function createCombinationTeeEditorService(client) {
  return createTeeEditorService(client, "combination");
}
function createTeeEditorService(client, kind) {
  const prefix = kind === "combination" ? "admin_combination_tee" : "admin_course_tee";
  const parentParam = kind === "combination" ? "p_combination_id" : "p_course_id";
  const invoke = async (method, params) => {
    if (!client) throw new Error("Course tee client unavailable");
    const { data, error } = await client.rpc(`${prefix}_${method}`, params);
    if (error) throw error;
    const result = Array.isArray(data) && data.length === 1 ? data[0] : data;
    if (!result || Array.isArray(result)) throw new Error("Missing single course tee response");
    return result;
  };
  const draftRow = (row) => { if (!row?.draft_id) throw new Error("Missing course tee draft"); return row; };
  return {
    listTees: async (courseId) => {
      const result = await invoke("list", { [parentParam]: courseId });
      const parent = kind === "combination" ? result.combination : result.course;
      if (!parent?.id || !Array.isArray(result.tees)) throw new Error("Invalid course tee list");
      return { ...result, course: parent };
    },
    getDraft: (teeId) => invoke("get_draft", { p_tee_id: teeId }),
    openDraft: async (teeId) => { const result = await invoke("open_draft", { p_tee_id: teeId }); draftRow(result.draft); return result; },
    openNewDraft: async courseId => { const result = await invoke("open_new_draft", { [parentParam]: courseId }); draftRow(result.draft); return result; },
    resumeNewDraft: async draftId => { const result = await invoke("resume_new_draft", { p_draft_id: draftId }); draftRow(result.draft); return result; },
    previewDraft: async draft => {
      const result = await invoke("preview_draft", { p_draft_id: draft.draft_id });
      if (result.draft_id !== draft.draft_id || result.revision !== draft.revision || typeof result.can_publish !== "boolean" || !Array.isArray(result.blockers) || !result.diff) throw new Error("Invalid tee preview");
      const impact = result.foundation_impact;
      if (!impact || typeof impact.may_block_par !== "boolean" || !Array.isArray(impact.configurations) || !["verified_links", "incomplete"].includes(impact.coverage) || impact.baselines_updated !== false) throw new Error("Missing foundation impact in tee preview");
      return result;
    },
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
