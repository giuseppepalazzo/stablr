import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { courseTeeColor, courseTeeDiff, courseTeeError, formatCourseTeeValue, normalizeCourseTeeFields, validCourseTeeFields } from "./course-tee-editor-data";

export function CourseTeeFacts({ tee }) {
  const facts = [["Nome", tee.tee_name], ["Colore", tee.tee_color], ["Applicabilità", tee.gender],
    ["Ambito effettivo", tee.effective_holes_count ? `${tee.effective_holes_count} buche${tee.holes_count == null ? " · dal Percorso" : ""}` : null],
    ["CR", tee.course_rating], ["Slope", tee.slope_rating], ["Stato operativo", formatCourseTeeValue("is_active", tee.is_active)]];
  return <dl className="stablr-admin-tee-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>)}</dl>;
}

function useCourseTees(courseId, service) {
  const [result, setResult] = useState(null), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    service.listTees(courseId).then((data) => { if (active) setResult(data); }).catch((failure) => {
      console.error("Admin course tee list failed", failure); if (active) setError(true);
    });
    return () => { active = false; };
  }, [courseId, service, retry]);
  return { result, setResult, error, retry: () => setRetry((value) => value + 1) };
}
function TeeList({ tees, onOpen }) {
  if (!tees.length) return <p className="stablr-admin-detail-empty">Nessun tee disponibile per questo Percorso.</p>;
  return <div className="stablr-admin-tee-list">
    <div className="stablr-admin-tee-columns" aria-hidden="true"><span>Tee</span><span>Applicabilità</span><span>Ambito effettivo</span><span>CR</span><span>Slope</span><span>Stato</span><span /></div>
    {tees.map((tee) => {
      const Row = onOpen ? "button" : "div";
      return <Row className="stablr-admin-tee-row" key={tee.id} {...(onOpen ? { type: "button", onClick: () => onOpen(tee),
        "aria-label": `Apri tee ${tee.tee_name} · ${tee.effective_holes_count ? `${tee.effective_holes_count} buche` : "ambito non disponibile"}${tee.gender ? ` · ${tee.gender}` : ""}` } : {})}>
        <span className="stablr-admin-tee-name"><span className="stablr-admin-tee-dot" aria-hidden="true" title={`Colore: ${tee.tee_color || "non disponibile"}`} style={{ backgroundColor: courseTeeColor(tee.tee_color) }} /><span>{tee.tee_name}</span></span>
        <span>{tee.gender ?? "—"}</span><span>{tee.effective_holes_count ? `${tee.effective_holes_count} buche${tee.holes_count == null ? " · dal Percorso" : ""}` : "—"}</span>
        <span>{tee.course_rating ?? "—"}</span><span>{tee.slope_rating ?? "—"}</span>
        <span className="stablr-admin-tee-state"><span className="stablr-admin-status">{formatCourseTeeValue("is_active", tee.is_active)}</span>{tee.has_draft_changes && <span className="stablr-admin-status">Bozza in corso</span>}</span>
        <span aria-hidden="true">{onOpen ? "›" : ""}</span>
      </Row>;
    })}
  </div>;
}
function ListState({ state, children }) {
  if (state.error) return <div role="alert"><p>Impossibile caricare i tee del Percorso.</p><button className="stablr-admin-white-button" onClick={state.retry} type="button">Riprova</button></div>;
  if (!state.result) return <p role="status">Caricamento tee e rating…</p>;
  return children;
}
export function CourseTeeSection({ course, service, onManage, disabled }) {
  const state = useCourseTees(course.id, service);
  return <section className="stablr-admin-detail-section"><h2>Tee e rating</h2>
    <ListState state={state}>{state.result && <TeeList tees={state.result.tees} />}</ListState>
    <div className="stablr-admin-child-editor-action"><button className="stablr-admin-white-button" disabled={disabled} onClick={onManage} type="button">Gestisci tee</button></div>
  </section>;
}
export function CourseTeeEntry({ onManage, disabled }) {
  return <section className="stablr-admin-detail-section stablr-admin-course-child-entry"><h2>Tee e rating</h2>
    <button className="stablr-admin-white-button" disabled={disabled} onClick={onManage} type="button">Gestisci tee</button>
  </section>;
}
export function CourseHolesEntry({ onManage, disabled }) {
  return <section className="stablr-admin-detail-section stablr-admin-course-child-entry"><h2>Buche</h2>
    <button className="stablr-admin-white-button" disabled={disabled} onClick={onManage} type="button">Modifica buche</button>
  </section>;
}

