import TechnicalRows from "./TechnicalRows";
import { useMemo, useRef, useState, useEffect } from "react";
import { analyseOrigin, originTargets, validateOriginGraph } from "./data-origin";
import { courseTeeColor } from "./course-tee-editor-data";
import "./DataOrigin.css";

const value = (v) => v == null || v === "" ? "—" : String(v);
const date = (v) => v ? new Date(v).toLocaleString("it-IT") : "—";
const key = (t) => `${t.type}:${t.id}`;
const TYPES = { physical_hole: "Buche fisiche", configuration: "Configurazioni", route_tee: "Tee Percorso", combination_tee: "Tee combinazione" };
const ISSUES = {
  ambiguous_live_link: "Più configurazioni dichiarano lo stesso record live e ambito: associazione ambigua, da revisionare.",
  components_incomplete: "Componenti multi-9 mancanti, non verificati o con revisioni diverse.",
  parent_changed: "Padre della configurazione mancante o con revisione diversa.",
  incomplete_grid: "Cardinalità o numerazione incompleta/duplicata.",
  unverified_link: "Non tutti i collegamenti fisici/live sono verificati ed esatti.",
  duplicate_occurrence: "Occorrenza fisica duplicata.", invalid_si: "SI della configurazione incompleti, duplicati o fuori dominio.",
  source_changed: "Sorgente o valori live divergenti dalla fondazione registrata.",
  invalid_par: "Par effettivo incompleto o non coerente con il dominio.",
  source_snapshot_missing: "Snapshot sorgente o record live non disponibile.",
  source_snapshot_changed: "La sorgente live è cambiata rispetto allo snapshot di registrazione.",
  tee_snapshot_changed: "I tee live sono cambiati rispetto alla base registrata.",
  incomplete_coverage: "Esistono configurazioni live del club senza copertura fisica verificata: l’impatto complessivo non è certificato.",
  unverified_origin: "Origine fisica/live mancante o non verificata.",
  impact_not_certified: "Nessun utilizzo certificato per questo oggetto: non equivale ad assenza di impatto.",
  stale_draft: "Una bozza pertinente ha valori, versione o data base diversi dal live.",
  unverified_tee_override: "Override tee con collegamento o revisione non verificati.",
  matrix_association_unverified: "Matrice sorgente presente: nessuna associazione tee dedotta da nome o colore. Copertura degli override non certificata."
};
const rule = (c) => c.derivation_rule === "repeat_same_9_si_base_then_plus_1_cap_18" ? "Stesse 9 ripetute; SI base, poi base +1 fino a 18"
  : c.derivation_rule === "multi9_exact_components" ? "Componenti ufficiali con riferimenti esatti"
  : c.derivation_rule === "explicit_physical_interval_1_9_source_si" ? "Intervallo fisico 1–9 dichiarato; SI dalla sorgente"
  : c.derivation_rule === "explicit_physical_interval_10_18_source_si" ? "Intervallo fisico 10–18 dichiarato; SI dalla sorgente"
  : c.relationship_kind === "autonomous" ? "Autonoma" : value(c.derivation_rule);

