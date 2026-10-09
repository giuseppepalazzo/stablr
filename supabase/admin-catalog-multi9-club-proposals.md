# Multi-9: proposta completa per club

## Applicazione

La fondazione Fasi 1–3c, `admin-catalog-structure-club-lock.sql` e
`admin-catalog-multi9.sql` sono prerequisiti già applicati. Non rieseguirli.
Applicare **una sola volta**, integralmente nel SQL Editor, soltanto
`supabase/admin-catalog-multi9-club-proposals.sql`. È transazionale, one-shot,
senza backfill o scritture al momento dell'applicazione.

## Proposta e conferma

- La preview batch cerca club con combinazioni persistenti o strutture multi-9
  esistenti, non solo strutture già classificate. Legge soltanto: nessuna struttura,
  classificazione, ricevuta o evento viene creato preparando una proposta.
- `admin_catalog_multi9_club_preview(p_club_id)` consente anche a Codex/Admin
  una proposta mirata. Non richiede struttura esistente. La proposta include
  classificazione `multi_9`, azione sulla struttura, sorgenti, buche, configurazioni,
  esclusioni e baseline completa. Non usa il nome del pilota come criterio.
- Zero strutture: propone creazione e classificazione. Una struttura multi-9
  verificata: propone riuso senza modificarla. Una struttura non classificata o
  multi-9 ancora da revisionare, vuota: propone classificazione esplicita.
  Strutture multiple, classificazioni incompatibili o dipendenze di strutture
  non verificate: esclusione motivata, mai adozione o riclassificazione implicita.
- Componenti solo dalle FK ufficiali front/back: Percorsi 9 attivi, stesso club,
  numeri locali 1–9 completi, Par 3–6 e totale coerente, nove SI distinti 1–18.
  Combinazioni 18 complete, ordini 1–18, SI 1–18 univoci, Par coerente, ogni
  `route_id + physical_hole_number` risolto esattamente una volta. Le posizioni
  servono solo a verificare l'ordine dichiarato, non a inferire identità.
- Nove ripetute, derivazioni dichiarate, riferimenti mancanti/duplicati e Par
  diversi dalla base non diventano candidati validi. Ogni esclusione è mostrata.
- La preview mostra tutti i club del perimetro e relativi esclusi. Ogni conferma
  è limitata a 50 club; la UI seleziona inizialmente al massimo 50 ed espone il
  limite. Nota obbligatoria, riepilogo creazione/classificazione, una conferma finale.

## RPC, sicurezza e atomicità

Endpoint pubblici nuovi/ridefiniti, EXECUTE solo ad authenticated con verifica
obbligatoria UID + JWT authenticated + `is_admin()`, SECURITY DEFINER e
`search_path=pg_catalog`:

- nuovo `admin_catalog_multi9_club_preview(uuid)`, sola lettura;
- ridefinito `admin_catalog_multi9_batch_preview(uuid[] default null)`;
  conserva la selezione opzionale storica per ID struttura;
- ridefinito `admin_catalog_multi9_batch_register(jsonb,text,boolean)`.

I nuovi helper `admin_catalog_multi9_club_inspect` e
`admin_catalog_multi9_club_apply` sono privati anche per Admin autenticati.
Nessuna nuova tabella, policy o autorizzazione diretta. Anon, player e service API
non possono invocare endpoint/helper; RLS e ricevute/audit append-only invariati.

La conferma acquisisce il lock NOWAIT comune per `club_id` **prima** dei controlli,
anche senza struttura, e i lock sorgenti/fondazione; ricostruisce la baseline e
ricontrolla unicità, revisioni, sorgenti e completezza. Solo dopo crea/classifica
la struttura mediante le RPC Admin già applicate, quindi riusa il contratto
multi-9 applicato per buche/configurazioni. Tutto è nella stessa subtransazione
del club: fallimenti annullano anche struttura, classificazione e relativo audit.
Gli altri club validi proseguono; ricevuta globale immutabile con tutti gli esiti.
I successi persistono al COMMIT esterno, non tramite commit separati per club.

Il contratto 2 include tutte le strutture del club nella baseline: una struttura
creata/classificata dopo la preview invalida la proposta. Le preview storiche
contratto 1 e la pagina della struttura già verificata restano utilizzabili.
Sono vietate duplicazioni del medesimo club nella stessa conferma.

Nessuna scrittura su catalogo live, tee, import, giri, bozze, versioni o storico
preesistente. Nessun consumer giocatore attivato, nessuna propagazione/override.

## Verifica e rollback operativo

`scripts/tests/admin-catalog-multi9.test.mjs` esegue entrambi i contratti, preview
senza struttura, una conferma, riuso manuale, basi mutate/tampering, dati incompleti,
esclusioni, rollback dopo classificazione, isolamento batch e permessi.
La modalità `STABLR_EMBEDDED_POSTGRES_MODULE` verifica due Admin concorrenti su
un cluster locale temporaneo anche prima che esista la prima struttura.

Rollback operativo: disabilitare preparazione/approvazione batch in UI o revocare
le RPC di approvazione, senza cancellare strutture, configurazioni, audit o ricevute.
Non tornare al vecchio endpoint di classificazione privo del lock per club.
Registrazioni già approvate restano compatibili con il precedente contratto
multi-9; nessun rollback del catalogo live è necessario o previsto.
