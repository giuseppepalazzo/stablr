import { useCallback, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import NewClubEditor from "./NewClubEditor";
import { emptyPublicationPreview } from "./__fixtures__/new-club-publication";
const owner = "admin-fixture";
const parent = { draft_id: "club-draft", created_by: owner, revision: 1, snapshot: { name: "Club privato", city: null } };
const initialChild = { draft_id: "course-draft", revision: 1, snapshot: { name: "Percorso salvato", holes_count: 9, display_order: 2 } };
function serviceFor(rows = [], fig = false) {
  let stored = rows;
  const opened = { ...parent, snapshot: { ...parent.snapshot, ...(fig ? { fig_source: { name: "Fonte FIG", source_external_id: "fig-test" } } : {}) } };
  return {
    previewClubPublication: jest.fn().mockImplementation(async current => emptyPublicationPreview(current)),
    openDraft: jest.fn().mockResolvedValue(opened),
    listCourseDrafts: jest.fn().mockImplementation(async () => stored),
    saveDraft: jest.fn().mockImplementation(async (current, fields) => ({ ...current, revision: current.revision + 1, snapshot: { ...current.snapshot, ...fields } })),
    abandonDraft: jest.fn(),
    saveCourseDraft: jest.fn().mockImplementation(async (club, child, fields) => {
      const saved = { draft_id: child?.draft_id || "new-course", revision: (child?.revision || 0) + 1,
        snapshot: { name: fields.name.trim(), holes_count: Number(fields.holes_count), display_order: Number(fields.display_order) } };
      stored = [...stored.filter((row) => row.draft_id !== saved.draft_id), saved];return saved;
    }),
    abandonCourseDraft: jest.fn().mockImplementation(async (club, child) => { stored = stored.filter((row) => row.draft_id !== child.draft_id);return { ...child, workflow_status: "archived" }; })
  };
}
function Harness({ service, onExit = jest.fn() }) {
  const guard = useRef(null), register = useCallback((fn) => { guard.current = fn; }, []);
  const exit = () => guard.current ? guard.current(onExit) : onExit();
  return <><button onClick={exit}>Esci</button><NewClubEditor draftId={parent.draft_id} ownerId={owner} service={service} registerExitGuard={register} onBack={exit}/></>;
}
async function start() {
  fireEvent.click(await screen.findByRole("button", { name: "Aggiungi percorso" }));
  return screen.findByRole("dialog", { name: "Aggiungi percorso" });
}
test.each([false, true])("manual/FIG Club: child stays private, requires 9/18, saves, resumes and can be renamed/reordered (FIG %s)", async (fig) => {
  const service = serviceFor([], fig);
  let view = render(<Harness service={service}/>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Aggiungi percorso" })).toBeEnabled());
  await start();
  expect(screen.getByLabelText("Nome percorso")).toBeRequired();expect(screen.getByLabelText("Struttura percorso")).toBeRequired();
  expect(screen.getByRole("button", { name: "Salva bozza percorso" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Nome percorso"), { target: { value: "Nuovo Percorso" } });
  expect(screen.getByRole("button", { name: "Salva bozza percorso" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Struttura percorso"), { target: { value: "18" } });
  fireEvent.change(screen.getByLabelText("Ordine percorso"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza percorso" }));
  await screen.findByText("Nuovo Percorso");expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(service.saveCourseDraft).toHaveBeenCalledTimes(1);expect(service.saveDraft).not.toHaveBeenCalled();
  view.unmount();view = render(<Harness service={service}/>);
  fireEvent.click(await screen.findByRole("button", { name: "Modifica percorso Nuovo Percorso" }));
  expect(screen.getByLabelText("Struttura percorso")).toHaveValue("18");
  fireEvent.change(screen.getByLabelText("Nome percorso"), { target: { value: "Rinominato" } });
  fireEvent.change(screen.getByLabelText("Ordine percorso"), { target: { value: "-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza percorso" }));
  await screen.findByText("Rinominato");expect(screen.getByText("-1")).toBeInTheDocument();
  expect(screen.getByText("Non ancora pubblicabile")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Pubblica" })).not.toBeInTheDocument();
});
test("child dirty guard: stay/discard create no records; saving before navigation persists child", async () => {
  const service = serviceFor(), onExit = jest.fn();render(<Harness service={service} onExit={onExit}/>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Aggiungi percorso" })).toBeEnabled());await start();
  fireEvent.change(screen.getByLabelText("Nome percorso"), { target: { value: "Privato" } });
  fireEvent.change(screen.getByLabelText("Struttura percorso"), { target: { value: "9" } });
  fireEvent.click(screen.getByRole("button", { name: "Torna al Club" }));
  let dialog = screen.getByRole("dialog", { name: "Modifiche percorso non salvate" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Resta" }));
  expect(screen.getByLabelText("Nome percorso")).toHaveValue("Privato");
  fireEvent.click(screen.getByRole("button", { name: "Torna al Club" }));
  dialog = screen.getByRole("dialog", { name: "Modifiche percorso non salvate" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Scarta" }));
  expect(service.saveCourseDraft).not.toHaveBeenCalled();expect(service.abandonCourseDraft).not.toHaveBeenCalled();
  await start();fireEvent.change(screen.getByLabelText("Nome percorso"), { target: { value: "Salvato" } });
  fireEvent.change(screen.getByLabelText("Struttura percorso"), { target: { value: "9" } });
  fireEvent.click(screen.getByRole("button", { name: "Esci" }));
  dialog = screen.getByRole("dialog", { name: "Modifiche percorso non salvate" });
  expect(onExit).not.toHaveBeenCalled();fireEvent.click(within(dialog).getByRole("button", { name: "Salva bozza" }));
  await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));expect(service.saveCourseDraft).toHaveBeenCalledTimes(1);
});
test("abandonment confirms and removes only the selected child; ordering is stable across rows", async () => {
  const other = { ...initialChild, draft_id: "other", snapshot: { name: "Altro", holes_count: 18, display_order: -1 } };
  const service = serviceFor([initialChild, other]);render(<Harness service={service}/>);
  const section = await screen.findByRole("region", { name: "Percorsi della bozza" });
  await screen.findByText("Percorso salvato");
  expect(within(section).getAllByRole("article").map((row) => row.querySelector("strong").textContent)).toEqual(["Altro", "Percorso salvato"]);
  fireEvent.click(screen.getByRole("button", { name: "Abbandona percorso Percorso salvato" }));
  expect(service.abandonCourseDraft).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
  expect(screen.getByText("Percorso salvato")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Abbandona percorso Percorso salvato" }));fireEvent.click(screen.getByRole("button", { name: "Conferma abbandono percorso" }));
  await waitFor(() => expect(screen.queryByText("Percorso salvato")).not.toBeInTheDocument());
  expect(screen.getByText("Altro")).toBeInTheDocument();expect(service.abandonDraft).not.toHaveBeenCalled();
});
test("loading failure is retryable; revision failure preserves child edits and prevents exit", async () => {
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  const service = serviceFor([initialChild]), onExit = jest.fn();
  service.listCourseDrafts.mockRejectedValueOnce({ code: "PGRST202" });
  render(<Harness service={service} onExit={onExit}/>);
  await screen.findByText("Impossibile caricare i Percorsi della bozza.");
  expect(screen.getByRole("button", { name: "Aggiungi percorso" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Riprova Percorsi" }));
  fireEvent.click(await screen.findByRole("button", { name: "Modifica percorso Percorso salvato" }));
  fireEvent.change(screen.getByLabelText("Nome percorso"), { target: { value: "Da conservare" } });
  service.saveCourseDraft.mockRejectedValueOnce({ code: "40001" });
  fireEvent.click(screen.getByRole("button", { name: "Esci" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Modifiche percorso non salvate" })).getByRole("button", { name: "Salva bozza" }));
  await screen.findByRole("alert");expect(onExit).not.toHaveBeenCalled();expect(screen.getByLabelText("Nome percorso")).toHaveValue("Da conservare");
  logged.mockRestore();
});
