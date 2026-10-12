import { StrictMode, useCallback, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import NewClubCreation from "./NewClubCreation";

const ownerId = "admin-fixture";
const fig = { id: "fig-fixture", name: "Club FIG", city: "Roma", source_system: "fig", source_external_id: "fig-club-fixture" };
const draft = { draft_id: "draft-fixture", snapshot: { name: fig.name, city: fig.city, fig_code: fig.source_external_id, fig_source: fig }, revision: 1 };
const makeService = () => ({
  searchFigClubs: jest.fn().mockResolvedValue([fig]), openDraft: jest.fn().mockResolvedValue(draft),
  saveDraft: jest.fn().mockImplementation(async (current, fields) => ({ ...current, revision: current.revision + 1, snapshot: { ...current.snapshot, ...fields } })),
  abandonDraft: jest.fn().mockResolvedValue({ ...draft, workflow_status: "archived" })
});
function Harness({ service, draftId = null, onExit = jest.fn(), onExisting = jest.fn() }) {
  const guard = useRef(null);
  const register = useCallback((value) => { guard.current = value; }, []);
  const exit = () => guard.current ? guard.current(onExit) : onExit();
  return <><button onClick={exit}>Esci dal flusso</button><NewClubCreation draftId={draftId} ownerId={ownerId} service={service} onBack={exit} onOpenExisting={onExisting} registerExitGuard={register} /></>;
}
async function searchFig(text = "Roma") {
  fireEvent.click(screen.getByRole("button", { name: /Crea da FIG/ }));
  fireEvent.change(screen.getByLabelText("Cerca per nome, città o codice FIG"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Cerca FIG" }));
  return screen.findByRole("radio", { name: /Club FIG/ });
}

test("the initial explicit choice is read-only and manual creation reuses the private editor", async () => {
  const service = makeService();
  render(<Harness service={service} />);
  expect(screen.getByRole("button", { name: /Crea manualmente/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Crea da FIG/ })).toBeInTheDocument();
  expect(service.openDraft).not.toHaveBeenCalled();
  expect(service.searchFigClubs).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Crea manualmente/ }));
  await screen.findByLabelText("Nome visualizzato");
  expect(service.openDraft).toHaveBeenCalledWith(null, ownerId);
});

test("FIG selection is single and draft creation requires final confirmation, once in StrictMode", async () => {
  const service = makeService();
  service.searchFigClubs.mockResolvedValue([fig, { ...fig, id: "second", name: "Secondo FIG", city: null }]);
  render(<StrictMode><Harness service={service} /></StrictMode>);
  const row = await searchFig();
  expect(service.searchFigClubs).toHaveBeenCalledWith("Roma", ownerId);
  expect(service.openDraft).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Crea bozza da FIG" })).toBeDisabled();
  fireEvent.click(row);
  fireEvent.click(screen.getByRole("radio", { name: /Secondo FIG/ }));
  expect(row).toHaveAttribute("aria-checked", "false");
  fireEvent.click(row);
  expect(screen.getByRole("radio", { name: /Secondo FIG/ })).toHaveAttribute("aria-checked", "false");
  fireEvent.click(screen.getByRole("button", { name: "Crea bozza da FIG" }));
  let dialog = await screen.findByRole("dialog", { name: "Conferma bozza da FIG" });
  expect(within(dialog).getByText(/Nessun Percorso, matching definitivo o pubblicazione/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Annulla" }));
  expect(service.openDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Crea bozza da FIG" }));
  dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Conferma creazione bozza" }));
  await waitFor(() => expect(screen.getByLabelText("Nome visualizzato")).toHaveValue(fig.name));
  expect(service.openDraft).toHaveBeenCalledTimes(1);
  expect(service.openDraft).toHaveBeenCalledWith(null, ownerId, fig.id);
  expect(screen.getByLabelText("Località / città")).toHaveValue(fig.city);
  expect(screen.getByLabelText("Codice / riferimento FIG (facoltativo)")).toHaveValue(fig.source_external_id);
  expect(screen.getByRole("region", { name: "Fonte FIG selezionata" })).toHaveTextContent(fig.name);
  expect(screen.queryByRole("button", { name: "Pubblica" })).not.toBeInTheDocument();
});

test("resumed FIG drafts preserve origin while editable values, save/exit guard and abandonment work", async () => {
  const service = makeService(), onExit = jest.fn();
  render(<Harness service={service} draftId={draft.draft_id} onExit={onExit} />);
  fireEvent.change(await screen.findByLabelText("Nome visualizzato"), { target: { value: "Club curato" } });
  fireEvent.change(screen.getByLabelText("Codice / riferimento FIG (facoltativo)"), { target: { value: "Riferimento curato" } });
  fireEvent.click(screen.getByRole("button", { name: "Esci dal flusso" }));
  const dialog = await screen.findByRole("dialog", { name: "Modifiche non salvate" });
  expect(onExit).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Resta" }));
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza" }));
  await screen.findByText("Bozza salvata. Il nuovo club non è ancora pubblicabile.");
  expect(screen.getByRole("region", { name: "Fonte FIG selezionata" })).toHaveTextContent(fig.source_external_id);
  expect(screen.getByLabelText("Codice / riferimento FIG (facoltativo)")).toHaveValue("Riferimento curato");
  fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza" }));
  const abandon = await screen.findByRole("dialog", { name: "Abbandona bozza" });
  fireEvent.click(within(abandon).getByRole("button", { name: "Conferma abbandono" }));
  await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  expect(service.abandonDraft).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }), ownerId);
});

