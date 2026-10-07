import { useCallback, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CourseEditor from "./CourseEditor";
import { applyCoursePublication, createCourseEditorService, formatCourseValue, getCourseDiff, normalizeCourseFields } from "./course-editor-data";

const club = { id: "club-1", name: "Club esistente", dataStatus: "needs_review", figMatchStatus: "unmatched" };
const course = { id: "course-1", name: "Percorso esistente", holesCount: 9, isActive: true, displayOrder: 0 };
const snapshot = { name: course.name, holes_count: 9, display_order: 0, is_active: true };
const draft = { draft_id: "draft-1", revision: 1, snapshot, base_snapshot: { ...snapshot, _context: { club_id: club.id } } };
const context = { can_edit_structure: true, original_name: "Originale FIG", gesgolf_name: "Originale GesGolf", source_system: "fig" };
const makeService = () => ({
  openDraft: jest.fn().mockResolvedValue({ draft, context }),
  saveDraft: jest.fn().mockImplementation((current, fields) => Promise.resolve({ ...current, revision: current.revision + 1, snapshot: normalizeCourseFields(fields) })),
  publishDraft: jest.fn().mockResolvedValue({ course: { id: course.id, club_id: club.id, name: "Nome nuovo", holes_count: 18, display_order: null, is_active: false }, version_id: "version-1" }),
  abandonDraft: jest.fn().mockResolvedValue({ ...draft, workflow_status: "archived", revision: 2 })
});

function Harness({ service, onExit = jest.fn(), onPublished = jest.fn() }) {
  const guard = useRef(null);
  const registerExitGuard = useCallback((current) => { guard.current = current; }, []);
  const exit = () => guard.current ? guard.current(onExit) : onExit();
  return <><button onClick={exit}>Vai al catalogo</button><CourseEditor club={club} course={course} onBack={exit} onBackToClub={exit} onBackToCatalog={exit} onPublished={onPublished} registerExitGuard={registerExitGuard} service={service} /></>;
}

test("diff is limited to four live fields, with explicit false/null/zero values", () => {
  expect(getCourseDiff(snapshot, { ...snapshot, name: ` ${course.name} ` })).toEqual([]);
  expect(getCourseDiff(snapshot, { name: "Nuovo", holes_count: 18, display_order: null, is_active: false, source_payload: {} })).toEqual([
    { key: "name", label: "Nome visualizzato", before: course.name, after: "Nuovo" },
    { key: "holes_count", label: "Struttura", before: 9, after: 18 },
    { key: "display_order", label: "Ordine", before: 0, after: null },
    { key: "is_active", label: "Stato operativo", before: true, after: false }
  ]);
  expect(formatCourseValue("display_order", 0)).toBe("0");
  expect(formatCourseValue("is_active", false)).toBe("Disattivato");
  expect(formatCourseValue("display_order", null)).toBe("—");
});

test("identical route draft does not show a misleading badge", async () => {
  render(<Harness service={makeService()} />);
  await screen.findByLabelText("Nome visualizzato");
  expect(screen.queryByText("Bozza in corso")).not.toBeInTheDocument();
});

test("resumes changed draft, shows its badge, source names and no editable aliases, notes or technical IDs", async () => {
  const service = makeService();
  service.openDraft.mockResolvedValue({ draft: { ...draft, snapshot: { ...snapshot, name: "Bozza salvata" } }, context });
  render(<Harness service={service} />);
  await waitFor(() => expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("Bozza salvata"));
  expect(screen.getByText("Bozza in corso")).toBeInTheDocument();
  expect(screen.getByText("Originale FIG")).toBeInTheDocument();
  expect(screen.getByText("Originale GesGolf")).toBeInTheDocument();
  expect(screen.getByText("Da collegare")).toBeInTheDocument();
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(screen.getByLabelText("Ordine")).toHaveValue(0);
  expect(service.openDraft).toHaveBeenCalledWith(course.id);
});

test("structure cannot be edited when server reports existing configuration", async () => {
  const service = makeService();
  service.openDraft.mockResolvedValue({ draft, context: { ...context, can_edit_structure: false } });
  render(<Harness service={service} />);
  await screen.findByLabelText("Nome visualizzato");
  expect(screen.getByLabelText("Struttura")).toBeDisabled();
  expect(screen.getByLabelText("Stato operativo")).toBeEnabled();
  expect(screen.getByText(/Struttura in sola lettura/)).toBeInTheDocument();
});

test("physical holes and tee management use equivalent compact child cards after the Course fields", async () => {
  const onEditHoles = jest.fn(), onManageTees = jest.fn();
  render(<CourseEditor club={club} course={{ ...course, hasPhysicalHoles: true }} service={makeService()}
    onBack={jest.fn()} onBackToClub={jest.fn()} onBackToCatalog={jest.fn()} onPublished={jest.fn()}
    onEditHoles={onEditHoles} onManageTees={onManageTees} registerExitGuard={jest.fn()} />);
  await screen.findByLabelText("Nome visualizzato");
  const holes = screen.getByRole("heading", { name: "Buche" }).closest("section");
  const tees = screen.getByRole("heading", { name: "Tee e rating" }).closest("section");
  expect(holes).toHaveClass("stablr-admin-course-child-entry");
  expect(tees).toHaveClass("stablr-admin-course-child-entry");
  expect(screen.getByRole("button", { name: "Modifica buche" })).toHaveClass("stablr-admin-white-button");
  expect(screen.getByRole("button", { name: "Gestisci tee" })).toHaveClass("stablr-admin-white-button");
  fireEvent.click(screen.getByRole("button", { name: "Modifica buche" }));
  fireEvent.click(screen.getByRole("button", { name: "Gestisci tee" }));
  expect(onEditHoles).toHaveBeenCalledTimes(1); expect(onManageTees).toHaveBeenCalledTimes(1);
});

test("save leaves live unchanged and publish requires exact before/after confirmation", async () => {
  const service = makeService();
  const onPublished = jest.fn();
  render(<Harness service={service} onPublished={onPublished} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Nome nuovo" } });
  fireEvent.change(screen.getByLabelText("Struttura"), { target: { value: "18" } });
  fireEvent.change(screen.getByLabelText("Ordine"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Stato operativo"), { target: { value: "false" } });
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza", exact: true }));
  await screen.findByText("Bozza salvata. Il catalogo pubblicato resta invariato.");
  expect(onPublished).not.toHaveBeenCalled();
  expect(course.name).toBe("Percorso esistente");
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true }));
  const dialog = await screen.findByRole("dialog", { name: "Conferma pubblicazione" });
  const diff = within(dialog).getByRole("table", { name: "Differenze percorso" });
  for (const value of [course.name, "Nome nuovo", "9 buche", "18 buche", "0", "—", "Attivo", "Disattivato"]) expect(within(diff).getByText(value)).toBeInTheDocument();
  expect(service.publishDraft).not.toHaveBeenCalled();
  expect(service.saveDraft).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Conferma pubblicazione" }));
  await waitFor(() => expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({ name: "Nome nuovo", is_active: false })));
  expect(service.publishDraft).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
});

