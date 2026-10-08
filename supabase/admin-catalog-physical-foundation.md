# Catalogo — fondazione fisica, Fase 1

## Applicazione

Applicare **una sola volta** l'intero `supabase/admin-catalog-physical-foundation.sql`
nel SQL Editor del progetto, inclusi `BEGIN` e `COMMIT`, dopo lo schema catalogo,
l'estensione FIG/WHS e `admin-catalog-workflow.sql` già presenti. È richiesto
l'helper privato `admin_catalog_require_admin()`. Non riapplicare migration storiche.
Lo script è transazionale e intenzionalmente non idempotente: una seconda
applicazione fallisce senza aggiornare le tabelle già create. In caso di errore
eseguire `ROLLBACK` nella sessione prima di correggere la causa.

La migration crea **sei tabelle vuote**. Non classifica club, non copia buche,
non riconcilia riferimenti e non cambia il catalogo pubblicato. Non è stata
applicata in remoto. Nessun consumer attuale legge queste strutture.

## Contratto e stati

| Tabella nuova | Responsabilità |
| --- | --- |
| `admin_catalog_physical_structures` | Gruppo fisico di un club; `fisico_9`, `fisico_18`, `multi_9` o `non_classificato`. Fonte, riferimento e motivazione obbligatori. |
| `admin_catalog_physical_holes` | Identità fisica stabile nel gruppo, numero descrittivo e `base_par`. Nessun SI fisico. |
| `admin_catalog_playable_configurations` | Configurazione 9/18 distinta dalle entità legacy; gruppo verificato, eventuale padre/revisione/regola di derivazione e riferimenti legacy opzionali. |
| `admin_catalog_configuration_holes` | Posizione giocata → identità fisica; occorrenza esplicita per riutilizzo, Par ereditato/override e SI proprio della configurazione. Può conservare un riferimento legacy irrisolto senza collegamento fisico. |
| `admin_catalog_tee_overrides` | Rappresentazione riservata di override Par e/o SI per tee e posizione di configurazione, con provenienza. Nessuna RPC di scrittura in questa fase. |
| `admin_catalog_foundation_events` | Evidenza append-only di ogni creazione/revisione: autore, data, prima/dopo, revisione. Non è una pubblicazione né modifica lo storico esistente. |

Stati indipendenti:

- `review_status = needs_review / verified`: revisione esplicita, non visibilità
  giocatore e non pubblicabilità del catalogo attuale.
- `relationship_kind = unresolved / derived / autonomous`: da revisionare,
  derivata con padre verificato o autonoma. La presenza di una fonte legacy non
  determina automaticamente questo stato o un collegamento fisico.
- `par_mode = inherited`: valore futuro risolto dal `base_par` dell'identità
  collegata, senza copia del Par. `override`: valore esplicito, con motivazione e
  provenienza registrate. NULL è ammesso solo per una posizione non verificata.
- «Con override» si ricava dagli override espliciti; non è uno stato mutuamente
  esclusivo con derivata/autonoma. Il SI della configurazione è sempre distinto
  dal Par fisico; l'override SI tee rimane una decisione/contratto separato.

Cardinalità completa, collegamento fisico verificato e pubblicabilità sono
concetti distinti. La classificazione non certifica che tutte le identità fisiche
siano già censite. Verificare una configurazione richiede esattamente le sue 9/18
posizioni, identità verificate dello stesso gruppo/club, SI presenti e distinti,
e occorrenze consecutive da 1 per ciascuna identità. Per una derivata serve un
padre verificato dello stesso gruppo, la sua revisione e una regola esplicita;
le identità riusate devono appartenere al padre. Non si inferisce la regola dai
nomi o dalla posizione.

Par ammessi 3–6 e SI 1–18 seguono i domini già esistenti. Non si impone SI 1–9
alle configurazioni 9: una seconda nove può conservare indici 10–18; la futura
pubblicazione dovrà rendere esplicita la regola adottata. Nessun controllo di
questa fase rende automaticamente pubblicabile un record.

