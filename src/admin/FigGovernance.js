import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorDialog } from './ClubEditor';
const types = {new:'Nuova osservazione FIG',changed:'Modifica FIG',missing:'Non più presente',unmatched:'Senza collegamento verificato',conflict:'Conflitto',divergence:'Divergenza editoriale'};
const actions = {draft:'Apri proposta in bozza',ignore:'Ignora modifica',not_corresponding:'Non corrisponde'};
const date = value => value ? new Date(value).toLocaleString('it-IT') : '—';
function Values({ title, fields }) {
  return <div><h3>{title}</h3>{!fields ? <p>—</p> : <><p><strong>{fields.name}</strong>{fields.city ? ` · ${fields.city}` : ''}</p>
    {fields.course && <p>{fields.course} · Par {fields.par}</p>}
    {fields.ratings && <p>CR/Slope sorgente: {fields.ratings.map(v=>v??'—').join(' / ')}</p>}
    {!!fields.courses?.length && <details><summary>{fields.courses.length} configurazioni nel catalogo FIG</summary>{fields.courses.map(course=><div key={course.id}><strong>{course.name}</strong> · {course.holes_count} buche · Par {course.par??'—'}<p>{course.tees.map(t=>`${t.name} (${t.gender||'—'}): Par ${t.par??'—'}, CR ${t.cr??'—'}, Slope ${t.slope??'—'}`).join('; ')}</p></div>)}</details>}
  </>}</div>;
}
export default function FigGovernance({ service, onBack, onOpenDraft }) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [offset,setOffset]=useState(0),[resolved,setResolved]=useState(false),[selected,setSelected]=useState(null),[confirm,setConfirm]=useState(null),[note,setNote]=useState('');
  const mounted=useRef(false),generation=useRef(0),pending=useRef(false),requestId=useRef(null);
  const load=useCallback(async()=>{
    const current=++generation.current;setLoading(true);setError('');
    try {const result=await service.overview(offset,resolved);if(mounted.current&&current===generation.current)setData(result);}
    catch(e){console.error('FIG governance read failed',e?.code||'request_failed');if(mounted.current&&current===generation.current)setError('Impossibile caricare Verifica FIG. Riprova.');}
    finally {if(mounted.current&&current===generation.current)setLoading(false);}
  },[service,offset,resolved]);
  useEffect(()=>{mounted.current=true;load();return()=>{mounted.current=false;};},[load]);
  useEffect(()=>{if(data?.last_check?.status!=='running')return;const timer=setTimeout(load,5000);return()=>clearTimeout(timer);},[data,load]);
  const check=async()=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError('');
    requestId.current ||= crypto.randomUUID();
    try {await service.check(requestId.current);requestId.current=null;await load();}
    catch(e){console.error('FIG governance check failed',e?.code||'request_failed');if(mounted.current)setError('Impossibile completare il controllo FIG. Riprova: l’ultima baseline valida resta invariata.');}
    finally {pending.current=false;if(mounted.current)setBusy(false);}
  };
  const decide=async()=>{
    if(pending.current||!note.trim())return;pending.current=true;setBusy(true);setError('');
    try {const result=await service.decide(selected.id,confirm,note.trim());const action=confirm;setConfirm(null);setSelected(null);setNote('');await load();
      if(action==='draft'&&result.draft_id&&onOpenDraft)onOpenDraft(result.club_id,result.draft_id);
    }catch(e){console.error('FIG governance decision failed',e?.code||'request_failed');if(mounted.current)setError(e?.code==='40001'?'La base o una decisione è cambiata. Ricarica prima di confermare.':'Impossibile registrare la decisione. Nessuna modifica live.');}
    finally {pending.current=false;if(mounted.current)setBusy(false);}
  };
  return <section className="stablr-admin-detail">
    <nav className="stablr-admin-breadcrumb"><button type="button" onClick={onBack}>Avanzata</button><span>/</span><span>Verifica FIG</span></nav>
    <header className="stablr-admin-page-header"><div><h1>Verifica FIG</h1><p>Controllo di governance. Nessun aggiornamento automatico STABLR.</p></div><button className="stablr-admin-white-button" type="button" disabled={busy||(data?.last_check?.status==='running'&&Date.now()-new Date(data.last_check.started_at).getTime()<600000)} onClick={check}>{busy?'Controllo in corso…':'Verifica FIG ora'}</button></header>
    {error&&!selected&&!confirm&&<p role="alert">{error} <button className="stablr-admin-abandon-button" type="button" onClick={load}>Riprova lettura</button></p>}
    {!data&&loading?<p role="status">Caricamento controlli FIG…</p>:data&&<>
      <section className="stablr-admin-detail-section"><div className="stablr-admin-technical-grid">
        <article><span>Ultimo controllo</span><strong>{date(data.last_check?.started_at)}</strong></article>
        <article><span>Stato</span><strong>{({success:'Riuscito',failed:'Fallito',running:'In corso'})[data.last_check?.status]||'Nessun controllo eseguito'}</strong></article>
        <article><span>Ultima fotografia valida</span><strong>{date(data.baseline?.finished_at)}</strong></article>
      </div>{data.last_check?.status==='failed'&&<p role="status">Lettura FIG fallita. Baseline precedente conservata; nessun falso cambiamento generato.</p>}
      <p className="stablr-admin-detail-empty">Controllo settimanale server-side, dopo l’attivazione del canale. Le righe pubbliche senza identità stabile restano Da identificare. Il confronto con STABLR riguarda soltanto i collegamenti verificati nel catalogo FIG già importato, non associa queste righe pubbliche.</p></section>
      <section className="stablr-admin-detail-section"><h2>Coda FIG · {data.total}</h2>
        <div className="stablr-admin-filter-row">{[[false,'Da esaminare'],[true,'Tutte le decisioni']].map(([value,label])=><button type="button" key={label} className={resolved===value?'is-active':''} onClick={()=>{setResolved(value);setOffset(0);}}>{label}</button>)}</div>
        {!data.queue.length&&<p>Nessuna differenza in questa coda.</p>}
        <div className="stablr-admin-fig-queue">{data.queue.map(row=><button type="button" className="stablr-admin-club-row" key={row.id} onClick={()=>{setSelected(row);setNote('');}}>
          <span className="stablr-admin-club-identity"><strong>{(row.after||row.before)?.name||'Osservazione FIG'}</strong><span>{(row.after||row.before)?.course||types[row.kind]}</span></span>
          <span className="stablr-admin-status">{row.needs_identity?'Da identificare':types[row.kind]}</span>
          <span>{row.origin==='public'?'Fotografia pubblica FIG':'Catalogo FIG importato'}</span><span>{date(row.created_at)}</span>
        </button>)}</div>
        {data.total>50&&<div className="stablr-admin-editor-actions"><button className="stablr-admin-abandon-button" type="button" disabled={offset===0||loading} onClick={()=>setOffset(x=>Math.max(0,x-50))}>Precedenti</button><span>{offset+1}–{Math.min(offset+50,data.total)} / {data.total}</span><button className="stablr-admin-abandon-button" type="button" disabled={offset+50>=data.total||loading} onClick={()=>setOffset(x=>x+50)}>Successive</button></div>}
      </section>
    </>}
    {selected&&<EditorDialog title={selected.needs_identity?'Da identificare':types[selected.kind]}>
      {error&&!confirm&&<p role="alert">{error}</p>}
      <p>{selected.origin==='public'?'Fotografia pubblica FIG':'Catalogo FIG importato · collegamenti esistenti'} · {date(selected.created_at)}</p>
      {selected.needs_identity&&<p>Nessuna identità stabile e collegamento verificato: nessuna attribuzione a STABLR e nessuna proposta automatica.</p>}
      <div className="stablr-admin-fig-comparison"><Values title="FIG precedente" fields={selected.before}/><Values title="FIG attuale" fields={selected.after}/>{!selected.needs_identity&&<Values title="STABLR curato" fields={selected.curated}/>}</div>
      {selected.decision?<p>Decisione: {actions[selected.decision.action]} · {selected.decision.note} · {date(selected.decision.created_at)}</p>:<div className="stablr-admin-editor-actions">
        {Object.entries(actions).map(([action,label])=><button className={action==='draft'?'stablr-admin-white-button':'stablr-admin-abandon-button'} key={action} type="button" disabled={busy||(action==='draft'&&!selected.can_draft)} onClick={()=>setConfirm(action)}>{label}</button>)}
      </div>}
      {!selected.can_draft&&<p className="stablr-admin-detail-empty stablr-admin-fig-draft-unavailable">Proposta in bozza non disponibile senza un collegamento verificato e campi Club supportati. Un nuovo club del catalogo FIG può essere selezionato da Club e percorsi → Nuovo club → Crea da FIG.</p>}
      <button className="stablr-admin-abandon-button" type="button" disabled={busy} onClick={()=>setSelected(null)}>Chiudi</button>
    </EditorDialog>}
    {confirm&&<EditorDialog title={`Conferma: ${actions[confirm]}`}>
      {error&&<p role="alert">{error}</p>}
      <p>{confirm==='draft'?'Viene aperta solo una bozza personale dei campi Club supportati (nome/località). Percorsi, buche e rating non vengono ricreati.':'La decisione resta nello storico della governance. Il catalogo live e i matching esistenti non cambiano.'}</p>
      <div className="stablr-admin-editor-fields"><label>Nota obbligatoria<input value={note} maxLength={2000} disabled={busy} onChange={e=>setNote(e.target.value)}/></label></div>
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" type="button" disabled={busy||!note.trim()} onClick={decide}>Conferma decisione</button><button className="stablr-admin-abandon-button" type="button" disabled={busy} onClick={()=>setConfirm(null)}>Annulla</button></div>
    </EditorDialog>}
  </section>;
}
