import {useEffect,useState} from "react";
import {EditorDialog} from "./ClubEditor";
import TechnicalRows from "./TechnicalRows";
import {metadataPreviewChanges,metadataValue,validEditorialFields} from "./catalog-metadata-data";

export function CatalogMetadataFields({fields,update,disabled,orderLabel="Ordine"}) {
  const [orderError,setOrderError]=useState("");
  return <>
    <label>{orderLabel}<input type="number" min={-2147483648} max={2147483647} step={1} value={fields.display_order??""} disabled={disabled}
      onChange={e=>{const raw=e.target.value,value=Number(raw);if(raw===""||(Number.isInteger(value)&&value>=-2147483648&&value<=2147483647)){setOrderError("");update("display_order",raw);}else setOrderError("Ordine rifiutato: usa un intero nei limiti indicati, senza ciclo minimo/massimo.");}}/></label>
    <label>Alias (uno per riga)<textarea maxLength={4020} value={Array.isArray(fields.aliases)?fields.aliases.join("\n"):fields.aliases||""} disabled={disabled} onChange={e=>update("aliases",e.target.value)}/></label>
    <label>Note catalogo<textarea maxLength={5000} value={fields.notes||""} disabled={disabled} onChange={e=>update("notes",e.target.value)}/></label>
    {orderError&&<p className="stablr-admin-editor-error" role="alert">{orderError}</p>}
    {!validEditorialFields(fields)&&<p className="stablr-admin-editor-error" role="alert">Usa al massimo 20 alias distinti, fino a 200 caratteri ciascuno, e note fino a 5000 caratteri.</p>}
    <p className="stablr-admin-detail-empty">Denominazione curata, alias e note editoriali di catalogo sono separati dai dati FIG/GesGolf originali. Non inserire dati personali o note riservate.</p>
  </>;
}

function MetadataDiff({changes,label,feminine=false}) {
  const format=(key,value)=>key==="is_active"&&feminine?(value?"Attiva":"Disattivata"):metadataValue(key,value);
  return <div className="stablr-admin-editor-diff" role="table" aria-label={label}>
    <div role="row"><strong role="columnheader">Campo</strong><strong role="columnheader">Prima</strong><strong role="columnheader">Dopo</strong></div>
    {changes.map(change=><div role="row" key={change.key}><span role="cell">{change.label}</span><span role="cell">{format(change.key,change.before)}</span><span role="cell">{format(change.key,change.after)}</span></div>)}
  </div>;
}
export function CatalogMetadataRecovery({busy,onRecover}) {
  return <div className="stablr-admin-metadata-info"><p>La verifica legge la bozza e l’eventuale versione pubblicata. Non pubblica, non ricrea e non abbandona dati.</p><button className="stablr-admin-white-button" type="button" disabled={busy} onClick={onRecover}>Verifica esito e recupera bozza</button></div>;
}
export function CatalogMetadataPublication({plan,note,onNote,busy,error,onConfirm,onCancel,label,recoveryRequired=false,onRecover}) {
  const separated=plan.impact.metadata_only===true;
  const entityLabel=plan.kind==="route"?"Percorso":"combinazione";
  const liveKeys=plan.kind==="route"?["name","is_active","display_order","holes_count"]:["name","is_active"];
  const liveChanges=metadataPreviewChanges(plan).filter(change=>liveKeys.includes(change.key));
  const hasFoundation=plan.impact.foundation.length>0||plan.impact.source_links_count>0;
  return <EditorDialog title="Conferma pubblicazione" formControls>
    <p>Anteprima server-side. La conferma pubblica solo le modifiche indicate; origini, sezioni, Par/SI, tee, distanze, giri e snapshot non vengono riscritti.</p>
    <MetadataDiff changes={metadataPreviewChanges(plan)} label={`Differenze ${label}`} feminine={plan.kind==="route_combination"}/>
    <div className="stablr-admin-metadata-info"><strong>Impatto sui collegamenti</strong>
      {separated?<p>Solo metadati editoriali separati: il record live e la sua data di aggiornamento non cambiano. Le baseline fisiche restano invariate; la pubblicazione viene comunque versionata.</p>
        :<><p>Campi live modificati: {liveChanges.map(change=>change.label).join(", ")||"quelli indicati nel confronto"}. La data di aggiornamento del record {entityLabel} cambia. Il confronto comprende tutte le modifiche salvate nella bozza.</p>
          {hasFoundation&&<p>Dipendenza coinvolta: la fotografia sorgente del record {entityLabel}, usata dalle configurazioni collegate, include nome e data di aggiornamento. Anche una nuova denominazione può renderla non più allineata e bloccare le pubblicazioni Par; le eventuali classificazioni tee derivate dipendono dalla validità di queste configurazioni. Nessuna baseline viene riallineata automaticamente.</p>}
          {plan.impact.source_links_count>0&&<p>Collegamenti fisici del Percorso coinvolti: {plan.impact.source_links_count}.</p>}
        </>}
    </div>
    <TechnicalRows label={separated?"configurazioni collegate (non modificate)":"configurazioni interessate"} controlClassName="stablr-admin-abandon-button">{plan.impact.foundation.map(item=><p key={item.id}>{item.label} · revisione {item.revision} · {item.review_status==="verified"?"Verificata":"Da revisionare"}</p>)}</TechnicalRows>
    {plan.warnings.map((warning,i)=><p className="stablr-admin-metadata-warning" key={i}>{warning}</p>)}
    {plan.blockers.map((block,i)=><p className="stablr-admin-editor-error" role="alert" key={i}>{block}</p>)}
    <label className="stablr-admin-new-club-publication-note">Motivazione breve<textarea required maxLength={500} value={note} onChange={e=>onNote(e.target.value)} disabled={busy}/></label>
    {error&&<p className="stablr-admin-editor-error" role="alert">{error}</p>}
    {busy&&<p role="status">Pubblicazione in corso…</p>}
    {recoveryRequired&&<CatalogMetadataRecovery busy={busy} onRecover={onRecover}/>}
    <div className="stablr-admin-editor-header-actions stablr-admin-new-holes-dialog-actions"><button className="stablr-admin-publish-button" type="button" disabled={busy||recoveryRequired||!plan.can_publish||!note.trim()} onClick={onConfirm}>Conferma pubblicazione</button><button className="stablr-admin-abandon-button" type="button" disabled={busy} onClick={onCancel}>Annulla</button></div>
  </EditorDialog>;
}

