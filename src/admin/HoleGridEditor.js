import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { getHoleGridDiff, getHoleGridEditorError, normalizeHoleGrid, validateHoleGrid } from "./hole-grid-editor-data";

export default function HoleGridEditor({ club, course, route, service, onBack, onBackToClub, onBackToCourse, onBackToCatalog, onPublished, registerExitGuard }) {
  const [draft, setDraft] = useState(null);
  const [context, setContext] = useState(null);
  const [fields, setFields] = useState({ holes: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingExit, setPendingExit] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [abandonConfirmation, setAbandonConfirmation] = useState(false);
  const inFlight = useRef(false);
  const dirty = draft && JSON.stringify(normalizeHoleGrid(fields)) !== JSON.stringify(normalizeHoleGrid(draft.snapshot));

  useEffect(() => {
    let active = true;
    service.openDraft(route.id).then((result) => {
      if (active) { setDraft(result.draft); setContext(result.context); setFields(result.draft.snapshot); }
    }).catch((failure) => {
      console.error("Admin hole grid open failed", failure);
      if (active) setError(getHoleGridEditorError(failure));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [route.id, service]);

  useEffect(() => {
    registerExitGuard((action) => {
      if (inFlight.current || confirmation || abandonConfirmation || pendingExit) return;
      if (dirty) setPendingExit(() => action); else action();
    });
    const beforeUnload = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { registerExitGuard(null); window.removeEventListener("beforeunload", beforeUnload); };
  }, [dirty, confirmation, abandonConfirmation, pendingExit, registerExitGuard]);

  const operation = async (callback) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try { await callback(); }
    catch (failure) { console.error("Admin hole grid operation failed", failure); setError(getHoleGridEditorError(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const save = async () => {
    const saved = await service.saveDraft(draft, fields);
    setDraft(saved); setFields(saved.snapshot); setMessage("Bozza salvata. Il catalogo pubblicato resta invariato.");
    return saved;
  };
  const reviewPublication = () => operation(async () => {
    const saved = dirty ? await save() : draft;
    setConfirmation({ draft: saved, changes: getHoleGridDiff(saved.base_snapshot, saved.snapshot) });
  });
  const update = (id, key, value) => {
    setFields((current) => ({ holes: current.holes.map((hole) => hole.id === id ? { ...hole, [key]: value } : hole) }));
    setMessage("");
  };
  const validation = validateHoleGrid(context, fields);
  const changes = draft ? getHoleGridDiff(draft.base_snapshot, fields) : [];

  return <section className="stablr-admin-detail stablr-admin-hole-grid-editor">
    <nav aria-label="Percorso di navigazione" className="stablr-admin-breadcrumb">
      <button disabled={busy} onClick={onBackToCatalog} type="button">Club e percorsi</button><span>/</span>
      <button disabled={busy} onClick={onBackToClub} type="button">{club.name}</button><span>/</span>
      {course && <><button disabled={busy} onClick={onBackToCourse} type="button">{course.name}</button><span>/</span></>}
      <button disabled={busy} onClick={onBack} type="button">{route.name}</button><span>/</span><span>Gestisci buche</span>
    </nav>
    <header className="stablr-admin-page-header stablr-admin-editor-header"><div><h1>Gestisci buche</h1><p>{route.name} · {club.name}</p></div>{draft && <div className="stablr-admin-editor-header-side"><span className="stablr-admin-status">Bozza buche in corso</span><div className="stablr-admin-editor-header-actions"><button className="stablr-admin-draft-save-button" disabled={busy || !validation.canSave} onClick={() => operation(save)} type="button">Salva bozza</button><button className="stablr-admin-publish-button" disabled={busy || !validation.canPublish || !changes.length} onClick={reviewPublication} type="button">Pubblica</button></div></div>}</header>
    {loading ? <p className="stablr-admin-detail-empty">Caricamento bozza…</p> : draft && <>
      <div className="stablr-admin-detail-grid">
        <article><span>Buche presenti / previste</span><strong>{fields.holes.length} / {context.route.holes_count}</strong></article>
        <article><span>Totale Par bozza / catalogo</span><strong>{validation.totalPar} / {context.route.total_par ?? "—"}</strong></article>
        <article><span>SI/HCP duplicati</span><strong>{validation.duplicateSi}</strong></article>
        <article><span>SI/HCP mancanti</span><strong>{validation.missingSi.length ? validation.missingSi.join(", ") : "Nessuno"}</strong></article>
        <article><span>Fonte combinazione · sola lettura</span><strong>{context.route.source_system || "—"}</strong></article>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); operation(save); }}>
        <div className="stablr-admin-hole-grid-scroll"><table className="stablr-admin-hole-grid-table" aria-label="Griglia buche">
          <thead><tr><th scope="col">Numero / ordine</th><th scope="col">Percorso origine</th><th scope="col">Buca origine</th><th scope="col">Par</th><th scope="col">SI/HCP</th><th scope="col">SI origine</th><th scope="col">Etichetta origine</th></tr></thead>
          <tbody>{fields.holes.map((hole) => {
            const live = context.holes.find((item) => item.id === hole.id) || {};
            return <tr key={hole.id}><td>{hole.round_hole_number}</td><td>{context.origins.find((origin) => origin.position === live.route_position)?.name || "—"}</td><td>{live.physical_hole_number ?? "—"}</td>
              <td><input aria-label={`Par buca ${hole.round_hole_number}`} disabled={busy || service.parWorkflow} type="number" min="3" max="6" step="1" value={hole.par ?? ""} onChange={(event) => update(hole.id, "par", event.target.value)} /></td>
              <td><input aria-label={`SI/HCP buca ${hole.round_hole_number}`} disabled={busy} type="number" min="1" max="18" step="1" value={hole.stroke_index ?? ""} onChange={(event) => update(hole.id, "stroke_index", event.target.value)} /></td>
              <td>{live.source_stroke_index ?? "—"}</td><td>{live.display_label || "—"}</td></tr>;
          })}</tbody>
        </table></div>
        {!fields.holes.length && <p className="stablr-admin-detail-empty">Nessuna buca esistente disponibile. La creazione di buche non è prevista in questo editor.</p>}
        <p className="stablr-admin-detail-empty">Numero/ordine e collegamenti origine sono in sola lettura. È disponibile un unico SI/HCP, senza campi distinti uomini/donne. Fonte, note, Tee e rating non sono modificabili.</p>
        {service.parWorkflow && <p>Per modificare il Par usa Avanzata → Struttura e collegamenti → Workflow Par. Qui resta disponibile la modifica SI/HCP; un Par ereditato richiede il padre fisico oppure un override locale esplicito.</p>}
      </form>
      {validation.alerts.length > 0 && <div className="stablr-admin-editor-error" role="status">{validation.alerts.map((alert) => <p key={alert}>{alert}</p>)}</div>}
      {context.route.notes && <section className="stablr-admin-detail-section"><h2>Note combinazione · sola lettura</h2><p className="stablr-admin-detail-empty">{context.route.notes}</p></section>}
      {dirty && <p className="stablr-admin-detail-empty">Modifiche non salvate</p>}
      <div className="stablr-admin-abandon-zone"><button className="stablr-admin-abandon-button" disabled={busy} onClick={() => { setError(""); setAbandonConfirmation(true); }} type="button">Abbandona bozza</button></div>
    </>}
    {message && <p role="status">{message}</p>}
    {error && !confirmation && !pendingExit && !abandonConfirmation && <p className="stablr-admin-editor-error" role="alert">{error}</p>}
    {!loading && !draft && <button className="stablr-admin-white-button" onClick={onBack} type="button">Torna alla Route</button>}
    {pendingExit && <EditorDialog title="Modifiche non salvate">
      <p>Salva nella bozza oppure scarta solo le modifiche non salvate. La bozza già salvata rimane disponibile.</p>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !validation.canSave} onClick={() => operation(async () => { await save(); pendingExit(); })} type="button">Salva bozza</button><button disabled={busy} onClick={() => pendingExit()} type="button">Scarta</button><button disabled={busy} onClick={() => { setPendingExit(null); setError(""); }} type="button">Resta</button></div>
    </EditorDialog>}
    {confirmation && <EditorDialog title="Conferma pubblicazione">
      <p>La griglia delle buche sarà pubblicata in un’unica operazione.</p>
      <div className="stablr-admin-editor-diff" role="table" aria-label="Differenze buche">
        <div role="row"><strong role="columnheader">Campo</strong><strong role="columnheader">Prima</strong><strong role="columnheader">Dopo</strong></div>
        {confirmation.changes.map((change) => <div key={change.key} role="row"><span role="cell">{change.label}</span><span role="cell">{change.before ?? "—"}</span><span role="cell">{change.after ?? "—"}</span></div>)}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !confirmation.changes.length} onClick={() => operation(async () => { const result = await service.publishDraft(confirmation.draft); setConfirmation(null); onPublished(result); })} type="button">Conferma pubblicazione</button><button disabled={busy} onClick={() => setConfirmation(null)} type="button">Annulla</button></div>
    </EditorDialog>}
    {abandonConfirmation && <EditorDialog title="Abbandona bozza">
      <p>Abbandonare la bozza? Le modifiche non pubblicate non saranno più riprese. Il catalogo pubblicato non cambia.</p>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy} onClick={() => operation(async () => { await service.abandonDraft(draft); setAbandonConfirmation(false); setDraft(null); registerExitGuard(null); onBack(); })} type="button">Conferma abbandono</button><button disabled={busy} onClick={() => { setAbandonConfirmation(false); setError(""); }} type="button">Annulla</button></div>
    </EditorDialog>}
  </section>;
}
