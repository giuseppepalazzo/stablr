import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { normalizeClubFields } from "./club-editor-data";

const getDraftError = (error) => error?.code === "40001"
  ? "La bozza è cambiata. Torna al catalogo e riaprila prima di salvare."
  : error?.code === "42501" ? "Non sei autorizzato a modificare questa bozza."
    : "Impossibile completare l’operazione. Riprova.";

export function NewClubDrafts({ service, ownerId, onOpenDraft }) {
  const [drafts, setDrafts] = useState([]), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!ownerId) return undefined;
    let active = true;
    setError("");
    service.listDrafts(ownerId).then((rows) => { if (active) setDrafts(rows); }).catch((failure) => {
      console.error("Admin new Club drafts failed", failure?.code || "request_failed");
      if (active) setError("Impossibile caricare le bozze nuovi club.");
    });
    return () => { active = false; };
  }, [ownerId, service, retry]);
  if (!drafts.length && !error) return null;
  return <section className="stablr-admin-detail-section" aria-label="Bozze nuovi club">
    <h2>Bozze nuovi club</h2><p className="stablr-admin-detail-empty">Bozze Admin non presenti nel catalogo pubblicato.</p>
    {error && <div role="alert"><p>{error}</p><button className="stablr-admin-white-button" type="button" onClick={() => setRetry((value) => value + 1)}>Riprova</button></div>}
    {drafts.map((draft) => <button className="stablr-admin-club-row" type="button" key={draft.draft_id} onClick={() => onOpenDraft(draft.draft_id)}>
      <span className="stablr-admin-club-identity"><strong>{draft.snapshot.name.trim() || "Nuovo club senza nome"}</strong><span>{draft.snapshot.city || "—"}</span></span>
      <span className="stablr-admin-status">Bozza nuovo club</span>
      <span className="stablr-admin-club-activity">Riprendi bozza →</span>
    </button>)}
  </section>;
}