function Facts({ rows }) {
  return <div className="stablr-admin-origin-facts">{rows.map(([label, v]) => <div key={label}><span>{label}</span><strong>{value(v)}</strong></div>)}</div>;
}
function Payload({ title, data }) {
  return <details className="stablr-admin-structure-payload"><summary>{title}</summary><pre>{JSON.stringify(data, null, 2)}</pre></details>;
}
function Configuration({ config: c, physicalId, onSelect }) {
  const slots = physicalId ? c.slots.filter((s) => s.physical_hole_id === physicalId) : c.slots;
  return <article className="stablr-admin-structure-evidence">
    <button className="stablr-admin-origin-link" onClick={() => onSelect({ type: "configuration", id: c.id })} type="button">{c.label}</button>
    <Facts rows={[["Cardinalità", c.cardinality_complete ? `${c.holes_count} / ${c.holes_count} · Completa` : "Incompleta"], ["Collegamento", c.linkage_verified ? "Verificato registrato" : "Da revisionare"], ["Revisione", c.revision], ["Totale Par fondazione", c.total_par]]} />
    <p>Origine live dichiarata: {c.live_source_name || "Non disponibile"} · Fonte: {value(c.live_source_system)}</p>
    <p>Origine/regola: {rule(c)}{c.parent_configuration_id && <> · Padre: {c.parent_label ? <button className="stablr-admin-origin-link" type="button" onClick={() => onSelect({ type: "configuration", id: c.parent_configuration_id })}>{c.parent_label}</button> : "Non disponibile"}</>}</p>
    {!!c.components.length && <><h4>Componenti multi-9</h4><div className="stablr-admin-origin-components" role="table" aria-label={`Componenti ${c.label}`}>
      <div role="row">{["Ordine", "Percorso fisico", "Configurazione padre", "Revisioni link / padre", "Verifica"].map((s) => <strong role="columnheader" key={s}>{s}</strong>)}</div>
      <TechnicalRows label="Componenti multi-9">{c.components.map((p) => <div role="row" key={p.id}><span role="cell">{p.component_position}</span><span role="cell">{p.course_name || "Origine mancante"}</span><span role="cell">{p.parent_label ? <button className="stablr-admin-origin-link" type="button" onClick={() => onSelect({ type: "configuration", id: p.parent_configuration_id })}>{p.parent_label}</button> : "Padre mancante"}</span><span role="cell">{p.physical_course_link_revision} / {p.parent_configuration_revision}</span><span role="cell">{p.valid ? "Verificato" : "Da revisionare"}</span></div>)}</TechnicalRows>
    </div></>}
    <div className="stablr-admin-origin-holes" role="table" aria-label={`Origine e valori ${c.label}`}>
      <div role="row">{["Posizione", "Origine fisica", "Occorrenza", "Par base", "Modalità Par", "Par fondazione", "SI configurazione", "Par live", "SI live/regola", "Confronto"].map((s) => <strong role="columnheader" key={s}>{s}</strong>)}</div>
      <TechnicalRows label="Origine e valori buche">{slots.map((s) => <div role="row" key={s.id}><span role="cell">{s.position}</span><span role="cell">{s.physical ? <button className="stablr-admin-origin-link" onClick={() => onSelect({ type: "physical_hole", id: s.physical.id })} type="button">{s.label}</button> : "Collegamento mancante"}</span><span role="cell">{s.occurrence}</span><span role="cell">{value(s.base_par)}</span><span role="cell">{s.par_mode === "inherited" ? "Ereditato" : s.par_mode === "override" ? "Override esplicito" : "Da revisionare"}</span><span role="cell">{value(s.effective_par)}</span><span role="cell">{value(s.stroke_index)}</span><span role="cell">{value(s.live_par)}</span><span role="cell">{value(s.live_si)}</span><span role="cell">{!s.linked ? "Copertura incompleta" : s.changed ? "Valori divergenti" : "Valori allineati"}</span></div>)}</TechnicalRows>
    </div>
    {!!c.issues.length && <ul>{c.issues.map((i) => <li key={i}>{ISSUES[i]}</li>)}</ul>}
  </article>;
}

