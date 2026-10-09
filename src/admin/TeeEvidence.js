import { useEffect, useRef, useState } from "react";
import { evidenceReason } from "./tee-evidence-data";
import "./TeeEvidence.css";

const value = (v) => v == null || v === "" ? "—" : String(v);
const date = (v) => v ? new Date(v).toLocaleString("it-IT") : "—";
const outcome = (v) => ({ inserted: "Registrata", existing: "Già presente", excluded: "Esclusa" }[v] || "—");

export default function TeeEvidence({ service }) {
  const [open, setOpen] = useState(false), [list, setList] = useState(null), [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const load = async (id = null, offset = 0) => {
    const sequence = ++request.current;
    setBusy(true); setError(""); setSelected(id);
    if (id !== selected) setDetail(null);
    try {
      const result = id ? await service.detail(id, offset) : await service.list(offset);
      if (sequence !== request.current) return;
      if (id) setDetail(result); else setList(result);
      setSelected(id); setExpanded(null);
    } catch (failure) {
      console.error("Admin tee evidence read failed", failure);
      if (sequence === request.current) setError("Impossibile caricare l’archivio evidenze tee");
    } finally { if (sequence === request.current) setBusy(false); }
  };
  return <section className="stablr-admin-detail-section stablr-admin-tee-evidence">
    <h2>Archivio evidenze tee</h2>
    <p>Batch sorgente · sola lettura. Le evidenze non sono classificazioni e non sono collegate ai tee pubblicati.</p>
    {!open ? <button className="stablr-admin-white-button" type="button" onClick={() => { setOpen(true); load(); }}>Consulta batch evidenze</button> : <>
      {busy && <p role="status">Caricamento evidenze tee…</p>}
      {error && <div role="alert"><p>{error}</p><button className="stablr-admin-white-button" disabled={busy} type="button" onClick={() => load(selected, selected ? detail?.offset || 0 : list?.offset || 0)}>Riprova</button></div>}
      {selected && <button type="button" disabled={busy} onClick={() => { setSelected(null); setDetail(null); load(); }}>Torna ai batch</button>}
      {!selected && list && <>
        <p>{list.total} batch registrati</p>
        <div className="stablr-admin-tee-evidence-list" aria-label="Batch evidenze tee">
          {list.items.map((batch) => <button className="stablr-admin-tee-evidence-row" key={batch.id} type="button" disabled={busy} onClick={() => load(batch.id)}>
            <div><span>Fonte / estrattore</span><strong>{batch.source.toUpperCase()}</strong><small>{batch.extractor_version}</small></div>
            <div><span>Conferma</span><strong>{date(batch.confirmed_at)}</strong></div>
            <div><span>Osservazioni</span><strong>{batch.total}</strong></div>
            <div><span>Incomplete</span><strong>{batch.incomplete}</strong></div>
            <div><span>Escluse</span><strong>{batch.excluded}</strong></div>
          </button>)}
          {!list.total && !error && <p>Nessun batch di evidenze registrato.</p>}
        </div>
        <Pagination offset={list.offset} count={list.items.length} total={list.total} step={50} busy={busy} onPage={(offset) => load(null, offset)} />
      </>}
      {selected && detail && <>
        <h3>Ricevuta batch · {detail.artifact.source.toUpperCase()}</h3>
        <div className="stablr-admin-detail-grid"><article><span>Conferma</span><strong>{date(detail.batch.confirmed_at)}</strong></article><article><span>Registrate / già presenti</span><strong>{detail.batch.inserted} / {detail.batch.existing}</strong></article><article><span>Incomplete / escluse</span><strong>{detail.batch.incomplete} / {detail.batch.excluded}</strong></article><article><span>Autore</span><strong>{detail.batch.current_admin ? "Admin corrente" : "Altro Admin"}</strong></article></div>
        <p>{detail.batch.note}</p>
        <details><summary>Identità e versione dell’artefatto</summary><dl><dt>Documento sorgente</dt><dd>{value(detail.artifact.source_url)}</dd><dt>Versione fonte</dt><dd>{value(detail.artifact.source_version)}</dd><dt>Acquisizione</dt><dd>{date(detail.artifact.acquired_at)}</dd><dt>Pubblicazione fonte</dt><dd>{date(detail.artifact.published_at)}</dd><dt>Registrazione archivio</dt><dd>{date(detail.artifact.recorded_at)}</dd><dt>Dimensione</dt><dd>{value(detail.artifact.byte_size)} byte</dd><dt>Estrattore</dt><dd>{detail.artifact.extractor_version}</dd><dt>SHA-256</dt><dd>{detail.artifact.sha256}</dd></dl></details>
        <div className="stablr-admin-tee-evidence-list" aria-label="Osservazioni sorgente tee">
          {detail.items.map((item) => <div key={item.observation_id}>
            <button className="stablr-admin-tee-evidence-row" type="button" onClick={() => setExpanded(expanded === item.observation_id ? null : item.observation_id)} aria-expanded={expanded === item.observation_id}>
              <div><span>Osservazione</span><strong>{item.evidence ? `${item.evidence.club_label} · ${item.evidence.tee_label}` : "Osservazione esclusa"}</strong><small>{item.evidence?.configuration_label || item.observation_id}</small></div>
              <div><span>Par / origine</span><strong>{value(item.evidence?.par_normalized)}</strong><small>{item.evidence?.par_origin === "comune_configurazione" ? "Comune alla configurazione" : value(item.evidence?.par_origin)}</small></div>
              <div><span>Ambito</span><strong>{value(item.evidence?.scope_normalized)}</strong></div>
              <div><span>Esito</span><strong className="stablr-admin-status">{outcome(item.outcome)}</strong></div>
              <div><span>Completezza</span><strong>{item.evidence ? "Incompleta" : evidenceReason(item.reason)}</strong></div>
            </button>
            {expanded === item.observation_id && <article className="stablr-admin-tee-evidence-observation">
              <p>Riferimento interno: {item.observation_id}</p>
              {item.evidence ? <>
                <div className="stablr-admin-detail-grid">{[["Par", "par"], ["Ambito", "scope"], ["Applicabilità", "applicability"]].map(([label, key]) => <article key={key}><span>{label} originale → normalizzato</span><strong>{value(item.evidence[`${key}_original`])} → {value(item.evidence[`${key}_normalized`])}</strong><small>{item.evidence[`${key}_state`]}</small></article>)}</div>
                <p>Identità esterne tee/configurazione: {value(item.evidence.external_tee_id)} / {value(item.evidence.external_configuration_id)}</p>
                <ul>{item.evidence.limitations.map((limit) => <li key={limit}>{evidenceReason(limit)}</li>)}</ul>
                <p>Una prova completa non costituisce automaticamente un’attestazione certificata.</p>
              </> : <p>{evidenceReason(item.reason)}</p>}
            </article>}
          </div>)}
        </div>
        <Pagination offset={detail.offset} count={detail.items.length} total={detail.batch.total} step={100} busy={busy} onPage={(offset) => load(selected, offset)} />
      </>}
    </>}
  </section>;
}

function Pagination({ offset, count, total, step, busy, onPage }) {
  if (total <= step) return null;
  return <div className="stablr-admin-editor-actions"><button type="button" disabled={busy || offset === 0} onClick={() => onPage(Math.max(0, offset - step))}>Precedenti</button><span>{offset + 1}–{offset + count} di {total}</span><button type="button" disabled={busy || offset + count >= total} onClick={() => onPage(offset + step)}>Successivi</button></div>;
}