export default function NewClubEditor({ draftId, ownerId, service, onBack, registerExitGuard }) {
  const [draft, setDraft] = useState(null), [fields, setFields] = useState({ name: "", city: "" });
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [pendingExit, setPendingExit] = useState(null), [abandonConfirmation, setAbandonConfirmation] = useState(false);
  const inFlight = useRef(false), opening = useRef(null);
  const dirty = !!draft && JSON.stringify(normalizeClubFields(fields)) !== JSON.stringify(normalizeClubFields(draft.snapshot));
  const valid = fields.name.trim().length > 0 && fields.name.trim().length <= 200 && fields.city.trim().length <= 200;
  useEffect(() => {
    let active = true;
    // React StrictMode replays effects. Reuse the same creation request so a
    // single explicit + Nuovo club click creates exactly one private draft.
    if (!opening.current) opening.current = service.openDraft(draftId, ownerId);
    opening.current.then((opened) => {
      if (active) { setDraft(opened); setFields({ name: opened.snapshot.name, city: opened.snapshot.city || "" }); }
    }).catch((failure) => {
      console.error("Admin new Club draft open failed", failure?.code || "request_failed");
      if (active) setError(getDraftError(failure));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [draftId, ownerId, service]);
  useEffect(() => {
    registerExitGuard((action) => {
      if (inFlight.current || loading || pendingExit || abandonConfirmation) return;
      if (dirty) setPendingExit(() => action);else action();
    });
    const beforeUnload = (event) => { if (dirty) { event.preventDefault();event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { registerExitGuard(null);window.removeEventListener("beforeunload", beforeUnload); };
  }, [dirty, loading, pendingExit, abandonConfirmation, registerExitGuard]);
  const operation = async (callback) => {
    if (inFlight.current) return;
    inFlight.current = true;setBusy(true);setError("");setMessage("");
    try { await callback(); }
    catch (failure) { console.error("Admin new Club draft operation failed", failure?.code || "request_failed");setError(getDraftError(failure)); }
    finally { inFlight.current = false;setBusy(false); }
  };
  const save = async () => {
    const saved = await service.saveDraft(draft, fields, ownerId);
    setDraft(saved);setFields({ name: saved.snapshot.name, city: saved.snapshot.city || "" });
    setMessage("Bozza salvata. Il nuovo club non è ancora pubblicabile.");
  };
  return <section className="stablr-admin-detail stablr-admin-club-editor">
    <nav className="stablr-admin-breadcrumb" aria-label="Percorso di navigazione"><button disabled={busy || loading} type="button" onClick={onBack}>Club e percorsi</button><span>/</span><span>Nuovo club</span></nav>
    <header className="stablr-admin-page-header stablr-admin-editor-header"><div><h1>Nuovo club</h1><p>Bozza privata Admin, non presente nel catalogo pubblicato.</p></div>{draft && <div className="stablr-admin-editor-header-side"><span className="stablr-admin-status">Bozza nuovo club</span><div className="stablr-admin-editor-header-actions"><button className="stablr-admin-draft-save-button" disabled={busy || !valid} type="button" onClick={() => operation(save)}>Salva bozza</button></div></div>}</header>
    {loading && <p role="status">Caricamento bozza…</p>}
    {draft && <>
      <form className="stablr-admin-editor-fields" onSubmit={(event) => { event.preventDefault();if (valid) operation(save); }}>
        <label>Nome visualizzato<input required disabled={busy} maxLength={200} value={fields.name} onChange={(event) => { setFields((current) => ({ ...current, name: event.target.value }));setMessage(""); }} /></label>
        <label>Località / città<input disabled={busy} maxLength={200} value={fields.city} onChange={(event) => { setFields((current) => ({ ...current, city: event.target.value }));setMessage(""); }} /></label>
      </form>
      <div className="stablr-admin-detail-grid"><article><span>Codice FIG · sola lettura</span><strong>—</strong></article><article><span>Pubblicazione</span><strong>Non ancora pubblicabile</strong></article><article><span>Visibilità giocatore</span><strong>Non visibile · non giocabile</strong></article></div>
      <p className="stablr-admin-detail-empty">Il codice FIG identifica un collegamento alla fonte e non è modificabile in questa bozza. Il nuovo club richiederà almeno un Percorso configurato e pubblicabile; la gestione dei Percorsi sarà disponibile in una fase successiva.</p>
      {dirty && <p className="stablr-admin-detail-empty">Modifiche non salvate</p>}
      <div className="stablr-admin-abandon-zone"><button className="stablr-admin-abandon-button" disabled={busy} type="button" onClick={() => { setError("");setAbandonConfirmation(true); }}>Abbandona bozza</button></div>
    </>}
    {message && <p role="status">{message}</p>}{error && !pendingExit && !abandonConfirmation && <p className="stablr-admin-editor-error" role="alert">{error}</p>}
    {!loading && !draft && <button className="stablr-admin-white-button" type="button" onClick={onBack}>Torna al catalogo</button>}
    {pendingExit && <EditorDialog title="Modifiche non salvate"><p>Salva le modifiche nella bozza oppure scarta solo le modifiche non salvate. La bozza già salvata rimane disponibile.</p>{error && <p role="alert">{error}</p>}<div className="stablr-admin-editor-actions">
      <button className="stablr-admin-white-button" disabled={busy || !valid} type="button" onClick={() => operation(async () => { await save();const exit = pendingExit;setPendingExit(null);exit(); })}>Salva bozza</button>
      <button disabled={busy} type="button" onClick={() => { const exit = pendingExit;setPendingExit(null);exit(); }}>Scarta</button>
      <button disabled={busy} type="button" onClick={() => { setPendingExit(null);setError(""); }}>Resta</button>
    </div></EditorDialog>}
    {abandonConfirmation && <EditorDialog title="Abbandona bozza"><p>Abbandonare la bozza? Le modifiche non pubblicate non saranno più riprese. Il catalogo pubblicato non cambia.</p>{error && <p role="alert">{error}</p>}<div className="stablr-admin-editor-actions">
      <button className="stablr-admin-danger-button" disabled={busy} type="button" onClick={() => operation(async () => { await service.abandonDraft(draft, ownerId);registerExitGuard(null);onBack(); })}>Conferma abbandono</button>
      <button disabled={busy} type="button" onClick={() => { setAbandonConfirmation(false);setError(""); }}>Annulla</button>
    </div></EditorDialog>}
  </section>;
}
