import { useCallback, useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { PHYSICAL_CLASSIFICATIONS, STRUCTURE_SOURCES, filterStructureReviews, reviewStatusLabel, reviewTypeLabel, structureReviewError } from "./structure-review-data";
import "./StructureReview.css";

const newFields = () => ({ label: "", classification: "non_classificato", source: "", reference: "", note: "" });
const fieldsFor = (structure) => structure ? ({ label: structure.label, classification: structure.classification,
  source: structure.source_system, reference: structure.source_reference, note: structure.reason }) : newFields();
const dateLabel = (date) => date ? new Date(date).toLocaleString("it-IT") : "—";
const value = (data) => data == null || data === "" ? "—" : String(data);
const sourceLabel = (source) => source === "other" ? "Altra fonte" : source.toUpperCase();
const eventLabels = { admin_catalog_physical_structures: "Struttura", admin_catalog_physical_holes: "Buca fisica",
  admin_catalog_playable_configurations: "Configurazione", admin_catalog_configuration_holes: "Collegamento buca", admin_catalog_tee_overrides: "Override tee" };

function Payload({ title, payload }) {
  if (payload == null || (typeof payload === "object" && !Object.keys(payload).length)) return null;
  return <details className="stablr-admin-structure-payload"><summary>{title}</summary><pre>{JSON.stringify(payload, null, 2)}</pre></details>;
}

function Evidence({ detail }) {
  const fig = detail.fig;
  return <>
    <section className="stablr-admin-detail-section"><h2>Evidenze STABLR · sola lettura</h2>
      <div className="stablr-admin-detail-grid">
        <article><span>Club</span><strong>{detail.club.name}</strong></article>
        <article><span>Fonte registrata</span><strong>{value(detail.club.source_system || detail.club.source_type)}</strong></article>
        <article><span>Stato esterno</span><strong>{value(detail.club.data_status)}</strong></article>
        <article><span>Matching FIG</span><strong>{detail.club.fig_match_status === "unmatched" ? "Da collegare" : value(detail.club.fig_match_status)}</strong></article>
      </div>
      <Payload title="Fonte/payload del club" payload={detail.club.source_payload} />
      <h3>Percorsi pubblicati</h3>
      {!detail.courses?.length && <p>Nessun percorso disponibile.</p>}
      {(detail.courses || []).map((course) => <article className="stablr-admin-structure-evidence" key={course.id}>
        <div className="stablr-admin-structure-evidence-row"><div><span>Percorso</span><strong>{course.name}</strong></div><div><span>Struttura dichiarata</span><strong>{course.holes_count} buche</strong></div><div><span>Record buca</span><strong>{course.holes?.length ?? 0}</strong></div><div><span>Fonte</span><strong>{value(course.source_system)}</strong></div></div>
        <Payload title={`Dati buche · ${course.name}`} payload={course.holes?.length ? course.holes : null} />
        <Payload title={`Fonte/payload · ${course.name}`} payload={course.source_payload} />
      </article>)}
      <h3>Combinazioni pubblicate</h3>
      {!detail.combinations?.length && <p>Nessuna combinazione disponibile.</p>}
      {(detail.combinations || []).map((combination) => <article className="stablr-admin-structure-evidence" key={combination.id}>
        <div className="stablr-admin-structure-evidence-row"><div><span>Combinazione</span><strong>{combination.name}</strong></div><div><span>Ambito</span><strong>{combination.holes_count} buche</strong></div><div><span>Record buca</span><strong>{combination.holes?.length ?? 0}</strong></div><div><span>Riferimenti legacy esatti mancanti</span><strong>{(combination.holes || []).filter((hole) => hole.exact_legacy_reference_exists === false).length}</strong></div></div>
        <Payload title={`Sequenza e riferimenti · ${combination.name}`} payload={combination.holes?.length ? combination.holes : null} />
        <Payload title={`Fonte/payload · ${combination.name}`} payload={combination.source_payload} />
      </article>)}
      <p className="stablr-admin-detail-empty">La cardinalità e i riferimenti legacy esatti non certificano un collegamento fisico verificato.</p>
    </section>
    <section className="stablr-admin-detail-section"><h2>Evidenze FIG · sola lettura</h2>
      {fig ? <>
        <div className="stablr-admin-detail-grid"><article><span>Club FIG collegato</span><strong>{fig.name}</strong></article><article><span>Codice fonte</span><strong>{value(fig.source_external_id)}</strong></article><article><span>Importazione</span><strong>{dateLabel(fig.import_batch?.imported_at)}</strong></article></div>
        {(fig.courses || []).map((course) => <article className="stablr-admin-structure-evidence" key={course.id}><div className="stablr-admin-structure-evidence-row"><div><span>Configurazione FIG</span><strong>{course.name}</strong></div><div><span>Buche</span><strong>{course.holes_count}</strong></div><div><span>Tipo FIG</span><strong>{value(course.course_type)}</strong></div><div><span>Par</span><strong>{value(course.total_par)}</strong></div></div><Payload title={`Composizione FIG · ${course.name}`} payload={course.course_composition} /><Payload title={`Payload FIG · ${course.name}`} payload={course.source_payload} /></article>)}
        <Payload title="Payload club FIG" payload={fig.source_payload} /><Payload title="Batch FIG" payload={fig.import_batch} />
      </> : <p>Nessun record FIG collegato disponibile.</p>}
    </section>
    <section className="stablr-admin-detail-section"><h2>GesGolf / import · sola lettura</h2>
      <p>Le fonti e i payload importati disponibili sono riportati nelle evidenze del club e dei percorsi. Non vengono cercate corrispondenze per nome, Par o posizione.</p>
    </section>
    <section className="stablr-admin-detail-section"><h2>Collegamenti nella fondazione · sola lettura</h2>
      {!detail.configurations?.length && <p>Nessuna configurazione registrata nella fondazione.</p>}
      {(detail.configurations || []).map((configuration) => <article className="stablr-admin-structure-evidence" key={configuration.id}><div className="stablr-admin-structure-evidence-row"><div><span>Configurazione</span><strong>{configuration.label}</strong></div><div><span>Buche previste</span><strong>{configuration.holes_count}</strong></div><div><span>Collegamenti verificati</span><strong>{(configuration.holes || []).filter((hole) => hole.review_status === "verified" && hole.physical_hole_id).length}</strong></div><div><span>Revisione</span><strong>{configuration.review_status === "verified" ? "Verificata" : "Da revisionare"}</strong></div></div><Payload title={`Identità e provenienza · ${configuration.label}`} payload={configuration} /></article>)}
      <p className="stablr-admin-detail-empty">Questa fase consente la classificazione della struttura. La verifica dei singoli collegamenti buca resta in sola lettura.</p>
    </section>
  </>;
}

function FoundationHistory({ events }) {
  return <section className="stablr-admin-detail-section"><h2>Storico della fondazione</h2>
    {!events.length && <p>Nessuna revisione della fondazione disponibile.</p>}
    {events.map((event) => <article className="stablr-admin-structure-evidence" key={event.id}>
      <div className="stablr-admin-structure-evidence-row"><div><span>Oggetto / azione</span><strong>{eventLabels[event.entity_table] || event.entity_table} · {event.operation === "INSERT" ? "Creazione" : "Revisione"}</strong></div><div><span>Data</span><strong>{dateLabel(event.occurred_at)}</strong></div><div><span>Autore</span><strong>{event.actor_id}</strong></div><div><span>Revisione</span><strong>{event.revision}</strong></div></div>
      <Payload title="Prima" payload={event.before_snapshot} /><Payload title="Dopo" payload={event.after_snapshot} />
    </article>)}
  </section>;
}

export function StructureReviewDetail({ item, service, onBack, onRoot, onChanged }) {
  const targetType = item.target_type, targetId = item.target_id;
  const [detail, setDetail] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [fields, setFields] = useState(newFields);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const inFlight = useRef(false);
  const request = useRef(0);
  const load = useCallback(async (preferredId) => {
    const sequence = ++request.current;
    setLoading(true); setError("");
    try {
      const result = await service.detail({ target_type: targetType, target_id: targetId });
      if (sequence !== request.current) return;
      const selected = result.structures.find((structure) => structure.id === preferredId)
        || result.structures.find((structure) => structure.review_status !== "verified") || result.structures[0];
      setDetail(result); setSelectedId(selected?.id || ""); setFields(fieldsFor(selected));
    } catch (failure) {
      console.error("Admin structure evidence failed", failure);
      if (sequence === request.current) setError("Impossibile caricare il dettaglio della struttura");
    } finally { if (sequence === request.current) setLoading(false); }
  }, [service, targetType, targetId]);
  useEffect(() => { load(); return () => { request.current += 1; }; }, [load]);
  const structure = detail?.structures.find((entry) => entry.id === selectedId);
  const readonly = structure?.review_status === "verified";
  const valid = fields.label.trim() && fields.label.trim().length <= 200 && STRUCTURE_SOURCES.includes(fields.source)
    && fields.reference.trim() && fields.note.trim() && PHYSICAL_CLASSIFICATIONS.includes(fields.classification);
  const update = (field) => (event) => { setFields((current) => ({ ...current, [field]: event.target.value })); setMessage(""); };
  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const saved = confirmation.structure ? await service.reviewStructure(confirmation.structure, confirmation.fields)
        : await service.createStructure(detail.club.id, confirmation.fields);
      setDetail((current) => ({ ...current, structures: current.structures.some((entry) => entry.id === saved.id)
        ? current.structures.map((entry) => entry.id === saved.id ? saved : entry) : [...current.structures, saved] }));
      setSelectedId(saved.id); setFields(fieldsFor(saved));
      setConfirmation(null);
      setMessage("Fondazione aggiornata. Il catalogo pubblicato è invariato.");
      await load(saved.id);
      await onChanged(saved);
    } catch (failure) { console.error("Admin structure review failed", failure); setError(structureReviewError(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  };

  return <section className="stablr-admin-detail stablr-admin-structure-review">
    <nav className="stablr-admin-breadcrumb" aria-label="Percorso di navigazione"><button disabled={busy} onClick={onRoot} type="button">Avanzata</button><span>/</span><button disabled={busy} onClick={onBack} type="button">Struttura e collegamenti</button><span>/</span><span>{item.title}</span></nav>
    <header className="stablr-admin-page-header"><div><h1>{item.title}</h1><p>{item.club_name} · {reviewTypeLabel(item.target_type)}</p></div><span className="stablr-admin-status">{reviewStatusLabel(item)}</span></header>
    {message && <p role="status">{message}</p>}
    {loading ? <p role="status">Caricamento evidenze…</p> : <>
      {error && !confirmation && <div role="alert"><p>{error}</p><button className="stablr-admin-white-button" onClick={() => load(selectedId)} type="button">Ricarica dettaglio</button></div>}
      {detail && <>
        <section className="stablr-admin-detail-section"><h2>Classificazione della struttura</h2>
          <p>La classificazione viene registrata solo nella fondazione. Buche, configurazioni, collegamenti e override non vengono creati.</p>
          {item.target_type === "hole_links" && <p className="stablr-admin-detail-empty">Classificare il club non verifica i collegamenti di questa combinazione: resterà Da revisionare finché non saranno verificati separatamente.</p>}
          {detail.structures.length > 0 && <label className="stablr-admin-structure-selector">Struttura registrata<select disabled={busy} value={selectedId} onChange={(event) => {
            const selected = detail.structures.find((entry) => entry.id === event.target.value);
            setSelectedId(event.target.value); setFields(fieldsFor(selected)); setError(""); setMessage("");
          }}>{detail.structures.map((entry) => <option key={entry.id} value={entry.id}>{entry.label} · {entry.classification} · {entry.review_status === "verified" ? "Verificata" : "Da revisionare"}</option>)}</select></label>}
          {readonly ? <>
            <div className="stablr-admin-detail-grid"><article><span>Classificazione verificata</span><strong>{structure.classification}</strong></article><article><span>Fonte</span><strong>{sourceLabel(structure.source_system)} · {structure.source_reference}</strong></article><article><span>Nota</span><strong>{structure.reason}</strong></article></div>
            <p className="stablr-admin-detail-empty">Struttura già classificata e verificata, consultabile in sola lettura.</p>
          </> : <form className="stablr-admin-editor-fields" onSubmit={(event) => { event.preventDefault(); if (valid && !busy) setConfirmation({ structure, fields: { ...fields } }); }}>
            {!structure && <label>Nome struttura<input required maxLength={200} disabled={busy} value={fields.label} onChange={update("label")} /></label>}
            <label>Classificazione fisica<select disabled={busy || !structure} value={fields.classification} onChange={update("classification")}>{PHYSICAL_CLASSIFICATIONS.map((classification) => <option key={classification} value={classification}>{classification}</option>)}</select></label>
            <label>Fonte<select required disabled={busy} value={fields.source} onChange={update("source")}><option value="">Seleziona la fonte</option>{STRUCTURE_SOURCES.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}</select></label>
            <label>Riferimento alla fonte<input required disabled={busy} value={fields.reference} onChange={update("reference")} /></label>
            <label>Nota di revisione<textarea required disabled={busy} value={fields.note} onChange={update("note")} /></label>
            {!structure && <p>La creazione registra una struttura non_classificato, Da revisionare. La classificazione esplicita sarà disponibile dopo la creazione.</p>}
            <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !valid} type="submit">{structure ? "Rivedi classificazione" : "Crea struttura"}</button></div>
          </form>}
        </section>
        <Evidence detail={detail} /><FoundationHistory events={detail.events} />
      </>}
    </>}
    {confirmation && <EditorDialog title="Conferma revisione struttura">
      <p>{confirmation.structure ? "Verrà aggiornata soltanto la struttura registrata nella fondazione." : "Verrà creata soltanto una struttura non classificata nella fondazione."}</p>
      <div className="stablr-admin-editor-diff" role="table" aria-label="Differenze struttura"><div role="row"><strong role="columnheader">Campo</strong><strong role="columnheader">Prima</strong><strong role="columnheader">Dopo</strong></div>
        {[["Nome", confirmation.structure?.label, confirmation.fields.label], ["Classificazione", confirmation.structure?.classification, confirmation.fields.classification], ["Stato revisione", confirmation.structure ? "Da revisionare" : null, confirmation.fields.classification === "non_classificato" ? "Da revisionare" : "Verificata"], ["Fonte", confirmation.structure?.source_system, confirmation.fields.source], ["Riferimento", confirmation.structure?.source_reference, confirmation.fields.reference], ["Nota", confirmation.structure?.reason, confirmation.fields.note]].map(([label, before, after]) => <div role="row" key={label}><span role="cell">{label}</span><span role="cell">{value(before)}</span><span role="cell">{value(after)}</span></div>)}
      </div>
      <p>Il catalogo pubblicato resta invariato. Nessuna buca fisica, configurazione, collegamento o override verrà creato o modificato.</p>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy} onClick={confirm} type="button">Conferma nella fondazione</button><button disabled={busy} onClick={() => { setConfirmation(null); setError(""); }} type="button">Annulla</button></div>
    </EditorDialog>}
  </section>;
}

