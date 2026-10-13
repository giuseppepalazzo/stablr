import { useCallback, useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { isNewCourseValid, normalizeNewCourseFields } from "./new-club-course-data";
import NewClubCourseHoles from "./NewClubCourseHoles";
import NewClubCourseTees from "./NewClubCourseTees";
import { validateNewClubHoles } from "./new-club-holes-data";

const failureMessage = (error) => ["40001", "55P03"].includes(error?.code)
  ? "La bozza è cambiata o è in uso. Riapri il Club prima di modificare il Percorso."
  : error?.code === "42501" ? "Non sei autorizzato a modificare questa bozza."
    : "Impossibile completare l’operazione sui Percorsi. Riprova.";

export default function NewClubCourses({ parent, ownerId, service, disabled, registerExitGuard, onEditingChange, scope = "newClub", onPreviewPublication }) {
  const [courses, setCourses] = useState([]), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(null), [fields, setFields] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [loadError, setLoadError] = useState("");
  const [pendingExit, setPendingExit] = useState(null), [abandon, setAbandon] = useState(null);
  const [holeTarget, setHoleTarget] = useState(null);
  const [teeTarget, setTeeTarget] = useState(null);
  const holeExitGuard = useRef(null);
  const registerHoleExitGuard = useCallback((guard) => { holeExitGuard.current = guard; }, []);
  const inFlight = useRef(false);
  const dirty = !!editing && (editing.isNew || JSON.stringify(normalizeNewCourseFields(fields)) !== JSON.stringify(normalizeNewCourseFields(editing.draft.snapshot)));
  useEffect(() => {
    let active = true;setLoading(true);setLoadError("");
    service.listCourseDrafts(parent, ownerId).then((rows) => { if (active) setCourses(rows); }).catch((failure) => {
      console.error("Admin private Percorso list failed", failure?.code || "request_failed");
      if (active) setLoadError("Impossibile caricare i Percorsi della bozza.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // The parent revision/name may change independently of the child list.
  }, [parent.draft_id, parent.club_id, ownerId, service, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    onEditingChange(!!editing || !!abandon || !!holeTarget || !!teeTarget);
    return () => onEditingChange(false);
  }, [editing, abandon, holeTarget, teeTarget, onEditingChange]);
  const close = () => { setEditing(null);setFields(null);setError(""); };
  useEffect(() => {
    registerExitGuard((action) => {
      if (inFlight.current || pendingExit || abandon) return;
      if (holeExitGuard.current) { holeExitGuard.current(() => { setHoleTarget(null);setTeeTarget(null);action(); });return; }
      if (dirty) setPendingExit(() => action);
      else { setEditing(null);setFields(null);action(); }
    });
    const beforeUnload = (event) => { if (dirty) { event.preventDefault();event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { registerExitGuard(null);window.removeEventListener("beforeunload", beforeUnload); };
  }, [dirty, loading, pendingExit, abandon, registerExitGuard]);
  const operation = async (callback) => {
    if (inFlight.current) return;
    inFlight.current = true;setBusy(true);setError("");
    try { await callback(); }
    catch (failure) { console.error("Admin private Percorso operation failed", failure?.code || "request_failed");setError(failureMessage(failure)); }
    finally { inFlight.current = false;setBusy(false); }
  };
  const save = async () => {
    const saved = await service.saveCourseDraft(parent, editing.draft, fields, ownerId);
    setCourses((rows) => [...rows.filter((row) => row.draft_id !== saved.draft_id), { ...saved, ...(editing.draft?.hole_grid ? { hole_grid: editing.draft.hole_grid } : {}) }]);
    close();
  };
  const leave = (action = close) => { if (dirty) setPendingExit(() => action);else action(); };
  const onGridChange = useCallback((course, grid) => {
    setCourses((rows) => rows.map((row) => {
      if (row.draft_id !== course.draft_id) return row;
      const updated = { ...course };delete updated.hole_grid;
      if (grid) { const checks = validateNewClubHoles(grid.snapshot);updated.hole_grid = { course_draft_id: course.draft_id, grid_draft_id: grid.draft_id, configured: checks.configured, total_par: checks.totalPar }; }
      return updated;
    }));
  }, []);
  const sorted = [...courses].sort((a, b) => a.snapshot.display_order - b.snapshot.display_order);
  return <section className="stablr-admin-detail-section" aria-label="Percorsi della bozza">
    <div className="stablr-admin-new-courses-header"><h2>Percorsi della bozza</h2><button className="stablr-admin-white-button" type="button" disabled={disabled || loading || !!loadError || busy}
      onClick={() => { setError("");setEditing({ isNew: true, draft: null });setFields({ name: "", holes_count: "", display_order: 0 }); }}>Aggiungi percorso</button></div>
    <p className="stablr-admin-detail-empty">{scope === "existingClub" ? "I nuovi Percorsi restano privati fino alla loro pubblicazione. Il Club e i Percorsi esistenti non vengono modificati." : "Club e Percorsi restano privati fino alla pubblicazione del Club. Configura le buche di ciascun Percorso, poi aggiungi i tee e rating privati."}</p>
    {loading && <p role="status">Caricamento Percorsi…</p>}
    {loadError && <div role="alert"><p>{loadError}</p><button className="stablr-admin-abandon-button" type="button" onClick={() => setRetry((value) => value + 1)}>Riprova Percorsi</button></div>}
    {!loading && !loadError && (!courses.length ? <p className="stablr-admin-detail-empty">Nessun Percorso nella bozza.</p> : <div className="stablr-admin-new-courses-list">
      {sorted.map((child) => <article className="stablr-admin-new-course-row" key={child.draft_id}>
        <div><span>Nome</span><strong>{child.snapshot.name}</strong></div><div><span>Struttura</span><strong>{child.snapshot.holes_count} buche</strong></div>
        <div><span>Ordine</span><strong>{child.snapshot.display_order}</strong></div><div><span>Stato</span><strong>{child.hole_grid?.configured ? "Buche configurate · privato" : "Bozza privata · incompleto"}</strong></div>
        <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={disabled || busy} type="button" aria-label={`Modifica percorso ${child.snapshot.name}`} onClick={() => { setError("");setEditing({ isNew: false, draft: child });setFields({ ...child.snapshot }); }}>Modifica dati</button>
          <button className="stablr-admin-white-button" disabled={disabled || busy} type="button" aria-label={`Configura buche ${child.snapshot.name}`} onClick={() => setHoleTarget(child)}>Configura buche</button>
          {child.hole_grid?.configured && <button className="stablr-admin-white-button" disabled={disabled || busy} type="button" aria-label={`Gestisci tee ${child.snapshot.name}`} onClick={() => setTeeTarget(child)}>Gestisci tee</button>}
          {onPreviewPublication && <button className="stablr-admin-white-button" disabled={disabled || busy || !!editing || !!holeTarget || !!teeTarget} type="button" aria-label={`Anteprima pubblicazione ${child.snapshot.name}`} onClick={() => onPreviewPublication(child)}>Anteprima pubblicazione</button>}
          <button className="stablr-admin-abandon-button" disabled={disabled || busy} type="button" aria-label={`Abbandona percorso ${child.snapshot.name}`} onClick={() => { setError("");setAbandon(child); }}>Abbandona percorso</button></div>
      </article>)}
    </div>)}
    {editing && <EditorDialog title={editing.isNew ? "Aggiungi percorso" : "Modifica percorso"}>
      <p>Bozza privata del Club · Percorso non ancora presente nel catalogo.</p>
      <form onSubmit={(event) => { event.preventDefault();if (isNewCourseValid(fields) && !pendingExit) operation(save); }}>
        <div className="stablr-admin-editor-fields">
          <label>Nome percorso<input required maxLength={200} disabled={busy || !!pendingExit} value={fields.name} onChange={(event) => setFields((value) => ({ ...value, name: event.target.value }))} /></label>
          <label>Struttura percorso<select required disabled={busy || !!pendingExit || !!editing.draft?.hole_grid} value={fields.holes_count} onChange={(event) => setFields((value) => ({ ...value, holes_count: event.target.value }))}><option value="">Seleziona 9 o 18 buche</option><option value="9">9 buche</option><option value="18">18 buche</option></select></label>
          <label>Ordine percorso<input required type="number" step={1} min={-2147483648} max={2147483647} disabled={busy || !!pendingExit} value={fields.display_order} onChange={(event) => setFields((value) => ({ ...value, display_order: event.target.value }))} /></label>
        </div>
        {error && !pendingExit && <p role="alert">{error}</p>}
        {editing.draft?.hole_grid && <p className="stablr-admin-detail-empty">Per cambiare struttura 9/18, abbandona prima la bozza buche.</p>}
        <div className="stablr-admin-editor-actions"><button className="stablr-admin-draft-save-button" type="submit" disabled={busy || !!pendingExit || !isNewCourseValid(fields)}>Salva bozza percorso</button><button className="stablr-admin-abandon-button" type="button" disabled={busy || !!pendingExit} onClick={() => leave()}>Torna al Club</button></div>
      </form>
      {!editing.isNew && <div className="stablr-admin-abandon-zone stablr-admin-editor-actions"><button className="stablr-admin-white-button" type="button" disabled={busy || !!pendingExit} onClick={() => { const course = editing.draft;leave(() => { close();setHoleTarget(course); }); }}>Configura buche</button>
        {editing.draft.hole_grid?.configured && <button className="stablr-admin-white-button" type="button" disabled={busy || !!pendingExit} onClick={() => { const course = editing.draft;leave(() => { close();setTeeTarget(course); }); }}>Gestisci tee</button>}
      </div>}
    </EditorDialog>}
    {pendingExit && <EditorDialog title="Modifiche percorso non salvate"><p>Salva la bozza del Percorso oppure scarta solo le modifiche non salvate.</p>{error && <p role="alert">{error}</p>}<div className="stablr-admin-editor-actions">
      <button className="stablr-admin-white-button" type="button" disabled={busy || !isNewCourseValid(fields)} onClick={() => operation(async () => { await save();const exit = pendingExit;setPendingExit(null);exit(); })}>Salva bozza</button>
      <button type="button" disabled={busy} onClick={() => { const exit = pendingExit;setPendingExit(null);close();exit(); }}>Scarta</button>
      <button type="button" disabled={busy} onClick={() => { setPendingExit(null);setError(""); }}>Resta</button>
    </div></EditorDialog>}
    {abandon && <EditorDialog title="Abbandona percorso"><p>Abbandonare il Percorso «{abandon.snapshot.name}»? La bozza non sarà più ripresa. Il catalogo pubblicato non cambia.</p>{error && <p role="alert">{error}</p>}<div className="stablr-admin-editor-actions"><button className="stablr-admin-danger-button" disabled={busy} type="button" onClick={() => operation(async () => { await service.abandonCourseDraft(parent, abandon, ownerId);setCourses((rows) => rows.filter((row) => row.draft_id !== abandon.draft_id));setAbandon(null); })}>Conferma abbandono percorso</button><button type="button" disabled={busy} onClick={() => { setAbandon(null);setError(""); }}>Annulla</button></div></EditorDialog>}
    {holeTarget && <NewClubCourseHoles target={holeTarget} ownerId={ownerId} service={service} registerExitGuard={registerHoleExitGuard} onBack={() => setHoleTarget(null)} onGridChange={onGridChange} scope={scope} />}
    {teeTarget && <NewClubCourseTees course={teeTarget} ownerId={ownerId} service={service} registerExitGuard={registerHoleExitGuard} onBack={() => setTeeTarget(null)} scope={scope} />}
  </section>;
}
