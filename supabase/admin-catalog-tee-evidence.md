# Archivio immutabile evidenze tee · Fase 1

Nuovo SQL one-shot: `supabase/admin-catalog-tee-evidence.sql`. Applicarlo una sola
volta, integralmente, nel SQL Editor; prerequisiti: workflow Admin con
`admin_catalog_require_admin()`, `profiles`/`is_admin()` e Supabase Storage.
Non rieseguire migration storiche. Nessun batch/backfill/upload è eseguito dalla
migration: crea solo quattro tabelle vuote, RPC, protezioni e il bucket privato.
Questo file è la migration ancora NON applicata, corretta prima dell'applicazione;
non usare questa one-shot per aggiornare un'eventuale installazione precedente.

## Contratto isolato

Artefatti, evidenze, ricevute e item sono append-only: nessun UPDATE/DELETE/TRUNCATE
né DML diretto, compreso service_role. Nessuna FK verso tee, catalogo o
classificazioni. Identità di estrazione = SHA-256 dei byte + riferimento interno
+ versione estrattore. Il bucket contiene la copia esatta dei byte, non il solo URL.
Fonte/versione/acquisizione/pubblicazione restano distinte; date assenti restano NULL.

Manifest preparato dal server conservato privatamente nell'artefatto; le RPC di
lettura ricostruiscono solo campi allowlisted, mai manifest/payload/snapshot integrali,
URL firmati, percorsi Storage o dati utente. Nessun abbinamento evidenza→UUID live,
nessuna classificazione, certificazione, pubblicazione o aggiornamento Par.

Extractor allowlisted `fig-raw-tee-evidence/1.0.0`, indipendente dagli import.
Legge il raw FIG schema 1.0: tabella/riga/colonna, valori originali e normalizzati.
Il Par della riga è comune alla configurazione, non dichiarato per il tee.
Un Par esplicito non interpretabile conserva l'originale e il limite: normalizzato
NULL, senza inventare un fallback o chiamarlo valore inferito.
L'ambito viene riconosciuto solo da un token esplicito 9/18 Buche; nessun fallback
da Par o nomi generici. Gli header raw hanno perso gli span: non assegnare sesso
dalla posizione/colore o dai default del vecchio normalizzatore. Identità native
tee/configurazione e applicabilità restano NULL. CR/Slope servono soltanto a
individuare celle tee osservate, non vengono certificati o importati.

Tutte le prove v1 sono incomplete; i limiti sono conservati. Righe/header non
supportati producono esclusi motivati, non omissioni silenziose. Due celle CR/Slope
vuote indicano assenza di osservazione, non un tee da creare. Limite 10.000 item,
artefatto massimo 16 MiB, manifest massimo 12 MiB; eccedenze falliscono prima
di upload, non troncano. Non sommare osservazioni di fonti diverse come tee unici.

Nuovi byte producono una nuova evidenza; stesso manifest/batch restituisce SEMPRE
la stessa ricevuta, senza nuove righe. Un batch nuovo richiede un nuovo UUID nel
manifest e quindi un nuovo hash di approvazione. Le evidenze già archiviate restano
deduplicate, e una nuova approvazione esplicita registra gli esiti `existing`.
Manifest di estrazione diverso con stessa
identità di estrazione è respinto: correggere l'estrattore con una nuova versione
esplicitamente autorizzata in una futura migration. `predecessor_id` è predisposto
ma v1 non inferisce catene tra documenti: resta NULL. Estensioni/collegamenti alla
precedente richiederanno riferimenti documentali certi o selezione esplicita.

## Sicurezza e capacità

- `list(integer)`/`detail(uuid,integer)`/`preview(uuid)`
  con prefisso `admin_catalog_tee_evidence_`: solo authenticated con UID/Admin.
  Service API, anon, player e JWT senza identità respinti. Tutte STABLE/read-only.
- `stage(text,uuid)` e `confirm(uuid,text,uuid,text,boolean)` con lo stesso prefisso:
  invocabili SOLO con service_role. Nessun grant authenticated, neppure agli Admin.
  Verificano operatore Admin attuale; il processo autorizza il JWT con Auth e con
  preview PRIMA di creare il client privilegiato. Chi detiene la service key è parte
  della trust boundary: segreto infrastrutturale, non ruolo/browser utente.
- Stage valida e registra il manifest preparato: hash calcolato nel database sui
  byte UTF-8 esatti del file revisionato (incluso il batch UUID), allowlist e oggetto
  Storage. Non approva né crea evidenze/ricevute. Proposta e ricevuta sono due record
  append-only nella tabella batch: `staged` e `receipt`, senza nuove tabelle.
- Confirm richiede hash approvato esplicitamente, UUID proposta, stesso Admin e nota.
  Confronta l'hash con quello già calcolato server-side. Una sola ricevuta possibile
  per proposta (`UNIQUE(proposal_id)`): l'approvazione è consumata atomicamente dalla
  ricevuta, mai tramite UPDATE del record preparato. Hash vecchio su nuova proposta
  respinto. Retry identico restituisce la ricevuta; nota/identità/hash alterati sono
  respinti senza scritture. In caso di rollback l'approvazione resta non consumata.
- Il processo prima valida il token con Auth e la preview Admin, poi crea il client
  privilegiato e carica. Stage E confirm usano il client server, mai quello Admin.
  Il browser non può invocarli neppure conoscendo UUID e hash. L'approvazione CLI
  controlla i byte prima dell'upload; il database verifica lo stesso hash contro
  la preparazione immutabile. Nessun endpoint HTTP/browser di scrittura aggiunto.
