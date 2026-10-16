import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import TechnicalRows from "./TechnicalRows";
import TeeSiEditor from "./TeeSiEditor";
import { courseTeeColor, courseTeeDiff, courseTeeDraftFields, courseTeePreviewChanges, courseTeeError, formatCourseTeeValue, normalizeCourseTeeFields, validCourseTeeFields } from "./course-tee-editor-data";

function TeeFoundationImpact({ impact }) {
  if (!impact) return null;
  const state = value => ({ matched: "Allineata", changed: "Da revisionare", not_recorded: "Non registrata" }[value] || "Non verificabile");
  const reasons = { recorded_tee_baseline: "Fotografia tee del Percorso", new_tee_unclassified: "Nuovo tee da classificare",
    tee_classification_baseline: "Baseline classificazione tee", verified_dependency_baseline: "Dipendenza verificata dal padre" };
  return <section className="stablr-admin-detail-section"><h2>Impatto sulla fondazione fisica</h2>
    {impact.may_block_par && <p role="status">Questa pubblicazione può invalidare le baseline della fondazione fisica e bloccare successive pubblicazioni Par. Le baseline non vengono aggiornate automaticamente.</p>}
    <div className="stablr-admin-editor-diff" role="table" aria-label="Configurazioni interessate dalla pubblicazione tee">
      <div role="row"><strong role="columnheader">Configurazione / ambito</strong><strong role="columnheader">Baseline attuale</strong><strong role="columnheader">Impatto potenziale</strong></div>
      <TechnicalRows label="Configurazioni interessate">{impact.configurations.map(row => <div role="row" key={row.id}><span role="cell">{row.label} · {row.holes_count} buche</span><span role="cell">Tee: {state(row.tee_state)} · Fonte: {state(row.source_state)}</span><span role="cell">{reasons[row.reason] || "Da verificare"}</span></div>)}</TechnicalRows>
    </div>
    {!!impact.classification_count && <p>{impact.classification_count} classificazioni tee sulle configurazioni interessate: validità da ricontrollare prima di una pubblicazione Par.</p>}
    {impact.coverage === "incomplete" && <p role="status">Copertura incompleta: i collegamenti fisici non verificati o mancanti non permettono di escludere ulteriori impatti.</p>}
    {!impact.may_block_par && impact.coverage !== "incomplete" && <p>Nessuna invalidazione rilevata sui collegamenti verificati.</p>}
    <p>Nessuna propagazione di nome, colore, categoria, stato o CR/Slope tra tee 9 e 18.</p>
  </section>;
}

