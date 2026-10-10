const toInteger = (value) => value === "" || value == null ? null : Number(value);

export function normalizeHoleGrid(snapshot) {
  return { holes: (snapshot.holes || []).map((hole) => ({
    id: hole.id, round_hole_number: hole.round_hole_number,
    par: toInteger(hole.par), stroke_index: toInteger(hole.stroke_index)
  })).sort((a, b) => a.round_hole_number - b.round_hole_number || a.id.localeCompare(b.id)) };
}

export function getHoleGridDiff(base, snapshot) {
  return normalizeHoleGrid(snapshot).holes.flatMap((hole) => {
    const previous = base.holes.find((item) => item.id === hole.id);
    if (!previous) return [];
    return [["par", "Par"], ["stroke_index", "SI/HCP"]].filter(([key]) => previous[key] !== hole[key])
      .map(([key, label]) => ({ key: `${hole.id}-${key}`, label: `Buca ${hole.round_hole_number} · ${label}`, before: previous[key], after: hole[key] }));
  });
}

export function validateHoleGrid(context, snapshot) {
  const holes = normalizeHoleGrid(snapshot).holes;
  const checks = context?.checks || {};
  const expected = context?.route?.holes_count;
  const parValid = holes.every((hole) => hole.par == null || (Number.isInteger(hole.par) && hole.par >= 3 && hole.par <= 6));
  const siValid = holes.every((hole) => hole.stroke_index == null || (Number.isInteger(hole.stroke_index) && hole.stroke_index >= 1 && hole.stroke_index <= 18));
  const totalPar = holes.reduce((sum, hole) => sum + (hole.par || 0), 0);
  const missing = Array.from({ length: expected || 0 }, (_, i) => i + 1).filter((n) => !holes.some((hole) => hole.round_hole_number === n));
  const duplicateNumbers = holes.length - new Set(holes.map((hole) => hole.round_hole_number)).size;
  const si = holes.map((hole) => hole.stroke_index).filter((n) => n != null);
  const duplicateSi = si.length - new Set(si).size;
  const missingSi = Array.from({ length: expected || 0 }, (_, i) => i + 1).filter((n) => !si.includes(n));
  const alerts = [];
  if (expected !== 18 || holes.length !== 18 || missing.length || duplicateNumbers || checks.origins_valid !== true ||
    checks.actual_holes !== 18 || checks.duplicate_physical_holes !== 0 || checks.invalid_origin_holes !== 0 ||
    checks.front_holes !== 9 || checks.back_holes !== 9) alerts.push("La sequenza delle buche è incompleta o incoerente. Numeri e collegamenti origine restano in sola lettura.");
  if (!parValid || holes.some((hole) => hole.par == null)) alerts.push("Compila il Par di ogni buca con un intero da 3 a 6.");
  if (!siValid || si.length !== 18 || duplicateSi || missingSi.length) alerts.push("Gli SI/HCP devono contenere tutti gli interi da 1 a 18, ciascuno una sola volta.");
  if (context?.route?.total_par != null && totalPar !== context.route.total_par) alerts.push("Il Totale Par deve corrispondere al totale già registrato per la combinazione.");
  return { canSave: parValid && siValid, canPublish: alerts.length === 0, totalPar, duplicateSi, missingSi, alerts };
}

export function getHoleGridEditorError(error) {
  if (error?.code === "40001") return "La bozza, la combinazione o le buche sono cambiate. Riapri l’editor per verificare la base; la pubblicazione è stata bloccata.";
  if (["40P01", "55P03"].includes(error?.code)) return "È in corso un altro aggiornamento. Riprova; nessun dato è stato pubblicato.";
  if (error?.code === "42501") return "Non sei autorizzato a modificare questa bozza.";
  if (["22023", "23514"].includes(error?.code)) return "Verifica Par, SI/HCP e coerenza della griglia. Nessun dato è stato pubblicato.";
  return "Impossibile completare l’operazione. Riprova.";
}

export function createHoleGridEditorService(client) {
  const invoke = async (name, parameters) => {
    if (!client) throw new Error("Hole grid client unavailable");
    const { data, error } = await client.rpc(name, parameters);
    if (error) throw error;
    const result = Array.isArray(data) && data.length <= 1 ? data[0] : data;
    if (!result || Array.isArray(result)) throw new Error("Hole grid returned no single result");
    return result;
  };
  const requireContext = (result) => {
    if (!result.context?.checks || !Array.isArray(result.context.holes)) throw new Error("Hole grid returned no context");
    return result;
  };
  const requireDraft = (draft) => {
    if (!draft?.draft_id || !Array.isArray(draft.snapshot?.holes)) throw new Error("Hole grid returned no draft");
    return draft;
  };
  return {
    parWorkflow: true,
    getGrid: async (routeId) => requireContext(await invoke("admin_hole_grid_get_draft", { p_route_id: routeId })),
    openDraft: async (routeId) => {
      const result = requireContext(await invoke("admin_hole_grid_open_draft", { p_route_id: routeId }));
      requireDraft(result.draft);
      return result;
    },
    saveDraft: async (draft, fields) => requireDraft(await invoke("admin_hole_grid_save_draft", {
      p_draft_id: draft.draft_id, p_snapshot: normalizeHoleGrid(fields), p_expected_revision: draft.revision
    })),
    publishDraft: async (draft) => {
      const result = requireContext(await invoke("admin_hole_grid_publish_draft", {
        p_draft_id: draft.draft_id, p_expected_revision: draft.revision
      }));
      if (!result.version_id || result.route_id !== draft.live_entity_id) throw new Error("Hole publication returned no live result");
      return result;
    },
    abandonDraft: async (draft) => {
      const result = requireDraft(await invoke("admin_hole_grid_archive_draft", {
        p_draft_id: draft.draft_id, p_expected_revision: draft.revision
      }));
      if (result.workflow_status !== "archived") throw new Error("Hole grid was not archived");
      return result;
    }
  };
}
