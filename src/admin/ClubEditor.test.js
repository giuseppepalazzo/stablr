import { useCallback, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ClubEditor from "./ClubEditor";
import { createClubEditorService, getClubDiff } from "./club-editor-data";

const club = { id: "club-1", name: "Club esistente", city: "—", figCode: "FIG-1", sourceType: "fig_import", dataStatus: "needs_review", figMatchStatus: "matched" };
const draft = { draft_id: "draft-1", revision: 1, snapshot: { name: club.name, city: null }, base_snapshot: { name: club.name, city: null } };
const makeService = () => ({
  openDraft: jest.fn().mockResolvedValue(draft),
  saveDraft: jest.fn().mockImplementation((current, fields) => Promise.resolve({ ...current, revision: current.revision + 1, snapshot: { name: fields.name.trim(), city: fields.city?.trim() || null } })),
  publishDraft: jest.fn().mockResolvedValue({ club: { id: club.id, name: "Nome aggiornato", city: null } })
});

function Harness({ service, onExit = jest.fn(), onPublished = jest.fn() }) {
  const guard = useRef(null);
  const registerExitGuard = useCallback((current) => { guard.current = current; }, []);
  const exit = () => guard.current ? guard.current(onExit) : onExit();
  return <><button onClick={exit}>Vai al catalogo</button><ClubEditor club={club} onBack={exit} onPublished={onPublished} registerExitGuard={registerExitGuard} service={service} /></>;
}

test("diff contains only changed allowed fields and handles an empty locality", () => {
  expect(getClubDiff({ name: "Club", city: null }, { name: " Club ", city: " " })).toEqual([]);
  expect(getClubDiff({ name: "Club", city: "Roma" }, { name: "Nuovo", city: "" })).toEqual([
    { key: "name", label: "Nome", before: "Club", after: "Nuovo" },
    { key: "city", label: "Località / città", before: "Roma", after: null }
  ]);
});

test("resumes a saved draft and keeps FIG and source/status data read-only", async () => {
  const service = makeService();
  service.openDraft.mockResolvedValue({ ...draft, snapshot: { name: "Bozza salvata", city: "Milano" } });
  render(<Harness service={service} />);
  await waitFor(() => expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("Bozza salvata"));
  expect(screen.getByLabelText("Località / città")).toHaveValue("Milano");
  expect(screen.getByText("Bozza in corso")).toBeInTheDocument();
  expect(screen.getByText("FIG-1")).toBeInTheDocument();
  expect(screen.getAllByRole("textbox")).toHaveLength(2);
  expect(service.openDraft).toHaveBeenCalledWith(club.id);
});

test("saves a draft and publishes only after the final diff confirmation", async () => {
  const service = makeService();
  const onPublished = jest.fn();
  render(<Harness onPublished={onPublished} service={service} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Nome aggiornato" } });
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true }));
  const confirmation = await screen.findByRole("dialog", { name: "Conferma pubblicazione" });
  expect(within(confirmation).getByText(club.name)).toBeInTheDocument();
  expect(within(confirmation).getByText("Nome aggiornato")).toBeInTheDocument();
  expect(service.publishDraft).not.toHaveBeenCalled();
  expect(service.saveDraft).toHaveBeenCalledTimes(1);
  fireEvent.click(within(confirmation).getByRole("button", { name: "Conferma pubblicazione" }));
  await waitFor(() => expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({ name: "Nome aggiornato" })));
  expect(service.publishDraft).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
});

test("unsaved navigation offers stay, discard transient edits, or save before exit", async () => {
  const service = makeService();
  const onExit = jest.fn();
  render(<Harness onExit={onExit} service={service} />);
  await screen.findByLabelText("Nome visualizzato");
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
  expect(service.saveDraft).toHaveBeenCalledWith(draft, expect.objectContaining({ city: "Roma" }));
});

test("discard exits without saving or removing the persisted draft", async () => {
  const service = makeService();
  const onExit = jest.fn();
  render(<Harness onExit={onExit} service={service} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Località / città"), { target: { value: "Roma" } });
  fireEvent.click(screen.getByRole("button", { name: "Vai al catalogo" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Scarta" }));
  expect(onExit).toHaveBeenCalledTimes(1);
  expect(service.saveDraft).not.toHaveBeenCalled();
});

test("a publication conflict remains visible and does not report a live update", async () => {
  const service = makeService();
  const onPublished = jest.fn();
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  service.publishDraft.mockRejectedValue({ code: "40001" });
  render(<Harness onPublished={onPublished} service={service} />);
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Nuovo nome" } });
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Conferma pubblicazione" }));
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("pubblicazione è stata bloccata"));
  expect(onPublished).not.toHaveBeenCalled();
  logged.mockRestore();
});

test("editor adapter sends only name/city and the revision seen at confirmation", async () => {
  const client = { rpc: jest.fn().mockResolvedValue({ data: [draft], error: null }) };
  const service = createClubEditorService(client);
  await service.saveDraft(draft, { name: " Nuovo ", city: " ", fig_club_id: "forbidden" });
  expect(client.rpc).toHaveBeenCalledWith("admin_club_save_draft", { p_draft_id: draft.draft_id, p_snapshot: { name: "Nuovo", city: null }, p_expected_revision: 1 });
});
