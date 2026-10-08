import { useCallback, useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";

export const physicalSourceProblems = {
  unclassified_structure: "La struttura deve essere classificata e verificata manualmente prima di registrare le buche.",
  inactive_source: "Il Percorso o il club sorgente non è attivo nel catalogo pubblicato.",
  wrong_cardinality: "La cardinalità del Percorso non è compatibile con la struttura: fisico_9 richiede 9 buche, fisico_18 ne richiede 18 e multi_9 un singolo Percorso da 9.",
  derived_source: "La sorgente contiene metadati espliciti di derivazione o una sequenza fisica dedicata. La sua riconciliazione richiede il contratto successivo e non è gestita in questa fase.",
  incomplete_holes: "Il numero di record buca non coincide con le 9/18 buche dichiarate dal Percorso.",
  duplicate_numbers: "La numerazione contiene doppioni: la registrazione 1:1 è bloccata.",
  incomplete_numbers: "La numerazione è incompleta o incompatibile: sono richieste 1–9 o 1–18; in multi_9 anche 10–18 per una seconda nove già numerata così. Non vengono applicati offset.",
  missing_par: "Sono necessari Par presenti e validi (3–6) per tutte le buche fisiche.",
  already_linked_elsewhere: "Il Percorso o la struttura è già collegato diversamente. La corrispondenza esistente non viene sostituita.",
  physical_numbers_in_use: "Una o più identità/numerazioni sono già registrate nella fondazione. Non vengono riconciliate per nome, Par o offset.",
  source_changed: "Il Percorso sorgente è cambiato dopo la registrazione. La verifica è bloccata; le identità registrate restano conservate.",
  invalid_saved_mapping: "La corrispondenza salvata non è completa o coerente con le identità fisiche e la sorgente. È necessaria una revisione."
};
const format = (value) => value == null ? "—" : String(value);
function Grid({ rows, mapping = false, readable = false }) {
  return <div className="stablr-admin-physical-grid" role="table" aria-label={mapping ? "Collegamento fisico uno a uno" : "Anteprima buche sorgente"}>
    <div role="row"><strong role="columnheader">Ordine</strong><strong role="columnheader">Numero sorgente</strong><strong role="columnheader">Par {mapping ? "base" : "sorgente"}</strong><strong role="columnheader">{mapping ? "Identità fisica" : "Buca sorgente"}</strong></div>
    {rows.map((hole, index) => <div role="row" key={hole.id || hole.physical_hole_id}><span role="cell">{mapping ? hole.position : index + 1}</span><span role="cell">{mapping ? hole.physical_number : hole.physical_hole_number}</span><span role="cell">{format(mapping ? hole.base_par : hole.par)}</span><span role="cell">{readable ? <>Buca {mapping ? hole.physical_number : hole.physical_hole_number}{mapping && <small>Revisione {hole.revision}</small>}<details><summary>Riferimenti</summary>{mapping ? `${hole.physical_hole_id} · ${hole.source_hole_id}` : hole.id}</details></> : mapping ? <>{hole.physical_hole_id}<small>Sorgente: {hole.source_hole_id} · Revisione {hole.revision}</small></> : hole.id}</span></div>)}
  </div>;
}

export default function PhysicalCourseHoles({ structure, service, onEvents, onBusy, onChanged }) {
  const [context, setContext] = useState(null);
  const [courseId, setCourseId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const request = useRef(0), inFlight = useRef(false);
  const apply = useCallback((result) => {
    if (!result?.structure?.id || !Array.isArray(result.physical_holes) || !Array.isArray(result.reasons)
      || !Array.isArray(result.mapping) || !Array.isArray(result.events)) throw new Error("Invalid physical source response");
    setContext(result); onEvents(result.events);
  }, [onEvents]);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    setLoading(true); setError("");
    try { const result = await service.physicalPreview(structure.id, courseId || null); if (sequence === request.current) apply(result); }
    catch (failure) { console.error("Admin physical source preview failed", failure); if (sequence === request.current) setError("Impossibile caricare le buche fisiche. Ricarica l’anteprima."); }
    finally { if (sequence === request.current) setLoading(false); }
  }, [service, structure.id, courseId, apply]);
  useEffect(() => { load(); return () => { request.current += 1; }; }, [load]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = confirmation.kind === "register" ? await service.registerPhysicalHoles(confirmation.context, confirmation.note)
        : await service.verifyPhysicalCourse(confirmation.context, confirmation.note);
      apply(result); setNote(""); setConfirmation(null);
      onChanged?.();
      setMessage(confirmation.kind === "register" ? "Buche registrate nella fondazione. Il collegamento al Percorso è Da revisionare."
        : "Collegamento fisico 1:1 verificato nella fondazione.");
    } catch (failure) {
      console.error("Admin physical course decision failed", failure);
      setError(failure?.code === "40001" ? "La sorgente o la revisione è cambiata. Annulla e ricarica l’anteprima prima di confermare."
        : failure?.code === "55P03" ? "La sorgente è temporaneamente occupata. Annulla e ricarica l’anteprima."
          : failure?.code === "42501" ? "Non sei autorizzato a gestire le buche fisiche."
            : "Operazione bloccata. Annulla e ricarica l’anteprima per verificare la compatibilità della sorgente.");
    } finally { inFlight.current = false; setBusy(false); }
  };
  const selected = context?.source?.course;
  const activeSource = selected?.id === courseId;
  const readable = structure.classification === "fisico_18";
  return <section className="stablr-admin-detail-section"><h2>Buche fisiche</h2>
    {loading && <p role="status">Caricamento buche fisiche…</p>}
    {error && !confirmation && <div role="alert"><p>{error}</p><button className="stablr-admin-white-button" disabled={busy} onClick={load} type="button">Ricarica anteprima</button></div>}
    {message && <p role="status">{message}</p>}
    {context && !loading && !error && <>
      {!context.physical_holes.length ? <p>Nessuna buca fisica registrata.</p> : <>
        <p>{context.physical_holes.length} identità fisiche registrate nella struttura.</p>
        <div className="stablr-admin-physical-grid" role="table" aria-label="Buche fisiche registrate"><div role="row"><strong role="columnheader">Numero fisico</strong><strong role="columnheader">Par base</strong><strong role="columnheader">Origine</strong><strong role="columnheader">Revisione</strong></div>{context.physical_holes.map((hole) => <div role="row" key={hole.id}><span role="cell">{hole.physical_number}</span><span role="cell">{format(hole.base_par)}</span><span role="cell">{readable ? <>Buca sorgente {hole.source_position}<details><summary>Provenienza</summary>{hole.source_reference}</details></> : hole.source_reference}</span><span role="cell">{hole.revision}</span></div>)}</div>
      </>}
      <label className="stablr-admin-structure-selector">Percorso pubblicato sorgente<select disabled={busy} value={courseId} onChange={(event) => { setCourseId(event.target.value); setNote(""); setMessage(""); setContext(null); }}><option value="">Scegli esplicitamente il Percorso</option>{(context.courses || []).map((course) => <option key={course.id} value={course.id}>{course.name} · {course.holes_count} buche</option>)}</select></label>
      {!context.courses?.length && <p>Nessun Percorso pubblicato disponibile per questo club.</p>}
      {activeSource && <>
        <h3>Anteprima sorgente · sola lettura</h3>
        <p>{selected.name} · {selected.holes_count} buche · Fonte registrata: {selected.source_system || "—"}</p>
        <Grid rows={context.source.holes} readable={readable} />
        <p className="stablr-admin-detail-empty">Provenienza della registrazione: Percorso STABLR pubblicato. Numerazione, Par e metadati importati vengono conservati nello snapshot sorgente. Il SI non viene assegnato alla buca fisica.</p>
        <details className="stablr-admin-structure-payload"><summary>Fonte e snapshot del Percorso</summary><pre>{JSON.stringify(context.source, null, 2)}</pre></details>
        {context.reasons.length > 0 && <div role="alert">{context.reasons.map((reason) => <p key={reason}>{physicalSourceProblems[reason] || "Sorgente incompatibile con la registrazione fisica."}</p>)}</div>}
        {context.link?.structure_id === structure.id && <>
          <h3>Collegamento Percorso → buche fisiche</h3>
          <p><span className="stablr-admin-status">{context.link.review_status === "verified" ? "Verificato" : "Da revisionare"}</span> · Revisione {context.link.revision}</p>
          <Grid rows={context.mapping} mapping readable={readable} />
          <details className="stablr-admin-structure-payload"><summary>Sorgente conservata alla registrazione</summary><pre>{JSON.stringify(context.link.source_snapshot, null, 2)}</pre></details>
        </>}
        {(context.can_register || context.can_verify) && <>
          <label className="stablr-admin-structure-selector">Nota {context.can_register ? "di registrazione" : "di verifica 1:1"}<textarea disabled={busy} value={note} onChange={(event) => setNote(event.target.value)} required /></label>
          <button className="stablr-admin-white-button" disabled={busy || !note.trim()} onClick={() => setConfirmation({ kind: context.can_register ? "register" : "verify", context, note: note.trim() })} type="button">{context.can_register ? "Registra buche fisiche" : "Verifica collegamento 1:1"}</button>
        </>}
      </>}
    </>}
    {confirmation && <EditorDialog title={confirmation.kind === "register" ? "Conferma registrazione buche fisiche" : "Conferma collegamento fisico 1:1"}>
      <p>{confirmation.context.source.course.name} → {structure.label}</p>
      {confirmation.kind === "register" ? <><p>Verranno create {confirmation.context.source.holes.length} identità fisiche con i Par e i numeri esatti mostrati. La corrispondenza con la sorgente sarà registrata come Da revisionare.</p><Grid rows={confirmation.context.source.holes} readable={readable} /></>
        : <><p>La corrispondenza esatta mostrata, nell’ordine registrato, sarà confermata come Verificata. Revisione attesa: {confirmation.context.link.revision}.</p><Grid rows={confirmation.context.mapping} mapping readable={readable} /></>}
      <p>Nota: {confirmation.note}</p><p>Verranno aggiornati solo fondazione e audit. Il catalogo pubblicato resta invariato.</p>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy} onClick={confirm} type="button">{confirmation.kind === "register" ? "Conferma registrazione" : "Conferma collegamento"}</button><button disabled={busy} onClick={() => setConfirmation(null)} type="button">Annulla</button></div>
    </EditorDialog>}
  </section>;
}