export function CourseTeeManager({ club, course, service, onBack, onBackToClub, onBackToCatalog, navigate, registerExitGuard }) {
  const state = useCourseTees(course.id, service);
  const [selected, setSelected] = useState(null), [editing, setEditing] = useState(false);
  const tees = state.result?.tees || [];
  const backToList = () => navigate(() => { setSelected(null); setEditing(false); state.retry(); });
  if (editing) return <CourseTeeEditor key={selected.id} club={club} course={course} tee={selected} service={service}
    onBack={() => navigate(() => { setEditing(false); state.retry(); })}
    onBackToList={backToList} onBackToCourse={onBack} onBackToClub={onBackToClub} onBackToCatalog={onBackToCatalog}
    registerExitGuard={registerExitGuard} onPublished={(result) => {
      const tee = { ...result.context.tee, has_draft_changes: false };
      state.setResult((current) => ({ ...current, tees: current.tees.map((row) => row.id === tee.id ? tee : row) })); setSelected(tee); setEditing(false); state.retry();
    }} />;
  return <section className="stablr-admin-detail">
    <nav aria-label="Percorso di navigazione" className="stablr-admin-breadcrumb">
      <button onClick={onBackToCatalog} type="button">Club e percorsi</button><span>/</span><button onClick={onBackToClub} type="button">{club.name}</button><span>/</span>
      <button onClick={onBack} type="button">{course.name}</button><span>/</span>{selected ? <><button onClick={backToList} type="button">Tee e rating</button><span>/</span><span>{selected.tee_name}</span></> : <span>Tee e rating</span>}
    </nav>
    <header className="stablr-admin-page-header"><div><h1 className={selected ? "stablr-admin-tee-detail-title" : undefined}>{selected && <span className="stablr-admin-tee-dot" aria-hidden="true" style={{ backgroundColor: courseTeeColor(selected.tee_color) }} />}{selected ? selected.tee_name : "Tee e rating"}</h1><p>{course.name} · {club.name}</p></div></header>
    {selected ? <>
      <button className="stablr-admin-white-button" onClick={() => setEditing(true)} type="button">Modifica dati</button>
      <CourseTeeFacts tee={selected} />
      <p className="stablr-admin-detail-empty">Nome, colore, applicabilità, ambito, Par, fonti e distanze sono in sola lettura.</p>
    </> : <ListState state={state}><TeeList tees={tees} onOpen={setSelected} /></ListState>}
  </section>;
}

