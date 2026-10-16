import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import TechnicalRows from "./TechnicalRows";
import { emptyCombination, validNewCombination, newCombinationError } from "./new-combination-data";
import { ratingCategoryLabel } from "./new-club-tees-data";
import { courseTeeColor } from "./course-tee-editor-data";
import { cycleTeeSi } from "./tee-si-data";

const SI_SCALE = Array.from({ length: 18 }, (_, i) => i + 1);

export default function NewCombinations({club,ownerId,service,registerExitGuard,onBack,onPublished}) {
  const [data,setData]=useState(null),[error,setError]=useState(""),[retry,setRetry]=useState(0),[loading,setLoading]=useState(true);
  const [draft,setDraft]=useState(null),[fields,setFields]=useState(null),[busy,setBusy]=useState(false),[pending,setPending]=useState(null);
  const [abandon,setAbandon]=useState(false),[preview,setPreview]=useState(null),[confirm,setConfirm]=useState(false),[note,setNote]=useState("");
  const [removeTee,setRemoveTee]=useState(null);
  const [siFeedback,setSiFeedback]=useState(null);
  const flight=useRef(false);
  const dirty=!!fields&&JSON.stringify(fields)!==JSON.stringify(draft?.snapshot||emptyCombination(club.id));
  const valid=!!fields&&validNewCombination(fields);
  const blocked=busy||!!pending||abandon||!!preview||removeTee!==null;
  useEffect(()=>{
    let active=true;setLoading(true);setError("");
    service.list(club.id,ownerId).then(result=>{if(active)setData(result);})
      .catch(e=>{console.error("Admin new combination read failed",e?.code||"request_failed");if(active)setError(newCombinationError(e));})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[club.id,ownerId,service,retry]);
  useEffect(()=>{
    registerExitGuard(action=>{if(flight.current||preview||pending||abandon||removeTee!==null)return;if(dirty)setPending(()=>action);else action();});
    const unload=e=>{if(dirty){e.preventDefault();e.returnValue="";}};
    window.addEventListener("beforeunload",unload);
    return()=>{registerExitGuard(null);window.removeEventListener("beforeunload",unload);};
  },[registerExitGuard,dirty,preview,pending,abandon,removeTee]);
  const operation=async action=>{
    if(flight.current)return;flight.current=true;setBusy(true);setError("");
    try{await action();}catch(e){console.error("Admin new combination operation failed",e?.code||"request_failed");setError(newCombinationError(e));}
    finally{flight.current=false;setBusy(false);}
  };
  const save=async()=>{
    const saved=await service.save(club.id,ownerId,draft,fields);setDraft(saved);setFields(saved.snapshot);
    setData(current=>({...current,drafts:[saved,...current.drafts.filter(d=>d.draft_id!==saved.draft_id)]}));return saved;
  };
  const leave=action=>{if(dirty)setPending(()=>action);else action();};
  const update=(key,value)=>{setFields(old=>({...old,[key]:value}));setError("");};
  const selectOrigin=(key,value)=>{
    const next={...fields,[key]:value},f=data.sections.find(s=>s.id===next.front_configuration_id),b=data.sections.find(s=>s.id===next.back_configuration_id);
    next.source_hash=f&&b?f.source_hash+b.source_hash:"";setFields(next);setError("");
  };
  const front=data?.sections.find(s=>s.id===fields?.front_configuration_id),back=data?.sections.find(s=>s.id===fields?.back_configuration_id);
  const sources=[...(front?.holes||[]),...(back?.holes||[])];
  const siComplete=fields?.holes.every(h=>h.si!==null)&&new Set(fields?.holes.map(h=>h.si)).size===18;
  const duplicateSi=[...new Set((fields?.holes||[]).map(h=>h.si).filter((si,i,values)=>si!==null&&values.indexOf(si)!==i))];
  const setSi=(position,si)=>{setSiFeedback(null);update("holes",fields.holes.map(h=>h.position===position?{...h,si}:h));};
  const stepSi=(hole,direction)=>setSi(hole.position,cycleTeeSi(hole.si,SI_SCALE,direction));
  const editSi=(hole,raw)=>{
    if(raw===""){setSi(hole.position,null);return;}
    if(/^(?:[1-9]|1[0-8])$/.test(raw)){setSi(hole.position,Number(raw));return;}
    setSiFeedback({position:hole.position,message:`Buca ${hole.position}: valore rifiutato. Usa SI interi da 1 a 18; il valore precedente non è cambiato.`});
  };
  const updateTee=(i,key,value)=>update("tees",fields.tees.map((t,n)=>n===i?{...t,[key]:value}:t));
  const close=()=>{setFields(null);setDraft(null);setError("");setSiFeedback(null);};
  return <section className="stablr-admin-detail stablr-admin-new-combination">
    <nav className="stablr-admin-breadcrumb" aria-label="Percorso di navigazione"><button type="button" disabled={blocked} onClick={()=>leave(onBack)}>{club.name}</button><span>/</span><span>Nuove combinazioni</span></nav>
    <header className="stablr-admin-page-header"><div><h1>{fields?"Bozza nuova combinazione":"Nuove combinazioni"}</h1><p>{club.name} · 18 buche · privata fino alla pubblicazione</p></div>
      {fields&&<div className="stablr-admin-editor-header-actions"><button className="stablr-admin-draft-save-button" type="button" disabled={blocked||!valid} onClick={()=>operation(save)}>Salva bozza</button>
        <button className="stablr-admin-publish-button" type="button" disabled={blocked||dirty||!draft} onClick={()=>operation(async()=>{setPreview(await service.preview(club.id,ownerId,draft));setConfirm(false);setNote("");})}>Anteprima pubblicazione</button></div>}
    </header>
    {loading&&<p role="status">Caricamento sezioni verificate e bozze…</p>}
    {error&&<p className="stablr-admin-new-combination-blocker" role="alert">{error}</p>}
    {!data&&!loading&&<button className="stablr-admin-abandon-button" type="button" onClick={()=>setRetry(n=>n+1)}>Riprova</button>}
    {data&&!loading&&!fields&&<>
      <button className="stablr-admin-white-button" type="button" disabled={data.sections.length<2} onClick={()=>{setDraft(null);setFields(emptyCombination(club.id));setError("");}}>Crea combinazione 18</button>
      <p className="stablr-admin-detail-empty">Due sezioni fisiche 9 verificate, di Percorsi distinti nella stessa struttura. Nessun collegamento viene dedotto.</p>
      {data.sections.length<2&&<p role="status">Non sono disponibili due sezioni fisiche 9 compatibili e verificate. Completa la verifica in Struttura e collegamenti.</p>}
      <section className="stablr-admin-detail-section"><h2>Bozze private</h2>{!data.drafts.length&&<p>Nessuna bozza di nuova combinazione.</p>}
        {data.drafts.map(d=><div className="stablr-admin-course-row" key={d.draft_id}><strong>{d.snapshot.name}</strong><span className="stablr-admin-status">Bozza in corso</span><button className="stablr-admin-white-button" type="button" onClick={()=>{setDraft(d);setFields(d.snapshot);setError("");}}>Riprendi {d.snapshot.name}</button></div>)}
      </section>
      {!!data.excluded.length&&<section className="stablr-admin-detail-section"><h2>Sezioni non disponibili</h2><TechnicalRows label="sezioni non disponibili" controlClassName="stablr-admin-abandon-button">{data.excluded.map((x,i)=><p key={i}>{x.label} · {x.reason}</p>)}</TechnicalRows></section>}
    </>}
    {fields&&<>
      {draft&&<p className="stablr-admin-status">Bozza in corso</p>}
      <section className="stablr-admin-detail-section"><h2>Dati combinazione</h2><div className="stablr-admin-editor-fields">
        <label>Nome combinazione<input maxLength={200} required disabled={blocked} value={fields.name} onChange={e=>update("name",e.target.value)}/></label>
        <label>Struttura<input readOnly value="18 buche · due sezioni 9"/></label>
        {[["front_configuration_id","Prime nove"],["back_configuration_id","Seconde nove"]].map(([key,label])=><label key={key}>{label}<select disabled={blocked} value={fields[key]} onChange={e=>selectOrigin(key,e.target.value)}><option value="">Scegli sezione verificata</option>
          {data.sections.map(s=><option key={s.id} value={s.id} disabled={key==="back_configuration_id"?s.course_id===front?.course_id||s.structure_id!==front?.structure_id:key==="front_configuration_id"&&s.course_id===back?.course_id}>{s.label} · 9 buche verificate</option>)}
        </select></label>)}
      </div><p>Par ereditato dalle buche fisiche verificate. SI della nuova combinazione, mai dedotti dalle sezioni origine. Tee/rating da dichiarare esplicitamente.</p></section>
      <section className="stablr-admin-detail-section"><h2>Buche e SI della combinazione</h2><p>18 buche · <strong>Totale Par: {sources.length===18?sources.reduce((n,h)=>n+h.par,0):"—"}</strong></p>
        <div className="stablr-admin-new-tees-scroll"><table className="stablr-admin-new-tees-table"><thead><tr><th>Buca</th><th>Origine</th><th>Par ereditato</th><th>SI/HCP</th></tr></thead><tbody>{fields.holes.map((h,i)=><tr key={h.position}><th scope="row">{h.position}</th><td>{i<9?front?.label||"—":back?.label||"—"} · buca {sources[i]?.physical_hole_number??"—"}</td><td>{sources[i]?.par??"—"}</td><td>
          <div className="stablr-admin-new-holes-input-control">
            <button aria-label={`SI buca ${h.position} precedente`} type="button" disabled={blocked} onClick={()=>stepSi(h,-1)}>‹</button>
            <input aria-label={`SI buca ${h.position}`} type="number" min={1} max={18} step={1} value={h.si??""} disabled={blocked}
              aria-invalid={siFeedback?.position===h.position||duplicateSi.includes(h.si)||undefined}
              aria-describedby={siFeedback?.position===h.position?"new-combination-si-feedback":duplicateSi.includes(h.si)?"new-combination-si-duplicates":undefined}
              onKeyDown={e=>{if(e.key==="ArrowUp"||e.key==="ArrowDown"){e.preventDefault();stepSi(h,e.key==="ArrowUp"?1:-1);}}}
              onChange={e=>editSi(h,e.target.value)}/>
            <button aria-label={`SI buca ${h.position} successivo`} type="button" disabled={blocked} onClick={()=>stepSi(h,1)}>›</button>
          </div>
        </td></tr>)}</tbody></table></div>
        {siFeedback&&<p className="stablr-admin-new-combination-blocker" role="alert" id="new-combination-si-feedback">{siFeedback.message}</p>}
        {!!duplicateSi.length&&<p className="stablr-admin-new-combination-blocker" role="alert" id="new-combination-si-duplicates">SI duplicati: {duplicateSi.join(", ")}. La pubblicazione richiede SI univoci da 1 a 18.</p>}
        {!siComplete&&<p role="status">Completa SI univoci da 1 a 18 prima della pubblicazione. Puoi salvare una bozza incompleta.</p>}
      </section>
      <section className="stablr-admin-detail-section"><h2>Tee e rating privati</h2><p>Ambito 18 buche e Par totale sono derivati dalla griglia, non modificabili. Nessun rating copiato dalle origini.</p>
        <button className="stablr-admin-white-button" type="button" disabled={blocked||fields.tees.length>=40} onClick={()=>update("tees",[...fields.tees,{name:"",tee_color:null,rating_category:"unspecified",course_rating:null,slope_rating:null,is_active:true,display_order:fields.tees.length}])}>Aggiungi tee</button>
        {fields.tees.map((t,i)=><fieldset key={i} className="stablr-admin-detail-section" disabled={blocked}><legend>Tee {i+1}</legend><div className="stablr-admin-editor-fields">
          <label>Nome tee<input required maxLength={200} value={t.name} onChange={e=>updateTee(i,"name",e.target.value)}/></label>
          <label>Colore<input maxLength={100} value={t.tee_color||""} onChange={e=>updateTee(i,"tee_color",e.target.value)}/></label>
          <label>Categoria del rating<select value={t.rating_category} onChange={e=>updateTee(i,"rating_category",e.target.value)}><option value="unspecified">Non specificata</option><option value="men">Uomini</option><option value="women">Donne</option></select></label>
          <label>Course Rating<input type="text" inputMode="decimal" value={t.course_rating??""} onChange={e=>updateTee(i,"course_rating",e.target.value)}/></label>
          <label>Slope Rating<input type="number" min={55} max={155} step={1} value={t.slope_rating??""} onChange={e=>updateTee(i,"slope_rating",e.target.value)}/></label>
          <label>Ordine tee<input type="number" min={-2147483648} max={2147483647} step={1} value={t.display_order} onChange={e=>updateTee(i,"display_order",e.target.value)}/></label>
          <label>Stato operativo<select value={t.is_active?"active":"inactive"} onChange={e=>updateTee(i,"is_active",e.target.value==="active")}><option value="active">Attivo</option><option value="inactive">Disattivato</option></select></label>
        </div><button className="stablr-admin-abandon-button" type="button" onClick={()=>setRemoveTee(i)}>Rimuovi tee dalla bozza</button></fieldset>)}
        {!!fields.tees.length&&!fields.tees.every((t,i)=>fields.tees.findIndex(x=>x.name.trim().toLowerCase()===t.name.trim().toLowerCase())===i)&&<p className="stablr-admin-new-combination-blocker" role="alert">I nomi tee devono essere distinti anche fra categorie, come richiesto dal catalogo live.</p>}
      </section>
      {dirty&&<p className="stablr-admin-detail-empty">Modifiche non salvate. Salva la bozza per aggiornare l’anteprima.</p>}
      <button className="stablr-admin-abandon-button" disabled={blocked} type="button" onClick={()=>leave(close)}>Torna alle bozze combinazioni</button>
      {draft&&<div className="stablr-admin-abandon-zone"><button className="stablr-admin-abandon-button" disabled={blocked} type="button" onClick={()=>setAbandon(true)}>Abbandona bozza</button></div>}
    </>}
    {preview&&<EditorDialog title={confirm?"Conferma pubblicazione combinazione":"Anteprima pubblicazione combinazione"}>
      <h3>{preview.name}</h3><p>{preview.front.label} → {preview.back.label} · 18 buche · Totale Par: {preview.total_par}</p>
      <div className="stablr-admin-new-combination-info"><p>Nuovi record: 1 combinazione, 18 buche e {preview.tees.length} tee. Collegamenti fisici verificati e storico saranno registrati nella stessa transazione. Nessun record esistente viene modificato.</p></div>
      {!!preview.blockers.length&&<div className="stablr-admin-new-combination-blocker" role="alert"><strong>Pubblicazione bloccata</strong>{preview.blockers.map((b,i)=><p key={i}>{b}</p>)}</div>}
      {!confirm&&<><TechnicalRows label="anteprima buche" controlClassName="stablr-admin-abandon-button">{preview.holes.map(h=><p key={h.position}>Buca {h.position} · {h.component_position===1?preview.front.label:preview.back.label} · buca {h.physical_hole_number} · occorrenza {h.occurrence} · Par {h.par} ereditato · SI {h.si??"—"}</p>)}</TechnicalRows>
        {preview.tees.map((t,i)=><p key={i}><span aria-hidden="true" style={{display:"inline-block",width:10,height:10,borderRadius:"50%",background:courseTeeColor(t.tee_color),marginRight:8}}/>{t.name} · {ratingCategoryLabel(t.rating_category)} · CR {t.course_rating??"—"} · Slope {t.slope_rating??"—"} · {t.is_active?"Attivo":"Disattivato"}</p>)}</>}
      {confirm&&<label className="stablr-admin-new-club-publication-note">Motivazione breve<textarea maxLength={500} required disabled={busy} value={note} onChange={e=>setNote(e.target.value)}/></label>}
      {error&&<p className="stablr-admin-new-combination-blocker" role="alert">{error}</p>}
      <div className="stablr-admin-editor-header-actions stablr-admin-new-holes-dialog-actions"><button className="stablr-admin-publish-button" type="button" disabled={busy||!preview.can_publish||(confirm&&!note.trim())} onClick={()=>{if(!confirm){setConfirm(true);return;}operation(async()=>{const result=await service.publish(club.id,ownerId,draft,preview,note);registerExitGuard(null);onPublished(result);}).then(()=>{setPreview(null);setConfirm(false);});}}>{confirm?"Conferma pubblicazione combinazione":"Pubblica combinazione"}</button>
        <button className="stablr-admin-abandon-button" disabled={busy} type="button" onClick={()=>{setPreview(null);setConfirm(false);setError("");}}>Chiudi anteprima</button></div>
    </EditorDialog>}
    {pending&&<EditorDialog title="Modifiche combinazione non salvate"><p>Salva la bozza oppure scarta solo le modifiche non salvate. La bozza già salvata rimane disponibile.</p>{error&&<p className="stablr-admin-new-combination-blocker" role="alert">{error}</p>}<div className="stablr-admin-editor-header-actions stablr-admin-new-holes-dialog-actions">
      <button className="stablr-admin-draft-save-button" type="button" disabled={busy||!valid} onClick={()=>operation(async()=>{await save();const action=pending;setPending(null);action();})}>Salva bozza</button>
      <button className="stablr-admin-abandon-button" type="button" disabled={busy} onClick={()=>{const action=pending;setPending(null);action();}}>Scarta modifiche</button>
      <button className="stablr-admin-abandon-button" type="button" disabled={busy} onClick={()=>setPending(null)}>Resta</button></div></EditorDialog>}
    {abandon&&<EditorDialog title="Abbandona bozza combinazione"><p>Abbandonare la bozza? Le modifiche non pubblicate non saranno più riprese. Il catalogo pubblicato non cambia.</p>{error&&<p className="stablr-admin-new-combination-blocker" role="alert">{error}</p>}<div className="stablr-admin-editor-header-actions stablr-admin-new-holes-dialog-actions"><button className="stablr-admin-danger-button" type="button" disabled={busy} onClick={()=>operation(async()=>{await service.archive(club.id,ownerId,draft);setData(d=>({...d,drafts:d.drafts.filter(x=>x.draft_id!==draft.draft_id)}));setAbandon(false);close();})}>Conferma abbandono</button><button className="stablr-admin-abandon-button" type="button" disabled={busy} onClick={()=>setAbandon(false)}>Annulla</button></div></EditorDialog>}
    {removeTee!==null&&<EditorDialog title="Rimuovi tee privato"><p>Rimuovere il tee solo da questa bozza? Nessun tee pubblicato viene modificato.</p><div className="stablr-admin-editor-header-actions stablr-admin-new-holes-dialog-actions"><button className="stablr-admin-danger-button" type="button" onClick={()=>{update("tees",fields.tees.filter((_,i)=>i!==removeTee));setRemoveTee(null);}}>Conferma rimozione</button><button className="stablr-admin-abandon-button" type="button" onClick={()=>setRemoveTee(null)}>Annulla</button></div></EditorDialog>}
  </section>;
}
