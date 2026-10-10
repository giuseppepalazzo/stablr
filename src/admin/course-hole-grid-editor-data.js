const integerOrNull = (value) => value === "" || value == null ? null : Number(value);

export function normalizeCourseHoleGrid(snapshot) {
  return { holes: (snapshot.holes || []).map((hole) => ({
    id: hole.id, physical_hole_number: hole.physical_hole_number,
    par: integerOrNull(hole.par), stroke_index: integerOrNull(hole.stroke_index)
  })).sort((a,b) => a.physical_hole_number - b.physical_hole_number || a.id.localeCompare(b.id)) };
}

export function getCourseHoleGridDiff(base,snapshot) {
  return normalizeCourseHoleGrid(snapshot).holes.flatMap((hole) => {
    const previous = base.holes.find((item) => item.id === hole.id);
    if (!previous) return [];
    return [["par","Par"],["stroke_index","SI/HCP"]].filter(([key]) => previous[key] !== hole[key])
      .map(([key,label]) => ({ key: `${hole.id}-${key}`, label: `Buca ${hole.physical_hole_number} · ${label}`, before: previous[key], after: hole[key] }));
  });
}

export function validateCourseHoleGrid(context,snapshot) {
  const holes = normalizeCourseHoleGrid(snapshot).holes;
  const expected = context?.course?.holes_count;
  const sequence = context?.si_sequence || [];
  const numbers = holes.map((hole) => hole.physical_hole_number);
  const missingNumbers = Array.from({ length: expected || 0 },(_,i) => i+1).filter((n) => !numbers.includes(n));
  const duplicateNumbers = numbers.length - new Set(numbers).size;
  const parValid = holes.every((h) => h.par == null || (Number.isInteger(h.par) && h.par >= 3 && h.par <= 6));
  const siValid = holes.every((h) => h.stroke_index == null || (Number.isInteger(h.stroke_index) && h.stroke_index >= 1 && h.stroke_index <= 18));
  const si = holes.map((h) => h.stroke_index).filter((n) => n != null).sort((a,b) => a-b);
  const duplicateSi = si.length - new Set(si).size;
  const missingSi = sequence.filter((n) => !si.includes(n));
  const totalPar = holes.reduce((sum,h) => sum + (h.par || 0),0);
  const alerts = [];
  if (![9,18].includes(expected) || holes.length !== expected || missingNumbers.length || duplicateNumbers ||
    numbers.some((n) => !Number.isInteger(n) || n < 1 || n > expected) || context?.checks?.actual_holes !== expected ||
    context?.checks?.duplicate_numbers !== 0 || context?.checks?.invalid_numbers !== 0) alerts.push("La griglia ha buche mancanti, duplicate o un ordine incoerente. Numero e ordine sono in sola lettura.");
  if (!parValid || holes.some((h) => h.par == null)) alerts.push("Compila il Par di ogni buca con un intero da 3 a 6.");
  if (!siValid || sequence.length !== expected || new Set(sequence).size !== expected || JSON.stringify(si) !== JSON.stringify(sequence)) alerts.push("Gli SI/HCP devono corrispondere alla sequenza prevista per il Percorso, senza valori mancanti o duplicati.");
  if (context?.course?.total_par != null && totalPar !== context.course.total_par) alerts.push("Il Totale Par deve corrispondere al totale già registrato per il Percorso.");
  return { canSave: parValid && siValid, canPublish: alerts.length === 0, alerts, totalPar, duplicateSi, missingSi, duplicateNumbers, missingNumbers };
}

export function getCourseHoleGridError(error) {
  if (error?.code === "40001") return "La bozza, il Percorso o le buche sono cambiati. Riapri l’editor per verificare la base; la pubblicazione è stata bloccata.";
  if (["40P01","55P03"].includes(error?.code)) return "È in corso un altro aggiornamento. Riprova; nessun dato è stato pubblicato.";
  if (error?.code === "42501") return "Non sei autorizzato a modificare questa bozza.";
  if (["22023","23514"].includes(error?.code)) return "Verifica Par, SI/HCP e coerenza delle buche del Percorso. Nessun dato è stato pubblicato.";
  return "Impossibile completare l’operazione. Riprova.";
}

export function createCourseHoleGridEditorService(client) {
  const invoke = async (name,parameters) => {
    if (!client) throw new Error("Course hole grid client unavailable");
    const { data,error } = await client.rpc(name,parameters);
    if (error) throw error;
    const result = Array.isArray(data) && data.length <= 1 ? data[0] : data;
    if (!result || Array.isArray(result)) throw new Error("Course hole grid returned no single result");
    return result;
  };
  const requireContext = (result) => {
    if (!result.context?.course?.id || !result.context.checks || !Array.isArray(result.context.holes) || !Array.isArray(result.context.si_sequence)) throw new Error("Course hole grid returned no context");
    return result;
  };
  const requireDraft = (draft) => {
    if (!draft?.draft_id || !Array.isArray(draft.snapshot?.holes)) throw new Error("Course hole grid returned no draft");
    return draft;
  };
  return {
    parWorkflow: true,
    getGrid: async (courseId) => requireContext(await invoke("admin_course_hole_grid_get_draft",{ p_course_id: courseId })),
    openDraft: async (courseId) => {
      const result = requireContext(await invoke("admin_course_hole_grid_open_draft",{ p_course_id: courseId }));
      requireDraft(result.draft);
      if (result.draft.live_entity_id !== courseId || result.context.course.id !== courseId) throw new Error("Course hole grid target mismatch");
      return result;
    },
    saveDraft: async (draft,fields) => requireDraft(await invoke("admin_course_hole_grid_save_draft",{
      p_draft_id: draft.draft_id, p_snapshot: normalizeCourseHoleGrid(fields), p_expected_revision: draft.revision
    })),
    publishDraft: async (draft) => {
      const result = requireContext(await invoke("admin_course_hole_grid_publish_draft",{ p_draft_id: draft.draft_id, p_expected_revision: draft.revision }));
      if (!result.version_id || result.course_id !== draft.live_entity_id || result.context.course.id !== draft.live_entity_id) throw new Error("Course hole publication target mismatch");
      return result;
    },
    abandonDraft: async (draft) => {
      const result = requireDraft(await invoke("admin_course_hole_grid_archive_draft",{ p_draft_id: draft.draft_id, p_expected_revision: draft.revision }));
      if (result.workflow_status !== "archived") throw new Error("Course hole draft was not archived");
      return result;
    }
  };
}
