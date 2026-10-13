import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { hasDuplicateNewTee, isNewTeeValid, normalizeNewTeeFields, ratingCategoryLabel } from "./new-club-tees-data";

const initialFields = order => ({ name: "", tee_color: "", rating_category: "unspecified", course_rating: "", slope_rating: "", is_active: true, display_order: order });
const failureMessage = failure => failure?.code === "23505" ? "Un tee con questo nome e categoria esiste già in questo Percorso."
  : ["40001", "55P03"].includes(failure?.code) ? "La bozza o le buche sono cambiate. Torna al Percorso e riapri i tee prima di salvare."
    : failure?.code === "42501" ? "Non sei autorizzato a gestire questi tee."
      : "Impossibile completare l’operazione sui tee. Riprova.";

export default function NewClubCourseTees({ course, ownerId, service, registerExitGuard, onBack }) {
  const [context, setContext] = useState(null), [tees, setTees] = useState([]), [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null), [fields, setFields] = useState(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [loadError, setLoadError] = useState(""), [retry, setRetry] = useState(0);
  const [pendingExit, setPendingExit] = useState(null), [abandon, setAbandon] = useState(null);
  const inFlight = useRef(false);
  const dirty = !!editing && (editing.isNew || JSON.stringify(normalizeNewTeeFields(fields)) !== JSON.stringify(normalizeNewTeeFields(editing.draft.snapshot)));
  const duplicate = !!fields && hasDuplicateNewTee(tees, fields, editing?.draft?.draft_id);
  const valid = !!fields && isNewTeeValid(fields) && !duplicate && context?.configured;
  useEffect(() => {
    let active = true;setLoading(true);setLoadError("");
    service.listCourseTeeDrafts(course, ownerId).then(result => { if (active) { setContext(result.context);setTees(result.tees); } })
      .catch(failure => { console.error("Admin private tees read failed", failure?.code || "request_failed");if (active) setLoadError("Impossibile caricare i tee privati."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [course, ownerId, service, retry]);
  const closeEditor = () => { setEditing(null);setFields(null);setError(""); };
  useEffect(() => {
    registerExitGuard(action => {
      if (inFlight.current || loading || pendingExit || abandon) return;
      if (dirty) setPendingExit(() => action);else { closeEditor();action(); }
    });
    const beforeUnload = event => { if (dirty) { event.preventDefault();event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { registerExitGuard(null);window.removeEventListener("beforeunload", beforeUnload); };
  }, [dirty, loading, pendingExit, abandon, registerExitGuard]);
  const operation = async action => {
    if (inFlight.current) return;
    inFlight.current = true;setBusy(true);setError("");
    try { await action(); } catch (failure) { console.error("Admin private tee operation failed", failure?.code || "request_failed");setError(failureMessage(failure)); }
    finally { inFlight.current = false;setBusy(false); }
  };
  const save = async () => {
    const saved = await service.saveCourseTeeDraft(course, context, editing.draft, fields, ownerId);
    setTees(rows => [...rows.filter(row => row.draft_id !== saved.draft_id), saved]);closeEditor();
  };
  const leave = action => { if (dirty) setPendingExit(() => action);else { closeEditor();action(); } };
  const update = (key, value) => { setError("");setFields(previous => ({ ...previous, [key]: value })); };
  const blocked = busy || !!pendingExit || !!abandon;
  return <>
    <EditorDialog title={`Tee e rating · ${context?.course_name || course.snapshot.name}`}>
      <p>Tee privati del Percorso. Club, buche e tee restano privati e non pubblicabili.</p>
      {loading && <p role="status">Caricamento tee…</p>}
      {loadError && <div role="alert"><p>{loadError}</p><button className="stablr-admin-abandon-button" type="button" onClick={() => setRetry(value => value + 1)}>Riprova tee</button></div>}
      {error && !editing && !pendingExit && !abandon && <p role="alert">{error}</p>}
      {context && !loading && !loadError && <>
        <p className="stablr-admin-new-holes-summary">{context.holes_count} buche · <strong>Totale Par: {context.par_total ?? "—"}</strong> · dalla griglia buche privata</p>
        {!context.configured && <p role="alert">Completa e salva una griglia buche valida prima di creare o salvare tee. I tee già salvati restano privati.</p>}
        <button className="stablr-admin-white-button" type="button" disabled={blocked || !!editing || !context.configured} onClick={() => { setEditing({ isNew: true, draft: null });setFields(initialFields(tees.length ? Math.min(2147483647, Math.max(...tees.map(tee => tee.snapshot.display_order)) + 1) : 0));setError(""); }}>Aggiungi tee</button>
        {!tees.length && <p className="stablr-admin-detail-empty">Nessun tee privato.</p>}
        {!!tees.length && <div className="stablr-admin-new-tees-scroll"><table className="stablr-admin-new-tees-table"><thead><tr><th>Nome</th><th>Colore</th><th>Categoria</th><th>CR</th><th>Slope</th><th>Ordine</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>
          {[...tees].sort((a, b) => a.snapshot.display_order - b.snapshot.display_order || a.snapshot.name.localeCompare(b.snapshot.name)).map(tee => <tr key={tee.draft_id}>
            <th scope="row">{tee.snapshot.name}</th><td>{tee.snapshot.tee_color || "—"}</td><td>{ratingCategoryLabel(tee.snapshot.rating_category)}</td><td>{tee.snapshot.course_rating ?? "—"}</td><td>{tee.snapshot.slope_rating ?? "—"}</td><td>{tee.snapshot.display_order}</td><td>{tee.snapshot.is_active ? "Attivo" : "Disattivato"}</td>
            <td><div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" type="button" disabled={blocked || !!editing} aria-label={`Modifica tee ${tee.snapshot.name} ${ratingCategoryLabel(tee.snapshot.rating_category)}`} onClick={() => { setEditing({ isNew: false, draft: tee });setFields({ ...tee.snapshot });setError(""); }}>Modifica dati</button><button className="stablr-admin-abandon-button" type="button" disabled={blocked || !!editing} aria-label={`Abbandona tee ${tee.snapshot.name} ${ratingCategoryLabel(tee.snapshot.rating_category)}`} onClick={() => setAbandon(tee)}>Abbandona tee</button></div></td>
          </tr>)}
        </tbody></table></div>}
      </>}
      <button className="stablr-admin-abandon-button stablr-admin-new-holes-return-button" type="button" disabled={loading || blocked} onClick={() => leave(onBack)}>Torna al Percorso</button>
    </EditorDialog>
    {editing && <EditorDialog title={editing.isNew ? "Aggiungi tee privato" : "Modifica tee privato"}>
      <p>Ambito: {context.holes_count} buche · Totale Par: {context.par_total ?? "—"} · sola lettura dalla griglia privata</p>
      <form onSubmit={event => { event.preventDefault();if (valid && !blocked) operation(save); }}>
        <div className="stablr-admin-editor-fields">
          <label>Nome tee<input required maxLength={200} disabled={blocked} value={fields.name} onChange={event => update("name", event.target.value)} /></label>
          <label>Colore tee<input maxLength={100} disabled={blocked} value={fields.tee_color || ""} onChange={event => update("tee_color", event.target.value)} /></label>
          <label>Categoria del rating<select disabled={blocked} value={fields.rating_category} onChange={event => update("rating_category", event.target.value)}><option value="unspecified">Non specificata</option><option value="men">Uomini</option><option value="women">Donne</option></select></label>
          <label>Course Rating<input type="number" step="any" disabled={blocked} value={fields.course_rating ?? ""} onChange={event => update("course_rating", event.target.value)} /></label>
          <label>Slope Rating<input type="number" min={55} max={155} step={1} disabled={blocked} value={fields.slope_rating ?? ""} onChange={event => update("slope_rating", event.target.value)} /></label>
          <label>Ordine tee<input required type="number" min={-2147483648} max={2147483647} step={1} disabled={blocked} value={fields.display_order} onChange={event => update("display_order", event.target.value)} /></label>
          <label>Stato operativo<select disabled={blocked} value={fields.is_active ? "active" : "inactive"} onChange={event => update("is_active", event.target.value === "active")}><option value="active">Attivo</option><option value="inactive">Disattivato</option></select></label>
        </div>
        {duplicate && <p role="alert">Un tee con questo nome e categoria esiste già in questo ambito.</p>}
        {fields.slope_rating !== "" && fields.slope_rating != null && !(Number.isInteger(Number(fields.slope_rating)) && Number(fields.slope_rating) >= 55 && Number(fields.slope_rating) <= 155) && <p role="alert">Slope Rating deve essere un intero da 55 a 155.</p>}
        {(fields.course_rating == null || fields.course_rating === "" || fields.slope_rating == null || fields.slope_rating === "") && <p className="stablr-admin-detail-empty">I rating mancanti possono restare nella bozza privata. Il tee non è ancora completo.</p>}
        {error && !pendingExit && !abandon && <p role="alert">{error}</p>}
        <div className="stablr-admin-editor-actions stablr-admin-new-holes-dialog-actions"><button className="stablr-admin-draft-save-button" type="submit" disabled={blocked || !valid}>Salva bozza tee</button><button className="stablr-admin-abandon-button" type="button" disabled={blocked} onClick={() => leave(closeEditor)}>Torna ai tee</button></div>
      </form>
      {!editing.isNew && <div className="stablr-admin-abandon-zone"><button className="stablr-admin-abandon-button" type="button" disabled={blocked} onClick={() => setAbandon(editing.draft)}>Abbandona bozza tee</button></div>}
    </EditorDialog>}
    {pendingExit && <EditorDialog title="Modifiche tee non salvate"><p>Salva la bozza oppure scarta solo le modifiche non salvate. Il tee già salvato rimane disponibile.</p>{error && <p role="alert">{error}</p>}<div className="stablr-admin-editor-actions stablr-admin-new-holes-dialog-actions">
      <button className="stablr-admin-white-button" type="button" disabled={busy || !valid} onClick={() => operation(async () => { await save();const exit = pendingExit;setPendingExit(null);exit(); })}>Salva bozza</button>
      <button type="button" disabled={busy} onClick={() => { const exit = pendingExit;setPendingExit(null);closeEditor();exit(); }}>Scarta modifiche</button>
      <button type="button" disabled={busy} onClick={() => { setPendingExit(null);setError(""); }}>Resta</button>
    </div></EditorDialog>}
    {abandon && <EditorDialog title="Abbandona tee privato"><p>Abbandonare il tee «{abandon.snapshot.name}»? La sola bozza tee viene archiviata e non sarà più ripresa. Club, Percorso e buche restano privati.</p>{error && <p role="alert">{error}</p>}<div className="stablr-admin-editor-actions stablr-admin-new-holes-dialog-actions"><button className="stablr-admin-danger-button" type="button" disabled={busy} onClick={() => operation(async () => { await service.abandonCourseTeeDraft(course, abandon, ownerId);setTees(rows => rows.filter(row => row.draft_id !== abandon.draft_id));if (editing?.draft?.draft_id === abandon.draft_id) closeEditor();setAbandon(null); })}>Conferma abbandono tee</button><button type="button" disabled={busy} onClick={() => { setAbandon(null);setError(""); }}>Annulla</button></div></EditorDialog>}
  </>;
}