export function CourseTeeFacts({ tee, kind = "course" }) {
  const facts = [["Nome", tee.tee_name], ["Colore", tee.tee_color], ["Applicabilità", tee.gender],
    ["Ambito effettivo", tee.effective_holes_count ? `${tee.effective_holes_count} buche${tee.holes_count == null ? kind === "combination" ? " · dalla combinazione" : " · dal Percorso" : ""}` : null],
    ["CR", tee.course_rating], ["Slope", tee.slope_rating], ["Ordine", tee.display_order], ["Stato operativo", formatCourseTeeValue("is_active", tee.is_active)]];
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
function TeeList({ tees, onOpen, kind = "course" }) {
  if (!tees.length) return <p className="stablr-admin-detail-empty">{kind === "combination" ? "Nessun tee disponibile per questa combinazione." : "Nessun tee disponibile per questo Percorso."}</p>;
  return <div className="stablr-admin-tee-list">
    <div className="stablr-admin-tee-columns" aria-hidden="true"><span>Tee</span><span>Applicabilità</span><span>Ambito effettivo</span><span>CR</span><span>Slope</span><span>Stato</span><span /></div>
    {tees.map((tee) => {
      const Row = onOpen ? "button" : "div";
      return <Row className="stablr-admin-tee-row" key={tee.id} {...(onOpen ? { type: "button", onClick: () => onOpen(tee),
        "aria-label": `Apri tee ${tee.tee_name} · ${tee.effective_holes_count ? `${tee.effective_holes_count} buche` : "ambito non disponibile"}${tee.gender ? ` · ${tee.gender}` : ""}` } : {})}>
        <span className="stablr-admin-tee-name"><span className="stablr-admin-tee-dot" aria-hidden="true" title={`Colore: ${tee.tee_color || "non disponibile"}`} style={{ backgroundColor: courseTeeColor(tee.tee_color) }} /><span>{tee.tee_name}</span></span>
        <span>{tee.gender ?? "—"}</span><span>{tee.effective_holes_count ? `${tee.effective_holes_count} buche${tee.holes_count == null ? kind === "combination" ? " · dalla combinazione" : " · dal Percorso" : ""}` : "—"}</span>
        <span>{tee.course_rating ?? "—"}</span><span>{tee.slope_rating ?? "—"}</span>
        <span className="stablr-admin-tee-state"><span className="stablr-admin-status">{formatCourseTeeValue("is_active", tee.is_active)}</span>{tee.has_draft_changes && <span className="stablr-admin-status">Bozza in corso</span>}</span>
        <span aria-hidden="true">{onOpen ? "›" : ""}</span>
      </Row>;
    })}
  </div>;
}
function ListState({ state, children, kind = "course" }) {
  if (state.error) return <div role="alert"><p>{kind === "combination" ? "Impossibile caricare i tee della combinazione." : "Impossibile caricare i tee del Percorso."}</p><button className="stablr-admin-white-button" onClick={state.retry} type="button">Riprova</button></div>;
  if (!state.result) return <p role="status">Caricamento tee e rating…</p>;
  return children;
}
export function CourseTeeSection({ course, service, onManage, disabled, kind = "course" }) {
  const state = useCourseTees(course.id, service);
  return <section className="stablr-admin-detail-section"><h2>Tee e rating</h2>
    <ListState state={state} kind={kind}>{state.result && <TeeList tees={state.result.tees} kind={kind} />}</ListState>
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

export function CourseTeeManager({ club, course, service, onBack, onBackToClub, onBackToCatalog, navigate, registerExitGuard, kind = "course" }) {
  const state = useCourseTees(course.id, service);
  const [selected, setSelected] = useState(null), [editing, setEditing] = useState(false), [editingSi, setEditingSi] = useState(false), [editingDistances,setEditingDistances]=useState(false);
  const tees = state.result?.tees || [];
  const backToList = () => navigate(() => { setSelected(null); setEditing(false); state.retry(); });
  if (editingSi || editingDistances) return <TeeSiEditor tee={selected} kind={kind} metric={editingDistances ? "distances" : "si"} registerExitGuard={registerExitGuard}
    onBack={() => navigate(() => {setEditingSi(false);setEditingDistances(false);})} />;
  if (editing) return <CourseTeeEditor key={selected.id} club={club} course={course} tee={selected} service={service} kind={kind}
    onBack={selected.is_new ? backToList : () => navigate(() => { setEditing(false); state.retry(); })}
    onBackToList={backToList} onBackToCourse={onBack} onBackToClub={onBackToClub} onBackToCatalog={onBackToCatalog}
    registerExitGuard={registerExitGuard} onPublished={(result) => {
      const tee = { ...result.context.tee, has_draft_changes: false };
      state.setResult((current) => ({ ...current, tees: [...current.tees.filter(row => row.id !== tee.id), tee], new_drafts: (current.new_drafts || []).filter(row => row.draft_id !== result.draft_id) })); setSelected(tee); setEditing(false); state.retry();
    }} />;
  return <section className="stablr-admin-detail">
    <nav aria-label="Percorso di navigazione" className="stablr-admin-breadcrumb">
      <button onClick={onBackToCatalog} type="button">Club e percorsi</button><span>/</span><button onClick={onBackToClub} type="button">{club.name}</button><span>/</span>
      <button onClick={onBack} type="button">{course.name}</button><span>/</span>{selected ? <><button onClick={backToList} type="button">Tee e rating</button><span>/</span><span>{selected.tee_name}</span></> : <span>Tee e rating</span>}
    </nav>
    <header className="stablr-admin-page-header"><div><h1 className={selected ? "stablr-admin-tee-detail-title" : undefined}>{selected && <span className="stablr-admin-tee-dot" aria-hidden="true" style={{ backgroundColor: courseTeeColor(selected.tee_color) }} />}{selected ? selected.tee_name : "Tee e rating"}</h1><p>{course.name} · {club.name}</p></div></header>
    {selected ? <>
      <button className="stablr-admin-white-button" onClick={() => setEditing(true)} type="button">Modifica dati</button>
      <CourseTeeFacts tee={selected} kind={kind} />
      <section className="stablr-admin-detail-section"><h2>Override SI</h2><button className="stablr-admin-white-button" type="button" onClick={() => setEditingSi(true)}>Gestisci override SI</button></section>
      <section className="stablr-admin-detail-section"><h2>Distanze</h2><button className="stablr-admin-white-button" type="button" onClick={()=>setEditingDistances(true)}>Gestisci distanze</button></section>
      <p className="stablr-admin-detail-empty">Ambito, Par e fonti sono in sola lettura.</p>
    </> : <ListState state={state} kind={kind}>
      <div className="stablr-admin-child-editor-action"><button className="stablr-admin-white-button" type="button" onClick={() => { setSelected({ id: `new:${course.id}`, is_new: true, tee_name: "Nuovo tee" });setEditing(true); }}>+ Nuovo tee</button></div>
      <TeeList tees={tees} onOpen={setSelected} kind={kind} />
      {!!state.result?.new_drafts?.length && <section className="stablr-admin-detail-section"><h2>Bozze nuovi tee</h2>{state.result.new_drafts.map(row => <button className="stablr-admin-club-row" type="button" key={row.draft_id} onClick={() => { setSelected({ id: row.draft_id, draft_id: row.draft_id, is_new: true, tee_name: row.snapshot.tee_name || "Nuovo tee senza nome" });setEditing(true); }}><span className="stablr-admin-tee-name"><span className="stablr-admin-tee-dot" aria-hidden="true" title={`Colore: ${row.snapshot.tee_color || "non disponibile"}`} style={{ backgroundColor: courseTeeColor(row.snapshot.tee_color) }} /><span>{row.snapshot.tee_name || "Nuovo tee senza nome"}</span></span><span className="stablr-admin-status">Bozza nuovo tee</span><span>Riprendi bozza →</span></button>)}</section>}
    </ListState>}
  </section>;
}

export default function CourseTeeEditor({ club, course, tee, service, onBack, onBackToList, onBackToCourse, onBackToClub, onBackToCatalog, onPublished, registerExitGuard, kind = "course" }) {
  const [draft, setDraft] = useState(null), [context, setContext] = useState(null), [fields, setFields] = useState({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [pendingExit, setPendingExit] = useState(null), [confirmation, setConfirmation] = useState(null), [abandon, setAbandon] = useState(false);
  const inFlight = useRef(false);
  const opening = useRef(null);
  const dirty = draft && courseTeeDiff(courseTeeDraftFields(draft, context?.tee || tee), fields).length > 0;
  const valid = validCourseTeeFields(fields);
  const changes = draft ? courseTeeDiff(courseTeeDraftFields({ ...draft, snapshot: draft.base_snapshot }, context?.tee || tee), fields) : [];
  useEffect(() => {
    let active = true;
    // StrictMode replays this effect at mount. Reuse this mount's request rather
    // than racing two open RPCs for the same NOWAIT row lock. A real remount or
    // different target still opens/resumes afresh; no draft/base is cached globally.
    if (opening.current?.teeId !== tee.id || opening.current?.service !== service) {
      opening.current = { teeId: tee.id, service, request: tee.is_new ? (tee.draft_id ? service.resumeNewDraft(tee.draft_id) : service.openNewDraft(course.id)) : service.openDraft(tee.id) };
    }
    opening.current.request.then((opened) => { if (active) { setDraft(opened.draft); setFields(courseTeeDraftFields(opened.draft, opened.context?.tee || tee)); setContext(opened.context); } })
      .catch((failure) => { console.error("Admin tee draft open failed", failure); if (active) setError(courseTeeError(failure, kind)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tee, course.id, service, kind]);
  useEffect(() => {
    registerExitGuard((action) => { if (inFlight.current || pendingExit || confirmation || abandon) return; if (dirty) setPendingExit(() => action); else action(); });
    const unload = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => { registerExitGuard(null); window.removeEventListener("beforeunload", unload); };
  }, [dirty, pendingExit, confirmation, abandon, registerExitGuard]);
  const operation = async (callback) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try { await callback(); } catch (failure) { console.error("Admin tee operation failed", failure); setError(courseTeeError(failure, kind)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const save = async () => {
    const saved = await service.saveDraft(draft, normalizeCourseTeeFields(fields));
    setDraft(saved); setFields(courseTeeDraftFields(saved, context?.tee || tee)); setMessage("Bozza salvata. Il catalogo pubblicato resta invariato."); return saved;
  };
  const update = (key, value) => { setFields((current) => ({ ...current, [key]: value })); setMessage(""); };
  const live = context?.tee || tee;
  const readonly = [["Ambito effettivo", live.effective_holes_count ? `${live.effective_holes_count} buche${live.holes_count == null ? kind === "combination" ? " · dalla combinazione" : " · dal Percorso" : ""}` : null],
    ["Par totale", live.par_total], ["Fonte", live.source_system], ["Riferimento fonte", live.source_external_id], ["Rating stimato", live.estimated === true ? "Sì" : "No"]];
  return <section className="stablr-admin-detail">
    <nav aria-label="Percorso di navigazione" className="stablr-admin-breadcrumb">
      <button disabled={busy} onClick={onBackToCatalog} type="button">Club e percorsi</button><span>/</span><button disabled={busy} onClick={onBackToClub} type="button">{club.name}</button><span>/</span>
      <button disabled={busy} onClick={onBackToCourse} type="button">{course.name}</button><span>/</span><button disabled={busy} onClick={onBackToList} type="button">Tee e rating</button><span>/</span><button disabled={busy} onClick={onBack} type="button">{tee.tee_name}</button><span>/</span><span>Modifica dati</span>
    </nav>
    <header className="stablr-admin-page-header stablr-admin-editor-header"><div><h1>{tee.is_new ? "Nuovo tee" : "Modifica dati tee"}</h1><p>{tee.tee_name} · {course.name}</p></div>{draft && <div className="stablr-admin-editor-header-side">
      {tee.is_new ? <span className="stablr-admin-status">Bozza nuovo tee · privata</span> : courseTeeDiff(live, courseTeeDraftFields(draft, live)).length > 0 && <span className="stablr-admin-status">Bozza in corso</span>}
      <div className="stablr-admin-editor-header-actions"><button className="stablr-admin-draft-save-button" disabled={busy || !valid} onClick={() => operation(save)} type="button">Salva bozza</button>
        <button className="stablr-admin-publish-button" disabled={busy || !valid || (!tee.is_new && !changes.length)} onClick={() => operation(async () => { const saved = dirty ? await save() : draft; const plan = await service.previewDraft(saved);setConfirmation({ draft: saved, changes: courseTeePreviewChanges(plan), plan }); })} type="button">Pubblica</button></div>
    </div>}</header>
    {loading ? <p role="status">Caricamento bozza…</p> : draft && <>
      <form className="stablr-admin-editor-fields" onSubmit={(event) => { event.preventDefault(); if (valid) operation(save); }}>
        <label>Nome tee<input required maxLength={200} disabled={busy} value={fields.tee_name ?? ""} onChange={event => update("tee_name", event.target.value)} /></label>
        <label>Colore tee<input maxLength={100} disabled={busy} value={fields.tee_color ?? ""} onChange={event => update("tee_color", event.target.value)} /></label>
        <label>Categoria del rating<select disabled={busy} value={fields.gender ?? ""} onChange={event => update("gender", event.target.value || null)}><option value="">Non specificata</option><option value="men">Uomini</option><option value="women">Donne</option>{fields.gender && !["men", "women"].includes(fields.gender) && <option value={fields.gender}>{fields.gender} · dato sorgente</option>}</select></label>
        <label>Ordine<input disabled={busy} type="number" min={-2147483648} max={2147483647} step={1} value={fields.display_order ?? ""} onChange={event => update("display_order", event.target.value)} /></label>
        <label>CR<input disabled={busy} type="text" inputMode="decimal" value={fields.course_rating ?? ""} onChange={(event) => update("course_rating", event.target.value)} /></label>
        <label>Slope<input disabled={busy} type="number" step={1} min={55} max={155} value={fields.slope_rating ?? ""} onChange={(event) => update("slope_rating", event.target.value)} /></label>
        <label>Stato operativo<select disabled={busy} value={String(fields.is_active)} onChange={(event) => update("is_active", event.target.value === "true")}><option value="true">Attivo</option><option value="false">Disattivato</option></select></label>
      </form>
      <p className="stablr-admin-detail-empty">CR e Slope possono essere assenti. Un tee storico incompleto può essere disattivato senza aggiungere rating.</p>
      <div className="stablr-admin-detail-grid">{readonly.map(([label, value]) => <article key={label}><span>{label} · sola lettura</span><strong>{value ?? "—"}</strong></article>)}</div>
      <p className="stablr-admin-detail-empty">{kind === "combination" ? "Buche, Par, SI, distanze e tee dei Percorsi non vengono modificati." : "Distanze e tee delle combinazioni non vengono modificati."}</p>
      {dirty && <p>Modifiche non salvate</p>}
      <div className="stablr-admin-abandon-zone"><button className="stablr-admin-abandon-button" disabled={busy} onClick={() => setAbandon(true)} type="button">Abbandona bozza</button></div>
    </>}
    {message && <p role="status">{message}</p>}{error && !pendingExit && !confirmation && !abandon && <p role="alert">{error}</p>}
    {!loading && !draft && <button className="stablr-admin-white-button" onClick={onBack} type="button">Torna al tee</button>}
    {pendingExit && <EditorDialog title="Modifiche non salvate"><p>Salva nella bozza oppure scarta solo le modifiche non salvate. La bozza già salvata rimane disponibile.</p>{error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !valid} onClick={() => operation(async () => { await save(); pendingExit(); })} type="button">Salva bozza</button><button disabled={busy} onClick={() => pendingExit()} type="button">Scarta</button><button disabled={busy} onClick={() => { setPendingExit(null); setError(""); }} type="button">Resta</button></div></EditorDialog>}
    {confirmation && <EditorDialog title="Conferma pubblicazione"><p>{tee.is_new ? kind === "combination" ? "Verrà creato un nuovo tee della combinazione, con ambito e Par dalla griglia pubblicata." : "Verrà creato un nuovo tee del Percorso, con ambito e Par dalla griglia pubblicata." : "Verranno aggiornati metadati, CR, Slope e stato operativo del tee."} Buche e distanze restano invariate.</p>
      <div className="stablr-admin-editor-diff" role="table" aria-label="Differenze tee"><div role="row"><strong role="columnheader">Campo</strong><strong role="columnheader">Prima</strong><strong role="columnheader">Dopo</strong></div>
        {confirmation.changes.map((row) => <div role="row" key={row.key}><span role="cell">{row.label}</span><span role="cell">{formatCourseTeeValue(row.key, row.before)}</span><span role="cell">{formatCourseTeeValue(row.key, row.after)}</span></div>)}</div>
      <TeeFoundationImpact impact={confirmation.plan.foundation_impact} />
      {confirmation.plan.blockers.map((block, i) => <p role="status" key={i}>{block}</p>)}
      {error && <p role="alert">{error}</p>}<div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !confirmation.plan.can_publish || !confirmation.changes.length} onClick={() => operation(async () => { const result = await service.publishDraft(confirmation.draft); registerExitGuard(null); setConfirmation(null); setDraft(null); onPublished(result); })} type="button">Conferma pubblicazione</button><button disabled={busy} onClick={() => setConfirmation(null)} type="button">Annulla</button></div></EditorDialog>}
    {abandon && <EditorDialog title="Abbandona bozza"><p>Abbandonare la bozza? Le modifiche non pubblicate non saranno più riprese. Il catalogo pubblicato non cambia.</p>{error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy} onClick={() => operation(async () => { await service.abandonDraft(draft); registerExitGuard(null); setAbandon(false); setDraft(null); if (tee.is_new) onBackToList();else onBack(); })} type="button">Conferma abbandono</button><button disabled={busy} onClick={() => setAbandon(false)} type="button">Annulla</button></div></EditorDialog>}
  </section>;
}
