import { useCallback, useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { displayedHolesTotalPar } from "./PhysicalCourseHoles";

export const multi9Problem = (reason) => ({
  verified_multi9_required: "La struttura selezionata non è una multi_9 verificata: ricaricare la proposta batch dalla root.",
  conflicting_classification: "La classificazione esistente è incompatibile: serve revisione manuale, nessuna riclassificazione automatica.",
  unreviewed_structure_dependencies: "La struttura da revisionare ha già collegamenti o configurazioni: serve revisione manuale.",
  ambiguous_structure: "La struttura fisica del club non è univoca: serve revisione manuale.",
  inactive_club: "Club non attivo.",
  official_components_required: "Mancano combinazioni ufficiali con riferimenti espliciti ad almeno due Percorsi.",
  unscoped_physical_holes: "Esistono identità fisiche senza Percorso d’origine: serve revisione manuale.",
  invalid_component: "Un Percorso sorgente non supera i controlli: nessun elemento del club verrà registrato.",
  invalid_combination: "Una combinazione non supera i controlli: nessun elemento del club verrà registrato.",
  active_nine_source_required: "La sorgente deve essere un Percorso attivo da 9 buche dello stesso club.",
  derived_source: "Sorgente dichiarata derivata: fuori dal contratto multi-9.",
  invalid_nine_grid: "Le nove richiedono numeri 1–9 univoci, Par completi, totale coerente e nove SI distinti.",
  physical_link_unusable: "Collegamento fisico non verificato, modificato o appartenente a un’altra struttura.",
  physical_collision: "Un’identità fisica è già collegata diversamente.",
  physical_mapping_changed: "Il collegamento fisico salvato non corrisponde più esattamente alla sorgente.",
  invalid_combination_grid: "La combinazione richiede 18 buche complete e ordinate, SI 1–18 univoci e Par coerente.",
  non_unique_exact_reference: "Il riferimento Percorso + numero locale non individua esattamente una buca.",
  component_order_mismatch: "L’ordine delle buche non coincide con i componenti espliciti della combinazione.",
  explicit_par_override_required: "Par diverso dalla base fisica: serve un override esplicito, fuori da questo batch.",
  duplicate_physical_reference: "La combinazione contiene riferimenti fisici duplicati.",
  configuration_already_registered: "Configurazioni già registrate: nessuna duplicazione o adozione automatica.",
  uncovered_physical_source: "La struttura contiene un Percorso fisico non coperto dalle combinazioni proposte.",
  repeated_or_other_18_out_of_scope: "Percorso 18 / nove ripetute: fuori perimetro, non verrà registrato.",
  no_exact_official_component_reference: "Nessun riferimento esatto come componente ufficiale: non verrà collegato.",
  source_or_revision_changed: "Sorgente o revisione cambiata dopo l’anteprima: ricaricare la proposta.",
  source_busy: "Sorgente occupata da un’altra operazione: riprovare con una nuova anteprima.",
  collision: "Collisione con una registrazione concorrente.",
  invalid_candidate: "Candidato non valido o duplicato.",
  unknown_structure: "Struttura richiesta non disponibile.",
  club_validation_failed: "Controlli del club non superati: nessuna sua modifica è stata registrata."
}[reason] || "Caso da revisionare manualmente; nessun collegamento automatico.");

function Problems({ reasons = [] }) {
  return reasons.length > 0 && <ul>{[...new Set(reasons)].map((reason) => <li key={reason}>{multi9Problem(reason)}</li>)}</ul>;
}

const clubKey = (club) => club.club_id || club.structure_id;
const structureAction = (club) => ({
  create: "Creazione struttura e classificazione verificata, solo alla conferma",
  review: "Classificazione della struttura esistente, solo alla conferma",
  reuse: "Riutilizzo della struttura già classificata e verificata",
  blocked: "Nessuna modifica proposta: revisione manuale necessaria"
}[club.structure_proposal?.action] || "Riutilizzo della struttura già classificata e verificata");

function ClubPreview({ club, selectable, selected, onSelect }) {
  const saved = club.baseline?.physical_holes || [];
  const registered = club.baseline?.configurations?.filter((c) => ["multi9_9", "multi9_18"].includes(c.registration_kind)) || [];
  return <article className="stablr-admin-structure-evidence">
    <div className="stablr-admin-structure-evidence-row">
      <div><span>Club</span><strong>{club.club_name}</strong></div>
      <div><span>Struttura</span><strong>{club.structure_label}</strong></div>
      <div><span>{club.structure_proposal ? "Classificazione proposta" : "Classificazione verificata"}</span><strong>{club.classification_proposal || (club.structure_id ? "multi_9" : "—")}</strong></div>
      <div><span>Buche fisiche nel perimetro</span><strong>{club.physical_hole_count ?? "—"}</strong></div>
      <div><span>Configurazioni nel perimetro</span><strong>{club.configuration_count ?? "—"}</strong></div>
    </div>
    {club.structure_proposal && <p>{structureAction(club)}. Nessuna classificazione è salvata in anteprima.</p>}
    {club.can_register && <p>Evidenza: {club.courses?.length || 0} Percorsi 9 completi e {club.combinations?.length || 0} combinazioni ufficiali 18 complete, con riferimenti esatti Percorso + numero locale, Par coerente e SI validi.</p>}
    {selectable && <label className="stablr-admin-multi9-checkbox"><input type="checkbox" checked={selected} onChange={onSelect} />Includi {club.club_name}</label>}
    <Problems reasons={club.reasons} />
    <details className="stablr-admin-structure-payload"><summary>Buche fisiche e configurazioni · {club.club_name}</summary>
      <h3>Buche fisiche · origini esplicite</h3>
      {!saved.length && <p>Nessuna buca fisica registrata.</p>}
      {(club.courses || []).map((course) => {
        const holes = course.source?.holes || [];
        const count = saved.filter((h) => h.source_course_link_id === course.link?.id).length;
        return <div key={course.id}>
          <h3>{course.name} · 9 autonoma</h3>
          <p>{holes.length} buche · Totale Par: {displayedHolesTotalPar(holes)} · {count === 9 ? "Origine fisica verificata" : "Anteprima · Da revisionare"} · Fonte: {course.source?.course?.source_system || "—"}</p>
          <Problems reasons={course.reasons} />
          <div role="table" aria-label={`Buche fisiche ${course.name}`} className="stablr-admin-multi9-holes">
            <div role="row"><strong role="columnheader">Origine</strong><strong role="columnheader">Numero locale</strong><strong role="columnheader">Par base</strong><strong role="columnheader">SI configurazione 9</strong></div>
            {holes.map((h) => <div role="row" key={h.id}><span role="cell">{course.name}</span><span role="cell">{h.physical_hole_number}</span><span role="cell">{h.par ?? "—"}</span><span role="cell">{h.stroke_index ?? "—"}</span></div>)}
          </div>
        </div>;
      })}
      <h3>Combinazioni ufficiali · 18 derivate</h3>
      {(club.combinations || []).map((combination) => <div key={combination.id}>
        <h3>{combination.name}</h3>
        <p>{combination.sequence.length} buche · Totale Par: {displayedHolesTotalPar(combination.sequence.map((h) => ({ par: h.effective_par })))} · Par ereditato · SI conservato dalla combinazione live</p>
        <Problems reasons={combination.reasons} />
        <div role="table" aria-label={`Mappa ${combination.name}`} className="stablr-admin-multi9-sequence">
          <div role="row">{["Ordine", "Percorso fisico", "Numero locale", "Occorrenza", "Par ereditato", "SI configurazione"].map((title) => <strong role="columnheader" key={title}>{title}</strong>)}</div>
          {combination.sequence.map((h) => <div role="row" key={h.legacy_combination_hole_id}><span role="cell">{h.position}</span><span role="cell">{h.course_name}</span><span role="cell">{h.physical_number}</span><span role="cell">{h.occurrence}</span><span role="cell">{h.effective_par}</span><span role="cell">{h.stroke_index}</span></div>)}
        </div>
      </div>)}
      {!!registered.length && <><h3>Configurazioni registrate</h3>{registered.map((c) => <p key={c.id}>{c.label} · <span className="stablr-admin-status">{c.review_status === "verified" ? "Verificata" : "Da revisionare"}</span> · Revisione {c.revision}</p>)}</>}
    </details>
    {!!club.excluded?.length && <details className="stablr-admin-structure-payload"><summary>Configurazioni escluse · {club.excluded.length}</summary><ul>{club.excluded.map((c) => <li key={c.id}>{c.name}: {multi9Problem(c.reason)}</li>)}</ul></details>}
  </article>;
}

export default function Multi9Review({ service, structureId = null, onBusy, onCompleted, onEvents }) {
  const [preview, setPreview] = useState(null), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState([]), [note, setNote] = useState(""), [confirmation, setConfirmation] = useState(null);
  const [result, setResult] = useState(null), [error, setError] = useState("");
  const request = useRef(0), inFlight = useRef(false);
  const load = useCallback(async () => {
    const seq = ++request.current; setLoading(true); setError(""); setConfirmation(null);
    try {
      const response = structureId ? await service.multi9Preview(structureId) : await service.multi9BatchPreview();
      const next = structureId ? { candidates: response.can_register ? [response] : [], excluded: response.can_register ? [] : [response] } : response;
      if (!Array.isArray(next.candidates) || !Array.isArray(next.excluded)) throw new Error("Invalid multi9 preview");
      if (seq !== request.current) return;
      setPreview(next); setSelected(next.candidates.slice(0, 50).map(clubKey));
      if (structureId) onEvents?.(response.events || []);
    } catch (failure) {
      console.error("Admin multi9 preview failed", failure);
      if (seq === request.current) setError("Impossibile caricare la proposta multi-9. Riprova.");
    } finally { if (seq === request.current) setLoading(false); }
  }, [service, structureId, onEvents]);
  useEffect(() => { if (structureId) load(); return () => { request.current += 1; }; }, [structureId, load]);
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  const candidates = (preview?.candidates || []).filter((c) => selected.includes(clubKey(c)));
  const configurations = candidates.reduce((n, c) => n + c.configuration_count, 0);
  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await service.registerMulti9Batch(confirmation.candidates, confirmation.note);
      if (!Array.isArray(response.registered) || !Array.isArray(response.excluded)) throw new Error("Invalid batch result");
      setResult(response); setConfirmation(null); setNote(""); setPreview(null); setSelected([]);
      await load(); await onCompleted?.();
    } catch (failure) {
      console.error("Admin multi9 approval failed", failure);
      setError(failure?.code === "42501" ? "Non sei autorizzato ad approvare il batch." : "Impossibile completare l’approvazione. Ricarica l’anteprima prima di riprovare.");
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <section className="stablr-admin-detail-section">
    <h2>{structureId ? "Buche fisiche e configurazioni multi-9" : "Approvazione batch multi-9"}</h2>
    <p>Classificazione multi_9 proposta dalle relazioni e dai dati pubblicati, mai salvata in anteprima. Una sola conferma approva struttura, classificazione, buche e configurazioni. Nessun collegamento per nome, Par, posizione o offset.</p>
    <button className="stablr-admin-white-button" disabled={busy || loading} onClick={load} type="button">{preview ? "Ricarica proposta multi-9" : structureId ? "Ricarica anteprima multi-9" : "Prepara batch multi-9"}</button>
    {loading && <p role="status">Preparazione anteprima · sola lettura…</p>}
    {error && !confirmation && <p role="alert">{error}</p>}
    {result && <div role="status"><p>Approvazione completata: {result.registered.length} club registrati e verificati · {result.excluded.length} esclusi. Catalogo pubblicato invariato.</p>
      {result.registered.map((club) => <p key={club.structure_id}>{club.club_name}: {club.configurations.length} configurazioni verificate.</p>)}
      {result.excluded.map((club, index) => <p key={`${clubKey(club)}:${index}`}>{club.club_name || "Club escluso"}: {multi9Problem(club.reason)}</p>)}
    </div>}
    {preview && !loading && !error && <>
      <p>{candidates.length} club selezionati · {configurations} configurazioni · {preview.excluded.length} club esclusi</p>
      {!preview.candidates.length && <p>Nessun club idoneo al batch multi-9. Revisionare le esclusioni; non sono richiesti passaggi manuali preliminari per i club idonei.</p>}
      {preview.candidates.length > 50 && <p>Massimo 50 club per conferma. Tutti i candidati ed esclusi sono visibili; gli altri club possono essere approvati nel batch successivo.</p>}
      {preview.candidates.length > 0 && <label className="stablr-admin-multi9-checkbox"><input type="checkbox" disabled={busy} checked={preview.candidates.slice(0, 50).every((c) => selected.includes(clubKey(c)))} onChange={(e) => setSelected(e.target.checked ? preview.candidates.slice(0, 50).map(clubKey) : [])} />{preview.candidates.length > 50 ? "Seleziona i primi 50 club idonei" : "Seleziona tutti i club idonei"}</label>}
      {preview.candidates.map((club) => <ClubPreview key={clubKey(club)} club={club} selectable={!busy} selected={selected.includes(clubKey(club))} onSelect={() => setSelected((current) => current.includes(clubKey(club)) ? current.filter((id) => id !== clubKey(club)) : current.length < 50 ? [...current, clubKey(club)] : current)} />)}
      {preview.excluded.length > 0 && <><h3>Club esclusi dalla proposta</h3>{preview.excluded.map((club) => <ClubPreview key={clubKey(club)} club={club} />)}</>}
      {preview.candidates.length > 0 && <>
        <label className="stablr-admin-structure-selector">Nota di approvazione batch<textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} required /></label>
        <button className="stablr-admin-white-button" disabled={busy || !note.trim() || !candidates.length} onClick={() => setConfirmation({ candidates, note: note.trim() })} type="button">Approva batch nella fondazione</button>
      </>}
    </>}
    {confirmation && <EditorDialog title="Conferma approvazione batch multi-9">
      <p>Verranno registrati e verificati {confirmation.candidates.length} club e {confirmation.candidates.reduce((n, c) => n + c.configuration_count, 0)} configurazioni nella sola fondazione.</p>
      <ul>{confirmation.candidates.map((club) => <li key={clubKey(club)}>{club.club_name}: {structureAction(club)} · multi_9; {club.new_physical_hole_count} nuove identità fisiche, {club.physical_hole_count - club.new_physical_hole_count} già verificate da riusare; {club.configuration_count} nuove configurazioni.<ul>{[...club.courses, ...club.combinations].map((c) => <li key={c.id}>{c.name}</li>)}</ul></li>)}</ul>
      <p>Par ereditato dalle buche fisiche; SI conservati dalle rispettive configurazioni live. Nessun override tee viene modificato.</p>
      <p>Nota: {confirmation.note}</p><p>Ogni club è atomico: se fallisce un controllo, tutte le sue scritture vengono annullate e il club viene escluso. Gli altri club validi vengono registrati.</p>
      <p>Catalogo live, import, app giocatore, giri, bozze e versioni restano invariati.</p>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy} onClick={confirm} type="button">Conferma batch nella fondazione</button><button disabled={busy} onClick={() => { setConfirmation(null); setError(""); }} type="button">Annulla</button></div>
    </EditorDialog>}
  </section>;
}
