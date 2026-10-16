import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { getCourseDiff, getCourseEditorError, hasCourseDraftChanges, normalizeCourseFields } from "./course-editor-data";
import { CourseHolesEntry, CourseTeeEntry } from "./CourseTeeEditor";
import {CatalogMetadataFields,CatalogMetadataPublication,CatalogMetadataRecovery} from "./CatalogMetadata";
import {validEditorialFields} from "./catalog-metadata-data";

export default function CourseEditor({ club, course, service, onManageTees, onBack, onBackToClub, onBackToCatalog, onEditHoles, onPublished, registerExitGuard }) {
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
  const [publicationNote,setPublicationNote]=useState("");
  const [recoveryRequired,setRecoveryRequired]=useState(false);
  const [openRetry,setOpenRetry]=useState(0);
  const inFlight = useRef(false);
  const publishedCallback=useRef(onPublished);publishedCallback.current=onPublished;
  const dirty = draft && JSON.stringify(normalizeCourseFields(fields)) !== JSON.stringify(normalizeCourseFields(draft.snapshot));

  useEffect(() => {
    let active = true;
    setLoading(true);setError("");
    service.openDraft(course.id).then((opened) => {
      if (active) { setDraft(opened.draft); setFields(opened.draft.snapshot); setContext(opened.context || {}); }
    }).catch((failure) => {
      if(active&&failure?.code==="METADATA_ALREADY_PUBLISHED"){publishedCallback.current(failure.live);return;}
      console.error("Admin Percorso draft open failed", failure);
      if (active) setError(getCourseEditorError(failure));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [course.id, service,openRetry]);

  useEffect(() => {
    registerExitGuard((action) => {
      if (inFlight.current || confirmation || abandonConfirmation || pendingExit) return;
      if (dirty) setPendingExit(() => action);
      else action();
    });
    const beforeUnload = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { registerExitGuard(null); window.removeEventListener("beforeunload", beforeUnload); };
  }, [dirty, confirmation, abandonConfirmation, pendingExit, registerExitGuard]);

  const operation = async (callback,recovering=false) => {
    if (inFlight.current||(recoveryRequired&&!recovering)) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try { await callback(); }
    catch (failure) { console.error("Admin Percorso editor operation failed", failure?.code||"request_failed"); if(failure?.requiresRecovery)setRecoveryRequired(true);setError(getCourseEditorError(failure)); }
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
    setPublicationNote("");setConfirmation({ draft: saved, plan: await service.previewDraft(saved) });
  });
  const confirmPublication = () => operation(async () => {
    const result = await service.publishDraft(confirmation.draft,confirmation.plan,publicationNote);
    setConfirmation(null); onPublished(result.course);
  });
  const recoverDraft=()=>operation(async()=>{
    const result=await service.recoverDraft(draft);
    if(result.status==="published"){setConfirmation(null);onPublished(result.live);return;}
    setDraft(result.draft);setRecoveryRequired(false);setConfirmation(null);setPendingExit(null);
    setMessage("Bozza recuperata. Nessuna pubblicazione risulta completata; le modifiche nell’editor sono conservate.");
  },true);
  const abandonDraft = () => operation(async () => {
    await service.abandonDraft(draft);
    setAbandonConfirmation(false);
    setDraft(null);
    registerExitGuard(null);
    onBack();
  });
  const update = (key, value) => { setFields((current) => ({ ...current, [key]: value })); setMessage(""); };
  const normalized = normalizeCourseFields(fields);
  const hasDraftChanges = hasCourseDraftChanges(course, draft);
  const valid = normalized.name.length > 0 && normalized.name.length <= 200
    && [9, 18].includes(normalized.holes_count)
    && (normalized.display_order === null || (Number.isInteger(normalized.display_order)
      && normalized.display_order >= -2147483648 && normalized.display_order <= 2147483647))&&validEditorialFields(fields);
  const changes = draft ? getCourseDiff(draft.base_snapshot, fields) : [];

  return <section className="stablr-admin-detail stablr-admin-course-editor stablr-admin-metadata-editor">
    <nav aria-label="Percorso di navigazione" className="stablr-admin-breadcrumb">
      <button disabled={busy} onClick={onBackToCatalog} type="button">Club e percorsi</button><span>/</span>
      <button disabled={busy} onClick={onBackToClub} type="button">{club.name}</button><span>/</span>
      <button disabled={busy} onClick={onBack} type="button">{course.name}</button><span>/</span><span>Modifica dati</span>
    </nav>
    <header className="stablr-admin-page-header stablr-admin-editor-header"><div><h1>Modifica dati percorso</h1><p>{course.name} · {club.name}</p></div>{draft && <div className="stablr-admin-editor-header-side">{hasDraftChanges && <span className="stablr-admin-status">Bozza in corso</span>}<div className="stablr-admin-editor-header-actions"><button className="stablr-admin-draft-save-button" disabled={busy || recoveryRequired || !valid} onClick={() => operation(save)} type="button">Salva bozza</button><button className="stablr-admin-publish-button" disabled={busy || recoveryRequired || !valid || !changes.length} onClick={reviewPublication} type="button">Pubblica</button></div></div>}</header>
    {loading ? <p className="stablr-admin-detail-empty">Caricamento bozza…</p> : draft && <>
      <form className="stablr-admin-editor-fields" onSubmit={(event) => { event.preventDefault(); operation(save); }}>
        <label>Nome visualizzato<input disabled={busy} maxLength={200} onChange={(event) => update("name", event.target.value)} required value={fields.name} /></label>
        <label>Struttura<select disabled value={fields.holes_count}><option value={9}>9 buche</option><option value={18}>18 buche</option></select></label>
        <label>Stato operativo<select disabled={busy} onChange={(event) => update("is_active", event.target.value === "true")} value={String(fields.is_active)}><option value="true">Attivo</option><option value="false">Disattivato</option></select></label>
        <CatalogMetadataFields fields={fields} update={update} disabled={busy}/>
      </form>
      {course.hasPhysicalHoles && onEditHoles && <CourseHolesEntry onManage={onEditHoles} disabled={busy} />}
      {onManageTees && <CourseTeeEntry onManage={onManageTees} disabled={busy} />}
      <p className="stablr-admin-detail-empty stablr-admin-course-structure-notice">Struttura in sola lettura: questo editor modifica solo i metadati del Percorso. Buche, tee, combinazioni e giri restano invariati.</p>
      <div className="stablr-admin-detail-grid">
        <article><span>Nome FIG / originale · sola lettura</span><strong>{context.original_name || "—"}</strong></article>
        <article><span>Fonte · sola lettura</span><strong>{context.source_system || "—"}</strong></article>
        <article><span>Percorso GesGolf · sola lettura</span><strong>{context.gesgolf_name || "—"}</strong></article>
        <article><span>Stato esterno del club · sola lettura</span><strong>{club.dataStatus || "—"}</strong></article>
        <article><span>Matching FIG del club · sola lettura</span><strong>{club.figMatchStatus === "unmatched" ? "Da collegare" : club.figMatchStatus || "—"}</strong></article>
      </div>
      <p className="stablr-admin-detail-empty">Nome originale, fonti e identificativi non vengono riscritti. I collegamenti FIG/GesGolf senza contratto sicuro restano in sola lettura.</p>
      {dirty && <p className="stablr-admin-detail-empty">Modifiche non salvate</p>}
      <div className="stablr-admin-abandon-zone"><button className="stablr-admin-abandon-button" disabled={busy||recoveryRequired} onClick={() => { setError(""); setAbandonConfirmation(true); }} type="button">Abbandona bozza</button></div>
    </>}
    {message && <p role="status">{message}</p>}
    {busy&&!confirmation&&<p role="status">Operazione in corso…</p>}
    {recoveryRequired&&!confirmation&&<CatalogMetadataRecovery busy={busy} onRecover={recoverDraft}/>}
    {error && !confirmation && !pendingExit && !abandonConfirmation && <p className="stablr-admin-editor-error" role="alert">{error}</p>}
    {!loading && !draft && <><button className="stablr-admin-white-button" onClick={()=>setOpenRetry(n=>n+1)} type="button">Riprova caricamento bozza</button><button className="stablr-admin-abandon-button" onClick={onBack} type="button">Torna al percorso</button></>}
    {pendingExit && <EditorDialog title="Modifiche non salvate">
      <p>Salva nella bozza oppure scarta solo le modifiche non salvate. La bozza già salvata rimane disponibile.</p>
      {error && <p role="alert">{error}</p>}
      {recoveryRequired&&<CatalogMetadataRecovery busy={busy} onRecover={recoverDraft}/>}
      <div className="stablr-admin-editor-header-actions stablr-admin-new-holes-dialog-actions"><button className="stablr-admin-draft-save-button" disabled={busy || recoveryRequired || !valid} onClick={() => operation(async () => { await save(); pendingExit(); })} type="button">Salva bozza</button><button className="stablr-admin-abandon-button" disabled={busy} onClick={() => pendingExit()} type="button">Scarta</button><button className="stablr-admin-abandon-button" disabled={busy} onClick={() => { setPendingExit(null); setError(""); }} type="button">Resta</button></div>
    </EditorDialog>}
    {confirmation && <CatalogMetadataPublication plan={confirmation.plan} note={publicationNote} onNote={setPublicationNote} busy={busy} error={error} onConfirm={confirmPublication} onCancel={()=>setConfirmation(null)} label="percorso" recoveryRequired={recoveryRequired} onRecover={recoverDraft}/>}
    {abandonConfirmation && <EditorDialog title="Abbandona bozza">
      <p>Abbandonare la bozza? Le modifiche non pubblicate non saranno più riprese. Il catalogo pubblicato non cambia.</p>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-header-actions stablr-admin-new-holes-dialog-actions"><button className="stablr-admin-danger-button" disabled={busy} onClick={abandonDraft} type="button">Conferma abbandono</button><button className="stablr-admin-abandon-button" disabled={busy} onClick={() => { setAbandonConfirmation(false); setError(""); }} type="button">Annulla</button></div>
    </EditorDialog>}
  </section>;
}
