import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { formatCourseValue, getCourseDiff, getCourseEditorError, normalizeCourseFields } from "./course-editor-data";

export default function CourseEditor({ club, course, service, onBack, onBackToClub, onBackToCatalog, onPublished, registerExitGuard }) {
  const [draft, setDraft] = useState(null);
  const [context, setContext] = useState({});
  const [fields, setFields] = useState({ name: "", holes_count: 9, display_order: "", is_active: true });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingExit, setPendingExit] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [abandonConfirmation, setAbandonConfirmation] = useState(false);
  const inFlight = useRef(false);
  const dirty = draft && JSON.stringify(normalizeCourseFields(fields)) !== JSON.stringify(normalizeCourseFields(draft.snapshot));

  useEffect(() => {
    let active = true;
    service.openDraft(course.id).then((opened) => {
      if (active) { setDraft(opened.draft); setFields(opened.draft.snapshot); setContext(opened.context || {}); }
    }).catch((failure) => {
      console.error("Admin Percorso draft open failed", failure);
      if (active) setError(getCourseEditorError(failure));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [course.id, service]);

  useEffect(() => {
    registerExitGuard((action) => {
      if (inFlight.current || confirmation) return;
      if (dirty) setPendingExit(() => action);
      else action();
    });
    const beforeUnload = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { registerExitGuard(null); window.removeEventListener("beforeunload", beforeUnload); };
  }, [dirty, confirmation, registerExitGuard]);

  const operation = async (callback) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try { await callback(); }
    catch (failure) { console.error("Admin Percorso editor operation failed", failure); setError(getCourseEditorError(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const save = async () => {
    const saved = await service.saveDraft(draft, fields);
    setDraft(saved); setFields(saved.snapshot);
    setMessage("Bozza salvata. Il catalogo pubblicato resta invariato.");
    return saved;
  };
  const reviewPublication = () => operation(async () => {
    const saved = dirty ? await save() : draft;
    setConfirmation({ draft: saved, changes: getCourseDiff(saved.base_snapshot, saved.snapshot) });
  });
  const confirmPublication = () => operation(async () => {
    const result = await service.publishDraft(confirmation.draft);
    setConfirmation(null); onPublished(result.course);
  });
  const abandonDraft = () => operation(async () => {
    await service.abandonDraft(draft);
    setAbandonConfirmation(false);
    setDraft(null);
    registerExitGuard(null);
    onBack();
  });
  const update = (key, value) => { setFields((current) => ({ ...current, [key]: value })); setMessage(""); };
  const normalized = normalizeCourseFields(fields);
  const valid = normalized.name.length > 0 && normalized.name.length <= 200
    && [9, 18].includes(normalized.holes_count)
    && (normalized.display_order === null || (Number.isInteger(normalized.display_order)
      && normalized.display_order >= -2147483648 && normalized.display_order <= 2147483647));
  const changes = draft ? getCourseDiff(draft.base_snapshot, fields) : [];

  return <section className="stablr-admin-detail stablr-admin-course-editor">
    <nav aria-label="Percorso di navigazione" className="stablr-admin-breadcrumb">
      <button disabled={busy} onClick={onBackToCatalog} type="button">Club e percorsi</button><span>/</span>
      <button disabled={busy} onClick={onBackToClub} type="button">{club.name}</button><span>/</span>
      <button disabled={busy} onClick={onBack} type="button">{course.name}</button><span>/</span><span>Modifica dati</span>
    </nav>
    <header className="stablr-admin-page-header"><div><h1>Modifica dati percorso</h1><p>{course.name} · {club.name}</p></div>{draft && <span className="stablr-admin-status">Bozza in corso</span>}</header>
    {loading ? <p className="stablr-admin-detail-empty">Caricamento bozza…</p> : draft && <>
      <form className="stablr-admin-editor-fields" onSubmit={(event) => { event.preventDefault(); operation(save); }}>
        <label>Nome visualizzato<input disabled={busy} maxLength={200} onChange={(event) => update("name", event.target.value)} required value={fields.name} /></label>
        <label>Struttura<select disabled={busy || context.can_edit_structure !== true} onChange={(event) => update("holes_count", Number(event.target.value))} value={fields.holes_count}><option value={9}>9 buche</option><option value={18}>18 buche</option></select></label>
        <label>Ordine<input disabled={busy} max={2147483647} min={-2147483648} onChange={(event) => update("display_order", event.target.value)} step={1} type="number" value={fields.display_order ?? ""} /></label>
        <label>Stato operativo<select disabled={busy} onChange={(event) => update("is_active", event.target.value === "true")} value={String(fields.is_active)}><option value="true">Attivo</option><option value="false">Disattivato</option></select></label>
        <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !valid} type="submit">Salva bozza</button><button className="stablr-admin-white-button" disabled={busy || !valid || !changes.length} onClick={reviewPublication} type="button">Pubblica</button><button disabled={busy} onClick={() => { setError(""); setAbandonConfirmation(true); }} type="button">Abbandona bozza</button></div>
      </form>
      {context.can_edit_structure !== true && <p className="stablr-admin-detail-empty">Struttura in sola lettura: sono presenti dati di configurazione o dati collegati. Buche, tee, combinazioni e giri restano invariati.</p>}
      <div className="stablr-admin-detail-grid">
        <article><span>Nome FIG / originale · sola lettura</span><strong>{context.original_name || "—"}</strong></article>
        <article><span>Fonte · sola lettura</span><strong>{context.source_system || "—"}</strong></article>
        <article><span>Percorso GesGolf · sola lettura</span><strong>{context.gesgolf_name || "—"}</strong></article>
        <article><span>Stato esterno del club · sola lettura</span><strong>{club.dataStatus || "—"}</strong></article>
        <article><span>Matching FIG del club · sola lettura</span><strong>{club.figMatchStatus === "unmatched" ? "Da collegare" : club.figMatchStatus || "—"}</strong></article>
      </div>
      <p className="stablr-admin-detail-empty">Nome originale, alias e note non hanno campi modificabili dedicati. I collegamenti FIG/GesGolf restano in sola lettura.</p>
      {dirty && <p className="stablr-admin-detail-empty">Modifiche non salvate</p>}
    </>}
    {message && <p role="status">{message}</p>}
    {error && !confirmation && !pendingExit && !abandonConfirmation && <p className="stablr-admin-editor-error" role="alert">{error}</p>}
    {!loading && !draft && <button className="stablr-admin-white-button" onClick={onBack} type="button">Torna al percorso</button>}
    {pendingExit && <EditorDialog title="Modifiche non salvate">
      <p>Salva nella bozza oppure scarta solo le modifiche non salvate. La bozza già salvata rimane disponibile.</p>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !valid} onClick={() => operation(async () => { await save(); pendingExit(); })} type="button">Salva bozza</button><button disabled={busy} onClick={() => pendingExit()} type="button">Scarta</button><button disabled={busy} onClick={() => { setPendingExit(null); setError(""); }} type="button">Resta</button></div>
    </EditorDialog>}
    {confirmation && <EditorDialog title="Conferma pubblicazione">
      <p>Queste modifiche saranno visibili nel catalogo. Disattivare un percorso non elimina i suoi dati.</p>
      <div className="stablr-admin-editor-diff" role="table" aria-label="Differenze percorso">
        <div role="row"><strong role="columnheader">Campo</strong><strong role="columnheader">Prima</strong><strong role="columnheader">Dopo</strong></div>
        {confirmation.changes.map((change) => <div key={change.key} role="row"><span role="cell">{change.label}</span><span role="cell">{formatCourseValue(change.key, change.before)}</span><span role="cell">{formatCourseValue(change.key, change.after)}</span></div>)}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !confirmation.changes.length} onClick={confirmPublication} type="button">Conferma pubblicazione</button><button disabled={busy} onClick={() => setConfirmation(null)} type="button">Annulla</button></div>
    </EditorDialog>}
    {abandonConfirmation && <EditorDialog title="Abbandona bozza">
      <p>Abbandonare la bozza? Le modifiche non pubblicate non saranno più riprese. Il catalogo pubblicato non cambia.</p>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy} onClick={abandonDraft} type="button">Conferma abbandono</button><button disabled={busy} onClick={() => { setAbandonConfirmation(false); setError(""); }} type="button">Annulla</button></div>
    </EditorDialog>}
  </section>;
}
