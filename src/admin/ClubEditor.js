import { useEffect, useRef, useState } from "react";
import { getClubDiff, getClubEditorError, normalizeClubFields } from "./club-editor-data";

export function EditorDialog({ title, children }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialog.current?.querySelector("button")?.focus();
    const trapFocus = (event) => {
      if (event.key !== "Tab") return;
      const buttons = [...dialog.current.querySelectorAll("button:not(:disabled)")];
      if (!buttons.length) return;
      const next = event.shiftKey ? buttons[buttons.length - 1] : buttons[0];
      if (document.activeElement === (event.shiftKey ? buttons[0] : buttons[buttons.length - 1])) {
        event.preventDefault();
        next.focus();
      }
    };
    const element = dialog.current;
    element.addEventListener("keydown", trapFocus);
    return () => { element.removeEventListener("keydown", trapFocus); previousFocus?.focus(); };
  }, []);
  return <div className="stablr-admin-editor-overlay"><section aria-label={title} aria-modal="true" className="stablr-admin-editor-dialog" ref={dialog} role="dialog"><h2>{title}</h2>{children}</section></div>;
}

export default function ClubEditor({ club, service, onBack, onPublished, registerExitGuard }) {
  const [draft, setDraft] = useState(null);
  const [fields, setFields] = useState({ name: "", city: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingExit, setPendingExit] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [abandonConfirmation, setAbandonConfirmation] = useState(false);
  const inFlight = useRef(false);
  const dirty = draft && JSON.stringify(normalizeClubFields(fields)) !== JSON.stringify(normalizeClubFields(draft.snapshot));

  useEffect(() => {
    let active = true;
    const open = async () => {
      try {
        const opened = await service.openDraft(club.id);
        if (active) { setDraft(opened); setFields({ name: opened.snapshot.name, city: opened.snapshot.city || "" }); }
      } catch (failure) {
        console.error("Admin Club draft open failed", failure);
        if (active) setError(getClubEditorError(failure));
      } finally { if (active) setLoading(false); }
    };
    open();
    return () => { active = false; };
  }, [club.id, service]);

  useEffect(() => {
    registerExitGuard((action) => {
      if (inFlight.current) return;
      if (dirty) setPendingExit(() => action);
      else action();
    });
    const beforeUnload = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { registerExitGuard(null); window.removeEventListener("beforeunload", beforeUnload); };
  }, [dirty, registerExitGuard]);

  const operation = async (callback) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(""); setMessage("");
    try { await callback(); }
    catch (failure) { console.error("Admin Club editor operation failed", failure); setError(getClubEditorError(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const save = async () => {
    const saved = await service.saveDraft(draft, fields);
    setDraft(saved); setFields({ name: saved.snapshot.name, city: saved.snapshot.city || "" });
    setMessage("Bozza salvata. Il catalogo pubblicato resta invariato.");
    return saved;
  };
  const reviewPublication = () => operation(async () => {
    const saved = dirty ? await save() : draft;
    setConfirmation({ draft: saved, changes: getClubDiff(saved.base_snapshot, saved.snapshot) });
  });
  const confirmPublication = () => operation(async () => {
    const result = await service.publishDraft(confirmation.draft);
    setConfirmation(null);
    onPublished(result.club);
  });
  const abandonDraft = () => operation(async () => {
    await service.abandonDraft(draft);
    setAbandonConfirmation(false);
    setDraft(null);
    registerExitGuard(null);
    onBack();
  });
  const valid = fields.name.trim().length > 0 && fields.name.trim().length <= 200 && fields.city.trim().length <= 200;
  const changes = draft ? getClubDiff(draft.base_snapshot, fields) : [];

  return <section className="stablr-admin-detail stablr-admin-club-editor">
    <nav aria-label="Percorso di navigazione" className="stablr-admin-breadcrumb"><button disabled={busy} onClick={onBack} type="button">{club.name}</button><span>/</span><span>Modifica dati</span></nav>
    <header className="stablr-admin-page-header"><div><h1>Modifica dati club</h1><p>{club.name}</p></div>{draft && <span className="stablr-admin-status">Bozza in corso</span>}</header>
    {loading ? <p className="stablr-admin-detail-empty">Caricamento bozza…</p> : <>
      {draft && <>
        <form className="stablr-admin-editor-fields" onSubmit={(event) => { event.preventDefault(); operation(save); }}>
          <label>Nome visualizzato<input disabled={busy} maxLength={200} onChange={(event) => { setFields((current) => ({ ...current, name: event.target.value })); setMessage(""); }} required value={fields.name} /></label>
          <label>Località / città<input disabled={busy} maxLength={200} onChange={(event) => { setFields((current) => ({ ...current, city: event.target.value })); setMessage(""); }} value={fields.city} /></label>
          <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !valid} type="submit">Salva bozza</button><button className="stablr-admin-white-button" disabled={busy || !valid || !changes.length} onClick={reviewPublication} type="button">Pubblica</button><button disabled={busy} onClick={() => { setError(""); setAbandonConfirmation(true); }} type="button">Abbandona bozza</button></div>
        </form>
        <div className="stablr-admin-detail-grid">
          <article><span>Codice FIG · sola lettura</span><strong>{club.figCode || "—"}</strong></article>
          <article><span>Stato esterno · sola lettura</span><strong>{club.dataStatus || "—"}</strong></article>
          <article><span>Fonti e matching · sola lettura</span><strong>{[club.sourceType, club.figMatchStatus === "unmatched" ? "Da collegare" : club.figMatchStatus].filter(Boolean).join(" · ") || "—"}</strong></article>
        </div>
        <p className="stablr-admin-detail-empty">Il codice FIG identifica il collegamento alla fonte e resta in sola lettura.</p>
        {dirty && <p className="stablr-admin-detail-empty">Modifiche non salvate</p>}
      </>}
    </>}
    {message && <p role="status">{message}</p>}
    {error && !confirmation && !pendingExit && !abandonConfirmation && <p className="stablr-admin-editor-error" role="alert">{error}</p>}
    {!loading && !draft && <button className="stablr-admin-white-button" onClick={onBack} type="button">Torna al club</button>}
    {pendingExit && <EditorDialog title="Modifiche non salvate">
      <p>Salva le modifiche nella bozza oppure scarta solo le modifiche non salvate. La bozza già salvata rimane disponibile.</p>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions">
        <button className="stablr-admin-white-button" disabled={busy || !valid} onClick={() => operation(async () => { await save(); pendingExit(); })} type="button">Salva bozza</button>
        <button disabled={busy} onClick={() => pendingExit()} type="button">Scarta</button>
        <button disabled={busy} onClick={() => { setPendingExit(null); setError(""); }} type="button">Resta</button>
      </div>
    </EditorDialog>}
    {confirmation && <EditorDialog title="Conferma pubblicazione">
      <p>Queste modifiche saranno visibili nel catalogo.</p>
      <div className="stablr-admin-editor-diff" role="table" aria-label="Differenze club">
        <div role="row"><strong role="columnheader">Campo</strong><strong role="columnheader">Prima</strong><strong role="columnheader">Dopo</strong></div>
        {confirmation.changes.map((change) => <div key={change.key} role="row"><span role="cell">{change.label}</span><span role="cell">{change.before || "—"}</span><span role="cell">{change.after || "—"}</span></div>)}
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
