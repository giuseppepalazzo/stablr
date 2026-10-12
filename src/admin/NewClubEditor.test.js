import { StrictMode, useCallback, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import NewClubEditor, { NewClubDrafts } from "./NewClubEditor";

const ownerId = "admin-fixture";
const draft = { draft_id: "new-draft-fixture", revision: 1, snapshot: { name: "", city: null } };
const makeService = () => ({
  openDraft: jest.fn().mockResolvedValue(draft),
  saveDraft: jest.fn().mockImplementation((current, fields) => Promise.resolve({ ...current, revision: current.revision + 1, snapshot: { name: fields.name.trim(), city: fields.city.trim() || null } })),
  abandonDraft: jest.fn().mockResolvedValue({ ...draft, workflow_status: "archived" }),
  listDrafts: jest.fn().mockResolvedValue([])
});
function Harness({ service, draftId = null, onExit = jest.fn() }) {
  const guard = useRef(null);
  const registerExitGuard = useCallback((current) => { guard.current = current; }, []);
  const exit = () => guard.current ? guard.current(onExit) : onExit();
  return <><button onClick={exit}>Vai al catalogo</button><NewClubEditor draftId={draftId} ownerId={ownerId} service={service} onBack={exit} registerExitGuard={registerExitGuard} /></>;
}

test("StrictMode opens one private draft; requires name and never offers publication or FIG editing", async () => {
  const service = makeService();
  render(<StrictMode><Harness service={service} /></StrictMode>);
  expect(await screen.findByLabelText("Nome visualizzato")).toBeRequired();
  expect(service.openDraft).toHaveBeenCalledTimes(1);
  expect(service.openDraft).toHaveBeenCalledWith(null, ownerId);
  expect(screen.getByText("Bozza nuovo club")).toBeInTheDocument();
  expect(screen.getByText("Non ancora pubblicabile")).toBeInTheDocument();
  expect(screen.getByText("Non visibile · non giocabile")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Salva bozza" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: /Pubblica/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole("textbox")).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Nuovo Club" } });
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza" }));
  await screen.findByText("Bozza salvata. Il nuovo club non è ancora pubblicabile.");
  expect(service.saveDraft).toHaveBeenCalledWith(draft, { name: "Nuovo Club", city: "" }, ownerId);
  expect(screen.queryByText("Modifiche non salvate")).not.toBeInTheDocument();
});

test("resumes persisted name and optional city without creating another draft", async () => {
  const service = makeService();
  service.openDraft.mockResolvedValue({ ...draft, snapshot: { name: "Club salvato", city: "Roma" } });
  render(<Harness service={service} draftId={draft.draft_id} />);
  await waitFor(() => expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("Club salvato"));
  expect(screen.getByLabelText("Località / città")).toHaveValue("Roma");
  expect(service.openDraft).toHaveBeenCalledWith(draft.draft_id, ownerId);
});

test("unsaved navigation supports stay and save before exiting", async () => {
  const service = makeService(), onExit = jest.fn();
  render(<Harness service={service} onExit={onExit} />);
  fireEvent.change(await screen.findByLabelText("Nome visualizzato"), { target: { value: "Club" } });
  fireEvent.change(screen.getByLabelText("Località / città"), { target: { value: "Roma" } });
  fireEvent.click(screen.getByRole("button", { name: "Vai al catalogo" }));
  let dialog = await screen.findByRole("dialog", { name: "Modifiche non salvate" });
  expect(onExit).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Resta" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Vai al catalogo" }));
  dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Salva bozza" }));
  await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  expect(service.saveDraft).toHaveBeenCalledTimes(1);
  expect(service.abandonDraft).not.toHaveBeenCalled();
});

test("discard removes only transient edits, not the saved draft", async () => {
  const service = makeService(), onExit = jest.fn();
  render(<Harness service={service} onExit={onExit} />);
  fireEvent.change(await screen.findByLabelText("Nome visualizzato"), { target: { value: "Unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: "Vai al catalogo" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Scarta" }));
  expect(onExit).toHaveBeenCalledTimes(1);
  expect(service.saveDraft).not.toHaveBeenCalled();
  expect(service.abandonDraft).not.toHaveBeenCalled();
});

test("abandonment requires confirmation and returns only after successful archival", async () => {
  const service = makeService(), onExit = jest.fn();
  render(<Harness service={service} onExit={onExit} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza" }));
  let dialog = await screen.findByRole("dialog", { name: "Abbandona bozza" });
  expect(within(dialog).getByText(/Il catalogo pubblicato non cambia/)).toBeInTheDocument();
  expect(service.abandonDraft).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Annulla" }));
  expect(onExit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza" }));
  dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Conferma abbandono" }));
  await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  expect(service.abandonDraft).toHaveBeenCalledWith(draft, ownerId);
});

test("a save conflict keeps edits and prevents navigation without false publication messages", async () => {
  const service = makeService(), onExit = jest.fn();
  service.saveDraft.mockRejectedValue({ code: "40001" });
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  render(<Harness service={service} onExit={onExit} />);
  fireEvent.change(await screen.findByLabelText("Nome visualizzato"), { target: { value: "Club" } });
  fireEvent.click(screen.getByRole("button", { name: "Vai al catalogo" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Salva bozza" }));
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("La bozza è cambiata"));
  expect(onExit).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("Club");
  expect(screen.queryByText(/pubblicazione è stata bloccata/)).not.toBeInTheDocument();
  logged.mockRestore();
});

test("the separate draft list resumes by exact draft ID and is absent when empty", async () => {
  const service = makeService(), onOpenDraft = jest.fn();
  service.listDrafts.mockResolvedValue([{ ...draft, snapshot: { name: "Club salvato", city: null } }]);
  const view = render(<NewClubDrafts service={service} ownerId={ownerId} onOpenDraft={onOpenDraft} />);
  fireEvent.click(await screen.findByRole("button", { name: /Club salvato/ }));
  expect(onOpenDraft).toHaveBeenCalledWith(draft.draft_id);
  expect(service.listDrafts).toHaveBeenCalledWith(ownerId);
  view.unmount();
  service.listDrafts.mockResolvedValue([]);
  render(<NewClubDrafts service={service} ownerId={ownerId} onOpenDraft={onOpenDraft} />);
  await waitFor(() => expect(service.listDrafts).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("heading", { name: "Bozze nuovi club" })).not.toBeInTheDocument();
});

test("a failed draft list is explicit and retry restores the available draft", async () => {
  const service = makeService();
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  service.listDrafts.mockRejectedValueOnce({ code: "42501" }).mockResolvedValue([{ ...draft, snapshot: { name: "Riprendi", city: null } }]);
  render(<NewClubDrafts service={service} ownerId={ownerId} onOpenDraft={jest.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Impossibile caricare le bozze");
  fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
  await screen.findByRole("button", { name: /Riprendi/ });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  logged.mockRestore();
});
