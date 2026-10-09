import { fireEvent, render, screen, within } from "@testing-library/react";
import Multi9Review from "./Multi9Review";
import StructureReview, { StructureReviewDetail } from "./StructureReview";
import { createStructureReviewService } from "./structure-review-data";
import realCatalog from "../../scripts/tests/fixtures/parco-de-medici-multi9-preview.json";

const course = (id, name) => ({ id, name, source: { course: { source_system: "fig" }, holes: Array.from({ length: 9 }, (_, i) => ({ id: `${id}-hole-${i}`, physical_hole_number: i + 1, par: i === 0 ? 3 : 4, stroke_index: 2 * i + 1 })) }, reasons: [], total_par: 35 });
const bianco = course("nine-white", "Bianco"), blu = course("nine-blue", "Blu");
const combination = { id: "combo-fixture", name: "Championship Bianco/Blu", total_par: 70, reasons: [], sequence: Array.from({ length: 18 }, (_, i) => ({ legacy_combination_hole_id: `combo-hole-${i}`, position: i + 1, course_name: i < 9 ? "Bianco" : "Blu", physical_number: 1 + i % 9, occurrence: 1, effective_par: i % 9 === 0 ? 3 : 4, stroke_index: 18 - i })) };
const club = { structure_id: "structure-fixture", club_id: "club-fixture", club_name: "Parco fixture", structure_label: "Tre nove fixture", can_register: true, courses: [bianco, blu], combinations: [combination], excluded: [{ id: "repeat", name: "Nove ripetute", reason: "repeated_or_other_18_out_of_scope" }], reasons: [], physical_hole_count: 18, new_physical_hole_count: 18, configuration_count: 3, baseline: { structure: { revision: 2 }, physical_holes: [], configurations: [] }, events: [] };
const excluded = { ...club, club_id: "excluded-club", structure_id: "excluded-structure", club_name: "Club da revisionare", can_register: false, reasons: ["invalid_combination"], combinations: [{ ...combination, reasons: ["non_unique_exact_reference"] }] };
const serviceFixture = () => ({
  multi9BatchPreview: jest.fn().mockResolvedValue({ candidates: [club], excluded: [excluded] }),
  multi9Preview: jest.fn().mockResolvedValue(club),
  registerMulti9Batch: jest.fn().mockResolvedValue({ batch_id: "receipt-fixture", registered: [{ club_name: club.club_name, structure_id: club.structure_id, configurations: [{ label: "9 fixture" }, { label: "18 fixture" }] }], excluded: [] })
});
const prepare = async () => { fireEvent.click(screen.getByRole("button", { name: "Prepara batch multi-9" })); await screen.findByText("1 club selezionati · 3 configurazioni · 1 club esclusi"); };

test("batch preparation and detailed preview never register records", async () => {
  const service = serviceFixture(); render(<Multi9Review service={service} />);
  expect(service.multi9BatchPreview).not.toHaveBeenCalled(); await prepare();
  expect(service.multi9BatchPreview).toHaveBeenCalledTimes(1); expect(service.registerMulti9Batch).not.toHaveBeenCalled();
  expect(screen.getAllByText("Nove ripetute: Percorso 18 / nove ripetute: fuori perimetro, non verrà registrato.")).toHaveLength(2);
  expect(screen.getAllByText(/Il riferimento Percorso \+ numero locale/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Totale Par: 35/).length).toBeGreaterThan(0);
  const tables = screen.getAllByRole("table", { name: "Mappa Championship Bianco/Blu", hidden: true });
  const rows = within(tables[0]).getAllByRole("row", { hidden: true });
  expect(rows).toHaveLength(19);
  expect(within(rows[1]).getAllByRole("cell", { hidden: true }).map((c) => c.textContent)).toEqual(["1", "Bianco", "1", "1", "3", "18"]);
  expect(within(rows[10]).getAllByRole("cell", { hidden: true }).map((c) => c.textContent)).toEqual(["10", "Blu", "1", "1", "3", "9"]);
  expect(tables[0]).not.toHaveTextContent("combo-hole-");
});

