import { useCallback, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import NewClubEditor from "./NewClubEditor";
import { createNewClubPublicationService } from "./new-club-publication-data";
import { emptyPublicationPreview } from "./__fixtures__/new-club-publication";

const owner = "admin", draft = { draft_id: "new-club", entity_type: "club", created_by: owner, live_entity_id: null,
  workflow_status: "draft", revision: 1, snapshot: { name: "Club completo", city: "Roma" } };
function completePlan(current = draft) {
  return { ...emptyPublicationPreview(current), can_publish: true, blockers: [], counts: { courses: 1, holes: 9, tees: 1 },
    checklist: { club_name: true, unique_name: true, provenance: true, courses: true, holes: true, tees: true },
    courses: [{ draft_id: "course", revision: 1, fields: { name: "Nove privato", holes_count: 9, display_order: 0 }, configured: true,
      grid_draft_id: "grid", grid_revision: 2, total_par: 36, blockers: [],
      holes: Array.from({ length: 9 }, (_, i) => ({ physical_hole_number: i + 1, par: 4, stroke_index: 9 - i })),
      tees: [{ draft_id: "tee", revision: 1, holes_count: 9, par_total: 36, fields: { name: "Giallo", tee_color: "giallo", rating_category: "men", course_rating: 35.4, slope_rating: 120, is_active: true, display_order: 0 } }] }] };
}
function setup(plan = completePlan()) {
  const client = { rpc: jest.fn().mockResolvedValue({ data: plan, error: null }) };
  const service = { ...createNewClubPublicationService(client), openDraft: jest.fn().mockResolvedValue(draft), listCourseDrafts: jest.fn().mockResolvedValue([]),
    saveDraft: jest.fn().mockImplementation(async (old, fields) => ({ ...old, revision: old.revision + 1, snapshot: fields })), abandonDraft: jest.fn() };
  return { client, service };
}
function Harness({ service, onPublished = jest.fn(), onExit = jest.fn() }) {
  const guard = useRef(null), register = useCallback(fn => { guard.current = fn; }, []);
  return <><button type="button" onClick={() => guard.current?.(onExit)}>Esci</button><NewClubEditor draftId={draft.draft_id} ownerId={owner}
    service={service} registerExitGuard={register} onBack={onExit} onPublished={onPublished}/></>;
}
test("checklist and full preview are read-only; final confirmation needs a note and exact server hash", async () => {
  const { client, service } = setup(), onPublished = jest.fn(), onExit = jest.fn();render(<Harness service={service} onPublished={onPublished} onExit={onExit}/>);
  await screen.findByText("Pronto per la conferma");expect(client.rpc).toHaveBeenCalledWith("admin_new_club_preview", { p_draft_id: draft.draft_id });
  fireEvent.click(screen.getByRole("button", { name: "Anteprima pubblicazione" }));
  const preview = screen.getByRole("dialog", { name: "Anteprima pubblicazione Club" });expect(within(preview).getByText("1 percorsi · 9 buche · 1 tee")).toBeInTheDocument();
  expect(within(preview).getAllByRole("row")).toHaveLength(12);expect(within(preview).getByText("Giallo")).toBeInTheDocument();expect(within(preview).queryByRole("textbox")).not.toBeInTheDocument();
  expect(client.rpc.mock.calls.every(([name]) => name === "admin_new_club_preview")).toBe(true);fireEvent.click(screen.getByRole("button", { name: "Esci" }));expect(onExit).not.toHaveBeenCalled();
  fireEvent.click(within(preview).getByRole("button", { name: "Pubblica Club" }));
  const confirm = screen.getByRole("dialog", { name: "Conferma pubblicazione Club" });expect(within(confirm).getByRole("button", { name: "Conferma pubblicazione Club" })).toBeDisabled();
  fireEvent.change(within(confirm).getByLabelText("Motivazione breve"), { target: { value: " Verificato manualmente " } });
  const result = { draft_id: draft.draft_id, publication_id: "receipt", version_id: "version", counts: completePlan().counts,
    club: { id: "live", name: "Club completo", playable: true, course_routes: [] } };
  client.rpc.mockResolvedValue({ data: result, error: null });fireEvent.click(within(confirm).getByRole("button", { name: "Conferma pubblicazione Club" }));
  await waitFor(() => expect(onPublished).toHaveBeenCalledWith(result));
  expect(client.rpc).toHaveBeenLastCalledWith("admin_new_club_publish", { p_draft_id: draft.draft_id, p_expected_revision: 1, p_confirmation_hash: "a".repeat(64), p_note: "Verificato manualmente" });
  expect(service.saveDraft).not.toHaveBeenCalled();expect(service.abandonDraft).not.toHaveBeenCalled();
});
test("incomplete Club may be previewed but cannot publish; unsaved Club changes require save first", async () => {
  const { client, service } = setup(emptyPublicationPreview(draft));render(<Harness service={service}/>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Anteprima pubblicazione" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Modificato" } });expect(screen.getByRole("button", { name: "Anteprima pubblicazione" })).toBeDisabled();
  expect(screen.getByText("Salva la bozza Club prima di aggiornare l’anteprima.")).toBeInTheDocument();
  client.rpc.mockImplementation(async (name, params) => ({ data: emptyPublicationPreview({ ...draft, revision: 2, snapshot: { name: "Modificato", city: "Roma" } }), error: null }));
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza" }));await waitFor(() => expect(screen.getByRole("button", { name: "Anteprima pubblicazione" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Anteprima pubblicazione" }));expect(screen.getByRole("button", { name: "Pubblica Club" })).toBeDisabled();
  expect(client.rpc.mock.calls.some(([name]) => name === "admin_new_club_publish")).toBe(false);
});
test("preview failure is retryable; publication conflict keeps private draft and requires fresh preview", async () => {
  const { client, service } = setup(), onPublished = jest.fn(), logged = jest.spyOn(console, "error").mockImplementation(() => {});
  client.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } }).mockResolvedValue({ data: completePlan(), error: null });render(<Harness service={service} onPublished={onPublished}/>);
  await screen.findByText("Impossibile verificare la completezza del Club. Riprova.");fireEvent.click(screen.getByRole("button", { name: "Riprova completezza" }));await screen.findByText("Pronto per la conferma");
  fireEvent.click(screen.getByRole("button", { name: "Anteprima pubblicazione" }));fireEvent.click(screen.getByRole("button", { name: "Pubblica Club" }));
  fireEvent.change(screen.getByLabelText("Motivazione breve"), { target: { value: "Verifica completa" } });client.rpc.mockResolvedValueOnce({ data: null, error: { code: "40001" } });
  fireEvent.click(screen.getByRole("button", { name: "Conferma pubblicazione Club" }));await screen.findByText(/La bozza o il catalogo sono cambiati/);
  expect(screen.getByRole("button", { name: "Conferma pubblicazione Club" })).toBeDisabled();expect(onPublished).not.toHaveBeenCalled();expect(service.abandonDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Aggiorna anteprima" }));await screen.findByText("Pronto per la conferma");expect(screen.queryByRole("dialog")).not.toBeInTheDocument();logged.mockRestore();
});
test("publication service rejects wrong draft, incomplete preview and invalid receipt before accepting success", async () => {
  const { client, service } = setup();await expect(service.previewClubPublication({ ...draft, created_by: "other" }, owner)).rejects.toThrow("Owned private");
  await expect(service.publishNewClub(draft, emptyPublicationPreview(draft), "Note", owner)).rejects.toThrow("Complete preview");
  await expect(service.publishNewClub(draft, completePlan(), " ", owner)).rejects.toThrow("Complete preview");
  client.rpc.mockResolvedValue({ data: { ...completePlan(), draft_id: "other" }, error: null });await expect(service.previewClubPublication(draft, owner)).rejects.toThrow("Invalid private");
  client.rpc.mockResolvedValue({ data: {}, error: null });await expect(service.publishNewClub(draft, completePlan(), "Note", owner)).rejects.toThrow("Invalid new Club");
});
