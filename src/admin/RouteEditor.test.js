import { useCallback, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import RouteEditor, { RouteDetail } from "./RouteEditor";
import { applyRoutePublication, canPublishRoute, createRouteEditorService, getRouteDiff, normalizeRouteFields } from "./route-editor-data";

const club = { id: "club-1", name: "Club fixture", dataStatus: "needs_review", figMatchStatus: "unmatched" };
const route = { id: "combination-1", name: "Combinazione fixture", isActive: true, holesCount: 18 };
const snapshot = { name: route.name, is_active: true };
const draft = { draft_id: "draft-1", revision: 1, snapshot, base_snapshot: { ...snapshot, _context: {} } };
const context = {
  route: { holes_count: 18, total_par: 72, order: 0, source_system: "fig", notes: "Nota fonte fixture" },
  origins: [{ position: 1, name: "Percorso A", holes_count: 9, is_active: true }, { position: 2, name: "Percorso B", holes_count: 9, is_active: true }],
  checks: { expected_holes: 18, actual_holes: 18, missing_round_numbers: [], duplicate_round_numbers: 0,
    duplicate_physical_holes: 0, invalid_origin_holes: 0, par_sum: 72, coherent: true, origins_active: true },
  holes: Array.from({ length: 18 }, (_, i) => ({ round_hole_number: i + 1, route_position: i < 9 ? 1 : 2,
    physical_hole_number: i % 9 + 1, par: 4, stroke_index: i + 1 }))
};
const makeService = () => ({
  openDraft: jest.fn().mockResolvedValue({ draft, context }),
  getRoute: jest.fn().mockResolvedValue({ draft: null, context }),
  saveDraft: jest.fn().mockImplementation((current, fields) => Promise.resolve({ ...current, revision: current.revision + 1, snapshot: normalizeRouteFields(fields) })),
  publishDraft: jest.fn().mockResolvedValue({ version_id: "version-1", route: { id: route.id, club_id: club.id, name: "Nome nuovo", is_active: false } }),
  abandonDraft: jest.fn().mockResolvedValue({ ...draft, workflow_status: "archived", revision: 2 })
});

function Harness({ service, onExit = jest.fn(), onPublished = jest.fn() }) {
  const guard = useRef(null);
  const registerExitGuard = useCallback((current) => { guard.current = current; }, []);
  const exit = () => guard.current ? guard.current(onExit) : onExit();
  return <><button onClick={exit}>Vai al catalogo</button><RouteEditor {...{ club, route, service, onPublished, registerExitGuard }} onBack={exit} onBackToClub={exit} onBackToCatalog={exit} /></>;
}

test("diff allowlists name/active with explicit false, ignores technical fields", () => {
  expect(getRouteDiff(snapshot, { ...snapshot, name: ` ${route.name} ` })).toEqual([]);
  expect(getRouteDiff(snapshot, { name: "Nuovo", is_active: false, holes_count: 9, display_order: 5 })).toEqual([
    { key: "name", label: "Nome visualizzato", before: route.name, after: "Nuovo" },
    { key: "is_active", label: "Stato operativo", before: true, after: false }
  ]);
});

test("resumes draft and exposes only name and operational state as editable", async () => {
  const service = makeService();
  service.openDraft.mockResolvedValue({ draft: { ...draft, snapshot: { name: "Bozza salvata", is_active: false } }, context });
  render(<Harness service={service} />);
  await waitFor(() => expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("Bozza salvata"));
  expect(screen.getByLabelText("Stato operativo")).toHaveValue("false");
  expect(screen.getByText("Bozza in corso")).toBeInTheDocument();
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  expect(screen.queryByLabelText("Ordine")).not.toBeInTheDocument();
  expect(screen.getByText("Ordine · sola lettura")).toBeInTheDocument();
  expect(screen.getByText("Nota fonte fixture")).toBeInTheDocument();
  expect(screen.getByText("Da collegare")).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Sequenza buche Route" })).toBeInTheDocument();
  expect(service.openDraft).toHaveBeenCalledWith(route.id);
});

test("save preserves live and publish requires before/after and final confirmation", async () => {
  const service = makeService(); const onPublished = jest.fn();
  render(<Harness service={service} onPublished={onPublished} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Nome nuovo" } });
  fireEvent.change(screen.getByLabelText("Stato operativo"), { target: { value: "false" } });
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza", exact: true }));
  await screen.findByText("Bozza salvata. Il catalogo pubblicato resta invariato.");
  expect(onPublished).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true }));
  const dialog = await screen.findByRole("dialog", { name: "Conferma pubblicazione" });
  const diff = within(dialog).getByRole("table", { name: "Differenze Route" });
  for (const value of [route.name, "Nome nuovo", "Attiva", "Disattivata"]) expect(within(diff).getByText(value)).toBeInTheDocument();
  expect(service.publishDraft).not.toHaveBeenCalled();
  expect(service.saveDraft).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Conferma pubblicazione" }));
  await waitFor(() => expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({ name: "Nome nuovo", is_active: false })));
  expect(service.publishDraft).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
});

test("dirty publication saves first; cancelling confirmation leaves saved draft", async () => {
  const service = makeService(); render(<Harness service={service} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Nome nuovo" } });
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true }));
  const dialog = await screen.findByRole("dialog");
  expect(service.saveDraft).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Annulla" }));
  expect(service.publishDraft).not.toHaveBeenCalled();
  expect(screen.getByText("Bozza in corso")).toBeInTheDocument();
});

