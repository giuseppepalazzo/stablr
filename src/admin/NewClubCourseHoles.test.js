import { StrictMode, useCallback, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import NewClubEditor from "./NewClubEditor";
import { emptyPublicationPreview } from "./__fixtures__/new-club-publication";
import { normalizeNewClubHoles, validateNewClubHoles } from "./new-club-holes-data";
const owner = "admin-fixture";
const parent = { draft_id: "club", created_by: owner, revision: 1, snapshot: { name: "Club privato", city: null } };
function fixture(count = 9) {
  let course = { draft_id: "course", entity_type: "route", created_by: owner, parent_draft_id: "club", live_entity_id: null,
    workflow_status: "draft", revision: 1, snapshot: { name: "Percorso privato", holes_count: count, display_order: 0 } };
  let active = null;const archived = [];
  const service = {
    previewClubPublication: jest.fn().mockImplementation(async current => emptyPublicationPreview(current)),
    openDraft: jest.fn().mockResolvedValue(parent), abandonDraft: jest.fn(),
    saveDraft: jest.fn().mockImplementation(async (value, fields) => ({ ...value, snapshot: { ...fields } })),
    listCourseDrafts: jest.fn().mockImplementation(async () => [{ ...course, ...(active ? { hole_grid: { grid_draft_id: active.draft_id, configured: validateNewClubHoles(active.snapshot).configured } } : {}) }]),
    saveCourseDraft: jest.fn().mockImplementation(async (club, child, fields) => { course = { ...course, revision: course.revision + 1, snapshot: { ...fields } };return course; }),
    openCourseHoleDraft: jest.fn().mockImplementation(async () => {
      active ||= { draft_id: `grid-${archived.length}`, revision: 1, snapshot: { holes_count: count,
        holes: Array.from({ length: count }, (_, i) => ({ physical_hole_number: i + 1, par: null, stroke_index: null })) } };
      return { course, draft: active };
    }),
    saveCourseHoleDraft: jest.fn().mockImplementation(async (currentCourse, draft, snapshot) => {
      active = { ...draft, revision: draft.revision + 1, snapshot: normalizeNewClubHoles(snapshot) };return active;
    }),
    abandonCourseHoleDraft: jest.fn().mockImplementation(async () => { archived.push({ ...active, workflow_status: "archived" });active = null;return archived.at(-1); })
  };
  return { service, getActive: () => active, archived };
}
function Harness({ service, onExit = jest.fn() }) {
  const guard = useRef(null), register = useCallback((fn) => { guard.current = fn; }, []);
  const exit = () => guard.current ? guard.current(onExit) : onExit();
  return <><button onClick={exit}>Esci</button><NewClubEditor draftId="club" ownerId={owner} service={service} registerExitGuard={register} onBack={exit}/></>;
}
const open = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Configura buche Percorso privato" }));
  await screen.findByLabelText("Buca 1 Par");
};
const fill = count => {
  for (let n = 1; n <= count; n++) {
    fireEvent.change(screen.getByLabelText(`Buca ${n} Par`), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(`Buca ${n} SI/HCP`), { target: { value: String(count + 1 - n) } });
  }
};
test.each([9,18])("private %i grid: complete readonly numbering, Par controls, own SI, total and persisted configured state", async count => {
  const f = fixture(count);let view = render(<StrictMode><Harness service={f.service}/></StrictMode>);
  await open();expect(f.service.openCourseHoleDraft).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole("spinbutton")).toHaveLength(count * 2);
  expect(screen.getAllByRole("row")).toHaveLength(count + 1);
  expect(screen.getByLabelText("Buca 1 Par")).toHaveAttribute("min", "3");expect(screen.getByLabelText("Buca 1 Par")).toHaveAttribute("max", "5");
  expect(screen.getByLabelText("Buca 1 SI/HCP")).toHaveAttribute("max", String(count));
  expect(screen.getByText("Totale Par: —")).toBeInTheDocument();fill(count);
  expect(screen.getByText(`Totale Par: ${count * 4}`)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza buche" }));await screen.findByText("Bozza buche salvata. Buche configurate.");
  expect(f.service.saveDraft).not.toHaveBeenCalled();expect(f.service.saveCourseDraft).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Pubblica" })).not.toBeInTheDocument();
  view.unmount();view = render(<Harness service={f.service}/>);
  await screen.findByText("Buche configurate · privato");await open();
  expect(screen.getByLabelText("Buca 1 Par")).toHaveValue(4);expect(screen.getByLabelText("Buca 1 SI/HCP")).toHaveValue(count);
  fireEvent.click(screen.getByRole("button", { name: "Torna al Percorso" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Modifica percorso Percorso privato" }));
  expect(screen.getByLabelText("Struttura percorso")).toBeDisabled();
});
test("partial grids save, while invalid Par or duplicate SI cannot be confirmed", async () => {
  const f = fixture();render(<Harness service={f.service}/>);await open();
  fireEvent.change(screen.getByLabelText("Buca 1 Par"), { target: { value: "6" } });
  expect(screen.getByLabelText("Buca 1 Par")).toHaveValue(null);
  expect(screen.getByText("Par deve essere 3, 4 o 5.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Buca 1 Par"), { target: { value: "3" } });
  expect(screen.getByText("Totale Par: 3 (parziale)")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza buche" }));await screen.findByText(/Bozza buche salvata. Completa/);
  expect(screen.getByText("Bozza privata · incompleto")).toBeInTheDocument();fill(9);
  fireEvent.change(screen.getByLabelText("Buca 2 SI/HCP"), { target: { value: "9" } });
  expect(screen.getByText("SI/HCP 9 è già assegnato alla buca 1.")).toBeInTheDocument();
  expect(screen.getByLabelText("Buca 2 SI/HCP")).toHaveValue(8);
  expect(screen.getByRole("button", { name: "Salva bozza buche" })).toBeEnabled();
  expect(f.service.saveCourseHoleDraft).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Buche configurate · privato")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Buca 2 SI/HCP"), { target: { value: "10" } });expect(screen.getByLabelText("Buca 2 SI/HCP")).toHaveValue(8);
});
test("cyclic controls wrap Par and SI and an exit can abandon only the saved grid", async () => {
  const f = fixture();render(<Harness service={f.service}/>);await open();
  fireEvent.click(screen.getByRole("button", { name: "Buca 1 Par precedente" }));expect(screen.getByLabelText("Buca 1 Par")).toHaveValue(5);
  fireEvent.click(screen.getByRole("button", { name: "Buca 1 Par successivo" }));expect(screen.getByLabelText("Buca 1 Par")).toHaveValue(3);
  fireEvent.click(screen.getByRole("button", { name: "Buca 1 SI/HCP precedente" }));expect(screen.getByLabelText("Buca 1 SI/HCP")).toHaveValue(9);
  fireEvent.click(screen.getByRole("button", { name: "Buca 2 SI/HCP precedente" }));expect(screen.getByLabelText("Buca 2 SI/HCP")).toHaveValue(8);
  fireEvent.click(screen.getByRole("button", { name: "Torna al Percorso" }));
  const guard = screen.getByRole("dialog", { name: "Modifiche buche non salvate" });
  fireEvent.click(within(guard).getByRole("button", { name: "Abbandona bozza" }));
  expect(f.service.abandonCourseHoleDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferma abbandono buche" }));
  await waitFor(() => expect(f.service.abandonCourseHoleDraft).toHaveBeenCalledTimes(1));
});
test("unsaved holes support stay/discard and saving before outer navigation", async () => {
  const f = fixture(), onExit = jest.fn();render(<Harness service={f.service} onExit={onExit}/>);await open();
  fireEvent.change(screen.getByLabelText("Buca 1 Par"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Torna al Percorso" }));
  let guard = screen.getByRole("dialog", { name: "Modifiche buche non salvate" });
  fireEvent.click(within(guard).getByRole("button", { name: "Resta" }));expect(screen.getByLabelText("Buca 1 Par")).toHaveValue(5);
  fireEvent.click(screen.getByRole("button", { name: "Torna al Percorso" }));
  guard = screen.getByRole("dialog", { name: "Modifiche buche non salvate" });fireEvent.click(within(guard).getByRole("button", { name: "Scarta modifiche" }));
  expect(f.service.saveCourseHoleDraft).not.toHaveBeenCalled();await open();expect(screen.getByLabelText("Buca 1 Par")).toHaveValue(null);
  fireEvent.change(screen.getByLabelText("Buca 1 Par"), { target: { value: "4" } });fireEvent.click(screen.getByRole("button", { name: "Esci" }));
  guard = screen.getByRole("dialog", { name: "Modifiche buche non salvate" });expect(onExit).not.toHaveBeenCalled();
  fireEvent.click(within(guard).getByRole("button", { name: "Salva bozza" }));await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  expect(f.getActive().snapshot.holes[0].par).toBe(4);
});
test("abandoning only the grid archives its values, removes configured state and permits a new empty grid", async () => {
  const f = fixture();render(<Harness service={f.service}/>);await open();fill(9);
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza buche" }));await screen.findByText("Bozza buche salvata. Buche configurate.");
  fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza buche" }));
  expect(f.service.abandonCourseHoleDraft).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
  fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza buche" }));fireEvent.click(screen.getByRole("button", { name: "Conferma abbandono buche" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(f.archived[0].snapshot.holes).toHaveLength(9);expect(f.archived[0].snapshot.holes[0].par).toBe(4);
  expect(screen.getByText("Bozza privata · incompleto")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Modifica percorso Percorso privato" }));expect(screen.getByLabelText("Struttura percorso")).toBeEnabled();
  fireEvent.click(within(screen.getByRole("dialog", { name: "Modifica percorso" })).getByRole("button", { name: "Configura buche" }));
  await screen.findByLabelText("Buca 1 Par");expect(screen.getByLabelText("Buca 1 Par")).toHaveValue(null);
});
test("metadata dirty guard runs before entering holes; save conflicts retain hole edits", async () => {
  const f = fixture(), logged = jest.spyOn(console, "error").mockImplementation(() => {});render(<Harness service={f.service}/>);
  fireEvent.click(await screen.findByRole("button", { name: "Modifica percorso Percorso privato" }));
  fireEvent.change(screen.getByLabelText("Ordine percorso"), { target: { value: "7" } });
  fireEvent.click(within(screen.getByRole("dialog", { name: "Modifica percorso" })).getByRole("button", { name: "Configura buche" }));
  expect(f.service.openCourseHoleDraft).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("dialog", { name: "Modifiche percorso non salvate" })).getByRole("button", { name: "Salva bozza" }));
  await screen.findByLabelText("Buca 1 Par");fireEvent.change(screen.getByLabelText("Buca 1 Par"), { target: { value: "3" } });
  f.service.saveCourseHoleDraft.mockRejectedValueOnce({ code: "40001" });fireEvent.click(screen.getByRole("button", { name: "Salva bozza buche" }));
  await screen.findByRole("alert");expect(screen.getByLabelText("Buca 1 Par")).toHaveValue(3);logged.mockRestore();
});
