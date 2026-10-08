import { fireEvent, render, screen, within } from "@testing-library/react";
import PhysicalCourseHoles, { physicalSourceProblems } from "./PhysicalCourseHoles";
import { StructureReviewDetail } from "./StructureReview";
import { createStructureReviewService } from "./structure-review-data";

const structure = { id: "structure-fixture", club_id: "club-fixture", label: "Struttura fixture", classification: "fisico_9", review_status: "verified", revision: 2, source_system: "fig", source_reference: "Fixture evidence", reason: "Manual review" };
const holes = Array.from({ length: 9 }, (_, index) => ({ id: `source-hole-${index + 1}`, route_id: "course-fixture", physical_hole_number: index + 1, par: index === 2 ? 3 : 4, stroke_index: null, display_label: `Buca ${index + 1}` }));
const source = { course: { id: "course-fixture", club_id: "club-fixture", name: "Nove fixture", holes_count: 9, is_active: true, source_system: "gesgolf", source_payload: { source_key: "fixture-course" } }, holes };
const empty = { structure, source: null, physical_holes: [], link: null, links: [], mapping: [], reasons: [], can_register: false, can_verify: false, events: [], courses: [source.course] };
const preview = { ...empty, source, can_register: true };
const physical = holes.map((hole, index) => ({ id: `physical-hole-${index + 1}`, structure_id: structure.id, club_id: structure.club_id, physical_number: hole.physical_hole_number, base_par: hole.par, revision: 1, review_status: "verified", source_route_hole_id: hole.id, source_position: index + 1, source_reference: `course_routes:${source.course.id};route_holes:${hole.id}` }));
const mapping = physical.map((hole) => ({ position: hole.source_position, physical_number: hole.physical_number, base_par: hole.base_par, physical_hole_id: hole.id, source_hole_id: hole.source_route_hole_id, revision: hole.revision }));
const registered = { ...preview, can_register: false, can_verify: true, physical_holes: physical, mapping,
  link: { id: "link-fixture", structure_id: structure.id, review_status: "needs_review", revision: 1, source_snapshot: source },
  events: [{ id: "event-fixture", entity_table: "admin_catalog_physical_course_links", operation: "INSERT", revision: 1, actor_id: "admin-fixture", occurred_at: "2026-10-08T10:00:00Z", after_snapshot: { review_status: "needs_review" } }] };
const verified = { ...registered, can_verify: false, link: { ...registered.link, review_status: "verified", revision: 2 } };
const makeService = () => ({ physicalPreview: jest.fn().mockImplementation(async (structureId, courseId) => courseId ? preview : empty), registerPhysicalHoles: jest.fn().mockResolvedValue(registered), verifyPhysicalCourse: jest.fn().mockResolvedValue(verified) });
const mount = (service = makeService()) => {
  const onEvents = jest.fn(), onBusy = jest.fn();
  return { ...render(<PhysicalCourseHoles structure={structure} service={service} onEvents={onEvents} onBusy={onBusy} />), service, onEvents, onBusy };
};
const chooseSource = async () => {
  const select = await screen.findByLabelText("Percorso pubblicato sorgente");
  fireEvent.change(select, { target: { value: source.course.id } });
  await screen.findByRole("table", { name: "Anteprima buche sorgente" });
};

