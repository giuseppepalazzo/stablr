import { fireEvent, render, screen, within } from "@testing-library/react";
import PlayableConfigurations from "./PlayableConfigurations";
import { StructureReviewDetail } from "./StructureReview";
import { createStructureReviewService } from "./structure-review-data";
import PhysicalCourseHoles from "./PhysicalCourseHoles";

const structure = { id: "structure-fixture-18", club_id: "club-fixture", label: "Fisico 18 fixture", classification: "fisico_18", review_status: "verified", revision: 2, source_system: "fig", source_reference: "fixture:manual", reason: "Classificazione manuale fixture" };
const link = { id: "link-fixture-18", name: "18 Buche", holes_count: 18 };
const courses = [{ id: "course-18", name: "18 Buche", holes_count: 18 }, { id: "course-front", name: "Prime Nove", holes_count: 9 }, { id: "course-back", name: "Seconde Nove", holes_count: 9 }];
const pars = [5,4,3,4,3,4,4,5,3,5,3,4,3,4,5,3,4,4];
const indexes = [9,17,15,3,13,1,5,11,7,12,2,18,4,8,6,16,14,10];
const empty = { structure, source_link_id: null, kind: null, source_course_id: null, par_selection: null, source_links: [link], courses, sequence: [], saved_holes: [], configurations: [], reasons: [], events: [], can_register: false, can_verify: false };
const context = (kind = "autonomous_18", course = courses[0], parSelection = "inherited") => {
  const start = kind === "back_9" ? 10 : 1;
  const n = kind === "autonomous_18" ? 18 : 9;
  return { ...empty, source_link_id: link.id, kind, source_course_id: course.id, par_selection: parSelection,
    label: `${course.name} · configurazione fixture`, source_name: course.name, parent_label: n === 9 ? "18 autonoma fixture" : null,
    baseline: { structure, kind, interval_start: start, interval_end: start + n - 1, par_selection: parSelection, source: { course, holes: Array.from({ length: n }, (_, i) => ({ physical_hole_number: i + 1, par: pars[start + i - 1], stroke_index: indexes[start + i - 1] })) } },
    sequence: Array.from({ length: n }, (_, i) => ({ position: i + 1, source_number: i + 1, physical_number: start + i, physical_label: `Buca ${start + i}`, physical_hole_id: `physical-${start + i}`, legacy_route_hole_id: `source-${course.id}-${i + 1}`, occurrence: 1, effective_par: pars[start + i - 1], par_mode: parSelection === "source" ? "override" : "inherited", stroke_index: indexes[start + i - 1] })), can_register: true };
};
const registered = (c, status = "needs_review") => {
  const cfg = { id: `configuration-${c.kind}`, label: c.label, physical_source_link_id: link.id, registration_kind: c.kind, legacy_course_route_id: c.source_course_id, registration_snapshot: c.baseline, holes_count: c.sequence.length, review_status: status, revision: status === "verified" ? 2 : 1, reason: "Nota manuale fixture" };
  return { ...c, configuration: cfg, configurations: [cfg], saved_holes: c.sequence.map((h) => ({ ...h, id: `slot-${h.position}` })), events: [{ id: `event-${status}`, entity_table: "admin_catalog_playable_configurations", entity_id: cfg.id, revision: cfg.revision, operation: status === "verified" ? "UPDATE" : "INSERT", actor_id: "admin-fixture", occurred_at: "2026-10-08T12:00:00Z", after_snapshot: cfg }], can_register: false, can_verify: status !== "verified" };
};
const serviceFixture = () => ({
  physical18Preview: jest.fn().mockImplementation(async (sid, lid, kind, cid, mode) => !lid || !kind || !cid || !mode ? { ...empty, source_link_id: lid, kind, source_course_id: cid, par_selection: mode } : context(kind, courses.find((c) => c.id === cid), mode)),
  registerPhysical18: jest.fn().mockImplementation(async (c) => registered(c)),
  verifyPhysical18: jest.fn().mockImplementation(async (c) => registered(c, "verified"))
});
const mount = (service = serviceFixture(), extra = {}) => {
  const props = { structure, service, physical18: true, onEvents: jest.fn(), onBusy: jest.fn(), ...extra };
  return { ...render(<PlayableConfigurations {...props} />), service, props };
};
const choose = async (kind = "autonomous_18", courseId = "course-18", mode = "inherited") => {
  fireEvent.change(await screen.findByLabelText("Origine fisica verificata"), { target: { value: link.id } });
  fireEvent.change(await screen.findByLabelText("Tipo di configurazione e intervallo fisico"), { target: { value: kind } });
  fireEvent.change(await screen.findByLabelText("Percorso sorgente della configurazione"), { target: { value: courseId } });
  fireEvent.change(await screen.findByLabelText("Provenienza del Par"), { target: { value: mode } });
  await screen.findByRole("table", { name: "Anteprima configurazione giocabile" });
};

