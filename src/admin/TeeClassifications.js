import TechnicalRows from "./TechnicalRows";
import { useEffect, useMemo, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { courseTeeColor } from "./course-tee-editor-data";
import { TEE_ATTESTATIONS, TEE_PAR_BEHAVIORS, TEE_CLASSIFICATION_STATES, filterTeeClassifications, newTeeDecision, teeClassificationError, teeScopeFromDetail, teeScopeLabel, validTeeDecision } from "./tee-classification-data";
import "./TeeClassifications.css";

const value = (v) => v == null || v === "" ? "—" : String(v);
const date = (v) => v ? new Date(v).toLocaleString("it-IT") : "—";
const teeKey = (row) => `${row.entity_type}:${row.tee_id}`;
function Facts({ rows }) { return <div className="stablr-admin-tee-classification-facts">{rows.map(([label, v]) => <div key={label}><span>{label}</span><strong>{value(v)}</strong></div>)}</div>; }
function DecisionFacts({ decision }) {
  if (!decision) return <p>Nessuna classificazione registrata: Sconosciuto / Sconosciuto.</p>;
  return <><Facts rows={[["Attestazione", TEE_ATTESTATIONS[decision.attestation]], ["Comportamento Par", TEE_PAR_BEHAVIORS[decision.par_behavior]],
    ["Provenienza", decision.provenance], ["Ambito dichiarato", `${decision.declared_holes_count} buche`], ["Applicabilità dichiarata", decision.declared_applicability]]} />
    <p>Par attestato: {value(decision.evidence?.par_total)}</p><details><summary>Evidenza</summary>{value(decision.evidence?.reference)}</details>
    {decision.derivation_rule && <p>Regola: somma dei Par effettivi della configurazione verificata, senza override tee.</p>}
    <p>Nota: {decision.note}</p></>;
}
function Baseline({ title, data }) {
  if (!data) return <p>{title}: non disponibile.</p>;
  return <details><summary>{title}</summary><Facts rows={[["Par tee", data.par_total], ["CR", data.course_rating], ["Slope", data.slope_rating],
    ["Ambito live", data.holes_count], ["Applicabilità live", data.applicability], ["Par Percorso/combinazione", data.parent_total_par],
    ["Revisione configurazione", data.configuration_revision], ["Par configurazione", data.configuration_total_par],
    ["Configurazione valida", data.configuration_id ? data.configuration_valid ? "Sì" : "No" : "Non selezionata"]]} />
    <p>Impronta sorgente: {data.source_fingerprint} · Impronta griglia: {data.grid_fingerprint}</p>
  </details>;
}

export default function TeeClassifications({ clubId, service, onBusy = () => {} }) {
  const [items, setItems] = useState(null), [detail, setDetail] = useState(null), [fields, setFields] = useState(null);
  const [attestation, setAttestation] = useState(""), [behavior, setBehavior] = useState("");
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [preview, setPreview] = useState(null);
  const generation = useRef(0), inFlight = useRef(false);
  useEffect(() => { generation.current += 1; setItems(null); setDetail(null); setFields(null); setPreview(null); setError(""); setMessage(""); return () => { generation.current += 1; }; }, [clubId]);
  const run = async (operation, write = false) => {
    if (inFlight.current) return;
    inFlight.current = true; const request = generation.current;
    setError(""); if (write) { setBusy(true); onBusy(true); } else setLoading(true);
    try { await operation(() => request === generation.current); }
    catch (failure) { console.error("Admin tee Par classification failed", failure); if (request === generation.current) setError(teeClassificationError(failure)); }
    finally { inFlight.current = false; if (request === generation.current) { setLoading(false); setBusy(false); } if (write) onBusy(false); }
  };
  const load = () => run(async (current) => {
    const next = await service.list(clubId);
    const missingScope = next.filter((row) => row.holes_count == null && row.state !== "target_missing");
    const details = await Promise.all(missingScope.map(async (row) => {
      try { return [row, await service.detail(clubId, row)]; } catch { return [row, null]; }
    }));
    const resolved = new Map(details.map(([row, nextDetail]) => [teeKey(row), teeScopeFromDetail(row, nextDetail)]));
    if (current()) setItems(next.map((row) => {
      const scope = resolved.get(teeKey(row));
      return scope ? { ...row, resolved_holes_count: scope.holesCount, scope_from_parent: scope.inherited } : row;
    }));
  });
  const open = (row) => run(async (current) => { const next = await service.detail(clubId, row); if (current()) { setDetail(next); setFields(newTeeDecision(next)); setPreview(null); setMessage(""); } });
  const update = (key) => (event) => { setFields((previous) => ({ ...previous, [key]: event.target.value })); setPreview(null); setMessage(""); };
  const prepare = () => run(async (current) => { const next = await service.preview(clubId, detail, fields); if (current()) setPreview(next); });
  const confirm = () => run(async (current) => {
    const saved = await service.confirm(clubId, preview);
    if (!current()) return;
    setDetail(saved); setFields(newTeeDecision(saved)); setPreview(null); setMessage("Classificazione registrata nella fondazione. Tee e catalogo live invariati.");
    setItems((previous) => previous?.map((row) => row.entity_type === saved.entity_type && row.tee_id === saved.tee_id
      ? { ...row, attestation: saved.effective_attestation, par_behavior: saved.effective_behavior, state: saved.state, revision: saved.revision, declared_holes_count: saved.classification?.declared_holes_count } : row));
  }, true);
  const filtered = useMemo(() => filterTeeClassifications(items || [], attestation, behavior), [items, attestation, behavior]);
  const disabled = busy || loading;
  return <section className="stablr-admin-detail-section stablr-admin-tee-classifications" aria-label="Classificazione Par totale tee">
    <h2>Classificazione Par totale tee</h2>
    <p>Attestazione e comportamento sono separati dalla provenienza. Nessuna propagazione, modifica rating o pubblicazione Par. Le classificazioni mancanti restano sconosciute.</p>
    {message && <p role="status">{message}</p>}
    {error && <div role="alert"><p>{error}</p><button className="stablr-admin-white-button" disabled={disabled} onClick={() => detail ? open(detail) : load()} type="button">Riprova</button></div>}
    {!detail ? <>
      <button className="stablr-admin-white-button" disabled={disabled} onClick={load} type="button">{items ? "Ricarica classificazioni tee" : "Consulta classificazioni tee"}</button>
      {loading && <p role="status">Caricamento classificazioni tee…</p>}
      {items && <>
        <div className="stablr-admin-tee-classification-filters">
          <label>Attestazione<select disabled={disabled} value={attestation} onChange={(event) => setAttestation(event.target.value)}><option value="">Tutte le attestazioni</option>{Object.entries(TEE_ATTESTATIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Comportamento Par<select disabled={disabled} value={behavior} onChange={(event) => setBehavior(event.target.value)}><option value="">Tutti i comportamenti</option>{Object.entries(TEE_PAR_BEHAVIORS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        </div>
        {!filtered.length ? <p>Nessun tee per questi filtri.</p> : <div className="stablr-admin-tee-classification-list" role="table" aria-label="Classificazioni tee">
          <div className="stablr-admin-tee-classification-row" role="row">{["Tee / origine", "Ambito", "Par", "Attestazione", "Comportamento", "Classificazione"].map((label) => <strong key={label} role="columnheader">{label}</strong>)}</div>
          {filtered.map((row) => <button className="stablr-admin-tee-classification-row" disabled={disabled} key={`${row.entity_type}:${row.tee_id}`} onClick={() => open(row)} type="button" aria-label={`Apri classificazione ${row.parent_name || "Origine non disponibile"} ${row.tee_name || "Tee non disponibile"}`}>
            <span><i aria-hidden="true" style={{ background: courseTeeColor(row.tee_color) }} /><strong>{row.tee_name || "Tee non disponibile"}</strong><small>{row.parent_name || "Origine non disponibile"} · {row.entity_type === "route_tee" ? "Percorso" : "Combinazione"}</small></span>
            <span>{teeScopeLabel(row)}</span><span>{value(row.par_total)}</span><span className="stablr-admin-status">{TEE_ATTESTATIONS[row.attestation]}</span><span className="stablr-admin-status">{TEE_PAR_BEHAVIORS[row.par_behavior]}</span><span>{TEE_CLASSIFICATION_STATES[row.state]} →</span>
          </button>)}
        </div>}
      </>}
    </> : <>
      <nav className="stablr-admin-breadcrumb" aria-label="Navigazione classificazione tee"><button disabled={disabled} onClick={() => { setDetail(null); setFields(null); setPreview(null); setError(""); }} type="button">Classificazioni tee</button><span>/</span><span>{detail.parent?.name || "Origine non disponibile"} · {detail.tee?.name || "Tee non disponibile"}</span></nav>
      {loading && <p role="status">Caricamento dettaglio tee…</p>}
      <h3>{detail.tee?.name || "Tee non disponibile"}</h3>
      <Facts rows={[["Par live", detail.tee?.par_total], ["Ambito live", detail.tee?.holes_count], ["Applicabilità live", detail.tee?.applicability], ["Stato classificazione", TEE_CLASSIFICATION_STATES[detail.state]], ["Revisione", detail.revision]]} />
      {!["current", "unclassified"].includes(detail.state) && <p role="status">La classificazione registrata è obsoleta. Attestazione e comportamento effettivi restano sconosciuti finché non viene confermata una nuova revisione.</p>}
      <DecisionFacts decision={detail.classification} />
      <Baseline title="Baseline tecnica attuale" data={detail.baseline} /><Baseline title="Baseline tecnica registrata" data={detail.recorded_baseline} />
      {detail.exists && fields && <form className="stablr-admin-editor-fields" onSubmit={(event) => { event.preventDefault(); if (validTeeDecision(fields, detail) && !disabled) prepare(); }}>
        <h3>Decisione manuale sul Par totale</h3>
        <label>Attestazione del dato<select disabled={disabled} value={fields.attestation} onChange={update("attestation")}>{Object.entries(TEE_ATTESTATIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Comportamento quando il Par impatta il tee<select disabled={disabled} value={fields.par_behavior} onChange={update("par_behavior")}>{Object.entries(TEE_PAR_BEHAVIORS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Provenienza della decisione<select disabled={disabled} value={fields.provenance} onChange={update("provenance")}>{["unknown", "fig", "gesgolf", "stablr", "official_club_site", "other"].map((source) => <option key={source} value={source}>{source === "unknown" ? "Sconosciuta" : source}</option>)}</select></label>
        <label>Ambito dichiarato<select required disabled={disabled} value={fields.declared_holes_count} onChange={update("declared_holes_count")}><option value="">Seleziona esplicitamente</option><option value="9">9 buche</option><option value="18">18 buche</option></select></label>
        <label>Applicabilità dichiarata<select disabled={disabled} value={fields.declared_applicability} onChange={update("declared_applicability")}><option value="">Non dichiarata</option><option value="men">Uomini</option><option value="women">Donne</option><option value="mixed">Mista</option></select></label>
        {fields.attestation !== "sconosciuto" && <>
          <label>{fields.attestation === "certificato" ? "Riferimento documento specifico tee / Par / ambito" : "Riferimento decisione Admin"}<input required maxLength={500} disabled={disabled} value={fields.evidence_reference} onChange={update("evidence_reference")} /></label>
          <label>Par totale attestato<input type="number" min="0" max="999" required={fields.attestation === "certificato"} disabled={disabled} value={fields.evidence_par} onChange={update("evidence_par")} /></label>
        </>}
        {fields.par_behavior === "derivato" && <>
          <label>Configurazione verificata<select required disabled={disabled} value={fields.configuration_id} onChange={update("configuration_id")}><option value="">Seleziona esplicitamente</option>{detail.configurations.map((configuration) => <option key={configuration.id} value={configuration.id} disabled={configuration.review_status !== "verified"}>{configuration.label} · {configuration.holes_count} buche</option>)}</select></label>
          <p>Regola esplicita: somma dei Par effettivi della configurazione verificata. Matrici o override Par tee non collegati impediscono questa dichiarazione.</p>
        </>}
        <label>Nota obbligatoria<textarea required maxLength={2000} disabled={disabled} value={fields.note} onChange={update("note")} /></label>
        <button className="stablr-admin-white-button" disabled={disabled || !validTeeDecision(fields, detail)} type="submit">Anteprima classificazione</button>
      </form>}
      <h3>Storico classificazione</h3>
      {!detail.history.length && <p>Nessuna decisione registrata.</p>}
      <TechnicalRows label="Storico classificazione">{detail.history.map((event) => <article className="stablr-admin-structure-evidence" key={event.id}>
        <Facts rows={[["Revisione", event.revision], ["Data", date(event.occurred_at)], ["Autore", event.actor_current_admin ? "Admin corrente" : "Altro Admin"]]} />
        <details><summary>Prima / Dopo</summary><h4>Prima</h4><DecisionFacts decision={event.before} /><h4>Dopo</h4><DecisionFacts decision={event.after} /></details>
      </article>)}</TechnicalRows>
    </>}
    {preview && <EditorDialog title="Conferma classificazione Par tee">
      <p>Verranno aggiornati soltanto classificazione e audit della fondazione. Par live, CR/Slope, griglie e app giocatore non cambiano.</p>
      <h3>{preview.parent?.name} · {preview.tee?.name}</h3><h4>Prima</h4><DecisionFacts decision={preview.before} /><h4>Dopo</h4><DecisionFacts decision={preview.decision} />
      {preview.configuration && <p>Configurazione: {preview.configuration.label} · Par {preview.configuration.total_par}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button disabled={busy} onClick={() => { setPreview(null); setError(""); }} type="button">Annulla</button><button className="stablr-admin-white-button" disabled={busy} onClick={confirm} type="button">{busy ? "Registrazione…" : "Conferma classificazione"}</button></div>
    </EditorDialog>}
  </section>;
}
