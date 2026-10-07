import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { getCourseHoleGridDiff, getCourseHoleGridError, normalizeCourseHoleGrid, validateCourseHoleGrid } from "./course-hole-grid-editor-data";

export default function CourseHoleGridEditor({ club, course, service, onBack, onBackToClub, onBackToCatalog, onPublished, registerExitGuard }) {
  const [draft,setDraft] = useState(null);
  const [context,setContext] = useState(null);
  const [fields,setFields] = useState({ holes: [] });
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [pendingExit,setPendingExit] = useState(null);
  const [confirmation,setConfirmation] = useState(null);
  const [abandonConfirmation,setAbandonConfirmation] = useState(false);
  const [retry,setRetry] = useState(0);
  const inFlight = useRef(false);
  const dirty = draft && JSON.stringify(normalizeCourseHoleGrid(fields)) !== JSON.stringify(normalizeCourseHoleGrid(draft.snapshot));

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    service.openDraft(course.id).then((result) => {
      if (active) { setDraft(result.draft); setContext(result.context); setFields(result.draft.snapshot); }
    }).catch((failure) => {
      console.error("Admin physical hole grid open failed",failure);
      if (active) setError(getCourseHoleGridError(failure));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  },[course.id,service,retry]);

  useEffect(() => {
    registerExitGuard((action) => {
      if (inFlight.current || confirmation || abandonConfirmation || pendingExit) return;
      if (dirty) setPendingExit(() => action); else action();
    });
    const beforeUnload = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload",beforeUnload);
    return () => { registerExitGuard(null); window.removeEventListener("beforeunload",beforeUnload); };
  },[dirty,confirmation,abandonConfirmation,pendingExit,registerExitGuard]);

  const operation = async (callback) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try { await callback(); }
    catch (failure) { console.error("Admin physical hole grid operation failed",failure); setError(getCourseHoleGridError(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const save = async () => {
    const saved = await service.saveDraft(draft,fields);
    setDraft(saved); setFields(saved.snapshot); setMessage("Bozza salvata. Il catalogo pubblicato resta invariato.");
    return saved;
  };
  const reviewPublication = () => operation(async () => {
    const saved = dirty ? await save() : draft;
    setConfirmation({ draft: saved, changes: getCourseHoleGridDiff(saved.base_snapshot,saved.snapshot) });
  });
  const update = (id,key,value) => {
    setFields((current) => ({ holes: current.holes.map((h) => h.id === id ? { ...h,[key]: value } : h) }));
    setMessage("");
  };
  const validation = validateCourseHoleGrid(context,fields);
  const changes = draft ? getCourseHoleGridDiff(draft.base_snapshot,fields) : [];

  return <section className="stablr-admin-detail stablr-admin-course-hole-grid-editor">
    <nav aria-label="Percorso di navigazione" className="stablr-admin-breadcrumb">
      <button disabled={busy} onClick={onBackToCatalog} type="button">Club e percorsi</button><span>/</span>
      <button disabled={busy} onClick={onBackToClub} type="button">{club.name}</button><span>/</span>
      <button disabled={busy} onClick={onBack} type="button">{course.name}</button><span>/</span><span>Modifica buche</span>
    </nav>
    <header className="stablr-admin-page-header"><div><h1>Modifica buche del Percorso</h1><p>{course.name} · {club.name}</p></div>{draft && <span className="stablr-admin-status">Bozza buche in corso</span>}</header>
    {loading ? <p className="stablr-admin-detail-empty">Caricamento bozza…</p> : draft && <>
      <div className="stablr-admin-detail-grid">
        <article><span>Buche presenti / previste</span><strong>{fields.holes.length} / {context.course.holes_count}</strong></article>
        <article><span>Totale Par bozza / catalogo</span><strong>{validation.totalPar} / {context.course.total_par ?? "—"}</strong></article>
        <article><span>SI/HCP duplicati</span><strong>{validation.duplicateSi}</strong></article>
        <article><span>SI/HCP mancanti</span><strong>{validation.missingSi.length ? validation.missingSi.join(", ") : "Nessuno"}</strong></article>
        <article><span>Sequenza SI/HCP prevista</span><strong>{context.si_sequence.join(", ")}</strong></article>
        <article><span>Fonte Percorso · sola lettura</span><strong>{context.course.source_system || "—"}</strong></article>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); operation(save); }}>
        <div className="stablr-admin-hole-grid-scroll"><table className="stablr-admin-hole-grid-table stablr-admin-course-hole-grid-table" aria-label="Griglia buche del Percorso">
          <thead><tr><th scope="col">Numero / ordine</th><th scope="col">Par</th><th scope="col">SI/HCP</th><th scope="col">Etichetta · sola lettura</th></tr></thead>
          <tbody>{fields.holes.map((hole) => <tr key={hole.id}><td>{hole.physical_hole_number}</td>
            <td><input aria-label={`Par buca ${hole.physical_hole_number}`} disabled={busy} type="number" min="3" max="6" step="1" value={hole.par ?? ""} onChange={(event) => update(hole.id,"par",event.target.value)} /></td>
            <td><input aria-label={`SI/HCP buca ${hole.physical_hole_number}`} disabled={busy} type="number" min="1" max="18" step="1" value={hole.stroke_index ?? ""} onChange={(event) => update(hole.id,"stroke_index",event.target.value)} /></td>
            <td>{context.holes.find((item) => item.id === hole.id)?.display_label || "—"}</td></tr>)}</tbody>
        </table></div>
        {!fields.holes.length && <p className="stablr-admin-detail-empty">Nessuna buca fisica disponibile.</p>}
        <p className="stablr-admin-detail-empty">Numero e ordine sono in sola lettura. È disponibile un unico SI/HCP. La sequenza prevista conserva i valori reali del Percorso; se incompleti, richiede da 1 al numero di buche. Fonte, etichette, Tee e rating restano in sola lettura.</p>
        <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !validation.canSave} type="submit">Salva bozza</button><button className="stablr-admin-white-button" disabled={busy || !validation.canPublish || !changes.length} onClick={reviewPublication} type="button">Pubblica</button><button disabled={busy} onClick={() => { setError(""); setAbandonConfirmation(true); }} type="button">Abbandona bozza</button></div>
      </form>
      {validation.alerts.length > 0 && <div className="stablr-admin-editor-error" role="status">{validation.alerts.map((alert) => <p key={alert}>{alert}</p>)}</div>}
      {dirty && <p className="stablr-admin-detail-empty">Modifiche non salvate</p>}
    </>}
    {message && <p role="status">{message}</p>}
    {error && !confirmation && !pendingExit && !abandonConfirmation && <p className="stablr-admin-editor-error" role="alert">{error}</p>}
    {!loading && !draft && <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" onClick={() => setRetry((value) => value+1)} type="button">Riprova</button><button onClick={onBack} type="button">Torna al Percorso</button></div>}
    {pendingExit && <EditorDialog title="Modifiche non salvate"><p>Salva nella bozza oppure scarta solo le modifiche non salvate. La bozza già salvata rimane disponibile.</p>{error && <p role="alert">{error}</p>}<div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !validation.canSave} onClick={() => operation(async () => { await save(); pendingExit(); })} type="button">Salva bozza</button><button disabled={busy} onClick={() => pendingExit()} type="button">Scarta</button><button disabled={busy} onClick={() => { setPendingExit(null); setError(""); }} type="button">Resta</button></div></EditorDialog>}
    {confirmation && <EditorDialog title="Conferma pubblicazione"><p>Le buche di questo Percorso saranno pubblicate in un’unica operazione.</p>
      <div className="stablr-admin-editor-diff" role="table" aria-label="Differenze buche del Percorso"><div role="row"><strong role="columnheader">Campo</strong><strong role="columnheader">Prima</strong><strong role="columnheader">Dopo</strong></div>{confirmation.changes.map((change) => <div key={change.key} role="row"><span role="cell">{change.label}</span><span role="cell">{change.before ?? "—"}</span><span role="cell">{change.after ?? "—"}</span></div>)}</div>
      {error && <p role="alert">{error}</p>}<div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !confirmation.changes.length} onClick={() => operation(async () => { const result = await service.publishDraft(confirmation.draft); setConfirmation(null); onPublished(result); })} type="button">Conferma pubblicazione</button><button disabled={busy} onClick={() => setConfirmation(null)} type="button">Annulla</button></div>
    </EditorDialog>}
    {abandonConfirmation && <EditorDialog title="Abbandona bozza"><p>Abbandonare la bozza? Le modifiche non pubblicate non saranno più riprese. Il catalogo pubblicato non cambia.</p>{error && <p role="alert">{error}</p>}<div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy} onClick={() => operation(async () => { await service.abandonDraft(draft); setAbandonConfirmation(false); setDraft(null); registerExitGuard(null); onBack(); })} type="button">Conferma abbandono</button><button disabled={busy} onClick={() => { setAbandonConfirmation(false); setError(""); }} type="button">Annulla</button></div></EditorDialog>}
  </section>;
}