test("publish auto-saves dirty draft, cancelling confirmation never publishes", async () => {
  const service = makeService();
  render(<Harness service={service} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Nome nuovo" } });
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true }));
  const dialog = await screen.findByRole("dialog");
  expect(service.saveDraft).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Annulla" }));
  expect(service.publishDraft).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("unsaved exit offers stay or save before navigating, plus browser unload warning", async () => {
  const service = makeService();
  const onExit = jest.fn();
  render(<Harness service={service} onExit={onExit} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Non salvato" } });
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Vai al catalogo" }));
  let dialog = await screen.findByRole("dialog", { name: "Modifiche non salvate" });
  expect(onExit).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Resta" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Club esistente" }));
  dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Salva bozza" }));
  await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  expect(service.saveDraft).toHaveBeenCalledWith(draft, expect.objectContaining({ name: "Non salvato" }));
});

test("discard affects transient fields only, no draft delete RPC", async () => {
  const service = makeService();
  const onExit = jest.fn();
  render(<Harness service={service} onExit={onExit} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Non salvato" } });
  fireEvent.click(screen.getByRole("button", { name: "Vai al catalogo" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Scarta" }));
  expect(onExit).toHaveBeenCalledTimes(1);
  expect(service.saveDraft).not.toHaveBeenCalled();
});

test("abandons an existing saved Percorso draft after the explicit confirmation", async () => {
  const service = makeService();
  const onExit = jest.fn();
  render(<Harness onExit={onExit} service={service} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza" }));
  const dialog = await screen.findByRole("dialog", { name: "Abbandona bozza" });
  expect(within(dialog).getByText("Abbandonare la bozza? Le modifiche non pubblicate non saranno più riprese. Il catalogo pubblicato non cambia.")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Conferma abbandono" }));
  await waitFor(() => expect(service.abandonDraft).toHaveBeenCalledWith(draft));
  expect(onExit).toHaveBeenCalledTimes(1);
  expect(service.publishDraft).not.toHaveBeenCalled();
});

test.each(["40001", "23514", "42501"])("failed publication %s remains in confirmation, no fake live update", async (code) => {
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  const service = makeService();
  const onPublished = jest.fn();
  service.publishDraft.mockRejectedValue({ code });
  render(<Harness service={service} onPublished={onPublished} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Nuovo" } });
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Conferma pubblicazione" }));
  await within(dialog).findByRole("alert");
  expect(onPublished).not.toHaveBeenCalled();
  expect(screen.getByText("Bozza in corso")).toBeInTheDocument();
  logged.mockRestore();
});

test("empty name cannot save or publish and unchanged drafts cannot publish", async () => {
  render(<Harness service={makeService()} />);
  await screen.findByLabelText("Nome visualizzato");
  expect(screen.getByRole("button", { name: "Pubblica", exact: true })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: " " } });
  expect(screen.getByRole("button", { name: "Salva bozza", exact: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Pubblica", exact: true })).toBeDisabled();
});

test("adapter allowlists fields, preserves nullable order and requires live publication result", async () => {
  const client = { rpc: jest.fn().mockResolvedValue({ data: [draft], error: null }) };
  const service = createCourseEditorService(client);
  await service.saveDraft(draft, { ...snapshot, name: " Nuovo ", display_order: "", fig_club_id: "forbidden" });
  expect(client.rpc).toHaveBeenCalledWith("admin_course_save_draft", { p_draft_id: draft.draft_id,
    p_snapshot: { name: "Nuovo", holes_count: 9, display_order: null, is_active: true }, p_expected_revision: 1 });
  client.rpc.mockResolvedValue({ data: null, error: null });
  expect(await service.getDraft(course.id)).toBeNull();
  await expect(service.openDraft(course.id)).rejects.toThrow("no single draft");
  await expect(service.publishDraft(draft)).rejects.toThrow("no live result");
  client.rpc.mockResolvedValue({ data: [draft], error: null });
  await service.abandonDraft(draft);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_catalog_archive_draft", { p_draft_id: draft.draft_id, p_entity_type: "route", p_expected_revision: 1 });
  client.rpc.mockResolvedValue({ data: [], error: { code: "42501" } });
  await expect(service.getDraft(course.id)).rejects.toEqual({ code: "42501" });
});

test("publication patches active catalog counts but keeps inactive course reachable", () => {
  const current = { ...club, routes: [course], allCourses: [course], combinations: [] };
  const changed = applyCoursePublication(current, { id: course.id, name: "Inattivo", holes_count: 9, display_order: 0, is_active: false });
  expect(changed.routes).toEqual([]);
  expect(changed.courses).toBe("0 percorsi · 0 route");
  expect(changed.courseNames).toEqual([]);
  expect(changed.allCourses[0]).toMatchObject({ name: "Inattivo", status: "Disattivato" });
  expect(applyCoursePublication(changed, { id: course.id, name: "Riattivato", holes_count: 9, display_order: 0, is_active: true }).courses).toBe("1 percorso · 1 route");
});
