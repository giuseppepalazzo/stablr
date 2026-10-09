import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import TeeClassifications from "./TeeClassifications";
import { createTeeClassificationService, teeDecisionPayload } from "./tee-classification-data";

const row = { entity_type: "route_tee", tee_id: "tee-1", tee_name: "Giallo", tee_color: "yellow", parent_name: "Percorso nove", holes_count: 9, par_total: 35, attestation: "sconosciuto", par_behavior: "sconosciuto", state: "unclassified", revision: 0 };
const baseline = { par_total: 35, holes_count: 9, applicability: null, course_rating: 34.8, slope_rating: 125, parent_total_par: 35, source_fingerprint: "fixture-source", grid_fingerprint: "fixture-grid" };
const detail = () => ({ contract_version: 1, club_id: "club-1", entity_type: row.entity_type, tee_id: row.tee_id, exists: true,
  tee: { name: "Giallo", par_total: 35, holes_count: 9, applicability: null }, parent: { name: "Percorso nove" }, state: "unclassified", revision: 0,
  classification: null, baseline, recorded_baseline: null, effective_attestation: "sconosciuto", effective_behavior: "sconosciuto", history: [],
  configurations: [{ id: "cfg-9", label: "Nove autonoma verificata", holes_count: 9, review_status: "verified", revision: 2 }] });
const service = () => ({ list: jest.fn().mockResolvedValue([row]), detail: jest.fn().mockResolvedValue(detail()), preview: jest.fn(), confirm: jest.fn() });
const load = async () => { fireEvent.click(screen.getByRole("button", { name: "Consulta classificazioni tee" })); await screen.findByRole("button", { name: "Apri classificazione Percorso nove Giallo" }); };
const open = async () => { fireEvent.click(screen.getByRole("button", { name: "Apri classificazione Percorso nove Giallo" })); await screen.findByRole("button", { name: "Anteprima classificazione" }); };
const fill = () => { fireEvent.change(screen.getByLabelText("Ambito dichiarato"), { target: { value: "9" } }); fireEvent.change(screen.getByLabelText("Nota obbligatoria"), { target: { value: "Decisione manuale fixture" } }); };

test("opening list/detail is read-only: unknown defaults, stable columns, no automatic evidence or derivation", async () => {
  const s = service(); render(<TeeClassifications clubId="club-1" service={s} />);
  expect(s.list).not.toHaveBeenCalled(); await load(); await open();
  expect(screen.getByLabelText("Attestazione del dato")).toHaveValue("sconosciuto");
  expect(screen.getByLabelText("Comportamento quando il Par impatta il tee")).toHaveValue("sconosciuto");
  expect(screen.getByLabelText("Ambito dichiarato")).toHaveValue("");
  expect(screen.getByLabelText("Applicabilità dichiarata")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Anteprima classificazione" })).toBeDisabled();
  expect(s.preview).not.toHaveBeenCalled(); expect(s.confirm).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Pubblica|Salva bozza|Batch/ })).not.toBeInTheDocument();
});