export default function StructureReview({ service, onRoot }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Da revisionare");
  const [type, setType] = useState("Tutti i tipi");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    setError("");
    try { const result = await service.list(); if (sequence === request.current) setItems(result); }
    catch (failure) { console.error("Admin structure queue failed", failure); if (sequence === request.current) setError("Impossibile caricare la coda struttura e collegamenti"); }
  }, [service]);
  useEffect(() => { load(); return () => { request.current += 1; }; }, [load]);
  const changed = async (structure) => {
    if (structure.review_status === "verified") setItems((current) => current?.map((item) => item.target_type === "structure" && item.club_id === structure.club_id
      ? { ...item, classification: structure.classification, status: "verified" } : item));
    await load();
  };
  if (selected) return <StructureReviewDetail item={(items || []).find((item) => item.target_type === selected.target_type && item.target_id === selected.target_id) || selected} key={`${selected.target_type}:${selected.target_id}`} service={service} onBack={() => setSelected(null)} onRoot={onRoot} onChanged={changed} />;
  const filtered = filterStructureReviews(items || [], status, type, search);
  return <section className="stablr-admin-detail stablr-admin-structure-review">
    <nav className="stablr-admin-breadcrumb" aria-label="Percorso di navigazione"><button onClick={onRoot} type="button">Avanzata</button><span>/</span><span>Struttura e collegamenti</span></nav>
    <header className="stablr-admin-page-header"><div><h1>Struttura e collegamenti</h1><p>Revisione manuale della struttura fisica e dei collegamenti buca.</p></div></header>
    {error && <div role="alert"><p>{error}</p><button className="stablr-admin-white-button" onClick={load} type="button">Riprova</button></div>}
    {items === null ? !error && <p role="status">Caricamento coda…</p> : <>
      <div className="stablr-admin-filter-row" role="group" aria-label="Stato revisione struttura">{["Da revisionare", "Classificati / verificati", "Tutti"].map((filter) => <button className={filter === status ? "is-active" : ""} key={filter} onClick={() => setStatus(filter)} type="button">{filter}</button>)}</div>
      <div className="stablr-admin-filter-row" role="group" aria-label="Tipo revisione struttura">{["Tutti i tipi", "Classificazione struttura", "Collegamento buche"].map((filter) => <button className={filter === type ? "is-active" : ""} key={filter} onClick={() => setType(filter)} type="button">{filter}</button>)}</div>
      <label className="stablr-admin-structure-search">Cerca club o combinazione<input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <section className="stablr-admin-advanced-data-list" aria-label="Coda struttura e collegamenti">
        {filtered.map((item) => <button className="stablr-admin-structure-row" key={`${item.target_type}:${item.target_id}`} onClick={() => setSelected(item)} type="button">
          <div><span>Club / combinazione</span><strong>{item.title}</strong>{item.target_type === "hole_links" && <small>{item.club_name}</small>}</div>
          <div><span>Revisione</span><strong>{reviewTypeLabel(item.target_type)}</strong></div>
          <div><span>{item.target_type === "structure" ? "Classificazione" : "Collegamenti verificati"}</span><strong>{item.target_type === "structure" ? value(item.classification) : `${item.verified_hole_count} / ${item.holes_count}`}</strong></div>
          <div><span>Fonte catalogo</span><strong>{value(item.source_system)}</strong></div>
          <div><span>Stato</span><strong className="stablr-admin-status">{reviewStatusLabel(item)}</strong></div>
        </button>)}
        {!filtered.length && !error && <p className="stablr-admin-list-empty">Nessun elemento per questi filtri.</p>}
      </section>
    </>}
  </section>;
}