test("selection, required note, cancel and a single explicit approval protect the batch", async () => {
  const service = serviceFixture(); render(<Multi9Review service={service} />); await prepare();
  expect(screen.getByRole("button", { name: "Approva batch nella fondazione" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Nota di approvazione batch"), { target: { value: " Confermo sorgenti e SI " } });
  fireEvent.click(screen.getByLabelText("Includi Parco fixture")); expect(screen.getByRole("button", { name: "Approva batch nella fondazione" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Seleziona tutti i club idonei"));
  fireEvent.click(screen.getByRole("button", { name: "Approva batch nella fondazione" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("1 club e 3 configurazioni");
  expect(screen.getByRole("dialog")).toHaveTextContent("Championship Bianco/Blu");
  expect(service.registerMulti9Batch).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
  expect(service.registerMulti9Batch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Approva batch nella fondazione" }));
  const button = screen.getByRole("button", { name: "Conferma batch nella fondazione" }); fireEvent.click(button); fireEvent.click(button);
  await screen.findByText(/Approvazione completata: 1 club registrati e verificati · 0 esclusi/);
  expect(service.registerMulti9Batch).toHaveBeenCalledTimes(1); expect(service.registerMulti9Batch).toHaveBeenCalledWith([club], "Confermo sorgenti e SI");
});

test("partial approval shows changed/busy exclusions without hiding successful clubs", async () => {
  const service = serviceFixture(); service.registerMulti9Batch.mockResolvedValue({ registered: [{ ...club, configurations: [combination] }], excluded: [{ club_name: "Club cambiato", reason: "source_or_revision_changed" }] });
  render(<Multi9Review service={service} />); await prepare();
  fireEvent.change(screen.getByLabelText("Nota di approvazione batch"), { target: { value: "Confermo" } });
  fireEvent.click(screen.getByRole("button", { name: "Approva batch nella fondazione" })); fireEvent.click(screen.getByRole("button", { name: "Conferma batch nella fondazione" }));
  await screen.findByText(/Approvazione completata: 1 club registrati e verificati · 1 esclusi/);
  expect(screen.getByText("Parco fixture: 1 configurazioni verificate.")).toBeInTheDocument();
  expect(screen.getByText(/Club cambiato: Sorgente o revisione cambiata/)).toBeInTheDocument();
});

test("empty batch and RPC failure never simulate successful registration", async () => {
  const service = serviceFixture(); service.multi9BatchPreview.mockResolvedValue({ candidates: [], excluded: [] });
  render(<Multi9Review service={service} />); fireEvent.click(screen.getByRole("button", { name: "Prepara batch multi-9" }));
  await screen.findByText(/Nessun club idoneo al batch/); expect(screen.queryByRole("button", { name: "Approva batch nella fondazione" })).not.toBeInTheDocument();
  service.multi9BatchPreview.mockRejectedValue({ code: "42501" }); const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: "Ricarica proposta multi-9" })); await screen.findByRole("alert");
  expect(screen.queryByText(/Approvazione completata/)).not.toBeInTheDocument(); expect(service.registerMulti9Batch).not.toHaveBeenCalled(); spy.mockRestore();
});

test("structure detail uses the dedicated single-club preview, not old single-origin contracts", async () => {
  const service = serviceFixture(); const structure = { id: club.structure_id, classification: "multi_9", review_status: "verified", source_system: "stablr", label: club.structure_label, source_reference: "fixture:manual", reason: "Classificazione manuale", revision: 2 };
  service.detail = jest.fn().mockResolvedValue({ club: { id: club.club_id, name: club.club_name }, structures: [structure], events: [], courses: [], combinations: [], configurations: [] });
  service.physicalPreview = jest.fn(); service.playablePreview = jest.fn();
  render(<StructureReviewDetail item={{ target_id: club.club_id, target_type: "structure", title: club.club_name }} service={service} onBack={jest.fn()} onRoot={jest.fn()} />);
  await screen.findByText("1 club selezionati · 3 configurazioni · 0 club esclusi");
  expect(service.multi9Preview).toHaveBeenCalledWith(club.structure_id); expect(service.multi9BatchPreview).not.toHaveBeenCalled();
  expect(service.physicalPreview).not.toHaveBeenCalled(); expect(service.playablePreview).not.toHaveBeenCalled();
});

test("root offers batch preparation without adding a sidebar route or querying until requested", async () => {
  const service = serviceFixture(); service.list = jest.fn().mockResolvedValue([]);
  render(<StructureReview service={service} onRoot={jest.fn()} />);
  await screen.findByText("Nessun elemento per questi filtri.");
  expect(screen.getByRole("button", { name: "Prepara batch multi-9" })).toBeInTheDocument(); expect(service.multi9BatchPreview).not.toHaveBeenCalled();
});

test("service sends only selected identities, exact server baseline, note and explicit confirmation", async () => {
  const client = { rpc: jest.fn().mockResolvedValue({ data: { preview_contract: 2, discovery_scope: "clubs_with_combinations", candidates: [], excluded: [] }, error: null }) };
  const service = createStructureReviewService(client);
  await service.multi9Preview(club.structure_id); expect(client.rpc).toHaveBeenLastCalledWith("admin_catalog_multi9_preview", { p_structure_id: club.structure_id });
  await service.multi9BatchPreview(); expect(client.rpc).toHaveBeenLastCalledWith("admin_catalog_multi9_proposal_preview", { p_structure_ids: null });
  await service.registerMulti9Batch([club], " Manuale ");
  expect(client.rpc).toHaveBeenLastCalledWith("admin_catalog_multi9_batch_register", { p_candidates: [{ club_id: club.club_id, structure_id: club.structure_id, club_name: club.club_name, baseline: club.baseline }], p_reason: "Manuale", p_confirm: true });
});

test("obsolete or missing proposal RPC is an error, never a successful zero/zero preview", async () => {
  const client = { rpc: jest.fn().mockResolvedValue({ data: { candidates: [], excluded: [] }, error: null }) };
  const service = createStructureReviewService(client);
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  render(<Multi9Review service={service} />);
  fireEvent.click(screen.getByRole("button", { name: "Prepara batch multi-9" }));
  await screen.findByRole("alert");
  expect(screen.queryByText(/0 club selezionati/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Nessun club idoneo/)).not.toBeInTheDocument();
  client.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Missing RPC" } });
  fireEvent.click(screen.getByRole("button", { name: "Prepara batch multi-9" }));
  await screen.findByRole("alert");
  expect(client.rpc.mock.calls.every(([name]) => name === "admin_catalog_multi9_proposal_preview")).toBe(true);
  spy.mockRestore();
});

test("real Parco catalog-shaped proposal shows 3 nines, 27 holes, 4 official combinations and concrete exclusions", async () => {
  // Fixture captured by GET from the catalog; response projection is test-only.
  const origins = new Set(realCatalog.combinations.flatMap((c) => [c.front_route_id, c.back_route_id]));
  const courses = realCatalog.routes.filter((r) => origins.has(r.id)).map((r) => ({ ...r,
    source: { course: r, holes: realCatalog.holes.filter((h) => h.route_id === r.id) }, reasons: [] }));
  const combinations = realCatalog.combinations.map((c) => ({ ...c, reasons: [],
    sequence: realCatalog.slots.filter((h) => h.route_combination_id === c.id).sort((a, b) => a.round_hole_number - b.round_hole_number).map((h) => ({
      legacy_combination_hole_id: h.id, position: h.round_hole_number, physical_number: h.physical_hole_number,
      course_name: courses.find((r) => r.id === h.route_id).name, occurrence: 1, effective_par: h.par, stroke_index: h.stroke_index
    })) }));
  const candidate = { ...club, club_id: realCatalog.club.id, club_name: realCatalog.club.name, structure_id: null,
    structure_label: "Struttura multi-9", classification_proposal: "multi_9", structure_proposal: { action: "create" },
    courses, combinations, physical_hole_count: 27, new_physical_hole_count: 27, configuration_count: 7, excluded: [] };
  const service = serviceFixture();
  service.multi9BatchPreview.mockResolvedValue({ candidates: [candidate], excluded: [excluded] });
  render(<Multi9Review service={service} />);
  fireEvent.click(screen.getByRole("button", { name: "Prepara batch multi-9" }));
  await screen.findByText("1 club selezionati · 7 configurazioni · 1 club esclusi");
  expect(screen.getByLabelText("Includi Parco De' Medici")).toBeInTheDocument();
  expect(screen.getByText(/Evidenza: 3 Percorsi 9 completi e 4 combinazioni ufficiali 18 complete/)).toBeInTheDocument();
  expect(screen.getByText("27")).toBeInTheDocument();
  expect(screen.getAllByText(/Il riferimento Percorso \+ numero locale/).length).toBeGreaterThan(0);
  const pilot = screen.getByLabelText("Includi Parco De' Medici").closest("article");
  for (const c of realCatalog.combinations) expect(within(pilot).getByRole("table", { name: `Mappa ${c.name}`, hidden: true })).toBeInTheDocument();
  expect(service.registerMulti9Batch).not.toHaveBeenCalled();
});

test("clubs without structures have independent selection and one confirmation including the proposed classification", async () => {
  const fresh = { ...club, structure_id: null, classification_proposal: "multi_9", structure_label: "Struttura multi-9", structure_proposal: { classification: "multi_9", action: "create" }, baseline: { contract: 2, structures: [], proposal: { classification: "multi_9", action: "create" } } };
  const another = { ...fresh, club_id: "another-club", club_name: "Altro club idoneo" };
  const service = serviceFixture(); service.multi9BatchPreview.mockResolvedValue({ candidates: [fresh, another], excluded: [] });
  render(<Multi9Review service={service} />);
  fireEvent.click(screen.getByRole("button", { name: "Prepara batch multi-9" }));
  await screen.findByText("2 club selezionati · 6 configurazioni · 0 club esclusi");
  expect(screen.getAllByText("Classificazione proposta")).toHaveLength(2);
  expect(screen.getAllByText(/Creazione struttura e classificazione verificata, solo alla conferma/)).toHaveLength(2);
  expect(service.registerMulti9Batch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Includi Altro club idoneo"));
  expect(screen.getByText("1 club selezionati · 3 configurazioni · 0 club esclusi")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Nota di approvazione batch"), { target: { value: "Confermo anche la classificazione multi_9" } });
  fireEvent.click(screen.getByRole("button", { name: "Approva batch nella fondazione" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Creazione struttura e classificazione verificata, solo alla conferma · multi_9");
  expect(service.registerMulti9Batch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferma batch nella fondazione" }));
  await screen.findByText(/Approvazione completata/);
  expect(service.registerMulti9Batch).toHaveBeenCalledTimes(1);
  expect(service.registerMulti9Batch).toHaveBeenCalledWith([fresh], "Confermo anche la classificazione multi_9");
});

test("existing manual classification is visibly reused, not proposed as a new structure", async () => {
  const service = serviceFixture(); service.multi9BatchPreview.mockResolvedValue({ candidates: [{ ...club, classification_proposal: "multi_9", structure_proposal: { action: "reuse" } }], excluded: [] });
  render(<Multi9Review service={service} />); fireEvent.click(screen.getByRole("button", { name: "Prepara batch multi-9" }));
  await screen.findByText(/Riutilizzo della struttura già classificata e verificata/);
  expect(screen.queryByText(/Classificare manualmente una struttura/)).not.toBeInTheDocument();
  expect(service.registerMulti9Batch).not.toHaveBeenCalled();
});

test("new club proposals carry club identity even when structure identity is null", async () => {
  const client = { rpc: jest.fn().mockResolvedValue({ data: {}, error: null }) };
  await createStructureReviewService(client).registerMulti9Batch([{ ...club, structure_id: null, baseline: { contract: 2 } }], " Confermo ");
  expect(client.rpc).toHaveBeenCalledWith("admin_catalog_multi9_batch_register", { p_candidates: [{ club_id: club.club_id, structure_id: null, club_name: club.club_name, baseline: { contract: 2 } }], p_reason: "Confermo", p_confirm: true });
});

test("preview keeps all candidates visible but a confirmation cannot select more than fifty clubs", async () => {
  const clubs = Array.from({ length: 51 }, (_, i) => ({ ...club, club_id: `club-${i}`, club_name: `Club candidato ${i}`, structure_id: null, courses: [], combinations: [] }));
  const service = serviceFixture(); service.multi9BatchPreview.mockResolvedValue({ candidates: clubs, excluded: [] });
  render(<Multi9Review service={service} />); fireEvent.click(screen.getByRole("button", { name: "Prepara batch multi-9" }));
  await screen.findByText("50 club selezionati · 150 configurazioni · 0 club esclusi");
  const last = screen.getByLabelText("Includi Club candidato 50");
  expect(last).not.toBeChecked(); fireEvent.click(last); expect(last).not.toBeChecked();
  fireEvent.click(screen.getByLabelText("Includi Club candidato 0")); fireEvent.click(last);
  expect(last).toBeChecked(); expect(screen.getByLabelText("Seleziona i primi 50 club idonei")).not.toBeChecked();
  fireEvent.click(screen.getByLabelText("Seleziona i primi 50 club idonei"));
  expect(last).not.toBeChecked(); expect(screen.getByLabelText("Includi Club candidato 0")).toBeChecked();
  expect(service.registerMulti9Batch).not.toHaveBeenCalled();
});