- React espone soltanto consultazione lazy di batch/righe, paginata 50/100.
- Storage privato; nessun SELECT/download o DML per anon/authenticated, Admin inclusi.
  Policy restrictive neutralizzano eventuali policy permissive ampie per il nuovo
  bucket. Il processo service è l'unico lettore/uploader; `upsert:false`, hash dei
  byte verificato anche dopo un nuovo upload, e sui retry. Oggetti già registrati
  protetti anche da UPDATE/DELETE metadata lato
  service; bucket non rendibile pubblico. Altri bucket non cambiano comportamento.
- Trigger su Storage consentono il completamento metadata PRIMA dello staging;
  dopo staging bloccano sostituzione/spostamento/eliminazione. Nessuna modifica
  ai byte attraverso SQL. Per upload interrotto possono restare oggetti non
  registrati: niente pulizia automatica, verificare separatamente.

Lock advisory transazionale NOWAIT per artefatto/conferma e lock SHARE NOWAIT
sull'oggetto; tutti gli item, evidenze e ricevuta della conferma sono atomici.
Gli oggetti/preparazione precedenti sono una fase separata: un errore di conferma
può lasciare artefatto/proposta preparati, ma nessuna ricevuta/evidenza parziale.
Riprendere con lo stesso Admin, gli stessi byte e la stessa nota. Nessun secondo
consumo: lock per proposta e vincolo UNIQUE proteggono anche conferme concorrenti;
lock per hash artefatto serializza conferme di batch diversi sulla stessa estrazione.

## Operazioni future (NON eseguite in questo task)

1. Applicare il solo SQL nuovo una volta, dopo backup/revisione.
2. In ambiente server/operatori protetto, con Node e dipendenze del repository,
   preparare un file nuovo (creazione esclusiva, permessi 0600):

   `node scripts/evidence/fig-tee-batch.mjs preview --input data/fig/raw/fig-slope-course-rating-raw.json --out /percorso/protetto/fig-manifest.json`

   Questa fase è offline: nessun client Supabase, upload o scrittura DB.
   Esaminare manifest, originali, conteggi ed esclusi. Conservare lo SHA-256 di
   approvazione stampato dal processo: è l'hash dei byte del manifest locale.
3. In ambiente server protetto, fornire attraverso secret manager/env del processo
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e
   `STABLR_ADMIN_ACCESS_TOKEN` corrente. Mai prefisso REACT_APP, frontend, repository,
   argomenti shell o log. L'Admin deve essere ancora autorizzato al momento della
   conferma; se token scaduto, fermarsi e ottenere una nuova sessione.
4. Per preparare il batch server-side senza approvarlo, eseguire esplicitamente:

   `node scripts/evidence/fig-tee-batch.mjs stage --input data/fig/raw/fig-slope-course-rating-raw.json --manifest /percorso/protetto/fig-manifest.json`

   Verifica identità/ruolo, ricalcola l'estrazione, verifica la copia Storage e
   registra la proposta immutabile. Non crea evidenze/ricevute. Confrontare lo
   SHA-256 server con quello stampato dalla preview e revisionare il manifest.
5. Solo dopo approvazione umana, eseguire esplicitamente:

   `node scripts/evidence/fig-tee-batch.mjs confirm --input data/fig/raw/fig-slope-course-rating-raw.json --manifest /percorso/protetto/fig-manifest.json --approve-sha256 HASH_REVISIONATO --note "Motivo dell’approvazione"`

   Il processo ricalcola il manifest dall'originale: manifest alterati o versione
   estrattore differente falliscono prima dell'upload. Nessuna azione remota implicita.
   La preparazione è idempotente: può essere ripresa senza nuovo upload o proposta.
   Il server confronta l'hash revisionato con quello della proposta e conferma una
   volta sola. Stampata soltanto la ricevuta minimizzata. Per retry tecnico ripetere
   lo STESSO comando/file/nota: viene restituita la ricevuta esistente. Per un batch
   nuovo rigenerare con preview un file NUOVO (nuovo UUID/hash), revisionarlo e
   approvarlo di nuovo. Non riutilizzare l'approvazione del batch precedente.
6. Consultare Avanzata → Struttura e collegamenti → Archivio evidenze tee:
   solo ricevute confermate, non proposte in attesa. Nessun path Storage/URL firmato.

## Retention, rollback e fuori fase

Conservare copie protette e ricevute finché sostengono evidenze. Nessuna cancellazione
automatica; eventuali obblighi di retention richiedono un contratto successivo
esplicito. Per sospendere, fermare il processo e revocare stage/confirm; lasciare
intatto l'archivio e disabilitare la consultazione se necessario. Nessun rollback
live: non è stato toccato. Correzioni con nuove versioni, mai riscrittura.

Fuori fase: GesGolf/scorecard, estrazione header HTML con span, catene documentali
tra revisioni, collegamenti live, classificazioni, batch classificazione, Par
propagato e modifiche ai consumer. I test Storage isolati verificano policy/trigger
PostgreSQL, non eseguono upload reali né testano il servizio Storage remoto.
PGlite non simula due sessioni PostgreSQL indipendenti: testati CAS/hash, proprietà
Admin, rollback e presenza dei lock NOWAIT, non una gara reale tra connessioni.
