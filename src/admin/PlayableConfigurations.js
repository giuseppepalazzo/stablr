import { useCallback, useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";

export const CONFIGURATION_KINDS = { autonomous_9: "9 autonoma", repeated_18: "18 derivata (9 × 2)" };
export const PHYSICAL18_KINDS = { autonomous_18: "18 autonoma · fisiche 1–18", front_9: "9 derivata · fisiche 1–9", back_9: "9 derivata · fisiche 10–18" };
export const configurationProblems = {
  verified_eighteen_required: "Occorre una struttura fisico_18 classificata e verificata manualmente.",
  verified_eighteen_source_required: "Registra e verifica prima il collegamento fisico del Percorso 18.",
  wrong_cardinality_or_source: "La configurazione 18 richiede il medesimo Percorso fisico 18. Le due nove richiedono una sorgente pubblicata da 9 buche.",
  inactive_source: "Il Percorso o il club sorgente non è attivo.",
  invalid_source_grid: "La sorgente deve avere tutte le buche numerate 1–9 o 1–18, Par validi e totale coerente, SI presenti e distinti da 1 a 18. I SI non vengono rinumerati.",
  par_mismatch: "Il Par della sorgente non coincide con le buche fisiche dell’intervallo scelto o con il totale del Percorso. Occorre una revisione manuale.",
  verified_nine_required: "Questa fase richiede una struttura fisico_9 classificata e verificata manualmente.",
  verified_source_required: "Il collegamento al Percorso fisico da 9 buche deve essere verificato.",
  physical_source_changed: "Buche, numerazione, Par o sorgente fisica non sono completi e coerenti con il collegamento verificato. Occorre una revisione.",
  incomplete_sequence: "La sequenza non contiene tutte le occorrenze fisiche richieste.",
  invalid_configuration_si: "I SI sorgente non producono una configurazione completa con valori distinti: 9 SI reali da 1 a 18 per la nove, oppure tutti i SI 1–18 per la diciotto. Non vengono rinumerati.",
  configuration_collision: "Esiste già una configurazione per questa sorgente e questo ambito, oppure un nome registrato coincidente. La registrazione non viene duplicata o riconciliata automaticamente.",
  verified_parent_required: "Registra e verifica prima la configurazione 9 autonoma da usare come padre.",
  parent_changed: "La configurazione padre non coincide più con la sequenza fisica e i SI sorgente.",
  registration_base_changed: "La sorgente, i tee o la base della configurazione sono cambiati dopo la registrazione. La verifica richiede una revisione.",
  invalid_saved_configuration: "La configurazione registrata non corrisponde alla sequenza completa prevista. La verifica è bloccata."
};

function Sequence({ context }) {
  const total = context.sequence.reduce((sum, hole) => sum + Number(hole.effective_par || 0), 0);
  const physical18 = Object.hasOwn(PHYSICAL18_KINDS, context.kind);
  const parLabel = context.par_selection === "source" ? "conservato dalla sorgente · override esplicito" : "ereditato dalle buche fisiche";
  return <>
    <p>Origine: {context.source_name} · Par {parLabel} · Totale Par {total}</p>
    <p className="stablr-admin-detail-empty">{physical18
      ? `Intervallo fisico ${context.baseline?.interval_start}–${context.baseline?.interval_end}, scelto esplicitamente. SI copiati dal Percorso sorgente, senza calcoli o rinumerazione. Tee e rating esclusi.`
      : context.kind === "repeated_18"
      ? "Sequenza 1–9 ripetuta due volte. SI della prima tornata = SI base; seconda tornata = min(18, SI base + 1)."
      : "Sequenza fisica 1–9. SI della configurazione conservati esattamente dalla sorgente."}</p>
    {context.parent_label && <p>Configurazione padre: {context.parent_label}</p>}
    <div className={`stablr-admin-playable-grid${physical18 ? " stablr-admin-playable-physical18" : ""}`} role="table" aria-label="Anteprima configurazione giocabile">
      <div role="row"><strong role="columnheader">Ordine</strong>{physical18 && <strong role="columnheader">Buca sorgente</strong>}<strong role="columnheader">Buca fisica</strong><strong role="columnheader">Occorrenza</strong><strong role="columnheader">Par effettivo</strong><strong role="columnheader">SI configurazione</strong></div>
      {context.sequence.map((hole) => <div role="row" key={hole.position}><span role="cell">{hole.position}</span>{physical18 && <span role="cell">Buca {hole.source_number}</span>}<span role="cell">{hole.physical_label || `Buca ${hole.physical_number}`}</span><span role="cell">{hole.occurrence}</span><span role="cell">{hole.effective_par ?? "—"} · {hole.par_mode === "override" ? "override esplicito" : "ereditato"}</span><span role="cell">{hole.stroke_index ?? "—"}</span></div>)}
    </div>
    {physical18 && <details className="stablr-admin-structure-payload"><summary>Provenienza e snapshot del Percorso sorgente</summary><pre>{JSON.stringify(context.baseline?.source, null, 2)}</pre></details>}
  </>;
}

function TeeEvidence({ context }) {
  const matrix = context.tee_matrix;
  const entries = matrix?.tees && typeof matrix.tees === "object" ? Object.entries(matrix.tees) : [];
  const present = matrix != null || context.tee_overrides.length > 0;
  return <div className="stablr-admin-playable-tees"><h3>Override tee · sola lettura</h3>
    {!present ? <p>Nessun override tee disponibile nella sorgente.</p> : <>
      <p>La sorgente contiene una matrice tee o override registrati. Restano separati dal Par ereditato e dal SI della configurazione; questa operazione non li applica, modifica o copia.</p>
      {entries.map(([key, tee]) => <article className="stablr-admin-structure-evidence" key={key}><strong>Tee {key}</strong>
        {Array.isArray(tee?.holes) && <div className="stablr-admin-playable-tee-grid" role="table" aria-label={`Evidenze tee ${key}`}>
          <div role="row"><strong role="columnheader">Buca fisica</strong><strong role="columnheader">Par tee</strong><strong role="columnheader">SI tee per tornata</strong></div>
          {tee.holes.map((hole, index) => <div role="row" key={index}><span role="cell">{hole.physical_hole_number ?? "—"}</span><span role="cell">{hole.par ?? "—"}</span><span role="cell">{Array.isArray(hole.stroke_indexes) ? hole.stroke_indexes.join(" / ") : "—"}</span></div>)}
        </div>}</article>)}
      {context.tee_overrides.length > 0 && <p>{context.tee_overrides.length} override già registrati nella fondazione, conservati senza modifiche.</p>}
      <details className="stablr-admin-structure-payload"><summary>Provenienza e dati originali degli override tee</summary><pre>{JSON.stringify({ matrix, foundation: context.tee_overrides }, null, 2)}</pre></details>
    </>}
  </div>;
}

export default function PlayableConfigurations({ structure, service, onEvents, onBusy, refreshKey = 0, physical18 = false }) {
  const [context, setContext] = useState(null);
  const [linkId, setLinkId] = useState("");
  const [kind, setKind] = useState("");
  const [courseId, setCourseId] = useState("");
  const [parSelection, setParSelection] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const request = useRef(0), inFlight = useRef(false);
  const apply = useCallback((result) => {
    if (result?.structure?.id !== structure.id || !Array.isArray(result.sequence) || !Array.isArray(result.reasons)
      || !Array.isArray(result.saved_holes) || !Array.isArray(result.source_links) || !Array.isArray(result.configurations)
      || !(physical18 ? Array.isArray(result.courses) : Array.isArray(result.tee_overrides)) || !Array.isArray(result.events)) throw new Error("Invalid playable configuration response");
    setContext(result); onEvents(result.events);
  }, [structure.id, onEvents, physical18]);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    setLoading(true); setError("");
    try { const result = physical18
      ? await service.physical18Preview(structure.id, linkId || null, kind || null, courseId || null, parSelection || null)
      : await service.playablePreview(structure.id, linkId || null, kind || null); if (sequence === request.current) apply(result); }
    catch (failure) { console.error("Admin playable configuration preview failed", failure); if (sequence === request.current) setError("Impossibile caricare le configurazioni giocabili. Ricarica l’anteprima."); }
    finally { if (sequence === request.current) setLoading(false); }
  }, [service, structure.id, linkId, kind, courseId, parSelection, physical18, apply]);
  useEffect(() => { load(); return () => { request.current += 1; }; }, [load, refreshKey]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  const select = (setter) => (event) => { setter(event.target.value); setNote(""); setMessage(""); setContext(null); };
  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = physical18
        ? confirmation.kind === "register" ? await service.registerPhysical18(confirmation.context, confirmation.note) : await service.verifyPhysical18(confirmation.context, confirmation.note)
        : confirmation.kind === "register" ? await service.registerPlayable(confirmation.context, confirmation.note) : await service.verifyPlayable(confirmation.context, confirmation.note);
      apply(result); setConfirmation(null); setNote("");
      setMessage(confirmation.kind === "register" ? "Configurazione registrata nella fondazione: Da revisionare." : "Configurazione verificata nella fondazione.");
    } catch (failure) {
      console.error("Admin playable configuration decision failed", failure);
      setError(failure?.code === "40001" ? "La base o la revisione è cambiata. Annulla e ricarica l’anteprima."
        : failure?.code === "55P03" ? "La sorgente è temporaneamente occupata. Annulla e ricarica l’anteprima."
          : failure?.code === "42501" ? "Non sei autorizzato a gestire le configurazioni."
            : "Operazione bloccata. Annulla e ricarica l’anteprima per verificare la compatibilità.");
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <section className="stablr-admin-detail-section"><h2>Configurazioni giocabili</h2>
    {loading && <p role="status">Caricamento configurazioni…</p>}
    {error && !confirmation && <div role="alert"><p>{error}</p><button className="stablr-admin-white-button" disabled={busy} type="button" onClick={load}>Ricarica configurazioni</button></div>}
    {message && <p role="status">{message}</p>}
    {context && !loading && !error && <>
      {!context.configurations.length ? <p>Nessuna configurazione giocabile registrata.</p> : <div className="stablr-admin-playable-list">{context.configurations.map((cfg) => <button key={cfg.id} disabled={busy} type="button" onClick={() => { setLinkId(cfg.physical_source_link_id); setKind(cfg.registration_kind); if (physical18) { setCourseId(cfg.legacy_course_route_id); setParSelection(cfg.registration_snapshot.par_selection); } setNote(""); setContext(null); setMessage(""); }}><strong>{cfg.label}</strong><span>{cfg.holes_count} buche</span><span className="stablr-admin-status">{cfg.review_status === "verified" ? "Verificata" : "Da revisionare"}</span></button>)}</div>}
      {!context.source_links.length && <p>Registra e verifica prima le buche fisiche e il collegamento al Percorso da {physical18 ? 18 : 9} buche.</p>}
      <div className="stablr-admin-playable-selectors">
        <label className="stablr-admin-structure-selector">Origine fisica verificata<select disabled={busy} value={linkId} onChange={select(setLinkId)}><option value="">Scegli il Percorso verificato</option>{context.source_links.map((link) => <option value={link.id} key={link.id}>{link.name} · {link.holes_count} buche</option>)}</select></label>
        <label className="stablr-admin-structure-selector">Tipo di configurazione{physical18 && " e intervallo fisico"}<select disabled={busy} value={kind} onChange={select(setKind)}><option value="">Scegli esplicitamente il tipo</option>{Object.entries(physical18 ? PHYSICAL18_KINDS : CONFIGURATION_KINDS).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></label>
        {physical18 && <>
          <label className="stablr-admin-structure-selector">Percorso sorgente della configurazione<select disabled={busy} value={courseId} onChange={select(setCourseId)}><option value="">Scegli esplicitamente il Percorso</option>{context.courses.map((course) => <option value={course.id} key={course.id}>{course.name} · {course.holes_count} buche</option>)}</select></label>
          <label className="stablr-admin-structure-selector">Provenienza del Par<select disabled={busy} value={parSelection} onChange={select(setParSelection)}><option value="">Dichiara esplicitamente la regola</option><option value="source">Conserva Par sorgente · override esplicito</option><option value="inherited">Eredita Par dalle buche fisiche</option></select></label>
        </>}
      </div>
      {context.reasons.length > 0 && <div role="alert">{context.reasons.map((reason) => <p key={reason}>{physical18 && reason === "verified_parent_required" ? "Registra e verifica prima la configurazione 18 autonoma da usare come padre." : configurationProblems[reason] || "Configurazione incompatibile: è necessaria una revisione."}</p>)}</div>}
      {linkId && kind && context.source_link_id === linkId && context.kind === kind && (!physical18 || (courseId && parSelection && context.source_course_id === courseId && context.par_selection === parSelection)) && <>
        <h3>{context.label}</h3>
        {context.configuration && <p><span className="stablr-admin-status">{context.configuration.review_status === "verified" ? "Verificata" : "Da revisionare"}</span> · Revisione {context.configuration.revision}</p>}
        {physical18 && !context.configuration && <p>Anteprima · configurazione non registrata</p>}
        <Sequence context={context} />{!physical18 && <TeeEvidence context={context} />}
        {physical18 && context.configuration && <p>Nota registrata: {context.configuration.reason}</p>}
        <p className="stablr-admin-detail-empty">Si registra solo la fondazione. Par e SI non sono modificabili da questa schermata.</p>
        {(context.can_register || context.can_verify) && <>
          <label className="stablr-admin-structure-selector">Nota configurazione<textarea disabled={busy} required value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button className="stablr-admin-white-button" disabled={busy || !note.trim()} type="button" onClick={() => setConfirmation({ kind: context.can_register ? "register" : "verify", context, note: note.trim() })}>{context.can_register ? "Registra configurazione" : "Verifica configurazione"}</button>
        </>}
      </>}
    </>}
    {confirmation && <EditorDialog title={confirmation.kind === "register" ? "Conferma registrazione configurazione" : "Conferma verifica configurazione"}>
      <p>{confirmation.kind === "register" ? "Verranno registrate la configurazione e tutte le sue occorrenze nella fondazione, come Da revisionare." : "La configurazione completa verrà marcata Verificata nella fondazione."}</p>
      <Sequence context={confirmation.context} />{!physical18 && <TeeEvidence context={confirmation.context} />}
      <p>Nota: {confirmation.note}</p><p>Catalogo pubblicato e override tee restano invariati.</p>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy} type="button" onClick={confirm}>{confirmation.kind === "register" ? "Conferma registrazione configurazione" : "Conferma verifica configurazione"}</button><button disabled={busy} type="button" onClick={() => setConfirmation(null)}>Annulla</button></div>
    </EditorDialog>}
  </section>;
}