test("physical18 starts empty: no implicit source, interval, Par inheritance or writes", async () => {
  const { service } = mount();
  expect(await screen.findByText("Nessuna configurazione giocabile registrata.")).toBeInTheDocument();
  for (const label of ["Origine fisica verificata", "Tipo di configurazione e intervallo fisico", "Percorso sorgente della configurazione", "Provenienza del Par"]) expect(screen.getByLabelText(label)).toHaveValue("");
  expect(service.physical18Preview).toHaveBeenCalledWith(structure.id, null, null, null, null);
  expect(service.registerPhysical18).not.toHaveBeenCalled(); expect(service.verifyPhysical18).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Registra configurazione" })).not.toBeInTheDocument();
});

test.each([["autonomous_18", "course-18", 18, 1, 70], ["front_9", "course-front", 9, 1, 35], ["back_9", "course-back", 9, 10, 35]])("%s shows exact source mapping, Par and own SI without +9 or normalization", async (kind, cid, n, start, total) => {
  mount(); await choose(kind, cid);
  const table = screen.getByRole("table", { name: "Anteprima configurazione giocabile" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(n);
  rows.forEach((row, i) => expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([String(i + 1), `Buca ${i + 1}`, `Buca ${start + i}`, "1", `${pars[start + i - 1]} · ereditato`, String(indexes[start + i - 1])]));
  expect(screen.getByText(new RegExp(`Totale Par ${total}`))).toBeInTheDocument();
  expect(screen.getByText(/SI copiati dal Percorso sorgente, senza calcoli/)).toBeInTheDocument();
  expect(screen.getByText("Anteprima · configurazione non registrata")).toBeInTheDocument();
  expect(table).not.toHaveTextContent("physical-"); expect(table).not.toHaveTextContent("course-");
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
});

test("source Par is an explicit visible override; note, cancel, register and verify require separate confirmation", async () => {
  const { service, props } = mount(); await choose("back_9", "course-back", "source");
  expect(screen.getByText(/Par conservato dalla sorgente · override esplicito/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Registra configurazione" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Nota configurazione"), { target: { value: "Confermo Seconde Nove 10–18" } });
  fireEvent.click(screen.getByRole("button", { name: "Registra configurazione" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("10–18"); expect(service.registerPhysical18).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Annulla" })); expect(service.registerPhysical18).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Registra configurazione" }));
  const button = screen.getByRole("button", { name: "Conferma registrazione configurazione" }); fireEvent.click(button); fireEvent.click(button);
  await screen.findByText("Configurazione registrata nella fondazione: Da revisionare.");
  expect(service.registerPhysical18).toHaveBeenCalledTimes(1); expect(service.registerPhysical18).toHaveBeenCalledWith(context("back_9", courses[2], "source"), "Confermo Seconde Nove 10–18");
  expect(screen.getByText("Nota registrata: Nota manuale fixture")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Verifica configurazione" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Nota configurazione"), { target: { value: "Verifica manuale" } });
  fireEvent.click(screen.getByRole("button", { name: "Verifica configurazione" })); expect(service.verifyPhysical18).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferma verifica configurazione" })); await screen.findByText("Configurazione verificata nella fondazione.");
  expect(service.verifyPhysical18).toHaveBeenCalledTimes(1); expect(props.onEvents).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ operation: "UPDATE" })]));
});

