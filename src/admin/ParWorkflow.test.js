import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import LocalPar, { ParWorkflowBatch } from "./ParWorkflow";
import { createPhysicalParService } from "./physical-par-data";

const target = { type: "course", mode: "local", approved: true, reasons: [], target: { id: "route-1", club_id: "club-1", label: "Percorso nove", holes_count: 9, total_par: 35 }, holes: [{ id: "hole-1", number: 1, par: 4, si: 11 }] };
const context = { type: "course", mode: "local", target: target.target, hole: { ...target.holes[0], after: 4 }, before_total: 35, after_total: 35, tees: [], blockers: ["no_par_change"], can_publish: false, requires_override: false, baseline_hash: "hash", base_changed: false, draft: { id: "draft-1", revision: 1, par: 4, create_override: false } };
const makeService = (initial = context) => ({
  list: jest.fn().mockResolvedValue({ targets: [target], history: [] }),
  open: jest.fn().mockResolvedValue(initial),
  save: jest.fn().mockImplementation(async (d, par, override) => ({ ...initial, hole: { ...initial.hole, after: Number(par) }, after_total: 35 + Number(par) - 4, draft: { ...d, revision: d.revision + 1, par: Number(par), create_override: override }, blockers: initial.requires_override && !override ? ["explicit_local_override_required"] : [], can_publish: !initial.requires_override || override })),
  publish: jest.fn().mockResolvedValue({ published: true }), abandon: jest.fn().mockResolvedValue({ archived: true })
});
const open = async () => fireEvent.click(await screen.findByRole("row", { name: /Buca 1/ }));
test("global preview has no mutation until a single explicit approval and note", async () => {
  const service = { workflowPreview: jest.fn().mockResolvedValue({ target_count: 1, tee_count: 0, excluded_count: 1, clubs: [{ club_id: "club-1", label: "Club", targets: [target], excluded: [{ reasons: ["incomplete_configuration_grid"] }], tee_proposal: { tee_count: 0, excluded: [] } }] }), workflowConfirm: jest.fn().mockResolvedValue({ confirmed: [{ club_id: "club-1" }], excluded: [] }) };
  render(<ParWorkflowBatch service={service} />); fireEvent.click(screen.getByRole("button", { name: "Prepara batch Par" }));
  const dialog = await screen.findByRole("dialog"); expect(service.workflowConfirm).not.toHaveBeenCalled();
  expect(within(dialog).getByText(/1 configurazioni incluse/)).toBeInTheDocument();
  const confirm = within(dialog).getByRole("button", { name: "Conferma batch Par" }); expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("Nota di approvazione batch"), { target: { value: "Approvo il perimetro" } }); fireEvent.click(confirm);
  await waitFor(() => expect(service.workflowConfirm).toHaveBeenCalledWith(expect.objectContaining({ target_count: 1 }), "Approvo il perimetro"));
  expect(await screen.findByText(/1 club approvati/)).toBeInTheDocument();
});
test("autonomous local publication saves a dedicated draft, previews totals and requires final note", async () => {
  const service = makeService(); render(<LocalPar clubId="club-1" service={service} />); await open();
  fireEvent.change(await screen.findByLabelText("Nuovo Par locale"), { target: { value: "5" } }); fireEvent.click(screen.getByRole("button", { name: "Anteprima impatto" }));
  const dialog = await screen.findByRole("dialog"); expect(within(dialog).getByText(/Totale configurazione: 35 → 36/)).toBeInTheDocument(); expect(service.publish).not.toHaveBeenCalled();
  const confirm = within(dialog).getByRole("button", { name: "Conferma pubblicazione" }); expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("Nota di pubblicazione"), { target: { value: "Pubblicazione motivata" } }); fireEvent.click(confirm);
  expect(await screen.findByText(/Par pubblicato atomicamente/)).toBeInTheDocument(); expect(screen.queryByText("Bozza Par locale")).not.toBeInTheDocument();
  expect(service.save).toHaveBeenCalledWith(context.draft, "5", false);
});
test("inherited independent configuration requires explicit Create local override", async () => {
  const initial = { ...context, mode: "override", requires_override: true, parent: { course_name: "Fisico 18", hole_number: 1, base_par: 4 }, blockers: ["explicit_local_override_required"] }, service = makeService(initial);
  render(<LocalPar clubId="club-1" service={service} />); await open();
  fireEvent.change(await screen.findByLabelText("Nuovo Par locale"), { target: { value: "5" } });
  expect(screen.getByText(/Origine fisica: Fisico 18/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Crea override locale" }));
  fireEvent.click(screen.getByRole("button", { name: "Anteprima impatto" })); await screen.findByRole("dialog");
  expect(service.save).toHaveBeenCalledWith(initial.draft, "5", true); expect(service.publish).not.toHaveBeenCalled();
});
test("shared 9x2 has no local edit action and explains the physical parent", async () => {
  const service = makeService(); service.list.mockResolvedValue({ targets: [{ ...target, mode: "physical" }], history: [] });
  render(<LocalPar clubId="club-1" service={service} />);
  expect(await screen.findByText(/nessun override locale del solo 18/)).toBeInTheDocument(); expect(screen.queryByRole("row", { name: /Buca 1/ })).not.toBeInTheDocument(); expect(service.open).not.toHaveBeenCalled();
});
test("unsaved local changes protect exit without archiving a saved draft", async () => {
  const service = makeService(), guard = jest.fn(), back = jest.fn(); render(<LocalPar clubId="club-1" service={service} registerExitGuard={guard} onBack={back} />); await open();
  fireEvent.change(await screen.findByLabelText("Nuovo Par locale"), { target: { value: "5" } }); fireEvent.click(screen.getByRole("button", { name: "Torna alle configurazioni" }));
  const dialog = await screen.findByRole("dialog"); expect(within(dialog).getByRole("button", { name: "Salva bozza" })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Resta" })); expect(screen.getByLabelText("Nuovo Par locale")).toHaveValue(5);
  expect(service.abandon).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled();
});
test("abandon is explicit and errors retain the draft without publishing", async () => {
  const service = makeService(); render(<LocalPar clubId="club-1" service={service} />); await open(); await screen.findByLabelText("Nuovo Par locale");
  fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza" })); const dialog = await screen.findByRole("dialog"); expect(service.abandon).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Abbandona bozza" })); await waitFor(() => expect(service.abandon).toHaveBeenCalledWith(context.draft)); expect(service.publish).not.toHaveBeenCalled();
});
test("RPC contract sends exact target, revision, flag, hash and note without generic writes", async () => {
  const client = { rpc: jest.fn().mockResolvedValue({ data: { published: true }, error: null }) }, s = createPhysicalParService(client);
  await s.local.open("course", "route-1", "hole-1"); expect(client.rpc).toHaveBeenLastCalledWith("admin_catalog_local_par_open", { p_type: "course", p_target: "route-1", p_hole: "hole-1" });
  await s.local.save(context.draft, "5", true); expect(client.rpc).toHaveBeenLastCalledWith("admin_catalog_local_par_save", { p_draft: "draft-1", p_revision: 1, p_par: 5, p_override: true });
  await s.local.publish(context, " Note "); expect(client.rpc).toHaveBeenLastCalledWith("admin_catalog_local_par_publish", { p_draft: "draft-1", p_revision: 1, p_expected_hash: "hash", p_note: "Note", p_confirm: true });
});
