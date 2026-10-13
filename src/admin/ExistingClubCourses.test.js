import { useCallback, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ExistingClubCourses from "./ExistingClubCourses";
import { createExistingClubCourseService } from "./existing-club-course-data";
const owner = "admin", club = { id: "club", name: "Club pubblicato" };
const fields = { name: "Nuovo nove", holes_count: 9, display_order: 2 };
const course = { draft_id: "new-course", entity_type: "route", parent_draft_id: "context", live_entity_id: null,
  created_by: owner, workflow_status: "draft", revision: 1, schema_version: 1, snapshot: fields };
const grid = { draft_id: "grid", revision: 1, snapshot: { holes_count: 9, holes: Array.from({ length: 9 }, (_, i) => ({ physical_hole_number: i + 1, par: 4, stroke_index: i + 1 })) } };
const tee = { draft_id: "tee", revision: 1, snapshot: { name: "Giallo", tee_color: "giallo", rating_category: "men", course_rating: 36, slope_rating: 113, display_order: 0, is_active: true } };
const plan = (ready = true) => ({ draft_id: course.draft_id, revision: course.revision, club: { id: club.id, name: club.name },
  course: { fields, grid_draft_id: grid.draft_id, grid_revision: 1, holes: grid.snapshot.holes, total_par: 36,
    tees: ready ? [{ draft_id: tee.draft_id, fields: tee.snapshot, par_total: 36, holes_count: 9 }] : [] },
  counts: { holes: 9, tees: ready ? 1 : 0 }, checklist: { unique_name: true, club_playable: true, holes: true, tees: ready },
  can_publish: ready, blockers: ready ? [] : ["Almeno un tee attivo con rating validi richiesto."], confirmation_hash: "a".repeat(64) });
const result = { draft_id: course.draft_id, publication_id: "receipt", version_id: "version", course: { id: "published-course", club_id: club.id, ...fields, total_par: 36, is_active: true, route_holes: grid.snapshot.holes, route_tees: [tee.snapshot] } };
function fixture(initial = [course], ready = true) {
  let rows = initial;
  const service = {
    listCourseDrafts: jest.fn().mockImplementation(async () => rows),
    saveCourseDraft: jest.fn().mockImplementation(async (_, old, next) => { const saved = { ...course, snapshot: { ...next, holes_count: Number(next.holes_count), display_order: Number(next.display_order) }, revision: (old?.revision || 0) + 1 };rows = [saved];return saved; }),
    abandonCourseDraft: jest.fn().mockImplementation(async () => { rows = [];return { ...course, workflow_status: "archived" }; }),
    openCourseHoleDraft: jest.fn().mockResolvedValue({ course, draft: grid }), saveCourseHoleDraft: jest.fn(), abandonCourseHoleDraft: jest.fn(),
    listCourseTeeDrafts: jest.fn().mockResolvedValue({ context: { course_name: fields.name, holes_count: 9, par_total: 36, configured: true }, tees: [tee] }),
    saveCourseTeeDraft: jest.fn(), abandonCourseTeeDraft: jest.fn(),
    previewCoursePublication: jest.fn().mockResolvedValue(plan(ready)), publishCourse: jest.fn().mockResolvedValue(result)
  };
  return { service, rows: () => rows };
}
function Harness({ service, onPublished = jest.fn(), onExit = jest.fn() }) {
  const guard = useRef(null), register = useCallback(value => { guard.current = value; }, []);
  const back = () => guard.current ? guard.current(onExit) : onExit();
  return <><button type="button" onClick={back}>Esci sezione</button><ExistingClubCourses club={club} ownerId={owner} service={service} registerExitGuard={register} onBack={back} onPublished={onPublished} /></>;
}
test("new course creation saves privately, resumes and guards exit; abandonment affects only selected draft", async () => {
  const f = fixture([]), onExit = jest.fn();let view = render(<Harness service={f.service} onExit={onExit} />);
  await screen.findByText("Nessun Percorso nella bozza.");expect(f.service.saveCourseDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Aggiungi percorso" }));
  fireEvent.change(screen.getByLabelText("Nome percorso"), { target: { value: fields.name } });
  fireEvent.change(screen.getByLabelText("Struttura percorso"), { target: { value: "9" } });
  fireEvent.click(screen.getByRole("button", { name: "Esci sezione" }));
  const guard = screen.getByRole("dialog", { name: "Modifiche percorso non salvate" });
  fireEvent.click(within(guard).getByRole("button", { name: "Resta" }));expect(onExit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza percorso" }));await screen.findByRole("button", { name: "Configura buche Nuovo nove" });
  expect(f.service.publishCourse).not.toHaveBeenCalled();view.unmount();view = render(<Harness service={f.service} />);
  fireEvent.click(await screen.findByRole("button", { name: "Abbandona percorso Nuovo nove" }));
  expect(f.service.abandonCourseDraft).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button", { name: "Conferma abbandono percorso" }));
  await screen.findByText("Nessun Percorso nella bozza.");expect(f.rows()).toHaveLength(0);view.unmount();
});
test("shared hole and tee editors use the specific private course and show correct existing Club scope", async () => {
  const f = fixture([{ ...course, hole_grid: { configured: true, grid_draft_id: "grid", total_par: 36 } }]);render(<Harness service={f.service} />);
  fireEvent.click(await screen.findByRole("button", { name: "Configura buche Nuovo nove" }));
  await screen.findByText(/il nuovo Percorso resta privato fino alla sua pubblicazione/);
  expect(f.service.openCourseHoleDraft).toHaveBeenCalledWith(expect.objectContaining({ draft_id: course.draft_id }), owner);
  fireEvent.click(screen.getByRole("button", { name: "Torna al Percorso" }));
  fireEvent.click(screen.getByRole("button", { name: "Gestisci tee Nuovo nove" }));
  await screen.findByText("Tee privati del nuovo Percorso. Buche e tee restano privati fino alla pubblicazione del Percorso.");
  expect(f.service.listCourseTeeDrafts).toHaveBeenCalledWith(expect.objectContaining({ draft_id: course.draft_id }), owner);
});
test("read-only complete preview requires note/final confirmation and exact target before publishing", async () => {
  const f = fixture(), onPublished = jest.fn();render(<Harness service={f.service} onPublished={onPublished} />);
  fireEvent.click(await screen.findByRole("button", { name: "Anteprima pubblicazione Nuovo nove" }));
  const preview = await screen.findByRole("dialog", { name: "Anteprima pubblicazione Percorso" });
  await within(preview).findByText(/Totale Par: 36/);expect(within(preview).getAllByRole("row")).toHaveLength(12);
  expect(f.service.publishCourse).not.toHaveBeenCalled();
  fireEvent.click(within(preview).getByRole("button", { name: "Pubblica Percorso" }));
  const confirm = screen.getByRole("dialog", { name: "Conferma pubblicazione Percorso" });
  expect(within(confirm).getByRole("button", { name: "Conferma pubblicazione Percorso" })).toBeDisabled();
  fireEvent.change(within(confirm).getByLabelText("Motivazione breve"), { target: { value: "Configurazione verificata" } });
  fireEvent.click(within(confirm).getByRole("button", { name: "Conferma pubblicazione Percorso" }));
  await waitFor(() => expect(onPublished).toHaveBeenCalledWith(result));
  expect(f.service.publishCourse).toHaveBeenCalledWith({ club_id: club.id }, course, plan(), "Configurazione verificata", owner);
});
test("incomplete preview blocks publication; conflict preserves draft and requires read-only refresh", async () => {
  const f = fixture([course], false), logged = jest.spyOn(console, "error").mockImplementation(() => {});render(<Harness service={f.service} />);
  fireEvent.click(await screen.findByRole("button", { name: "Anteprima pubblicazione Nuovo nove" }));
  await screen.findByText("Almeno un tee attivo con rating validi richiesto.");expect(screen.getByRole("button", { name: "Pubblica Percorso" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Chiudi anteprima" }));f.service.previewCoursePublication.mockResolvedValue(plan());
  fireEvent.click(screen.getByRole("button", { name: "Anteprima pubblicazione Nuovo nove" }));fireEvent.click(await screen.findByRole("button", { name: "Pubblica Percorso" }));
  fireEvent.change(screen.getByLabelText("Motivazione breve"), { target: { value: "Nota" } });f.service.publishCourse.mockRejectedValueOnce({ code: "40001" });
  fireEvent.click(screen.getByRole("button", { name: "Conferma pubblicazione Percorso" }));await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Conferma pubblicazione Percorso" })).toBeDisabled();expect(f.service.abandonCourseDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Aggiorna anteprima" }));await screen.findByRole("dialog", { name: "Anteprima pubblicazione Percorso" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Pubblica Percorso" })).toBeEnabled());logged.mockRestore();
});
test("adapter preserves course/grid revisions, validates ownership and sends only dedicated publish contract", async () => {
  const target = { club_id: club.id }, client = { rpc: jest.fn().mockResolvedValue({ data: { club_id: club.id, courses: [course], grid_summaries: [] }, error: null }) };
  const service = createExistingClubCourseService(client);expect(await service.listCourseDrafts(target, owner)).toEqual([course]);
  client.rpc.mockResolvedValue({ data: course, error: null });await service.saveCourseDraft(target, null, fields, owner);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_existing_club_course_save", { p_club_id: club.id, p_snapshot: fields, p_draft_id: null, p_expected_revision: null });
  await expect(service.previewCoursePublication(target, { ...course, created_by: "other" }, owner)).rejects.toThrow("Owned private");
  client.rpc.mockResolvedValue({ data: plan(), error: null });expect(await service.previewCoursePublication(target, course, owner)).toEqual(plan());
  await expect(service.publishCourse(target, course, plan(false), "Nota", owner)).rejects.toThrow("Complete preview");
  client.rpc.mockResolvedValue({ data: result, error: null });await service.publishCourse(target, course, plan(), " Nota ", owner);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_existing_club_course_publish", { p_draft_id: course.draft_id, p_expected_revision: 1, p_confirmation_hash: "a".repeat(64), p_note: "Nota" });
  client.rpc.mockResolvedValue({ data: { ...result, course: { ...result.course, club_id: "another-club" } }, error: null });
  await expect(service.publishCourse(target, course, plan(), "Nota", owner)).rejects.toThrow("Invalid new course publication receipt");
});