test("resuming a stored nine restores exact source, physical interval and declared Par mode", async () => {
  const c = registered(context("back_9", courses[2], "source")); const service = serviceFixture();
  service.physical18Preview.mockImplementation(async (sid, lid, kind, cid, mode) => lid && kind && cid && mode ? c : { ...empty, configurations: c.configurations });
  mount(service); fireEvent.click(await screen.findByRole("button", { name: /Seconde Nove · configurazione fixture/ }));
  await screen.findByRole("table");
  expect(screen.getByLabelText("Tipo di configurazione e intervallo fisico")).toHaveValue("back_9");
  expect(screen.getByLabelText("Percorso sorgente della configurazione")).toHaveValue("course-back");
  expect(screen.getByLabelText("Provenienza del Par")).toHaveValue("source");
  expect(service.registerPhysical18).not.toHaveBeenCalled();
});

test.each(["verified_parent_required", "par_mismatch", "invalid_source_grid", "configuration_collision", "physical_source_changed", "registration_base_changed"])("incompatibility %s is visible and blocks actions", async (reason) => {
  const service = serviceFixture(); const original = service.physical18Preview.getMockImplementation();
  service.physical18Preview.mockImplementation(async (...args) => ({ ...await original(...args), reasons: [reason], can_register: false, can_verify: false }));
  mount(service); await choose(); expect(screen.getByRole("alert")).toBeInTheDocument();
  if (reason === "verified_parent_required") expect(screen.getByRole("alert")).toHaveTextContent("configurazione 18 autonoma");
  expect(screen.queryByRole("button", { name: "Registra configurazione" })).not.toBeInTheDocument();
  expect(service.registerPhysical18).not.toHaveBeenCalled();
});

test("stale base and NOWAIT conflict never simulate successful registration", async () => {
  const service = serviceFixture(); service.registerPhysical18.mockRejectedValue({ code: "40001" });
  jest.spyOn(console, "error").mockImplementation(() => {});
  mount(service); await choose(); fireEvent.change(screen.getByLabelText("Nota configurazione"), { target: { value: "Manuale" } });
  fireEvent.click(screen.getByRole("button", { name: "Registra configurazione" })); fireEvent.click(screen.getByRole("button", { name: "Conferma registrazione configurazione" }));
  await screen.findByText("La base o la revisione è cambiata. Annulla e ricarica l’anteprima.");
  expect(screen.queryByText("Configurazione registrata nella fondazione: Da revisionare.")).not.toBeInTheDocument();
  service.registerPhysical18.mockRejectedValue({ code: "55P03" }); fireEvent.click(screen.getByRole("button", { name: "Conferma registrazione configurazione" }));
  await screen.findByText("La sorgente è temporaneamente occupata. Annulla e ricarica l’anteprima."); console.error.mockRestore();
});

test("structure detail uses physical18 RPC and shares physical-source refresh and audit, never Phase3b", async () => {
  const service = serviceFixture(); service.detail = jest.fn().mockResolvedValue({ club: { id: structure.club_id, name: "Fiuggi fixture" }, structures: [structure], courses: [], combinations: [], configurations: [], events: [] });
  service.physicalPreview = jest.fn().mockResolvedValue({ structure, physical_holes: [], mapping: [], courses: [], events: [], reasons: [] });
  service.playablePreview = jest.fn();
  render(<StructureReviewDetail item={{ target_type: "structure", target_id: structure.club_id }} service={service} onBack={jest.fn()} />);
  await screen.findByLabelText("Tipo di configurazione e intervallo fisico"); expect(service.physical18Preview).toHaveBeenCalledWith(structure.id, null, null, null, null);
  expect(service.playablePreview).not.toHaveBeenCalled(); expect(screen.getByRole("heading", { name: "Buche fisiche" })).toBeInTheDocument();
});

test("service sends explicit source, Par provenance, exact baseline, revision and slots only to dedicated RPCs", async () => {
  const c = registered(context("front_9", courses[1], "source")); const client = { rpc: jest.fn().mockResolvedValue({ data: c, error: null }) }; const service = createStructureReviewService(client);
  await service.physical18Preview(structure.id, link.id, c.kind, c.source_course_id, c.par_selection);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_catalog_physical18_preview", { p_structure_id: structure.id, p_source_link_id: link.id, p_kind: c.kind, p_course_id: "course-front", p_par_selection: "source" });
  await service.registerPhysical18(c, " Nota ");
  expect(client.rpc).toHaveBeenLastCalledWith("admin_catalog_physical18_register", { p_structure_id: structure.id, p_source_link_id: link.id, p_kind: c.kind, p_course_id: "course-front", p_par_selection: "source", p_expected_baseline: c.baseline, p_reason: "Nota", p_confirm: true });
  await service.verifyPhysical18(c, " Verifica ");
  expect(client.rpc).toHaveBeenLastCalledWith("admin_catalog_physical18_verify", { p_configuration_id: c.configuration.id, p_expected_revision: 1, p_expected_baseline: c.baseline, p_expected_holes: c.saved_holes, p_reason: "Verifica", p_confirm: true });
});

