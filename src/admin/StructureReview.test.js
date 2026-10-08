import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Advanced, AdminShell } from "./AdminApp";
import StructureReview from "./StructureReview";
import { createStructureReviewService, filterStructureReviews } from "./structure-review-data";

const club = { id: "club-1", name: "Club fixture", source_system: "gesgolf", data_status: "needs_review", fig_match_status: "unmatched", source_payload: { physical_hole_count: 9, import_batch: "batch-fixture" } };
const candidate = { target_type: "structure", target_id: club.id, club_id: club.id, club_name: club.name, title: club.name, status: "needs_review", classification: null, source_system: "gesgolf" };
const combination = { ...candidate, target_type: "hole_links", target_id: "combination-1", title: "Combinazione fixture", holes_count: 18, verified_hole_count: 0 };
const reviewed = { ...candidate, target_id: "club-2", title: "Club classificato", club_name: "Club classificato", status: "verified", classification: "fisico_18" };
const makeDetail = () => ({ club, target_type: "structure", target_id: club.id, structures: [], configurations: [], events: [], fig: null,
  courses: [{ id: "route-1", name: "Nove fixture", holes_count: 9, source_system: "gesgolf", holes: [{ id: "rh-1", physical_hole_number: 10, par: 4, stroke_index: 1 }] }],
  combinations: [{ id: "combination-1", name: "Combinazione fixture", holes_count: 18, holes: [{ round_hole_number: 10, physical_hole_number: 1, exact_legacy_reference_exists: false }] }] });
const createService = () => ({ list: jest.fn().mockResolvedValue([candidate, combination, reviewed]), detail: jest.fn().mockResolvedValue(makeDetail()), createStructure: jest.fn(), reviewStructure: jest.fn() });
const fillProvenance = () => {
  fireEvent.change(screen.getByLabelText("Fonte"), { target: { value: "fig" } });
  fireEvent.change(screen.getByLabelText("Riferimento alla fonte"), { target: { value: "Documento FIG fixture" } });
  fireEvent.change(screen.getByLabelText("Nota di revisione"), { target: { value: "Verifica manuale fixture" } });
};

