import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./ClubEditor";
import { canPublishRoute, formatRouteValue, getRouteDiff, getRouteEditorError, normalizeRouteFields } from "./route-editor-data";

function RouteBreadcrumb({ club, course, route, onBack, onBackToClub, onBackToCourse, onBackToCatalog, editing, busy }) {
  return <nav aria-label="Percorso di navigazione" className="stablr-admin-breadcrumb">
    <button disabled={busy} onClick={onBackToCatalog} type="button">Club e percorsi</button><span>/</span>
    <button disabled={busy} onClick={onBackToClub} type="button">{club.name}</button><span>/</span>
    {course && <><button disabled={busy} onClick={onBackToCourse} type="button">{course.name}</button><span>/</span></>}
    {editing ? <><button disabled={busy} onClick={onBack} type="button">{route.name}</button><span>/</span><span>Modifica dati</span></> : <span>{route.name}</span>}
  </nav>;
}

export function RouteReadOnlyData({ club, context }) {
  const { route = {}, checks = {}, origins = [], holes = [] } = context;
  return <>
    <div className="stablr-admin-detail-grid">
      <article><span>Struttura · sola lettura</span><strong>{route.holes_count == null ? "—" : `${route.holes_count} buche`}</strong></article>
      <article><span>Par totale · sola lettura</span><strong>{route.total_par ?? "—"}</strong></article>
      <article><span>Ordine · sola lettura</span><strong>{formatRouteValue("order", route.order)}</strong></article>
      <article><span>Fonte · sola lettura</span><strong>{route.source_system || "—"}</strong></article>
      <article><span>Matching FIG del club · sola lettura</span><strong>{club.figMatchStatus === "unmatched" ? "Da collegare" : club.figMatchStatus || "—"}</strong></article>
      <article><span>Stato esterno del club · sola lettura</span><strong>{club.dataStatus || "—"}</strong></article>
    </div>
    <section className="stablr-admin-detail-section"><h2>Percorsi origine · sola lettura</h2>
      <div className="stablr-admin-route-origins">{origins.map((origin) => <article key={origin.position}>
        <span>{origin.position === 1 ? "Prime nove" : "Seconde nove"}</span><strong>{origin.name || "—"}</strong>
        <span>{origin.holes_count == null ? "—" : `${origin.holes_count} buche`}</span>
        <span>{origin.is_active == null ? "—" : origin.is_active ? "Attivo" : "Disattivato"}</span>
      </article>)}</div>
    </section>
    <section className="stablr-admin-detail-section"><h2>Controlli buche · sola lettura</h2>
      <div className="stablr-admin-detail-grid">
        <article><span>Buche presenti / previste</span><strong>{checks.actual_holes == null ? "—" : `${checks.actual_holes} / ${checks.expected_holes}`}</strong></article>
        <article><span>Buche mancanti</span><strong>{checks.missing_round_numbers == null ? "—" : checks.missing_round_numbers.length}</strong></article>
        <article><span>Numeri di giro duplicati</span><strong>{checks.duplicate_round_numbers ?? "—"}</strong></article>
        <article><span>Buche fisiche duplicate</span><strong>{checks.duplicate_physical_holes ?? "—"}</strong></article>
        <article><span>Riferimenti origine non validi</span><strong>{checks.invalid_origin_holes ?? "—"}</strong></article>
        <article><span>Par delle buche / totale</span><strong>{checks.par_sum ?? "—"} / {route.total_par ?? "—"}</strong></article>
      </div>
      {checks.missing_round_numbers?.length > 0 && <p className="stablr-admin-detail-empty">Buche di giro mancanti: {checks.missing_round_numbers.join(", ")}.</p>}
      {checks.coherent === false && <p className="stablr-admin-editor-error" role="status">La struttura non è coerente. La pubblicazione è bloccata; la correzione delle buche richiede il futuro editor dedicato.</p>}
      {checks.origins_active === false && <p className="stablr-admin-detail-empty">Uno o più percorsi origine sono disattivati. La Route non può essere pubblicata come attiva.</p>}
    </section>
    <section className="stablr-admin-detail-section"><h2>Sequenza buche · sola lettura</h2>
      {holes.length ? <div className="stablr-admin-route-hole-table" role="table" aria-label="Sequenza buche Route">
        <div role="row"><strong role="columnheader">Buca giro</strong><strong role="columnheader">Origine</strong><strong role="columnheader">Buca origine</strong><strong role="columnheader">Par</strong><strong role="columnheader">SI</strong></div>
        {holes.map((hole, index) => <div role="row" key={`${hole.round_hole_number}-${index}`}>
          <span role="cell">{hole.round_hole_number}</span><span role="cell">{origins.find((origin) => origin.position === hole.route_position)?.name || "—"}</span><span role="cell">{hole.physical_hole_number}</span><span role="cell">{hole.par}</span><span role="cell">{hole.stroke_index ?? "—"}</span>
        </div>)}
      </div> : <p className="stablr-admin-detail-empty">Nessuna buca disponibile nella sequenza.</p>}
    </section>
    <section className="stablr-admin-detail-section"><h2>Note · sola lettura</h2><p className="stablr-admin-detail-empty">{route.notes || "Nessuna nota disponibile."}</p></section>
    <p className="stablr-admin-detail-empty">Ordine, percorsi origine, sequenza buche, Par, fonti e note sono in sola lettura.</p>
  </>;
}

