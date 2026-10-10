import TechnicalRows, { TechnicalDisclosure } from "./TechnicalRows";
import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { parError, parReason } from "./physical-par-data";
import "./PhysicalPar.css";
import LocalPar from "./ParWorkflow";

function Impact({ context }) {
  return <div className="stablr-admin-par-impact">
    <p><strong>Par fisico: {context.physical_hole.before} → {context.physical_hole.after}</strong></p>
    <div className="stablr-admin-par-table" role="table" aria-label="Impatto configurazioni">
      <div role="row">{["Configurazione", "Posizioni / occorrenze", "Totale Prima", "Totale Dopo"].map((label) => <strong role="columnheader" key={label}>{label}</strong>)}</div>
      <TechnicalRows label="Impatto configurazioni">{context.configurations.map((c) => <div role="row" key={c.id}><span role="cell">{c.label} · {c.holes_count} buche{c.impact_role === "physical_base" && " · Base aggiornabile"}</span><span role="cell">{c.occurrences.map((h) => `${h.position} (${h.occurrence})`).join(", ")}</span><span role="cell">{c.before_total}</span><span role="cell">{c.after_total}</span></div>)}</TechnicalRows>
    </div>
    <h4>Tee impattati</h4>
    <div className="stablr-admin-par-table" role="table" aria-label="Impatto tee">
      <div role="row">{["Tee / ambito", "Copertura", "Par Prima", "Par Dopo"].map((label) => <strong role="columnheader" key={label}>{label}</strong>)}</div>
      <TechnicalRows label="Tee impattati">{context.tees.map((t) => <div role="row" key={`${t.entity_type}:${t.tee_id}`}><span role="cell">{t.name} · {t.scope} buche</span><span role="cell">{t.eligible ? "Derivato aggiornabile" : "Bloccante / da revisionare"}</span><span role="cell">{t.before ?? "—"}</span><span role="cell">{t.after}</span></div>)}</TechnicalRows>
    </div>
    {!context.tees.length && <p>Nessun tee impattato con ambito risolto. Eventuali ambiti mancanti restano bloccanti.</p>}
    <h4>Override esclusi</h4>
    {!context.overrides_excluded.length ? <p>Nessun override escluso.</p> : <ul><TechnicalRows list label="Override esclusi">{context.overrides_excluded.map((o, i) => <li key={i}>{o.configuration_label} · posizione {o.position} · Par {o.par_override} invariato</li>)}</TechnicalRows></ul>}
    {!!context.autonomous_excluded?.length && <><h4>Configurazioni autonome escluse</h4><ul><TechnicalRows list label="Configurazioni autonome escluse">{context.autonomous_excluded.map((c) => <li key={c.topology_hash}>{c.label} · Totale Par {c.total} invariato · autonomia approvata nel batch</li>)}</TechnicalRows></ul></>}
    {!!context.blockers.length && <div role="alert"><h4>Blocchi concreti</h4><ul>{context.blockers.map((b) => <li key={b}>{parReason(b)}</li>)}</ul></div>}
    <p>SI, CR/Slope, distanze, giri e snapshot storici restano invariati. Solo i riferimenti esatti ed ereditari possono essere pubblicati.</p>
  </div>;
}

export default function PhysicalPar(props) {
  const [local, setLocal] = useState(false);
  return local ? <LocalPar {...props} service={props.service.local} onBack={() => setLocal(false)} /> : <PhysicalParEditor {...props} onLocal={props.service.local ? () => setLocal(true) : null} />;
}

