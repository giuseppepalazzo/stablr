import { useEffect, useRef, useState } from "react";
import NewClubEditor from "./NewClubEditor";
import { EditorDialog } from "./ClubEditor";

export default function NewClubCreation({ draftId, ownerId, service, onBack, onOpenExisting, registerExitGuard }) {
  const [step, setStep] = useState(draftId ? "editor" : "choice");
  const [query, setQuery] = useState(""), [results, setResults] = useState(null);
  const [selected, setSelected] = useState(null), [confirmed, setConfirmed] = useState(null);
  const [confirmation, setConfirmation] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const searching = useRef(false), mounted = useRef(true), searchGeneration = useRef(0);
  useEffect(() => { mounted.current = true;return () => { mounted.current = false; }; }, []);
  if (step === "editor") return <NewClubEditor draftId={draftId} figClubId={confirmed?.id || null}
    ownerId={ownerId} service={service} onBack={onBack} onOpenExisting={onOpenExisting} registerExitGuard={registerExitGuard} />;
  const canCreate = !!selected && !selected.existingClubs?.length;

  const search = async (event) => {
    event.preventDefault();
    if (searching.current || !query.trim()) return;
    const generation = ++searchGeneration.current;
    searching.current = true;setBusy(true);setError("");setSelected(null);setResults(null);
    try {
      const rows = await service.searchFigClubs(query, ownerId);
      if (mounted.current && generation === searchGeneration.current) setResults(rows);
    } catch (failure) {
      console.error("Admin FIG Club search failed", failure?.code || "request_failed");
      if (mounted.current && generation === searchGeneration.current) setError("Impossibile cercare nel catalogo FIG. Riprova.");
    } finally { if (generation === searchGeneration.current) { searching.current = false;if (mounted.current) setBusy(false); } }
  };
  return <section className="stablr-admin-detail stablr-admin-new-club-start">
    <nav className="stablr-admin-breadcrumb" aria-label="Percorso di navigazione"><button type="button" onClick={onBack}>Club e percorsi</button><span>/</span><span>Nuovo club</span></nav>
    <header className="stablr-admin-page-header"><div><h1>Nuovo club</h1><p>Scegli l’origine della bozza privata Admin. Nessuna pubblicazione.</p></div></header>
    {step === "choice" ? <section className="stablr-admin-editor-fields" aria-label="Origine nuovo club">
      <button className="stablr-admin-advanced-card" type="button" onClick={() => setStep("editor")}><strong>Crea manualmente</strong><span>Nome obbligatorio, località e riferimento FIG facoltativi.</span></button>
      <button className="stablr-admin-advanced-card" type="button" onClick={() => setStep("fig")}><strong>Crea da FIG</strong><span>Seleziona un club dal catalogo FIG già disponibile.</span></button>
    </section> : <>
      <section className="stablr-admin-detail-section"><h2>Crea da FIG</h2><p className="stablr-admin-detail-empty">Ricerca solo nel catalogo FIG presente. Nessun import esterno.</p>
        <form onSubmit={search} className="stablr-admin-editor-fields"><label>Cerca per nome, città o codice FIG<input value={query} disabled={busy} maxLength={200} onChange={(event) => { setQuery(event.target.value);setSelected(null);setResults(null); }} /></label><div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" type="submit" disabled={busy || !query.trim()}>Cerca FIG</button></div></form>
        {busy && <p role="status">Ricerca FIG…</p>}{error && <p role="alert">{error}</p>}
        {results && <div className="stablr-admin-new-club-fig-results" role="radiogroup" aria-label="Club FIG disponibili">
          {results.map((club) => club.existingClubs?.length ? <div className="stablr-admin-club-row" key={club.id}>
            <span className="stablr-admin-club-identity"><strong>{club.name}</strong><span>{club.city || "—"} · {club.source_external_id}</span></span>
            <span className="stablr-admin-status">Già presente in STABLR</span>
            <span>{club.existingClubs.map((existing) => <button className="stablr-admin-white-button" key={existing.id} type="button" onClick={() => onOpenExisting(existing)}>Apri club esistente{club.existingClubs.length > 1 ? ` · ${existing.name}` : ""}</button>)}</span>
          </div> : <button className="stablr-admin-club-row" type="button" role="radio" aria-checked={selected?.id === club.id} key={club.id} onClick={() => setSelected(club)}>
            <span className="stablr-admin-club-identity"><strong>{club.name}</strong><span>{club.city || "—"}</span></span><span className="stablr-admin-club-activity">{club.source_external_id}</span><span className="stablr-admin-status">{selected?.id === club.id ? "Selezionato" : "FIG"}</span>
          </button>)}
          {!results.length && <p className="stablr-admin-detail-empty">Nessun club FIG corrisponde alla ricerca.</p>}
          {results.length >= 25 && <p className="stablr-admin-detail-empty">Mostrati fino a 25 risultati per campo. Affina la ricerca se necessario.</p>}
        </div>}
        <div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" disabled={!canCreate || busy} type="button" onClick={() => { if (canCreate) setConfirmation(true); }}>Crea bozza da FIG</button><button className="stablr-admin-abandon-button" type="button" onClick={() => { ++searchGeneration.current;searching.current = false;setBusy(false);setStep("choice");setResults(null);setSelected(null);setQuery("");setError(""); }}>Torna alla scelta</button></div>
      </section>
      {confirmation && <EditorDialog title="Conferma bozza da FIG"><p>{selected.name} · {selected.city || "—"} · {selected.source_external_id}</p><p>Viene creata solo una bozza privata con i dati Club disponibili. Nessun Percorso, matching definitivo o pubblicazione.</p><div className="stablr-admin-editor-actions"><button className="stablr-admin-white-button" type="button" onClick={() => { setConfirmed(selected);setConfirmation(false);setStep("editor"); }}>Conferma creazione bozza</button><button type="button" onClick={() => setConfirmation(false)}>Annulla</button></div></EditorDialog>}
    </>}
  </section>;
}