export default function CourseTeeEditor({ club, course, tee, service, onBack, onBackToList, onBackToCourse, onBackToClub, onBackToCatalog, onPublished, registerExitGuard }) {
  const [draft, setDraft] = useState(null), [context, setContext] = useState(null), [fields, setFields] = useState({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [pendingExit, setPendingExit] = useState(null), [confirmation, setConfirmation] = useState(null), [abandon, setAbandon] = useState(false);
  const inFlight = useRef(false);
  const opening = useRef(null);
  const dirty = draft && courseTeeDiff(draft.snapshot, fields).length > 0;
  const valid = validCourseTeeFields(fields);
  const changes = draft ? courseTeeDiff(draft.base_snapshot, fields) : [];
  useEffect(() => {
    let active = true;
    // StrictMode replays this effect at mount. Reuse this mount's request rather
    // than racing two open RPCs for the same NOWAIT row lock. A real remount or
    // different target still opens/resumes afresh; no draft/base is cached globally.
    if (opening.current?.teeId !== tee.id || opening.current?.service !== service) {
      opening.current = { teeId: tee.id, service, request: service.openDraft(tee.id) };
    }
    opening.current.request.then((opened) => { if (active) { setDraft(opened.draft); setFields(opened.draft.snapshot); setContext(opened.context); } })
      .catch((failure) => { console.error("Admin tee draft open failed", failure); if (active) setError(courseTeeError(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tee.id, service]);
  useEffect(() => {
    registerExitGuard((action) => { if (inFlight.current || pendingExit || confirmation || abandon) return; if (dirty) setPendingExit(() => action); else action(); });
    const unload = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => { registerExitGuard(null); window.removeEventListener("beforeunload", unload); };
  }, [dirty, pendingExit, confirmation, abandon, registerExitGuard]);
  const operation = async (callback) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try { await callback(); } catch (failure) { console.error("Admin tee operation failed", failure); setError(courseTeeError(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const save = async () => {
    const saved = await service.saveDraft(draft, normalizeCourseTeeFields(fields));
    setDraft(saved); setFields(saved.snapshot); setMessage("Bozza salvata. Il catalogo pubblicato resta invariato."); return saved;
  };
  const update = (key, value) => { setFields((current) => ({ ...current, [key]: value })); setMessage(""); };
  const live = context?.tee || tee;
  const readonly = [["Nome", live.tee_name], ["Colore", live.tee_color], ["Applicabilità", live.gender],
    ["Ambito effettivo", live.effective_holes_count ? `${live.effective_holes_count} buche${live.holes_count == null ? " · dal Percorso" : ""}` : null],
    ["Par totale", live.par_total], ["Fonte", live.source_system], ["Riferimento fonte", live.source_external_id], ["Rating stimato", live.estimated === true ? "Sì" : "No"]];
  return <section className="stablr-admin-detail">
    <nav aria-label="Percorso di navigazione" className="stablr-admin-breadcrumb">
      <button disabled={busy} onClick={onBackToCatalog} type="button">Club e percorsi</button><span>/</span><button disabled={busy} onClick={onBackToClub} type="button">{club.name}</button><span>/</span>
      <button disabled={busy} onClick={onBackToCourse} type="button">{course.name}</button><span>/</span><button disabled={busy} onClick={onBackToList} type="button">Tee e rating</button><span>/</span><button disabled={busy} onClick={onBack} type="button">{tee.tee_name}</button><span>/</span><span>Modifica dati</span>
    </nav>
    <header className="stablr-admin-page-header stablr-admin-editor-header"><div><h1>Modifica dati tee</h1><p>{tee.tee_name} · {course.name}</p></div>{draft && <div className="stablr-admin-editor-header-side">
      {courseTeeDiff(live, draft.snapshot).length > 0 && <span className="stablr-admin-status">Bozza in corso</span>}
      <div className="stablr-admin-editor-header-actions"><button className="stablr-admin-draft-save-button" disabled={busy || !valid} onClick={() => operation(save)} type="button">Salva bozza</button>
        <button className="stablr-admin-publish-button" disabled={busy || !valid || !changes.length} onClick={() => operation(async () => { const saved = dirty ? await save() : draft; setConfirmation({ draft: saved, changes: courseTeeDiff(saved.base_snapshot, saved.snapshot) }); })} type="button">Pubblica</button></div>
    </div>}</header>
    {loading ? <p role="status">Caricamento bozza…</p> : draft && <>
      <form className="stablr-admin-editor-fields" onSubmit={(event) => { event.preventDefault(); if (valid) operation(save); }}>
        <label>CR<input disabled={busy} type="number" step="any" value={fields.course_rating ?? ""} onChange={(event) => update("course_rating", event.target.value)} /></label>
        <label>Slope<input disabled={busy} type="number" step={1} min={55} max={155} value={fields.slope_rating ?? ""} onChange={(event) => update("slope_rating", event.target.value)} /></label>
        <label>Stato operativo<select disabled={busy} value={String(fields.is_active)} onChange={(event) => update("is_active", event.target.value === "true")}><option value="true">Attivo</option><option value="false">Disattivato</option></select></label>
      </form>
      <p className="stablr-admin-detail-empty">CR e Slope possono essere assenti. Un tee storico incompleto può essere disattivato senza aggiungere rating.</p>
      <div className="stablr-admin-detail-grid">{readonly.map(([label, value]) => <article key={label}><span>{label} · sola lettura</span><strong>{value ?? "—"}</strong></article>)}</div>
      <p className="stablr-admin-detail-empty">Distanze e tee delle combinazioni non vengono modificati.</p>
      {dirty && <p>Modifiche non salvate</p>}
      <div className="stablr-admin-abandon-zone"><button className="stablr-admin-abandon-button" disabled={busy} onClick={() => setAbandon(true)} type="button">Abbandona bozza</button></div>
    </>}
    {message && <p role="status">{message}</p>}{error && !pendingExit && !confirmation && !abandon && <p role="alert">{error}</p>}
    {!loading && !draft && <button className="stablr-admin-white-button" onClick={onBack} type="button">Torna al tee</button>}
    {pendingExit && <EditorDialog title="Modifiche non salvate"><p>Salva nella bozza oppure scarta solo le modifiche non salvate. La bozza già salvata rimane disponibile.</p>{error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !valid} onClick={() => operation(async () => { await save(); pendingExit(); })} type="button">Salva bozza</button><button disabled={busy} onClick={() => pendingExit()} type="button">Scarta</button><button disabled={busy} onClick={() => { setPendingExit(null); setError(""); }} type="button">Resta</button></div></EditorDialog>}
    {confirmation && <EditorDialog title="Conferma pubblicazione"><p>Verranno aggiornati solo CR, Slope e stato operativo del tee. Le distanze restano invariate.</p>
      <div className="stablr-admin-editor-diff" role="table" aria-label="Differenze tee"><div role="row"><strong role="columnheader">Campo</strong><strong role="columnheader">Prima</strong><strong role="columnheader">Dopo</strong></div>
        {confirmation.changes.map((row) => <div role="row" key={row.key}><span role="cell">{row.label}</span><span role="cell">{formatCourseTeeValue(row.key, row.before)}</span><span role="cell">{formatCourseTeeValue(row.key, row.after)}</span></div>)}</div>
      {error && <p role="alert">{error}</p>}<div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !confirmation.changes.length} onClick={() => operation(async () => { const result = await service.publishDraft(confirmation.draft); registerExitGuard(null); setConfirmation(null); setDraft(null); onPublished(result); })} type="button">Conferma pubblicazione</button><button disabled={busy} onClick={() => setConfirmation(null)} type="button">Annulla</button></div></EditorDialog>}
    {abandon && <EditorDialog title="Abbandona bozza"><p>Abbandonare la bozza? Le modifiche non pubblicate non saranno più riprese. Il catalogo pubblicato non cambia.</p>{error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy} onClick={() => operation(async () => { await service.abandonDraft(draft); registerExitGuard(null); setAbandon(false); setDraft(null); onBack(); })} type="button">Conferma abbandono</button><button disabled={busy} onClick={() => setAbandon(false)} type="button">Annulla</button></div></EditorDialog>}
  </section>;
}