function PhysicalParEditor({ clubId, service, onBusy, onChanged, registerExitGuard, onLocal }) {
  const [list, setList] = useState(null), [context, setContext] = useState(null), [par, setPar] = useState("");
  const [proposal, setProposal] = useState(null), [dialog, setDialog] = useState(null), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [pendingExit, setPendingExit] = useState(null);
  const inFlight = useRef(false);
  const dirty = !!context && Number(par) !== context.draft.par;
  const valid = Number.isInteger(Number(par)) && Number(par) >= 3 && Number(par) <= 6;
  useEffect(() => { onBusy?.(busy || dirty || !!dialog); return () => onBusy?.(false); }, [busy, dirty, dialog, onBusy]);
  useEffect(() => {
    const prevent = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  useEffect(() => {
    registerExitGuard?.((action) => {
      if (inFlight.current || dialog) return;
      if (dirty) { setPendingExit(() => action); setDialog("exit"); } else action();
    });
    return () => registerExitGuard?.(null);
  }, [dirty, dialog, registerExitGuard]);
  const act = async (callback) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await callback(); }
    catch (failure) { console.error("Admin physical Par failed", failure?.code || "request_failed"); setError(parError(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const load = async () => setList(await service.list(clubId));
  const save = async () => {
    const next = await service.save(context.draft, par); setContext(next); setPar(String(next.draft.par));
    setMessage("Bozza Par salvata. Nessun dato live modificato."); return next;
  };
  return <section className="stablr-admin-detail-section stablr-admin-physical-par" aria-label="Propagazione sicura Par fisico">
    <h2>Propagazione sicura Par fisico</h2>
    <p>Le proposte tee richiedono una decisione Admin unica. Una bozza Par dedicata permette poi di verificare l’impatto prima di qualsiasi pubblicazione.</p>
    {!context && <div className="stablr-admin-editor-actions">
      {onLocal && <button className="stablr-admin-white-button" disabled={busy} onClick={onLocal} type="button">Par configurazioni</button>}
      <button className="stablr-admin-white-button" disabled={busy} onClick={() => act(async () => { const p = await service.proposal(clubId); setProposal(p); setNote(""); setDialog("batch"); })} type="button">Prepara proposta tee</button>
      <button className="stablr-admin-white-button" disabled={busy} onClick={() => act(load)} type="button">{list ? "Ricarica buche fisiche" : "Apri buche fisiche verificate"}</button>
    </div>}
    {list && !context && <>
      {!list.holes.length && <p>Nessuna buca fisica registrata. Nessun collegamento viene dedotto automaticamente.</p>}
      <div className="stablr-admin-par-table" role="table" aria-label="Buche fisiche per pubblicazione">
        {list.holes.map((h) => <button role="row" type="button" key={h.id} className="stablr-admin-par-row" disabled={busy || h.review_status !== "verified"} onClick={() => act(async () => {
          const next = await service.open(h.id); setContext(next); setPar(String(next.draft.par)); setMessage("");
        })}><span role="cell">{h.course_name}</span><span role="cell">Buca {h.number}</span><span role="cell">Par {h.par}</span><span role="cell">{h.review_status === "verified" ? "Apri bozza Par →" : "Da revisionare"}</span></button>)}
      </div>
      {!!list.history.length && <><h3>Pubblicazioni Par</h3><TechnicalRows label="Pubblicazioni Par">{list.history.map((v) => <article className="stablr-admin-structure-evidence" key={v.id}><p>Par {v.before.par} → {v.after.par} · {new Date(v.published_at).toLocaleString("it-IT")} · {v.own ? "Questo Admin" : "Altro Admin"}</p><p>{v.note}</p><TechnicalDisclosure summary="Impatto pubblicato"><Impact context={{ ...v.diff, blockers: [] }} /></TechnicalDisclosure></article>)}</TechnicalRows></>}
    </>}
    {context && <>
      <header className="stablr-admin-editor-header"><div><h3>{context.physical_hole.course_name} · Buca {context.physical_hole.number}</h3><span className="stablr-admin-status">Bozza Par fisico</span></div>
        <div className="stablr-admin-editor-header-actions"><button className="stablr-admin-draft-save-button" disabled={busy || !valid || context.base_changed} onClick={() => act(save)} type="button">Salva bozza</button>
          <button className="stablr-admin-publish-button" disabled={busy || !valid || context.base_changed} onClick={() => act(async () => { await save(); setNote(""); setDialog("publish"); })} type="button">Anteprima impatto</button></div>
      </header>
      {context.base_changed && <p role="alert">La base della bozza è cambiata. Nessuna ripresa o pubblicazione automatica: abbandona esplicitamente e riapri.</p>}
      <label className="stablr-admin-par-field">Nuovo Par fisico<input type="number" min="3" max="6" step="1" disabled={busy} value={par} onChange={(e) => { setPar(e.target.value); setMessage(""); }} /></label>
      {dirty && <p>Modifiche non salvate</p>}
      <Impact context={context} />
      <button className="stablr-admin-abandon-button" disabled={busy} onClick={() => { if (dirty) { setPendingExit(() => () => setContext(null)); setDialog("exit"); } else setContext(null); }} type="button">Torna alle buche fisiche</button>
      <div className="stablr-admin-abandon-zone"><button className="stablr-admin-abandon-button" disabled={busy} onClick={() => setDialog("abandon")} type="button">Abbandona bozza</button></div>
    </>}
    {message && <p role="status">{message}</p>}
    {busy && <p role="status">Verifica in corso…</p>}
    {error && <p role="alert">{error}</p>}
    {dialog === "batch" && proposal && <EditorDialog title="Conferma proposta tee">
      <p>{proposal.tee_count} tee · {proposal.configuration_count} configurazioni verificate · {proposal.excluded.length} esclusi</p>
      <p>Decisione proposta: curato + derivato, somma del Par effettivo della configurazione verificata. Non è una certificazione FIG e non modifica tee live.</p>
      <ul><TechnicalRows list label="Configurazioni proposta tee">{[...new Set(proposal.items.map((t) => t.configuration_label))].map((label) => <li key={label}>{label}</li>)}</TechnicalRows></ul>
      {!!proposal.excluded.length && <details><summary>Motivi di esclusione</summary><ul><TechnicalRows list label="Motivi di esclusione">{Object.entries(proposal.excluded.reduce((counts, e) => ({ ...counts, [e.reason]: (counts[e.reason] || 0) + 1 }), {})).map(([reason, count]) => <li key={reason}>{count} · {parReason(reason)}</li>)}</TechnicalRows></ul></details>}
      {!proposal.tee_count && <p>Nessuna proposta sicura disponibile. Gli esclusi restano invariati.</p>}
      <label>Nota di approvazione batch<textarea maxLength={2000} disabled={busy} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !note.trim() || !proposal.tee_count} onClick={() => act(async () => {
        const receipt = await service.confirmBatch(proposal, note); setDialog(null); setProposal(null); setMessage(`Batch approvato: ${receipt.tee_count} tee, ${receipt.configuration_count} configurazioni. Catalogo live invariato.`); await load(); onChanged?.();
      })} type="button">Conferma batch tee</button><button disabled={busy} onClick={() => setDialog(null)} type="button">Annulla</button></div>
    </EditorDialog>}
    {dialog === "publish" && context && <EditorDialog title="Conferma pubblicazione Par fisico">
      <Impact context={context} /><label>Nota di pubblicazione<textarea disabled={busy} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-publish-button" disabled={busy || !context.can_publish || context.base_changed || !note.trim()} onClick={() => act(async () => {
        const receipt = await service.publish(context, note); setDialog(null); setContext(null); setMessage(`Par pubblicato: ${receipt.par} · ${receipt.configuration_count} configurazioni · ${receipt.tee_count} tee. Bozza chiusa.`); await load(); onChanged?.();
      })} type="button">Conferma pubblicazione</button><button disabled={busy} onClick={() => setDialog(null)} type="button">Annulla</button></div>
    </EditorDialog>}
    {dialog === "exit" && <EditorDialog title="Modifiche non salvate"><p>Salva la bozza oppure scarta solo le modifiche non salvate.</p><div className="stablr-admin-editor-actions">
      <button disabled={busy || !valid || context.base_changed} onClick={() => act(async () => { await save(); setDialog(null); pendingExit?.(); setPendingExit(null); })} type="button">Salva bozza</button>
      <button disabled={busy} onClick={() => { setDialog(null); pendingExit?.(); setPendingExit(null); }} type="button">Scarta</button><button disabled={busy} onClick={() => { setDialog(null); setPendingExit(null); }} type="button">Resta</button></div></EditorDialog>}
    {dialog === "abandon" && <EditorDialog title="Abbandonare la bozza Par?"><p>Le modifiche non pubblicate non saranno più riprese. Il catalogo pubblicato non cambia.</p><div className="stablr-admin-editor-actions"><button className="stablr-admin-danger-button" disabled={busy} onClick={() => act(async () => { await service.abandon(context.draft); setContext(null); setDialog(null); setMessage("Bozza Par abbandonata. Nessun dato live modificato."); })} type="button">Abbandona bozza</button><button disabled={busy} onClick={() => setDialog(null)} type="button">Resta</button></div></EditorDialog>}
  </section>;
}
