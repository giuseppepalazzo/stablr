import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import NewClubCourses from "./NewClubCourses";
import { ratingCategoryLabel } from "./new-club-tees-data";

function CoursePublication({ club, draft, ownerId, service, onClose, onPublished }) {
  const [plan, setPlan] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(false), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [stale, setStale] = useState(false), [retry, setRetry] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;setLoading(true);setError("");setPlan(null);
    service.previewCoursePublication(club, draft, ownerId).then(result => { if (active) { setPlan(result);setStale(false); } })
      .catch(failure => { console.error("Admin new course preview failed", failure?.code || "request_failed");if (active) setError("Impossibile verificare il nuovo Percorso. Riprova."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [club, draft, ownerId, service, retry]);
  const publish = async () => {
    if (inFlight.current || !plan?.can_publish || stale || !note.trim()) return;
    inFlight.current = true;setBusy(true);setError("");
    try { onPublished(await service.publishCourse(club, draft, plan, note, ownerId)); }
    catch (failure) { console.error("Admin new course publication failed", failure?.code || "request_failed");setStale(true);
      setError(["40001", "55P03"].includes(failure?.code) ? "La bozza o il Club sono cambiati. Aggiorna l’anteprima prima di confermare."
        : "Pubblicazione non completata. La bozza rimane disponibile; aggiorna l’anteprima."); }
    finally { inFlight.current = false;setBusy(false); }
  };
  const refresh = () => { setConfirm(false);setRetry(value => value + 1); };
  return <EditorDialog title={confirm ? "Conferma pubblicazione Percorso" : "Anteprima pubblicazione Percorso"}>
    {loading && <p role="status">Verifica completezza…</p>}
    {error && <p role="alert">{error}</p>}
    {plan && <>
      <h3>{plan.course.fields.name} · {plan.club.name}</h3>
      <p>{plan.course.fields.holes_count} buche · Totale Par: {plan.course.total_par ?? "—"} · {plan.counts.tees} tee</p>
      {confirm ? <>
        <p>La conferma crea soltanto il nuovo Percorso, le sue buche e i suoi tee. Gli altri dati del Club restano invariati.</p>
        <label className="stablr-admin-new-club-publication-note">Motivazione breve<textarea required maxLength={500} disabled={busy} value={note} onChange={event => setNote(event.target.value)} /></label>
      </> : <>
        <p>Anteprima in sola lettura. Il Percorso resta privato fino alla conferma finale.</p>
        <ul className="stablr-admin-new-club-checklist">{[["unique_name", "Nome Percorso non duplicato"], ["club_playable", "Club attivo e giocabile"], ["holes", "Griglia completa con Par e SI validi"], ["tees", "Almeno un tee attivo con rating validi"]].map(([key, label]) => <li key={key}><span className="stablr-admin-status">{plan.checklist[key] ? "Completo" : "Da completare"}</span>{label}</li>)}</ul>
        {plan.blockers.map((block, index) => <p role="status" key={index}>{block}</p>)}
        <div className="stablr-admin-new-tees-scroll"><table className="stablr-admin-new-tees-table"><thead><tr><th>Buca</th><th>Par</th><th>SI/HCP</th></tr></thead><tbody>{(plan.course.holes || []).map(hole => <tr key={hole.physical_hole_number}><th scope="row">{hole.physical_hole_number}</th><td>{hole.par ?? "—"}</td><td>{hole.stroke_index ?? "—"}</td></tr>)}</tbody></table></div>
        <div className="stablr-admin-new-tees-scroll"><table className="stablr-admin-new-tees-table"><thead><tr><th>Tee</th><th>Colore</th><th>Categoria</th><th>CR</th><th>Slope</th><th>Par</th><th>Stato</th></tr></thead><tbody>{plan.course.tees.map(tee => <tr key={tee.draft_id}><th scope="row">{tee.fields.name}</th><td>{tee.fields.tee_color || "—"}</td><td>{ratingCategoryLabel(tee.fields.rating_category)}</td><td>{tee.fields.course_rating ?? "—"}</td><td>{tee.fields.slope_rating ?? "—"}</td><td>{tee.par_total ?? "—"}</td><td>{tee.fields.is_active ? "Attivo" : "Disattivato"}</td></tr>)}</tbody></table></div>
      </>}
    </>}
    <div className="stablr-admin-editor-actions stablr-admin-new-holes-dialog-actions">
      {confirm ? <button className="stablr-admin-publish-button" type="button" disabled={busy || stale || !note.trim()} onClick={publish}>Conferma pubblicazione Percorso</button>
        : <button className="stablr-admin-publish-button" type="button" disabled={loading || busy || stale || !plan?.can_publish} onClick={() => { setNote("");setConfirm(true); }}>Pubblica Percorso</button>}
      {(error || stale) && <button className="stablr-admin-white-button" type="button" disabled={busy} onClick={refresh}>Aggiorna anteprima</button>}
      <button className="stablr-admin-abandon-button" type="button" disabled={busy} onClick={onClose}>{confirm ? "Annulla" : "Chiudi anteprima"}</button>
    </div>
  </EditorDialog>;
}

export default function ExistingClubCourses({ club, ownerId, service, registerExitGuard, onBack, onPublished }) {
  const parent = useMemo(() => ({ club_id: club.id }), [club.id]);
  const [preview, setPreview] = useState(null), [editing, setEditing] = useState(false);
  const localGuard = useRef(null);
  const register = useCallback(guard => { localGuard.current = guard; }, []);
  useEffect(() => {
    registerExitGuard(action => { if (preview) return;if (localGuard.current) localGuard.current(action);else action(); });
    return () => registerExitGuard(null);
  }, [preview, registerExitGuard]);
  return <section className="stablr-admin-detail">
    <nav className="stablr-admin-breadcrumb" aria-label="Percorso di navigazione"><button type="button" disabled={!!preview} onClick={onBack}>{club.name}</button><span>/</span><span>Nuovi Percorsi</span></nav>
    <header className="stablr-admin-page-header"><div><h1>Nuovi Percorsi</h1><p>{club.name} · bozze private Admin</p></div><span className="stablr-admin-status">Non pubblicati</span></header>
    <NewClubCourses parent={parent} ownerId={ownerId} service={service} scope="existingClub" disabled={!!preview}
      registerExitGuard={register} onEditingChange={setEditing} onPreviewPublication={draft => { if (!editing) setPreview(draft); }} />
    {preview && <CoursePublication club={parent} draft={preview} ownerId={ownerId} service={service} onClose={() => setPreview(null)} onPublished={result => { registerExitGuard(null);onPublished(result); }} />}
  </section>;
}