test("missing-hole data disables publication, still allows saving and abandoning", async () => {
  const service = makeService();
  const incomplete = { ...context, holes: context.holes.slice(0, 17), checks: { ...context.checks,
    actual_holes: 17, missing_round_numbers: [18], par_sum: 68, coherent: false } };
  service.openDraft.mockResolvedValue({ draft, context: incomplete });
  render(<Harness service={service} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Nome nuovo" } });
  expect(screen.getByRole("button", { name: "Pubblica", exact: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Salva bozza", exact: true })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Abbandona bozza" })).toBeEnabled();
  expect(screen.getByText("17 / 18")).toBeInTheDocument();
  expect(screen.getByText("Buche di giro mancanti: 18.")).toBeInTheDocument();
});

test("inactive origins prevent active publication without forcing changes to origins", () => {
  const inactive = { checks: { coherent: true, origins_active: false } };
  expect(canPublishRoute(inactive, { is_active: true })).toBe(false);
  expect(canPublishRoute(inactive, { is_active: false })).toBe(true);
  expect(canPublishRoute({}, { is_active: false })).toBe(false);
});

test("unsaved exit supports stay and save and warns on browser unload", async () => {
  const service = makeService(); const onExit = jest.fn();
  render(<Harness service={service} onExit={onExit} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Non salvato" } });
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Vai al catalogo" }));
  let dialog = await screen.findByRole("dialog", { name: "Modifiche non salvate" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Resta" }));
  expect(onExit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Club fixture" }));
  dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Salva bozza" }));
  await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  expect(service.saveDraft).toHaveBeenCalledWith(draft, expect.objectContaining({ name: "Non salvato" }));
});

test("discard exits without removing the persisted draft", async () => {
  const service = makeService(); const onExit = jest.fn();
  render(<Harness service={service} onExit={onExit} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Non salvato" } });
  fireEvent.click(screen.getByRole("button", { name: "Vai al catalogo" }));
  const dialog = await screen.findByRole("dialog"); fireEvent.click(within(dialog).getByRole("button", { name: "Scarta" }));
  expect(onExit).toHaveBeenCalledTimes(1); expect(service.saveDraft).not.toHaveBeenCalled(); expect(service.abandonDraft).not.toHaveBeenCalled();
});

test("abandon confirms archival of saved and unsaved changes and removes draft badge", async () => {
  const service = makeService(); const onExit = jest.fn();
  render(<Harness service={service} onExit={onExit} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Non salvato" } });
  fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza" }));
  let dialog = await screen.findByRole("dialog", { name: "Abbandona bozza" });
  expect(within(dialog).getByText("Abbandonare la bozza? Le modifiche non pubblicate non saranno più riprese. Il catalogo pubblicato non cambia.")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Annulla" }));
  expect(service.abandonDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza" }));
  dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Conferma abbandono" }));
  await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  expect(service.abandonDraft).toHaveBeenCalledWith(draft);
  expect(screen.queryByText("Bozza in corso")).not.toBeInTheDocument();
  expect(service.publishDraft).not.toHaveBeenCalled(); expect(service.saveDraft).not.toHaveBeenCalled();
});

test.each(["40001", "23514", "42501"])("publication error %s keeps draft and reports no live update", async (code) => {
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  const service = makeService(); const onPublished = jest.fn(); service.publishDraft.mockRejectedValue({ code });
  render(<Harness service={service} onPublished={onPublished} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Nuovo" } });
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Conferma pubblicazione" }));
  await within(dialog).findByRole("alert"); expect(onPublished).not.toHaveBeenCalled();
  expect(screen.getByText("Bozza in corso")).toBeInTheDocument(); logged.mockRestore();
});

test("adapter sends only allowed fields and type route_combination to existing archival RPC", async () => {
  const client = { rpc: jest.fn().mockResolvedValue({ data: [draft], error: null }) };
  const service = createRouteEditorService(client);
  await service.saveDraft(draft, { name: " Nuovo ", is_active: false, source_payload: {}, front_route_id: "forbidden" });
  expect(client.rpc).toHaveBeenCalledWith("admin_route_save_draft", { p_draft_id: draft.draft_id, p_snapshot: { name: "Nuovo", is_active: false }, p_expected_revision: 1 });
  client.rpc.mockResolvedValue({ data: { ...draft, workflow_status: "archived" }, error: null });
  await service.abandonDraft(draft);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_catalog_archive_draft", { p_draft_id: draft.draft_id, p_entity_type: "route_combination", p_expected_revision: 1 });
  client.rpc.mockResolvedValue({ data: null, error: null });
  await expect(service.getRoute(route.id)).rejects.toThrow("no context");
  await expect(service.publishDraft(draft)).rejects.toThrow("no live result");
});

test("publication keeps inactive combination reachable and updates only active counts", () => {
  const current = { ...club, routes: [{ name: "Percorso A" }], combinations: [route], allCombinations: [route] };
  const changed = applyRoutePublication(current, { id: route.id, name: "Nuovo", is_active: false });
  expect(changed.combinations).toEqual([]); expect(changed.courses).toBe("1 percorso · 1 route");
  expect(changed.allCombinations[0].name).toBe("Nuovo"); expect(changed.courseNames).toEqual(["Percorso A"]);
});

test("Route summary reads without creating drafts and has retry on unavailable data", async () => {
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  const service = makeService(); service.getRoute.mockRejectedValueOnce({ code: "42501" });
  render(<RouteDetail {...{ club, route, service }} onEdit={jest.fn()} onBackToCatalog={jest.fn()} onBackToClub={jest.fn()} />);
  await screen.findByText("Impossibile caricare il riepilogo Route.");
  expect(screen.queryByText("18 / 18")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
  await screen.findByText("18 / 18"); expect(service.openDraft).not.toHaveBeenCalled(); logged.mockRestore();
});
