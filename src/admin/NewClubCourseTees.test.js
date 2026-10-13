import { useCallback, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import NewClubEditor from "./NewClubEditor";
import { normalizeNewTeeFields } from "./new-club-tees-data";
const owner = "admin", parent = { draft_id: "club", created_by: owner, revision: 1, snapshot: { name: "Club privato", city: null } };
function fixture(count = 9, configured = true) {
  let tees = [], par = count * 4;
  const course = { draft_id: "course", entity_type: "route", live_entity_id: null, created_by: owner, workflow_status: "draft", parent_draft_id: "club", revision: 1,
    snapshot: { name: "Percorso privato", holes_count: count, display_order: 0 }, ...(configured ? { hole_grid: { configured: true, grid_draft_id: "grid", total_par: par } } : {}) };
  const service = {
    openDraft: jest.fn().mockResolvedValue(parent), saveDraft: jest.fn(), abandonDraft: jest.fn(),
    listCourseDrafts: jest.fn().mockResolvedValue([course]),
    listCourseTeeDrafts: jest.fn().mockImplementation(async () => ({ context: { course_draft_id: "course", course_name: course.snapshot.name, course_revision: 1,
      holes_count: count, grid_draft_id: "grid", grid_revision: 1, configured, par_total: configured ? par : null }, tees })),
    saveCourseTeeDraft: jest.fn().mockImplementation(async (target, context, tee, fields) => {
      const saved = { draft_id: tee?.draft_id || `tee-${tees.length}`, revision: (tee?.revision || 0) + 1, snapshot: normalizeNewTeeFields(fields) };
      tees = [...tees.filter(row => row.draft_id !== saved.draft_id), saved];return saved;
    }),
    abandonCourseTeeDraft: jest.fn().mockImplementation(async (target, tee) => { tees = tees.filter(row => row.draft_id !== tee.draft_id);return { ...tee, workflow_status: "archived" }; })
  };
  return { service, course, tees: () => tees, changePar: value => { par = value; } };
}
function Harness({ service, onExit = jest.fn() }) {
  const guard = useRef(null), register = useCallback(fn => { guard.current = fn; }, []);
  const exit = () => guard.current ? guard.current(onExit) : onExit();
  return <><button type="button" onClick={exit}>Esci</button><NewClubEditor draftId="club" ownerId={owner} service={service} registerExitGuard={register} onBack={exit}/></>;
}
const open = async () => { fireEvent.click(await screen.findByRole("button", { name: "Gestisci tee Percorso privato" }));await screen.findByRole("button", { name: "Aggiungi tee" }); };
const add = () => fireEvent.click(screen.getByRole("button", { name: "Aggiungi tee" }));
const fill = (name = "Giallo", category = "men") => {
  for (const [label, value] of [["Nome tee", name], ["Colore tee", "giallo"], ["Categoria del rating", category], ["Course Rating", "70.2"], ["Slope Rating", "120"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
test.each([9, 18])("private %i tees create, resume, rename/order, calculated Par and confirmed abandonment", async count => {
  const f = fixture(count);let view = render(<Harness service={f.service}/>);await open();
  expect(screen.getByText(`Totale Par: ${count * 4}`)).toBeInTheDocument();add();
  expect(screen.getByLabelText("Nome tee")).toBeRequired();expect(screen.getByRole("button", { name: "Salva bozza tee" })).toBeDisabled();
  expect(screen.getByLabelText("Slope Rating")).toHaveAttribute("min", "55");expect(screen.getByLabelText("Slope Rating")).toHaveAttribute("max", "155");
  fill();fireEvent.click(screen.getByRole("button", { name: "Salva bozza tee" }));await screen.findByRole("button", { name: "Modifica tee Giallo Uomini" });
  add();fill("Giallo", "women");fireEvent.click(screen.getByRole("button", { name: "Salva bozza tee" }));await screen.findByRole("button", { name: "Modifica tee Giallo Donne" });
  expect(f.tees()).toHaveLength(2);expect(f.service.saveDraft).not.toHaveBeenCalled();expect(f.service.abandonDraft).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Pubblica" })).not.toBeInTheDocument();
  view.unmount();f.changePar(count * 4 - 1);view = render(<Harness service={f.service}/>);await open();
  expect(screen.getByText(`Totale Par: ${count * 4 - 1}`)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Modifica tee Giallo Uomini" }));expect(screen.getByLabelText("Course Rating")).toHaveValue(70.2);
  fireEvent.change(screen.getByLabelText("Nome tee"), { target: { value: "Bianco" } });fireEvent.change(screen.getByLabelText("Ordine tee"), { target: { value: "-2" } });
  fireEvent.change(screen.getByLabelText("Stato operativo"), { target: { value: "inactive" } });fireEvent.click(screen.getByRole("button", { name: "Salva bozza tee" }));
  await screen.findByRole("button", { name: "Modifica tee Bianco Uomini" });
  const rows = screen.getAllByRole("row").slice(1);expect(rows.map(row => row.querySelector("th").textContent)).toEqual(["Bianco", "Giallo"]);
  fireEvent.click(screen.getByRole("button", { name: "Abbandona tee Bianco Uomini" }));expect(f.service.abandonCourseTeeDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferma abbandono tee" }));await waitFor(() => expect(f.tees()).toHaveLength(1));
  expect(f.service.abandonDraft).not.toHaveBeenCalled();view.unmount();
});
test("incomplete course has no tee access; duplicates and Slope domain block save, incomplete ratings remain private", async () => {
  const incomplete = fixture(9, false);const view = render(<Harness service={incomplete.service}/>);
  await screen.findByText("Percorso privato");expect(screen.queryByRole("button", { name: /Gestisci tee/ })).not.toBeInTheDocument();view.unmount();
  const f = fixture();render(<Harness service={f.service}/>);await open();add();fill();
  fireEvent.change(screen.getByLabelText("Slope Rating"), { target: { value: "54" } });expect(screen.getByRole("button", { name: "Salva bozza tee" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Slope Rating"), { target: { value: "156" } });expect(screen.getByRole("button", { name: "Salva bozza tee" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Slope Rating"), { target: { value: "55" } });fireEvent.click(screen.getByRole("button", { name: "Salva bozza tee" }));await screen.findByText("Giallo");
  add();fill(" GIALLO ");expect(screen.getByText(/Un tee con questo nome e categoria/)).toBeInTheDocument();expect(screen.getByRole("button", { name: "Salva bozza tee" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Categoria del rating"), { target: { value: "unspecified" } });
  fireEvent.change(screen.getByLabelText("Course Rating"), { target: { value: "" } });fireEvent.change(screen.getByLabelText("Slope Rating"), { target: { value: "" } });
  expect(screen.getByRole("button", { name: "Salva bozza tee" })).toBeEnabled();fireEvent.click(screen.getByRole("button", { name: "Salva bozza tee" }));
  await screen.findByRole("button", { name: "Modifica tee GIALLO Non specificata" });expect(f.tees()[1].snapshot.course_rating).toBeNull();
});
test("dirty exit stay/discard preserves saved tee; save exits and conflicts preserve edits", async () => {
  const f = fixture(), onExit = jest.fn(), logged = jest.spyOn(console, "error").mockImplementation(() => {});
  render(<Harness service={f.service} onExit={onExit}/>);await open();add();fill();fireEvent.click(screen.getByRole("button", { name: "Salva bozza tee" }));await screen.findByText("Giallo");
  fireEvent.click(screen.getByRole("button", { name: "Modifica tee Giallo Uomini" }));fireEvent.change(screen.getByLabelText("Nome tee"), { target: { value: "Non salvato" } });
  fireEvent.click(screen.getByRole("button", { name: "Torna ai tee" }));let guard = screen.getByRole("dialog", { name: "Modifiche tee non salvate" });
  fireEvent.click(within(guard).getByRole("button", { name: "Resta" }));expect(screen.getByLabelText("Nome tee")).toHaveValue("Non salvato");
  fireEvent.click(screen.getByRole("button", { name: "Torna ai tee" }));guard = screen.getByRole("dialog", { name: "Modifiche tee non salvate" });
  fireEvent.click(within(guard).getByRole("button", { name: "Scarta modifiche" }));expect(f.tees()[0].snapshot.name).toBe("Giallo");expect(f.service.abandonCourseTeeDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Modifica tee Giallo Uomini" }));fireEvent.change(screen.getByLabelText("Nome tee"), { target: { value: "Salvato" } });
  f.service.saveCourseTeeDraft.mockRejectedValueOnce({ code: "40001" });fireEvent.click(screen.getByRole("button", { name: "Salva bozza tee" }));await screen.findByRole("alert");expect(screen.getByLabelText("Nome tee")).toHaveValue("Salvato");
  fireEvent.click(screen.getByRole("button", { name: "Esci" }));guard = screen.getByRole("dialog", { name: "Modifiche tee non salvate" });
  expect(onExit).not.toHaveBeenCalled();fireEvent.click(within(guard).getByRole("button", { name: "Salva bozza" }));await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  expect(f.tees()[0].snapshot.name).toBe("Salvato");logged.mockRestore();
});