test("opens empty, never chooses a course automatically, and previews real source numbers/Par without writes", async () => {
  const { service } = mount();
  expect(await screen.findByText("Nessuna buca fisica registrata.")).toBeInTheDocument();
  expect(screen.getByLabelText("Percorso pubblicato sorgente")).toHaveValue("");
  expect(service.physicalPreview).toHaveBeenCalledWith(structure.id, null);
  expect(service.registerPhysicalHoles).not.toHaveBeenCalled(); expect(service.verifyPhysicalCourse).not.toHaveBeenCalled();
  await chooseSource();
  const table = screen.getByRole("table", { name: "Anteprima buche sorgente" });
  expect(within(table).getAllByRole("row")).toHaveLength(10);
  expect(table).toHaveTextContent("source-hole-3"); expect(table).toHaveTextContent("3");
  expect(screen.getByText(/Fonte registrata: gesgolf/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Registra buche fisiche" })).toBeDisabled();
  expect(service.registerPhysicalHoles).not.toHaveBeenCalled();
});

test("registration and 1:1 verification require separate notes and confirmations, preserve mapping and audit", async () => {
  const { service, onEvents } = mount(); await chooseSource();
  fireEvent.change(screen.getByLabelText("Nota di registrazione"), { target: { value: "Verifica sorgente manuale" } });
  fireEvent.click(screen.getByRole("button", { name: "Registra buche fisiche" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Verranno create 9 identità fisiche");
  expect(service.registerPhysicalHoles).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Annulla" })); expect(service.registerPhysicalHoles).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Registra buche fisiche" }));
  const confirm = screen.getByRole("button", { name: "Conferma registrazione" }); fireEvent.click(confirm); fireEvent.click(confirm);
  await screen.findByText("Buche registrate nella fondazione. Il collegamento al Percorso è Da revisionare.");
  expect(service.registerPhysicalHoles).toHaveBeenCalledTimes(1);
  expect(service.registerPhysicalHoles).toHaveBeenCalledWith(preview, "Verifica sorgente manuale");
  expect(service.verifyPhysicalCourse).not.toHaveBeenCalled();
  expect(screen.getByRole("table", { name: "Collegamento fisico uno a uno" })).toHaveTextContent("physical-hole-1");
  expect(screen.getByRole("table", { name: "Collegamento fisico uno a uno" })).toHaveTextContent("source-hole-1");
  expect(screen.getByRole("button", { name: "Verifica collegamento 1:1" })).toBeDisabled();
  expect(onEvents).toHaveBeenLastCalledWith(registered.events);
  fireEvent.change(screen.getByLabelText("Nota di verifica 1:1"), { target: { value: "Corrispondenza 1:1 controllata" } });
  fireEvent.click(screen.getByRole("button", { name: "Verifica collegamento 1:1" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Revisione attesa: 1");
  expect(service.verifyPhysicalCourse).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferma collegamento" }));
  await screen.findByText("Collegamento fisico 1:1 verificato nella fondazione.");
  expect(service.verifyPhysicalCourse).toHaveBeenCalledWith(registered, "Corrispondenza 1:1 controllata");
  expect(screen.getByText("Verificato")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Registra buche fisiche" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Verifica collegamento 1:1" })).not.toBeInTheDocument();
});

test.each(Object.keys(physicalSourceProblems))("explains incompatibility %s and offers no mutation", async (reason) => {
  const service = makeService(); service.physicalPreview.mockImplementation(async (sid, cid) => cid ? { ...preview, reasons: [reason], can_register: false } : empty);
  mount(service); await chooseSource();
  expect(screen.getByRole("alert")).toHaveTextContent(physicalSourceProblems[reason]);
  expect(screen.queryByRole("button", { name: "Registra buche fisiche" })).not.toBeInTheDocument();
  expect(service.registerPhysicalHoles).not.toHaveBeenCalled(); expect(service.verifyPhysicalCourse).not.toHaveBeenCalled();
});

test("refresh resumes pending association without registering again; verified association remains read-only", async () => {
  const service = makeService(); service.physicalPreview.mockImplementation(async (sid, cid) => cid ? registered : { ...empty, physical_holes: physical, links: [registered.link] });
  const view = mount(service); await chooseSource();
  expect(await screen.findByText("Da revisionare")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Verifica collegamento 1:1" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Registra buche fisiche" })).not.toBeInTheDocument();
  view.unmount();
  service.physicalPreview.mockImplementation(async (sid, cid) => cid ? verified : { ...empty, physical_holes: physical, links: [verified.link] });
  mount(service); await chooseSource();
  expect(screen.getByText("Verificato")).toBeInTheDocument();
  expect(service.registerPhysicalHoles).not.toHaveBeenCalled(); expect(service.verifyPhysicalCourse).not.toHaveBeenCalled();
});

test("stale source is not retried as a write and reload shows updated source checks", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const service = makeService(); service.registerPhysicalHoles.mockRejectedValue({ code: "40001" });
  mount(service); await chooseSource();
  fireEvent.change(screen.getByLabelText("Nota di registrazione"), { target: { value: "Fixture note" } });
  fireEvent.click(screen.getByRole("button", { name: "Registra buche fisiche" })); fireEvent.click(screen.getByRole("button", { name: "Conferma registrazione" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("La sorgente o la revisione è cambiata");
  service.physicalPreview.mockResolvedValue({ ...preview, can_register: false, reasons: ["duplicate_numbers"] });
  fireEvent.click(screen.getByRole("button", { name: "Annulla" })); fireEvent.click(screen.getByRole("button", { name: "Ricarica anteprima" }));
  await screen.findByText(physicalSourceProblems.duplicate_numbers);
  expect(service.registerPhysicalHoles).toHaveBeenCalledTimes(1); expect(service.verifyPhysicalCourse).not.toHaveBeenCalled(); log.mockRestore();
});

test("detail exposes physical holes only after explicit classification and includes link audit in foundation history", async () => {
  const item = { target_type: "structure", target_id: structure.club_id, title: "Club fixture", club_name: "Club fixture", status: "verified" };
  const detail = { club: { id: structure.club_id, name: "Club fixture" }, structures: [{ ...structure, classification: "non_classificato", review_status: "needs_review" }], configurations: [], courses: [], combinations: [], events: [], fig: null };
  const service = { ...makeService(), detail: jest.fn().mockResolvedValue(detail), playablePreview: jest.fn().mockResolvedValue({ structure, sequence: [], saved_holes: [], source_links: [], configurations: [], reasons: [], tee_overrides: [], events: [] }) };
  const view = render(<StructureReviewDetail item={item} service={service} onBack={jest.fn()} onRoot={jest.fn()} onChanged={jest.fn()} />);
  await screen.findByRole("heading", { name: "Classificazione della struttura" });
  expect(screen.queryByRole("heading", { name: "Buche fisiche" })).not.toBeInTheDocument(); expect(service.physicalPreview).not.toHaveBeenCalled();
  view.unmount(); service.detail.mockResolvedValue({ ...detail, structures: [structure] });
  service.physicalPreview.mockResolvedValue({ ...empty, physical_holes: physical, links: [registered.link], events: registered.events });
  render(<StructureReviewDetail item={item} service={service} onBack={jest.fn()} onRoot={jest.fn()} onChanged={jest.fn()} />);
  await screen.findByRole("heading", { name: "Buche fisiche" });
  expect(await screen.findByText("Collegamento Percorso fisico · Creazione")).toBeInTheDocument();
  expect(screen.getByText("admin-fixture")).toBeInTheDocument();
});

test("client uses dedicated preview/register/verify RPCs and passes exact baseline, mapping and revisions", async () => {
  const rpc = jest.fn().mockResolvedValue({ data: preview, error: null }); const service = createStructureReviewService({ rpc });
  await service.physicalPreview(structure.id, null);
  expect(rpc).toHaveBeenLastCalledWith("admin_catalog_physical_course_preview", { p_structure_id: structure.id, p_course_id: null });
  await service.registerPhysicalHoles(preview, " Registration note ");
  expect(rpc).toHaveBeenLastCalledWith("admin_catalog_physical_course_register", { p_structure_id: structure.id, p_course_id: source.course.id, p_expected_structure_revision: structure.revision, p_expected_source: source, p_reason: "Registration note", p_confirm: true });
  await service.verifyPhysicalCourse(registered, " Verified note ");
  expect(rpc).toHaveBeenLastCalledWith("admin_catalog_physical_course_verify", { p_link_id: registered.link.id, p_expected_revision: 1, p_expected_mapping: mapping, p_reason: "Verified note", p_confirm: true });
});
