import { StrictMode, useCallback, useRef, useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CourseEditor from "./CourseEditor";
import CourseTeeEditor, { CourseTeeManager, CourseTeeSection } from "./CourseTeeEditor";
import { courseTeeColor, courseTeeDiff, createCourseTeeEditorService, normalizeCourseTeeFields, validCourseTeeFields } from "./course-tee-editor-data";

const club = { id: "club-fixture", name: "Club fixture" };
const course = { id: "course-fixture", name: "Percorso fixture", holesCount: 9, hasPhysicalHoles: true };
// Same persisted shape as route_tees / dedicated RPC, including inherited scope,
// nullable applicability and a legacy incomplete tee with explicit eighteen scope.
const tee = { id: "tee-fixture", route_id: course.id, tee_name: "Giallo", tee_color: "yellow", gender: null,
  holes_count: null, effective_holes_count: 9, par_total: 35, course_rating: 34.8, slope_rating: 125,
  is_active: true, estimated: false, source_system: "fig", source_external_id: "source-fixture", has_draft_changes: false };
const legacy = { ...tee, id: "legacy-fixture", tee_name: "Storico", holes_count: 18, effective_holes_count: 18, course_rating: null, slope_rating: null };
const snapshot = normalizeCourseTeeFields(tee);
const draft = { draft_id: "draft-fixture", entity_type: "route_tee", live_entity_id: tee.id, workflow_status: "draft", revision: 1, snapshot,
  base_snapshot: { ...snapshot, _context: { tee, course } } };
const makeService = () => ({
  listTees: jest.fn().mockResolvedValue({ course, tees: [tee, legacy] }),
  openDraft: jest.fn().mockResolvedValue({ draft, context: { tee, course } }),
  saveDraft: jest.fn().mockImplementation(async (d, fields) => ({ ...d, revision: d.revision + 1, snapshot: normalizeCourseTeeFields(fields) })),
  publishDraft: jest.fn().mockImplementation(async (d) => ({ version_id: "version-fixture", context: { tee: { ...tee, ...d.snapshot }, course } })),
  abandonDraft: jest.fn().mockResolvedValue({ ...draft, workflow_status: "archived", revision: 2 })
});
function Harness({ service, onExit = jest.fn(), onPublished = jest.fn(), manager = false }) {
  const guard = useRef(null);
  const registerExitGuard = useCallback((current) => { guard.current = current; }, []);
  const navigate = (action) => guard.current ? guard.current(action) : action();
  const back = () => navigate(onExit);
  return <><button onClick={back}>Esci</button>{manager ? <CourseTeeManager club={club} course={course} service={service} navigate={navigate}
    onBack={back} onBackToClub={back} onBackToCatalog={back} registerExitGuard={registerExitGuard} /> : <CourseTeeEditor club={club} course={course} tee={tee}
    service={service} onBack={back} onBackToCourse={back} onBackToClub={back} onBackToCatalog={back} onBackToList={back}
    onPublished={onPublished} registerExitGuard={registerExitGuard} />}</>;
}
test("fresh access after full refresh in real StrictMode opens once despite effect replay and resumes unchanged base", async () => {
  const service = makeService();
  service.openDraft.mockReset().mockResolvedValueOnce({ draft, context: { tee, course } })
    .mockRejectedValueOnce({ code: "55P03", message: 'could not obtain lock on row in relation "route_tees"' });
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const view = render(<StrictMode><Harness service={service} /></StrictMode>);
    await waitFor(() => expect(service.openDraft).toHaveBeenCalledTimes(1));
    expect(await screen.findByLabelText("CR")).toHaveValue(34.8);
    expect(screen.getByLabelText("Slope")).toHaveValue(125); expect(screen.getByLabelText("Stato operativo")).toHaveValue("true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(screen.queryByText("Bozza in corso")).not.toBeInTheDocument();
    view.unmount();
    service.openDraft.mockReset().mockResolvedValue({ draft, context: { tee, course } });
    render(<StrictMode><Harness service={service} /></StrictMode>);
    expect(await screen.findByLabelText("CR")).toHaveValue(34.8); expect(service.openDraft).toHaveBeenCalledTimes(1);
    expect(service.saveDraft).not.toHaveBeenCalled(); expect(service.abandonDraft).not.toHaveBeenCalled();
  } finally { logged.mockRestore(); }
});
test("numeric normalization preserves absent ratings, precision, zero and false without invented CR bounds", () => {
  expect(normalizeCourseTeeFields({ course_rating: "", slope_rating: null, is_active: false })).toEqual({ course_rating: null, slope_rating: null, is_active: false });
  expect(courseTeeDiff(snapshot, { course_rating: "34.800", slope_rating: "125", is_active: true })).toEqual([]);
  for (const cr of [null, "", 0, -1, 34.812345]) expect(validCourseTeeFields({ ...snapshot, course_rating: cr })).toBe(true);
  for (const cr of [Infinity, NaN, "invalid"]) expect(validCourseTeeFields({ ...snapshot, course_rating: cr })).toBe(false);
  for (const slope of [54, 156, 125.5, Infinity]) expect(validCourseTeeFields({ ...snapshot, slope_rating: slope })).toBe(false);
});
test("real tee section lists readonly fields, effective scopes and only white manage CTA; errors not false empty", async () => {
  const service = makeService(), manage = jest.fn();
  render(<CourseTeeSection course={course} service={service} onManage={manage} />);
  expect(screen.getByRole("status")).toHaveTextContent("Caricamento");
  await screen.findByText("Giallo"); expect(screen.getByText("9 buche · dal Percorso")).toBeInTheDocument();
  expect(screen.getByText("18 buche")).toBeInTheDocument(); expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Gestisci tee" })); expect(manage).toHaveBeenCalledTimes(1);
});
test("list load failure is explicit and retry recovers; true empty list is distinct", async () => {
  const logged = jest.spyOn(console, "error").mockImplementation(() => {}), service = makeService();
  service.listTees.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue({ course, tees: [] });
  render(<CourseTeeSection course={course} service={service} onManage={jest.fn()} />);
  await screen.findByRole("alert"); expect(screen.queryByText(/Nessun tee disponibile/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Riprova" })); await screen.findByText(/Nessun tee disponibile/); logged.mockRestore();
});
test("readonly tee detail does not create drafts; explicit Modifica dati opens only selected tee", async () => {
  const service = makeService(); render(<Harness service={service} manager />);
  fireEvent.click(await screen.findByRole("button", { name: "Apri tee Giallo · 9 buche", exact: true }));
  expect(service.openDraft).not.toHaveBeenCalled(); const heading = screen.getByRole("heading", { name: "Giallo" }); expect(heading).toBeInTheDocument();
  expect(heading.querySelector(".stablr-admin-tee-dot")).toHaveStyle({ backgroundColor: courseTeeColor("yellow") });
  fireEvent.click(screen.getByRole("button", { name: "Modifica dati" })); await screen.findByLabelText("CR");
  expect(service.openDraft).toHaveBeenCalledWith(tee.id); expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
  expect(screen.getAllByRole("combobox")).toHaveLength(1); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByText("Par totale · sola lettura")).toBeInTheDocument(); expect(screen.queryByText("Bozza in corso")).not.toBeInTheDocument();
});
test("save is draft-only, before/after confirmation publishes exact revision then removes badge immediately", async () => {
  const service = makeService(); render(<Harness service={service} manager />);
  fireEvent.click(await screen.findByRole("button", { name: "Apri tee Giallo · 9 buche", exact: true })); fireEvent.click(screen.getByRole("button", { name: "Modifica dati" }));
  await screen.findByLabelText("CR"); fireEvent.change(screen.getByLabelText("CR"), { target: { value: "35.25" } });
  fireEvent.change(screen.getByLabelText("Slope"), { target: { value: "126" } });
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza", exact: true })); await screen.findByText(/Bozza salvata/);
  expect(service.publishDraft).not.toHaveBeenCalled(); expect(tee.course_rating).toBe(34.8); expect(screen.getByText("Bozza in corso")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true })); const dialog = await screen.findByRole("dialog", { name: "Conferma pubblicazione" });
  const table = within(dialog).getByRole("table", { name: "Differenze tee" }); for (const text of ["34.8", "35.25", "125", "126"]) expect(within(table).getByText(text)).toBeInTheDocument();
  expect(service.publishDraft).not.toHaveBeenCalled(); fireEvent.click(within(dialog).getByRole("button", { name: "Conferma pubblicazione" }));
  await screen.findByRole("button", { name: "Modifica dati" }); expect(screen.getByText("35.25")).toBeInTheDocument();
  expect(screen.queryByText("Bozza in corso")).not.toBeInTheDocument(); expect(service.publishDraft).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
});
test("incomplete historical ratings stay nullable and do not prevent deactivation", async () => {
  const service = makeService(); service.openDraft.mockResolvedValue({ draft: { ...draft, snapshot: normalizeCourseTeeFields(legacy), base_snapshot: normalizeCourseTeeFields(legacy) }, context: { tee: legacy } });
  render(<Harness service={service} />); await screen.findByLabelText("CR");
  expect(screen.getByLabelText("CR")).toHaveValue(null); expect(screen.getByLabelText("Slope")).toHaveValue(null);
  fireEvent.change(screen.getByLabelText("Stato operativo"), { target: { value: "false" } });
  expect(screen.getByRole("button", { name: "Pubblica", exact: true })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true })); await screen.findByRole("dialog");
  expect(service.saveDraft).toHaveBeenCalledWith(expect.anything(), { course_rating: null, slope_rating: null, is_active: false });
});
test("resumes the saved personal tee draft, with badge only for actual differences and no unsaved-exit prompt", async () => {
  const service = makeService(), onExit = jest.fn();
  service.openDraft.mockResolvedValue({ draft: { ...draft, revision: 4, snapshot: { ...snapshot, slope_rating: 130 } }, context: { tee, course } });
  render(<Harness service={service} onExit={onExit} />); await screen.findByLabelText("Slope");
  expect(screen.getByLabelText("Slope")).toHaveValue(130); expect(screen.getByText("Bozza in corso")).toBeInTheDocument();
  expect(screen.queryByText("Modifiche non salvate")).not.toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "Esci" }));
  expect(onExit).toHaveBeenCalledTimes(1); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(service.saveDraft).not.toHaveBeenCalled();
});
test("invalid Slope prevents save/publish; unchanged draft cannot publish", async () => {
  render(<Harness service={makeService()} />); await screen.findByLabelText("CR");
  expect(screen.getByRole("button", { name: "Pubblica", exact: true })).toBeDisabled();
  for (const value of ["54", "156", "125.5"]) { fireEvent.change(screen.getByLabelText("Slope"), { target: { value } }); expect(screen.getByRole("button", { name: "Salva bozza" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Pubblica", exact: true })).toBeDisabled(); }
});
test.each(["Resta", "Scarta", "Salva bozza"])("unsaved exit and beforeunload protection: %s", async (action) => {
  const service = makeService(), onExit = jest.fn(); render(<Harness service={service} onExit={onExit} />);
  await screen.findByLabelText("CR"); fireEvent.change(screen.getByLabelText("CR"), { target: { value: "36" } });
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Esci" })); const dialog = await screen.findByRole("dialog", { name: "Modifiche non salvate" });
  fireEvent.click(within(dialog).getByRole("button", { name: action }));
  if (action === "Resta") { expect(onExit).not.toHaveBeenCalled(); expect(screen.getByLabelText("CR")).toHaveValue(36); }
  else await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  expect(service.saveDraft).toHaveBeenCalledTimes(action === "Salva bozza" ? 1 : 0); expect(service.publishDraft).not.toHaveBeenCalled();
});
test("abandon confirms and archives only draft, returning to tee without publishing", async () => {
  const service = makeService(), onExit = jest.fn(); render(<Harness service={service} onExit={onExit} />); await screen.findByLabelText("CR");
  fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza" })); const dialog = await screen.findByRole("dialog", { name: "Abbandona bozza" });
  expect(within(dialog).getByText(/Il catalogo pubblicato non cambia/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Conferma abbandono" })); await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  expect(service.abandonDraft).toHaveBeenCalledWith(draft); expect(service.publishDraft).not.toHaveBeenCalled();
});
test.each(["40001", "42501", "23514"])("publication failure %s keeps saved draft and confirmation, no success", async (code) => {
  const logged = jest.spyOn(console, "error").mockImplementation(() => {}), service = makeService(), onPublished = jest.fn();
  service.publishDraft.mockRejectedValue({ code }); render(<Harness service={service} onPublished={onPublished} />); await screen.findByLabelText("CR");
  fireEvent.change(screen.getByLabelText("CR"), { target: { value: "36" } }); fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true }));
  const dialog = await screen.findByRole("dialog"); fireEvent.click(within(dialog).getByRole("button", { name: "Conferma pubblicazione" }));
  await within(dialog).findByRole("alert"); expect(onPublished).not.toHaveBeenCalled(); expect(screen.getByText("Bozza in corso")).toBeInTheDocument(); logged.mockRestore();
});
test("adapter uses only specific RPCs and allowlisted fields, nulls never zero; errors never silently swallowed", async () => {
  const client = { rpc: jest.fn().mockResolvedValue({ data: [draft], error: null }) }, service = createCourseTeeEditorService(client);
  await service.saveDraft(draft, { course_rating: "", slope_rating: "", is_active: false, tee_name: "forbidden", source_payload: {} });
  expect(client.rpc).toHaveBeenCalledWith("admin_course_tee_save_draft", { p_draft_id: draft.draft_id, p_expected_revision: 1, p_snapshot: { course_rating: null, slope_rating: null, is_active: false } });
  await expect(service.saveDraft(draft, { ...snapshot, course_rating: Infinity })).rejects.toMatchObject({ code: "23514" });
  client.rpc.mockResolvedValue({ data: null, error: null }); await expect(service.listTees(course.id)).rejects.toThrow(); await expect(service.publishDraft(draft)).rejects.toThrow();
  client.rpc.mockResolvedValue({ data: null, error: { code: "42501" } }); await expect(service.openDraft(tee.id)).rejects.toEqual({ code: "42501" });
});
test("CourseEditor child entry guards unsaved course data and returns to same course without touching it", async () => {
  const teeService = makeService(), metadata = { name: course.name, holes_count: 9, display_order: 0, is_active: true };
  const courseService = { openDraft: jest.fn().mockResolvedValue({ draft: { draft_id: "course-draft", snapshot: metadata, base_snapshot: metadata }, context: {} }) };
  function Flow() {
    const [manage, setManage] = useState(false), guard = useRef(null);
    const registerExitGuard = useCallback((value) => { guard.current = value; }, []);
    const navigate = (action) => guard.current ? guard.current(action) : action();
    return manage ? <CourseTeeManager club={club} course={course} service={teeService} registerExitGuard={registerExitGuard} navigate={navigate} onBack={() => navigate(() => setManage(false))} />
      : <CourseEditor club={club} course={course} service={courseService} registerExitGuard={registerExitGuard} onManageTees={() => navigate(() => setManage(true))} />;
  }
  render(<Flow />); await screen.findByLabelText("Nome visualizzato");
  expect(screen.getByRole("button", { name: "Gestisci tee" })).toHaveClass("stablr-admin-white-button");
  expect(screen.queryByText("Giallo")).not.toBeInTheDocument(); expect(teeService.listTees).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Non salvato" } });
  fireEvent.click(screen.getByRole("button", { name: "Gestisci tee" })); const dialog = await screen.findByRole("dialog", { name: "Modifiche non salvate" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Scarta" })); await screen.findByRole("heading", { name: "Tee e rating" });
  fireEvent.click(screen.getByRole("button", { name: course.name })); expect(await screen.findByLabelText("Nome visualizzato")).toHaveValue(course.name);
  expect(course.name).toBe("Percorso fixture"); expect(teeService.openDraft).not.toHaveBeenCalled();
});
test("compact tee rows show name once, real color or neutral fallback, and the entire selected row opens its own detail", async () => {
  const service = makeService(); service.listTees.mockResolvedValue({ course, tees: [tee, { ...legacy, tee_color: "unknown-color" }] });
  render(<Harness service={service} manager />);
  const row = await screen.findByRole("button", { name: "Apri tee Giallo · 9 buche" });
  expect(within(row).getAllByText("Giallo")).toHaveLength(1);
  expect(row.querySelector(".stablr-admin-tee-dot")).toHaveStyle({ backgroundColor: courseTeeColor("yellow") });
  expect(within(row).getByText("125")).toBeInTheDocument(); expect(within(row).getByText("34.8")).toBeInTheDocument();
  expect(within(row).getByText("Attivo")).toBeInTheDocument(); expect(within(row).getByText("›")).toBeInTheDocument();
  const historical = screen.getByRole("button", { name: "Apri tee Storico · 18 buche" });
  expect(historical.querySelector(".stablr-admin-tee-dot")).toHaveStyle({ backgroundColor: "#85918b" });
  fireEvent.click(historical); expect(screen.getByRole("heading", { name: "Storico" })).toBeInTheDocument();
  expect(service.openDraft).not.toHaveBeenCalled();
  for (const value of [null, "", "unknown-color", "url(unsafe)"]) expect(courseTeeColor(value)).toBe("#85918b");
  expect(courseTeeColor(" GIALLO ")).toBe(courseTeeColor("yellow")); expect(courseTeeColor("Arancio")).toBe(courseTeeColor("orange")); expect(courseTeeColor("#FAFAFA")).toBe("#fafafa");
});
test.each(["55P03", "40001"])("fresh access retains genuine lock/base failure %s rather than suppressing it", async (code) => {
  const service = makeService(), logged = jest.spyOn(console, "error").mockImplementation(() => {});
  service.openDraft.mockRejectedValue({ code });
  try {
    render(<StrictMode><Harness service={service} /></StrictMode>);
    const alert = await screen.findByRole("alert"); expect(service.openDraft).toHaveBeenCalledTimes(1);
    expect(alert).toHaveTextContent(code === "55P03" ? "temporaneamente occupati" : "sono cambiati");
    expect(screen.queryByLabelText("CR")).not.toBeInTheDocument(); expect(service.abandonDraft).not.toHaveBeenCalled();
  } finally { logged.mockRestore(); }
});
