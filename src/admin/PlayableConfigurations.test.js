import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PlayableConfigurations, { configurationProblems } from "./PlayableConfigurations";
import { StructureReviewDetail } from "./StructureReview";
import { createStructureReviewService } from "./structure-review-data";

const structure = { id: "structure-fixture", club_id: "club-fixture", label: "Struttura fixture", classification: "fisico_9", review_status: "verified", revision: 2, source_system: "stablr", source_reference: "fixture:manual", reason: "Manual fixture classification" };
const link = { id: "link-fixture", name: "Percorso fixture", holes_count: 9, review_status: "verified" };
const nineSequence = Array.from({ length: 9 }, (_, i) => ({ position: i + 1, occurrence: 1, physical_hole_id: `physical-hole-${i + 1}`, physical_label: `Buca ${i + 1}`, physical_number: i + 1, legacy_route_hole_id: `source-hole-${i + 1}`, base_par: 4, effective_par: 4, par_mode: "inherited", par_override: null, source_stroke_index: i * 2 + 1, stroke_index: i * 2 + 1 }));
const eighteenSequence = [...nineSequence, ...nineSequence.map((h) => ({ ...h, position: h.position + 9, occurrence: 2, stroke_index: h.stroke_index + 1 }))];
const empty = { structure, source_link_id: null, kind: null, label: null, sequence: [], saved_holes: [], baseline: null, configuration: null, tee_matrix: null, tee_overrides: [], reasons: [], source_links: [link], configurations: [], events: [], can_register: false, can_verify: false };
const preview = { ...empty, source_link_id: link.id, kind: "autonomous_9", label: "Percorso fixture · 9 autonoma", source_name: link.name, sequence: nineSequence, baseline: { structure, physical_link: link, source: { course: { name: link.name, holes_count: 9 } }, route_tees: [] }, can_register: true };
const event = { id: "event-fixture", entity_table: "admin_catalog_playable_configurations", entity_id: "configuration-fixture", operation: "INSERT", revision: 1, actor_id: "admin-fixture", occurred_at: "2026-10-08T12:00:00Z", after_snapshot: { review_status: "needs_review" } };
const registered = { ...preview, can_register: false, can_verify: true, configuration: { id: "configuration-fixture", structure_id: structure.id, label: preview.label, physical_source_link_id: link.id, registration_kind: preview.kind, holes_count: 9, review_status: "needs_review", revision: 1 }, saved_holes: nineSequence.map((h) => ({ ...h, id: `slot-${h.position}`, revision: 1 })), events: [event] };
registered.configurations = [registered.configuration];
const verified = { ...registered, can_verify: false, configuration: { ...registered.configuration, review_status: "verified", revision: 2 } };
verified.configurations = [verified.configuration];
const eighteen = { ...preview, kind: "repeated_18", label: "Percorso fixture · 18 derivata (9 × 2)", parent_label: preview.label, sequence: eighteenSequence, baseline: { ...preview.baseline, parent: verified.configuration } };
const makeService = () => ({ playablePreview: jest.fn().mockImplementation(async (sid, lid, kind) => !lid || !kind ? empty : kind === "repeated_18" ? eighteen : preview), registerPlayable: jest.fn().mockResolvedValue(registered), verifyPlayable: jest.fn().mockResolvedValue(verified) });
const mount = (service = makeService(), extra = {}) => {
  const props = { structure, service, onEvents: jest.fn(), onBusy: jest.fn(), ...extra };
  return { ...render(<PlayableConfigurations {...props} />), props, service };
};
const choose = async (kind = "autonomous_9") => {
  fireEvent.change(await screen.findByLabelText("Origine fisica verificata"), { target: { value: link.id } });
  fireEvent.change(await screen.findByLabelText("Tipo di configurazione"), { target: { value: kind } });
  await screen.findByRole("table", { name: "Anteprima configurazione giocabile" });
};