export function CatalogMetadataHistory({target,service,onRestored}) {
  const [data,setData]=useState(null),[error,setError]=useState(""),[retry,setRetry]=useState(0),[selected,setSelected]=useState(null),[restore,setRestore]=useState(null),[busy,setBusy]=useState(false);
  useEffect(()=>{if(!service?.getHistory)return;let active=true;setData(null);setError("");service.getHistory(target).then(result=>{if(active)setData(result);}).catch(failure=>{console.error("Admin metadata history failed",failure?.code||"request_failed");if(active)setError("Impossibile caricare le versioni dei metadati.");});return()=>{active=false;};},[target,service,retry]);
  if(!service?.getHistory)return null;
  return <section className="stablr-admin-detail-section stablr-admin-catalog-metadata"><h2>Versioni metadati pubblicate</h2>
    {error&&<p role="alert" className="stablr-admin-editor-error">{error}</p>}
    {!data&&!error&&<p role="status">Caricamento versioni…</p>}
    {error&&!restore&&<button className="stablr-admin-abandon-button" type="button" onClick={()=>setRetry(n=>n+1)}>Riprova versioni</button>}
    {data&&<><div className="stablr-admin-detail-grid"><article><span>Alias curati</span><strong>{metadataValue("aliases",data.fields?.aliases)}</strong></article><article><span>Note catalogo</span><strong>{metadataValue("notes",data.fields?.notes)}</strong></article><article><span>Ordine curato</span><strong>{metadataValue("display_order",data.fields?.display_order)}</strong></article></div>{!data.history.length&&<p>Nessuna versione pubblicata disponibile.</p>}
      {data.has_open_draft&&!!data.history.length&&<p>Abbandona esplicitamente la bozza personale in corso prima di ripristinare una versione. Nessuna bozza viene sovrascritta.</p>}
      <TechnicalRows label="versioni metadati" controlClassName="stablr-admin-abandon-button">{data.history.map(version=><div className="stablr-admin-metadata-history-row" key={version.version_id}><span>Versione {version.version_number} · {new Date(version.published_at).toLocaleString("it-IT")}</span><div className="stablr-admin-editor-header-actions"><button className="stablr-admin-abandon-button" type="button" onClick={()=>setSelected(selected===version.version_id?null:version.version_id)}>Differenze versione {version.version_number}</button><button className="stablr-admin-white-button" type="button" disabled={busy||data.has_open_draft} onClick={()=>{setError("");setRestore(version);}}>Ripristina versione {version.version_number} in nuova bozza</button></div>
        {selected===version.version_id&&<><p>{version.note||"Versione catalogo: sono mostrati solo i metadati disponibili."}</p><MetadataDiff changes={metadataPreviewChanges({changes:version.changes})} label={`Differenze versione ${version.version_number}`}/></>}
      </div>)}</TechnicalRows>
    </>}
    {restore&&<EditorDialog title="Ripristina metadati in nuova bozza"><p>Creare una nuova bozza dalla versione {restore.version_number}? Il live non cambia. Struttura, origini e campi non presenti nella versione non vengono ripristinati.</p>{error&&<p className="stablr-admin-editor-error" role="alert">{error}</p>}<div className="stablr-admin-editor-header-actions stablr-admin-new-holes-dialog-actions"><button className="stablr-admin-white-button" type="button" disabled={busy} onClick={async()=>{setBusy(true);try{await service.restoreVersion(target,restore);setRestore(null);onRestored();}catch(failure){console.error("Admin metadata restore failed",failure?.code||"request_failed");setError("Ripristino non completato. Verifica che non esista una bozza personale aperta e riprova.");}finally{setBusy(false);}}}>Conferma nuova bozza</button><button className="stablr-admin-abandon-button" type="button" disabled={busy} onClick={()=>{setRestore(null);setError("");}}>Annulla</button></div></EditorDialog>}
  </section>;
}
