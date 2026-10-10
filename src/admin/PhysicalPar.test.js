import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PhysicalPar from "./PhysicalPar";
import { createPhysicalParService } from "./physical-par-data";

const hole = { id: "physical-1", number: 1, par: 4, course_name: "Percorso Mare", review_status: "verified" };
const context = (par = 4, extras = {}) => ({ club_id: "club-1", baseline_hash: "technical-base", base_changed: false,
  draft: { id: "draft-1", revision: 2, par, status: "draft" }, physical_hole: { ...hole, label: "Buca 1", before: 4, after: par },
  configurations: [{ id: "nine", label: "9 autonoma", holes_count: 9, before_total: 35, after_total: 35 + par - 4, occurrences: [{ position: 1, occurrence: 1 }] },
    { id: "eighteen", label: "18 derivata", holes_count: 18, before_total: 70, after_total: 70 + 2 * (par - 4), occurrences: [{ position: 1, occurrence: 1 }, { position: 10, occurrence: 2 }] }],
  tees: [{ entity_type: "route_tee", tee_id: "tee-18", name: "Giallo", scope: 18, before: 70, after: 70 + 2 * (par - 4), eligible: true }],
  overrides_excluded: [], blockers: par === 4 ? ["no_par_change"] : [], can_publish: par !== 4, ...extras });
const proposal = { club_id: "club-1", proposal_hash: "fixed-hash", tee_count: 2, configuration_count: 2,
  items: [{ configuration_label: "9 autonoma" }, { configuration_label: "18 derivata" }], excluded: [{ reason: "unverified_or_changed_dependencies" }] };
const service = () => ({ list: jest.fn().mockResolvedValue({ holes: [hole], history: [] }), proposal: jest.fn().mockResolvedValue(proposal),
  confirmBatch: jest.fn().mockResolvedValue({ batch_id: "batch-1", tee_count: 2, configuration_count: 2 }), open: jest.fn().mockResolvedValue(context()),
  save: jest.fn().mockImplementation(async (_draft, value) => context(Number(value))), publish: jest.fn().mockResolvedValue({ version_id: "version-1", par: 5, configuration_count: 2, tee_count: 1 }),
  abandon: jest.fn().mockResolvedValue({ archived: true }) });
const open = async () => { fireEvent.click(screen.getByRole("button", { name: "Apri buche fisiche verificate" })); fireEvent.click(await screen.findByRole("row", { name: /Percorso Mare Buca 1/ })); await screen.findByLabelText("Nuovo Par fisico"); };