export default function DataOrigin({ clubId, service }) {
  const [graph, setGraph] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [selection, setSelection] = useState("");
  const request = useRef(0);
  useEffect(() => { setGraph(null); setSelection(""); setError(""); return () => { request.current += 1; }; }, [clubId]);
  const load = async () => {
    const seq = ++request.current; setLoading(true); setError("");
    try { const next = validateOriginGraph(await service.originGraph(clubId), clubId); if (seq === request.current) setGraph(next); }
    catch (failure) { console.error("Admin read-only data origin failed", failure); if (seq === request.current) setError("Impossibile caricare impatto e origine dati. Riprova."); }
    finally { if (seq === request.current) setLoading(false); }
  };
  const targets = useMemo(() => graph ? originTargets(graph) : [], [graph]);
  const analysis = useMemo(() => {
    if (!graph) return null;
    const target = targets.find((t) => key(t) === selection);
    if (selection && !target) return null;
    return analyseOrigin(graph, target);
  }, [graph, targets, selection]);
  const select = (t) => setSelection(key(t));
  const selected = analysis?.selected;
  return <section className="stablr-admin-detail-section stablr-admin-data-origin" aria-label="Impatto e origine dati">
    <h2>Impatto e origine dati</h2>
    <p>Esploratore in sola lettura. Nessuna propagazione attiva e nessun nuovo blocco negli editor. Fondazione registrata e valori live restano distinti.</p>
    <button className="stablr-admin-white-button" onClick={load} disabled={loading} type="button">{graph ? "Ricarica impatto e origine" : "Esplora impatto e origine"}</button>
    {loading && <p role="status">Lettura origine e impatto…{graph ? " Dati precedenti mantenuti fino al completamento." : ""}</p>}
    {error && <div role="alert"><p>{error}</p><button className="stablr-admin-white-button" onClick={load} disabled={loading} type="button">Riprova lettura</button></div>}
    {graph && <>
      <label className="stablr-admin-structure-selector">Oggetto da esplorare<select value={selection} onChange={(e) => setSelection(e.target.value)}>
        <option value="">Riepilogo copertura del club</option>{Object.entries(TYPES).map(([type, label]) => <optgroup key={type} label={label}>{targets.filter((t) => t.type === type).map((t) => <option key={key(t)} value={key(t)}>{t.label}</option>)}</optgroup>)}
      </select></label>
      <nav className="stablr-admin-breadcrumb" aria-label="Navigazione origine"><button onClick={() => setSelection("")} type="button">Copertura del club</button>{selection && <><span>/</span><span>{targets.find((t) => key(t) === selection)?.label || "Oggetto non più disponibile"}</span></>}</nav>
      {!analysis ? <p role="alert">L’oggetto non è più presente nella fotografia corrente. La copertura è da revisionare.</p> : <>
        <Facts rows={[["Copertura", analysis.coverage_complete ? "Collegamenti coperti" : "Incompleta / da revisionare"], ["Pubblicabilità", "Non valutata"], ["Lettura", date(graph.read_at)], ["Configurazioni coinvolte", analysis.configurations.length]]} />
        <p>La cardinalità completa non certifica un collegamento verificato. La pubblicabilità con impatto richiede un futuro contratto atomico; questa lettura non autorizza né garantisce una pubblicazione.</p>
        {!!analysis.issues.length && <ul className="stablr-admin-origin-alerts">{analysis.issues.map((i) => <li key={i}>{ISSUES[i]}</li>)}</ul>}
        {selected?.type === "physical_hole" && <>
          <h3>Origine della buca fisica</h3>
          <Facts rows={[["Percorso origine", selected.origin.course?.name], ["Numero fisico", selected.record.physical_number], ["Par base fondazione", selected.record.base_par], ["Par sorgente live", selected.origin.source?.par]]} />
          <Facts rows={[["Collegamento", selected.origin.verified ? "Verificato registrato" : "Da revisionare"], ["Revisione buca / link", `${selected.record.revision} / ${selected.origin.link?.revision ?? "—"}`], ["Fonte", selected.record.source_system], ["Confronto sorgente", selected.origin.changed ? "Cambiata" : selected.origin.exact ? "Snapshot allineato" : "Non determinabile"]]} />
          <p>SI non appartiene alla buca fisica: è mostrato per ciascuna configurazione.</p>
          <Payload title="Provenienza registrata della buca" data={{ fonte: selected.record.source_system, riferimento: selected.record.source_reference, nota: selected.record.reason }} />
          {!!selected.exact_live_references.length && <><h4>Riferimenti live esatti</h4><TechnicalRows label="Riferimenti live esatti">{selected.exact_live_references.map((r) => <p key={r.id}>{r.combination_name || "Combinazione non disponibile"} · posizione {r.round_hole_number} · {r.registered ? "Collegamento fondazione verificato" : "Riferimento live esatto, collegamento fondazione non certificato"}</p>)}</TechnicalRows></>}
        </>}
        {["route_tee", "combination_tee"].includes(selected?.type) && <>
          <h3 className="stablr-admin-origin-tee"><span style={{ backgroundColor: courseTeeColor(selected.record.tee_color) }} aria-hidden="true" />{selected.record.tee_name}</h3>
          <Facts rows={[["Origine live", selected.course?.name || selected.combination?.name], ["Ambito tee", selected.effective_holes_count ? `${selected.effective_holes_count} buche${selected.record.holes_count == null ? " · dal Percorso live" : ""}` : "—"], ["Applicabilità", selected.record.gender], ["Stato operativo", selected.record.is_active ? "Attivo" : "Disattivato"]]} />
          <Facts rows={[["CR", selected.record.course_rating], ["Slope", selected.record.slope_rating], ["Par totale tee live", selected.record.par_total], ["Aggiornamento live", date(selected.record.updated_at)]]} />
        </>}
        <h3>Configurazioni e confronto fondazione/live</h3>
        {!analysis.configurations.length && <p>Nessun utilizzo certificato in questa fotografia: copertura incompleta, non assenza di impatto.</p>}
        <TechnicalRows label="Configurazioni coinvolte">{analysis.configurations.map((c) => <Configuration key={c.id} config={c} physicalId={selected?.type === "physical_hole" ? selected.record.id : null} onSelect={select} />)}</TechnicalRows>
        <h3>Override tee normalizzati</h3>
        {!analysis.overrides.length && <p>Nessun override normalizzato restituito. Questo non certifica l’assenza di override nei payload sorgente.</p>}
        <TechnicalRows label="Override tee normalizzati">{analysis.overrides.map((o) => <article className="stablr-admin-structure-evidence" key={o.id}>
          <Facts rows={[["Tee", o.tee_label], ["Configurazione", o.configuration_label], ["Posizione / revisione", `${o.position ?? "—"} / ${o.revision}`], ["Verifica", o.explicit_link && o.review_status === "verified" ? "Verificata" : "Da revisionare"]]} />
          <Facts rows={[["Par override", o.par_override], ["SI override", o.stroke_index_override], ["Par risultante fondazione", o.foundation_par], ["SI risultante fondazione", o.foundation_si]]} />
          <p>Fonte: {value(o.source_system)} · Nota: {value(o.reason)}. Valori della fondazione, non override attivati nel giocatore.</p>
        </article>)}</TechnicalRows>
        <h3>Matrici sorgente · associazioni non certificate</h3>
        {!analysis.matrices.length && <p>Nessuna matrice sorgente presente nei Percorsi letti per questo perimetro.</p>}
        <TechnicalRows label="Matrici sorgente">{analysis.matrices.map((m) => <div key={m.course_id}><p>{m.course_name}: payload read-only, senza assegnazione a un tee tramite nome o colore.</p><Payload title={`Matrice sorgente · ${m.course_name}`} data={m.matrix} /></div>)}</TechnicalRows>
        <h3>Copertura live non verificata</h3>
        <p>Perimetro del club: i record seguenti non possono essere attribuiti automaticamente alla buca selezionata.</p>
        {!analysis.uncovered_live.length && <p>Nessun record live attivo senza collegamento verificato restituito. Questo non certifica gli ambiti tee o l’assenza di altri impatti.</p>}
        <TechnicalRows label="Copertura live non verificata">{analysis.uncovered_live.map((r) => <article className="stablr-admin-structure-evidence" key={`${r.type}:${r.id}`}><Facts rows={[["Record live", r.label], ["Struttura", `${r.holes_count} buche`], ["Cardinalità", r.cardinality_complete ? "Completa" : "Incompleta"], ["Collegamento", "Non certificato"]]} /></article>)}</TechnicalRows>
        <h3>Bozze pertinenti · sola lettura</h3>
        <p>Il confronto verifica i campi disponibili, data e ultima versione base. Non sostituisce i controlli transazionali degli editor; nessuna bozza viene chiusa o modificata.</p>
        {!analysis.drafts.length && <p>Nessuna bozza attiva restituita per i record collegati.</p>}
        <TechnicalRows label="Bozze pertinenti">{analysis.drafts.map((d) => <article className="stablr-admin-structure-evidence" key={d.draft_id}><Facts rows={[["Record / tipo", `${d.label} · ${d.entity_type}`], ["Bozza", d.is_owner ? "Personale" : "Altro Admin"], ["Revisione", d.revision], ["Modifiche", d.has_changes ? "Con differenze" : "Identica alla base"]]} /><Facts rows={[["Base", d.base_status === "changed" ? "Divergente dal live" : d.base_status === "checked_fields" ? "Campi letti allineati; contesto da ricontrollare" : "Non determinabile"], ["Aggiornamento", date(d.updated_at)]]} /></article>)}</TechnicalRows>
      </>}
    </>}
  </section>;
}