test("independent attestation/behavior filters work, including removed targets and explicit empty state", async () => {
  const s = service(); s.list.mockResolvedValue([row, { ...row, tee_id: "tee-2", tee_name: "Rosso", attestation: "certificato", par_behavior: "richiede_revisione", state: "current" },
    { ...row, entity_type: "combination_tee", tee_id: "deleted", tee_name: null, parent_name: null, state: "target_missing" }]);
  render(<TeeClassifications clubId="club-1" service={s} />); await load();
  expect(screen.getByText("Tee non più disponibile →")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Attestazione"), { target: { value: "certificato" } });
  expect(screen.getByText("Rosso")).toBeInTheDocument(); expect(screen.queryByText("Giallo")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Comportamento Par"), { target: { value: "derivato" } }); expect(screen.getByText("Nessun tee per questi filtri.")).toBeInTheDocument();
  expect(s.confirm).not.toHaveBeenCalled();
});

test("Ambito uses the tee value first, then an exact linked configuration or parent, never a declared scope alone", async () => {
  const fromParent = { ...row, tee_id: "tee-parent", tee_name: "Bianco", holes_count: null };
  const fromConfiguration = { ...row, tee_id: "tee-configuration", tee_name: "Blu", holes_count: null };
  const unknown = { ...row, tee_id: "tee-unknown", tee_name: "Rosso", holes_count: null, declared_holes_count: 18 };
  const s = service(); s.list.mockResolvedValue([row, fromParent, fromConfiguration, unknown]);
  s.detail.mockImplementation(async (_, selected) => {
    if (selected.tee_id === "tee-parent") return { ...detail(), tee_id: selected.tee_id, parent: { name: "Percorso nove", holes_count: 9 } };
    if (selected.tee_id === "tee-configuration") return { ...detail(), tee_id: selected.tee_id, parent: { name: "Configurazione", holes_count: null },
      classification: { configuration_id: "cfg-18" }, configurations: [{ id: "cfg-18", holes_count: 18 }] };
    return { ...detail(), tee_id: selected.tee_id, parent: { name: "Origine incompleta", holes_count: null }, configurations: [] };
  });
  render(<TeeClassifications clubId="club-1" service={s} />); await load();
  expect(await screen.findByText("9 (dal percorso)")).toBeInTheDocument();
  expect(screen.getByText("18 (dal percorso)")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Apri classificazione Percorso nove Rosso" })).toHaveTextContent("—");
  expect(s.detail).toHaveBeenCalledTimes(3);
});

test("manual preview does not write; final confirmation writes once and displays audit without changing the live Par", async () => {
  const s = service(); let p;
  s.preview.mockImplementation(async (club, d, fields) => p = { ...d, decision: teeDecisionPayload(fields), before: null });
  s.confirm.mockImplementation(async () => ({ ...detail(), state: "current", revision: 1, classification: { ...p.decision, revision: 1 },
    history: [{ id: "event-1", revision: 1, occurred_at: "2026-10-09T08:00:00Z", actor_current_admin: true, before: null, after: p.decision }] }));
  render(<TeeClassifications clubId="club-1" service={s} />); await load(); await open(); fill();
  fireEvent.change(screen.getByLabelText("Attestazione del dato"), { target: { value: "curato" } });
  fireEvent.change(screen.getByLabelText("Comportamento quando il Par impatta il tee"), { target: { value: "richiede_revisione" } });
  fireEvent.change(screen.getByLabelText("Riferimento decisione Admin"), { target: { value: "Documento decisione fixture" } });
  fireEvent.change(screen.getByLabelText("Par totale attestato"), { target: { value: "35" } });
  fireEvent.click(screen.getByRole("button", { name: "Anteprima classificazione" }));
  const dialog = await screen.findByRole("dialog"); expect(s.confirm).not.toHaveBeenCalled(); expect(dialog).toHaveTextContent("Par live, CR/Slope, griglie e app giocatore non cambiano");
  fireEvent.click(within(dialog).getByRole("button", { name: "Annulla" })); expect(s.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Anteprima classificazione" })); await screen.findByRole("dialog");
  const confirm = screen.getByRole("button", { name: "Conferma classificazione" }); fireEvent.click(confirm); fireEvent.click(confirm);
  await screen.findByText("Classificazione registrata nella fondazione. Tee e catalogo live invariati.");
  expect(s.confirm).toHaveBeenCalledTimes(1); expect(screen.getByText("Admin corrente")).toBeInTheDocument();
  expect(screen.getByLabelText("Nota obbligatoria")).toHaveValue("");
  expect(s.confirm).toHaveBeenCalledWith("club-1", expect.objectContaining({ baseline, decision: expect.objectContaining({ attestation: "curato", par_behavior: "richiede_revisione" }) }));
});

test("certification requires targeted evidence and explicit provenance; derived requires explicit configuration, not equal totals", async () => {
  const s = service(); s.preview.mockResolvedValue({ ...detail(), decision: {}, before: null });
  render(<TeeClassifications clubId="club-1" service={s} />); await load(); await open(); fill();
  fireEvent.change(screen.getByLabelText("Attestazione del dato"), { target: { value: "certificato" } });
  expect(screen.getByRole("button", { name: "Anteprima classificazione" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Riferimento documento specifico tee / Par / ambito"), { target: { value: "Documento preciso fixture" } });
  fireEvent.change(screen.getByLabelText("Par totale attestato"), { target: { value: "35" } });
  fireEvent.change(screen.getByLabelText("Provenienza della decisione"), { target: { value: "fig" } });
  fireEvent.change(screen.getByLabelText("Comportamento quando il Par impatta il tee"), { target: { value: "derivato" } });
  expect(screen.getByLabelText("Configurazione verificata")).toHaveValue(""); expect(screen.getByRole("button", { name: "Anteprima classificazione" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Configurazione verificata"), { target: { value: "cfg-9" } });
  fireEvent.click(screen.getByRole("button", { name: "Anteprima classificazione" })); await screen.findByRole("dialog"); expect(s.confirm).not.toHaveBeenCalled();
});

test("missing targets preserve history, obsolete baselines remain unknown, neither is adopted automatically", async () => {
  const s = service(); s.detail.mockResolvedValue({ ...detail(), exists: false, state: "target_missing", tee: null, parent: null,
    classification: { attestation: "curato", par_behavior: "richiede_revisione", declared_holes_count: 9, note: "Historical fixture", evidence: { reference: "Past evidence", par_total: 35 } },
    history: [{ id: "past", revision: 1, actor_current_admin: false, after: { attestation: "curato", par_behavior: "richiede_revisione", declared_holes_count: 9, note: "Historical fixture" } }] });
  render(<TeeClassifications clubId="club-1" service={s} />); await load();
  fireEvent.click(screen.getByRole("button", { name: "Apri classificazione Percorso nove Giallo" }));
  expect(await screen.findByText("Altro Admin")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Anteprima classificazione" })).not.toBeInTheDocument();
  expect(screen.getByText(/classificazione registrata è obsoleta/)).toBeInTheDocument(); expect(s.confirm).not.toHaveBeenCalled();
});

test("errors/retry and baseline conflict never look like an empty list or a successful classification", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {}), s = service(); s.list.mockRejectedValueOnce({ code: "42501" });
  render(<TeeClassifications clubId="club-1" service={s} />); fireEvent.click(screen.getByRole("button", { name: "Consulta classificazioni tee" }));
  await screen.findByRole("alert"); expect(screen.queryByText("Nessun tee per questi filtri.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Riprova" })); await screen.findByRole("button", { name: "Apri classificazione Percorso nove Giallo" }); await open(); fill();
  s.preview.mockResolvedValue({ ...detail(), decision: teeDecisionPayload({ attestation: "sconosciuto", par_behavior: "sconosciuto", provenance: "unknown", note: "fixture", declared_holes_count: "9", declared_applicability: "" }), before: null });
  s.confirm.mockRejectedValue({ code: "40001" }); fireEvent.click(screen.getByRole("button", { name: "Anteprima classificazione" })); await screen.findByRole("dialog"); fireEvent.click(screen.getByRole("button", { name: "Conferma classificazione" }));
  await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("La classificazione o la base è cambiata"));
  expect(screen.queryByText("Classificazione registrata nella fondazione. Tee e catalogo live invariati.")).not.toBeInTheDocument(); log.mockRestore();
});

test("changed baseline retains the recorded decision as history but never silently reconfirms it", async () => {
  const s = service(); s.detail.mockResolvedValue({ ...detail(), state: "obsolete", revision: 3,
    baseline: { ...baseline, par_total: 36 }, recorded_baseline: baseline,
    classification: { attestation: "certificato", par_behavior: "richiede_revisione", provenance: "fig", declared_holes_count: 9,
      evidence: { reference: "Specific historical document", par_total: 35 }, note: "Past decision" } });
  render(<TeeClassifications clubId="club-1" service={s} />); await load(); await open();
  expect(screen.getByText(/Attestazione e comportamento effettivi restano sconosciuti/)).toBeInTheDocument();
  expect(screen.getByText("Baseline tecnica registrata")).toBeInTheDocument();
  expect(screen.getByText("Baseline tecnica attuale")).toBeInTheDocument();
  expect(screen.getByLabelText("Nota obbligatoria")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Anteprima classificazione" })).toBeDisabled();
  expect(s.preview).not.toHaveBeenCalled(); expect(s.confirm).not.toHaveBeenCalled();
});

test("service uses only the four classification RPCs, with exact target/CAS/baseline and rejects malformed responses", async () => {
  const client = { rpc: jest.fn().mockResolvedValue({ data: { ...detail(), items: [row] }, error: null }) }, s = createTeeClassificationService(client);
  expect(await s.list("club-1")).toEqual([row]); await s.detail("club-1", row);
  const fields = { attestation: "sconosciuto", par_behavior: "sconosciuto", provenance: "unknown", note: " Manual note ", declared_holes_count: "9", declared_applicability: "" };
  await s.preview("club-1", detail(), fields); const p = { ...detail(), decision: teeDecisionPayload(fields) }; await s.confirm("club-1", p);
  expect(client.rpc.mock.calls.map(([name]) => name)).toEqual(["admin_catalog_tee_classification_list", "admin_catalog_tee_classification_detail", "admin_catalog_tee_classification_preview", "admin_catalog_tee_classification_confirm"]);
  expect(client.rpc.mock.calls[3][1]).toEqual(expect.objectContaining({ p_expected_revision: 0, p_expected_baseline: baseline, p_confirm: true }));
  client.rpc.mockResolvedValue({ data: { ...detail(), club_id: "foreign" }, error: null }); await expect(s.detail("club-1", row)).rejects.toThrow();
  client.rpc.mockResolvedValue({ data: null, error: { code: "42501" } }); await expect(s.list("club-1")).rejects.toEqual({ code: "42501" });
});
