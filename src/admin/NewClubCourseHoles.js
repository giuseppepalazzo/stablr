import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { normalizeNewClubHoles, validateNewClubHoles } from "./new-club-holes-data";

const messageFor = (error) => ["40001", "55P03"].includes(error?.code)
  ? "La bozza o il Percorso sono cambiati. Riapri la griglia prima di salvare."
  : error?.code === "42501" ? "Non sei autorizzato a modificare questa griglia."
    : "Impossibile completare l’operazione sulle buche. Riprova.";

export default function NewClubCourseHoles({ target, ownerId, service, registerExitGuard, onBack, onGridChange }) {
  const [course, setCourse] = useState(target), [draft, setDraft] = useState(null), [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [pendingExit, setPendingExit] = useState(null), [abandon, setAbandon] = useState(false);
  const opening = useRef(null), inFlight = useRef(false), changeCallback = useRef(onGridChange);
  changeCallback.current = onGridChange;
  const dirty = !!draft && JSON.stringify(normalizeNewClubHoles(snapshot)) !== JSON.stringify(normalizeNewClubHoles(draft.snapshot));
  const checks = snapshot ? validateNewClubHoles(snapshot) : null;
  useEffect(() => {
    let active = true;setLoading(true);setError("");
    if (!opening.current) opening.current = service.openCourseHoleDraft(target, ownerId);
    opening.current.then((opened) => {
      if (active) { setCourse(opened.course);setDraft(opened.draft);setSnapshot(normalizeNewClubHoles(opened.draft.snapshot));changeCallback.current(opened.course, opened.draft); }
    }).catch((failure) => {
      console.error("Admin private hole grid open failed", failure?.code || "request_failed");if (active) setError(messageFor(failure));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [target, ownerId, service, retry]);
  useEffect(() => {
    registerExitGuard((action) => {
      if (inFlight.current || loading || pendingExit || abandon) return;
      if (dirty) setPendingExit(() => action);else action();
    });
    const beforeUnload = (event) => { if (dirty) { event.preventDefault();event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { registerExitGuard(null);window.removeEventListener("beforeunload", beforeUnload); };
  }, [dirty, loading, pendingExit, abandon, registerExitGuard]);
  const operation = async (action) => {
    if (inFlight.current) return;
    inFlight.current = true;setBusy(true);setError("");setMessage("");
    try { await action(); }
    catch (failure) { console.error("Admin private hole grid operation failed", failure?.code || "request_failed");setError(messageFor(failure)); }
    finally { inFlight.current = false;setBusy(false); }
  };
  const save = async () => {
    const saved = await service.saveCourseHoleDraft(course, draft, snapshot, ownerId);
    setDraft(saved);setSnapshot(normalizeNewClubHoles(saved.snapshot));changeCallback.current(course, saved);
    setMessage(validateNewClubHoles(saved.snapshot).configured ? "Bozza buche salvata. Buche configurate." : "Bozza buche salvata. Completa Par e SI/HCP per configurare il Percorso.");
  };
  const update = (index, key, value) => {
    const label = key === "par" ? "Par" : "SI/HCP";
    if (value === "") {
      setFieldError("");setMessage("");setSnapshot((previous) => ({ ...previous, holes: previous.holes.map((hole, i) => i === index ? { ...hole, [key]: null } : hole) }));
      return;
    }
    const number = Number(value), max = key === "par" ? 5 : snapshot.holes_count;
    if (!Number.isInteger(number) || number < (key === "par" ? 3 : 1) || number > max) {
      setFieldError(`${label} deve essere ${key === "par" ? "3, 4 o 5" : `un intero da 1 a ${max}`}.`);return;
    }
    if (key === "stroke_index") {
      const duplicate = snapshot.holes.find((hole, holeIndex) => holeIndex !== index && Number(hole.stroke_index) === number);
      if (duplicate) { setFieldError(`SI/HCP ${number} è già assegnato alla buca ${duplicate.physical_hole_number}.`);return; }
    }
    setFieldError("");setMessage("");setSnapshot((previous) => ({ ...previous, holes: previous.holes.map((hole, i) => i === index ? { ...hole, [key]: number } : hole) }));
  };
  const cycle = (index, key, direction) => {
    const values = key === "par" ? [3, 4, 5] : Array.from({ length: snapshot.holes_count }, (_, value) => value + 1);
    const current = Number(snapshot.holes[index][key]);
    const used = key === "stroke_index" ? new Set(snapshot.holes.filter((_, holeIndex) => holeIndex !== index).map((hole) => Number(hole.stroke_index)).filter(Number.isInteger)) : null;
    let position = values.indexOf(current);
    for (let attempts = 0; attempts < values.length; attempts += 1) {
      position = position < 0 ? (direction > 0 ? 0 : values.length - 1) : (position + direction + values.length) % values.length;
      if (!used || !used.has(values[position])) { update(index, key, String(values[position]));return; }
    }
    setFieldError("Ogni SI/HCP da 1 a " + snapshot.holes_count + " è già assegnato.");
  };
  const holeControl = (hole, index, key) => {
    const label = key === "par" ? "Par" : "SI/HCP", min = key === "par" ? 3 : 1, max = key === "par" ? 5 : snapshot.holes_count;
    return <div className="stablr-admin-new-holes-input-control">
      <button aria-label={`Buca ${hole.physical_hole_number} ${label} precedente`} disabled={busy || !!pendingExit || abandon} type="button" onClick={() => cycle(index, key, -1)}>‹</button>
      <input aria-label={`Buca ${hole.physical_hole_number} ${label}`} type="number" min={min} max={max} step={1} value={hole[key] ?? ""} disabled={busy || !!pendingExit || abandon}
        onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault();cycle(index, key, event.key === "ArrowUp" ? 1 : -1); } }}
        onChange={(event) => update(index, key, event.target.value)} />
      <button aria-label={`Buca ${hole.physical_hole_number} ${label} successivo`} disabled={busy || !!pendingExit || abandon} type="button" onClick={() => cycle(index, key, 1)}>›</button>
    </div>;
  };
  return <>
    <EditorDialog title={`Configura buche · ${course.snapshot.name}`}>
      <p>Griglia privata del Percorso. Nessuna pubblicazione.</p>
      {loading && <p role="status">Caricamento buche…</p>}
      {draft && <>
        <div className="stablr-admin-editor-actions"><button className="stablr-admin-draft-save-button" type="button" disabled={busy || !!pendingExit || abandon || !checks.canSave} onClick={() => operation(save)}>Salva bozza buche</button></div>
        <p className="stablr-admin-new-holes-summary">{snapshot.holes_count} buche · <strong>Totale Par: {checks.totalPar ?? "—"}{checks.totalPar != null && !checks.completePar ? " (parziale)" : ""}</strong> · <span className="stablr-admin-status">{checks.configured ? "Buche configurate" : "Da completare"}</span></p>
        {(!checks.completePar || !checks.parValid) && <p className="stablr-admin-detail-empty">Compila tutti i Par: sono ammessi solo 3, 4 o 5.</p>}
        {!checks.siValid && <p role="status">Gli SI/HCP devono essere interi da 1 a {snapshot.holes_count}.</p>}
        {(checks.missingSi.length > 0 || checks.duplicateSi) && <p className="stablr-admin-detail-empty">SI/HCP univoci richiesti da 1 a {snapshot.holes_count}.{checks.duplicateSi ? " Sono presenti duplicati." : ""}{checks.missingSi.length > 0 ? ` Mancanti: ${checks.missingSi.join(", ")}.` : ""} La bozza può essere salvata, ma il Percorso resta da completare.</p>}
        <div className="stablr-admin-new-holes-scroll"><table className="stablr-admin-new-holes-table"><thead><tr><th scope="col">Buca</th><th scope="col">Par</th><th scope="col">SI/HCP</th></tr></thead><tbody>
          {snapshot.holes.map((hole, i) => <tr key={hole.physical_hole_number}><th scope="row">{hole.physical_hole_number}</th>
            <td>{holeControl(hole, i, "par")}</td>
            <td>{holeControl(hole, i, "stroke_index")}</td>
          </tr>)}
        </tbody></table></div>
        {fieldError && <p className="stablr-admin-detail-empty" role="status">{fieldError}</p>}
        <p className="stablr-admin-detail-empty">Anche con buche configurate, Club e Percorso restano privati e non pubblicabili. Tee e rating si gestiscono separatamente nel Percorso.</p>
        {dirty && <p>Modifiche buche non salvate</p>}
        {message && <p role="status">{message}</p>}
        <div className="stablr-admin-abandon-zone"><button className="stablr-admin-abandon-button" disabled={busy || !!pendingExit || abandon} type="button" onClick={() => { setError("");setAbandon(true); }}>Abbandona bozza buche</button></div>
      </>}
      {error && !pendingExit && !abandon && <p role="alert">{error}</p>}
      {!loading && !draft && <button className="stablr-admin-white-button" type="button" onClick={() => { opening.current = null;setRetry((value) => value + 1); }}>Riprova buche</button>}
      <button className="stablr-admin-abandon-button stablr-admin-new-holes-return-button" disabled={loading || busy || !!pendingExit || abandon} type="button" onClick={() => { if (dirty) setPendingExit(() => onBack);else onBack(); }}>Torna al Percorso</button>
    </EditorDialog>
    {pendingExit && <EditorDialog title="Modifiche buche non salvate"><p>Salva la bozza oppure scarta solo le modifiche non salvate. La griglia salvata rimane disponibile.</p>{error && <p role="alert">{error}</p>}<div className="stablr-admin-editor-actions stablr-admin-new-holes-dialog-actions">
      <button className="stablr-admin-white-button" type="button" disabled={busy || !checks?.canSave} onClick={() => operation(async () => { await save();const exit = pendingExit;setPendingExit(null);exit(); })}>Salva bozza</button>
      <button type="button" disabled={busy} onClick={() => { const exit = pendingExit;setPendingExit(null);exit(); }}>Scarta modifiche</button>
      <button className="stablr-admin-abandon-button" type="button" disabled={busy} onClick={() => { setPendingExit(null);setError("");setAbandon(true); }}>Abbandona bozza</button>
      <button type="button" disabled={busy} onClick={() => { setPendingExit(null);setError(""); }}>Resta</button>
    </div></EditorDialog>}
    {abandon && <EditorDialog title="Abbandona bozza buche"><p>Abbandonare la bozza delle buche? La griglia viene archiviata e non sarà più ripresa. Il Percorso resta nella bozza privata del Club.</p>{error && <p role="alert">{error}</p>}<div className="stablr-admin-editor-actions stablr-admin-new-holes-dialog-actions"><button className="stablr-admin-danger-button" disabled={busy} type="button" onClick={() => operation(async () => { await service.abandonCourseHoleDraft(course, draft, ownerId);changeCallback.current(course, null);onBack(); })}>Conferma abbandono buche</button><button type="button" disabled={busy} onClick={() => { setAbandon(false);setError(""); }}>Annulla</button></div></EditorDialog>}
  </>;
}