test("starts with explicit choices, empty state and read-only preview; never creates records on load", async () => {
  const { service } = mount();
  expect(await screen.findByText("Nessuna configurazione giocabile registrata.")).toBeInTheDocument();
  expect(screen.getByLabelText("Origine fisica verificata")).toHaveValue(""); expect(screen.getByLabelText("Tipo di configurazione")).toHaveValue("");
  expect(service.playablePreview).toHaveBeenCalledWith(structure.id, null, null);
  await choose();
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(7);
  fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Mostra tutto · Sequenza configurazione" }));
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(10);
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument(); expect(screen.queryByRole("textbox")).toHaveAccessibleName("Nota configurazione");
  expect(screen.getByText(/SI della configurazione conservati esattamente/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Registra configurazione" })).toBeDisabled();
  expect(service.registerPlayable).not.toHaveBeenCalled(); expect(service.verifyPlayable).not.toHaveBeenCalled();
  expect(screen.getByRole("table")).not.toHaveTextContent("physical-hole-");
});

test("register and verify require separate notes and confirmations; cancel and double-click are safe", async () => {
  const { service, props } = mount(); await choose();
  fireEvent.change(screen.getByLabelText("Nota configurazione"), { target: { value: "Registrazione manuale" } });
  fireEvent.click(screen.getByRole("button", { name: "Registra configurazione" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Da revisionare"); expect(service.registerPlayable).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Annulla" })); expect(service.registerPlayable).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Registra configurazione" }));
  const confirm = screen.getByRole("button", { name: "Conferma registrazione configurazione" }); fireEvent.click(confirm); fireEvent.click(confirm);
  await screen.findByText("Configurazione registrata nella fondazione: Da revisionare.");
  expect(service.registerPlayable).toHaveBeenCalledTimes(1); expect(service.registerPlayable).toHaveBeenCalledWith(preview, "Registrazione manuale");
  expect(service.verifyPlayable).not.toHaveBeenCalled(); expect(props.onEvents).toHaveBeenCalledWith([event]);
  expect(screen.getByRole("button", { name: "Verifica configurazione" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Nota configurazione"), { target: { value: "Verifica manuale" } });
  fireEvent.click(screen.getByRole("button", { name: "Verifica configurazione" })); expect(service.verifyPlayable).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferma verifica configurazione" }));
  await screen.findByText("Configurazione verificata nella fondazione.");
  expect(service.verifyPlayable).toHaveBeenCalledWith(registered, "Verifica manuale");
  expect(screen.queryByRole("button", { name: "Verifica configurazione" })).not.toBeInTheDocument();
});

test("18 preview repeats physical nine twice and shows SI rule/parent without flattening tee overrides", async () => {
  const matrix = { physical_hole_count: 9, source: "Official fixture", tees: { giallo: { holes: [{ physical_hole_number: 1, par: 5, stroke_indexes: [11, 12] }] } } };
  const service = makeService(); service.playablePreview.mockImplementation(async (sid, lid, kind) => !lid || !kind ? empty : { ...eighteen, tee_matrix: matrix, tee_overrides: [{ par_override: 6, stroke_index_override: 17 }] });
  mount(service); await choose("repeated_18");
  const table = screen.getByRole("table", { name: "Anteprima configurazione giocabile" });
  fireEvent.click(within(table).getByRole("button", { name: "Mostra tutto · Sequenza configurazione" }));
  const rows = within(table).getAllByRole("row"); expect(rows).toHaveLength(19);
  expect(within(rows[1]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["1", "Buca 1", "1", "4 · ereditato", "1"]);
  expect(within(rows[10]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["10", "Buca 1", "2", "4 · ereditato", "2"]);
  expect(screen.getByText(/seconda tornata = min\(18, SI base \+ 1\)/)).toBeInTheDocument();
  expect(screen.getByText(`Configurazione padre: ${preview.label}`)).toBeInTheDocument();
  const tee = screen.getByRole("table", { name: "Evidenze tee giallo" }); expect(tee).toHaveTextContent("5"); expect(tee).toHaveTextContent("11 / 12");
  expect(screen.getByText(/1 override già registrati/)).toBeInTheDocument();
  expect(service.registerPlayable).not.toHaveBeenCalled(); expect(service.verifyPlayable).not.toHaveBeenCalled();
});

test.each(Object.keys(configurationProblems))("server incompatibility %s blocks both actions and explains the reason", async (reason) => {
  const service = makeService(); service.playablePreview.mockImplementation(async (sid, lid, kind) => !lid || !kind ? empty : { ...preview, reasons: [reason], can_register: false });
  mount(service); await choose();
  expect(screen.getByRole("alert")).toHaveTextContent(configurationProblems[reason]);
  expect(screen.queryByRole("button", { name: "Registra configurazione" })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Verifica configurazione" })).not.toBeInTheDocument();
  expect(service.registerPlayable).not.toHaveBeenCalled();
});

test("saved configuration resumes after refresh without implicit writes and verified state is read-only", async () => {
  const service = makeService(); service.playablePreview.mockImplementation(async (sid, lid, kind) => !lid || !kind ? { ...empty, configurations: [registered.configuration] } : registered);
  const view = mount(service);
  fireEvent.click(await screen.findByRole("button", { name: /Percorso fixture · 9 autonoma 9 buche Da revisionare/ }));
  expect(await screen.findByRole("button", { name: "Verifica configurazione" })).toBeDisabled();
  expect(service.registerPlayable).not.toHaveBeenCalled(); expect(service.verifyPlayable).not.toHaveBeenCalled();
  view.unmount(); service.playablePreview.mockImplementation(async (sid, lid, kind) => !lid || !kind ? { ...empty, configurations: [verified.configuration] } : verified);
  mount(service); fireEvent.click(await screen.findByRole("button", { name: /Percorso fixture · 9 autonoma 9 buche Verificata/ }));
  await screen.findByRole("table"); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

test("a changed baseline shows an error, never retries a write automatically and reloads a blocked preview", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const service = makeService(); service.registerPlayable.mockRejectedValue({ code: "40001" }); mount(service); await choose();
  fireEvent.change(screen.getByLabelText("Nota configurazione"), { target: { value: "Manual fixture" } });
  fireEvent.click(screen.getByRole("button", { name: "Registra configurazione" })); fireEvent.click(screen.getByRole("button", { name: "Conferma registrazione configurazione" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("La base o la revisione è cambiata");
  fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
  service.playablePreview.mockResolvedValue({ ...preview, can_register: false, reasons: ["physical_source_changed"] });
  fireEvent.click(screen.getByRole("button", { name: "Ricarica configurazioni" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(configurationProblems.physical_source_changed);
  expect(service.registerPlayable).toHaveBeenCalledTimes(1); log.mockRestore();
});

test("physical verification refreshes configuration availability in the same detail and audit stays visible", async () => {
  let sourceVerified = false;
  const physicalContext = { structure, courses: [{ id: "course-fixture", name: link.name, holes_count: 9 }], source: null, physical_holes: [], links: [], link: null, reasons: [], mapping: [], events: [] };
  const source = { course: { id: "course-fixture", name: link.name, holes_count: 9 }, holes: [] };
  const service = { ...makeService(),
    detail: jest.fn().mockResolvedValue({ club: { id: structure.club_id, name: "Fixture club" }, structures: [structure], courses: [], combinations: [], configurations: [], events: [], fig: null }),
    physicalPreview: jest.fn().mockImplementation(async (sid, cid) => cid ? { ...physicalContext, source, link: { ...link, structure_id: structure.id, review_status: "needs_review", revision: 1 }, can_verify: true } : physicalContext),
    verifyPhysicalCourse: jest.fn().mockImplementation(async () => { sourceVerified = true; return { ...physicalContext, source, link: { ...link, structure_id: structure.id, review_status: "verified", revision: 2 } }; }) };
  service.playablePreview.mockImplementation(async () => ({ ...empty, source_links: sourceVerified ? [link] : [], events: [event] }));
  const item = { target_type: "structure", target_id: structure.club_id, title: "Fixture club", club_name: "Fixture club", status: "verified" };
  render(<StructureReviewDetail item={item} service={service} onBack={jest.fn()} onRoot={jest.fn()} onChanged={jest.fn()} />);
  await screen.findByRole("heading", { name: "Configurazioni giocabili" });
  expect(await screen.findByText("Configurazione · Creazione")).toBeInTheDocument();
  expect(screen.getByText(/Registra e verifica prima le buche fisiche/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Percorso pubblicato sorgente"), { target: { value: "course-fixture" } });
  fireEvent.change(await screen.findByLabelText("Nota di verifica 1:1"), { target: { value: "Manual verify" } });
  fireEvent.click(screen.getByRole("button", { name: "Verifica collegamento 1:1" })); fireEvent.click(screen.getByRole("button", { name: "Conferma collegamento" }));
  await waitFor(() => expect(within(screen.getByLabelText("Origine fisica verificata")).getByRole("option", { name: "Percorso fixture · 9 buche" })).toBeInTheDocument());
  expect(screen.getByLabelText("Origine fisica verificata")).toHaveValue(""); expect(service.registerPlayable).not.toHaveBeenCalled();
  const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(headings.indexOf("Configurazioni giocabili")).toBe(headings.indexOf("Buche fisiche") + 1);
});

test("load failure is explicit and retry only calls read preview", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const service = makeService(); service.playablePreview.mockRejectedValueOnce({ code: "42501" }); mount(service);
  expect(await screen.findByRole("alert")).toHaveTextContent("Impossibile caricare le configurazioni giocabili");
  fireEvent.click(screen.getByRole("button", { name: "Ricarica configurazioni" })); await screen.findByLabelText("Origine fisica verificata");
  expect(service.registerPlayable).not.toHaveBeenCalled(); expect(service.verifyPlayable).not.toHaveBeenCalled(); log.mockRestore();
});

test("dedicated RPC client passes exact server baseline, configuration revision and stored holes", async () => {
  const rpc = jest.fn().mockResolvedValue({ data: empty, error: null }); const service = createStructureReviewService({ rpc });
  await service.playablePreview(structure.id); expect(rpc).toHaveBeenLastCalledWith("admin_catalog_playable_preview", { p_structure_id: structure.id, p_source_link_id: null, p_kind: null });
  await service.registerPlayable(preview, " note "); expect(rpc).toHaveBeenLastCalledWith("admin_catalog_playable_register", { p_structure_id: structure.id, p_source_link_id: link.id, p_kind: preview.kind, p_expected_baseline: preview.baseline, p_reason: "note", p_confirm: true });
  await service.verifyPlayable(registered, " verify "); expect(rpc).toHaveBeenLastCalledWith("admin_catalog_playable_verify", { p_configuration_id: registered.configuration.id, p_expected_revision: 1, p_expected_baseline: registered.baseline, p_expected_holes: registered.saved_holes, p_reason: "verify", p_confirm: true });
});