test("an existing FIG-linked Club is warned about and opened without a new draft form", async () => {
  const service = makeService(), onExisting = jest.fn(), existing = { id: "live-club", name: "Club esistente" };
  service.openDraft.mockRejectedValue({ code: "FIG_CLUB_EXISTS", club: existing });
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  render(<Harness service={service} onExisting={onExisting} />);
  fireEvent.click(await searchFig());
  fireEvent.click(screen.getByRole("button", { name: "Crea bozza da FIG" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Conferma creazione bozza" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("già collegato a un club STABLR");
  expect(screen.queryByLabelText("Nome visualizzato")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Apri club esistente/ }));
  expect(onExisting).toHaveBeenCalledWith(existing);
  expect(service.saveDraft).not.toHaveBeenCalled();
  logged.mockRestore();
});

test("FIG has explicit empty and failure states; editing a search clears the previous selection", async () => {
  const service = makeService();
  service.searchFigClubs.mockResolvedValueOnce([]).mockRejectedValueOnce({ code: "42501" }).mockResolvedValueOnce([fig]);
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  render(<Harness service={service} />);
  fireEvent.click(screen.getByRole("button", { name: /Crea da FIG/ }));
  fireEvent.change(screen.getByLabelText("Cerca per nome, città o codice FIG"), { target: { value: "Club" } });
  fireEvent.click(screen.getByRole("button", { name: "Cerca FIG" }));
  await screen.findByText("Nessun club FIG corrisponde alla ricerca.");
  fireEvent.click(screen.getByRole("button", { name: "Cerca FIG" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Impossibile cercare");
  fireEvent.click(screen.getByRole("button", { name: "Cerca FIG" }));
  fireEvent.click(await screen.findByRole("radio"));
  fireEvent.change(screen.getByLabelText("Cerca per nome, città o codice FIG"), { target: { value: "Nuova ricerca" } });
  expect(screen.getByRole("button", { name: "Crea bozza da FIG" })).toBeDisabled();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(service.openDraft).not.toHaveBeenCalled();
  logged.mockRestore();
});

test("Mare di Roma already present is visibly blocked before confirmation; only unlinked FIG records are selectable", async () => {
  const service = makeService(), onExisting = jest.fn();
  const existing = { id: "mare-live-fixture", name: "Mare di Roma", fig_club_id: "mare-fig-fixture", fig_match_status: "matched" };
  const mare = { id: "mare-fig-fixture", name: "Mare Di Roma", city: null,
    source_system: "fig", source_external_id: "fig-club-mare-di-roma", existingClubs: [existing] };
  service.searchFigClubs.mockResolvedValue([mare, { ...fig, existingClubs: [] }]);
  render(<Harness service={service} onExisting={onExisting} />);
  fireEvent.click(screen.getByRole("button", { name: /Crea da FIG/ }));
  fireEvent.change(screen.getByLabelText("Cerca per nome, città o codice FIG"), { target: { value: "Mare di Roma" } });
  fireEvent.click(screen.getByRole("button", { name: "Cerca FIG" }));
  await screen.findByText("Già presente in STABLR");
  expect(service.searchFigClubs).toHaveBeenCalledWith("Mare di Roma", ownerId);
  expect(screen.getByText(/fig-club-mare-di-roma/)).toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: /Mare Di Roma/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole("radio")).toHaveLength(1);
  fireEvent.click(screen.getByText("Mare Di Roma"));
  expect(screen.getByRole("button", { name: "Crea bozza da FIG" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Crea bozza da FIG" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(service.openDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("radio", { name: /Club FIG/ }));
  expect(screen.getByRole("button", { name: "Crea bozza da FIG" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Apri club esistente" }));
  expect(onExisting).toHaveBeenCalledWith(existing);
  expect(service.openDraft).not.toHaveBeenCalled();
});