## Gestione Admin limitata

Tutte le RPC seguenti hanno prefisso `admin_catalog_foundation_`, sono
`SECURITY DEFINER` con `search_path` fisso e richiedono UID autenticato con ruolo
Admin. Solo `authenticated` ha EXECUTE, ma un utente normale è respinto prima
di qualsiasi lettura/scrittura. `anon` e `service_role` non hanno accesso API.
RLS consente lettura solo Admin; nessun client, nemmeno Admin, ha DML diretto.

| RPC | Operazione ammessa |
| --- | --- |
| `create_structure` | Crea esclusivamente `non_classificato / needs_review`. |
| `review_structure` | Classifica su evidenza esplicita; conferma separata, revisione ottimistica. |
| `create_physical_hole` | Crea identità nel gruppo già verificato, con Par esplicito o da revisionare. |
| `review_physical_hole` | Completa/revisiona una identità ancora pendente, con revisione attesa. |
| `create_configuration` | Crea configurazione irrisolta, senza gruppo, padre o buche generate. |
| `review_configuration` | Registra gruppo/tipo/padre e, solo su conferma, verifica completezza e collegamenti. |
| `record_configuration_hole` | Registra una singola posizione esplicita o irrisolta; collega una identità solo su conferma verificata. Incrementa atomicamente anche la revisione della configurazione. |

Provenienza e motivazione non possono essere vuote. Autori/date/revisioni sono
assegnati dal server e l'audit è nella stessa transazione. Le proposte verificate
sono sigillate: non esiste una RPC che modifichi un Par base già verificato o le
posizioni di una configurazione verificata. DELETE/TRUNCATE sono vietati e gli
eventi non sono riscrivibili. Non è un nuovo workflow di bozze/pubblicazione.

I 30 club incerti possono rimanere non classificati e i 63 riferimenti incerti
possono essere registrati come posizioni `needs_review` con identità NULL. Nessun
offset 1–9/10–18, uguaglianza di Par o somiglianza di nomi produce collegamenti.
Mare di Roma, Marina Velka e tutti gli altri record correnti restano invariati.

## Rollback e confini

- Prima del COMMIT, un errore annulla l'intera migration; nessuna modifica
  parziale deve essere conservata.
- Dopo il COMMIT non serve rollback funzionale dei consumer: continuano a usare
  soltanto le tabelle correnti. In caso di sospensione, non invocare le nuove RPC.
- Dopo nuove revisioni, conservare tabelle ed evidenze: niente `DROP CASCADE`,
  DELETE, riscritture dell'audit o rollback di dati live. Un'eventuale revoca
  dell'accesso alle nuove RPC va fatta con un successivo script dedicato,
  mantenendo i dati raccolti. Non rimuovere le migration storiche.
- Le FK nuove sono RESTRICT: dopo l'uso, un record legacy referenziato non può
  essere eliminato fisicamente. Non cambiano letture o aggiornamenti correnti.

Fuori fase: backfill e classificazione automatica, revisione dei casi incerti,
UI/editor, consumer di valori effettivi, import, propagazione e impatto,
pubblicazione su live e sua reversibilità, modifica di basi già verificate,
gestione/validazione completa degli override tee e distanze/rating. Le future
pubblicazioni dovranno mostrare origine, impatto, differenze e conferma atomica;
questa fondazione non esegue propagazioni. Snapshot giri, bozze e versioni
esistenti restano immutati.

## Verifica isolata

`scripts/tests/admin-catalog-physical-foundation.test.mjs` usa PostgreSQL/WASM
(PGlite), schema reale del repository e fixture esclusivamente locali. Eseguire
con `node --test scripts/tests/admin-catalog-physical-foundation.test.mjs`, dopo
aver reso disponibile `@electric-sql/pglite` oppure impostato
`STABLR_PGLITE_MODULE` al suo entrypoint. Non richiede credenziali o connessioni
al database remoto.