test("one read-only proposal, exact aggregate review, mandatory note and one explicit batch decision", async () => {
  const s = service(); render(<PhysicalPar clubId="club-1" service={s} />);
  expect(s.proposal).not.toHaveBeenCalled(); expect(s.open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Prepara proposta tee" }));
  const dialog = await screen.findByRole("dialog"); expect(dialog).toHaveTextContent("2 tee · 2 configurazioni verificate · 1 esclusi");
  expect(dialog).toHaveTextContent("curato + derivato"); expect(s.confirmBatch).not.toHaveBeenCalled();
  expect(within(dialog).getByRole("button", { name: "Conferma batch tee" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Nota di approvazione batch"), { target: { value: "Regola esatta approvata" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Conferma batch tee" }));
  await screen.findByText(/Batch approvato: 2 tee, 2 configurazioni/); expect(s.confirmBatch).toHaveBeenCalledTimes(1); expect(s.confirmBatch).toHaveBeenCalledWith(proposal, "Regola esatta approvata"); expect(s.publish).not.toHaveBeenCalled();
});

test("empty safe batch never offers a fabricated confirmation or edits exclusions", async () => {
  const s = service(); s.proposal.mockResolvedValue({ ...proposal, items: [], tee_count: 0, configuration_count: 0 }); render(<PhysicalPar clubId="club-1" service={s} />);
  fireEvent.click(screen.getByRole("button", { name: "Prepara proposta tee" })); await screen.findByText(/Nessuna proposta sicura disponibile/);
  fireEvent.change(screen.getByLabelText("Nota di approvazione batch"), { target: { value: "Not enough evidence" } });
  expect(screen.getByRole("button", { name: "Conferma batch tee" })).toBeDisabled(); expect(s.confirmBatch).not.toHaveBeenCalled();
});

test("dedicated draft → save → impact/diff → explicit publication → closed draft and refreshed history", async () => {
  const s = service(); render(<PhysicalPar clubId="club-1" service={s} />); await open();
  fireEvent.change(screen.getByLabelText("Nuovo Par fisico"), { target: { value: "5" } }); expect(s.publish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Anteprima impatto" })); const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Par fisico: 4 → 5"); expect(within(dialog).getByRole("table", { name: "Impatto configurazioni" })).toHaveTextContent("72");
  expect(dialog).toHaveTextContent("10 (2)"); expect(dialog).toHaveTextContent("SI, CR/Slope, distanze, giri e snapshot storici restano invariati");
  expect(within(dialog).getByRole("button", { name: "Conferma pubblicazione" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Nota di pubblicazione"), { target: { value: "Motivazione esplicita" } }); fireEvent.click(within(dialog).getByRole("button", { name: "Conferma pubblicazione" }));
  await screen.findByText(/Par pubblicato: 5.*Bozza chiusa/); expect(s.publish).toHaveBeenCalledWith(context(5), "Motivazione esplicita"); expect(s.publish).toHaveBeenCalledTimes(1); expect(screen.queryByText("Bozza Par fisico")).not.toBeInTheDocument();
});

test("unknown tee, uncovered club, overlapping drafts and explicit overrides are visible; no publication", async () => {
  const s = service(); s.save.mockResolvedValue(context(5, { can_publish: false, blockers: ["tee_unknown_review_obsolete_or_override", "incomplete_club_coverage", "overlapping_live_draft"],
    tees: [{ ...context(5).tees[0], eligible: false }], overrides_excluded: [{ configuration_label: "Override verificato", position: 1, par_override: 4 }] }));
  render(<PhysicalPar clubId="club-1" service={s} />); await open(); fireEvent.change(screen.getByLabelText("Nuovo Par fisico"), { target: { value: "5" } }); fireEvent.click(screen.getByRole("button", { name: "Anteprima impatto" }));
  const dialog = await screen.findByRole("dialog"); expect(dialog).toHaveTextContent("Copertura del club incompleta"); expect(dialog).toHaveTextContent("bozza catalogo con modifiche reali sui target impattati"); expect(dialog).toHaveTextContent("Bloccante / da revisionare"); expect(dialog).toHaveTextContent("Par 4 invariato");
  fireEvent.change(screen.getByLabelText("Nota di pubblicazione"), { target: { value: "Cannot bypass" } }); expect(within(dialog).getByRole("button", { name: "Conferma pubblicazione" })).toBeDisabled(); expect(s.publish).not.toHaveBeenCalled();
});

test("unsaved exit supports stay/discard/save, including sidebar guard; abandonment requires confirmation", async () => {
  const s = service(), guard = jest.fn(), exit = jest.fn(); render(<PhysicalPar clubId="club-1" service={s} registerExitGuard={guard} />); await open();
  fireEvent.change(screen.getByLabelText("Nuovo Par fisico"), { target: { value: "5" } });
  act(() => guard.mock.calls.at(-1)[0](exit)); expect(exit).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Resta" }));
  fireEvent.click(screen.getByRole("button", { name: "Torna alle buche fisiche" })); fireEvent.click(screen.getByRole("button", { name: "Scarta" })); expect(s.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("row", { name: /Percorso Mare Buca 1/ })); await screen.findByLabelText("Nuovo Par fisico");
  fireEvent.change(screen.getByLabelText("Nuovo Par fisico"), { target: { value: "5" } }); fireEvent.click(screen.getByRole("button", { name: "Torna alle buche fisiche" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Salva bozza" })); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); expect(s.save).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("row", { name: /Percorso Mare Buca 1/ })); await screen.findByLabelText("Nuovo Par fisico"); fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza" })); expect(s.abandon).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Abbandona bozza" })); await screen.findByText(/Bozza Par abbandonata/); expect(s.abandon).toHaveBeenCalledTimes(1); expect(s.publish).not.toHaveBeenCalled();
});

test("CAS/lock failures never look like success; stale draft can only be explicitly abandoned", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {}), s = service(); s.open.mockResolvedValue(context(4, { base_changed: true }));
  render(<PhysicalPar clubId="club-1" service={s} />); await open(); expect(screen.getByRole("button", { name: "Salva bozza" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Anteprima impatto" })).toBeDisabled();
  expect(screen.getByText(/Nessuna ripresa o pubblicazione automatica/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Abbandona bozza" })).toBeEnabled(); log.mockRestore();
});

test("publication server failure retains draft and confirmation, with no raw error data or false success", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {}), s = service();
  s.publish.mockRejectedValue({ code: "40001", message: "PRIVATE_PAYLOAD_DO_NOT_LOG" });
  render(<PhysicalPar clubId="club-1" service={s} />); await open();
  fireEvent.change(screen.getByLabelText("Nuovo Par fisico"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Anteprima impatto" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(screen.getByLabelText("Nota di pubblicazione"), { target: { value: "Explicit failed confirmation" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Conferma pubblicazione" }));
  await screen.findByText(/La base o la revisione è cambiata/);
  expect(screen.getByText("Bozza Par fisico")).toBeInTheDocument(); expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.queryByText(/Par pubblicato:/)).not.toBeInTheDocument(); expect(document.body).not.toHaveTextContent("PRIVATE_PAYLOAD_DO_NOT_LOG");
  expect(log).toHaveBeenCalledWith("Admin physical Par failed", "40001"); log.mockRestore();
});

test("RPC service sends only the explicit draft/batch CAS contract, not arbitrary snapshot/live patches", async () => {
  const client = { rpc: jest.fn().mockResolvedValue({ data: { published: true }, error: null }) }, s = createPhysicalParService(client);
  await s.publish(context(5), " Note "); expect(client.rpc).toHaveBeenCalledWith("admin_catalog_par_publish", { p_draft_id: "draft-1", p_revision: 2, p_expected_hash: "technical-base", p_note: "Note", p_confirm: true });
  await s.confirmBatch(proposal, " Note "); expect(client.rpc).toHaveBeenLastCalledWith("admin_catalog_par_tee_confirm", { p_club_id: "club-1", p_proposal_hash: "fixed-hash", p_note: "Note", p_confirm: true });
  client.rpc.mockResolvedValue({ error: { code: "40001" } }); await expect(s.save(context().draft, 5)).rejects.toEqual({ code: "40001" });
});

test("Mare 5→4 preview shows source base9, derived18 and eight impacted tees; return CTA is Admin secondary", async () => {
  const s = service();const names = ["Giallo", "Verde", "Rosso", "Arancio"];
  const mare = context(4, { physical_hole: { ...hole, before: 5, after: 4 }, draft: { id: "draft-mare", revision: 3, par: 4, status: "draft" }, can_publish: true, blockers: [],
    configurations: [{ id: "nine", label: "Percorso 9", holes_count: 9, impact_role: "physical_base", before_total: 35, after_total: 34, occurrences: [{ position: 1, occurrence: 1 }] },
      { id: "eighteen", label: "Percorso 18 derivato", holes_count: 18, impact_role: "propagated", before_total: 70, after_total: 68, occurrences: [{ position: 1, occurrence: 1 }, { position: 10, occurrence: 2 }] }],
    tees: [9, 18].flatMap(scope => names.map(name => ({ tee_id: `${scope}:${name}`, entity_type: "route_tee", name, scope, before: scope === 9 ? 35 : 70, after: scope === 9 ? 34 : 68, eligible: true }))) });
  s.open.mockResolvedValue({ ...mare, physical_hole: { ...mare.physical_hole, after: 5 }, draft: { ...mare.draft, par: 5 } });s.save.mockResolvedValue(mare);
  render(<PhysicalPar clubId="club-1" service={s} />);await open();
  expect(screen.getByRole("button", { name: "Torna alle buche fisiche" })).toHaveClass("stablr-admin-abandon-button");
  expect(screen.getByRole("button", { name: "Abbandona bozza" })).toHaveClass("stablr-admin-abandon-button");
  fireEvent.change(screen.getByLabelText("Nuovo Par fisico"), { target: { value: "4" } });fireEvent.click(screen.getByRole("button", { name: "Anteprima impatto" }));
  const dialog = await screen.findByRole("dialog"), configurations = within(dialog).getByRole("table", { name: "Impatto configurazioni" });
  expect(dialog).toHaveTextContent("Par fisico: 5 → 4");expect(configurations).toHaveTextContent("Percorso 9 · 9 buche · Base aggiornabile");
  expect(within(configurations).getAllByRole("row")[1]).toHaveTextContent("35");expect(within(configurations).getAllByRole("row")[1]).toHaveTextContent("34");
  expect(within(configurations).getAllByRole("row")[2]).toHaveTextContent("70");expect(within(configurations).getAllByRole("row")[2]).toHaveTextContent("68");
  const teeTable = within(dialog).getByRole("table", { name: "Impatto tee" });
  expect(within(teeTable).getAllByRole("row")).toHaveLength(7);
  expect(within(dialog).getByRole("button", { name: "Conferma pubblicazione" })).toBeInTheDocument();
  fireEvent.click(within(teeTable).getByRole("button", { name: "Mostra tutto · Tee impattati" }));
  expect(within(teeTable).getAllByRole("row")).toHaveLength(9);
  expect(dialog).toHaveTextContent("SI, CR/Slope, distanze, giri e snapshot storici restano invariati");expect(s.publish).not.toHaveBeenCalled();
});