test("queue defaults to pending, distinguishes issues and keeps classified records behind an explicit filter", async () => {
  const service = createService();
  render(<StructureReview service={service} onRoot={jest.fn()} />);
  expect(screen.getByText("Caricamento coda…")).toBeInTheDocument();
  expect(await screen.findByText("Club fixture", { selector: "strong" })).toBeInTheDocument();
  expect(screen.getByText("Combinazione fixture", { selector: "strong" })).toBeInTheDocument();
  expect(screen.queryByText("Club classificato")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Collegamento buche" }));
  expect(screen.queryByText("Club fixture", { selector: "strong" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tutti i tipi" }));
  fireEvent.click(screen.getByRole("button", { name: "Classificati / verificati" }));
  expect(screen.getByText("Club classificato")).toBeInTheDocument();
  expect(screen.queryByText("Combinazione fixture", { selector: "strong" })).not.toBeInTheDocument();
  expect(service.createStructure).not.toHaveBeenCalled(); expect(service.reviewStructure).not.toHaveBeenCalled();
  expect(filterStructureReviews([candidate, combination, reviewed], "Tutti", "Tutti i tipi", "combinazione")).toEqual([combination]);
});

test("creation and classification are explicit, confirmed writes to foundation only; classified club exits queue", async () => {
  const service = createService(); let detail = makeDetail(); let rows = [candidate, combination];
  service.detail.mockImplementation(async () => detail); service.list.mockImplementation(async () => rows);
  service.createStructure.mockImplementation(async (clubId, fields) => {
    const structure = { id: "structure-1", club_id: clubId, label: fields.label, classification: "non_classificato", review_status: "needs_review", revision: 1, source_system: fields.source, source_reference: fields.reference, reason: fields.note };
    detail = { ...detail, structures: [structure], events: [{ id: "event-1", entity_table: "admin_catalog_physical_structures", operation: "INSERT", revision: 1, occurred_at: "2026-10-08T12:00:00Z", actor_id: "admin-fixture", after_snapshot: structure }] };
    return structure;
  });
  service.reviewStructure.mockImplementation(async (structure, fields) => {
    const updated = { ...structure, classification: fields.classification, review_status: "verified", revision: 2 };
    detail = { ...detail, structures: [updated], events: [...detail.events, { id: "event-2", entity_table: "admin_catalog_physical_structures", operation: "UPDATE", revision: 2, actor_id: "admin-fixture", before_snapshot: structure, after_snapshot: updated }] };
    rows = [{ ...candidate, status: "verified", classification: fields.classification }, combination];
    return updated;
  });
  render(<StructureReview service={service} onRoot={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /Club \/ combinazione Club fixture/ }));
  expect(await screen.findByText("Nessuna revisione della fondazione disponibile.")).toBeInTheDocument();
  expect(screen.getByLabelText("Classificazione fisica")).toBeDisabled();
  expect(screen.getByLabelText("Classificazione fisica")).toHaveValue("non_classificato");
  expect(screen.getByLabelText("Fonte")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Crea struttura" })).toBeDisabled();
  expect(service.createStructure).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Nome struttura"), { target: { value: "Struttura fixture" } }); fillProvenance();
  fireEvent.click(screen.getByRole("button", { name: "Crea struttura" }));
  expect(service.createStructure).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toHaveTextContent("Verrà creata soltanto una struttura non classificata nella fondazione.");
  fireEvent.click(screen.getByRole("button", { name: "Annulla" })); expect(service.createStructure).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Crea struttura" })); fireEvent.click(screen.getByRole("button", { name: "Conferma nella fondazione" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Rivedi classificazione" })).toBeInTheDocument());
  expect(service.createStructure).toHaveBeenCalledTimes(1); expect(service.reviewStructure).not.toHaveBeenCalled();
  expect(screen.getByText("admin-fixture")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Classificazione fisica"), { target: { value: "fisico_9" } });
  fireEvent.click(screen.getByRole("button", { name: "Rivedi classificazione" }));
  expect(within(screen.getByRole("dialog")).getByRole("table")).toHaveTextContent("non_classificato");
  expect(screen.getByRole("dialog")).toHaveTextContent("fisico_9");
  expect(service.reviewStructure).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferma nella fondazione" }));
  await screen.findByText("Struttura già classificata e verificata, consultabile in sola lettura.");
  expect(service.reviewStructure).toHaveBeenCalledWith(expect.objectContaining({ id: "structure-1", revision: 1 }), expect.objectContaining({ classification: "fisico_9" }));
  fireEvent.click(screen.getByRole("button", { name: "Struttura e collegamenti" }));
  expect(screen.queryByText("Club fixture", { selector: "strong" })).not.toBeInTheDocument();
  expect(screen.getByText("Combinazione fixture", { selector: "strong" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Classificati / verificati" }));
  fireEvent.click(screen.getByRole("button", { name: /Club \/ combinazione Club fixture/ }));
  await screen.findByText("Struttura già classificata e verificata, consultabile in sola lettura.");
  expect(service.createStructure).toHaveBeenCalledTimes(1);
});

test("resumes a saved unclassified structure without creating it; non_classificato remains pending", async () => {
  const service = createService();
  const structure = { id: "s1", label: "Struttura fixture", classification: "non_classificato", review_status: "needs_review", revision: 3, source_system: "stablr", source_reference: "Riferimento fixture", reason: "Da classificare" };
  service.detail.mockResolvedValue({ ...makeDetail(), structures: [structure] }); service.reviewStructure.mockResolvedValue(structure);
  render(<StructureReview service={service} onRoot={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /Club \/ combinazione Club fixture/ }));
  await screen.findByRole("button", { name: "Rivedi classificazione" });
  expect(screen.getByLabelText("Classificazione fisica")).toHaveValue("non_classificato");
  fireEvent.click(screen.getByRole("button", { name: "Rivedi classificazione" })); fireEvent.click(screen.getByRole("button", { name: "Conferma nella fondazione" }));
  await waitFor(() => expect(service.reviewStructure).toHaveBeenCalledWith(structure, expect.objectContaining({ classification: "non_classificato" })));
  expect(service.createStructure).not.toHaveBeenCalled();
});

test("shows combination source evidence and foundation audit read-only, without inferring missing links", async () => {
  const service = createService(); const detail = makeDetail();
  detail.fig = { name: "FIG fixture", source_external_id: "fig-fixture", source_payload: { physical_holes_count: 9 }, import_batch: { imported_at: "2026-10-08T12:00:00Z" }, courses: [{ id: "fig-course", name: "FIG 18", holes_count: 18, course_type: "repeat_9", total_par: 72 }] };
  service.detail.mockResolvedValue(detail);
  render(<StructureReview service={service} onRoot={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /Club \/ combinazione Combinazione fixture/ }));
  expect(await screen.findByText("FIG fixture")).toBeInTheDocument();
  expect(screen.getByText(/Classificare il club non verifica i collegamenti/)).toBeInTheDocument();
  expect(screen.getByText("Nessuna configurazione registrata nella fondazione.")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Sequenza e riferimenti · Combinazione fixture"));
  expect(screen.getByText(/"exact_legacy_reference_exists": false/)).toBeInTheDocument();
  expect(service.detail).toHaveBeenCalledWith({ target_type: combination.target_type, target_id: combination.target_id });
  expect(service.createStructure).not.toHaveBeenCalled(); expect(service.reviewStructure).not.toHaveBeenCalled();
});

test("reports queue/detail errors and permits retry without simulating empty results", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const service = createService(); service.list.mockRejectedValueOnce({ code: "42501" });
  render(<StructureReview service={service} onRoot={jest.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Impossibile caricare la coda");
  expect(screen.queryByText("Nessun elemento per questi filtri.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
  service.detail.mockRejectedValueOnce(new Error("fixture"));
  fireEvent.click(await screen.findByRole("button", { name: /Club \/ combinazione Club fixture/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Impossibile caricare il dettaglio");
  fireEvent.click(screen.getByRole("button", { name: "Ricarica dettaglio" }));
  await screen.findByRole("button", { name: "Crea struttura" }); log.mockRestore();
});

test("stale revisions cannot be confirmed silently and repeated clicks send a single decision", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const service = createService();
  const structure = { id: "s1", club_id: club.id, label: "Struttura fixture", classification: "non_classificato", review_status: "needs_review", revision: 3, source_system: "fig", source_reference: "Fonte fixture", reason: "Revisione manuale" };
  service.detail.mockResolvedValue({ ...makeDetail(), structures: [structure] });
  let rejectDecision; service.reviewStructure.mockImplementation(() => new Promise((resolve, reject) => { rejectDecision = reject; }));
  render(<StructureReview service={service} onRoot={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /Club \/ combinazione Club fixture/ }));
  await screen.findByRole("button", { name: "Rivedi classificazione" });
  fireEvent.change(screen.getByLabelText("Classificazione fisica"), { target: { value: "multi_9" } });
  fireEvent.click(screen.getByRole("button", { name: "Rivedi classificazione" }));
  const confirm = screen.getByRole("button", { name: "Conferma nella fondazione" });
  fireEvent.click(confirm); fireEvent.click(confirm);
  expect(service.reviewStructure).toHaveBeenCalledTimes(1);
  rejectDecision({ code: "40001" });
  expect(await screen.findByRole("alert")).toHaveTextContent("La struttura è cambiata");
  expect(service.createStructure).not.toHaveBeenCalled();
  expect(screen.queryByText("Fondazione aggiornata. Il catalogo pubblicato è invariato.")).not.toBeInTheDocument();
  log.mockRestore();
});

test("a successful decision stays reflected locally even if the evidence refresh fails", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const service = createService();
  const structure = { id: "s1", club_id: club.id, label: "Struttura fixture", classification: "non_classificato", review_status: "needs_review", revision: 3, source_system: "fig", source_reference: "Fonte fixture", reason: "Revisione manuale" };
  service.detail.mockResolvedValueOnce({ ...makeDetail(), structures: [structure] }).mockRejectedValue(new Error("Refresh fixture"));
  service.reviewStructure.mockResolvedValue({ ...structure, classification: "fisico_18", review_status: "verified", revision: 4 });
  service.list.mockResolvedValueOnce([candidate]).mockRejectedValue(new Error("Queue refresh fixture"));
  render(<StructureReview service={service} onRoot={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /Club \/ combinazione Club fixture/ }));
  await screen.findByRole("button", { name: "Rivedi classificazione" });
  fireEvent.change(screen.getByLabelText("Classificazione fisica"), { target: { value: "fisico_18" } });
  fireEvent.click(screen.getByRole("button", { name: "Rivedi classificazione" })); fireEvent.click(screen.getByRole("button", { name: "Conferma nella fondazione" }));
  await screen.findByText("Struttura già classificata e verificata, consultabile in sola lettura.");
  expect(screen.getByRole("alert")).toHaveTextContent("Impossibile caricare il dettaglio");
  expect(service.reviewStructure).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Struttura e collegamenti" }));
  expect(screen.queryByText("Club fixture", { selector: "strong" })).not.toBeInTheDocument();
  log.mockRestore();
});

test("Avanzata opens the queue and breadcrumb returns to its root; no main sidebar entry", async () => {
  const service = createService(); const root = render(<Advanced clubs={[]} loading={false} reviewService={service} />);
  fireEvent.click(screen.getByRole("button", { name: /Struttura e collegamenti/ }));
  await screen.findByText("Combinazione fixture", { selector: "strong" });
  fireEvent.click(screen.getByRole("button", { name: "Avanzata" }));
  expect(screen.getByRole("button", { name: /Verifica FIG/ })).toBeInTheDocument(); root.unmount();
  render(<AdminShell onSignOut={jest.fn()} />);
  expect(within(screen.getByRole("navigation", { name: "Navigazione amministrazione" })).queryByRole("button", { name: /Struttura e collegamenti/ })).not.toBeInTheDocument();
});

test("service uses only two foundation mutations, preserves CAS and requires explicit classification", async () => {
  const rpc = jest.fn().mockResolvedValue({ data: [{ id: "s1" }], error: null }); const service = createStructureReviewService({ rpc });
  const fields = { label: " Structure ", classification: "non_classificato", source: "fig", reference: " Evidence ", note: " Note " };
  await service.createStructure("c1", fields);
  expect(rpc).toHaveBeenLastCalledWith("admin_catalog_foundation_create_structure", { p_club_id: "c1", p_label: "Structure", p_source_system: "fig", p_source_reference: "Evidence", p_reason: "Note" });
  for (const classification of ["non_classificato", "fisico_9", "fisico_18", "multi_9"]) {
    await service.reviewStructure({ id: "s1", revision: 7 }, { ...fields, classification });
    expect(rpc).toHaveBeenLastCalledWith("admin_catalog_foundation_review_structure", expect.objectContaining({ p_structure_id: "s1", p_expected_revision: 7, p_classification: classification, p_confirm_verified: classification !== "non_classificato" }));
  }
  rpc.mockResolvedValueOnce({ data: null, error: { code: "40001" } });
  await expect(service.reviewStructure({ id: "s1", revision: 7 }, fields)).rejects.toEqual({ code: "40001" });
  rpc.mockResolvedValueOnce({ data: null, error: null }); await expect(service.list()).rejects.toThrow();
});