export function RouteDetail({ club, course, route, service, holeService, onManageHoles, onEdit, onBackToClub, onBackToCourse, onBackToCatalog }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [holeGrid, setHoleGrid] = useState(null);
  const [holeError, setHoleError] = useState(false);
  const [holeRetry, setHoleRetry] = useState(0);
  useEffect(() => {
    if (!holeService) return;
    let active = true;
    setHoleGrid(null); setHoleError(false);
    holeService.getGrid(route.id).then((data) => { if (active) setHoleGrid(data); }).catch((failure) => {
      console.error("Admin hole grid summary unavailable", failure);
      if (active) setHoleError(true);
    });
    return () => { active = false; };
  }, [route.id, holeService, holeRetry]);
  useEffect(() => {
    let active = true;
    setResult(null); setError("");
    service.getRoute(route.id).then((data) => { if (active) setResult(data); }).catch((failure) => {
      console.error("Admin Route detail unavailable", failure);
      if (active) setError("Impossibile caricare il riepilogo Route.");
    });
    return () => { active = false; };
  }, [route.id, service, retry]);
  return <section className="stablr-admin-detail">
    <RouteBreadcrumb {...{ club, course, route, onBackToClub, onBackToCourse, onBackToCatalog }} />
    <header className="stablr-admin-page-header"><div><h1>{route.name}</h1><p>{club.name}</p></div><span className="stablr-admin-status">{route.isActive === false ? "Disattivata" : "Attiva"}</span></header>
    {result ? <>
      <div className="stablr-admin-editor-actions stablr-admin-club-edit-entry"><button className="stablr-admin-white-button" onClick={onEdit} type="button">Modifica dati</button>{result.draft && <span className="stablr-admin-status">Bozza in corso</span>}</div>
      {onManageHoles && <div className="stablr-admin-editor-actions stablr-admin-club-edit-entry"><button className="stablr-admin-white-button" onClick={onManageHoles} type="button">Gestisci buche</button>{holeGrid?.draft && <span className="stablr-admin-status">Bozza buche in corso</span>}{holeError && <><span role="alert">Impossibile caricare lo stato della bozza buche.</span><button onClick={() => setHoleRetry((value) => value + 1)} type="button">Riprova buche</button></>}</div>}
      <RouteReadOnlyData club={club} context={result.context} />
    </> : error ? <><p role="alert">{error}</p><button className="stablr-admin-white-button" onClick={() => setRetry((value) => value + 1)} type="button">Riprova</button></> : <p className="stablr-admin-detail-empty">Caricamento Route…</p>}
  </section>;
}

