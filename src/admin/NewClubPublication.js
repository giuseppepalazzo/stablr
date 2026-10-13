import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { ratingCategoryLabel } from "./new-club-tees-data";

const checklistLabels = { club_name: "Nome Club valido", unique_name: "Nome non duplicato", provenance: "Provenienza e riferimenti disponibili",
  courses: "Almeno un Percorso attivo", holes: "Griglie buche complete con Par e SI validi", tees: "Tee attivi e rating validi per ogni Percorso" };
const publicationError = failure => ["40001", "55P03"].includes(failure?.code)
  ? "La bozza o il catalogo sono cambiati. Aggiorna l’anteprima prima di pubblicare."
  : failure?.code === "42501" ? "Non sei autorizzato a pubblicare questo Club."
    : "Pubblicazione non completata. La bozza rimane disponibile; aggiorna l’anteprima e riprova.";

export default function NewClubPublication({ draft, ownerId, service, dirty, disabled, onPublished, onModalChange, onReadyChange }) {
  const [plan, setPlan] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [retry, setRetry] = useState(0), [preview, setPreview] = useState(false), [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState(""), [busy, setBusy] = useState(false), [stale, setStale] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    if (disabled) return undefined;
    let active = true;setLoading(true);setError("");setPlan(null);
    service.previewClubPublication(draft, ownerId).then(result => { if (active) { setPlan(result);setStale(false); } })
      .catch(failure => { console.error("Admin new Club publication preview failed", failure?.code || "request_failed");if (active) setError("Impossibile verificare la completezza del Club. Riprova."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [draft, ownerId, service, disabled, retry]);
  useEffect(() => { onModalChange(preview || confirm || busy);return () => onModalChange(false); }, [preview, confirm, busy, onModalChange]);
  useEffect(() => { onReadyChange(!!plan?.can_publish && !dirty && !disabled && !loading && !stale); }, [plan, dirty, disabled, loading, stale, onReadyChange]);
  const refresh = () => { setPreview(false);setConfirm(false);setRetry(value => value + 1); };
  const publish = async () => {
    if (inFlight.current || dirty || disabled || stale) return;
    inFlight.current = true;
    setBusy(true);setError("");
    try { const result = await service.publishNewClub(draft, plan, note, ownerId);setConfirm(false);setPreview(false);onPublished(result); }
    catch (failure) { console.error("Admin new Club publication failed", failure?.code || "request_failed");setError(publicationError(failure));setStale(true); }
    finally { inFlight.current = false;setBusy(false); }
  };
  return <section className="stablr-admin-detail-section stablr-admin-new-club-publication" aria-label="Completezza e pubblicazione">
    <h2>Completezza e pubblicazione</h2>
    {loading && <p role="status">Verifica completezza…</p>}
    {plan && <><ul className="stablr-admin-new-club-checklist">{Object.entries(checklistLabels).map(([key, label]) => <li key={key}><span className="stablr-admin-status">{plan.checklist[key] ? "Completo" : "Da completare"}</span><span>{label}</span></li>)}</ul>
      {plan.blockers.map((block, i) => <p className="stablr-admin-detail-empty" key={i}>{block}</p>)}
      {plan.courses.filter(course => course.blockers.length).map(course => <div key={course.draft_id}><strong>{course.fields.name}</strong>{course.blockers.map((block, i) => <p className="stablr-admin-detail-empty" key={i}>{block}</p>)}</div>)}
      <p>La pubblicazione crea Club, Percorsi, buche e tee in una sola operazione. Fino alla conferma restano privati.</p>
    </>}
    {dirty && <p className="stablr-admin-detail-empty">Salva la bozza Club prima di aggiornare l’anteprima.</p>}
    {error && !confirm && <p role="alert">{error}</p>}
    <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" type="button" disabled={disabled || dirty || loading || !plan || stale} onClick={() => setPreview(true)}>Anteprima pubblicazione</button>
      <button className="stablr-admin-abandon-button" type="button" disabled={disabled || dirty || loading || busy} onClick={refresh}>{error || stale ? "Riprova completezza" : "Aggiorna completezza"}</button></div>
    {preview && <EditorDialog title="Anteprima pubblicazione Club"><p>Anteprima in sola lettura dei dati salvati. Nessun record live viene creato.</p>
      <h3>{plan.club.name}</h3><p>{plan.club.city || "Località non disponibile"} · {plan.club.fig_source ? "Provenienza FIG conservata" : "Creazione manuale"}</p>
      <p>{plan.counts.courses} percorsi · {plan.counts.holes} buche · {plan.counts.tees} tee</p>
      {plan.courses.map(course => <section className="stablr-admin-new-club-preview-course" key={course.draft_id}>
        <h3>{course.fields.name}</h3><p>{course.fields.holes_count} buche · Attivo · Totale Par: {course.total_par ?? "—"}</p>
        {course.blockers.map((block, i) => <p role="status" key={i}>{block}</p>)}
        {course.holes ? <div className="stablr-admin-new-tees-scroll"><table className="stablr-admin-new-tees-table"><thead><tr><th>Buca</th><th>Par</th><th>SI/HCP</th></tr></thead><tbody>{course.holes.map(hole => <tr key={hole.physical_hole_number}><th scope="row">{hole.physical_hole_number}</th><td>{hole.par ?? "—"}</td><td>{hole.stroke_index ?? "—"}</td></tr>)}</tbody></table></div> : <p>Griglia buche non disponibile.</p>}
        <div className="stablr-admin-new-tees-scroll"><table className="stablr-admin-new-tees-table"><thead><tr><th>Tee</th><th>Colore</th><th>Categoria</th><th>CR</th><th>Slope</th><th>Par</th><th>Stato</th></tr></thead><tbody>{course.tees.map(tee => <tr key={tee.draft_id}><th scope="row">{tee.fields.name}</th><td>{tee.fields.tee_color || "—"}</td><td>{ratingCategoryLabel(tee.fields.rating_category)}</td><td>{tee.fields.course_rating ?? "—"}</td><td>{tee.fields.slope_rating ?? "—"}</td><td>{tee.par_total ?? "—"}</td><td>{tee.fields.is_active ? "Attivo" : "Disattivato"}</td></tr>)}</tbody></table></div>
      </section>)}
      {!plan.can_publish && <p role="status">Completa i requisiti indicati prima della pubblicazione.</p>}
      <div className="stablr-admin-editor-actions stablr-admin-new-holes-dialog-actions"><button className="stablr-admin-publish-button" type="button" disabled={!plan.can_publish || busy || stale} onClick={() => { setNote("");setPreview(false);setConfirm(true); }}>Pubblica Club</button><button className="stablr-admin-abandon-button" type="button" onClick={() => setPreview(false)}>Chiudi anteprima</button></div>
    </EditorDialog>}
    {confirm && <EditorDialog title="Conferma pubblicazione Club"><p>Pubblicare «{plan.club.name}» con {plan.counts.courses} percorsi, {plan.counts.holes} buche e {plan.counts.tees} tee? Il Club diventerà visibile e giocabile.</p>
      <label className="stablr-admin-new-club-publication-note">Motivazione breve<textarea required maxLength={500} disabled={busy} value={note} onChange={event => setNote(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions stablr-admin-new-holes-dialog-actions"><button className="stablr-admin-publish-button" type="button" disabled={busy || dirty || disabled || stale || !note.trim()} onClick={publish}>Conferma pubblicazione Club</button><button className="stablr-admin-abandon-button" type="button" disabled={busy} onClick={() => { setConfirm(false);setError(""); }}>Annulla</button>{stale && <button className="stablr-admin-white-button" type="button" disabled={busy} onClick={refresh}>Aggiorna anteprima</button>}</div>
    </EditorDialog>}
  </section>;
}