test("physical18 source registration and 1:1 verification reuse the physical contract with readable hole labels", async () => {
  const source = { course: { ...courses[0], club_id: structure.club_id, source_system: "gesgolf" }, holes: pars.map((par, i) => ({ id: `uuid-source-${i}`, physical_hole_number: i + 1, par, stroke_index: indexes[i] })) };
  const initial = { structure, courses: [source.course], physical_holes: [], mapping: [], reasons: [], events: [], can_register: false, can_verify: false };
  const p = { ...initial, source, can_register: true };
  const mapped = { ...p, can_register: false, can_verify: true, link: { id: link.id, structure_id: structure.id, revision: 1, review_status: "needs_review", source_snapshot: source },
    physical_holes: source.holes.map((h, i) => ({ id: `uuid-physical-${i}`, physical_number: i + 1, source_position: i + 1, base_par: h.par, source_reference: `route_holes:${h.id}`, revision: 1 })),
    mapping: source.holes.map((h, i) => ({ position: i + 1, physical_number: i + 1, physical_hole_id: `uuid-physical-${i}`, source_hole_id: h.id, base_par: h.par, revision: 1 })) };
  const service = { physicalPreview: jest.fn().mockImplementation(async (sid, cid) => cid ? p : initial), registerPhysicalHoles: jest.fn().mockResolvedValue(mapped), verifyPhysicalCourse: jest.fn().mockResolvedValue({ ...mapped, can_verify: false, link: { ...mapped.link, review_status: "verified", revision: 2 } }) };
  render(<PhysicalCourseHoles structure={structure} service={service} onEvents={jest.fn()} onBusy={jest.fn()} />);
  fireEvent.change(await screen.findByLabelText("Percorso pubblicato sorgente"), { target: { value: "course-18" } });
  const table = await screen.findByRole("table", { name: "Anteprima buche sorgente" }); expect(within(table).getAllByRole("row")).toHaveLength(19);
  expect(within(table).getByText("Buca 18")).toBeInTheDocument();
  expect(screen.getByText(/18 buche · Totale Par: 70/)).toBeInTheDocument();
  expect(within(table).getAllByText("Riferimenti")).toHaveLength(18); // IDs are disclosed only inside closed details.
  fireEvent.change(screen.getByLabelText("Nota di registrazione"), { target: { value: "Confermo sorgente 18" } });
  fireEvent.click(screen.getByRole("button", { name: "Registra buche fisiche" })); expect(screen.getByRole("dialog")).toHaveTextContent("Verranno create 18 identità fisiche");
  expect(service.registerPhysicalHoles).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Conferma registrazione" }));
  await screen.findByText("Buche registrate nella fondazione. Il collegamento al Percorso è Da revisionare.");
  expect(screen.getByText(/18 identità fisiche registrate nella struttura · Totale Par: 70/)).toBeInTheDocument();
  expect(screen.getByText("Da revisionare").closest("p")).toHaveTextContent("18 buche · Totale Par: 70");
  expect(within(screen.getByRole("table", { name: "Collegamento fisico uno a uno" })).getAllByRole("row")).toHaveLength(19);
  fireEvent.change(screen.getByLabelText("Nota di verifica 1:1"), { target: { value: "Confermo 18 corrispondenze" } });
  fireEvent.click(screen.getByRole("button", { name: "Verifica collegamento 1:1" })); fireEvent.click(screen.getByRole("button", { name: "Conferma collegamento" }));
  await screen.findByText("Collegamento fisico 1:1 verificato nella fondazione.");
  expect(service.verifyPhysicalCourse).toHaveBeenCalledWith(mapped, "Confermo 18 corrispondenze");
});