export default function RouteEditor({ club, course, route, service, onBack, onBackToClub, onBackToCourse, onBackToCatalog, onEditHoles, onPublished, registerExitGuard }) {
  const [draft, setDraft] = useState(null);
  const [context, setContext] = useState(null);
  const [fields, setFields] = useState({ name: "", is_active: true });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingExit, setPendingExit] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [abandonConfirmation, setAbandonConfirmation] = useState(false);
  const inFlight = useRef(false);
  const dirty = draft && JSON.stringify(normalizeRouteFields(fields)) !== JSON.stringify(normalizeRouteFields(draft.snapshot));

  useEffect(() => {
    let active = true;
    service.openDraft(route.id).then((opened) => {
      if (active) { setDraft(opened.draft); setFields(opened.draft.snapshot); setContext(opened.context); }
    }).catch((failure) => {
      console.error("Admin Route draft open failed", failure);
      if (active) setError(getRouteEditorError(failure));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [route.id, service]);

  useEffect(() => {
    registerExitGuard((action) => {
      if (inFlight.current || confirmation || abandonConfirmation || pendingExit) return;
      if (dirty) setPendingExit(() => action);
      else action();
    });
    const beforeUnload = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { registerExitGuard(null); window.removeEventListener("beforeunload", beforeUnload); };
  }, [dirty, confirmation, abandonConfirmation, pendingExit, registerExitGuard]);

  const operation = async (callback) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try { await callback(); }
    catch (failure) { console.error("Admin Route editor operation failed", failure); setError(getRouteEditorError(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const save = async () => {
    const saved = await service.saveDraft(draft, fields);
    setDraft(saved); setFields(saved.snapshot);
    setMessage("Bozza salvata. Il catalogo pubblicato resta invariato.");
    return saved;
  };
  const reviewPublication = () => operation(async () => {
    const saved = dirty ? await save() : draft;
    setConfirmation({ draft: saved, changes: getRouteDiff(saved.base_snapshot, saved.snapshot) });
  });
  const confirmPublication = () => operation(async () => {
    const result = await service.publishDraft(confirmation.draft);
    setConfirmation(null); onPublished(result.route);
  });
  const abandonDraft = () => operation(async () => {
    await service.abandonDraft(draft);
    setAbandonConfirmation(false); setDraft(null); registerExitGuard(null); onBack();
  });
  const openHoleEditor = () => {
    if (dirty) setPendingExit(() => onEditHoles);
    else onEditHoles();
  };
  const update = (key, value) => { setFields((current) => ({ ...current, [key]: value })); setMessage(""); };
  const normalized = normalizeRouteFields(fields);
  const valid = normalized.name.length > 0 && normalized.name.length <= 200;
  const changes = draft ? getRouteDiff(draft.base_snapshot, fields) : [];

  return <section className="stablr-admin-detail stablr-admin-route-editor">
    <RouteBreadcrumb {...{ club, course, route, onBack, onBackToClub, onBackToCourse, onBackToCatalog, busy }} editing />
    <header className="stablr-admin-page-header stablr-admin-editor-header"><div><h1>Modifica dati Route</h1><p>{route.name} · {club.name}</p></div>{draft && <div className="stablr-admin-editor-header-side"><span className="stablr-admin-status">Bozza in corso</span><div className="stablr-admin-editor-header-actions"><button className="stablr-admin-draft-save-button" disabled={busy || !valid} onClick={() => operation(save)} type="button">Salva bozza</button><button className="stablr-admin-publish-button" disabled={busy || !valid || !changes.length || !canPublishRoute(context, normalized)} onClick={reviewPublication} type="button">Pubblica</button></div></div>}</header>
    {loading ? <p className="stablr-admin-detail-empty">Caricamento bozza…</p> : draft && <>
      <form className="stablr-admin-editor-fields" onSubmit={(event) => { event.preventDefault(); operation(save); }}>
        <label>Nome visualizzato<input disabled={busy} maxLength={200} onChange={(event) => update("name", event.target.value)} required value={fields.name} /></label>
        <label>Stato operativo<select disabled={busy} onChange={(event) => update("is_active", event.target.value === "true")} value={String(fields.is_active)}><option value="true">Attiva</option><option value="false">Disattivata</option></select></label>
      </form>
      <div className="stablr-admin-child-editor-action"><button className="stablr-admin-white-button" disabled={busy} onClick={openHoleEditor} type="button">Modifica buche</button></div>
      <RouteReadOnlyData club={club} context={context} />
      {dirty && <p className="stablr-admin-detail-empty">Modifiche non salvate</p>}
      <div className="stablr-admin-abandon-zone"><button className="stablr-admin-abandon-button" disabled={busy} onClick={() => { setError(""); setAbandonConfirmation(true); }} type="button">Abbandona bozza</button></div>
    </>}
    {message && <p role="status">{message}</p>}
    {error && !confirmation && !pendingExit && !abandonConfirmation && <p className="stablr-admin-editor-error" role="alert">{error}</p>}
    {!loading && !draft && <button className="stablr-admin-white-button" onClick={onBack} type="button">Torna alla Route</button>}
    {pendingExit && <EditorDialog title="Modifiche non salvate">
      <p>Salva nella bozza oppure scarta solo le modifiche non salvate. La bozza già salvata rimane disponibile.</p>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !valid} onClick={() => operation(async () => { await save(); pendingExit(); })} type="button">Salva bozza</button><button disabled={busy} onClick={() => pendingExit()} type="button">Scarta</button><button disabled={busy} onClick={() => { setPendingExit(null); setError(""); }} type="button">Resta</button></div>
    </EditorDialog>}
    {confirmation && <EditorDialog title="Conferma pubblicazione">
      <p>Queste modifiche saranno visibili nel catalogo. Disattivare una Route non elimina i suoi dati.</p>
      <div className="stablr-admin-editor-diff" role="table" aria-label="Differenze Route">
        <div role="row"><strong role="columnheader">Campo</strong><strong role="columnheader">Prima</strong><strong role="columnheader">Dopo</strong></div>
        {confirmation.changes.map((change) => <div key={change.key} role="row"><span role="cell">{change.label}</span><span role="cell">{formatRouteValue(change.key, change.before)}</span><span role="cell">{formatRouteValue(change.key, change.after)}</span></div>)}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy || !confirmation.changes.length} onClick={confirmPublication} type="button">Conferma pubblicazione</button><button disabled={busy} onClick={() => setConfirmation(null)} type="button">Annulla</button></div>
    </EditorDialog>}
    {abandonConfirmation && <EditorDialog title="Abbandona bozza">
      <p>Abbandonare la bozza? Le modifiche non pubblicate non saranno più riprese. Il catalogo pubblicato non cambia.</p>
      {error && <p role="alert">{error}</p>}
      <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={busy} onClick={abandonDraft} type="button">Conferma abbandono</button><button disabled={busy} onClick={() => { setAbandonConfirmation(false); setError(""); }} type="button">Annulla</button></div>
    </EditorDialog>}
  </section>;
}
