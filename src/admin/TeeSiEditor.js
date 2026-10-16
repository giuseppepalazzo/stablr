import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import TechnicalRows from "./TechnicalRows";
import { teeSiService, teeSiError, teeSiValidation, cycleTeeSi } from "./tee-si-data";
import "./TeeSiEditor.css";

export default function TeeSiEditor({ tee, kind, onBack, registerExitGuard, service = teeSiService }) {
  const [detail, setDetail] = useState(null), [draft, setDraft] = useState(null), [fields, setFields] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [pending, setPending] = useState(null), [preview, setPreview] = useState(null), [note, setNote] = useState("");
  const [abandon, setAbandon] = useState(false), [restore, setRestore] = useState(null);
  const [partialInput, setPartialInput] = useState(null), [fieldError, setFieldError] = useState("");
  const [warningsAccepted, setWarningsAccepted] = useState(false);
  const flight = useRef(false), teeKind = kind === "combination" ? "combination_tee" : "route_tee";
  const invoke = (action, params) => service(teeKind, tee.id, action, params);
  const dirty = !!draft && (!!partialInput || JSON.stringify(fields) !== JSON.stringify(draft.snapshot));
  const context = detail?.context;
  const checks = teeSiValidation(fields, context);
  const scale = [...(context?.allowed_si || [])].sort((a,b) => a-b);
  const editingDisabled = busy || !!preview || !!pending || abandon || !!restore;
  const warningNote = preview?.warnings?.length ? `\nAvvisi confermati: ${preview.warnings.join(" ")}` : "";
  const publicationNote = note.trim() + warningNote;
  useEffect(() => {
    let mounted = true;
    service(teeKind, tee.id, "detail").then(result => {
      if (!mounted) return;
      setDetail(result);setDraft(result.draft);setFields(result.draft?.snapshot || null);
    }).catch(failure => { if (mounted) setError(teeSiError(failure)); });
    return () => { mounted = false; };
  }, [service, teeKind, tee.id]);
  useEffect(() => {
    registerExitGuard(action => { if (flight.current) return; if (dirty) setPending(() => action); else action(); });
    const unload = event => { if (dirty) { event.preventDefault();event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => { registerExitGuard(null);window.removeEventListener("beforeunload", unload); };
  }, [dirty, registerExitGuard]);
  const operation = async action => {
    if (flight.current) return;
    flight.current = true;setBusy(true);setError("");setMessage("");
    try { await action(); } catch (failure) { setError(teeSiError(failure)); }
    finally { flight.current = false;setBusy(false); }
  };
  const accept = result => { setDetail(result);setDraft(result.draft);setFields(result.draft?.snapshot || null); };
  const save = async () => {
    if (partialInput) return null;
    const result = await invoke("save", { p_draft_id: draft.draft_id, p_revision: draft.revision, p_snapshot: fields });
    setDraft(result.draft);setFields(result.draft.snapshot);setMessage("Bozza SI salvata. Nessuna modifica pubblicata.");return result.draft;
  };
  const setSi = (slotId, value) => {
    setPartialInput(null);setFieldError("");setMessage("");
    setFields(current => ({ mode: "managed", holes: current.holes.map(h => h.slot_id === slotId ? { ...h, si: value } : h) }));
  };
  const updateSi = (row, raw) => {
    if (raw === "") { setSi(row.slot_id, null);return; }
    if (/^[1-9]\d?$/.test(raw) && scale.includes(Number(raw))) { setSi(row.slot_id, Number(raw));return; }
    // Permit a temporary prefix (e.g. "1" while typing 12 on an even SI scale),
    // never a saved SI. Blur discards it; all save/preview actions are disabled.
    if (/^[1-9]\d?$/.test(raw) && scale.some(n => String(n).startsWith(raw))) {
      setPartialInput({ slotId: row.slot_id, text: raw });setFieldError("Completa lo SI scegliendo un valore della scala; il prefisso non viene salvato.");return;
    }
    setFieldError(`Valore rifiutato. SI ammessi: ${scale.join(", ")}.`);
  };
  const stepSi = (row, direction) => {
    const value = fields.holes.find(h => h.slot_id === row.slot_id)?.si ?? row.standard_si;
    setSi(row.slot_id, cycleTeeSi(value, scale, direction));
  };
  const resetToConfiguration = () => { setPartialInput(null);setFieldError("");setFields({ mode: "managed", holes: context.holes.map(row => ({ slot_id: row.slot_id, si: null })) }); };
  const returnToTee = () => { if (dirty) setPending(() => onBack); else onBack(); };
  return <section className="stablr-admin-detail stablr-admin-tee-si">
    <nav className="stablr-admin-breadcrumb" aria-label="Percorso di navigazione"><button disabled={busy} type="button" onClick={returnToTee}>{tee.tee_name}</button><span>/</span><span>Override SI</span></nav>
    <header className="stablr-admin-page-header stablr-admin-editor-header"><div><h1>Override SI tee</h1><p>{tee.tee_name} · {context?.tee.holes_count || "—"} buche</p></div>
      {draft && <div className="stablr-admin-editor-header-side"><span className="stablr-admin-status">Bozza SI in corso</span><div className="stablr-admin-editor-header-actions">
        <button className="stablr-admin-draft-save-button" disabled={editingDisabled || !!partialInput} type="button" onClick={() => operation(save)}>Salva bozza</button>
        <button className="stablr-admin-publish-button" disabled={editingDisabled || !!partialInput} type="button" onClick={() => operation(async () => {
          const saved = dirty ? await save() : draft;
          const result = await invoke("preview", { p_draft_id: saved.draft_id, p_revision: saved.revision });
          const validation = teeSiValidation(saved.snapshot, result.context || context);
          setPreview({ ...result, blockers: [...new Set([...result.blockers, ...validation.blockers])], warnings: validation.warnings,
            can_publish: result.can_publish && validation.blockers.length === 0 });setNote("");setWarningsAccepted(false);
        })}>Pubblica</button>
      </div></div>}
    </header>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!detail && !error && <p role="status">Caricamento SI…</p>}
    {context && <>
      <section className="stablr-admin-detail-section"><h2>Origine e impatto</h2>
        <p>{context.configuration.label || "Configurazione non verificata"} · {context.tee.holes_count} buche</p>
        <p>Una sola configurazione e questo tee. Nessuna propagazione ad altri tee o ambiti; Par, CR/Slope, distanze e giri non cambiano.</p>
        {context.legacy_present && <p role="status">È presente una matrice legacy. Non viene associata per nome o colore: una pubblicazione SI gestita la sostituisce esplicitamente, solo per questo tee e ambito.</p>}
        {context.blockers.map((block, i) => <p role="status" key={i}>{block}</p>)}
        {!draft && <button className="stablr-admin-white-button" type="button" disabled={busy || context.blockers.length > 0} onClick={() => operation(async () => accept(await invoke("open")))}>Modifica override SI</button>}
      </section>
      {draft && <section className="stablr-admin-detail-section"><h2>SI per buca e occorrenza</h2>
        <p>Scala della configurazione: {context.allowed_si.join(", ")}. Un valore vuoto usa lo SI della configurazione, non il fallback legacy.</p>
        <button className="stablr-admin-white-button" disabled={editingDisabled} type="button" onClick={resetToConfiguration}>Rimuovi override / Usa SI della configurazione</button>
        <div className="stablr-admin-editor-diff" role="table" aria-label="Griglia override SI tee">
          <div role="row"><strong role="columnheader">Buca · occorrenza</strong><strong role="columnheader">SI configurazione</strong><strong role="columnheader">Override SI</strong></div>
          {context.holes.map(row => <div role="row" key={row.slot_id}><span role="cell">Buca {row.position} · occorrenza {row.occurrence}</span><span role="cell">{row.standard_si}</span><span role="cell">
            <div className="stablr-admin-new-holes-input-control">
              <button aria-label={`SI buca ${row.position} precedente`} disabled={editingDisabled} type="button" onClick={() => stepSi(row,-1)}>‹</button>
              <input className="stablr-admin-input" aria-label={`Override SI buca ${row.position}`} type="number" min={scale[0]} max={scale[scale.length-1]} step="1" disabled={editingDisabled}
                aria-invalid={partialInput?.slotId === row.slot_id || undefined} aria-describedby={fieldError ? "tee-si-field-feedback" : undefined}
                value={partialInput?.slotId === row.slot_id ? partialInput.text : fields.holes.find(h => h.slot_id === row.slot_id)?.si ?? ""}
                onKeyDown={event => { if (["ArrowUp","ArrowDown"].includes(event.key)) { event.preventDefault();stepSi(row,event.key === "ArrowUp" ? 1 : -1); } }}
                onBlur={() => { if (partialInput?.slotId === row.slot_id) { setPartialInput(null);setFieldError("SI incompleto non confermato: mantenuto il valore precedente."); } }}
                onChange={event => updateSi(row,event.target.value)} />
              <button aria-label={`SI buca ${row.position} successivo`} disabled={editingDisabled} type="button" onClick={() => stepSi(row,1)}>›</button>
            </div></span></div>)}
        </div>
        {fieldError && <p role="alert" id="tee-si-field-feedback">{fieldError}</p>}
        {checks.blockers.length > 0 && <div role="alert">{checks.blockers.map(block => <p key={block}>{block}</p>)}</div>}
      </section>}
      <section className="stablr-admin-detail-section"><h2>Versioni SI pubblicate</h2>
        {!detail.history.length && <p>Nessuna versione SI pubblicata.</p>}
        <TechnicalRows label="Versioni SI" controlClassName="stablr-admin-abandon-button">{detail.history.map(version => <div key={version.version_id}><span>Versione {version.version_number} · {new Date(version.published_at).toLocaleString("it-IT")}</span><span>{version.note}</span>
          <details><summary>Differenze pubblicate</summary><div className="stablr-admin-editor-diff">{(version.diff?.holes || []).map(row => <div key={row.position}><span>Buca {row.position}</span><span>Prima: {row.before ?? "SI configurazione / legacy precedente"}</span><span>Dopo: {row.after ?? "SI configurazione"}</span></div>)}</div></details>
          <button className="stablr-admin-white-button" disabled={busy || !!draft} type="button" onClick={() => setRestore(version)}>Ripristina in nuova bozza</button></div>)}</TechnicalRows>
      </section>
    </>}
    {draft && <footer className="stablr-admin-abandon-zone"><button className="stablr-admin-abandon-button" type="button" disabled={editingDisabled} onClick={() => setAbandon(true)}>Abbandona bozza</button></footer>}
    {pending && <EditorDialog title="Modifiche non salvate">{error && <p role="alert">{error}</p>}<div className="stablr-admin-editor-header-actions">
      <button className="stablr-admin-white-button" disabled={busy || !!partialInput} type="button" onClick={() => operation(async () => { await save();registerExitGuard(null);pending(); })}>Salva bozza</button>
      <button className="stablr-admin-abandon-button" disabled={busy} type="button" onClick={() => { registerExitGuard(null);pending(); }}>Scarta</button><button className="stablr-admin-abandon-button" disabled={busy} type="button" onClick={() => setPending(null)}>Resta</button>
    </div></EditorDialog>}
    {preview && <EditorDialog title="Conferma pubblicazione SI"><p>Solo questo tee e ambito. Nessun altro SI, Par, rating o giro viene modificato.</p>
      {context.legacy_present && <p>La nuova griglia prevale sul fallback legacy per questo tee.</p>}
      <div className="stablr-admin-editor-diff" role="table" aria-label="Differenze SI Prima Dopo"><div role="row"><strong>Buca</strong><strong>Prima</strong><strong>Dopo</strong></div>
        <TechnicalRows label="Differenze SI" controlClassName="stablr-admin-abandon-button">{preview.changes.map(row => <div role="row" key={row.position}><span>{row.position}</span><span>{row.before ?? (context.legacy_present && !context.current ? "Legacy non attribuito" : `Configurazione: ${row.standard_si}`)}</span><span>{row.after ?? `Configurazione: ${row.standard_si}`}</span></div>)}</TechnicalRows>
      </div>
      {preview.blockers.map((block, i) => <p role="alert" key={i}>{block}</p>)}
      {preview.warnings.length > 0 && <section aria-label="Avvisi SI"><h3>Avvisi da confermare</h3>{preview.warnings.map(warning => <p key={warning}>{warning}</p>)}
        <label className="stablr-admin-si-warning-confirm"><input type="checkbox" disabled={busy} checked={warningsAccepted} onChange={e => setWarningsAccepted(e.target.checked)} />Ho verificato gli avvisi e confermo la scelta SI</label>
      </section>}
      {error && <p role="alert">{error}</p>}
      <label>Motivazione<textarea className="stablr-admin-input" value={note} maxLength={Math.max(0,1000-warningNote.length)} onChange={e => setNote(e.target.value)} /></label>
      <div className="stablr-admin-editor-header-actions"><button className="stablr-admin-publish-button" disabled={busy || !preview.can_publish || !note.trim() || publicationNote.length>1000 || (preview.warnings.length>0 && !warningsAccepted)} type="button" onClick={() => operation(async () => {
        await invoke("publish", { p_draft_id: draft.draft_id, p_revision: draft.revision, p_confirmation: preview.confirmation_hash, p_note: publicationNote });
        setPreview(null);setDraft(null);setFields(null);accept(await invoke("detail"));setMessage("SI pubblicati. Bozza chiusa.");
      })}>Conferma pubblicazione</button><button className="stablr-admin-abandon-button" disabled={busy} type="button" onClick={() => setPreview(null)}>Annulla</button></div>
    </EditorDialog>}
    {abandon && <EditorDialog title="Abbandona bozza SI"><p>Abbandonare la bozza? Le modifiche non pubblicate non saranno più riprese. Il catalogo pubblicato non cambia.</p>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-header-actions"><button className="stablr-admin-abandon-button stablr-admin-danger-button" disabled={busy} type="button" onClick={() => operation(async () => { await invoke("archive", { p_draft_id: draft.draft_id, p_revision: draft.revision });setAbandon(false);setDraft(null);setFields(null);registerExitGuard(null);onBack(); })}>Conferma abbandono</button>
      <button className="stablr-admin-abandon-button" disabled={busy} type="button" onClick={() => setAbandon(false)}>Annulla</button></div></EditorDialog>}
    {restore && <EditorDialog title="Ripristina versione SI"><p>Verrà creata una nuova bozza dalla versione {restore.version_number}. Nessuna modifica live o allo storico.</p>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-header-actions"><button className="stablr-admin-white-button" disabled={busy} type="button" onClick={() => operation(async () => { accept(await invoke("restore", { p_version_id: restore.version_id }));setRestore(null); })}>Crea bozza da versione</button>
      <button className="stablr-admin-abandon-button" disabled={busy} type="button" onClick={() => setRestore(null)}>Annulla</button></div></EditorDialog>}
  </section>;
}
