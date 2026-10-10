import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import TechnicalRows from "./TechnicalRows";
import { parError, parReason } from "./physical-par-data";
import "./PhysicalPar.css";

const modeLabel = (mode) => ({ physical: "Par padre fisico", local: "Autonoma · modifica locale", override: "Padre verificato · override esplicito" }[mode] || "Da revisionare");
const reasons = (codes) => <ul>{[...new Set(codes)].map((code) => <li key={code}>{parReason(code)}</li>)}</ul>;
const counts = (codes) => Object.entries(codes.reduce((result, code) => ({ ...result, [code]: (result[code] || 0) + 1 }), {}));

export function ParWorkflowBatch({ service, onBusy, onCompleted }) {
  const [proposal, setProposal] = useState(null), [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  const flight = useRef(false);
  useEffect(() => { onBusy?.(busy || !!proposal); return () => onBusy?.(false); }, [busy, proposal, onBusy]);
  const act = async (fn) => { if (flight.current) return; flight.current = true; setBusy(true); setError(""); try { await fn(); } catch (e) { console.error("Admin Par workflow failed", e?.code || "request_failed"); setError(parError(e)); } finally { flight.current = false; setBusy(false); } };
  if (!service?.workflowPreview) return null;
  return <section className="stablr-admin-detail-section stablr-admin-physical-par" aria-label="Abilitazione sicura workflow Par">
    <h2>Workflow Par</h2><p>Una preview dell’intero catalogo propone solo abilitazioni e regole tee dimostrabili. Nessun collegamento fisico viene creato e nessun Par live cambia nel batch.</p>
    <button className="stablr-admin-white-button" disabled={busy} onClick={() => act(async () => { setProposal(await service.workflowPreview()); setReceipt(null); setNote(""); })} type="button">Prepara batch Par</button>
    {error && <p role="alert">{error}</p>}
    {receipt && <div role="status"><p>{receipt.confirmed.length} club approvati · {receipt.excluded.length} club esclusi. Catalogo live invariato.</p>{reasons(receipt.excluded.map((c) => c.reason))}</div>}
    {proposal && <EditorDialog title="Conferma batch workflow Par">
      <p>{proposal.target_count} configurazioni incluse · {proposal.tee_count} proposte tee · {proposal.excluded_count} configurazioni escluse.</p>
      <p>Le configurazioni senza padre verificato restano autonome. I tee proposti richiedono la tua approvazione come curato + derivato, non una certificazione FIG. Ogni club è atomico; un club cambiato viene escluso senza modificare gli altri.</p>
      <h3>Motivi aggregati</h3><ul><TechnicalRows list label="Motivi aggregati batch Par">{counts(proposal.clubs.flatMap((c) => [...(c.reasons || []), ...c.excluded.flatMap((x) => x.reasons)])).map(([code, count]) => <li key={code}>{count} · {parReason(code)}</li>)}</TechnicalRows></ul>
      <details><summary>Tee non proposti · motivi aggregati</summary><ul><TechnicalRows list label="Motivi aggregati tee non proposti">{counts(proposal.clubs.flatMap((c) => c.tee_proposal.excluded.map((x) => x.reason))).map(([code, count]) => <li key={code}>{count} · {parReason(code)}</li>)}</TechnicalRows></ul></details>
      <div className="stablr-admin-par-table" role="table" aria-label="Proposta catalogo Par"><TechnicalRows label="Club proposta Par">{proposal.clubs.map((c) => <div role="row" key={c.club_id}><span role="cell">{c.label}</span><span role="cell">{c.targets.length} configurazioni</span><span role="cell">{c.tee_proposal.tee_count} tee</span><span role="cell">{c.excluded.length} escluse</span></div>)}</TechnicalRows></div>
      <details><summary>Regole ed esclusioni</summary><TechnicalRows label="Regole batch Par">{proposal.clubs.map((c) => <section key={c.club_id}><h3>{c.label}</h3><TechnicalRows label={`Configurazioni ${c.label}`}>{c.targets.map((t) => <p key={`${t.type}:${t.target.id}`}>{t.target.label} · {t.target.holes_count} buche · {modeLabel(t.mode)}</p>)}</TechnicalRows>{reasons(c.reasons || [])}{reasons(c.excluded.flatMap((x) => x.reasons))}{reasons(c.tee_proposal.excluded.map((x) => x.reason))}</section>)}</TechnicalRows></details>
      <label>Nota di approvazione batch<textarea value={note} maxLength={2000} disabled={busy} onChange={(e) => setNote(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !note.trim() || !(proposal.target_count + proposal.tee_count)} onClick={() => act(async () => { setReceipt(await service.workflowConfirm(proposal, note)); setProposal(null); onCompleted?.(); })} type="button">Conferma batch Par</button><button className="stablr-admin-abandon-button" disabled={busy} onClick={() => setProposal(null)} type="button">Annulla</button></div>
    </EditorDialog>}
  </section>;
}

export default function LocalPar({ clubId, service, onBack, registerExitGuard, onBusy, onChanged }) {
  const [list, setList] = useState(null), [context, setContext] = useState(null), [par, setPar] = useState("");
  const [override, setOverride] = useState(false), [busy, setBusy] = useState(false), [dialog, setDialog] = useState(null), [note, setNote] = useState("");
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [pendingExit, setPendingExit] = useState(null);
  const flight = useRef(false), dirty = !!context && (Number(par) !== context.draft.par || override !== context.draft.create_override);
  const valid = par !== "" && Number.isInteger(Number(par)) && Number(par) >= 3 && Number(par) <= 6;
  const act = async (fn) => { if (flight.current) return; flight.current = true; setBusy(true); setError(""); try { await fn(); } catch (e) { console.error("Admin local Par failed", e?.code || "request_failed"); setError(parError(e)); } finally { flight.current = false; setBusy(false); } };
  const load = async () => setList(await service.list(clubId));
  useEffect(() => { let active = true; service.list(clubId).then((x) => { if (active) setList(x); }).catch((e) => { if (active) setError(parError(e)); }); return () => { active = false; }; }, [service, clubId]);
  useEffect(() => { onBusy?.(busy || dirty || !!dialog); return () => onBusy?.(false); }, [busy, dirty, dialog, onBusy]);
  useEffect(() => {
    registerExitGuard?.((action) => { if (flight.current || dialog) return; if (dirty) { setPendingExit(() => action); setDialog("exit"); } else action(); });
    const prevent = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", prevent); return () => { registerExitGuard?.(null); window.removeEventListener("beforeunload", prevent); };
  }, [dirty, dialog, registerExitGuard]);
  const save = async () => { const next = await service.save(context.draft, par, override); setContext(next); setPar(String(next.draft.par)); setOverride(next.draft.create_override); setMessage("Bozza salvata. Catalogo live invariato."); return next; };
  const exit = (action) => { if (dirty) { setPendingExit(() => action); setDialog("exit"); } else action(); };
  const impact = context && <>
    <p><strong>{context.target.label} · Buca {context.hole.number}: Par {context.hole.par} → {context.hole.after}</strong></p>
    <p>Totale configurazione: {context.before_total} → {context.after_total} · {modeLabel(context.mode)}</p>
    {context.parent && <p>Origine fisica: {context.parent.course_name} · Buca {context.parent.hole_number} · Par base {context.parent.base_par} invariato.</p>}
    {context.requires_override && <p>L’override locale interrompe l’ereditarietà solo per questa buca della configurazione. Il padre fisico e gli altri record non cambiano.</p>}
    <div className="stablr-admin-par-table" role="table" aria-label="Tee pubblicazione locale"><TechnicalRows label="Tee pubblicazione locale">{context.tees.map((t) => <div role="row" key={t.tee_id}><span role="cell">{t.name} · {t.scope} buche</span><span role="cell">{t.eligible ? "Derivato" : "Bloccante"}</span><span role="cell">{t.before ?? "—"}</span><span role="cell">{t.after ?? "—"}</span></div>)}</TechnicalRows></div>
    {!!context.blockers.length && <div role="alert">{reasons(context.blockers)}</div>}
    <p>SI, CR/Slope, distanze, tee non derivati, giri e snapshot restano invariati. Nessuna modifica locale su righe condivise 9×2.</p>
  </>;
  return <section className="stablr-admin-detail-section stablr-admin-physical-par" aria-label="Par configurazioni indipendenti">
    <h2>Par configurazioni</h2>
    {!context && <><p>Abilitazioni approvate dal batch. Senza un padre verificato la modifica resta locale; con un padre verificato serve un override esplicito.</p>
      {list?.targets.map((t) => <article className="stablr-admin-structure-evidence" key={`${t.type}:${t.target.id}`}><h3>{t.target.label} · {t.target.holes_count} buche</h3><p>{modeLabel(t.mode)} · Totale Par: {t.target.total_par}</p>
        {t.mode === "physical" ? <p>Par fisico unico: usa il publisher delle buche fisiche. Il 9 e il 18 ripetuto restano coerenti; nessun override locale del solo 18.</p> : <div className="stablr-admin-par-table" role="table" aria-label={`Par ${t.target.label}`}>{t.holes.map((h) => <button className="stablr-admin-par-row" role="row" type="button" key={h.id} disabled={busy || !t.approved || !!t.reasons.length} onClick={() => act(async () => { const next = await service.open(t.type, t.target.id, h.id); setContext(next); setPar(String(next.draft.par)); setOverride(next.draft.create_override); setMessage(""); })}><span role="cell">Buca {h.number}</span><span role="cell">Par {h.par}</span><span role="cell">SI {h.si}</span><span role="cell">Apri bozza Par →</span></button>)}</div>}
        {!t.approved && <p>Approva il batch Par dalla root Struttura e collegamenti.</p>}{reasons(t.reasons)}
      </article>)}
      {list && !list.targets.length && <p>Nessuna configurazione disponibile.</p>}
      {!!list?.history.length && <><h3>Storico Par locale</h3><TechnicalRows label="Storico Par locale">{list.history.map((v) => <p key={v.id}>Par {v.before.par} → {v.after.par} · Totale {v.before.total} → {v.after.total} · {new Date(v.published_at).toLocaleString("it-IT")} · {v.note}</p>)}</TechnicalRows></>}
      <button className="stablr-admin-abandon-button" disabled={busy} onClick={onBack} type="button">Torna al Par fisico</button>
    </>}
    {context && <>
      <header className="stablr-admin-editor-header"><div><h3>{context.target.label} · Buca {context.hole.number}</h3><span className="stablr-admin-status">Bozza Par locale</span></div><div className="stablr-admin-editor-header-actions"><button className="stablr-admin-draft-save-button" disabled={busy || !valid || context.base_changed} onClick={() => act(save)} type="button">Salva bozza</button><button className="stablr-admin-publish-button" disabled={busy || !valid || context.base_changed} onClick={() => act(async () => { await save(); setNote(""); setDialog("publish"); })} type="button">Anteprima impatto</button></div></header>
      {context.base_changed && <p role="alert">La base è cambiata: nessun rebase automatico. Abbandona esplicitamente la bozza e riapri.</p>}
      <label className="stablr-admin-par-field">Nuovo Par locale<input type="number" min="3" max="6" value={par} disabled={busy} onChange={(e) => setPar(e.target.value)} /></label>
      {context.requires_override && <button className="stablr-admin-white-button" type="button" disabled={busy || override || context.base_changed} onClick={() => setOverride(true)}>{override ? "Override locale richiesto" : "Crea override locale"}</button>}
      {dirty && <p>Modifiche non salvate</p>}{impact}
      <button className="stablr-admin-abandon-button" type="button" disabled={busy} onClick={() => exit(() => setContext(null))}>Torna alle configurazioni</button>
      <div className="stablr-admin-abandon-zone"><button className="stablr-admin-abandon-button" type="button" disabled={busy} onClick={() => setDialog("abandon")}>Abbandona bozza</button></div>
    </>}
    {message && <p role="status">{message}</p>}{busy && <p role="status">Verifica in corso…</p>}{error && <p role="alert">{error}</p>}
    {dialog === "publish" && <EditorDialog title="Conferma pubblicazione Par locale">{impact}<label>Nota di pubblicazione<textarea value={note} maxLength={2000} disabled={busy} onChange={(e) => setNote(e.target.value)} /></label><div className="stablr-admin-editor-actions"><button className="stablr-admin-publish-button" type="button" disabled={busy || !context.can_publish || context.base_changed || !note.trim()} onClick={() => act(async () => { await service.publish(context, note); setContext(null); setDialog(null); setMessage("Par pubblicato atomicamente. Bozza chiusa."); await load(); onChanged?.(); })}>Conferma pubblicazione</button><button className="stablr-admin-abandon-button" type="button" disabled={busy} onClick={() => setDialog(null)}>Annulla</button></div></EditorDialog>}
    {dialog === "exit" && <EditorDialog title="Modifiche non salvate"><p>La bozza salvata non viene archiviata né ribasata.</p><div className="stablr-admin-editor-actions"><button type="button" disabled={busy || !valid || context.base_changed} onClick={() => act(async () => { await save(); setDialog(null); pendingExit?.(); setPendingExit(null); })}>Salva bozza</button><button type="button" disabled={busy} onClick={() => { setDialog(null); pendingExit?.(); setPendingExit(null); }}>Scarta</button><button type="button" disabled={busy} onClick={() => { setDialog(null); setPendingExit(null); }}>Resta</button></div></EditorDialog>}
    {dialog === "abandon" && <EditorDialog title="Abbandonare la bozza Par?"><p>Le modifiche non pubblicate non saranno più riprese. Il catalogo pubblicato non cambia.</p><button className="stablr-admin-danger-button" type="button" disabled={busy} onClick={() => act(async () => { await service.abandon(context.draft); setContext(null); setDialog(null); })}>Abbandona bozza</button><button type="button" disabled={busy} onClick={() => setDialog(null)}>Resta</button></EditorDialog>}
  </section>;
}
