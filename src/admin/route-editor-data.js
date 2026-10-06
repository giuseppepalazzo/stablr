export function normalizeRouteFields(fields) {
  return { name: String(fields.name || "").trim(), is_active: fields.is_active === true };
}

export function getRouteDiff(base, fields) {
  const values = normalizeRouteFields(fields);
  return [["name", "Nome visualizzato"], ["is_active", "Stato operativo"]]
    .map(([key, label]) => ({ key, label, before: base[key], after: values[key] }))
    .filter((change) => change.before !== change.after);
}

export function formatRouteValue(key, value) {
  if (value == null || value === "") return "—";
  if (key === "is_active") return value ? "Attiva" : "Disattivata";
  return String(value);
}

export function getRouteEditorError(error) {
  if (error?.code === "40001") return "La bozza, la Route o i dati collegati sono cambiati. Riapri l’editor per verificare la base; la pubblicazione è stata bloccata.";
  if (error?.code === "40P01") return "Operazione in conflitto con un altro aggiornamento. Riprova; nessun dato è stato pubblicato.";
  if (error?.code === "42501") return "Non sei autorizzato a modificare questa bozza.";
  if (error?.code === "23514") return "La Route presenta dati delle buche o percorsi origine non coerenti. Nessun dato è stato pubblicato.";
  return "Impossibile completare l’operazione. Riprova.";
}

export function canPublishRoute(context, fields) {
  return context?.checks?.coherent === true && (!fields.is_active || context.checks.origins_active === true);
}

export function createRouteEditorService(client) {
  const invoke = async (name, parameters) => {
    if (!client) throw new Error("Route editor client unavailable");
    const { data, error } = await client.rpc(name, parameters);
    if (error) throw error;
    const row = Array.isArray(data) && data.length <= 1 ? data[0] : data;
    if (Array.isArray(row)) throw new Error("Route editor returned multiple results");
    return row;
  };
  const requireDraft = (draft) => {
    if (!draft?.draft_id) throw new Error("Route editor returned no single draft");
    return draft;
  };
  const getRoute = async (routeId) => {
    const result = await invoke("admin_route_get_draft", { p_route_id: routeId });
    if (!result?.context?.checks) throw new Error("Route editor returned no context");
    return result;
  };
  return {
    getRoute,
    getDraft: async (routeId) => (await getRoute(routeId)).draft || null,
    openDraft: async (routeId) => {
      const result = await invoke("admin_route_open_draft", { p_route_id: routeId });
      requireDraft(result?.draft);
      if (!result.context?.checks) throw new Error("Route editor returned no context");
      return result;
    },
    saveDraft: async (draft, fields) => requireDraft(await invoke("admin_route_save_draft", {
      p_draft_id: draft.draft_id, p_snapshot: normalizeRouteFields(fields), p_expected_revision: draft.revision
    })),
    publishDraft: async (draft) => {
      const result = await invoke("admin_route_publish_draft", {
        p_draft_id: draft.draft_id, p_expected_revision: draft.revision
      });
      if (!result?.route?.id || !result.version_id) throw new Error("Route publication returned no live result");
      return result;
    },
    abandonDraft: async (draft) => {
      const result = requireDraft(await invoke("admin_catalog_archive_draft", {
        p_draft_id: draft.draft_id, p_entity_type: "route_combination", p_expected_revision: draft.revision
      }));
      if (result.workflow_status !== "archived") throw new Error("Route draft was not archived");
      return result;
    }
  };
}

export function applyRoutePublication(club, live) {
  const allCombinations = (club.allCombinations || club.combinations).map((route) => route.id === live.id
    ? { ...route, name: live.name, isActive: live.is_active, status: live.is_active ? "Attiva" : "Disattivata" }
    : route);
  const combinations = allCombinations.filter((route) => route.isActive !== false);
  const routes = club.routes;
  return { ...club, allCombinations, combinations,
    courses: `${routes.length} ${routes.length === 1 ? "percorso" : "percorsi"} · ${routes.length + combinations.length} route`,
    courseNames: [...routes.map((course) => course.name), ...combinations.map((route) => route.name)] };
}
