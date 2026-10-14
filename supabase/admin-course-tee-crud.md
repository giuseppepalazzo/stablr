# Tee dei Percorsi pubblicati — CRUD Admin

Applicare **una sola volta** `admin-course-tee-crud.sql` nel SQL Editor, dopo
`admin-course-tee-editor.sql` e i suoi prerequisiti già esistenti (catalogo WHS,
workflow, editor Club, abbandono bozze). Nessuna applicazione remota è eseguita
da questa task. Non rieseguire migration storiche.

Per l'avviso d'impatto sulla fondazione nell'anteprima applicare successivamente,
una sola volta, `admin-course-tee-foundation-impact.sql`, dopo la fondazione,
`admin-catalog-data-origin.sql` e `admin-catalog-tee-classifications.sql` già
installati. Ridefinisce soltanto la preview: nessuna nuova tabella, scrittura
su baseline o modifica alle regole del publisher. La vecchia preview è resa
privata e riutilizzata per mantenere i controlli esistenti. Il client aggiornato
non permette la conferma se il server omette il nuovo riepilogo d'impatto.

## Contratto

- Una sola colonna nuova: `route_tees.display_order`, nullable; nessun backfill
  né cambiamento agli indici. L'ordine già dichiarato da Nuovo Club in
  `source_payload.admin_display_order` resta un fallback di lettura esplicito;
  un semplice aggiornamento rating non lo copia né riscrive il payload.
- Riutilizzo di `route_tee`, bozze personali e versioni immutabili esistenti.
  Le vecchie bozze a tre campi restano inalterate: metadati ricavati soltanto
  dalla loro base originale, nessun rebase/archiviazione automatica.
- Modificabili: nome, colore, categoria (`men`/`women`/NULL), ordine intero
  nullable, CR numerico finito nullable, Slope intero 55–155 nullable, attivo.
  Categorie storiche diverse possono restare invariate, non essere assegnate
  a nuovi tee. Nessun nuovo intervallo o arrotondamento del CR.
- Nome non vuoto; collisioni nome/ambito bloccate anche se la categoria è
  diversa o il tee è inattivo. Ambito NULL usa l'ambito effettivo del Percorso.
  Nessuna rinomina automatica e nessuna modifica all'indice live esistente.
- Nuovo tee: solo bozza privata finché confermato; UUID live riservato nella
  bozza, ambito 9/18 e Par calcolati esclusivamente dalla griglia del Percorso
  attivo, completa e coerente con il totale live. Un tee nuovo attivo richiede
  entrambi i rating. Tee inattivi e tee storici conservano rating nullable.
- Ambito, Par, fonti, matching, distanze, buche e SI rimangono read-only.
  Nessuna modifica ai tee delle combinazioni, import, giri o consumer giocatore.
  Creare un nuovo tee 18 su un Percorso fisico 9 non è incluso in questo passo.

## RPC e sicurezza

Nuove: `admin_course_tee_open_new_draft(uuid)`,
`admin_course_tee_resume_new_draft(uuid)`,
`admin_course_tee_preview_draft(uuid)`. Le ultime due non scrivono.
List/open/publish e guardia della bozza sono estese; save/archive restano gli
entry point esistenti. Ogni RPC richiede UID, JWT authenticated e ruolo Admin;
proprietà, stato e revisione ricontrollati. Helper privati, nessun nuovo grant
DML, policy o accesso player/service. La comparazione delle bozze tee nel
publisher Par esistente viene allineata ai metadati, senza cambiare regole Par.

Pubblicazione: conferma della revisione salvata, preview server-side ripetuta
sotto lock NOWAIT, controllo base completa e ultima versione, controllo
duplicati. La transazione inserisce/aggiorna soltanto il tee consentito,
registra versione/diff/autore/data e chiude la bozza. Qualsiasi errore annulla
anche inserimento e storico. La lock di tabella tee protegge dagli inserimenti
concorrenti dei writer legacy: durante un'altra pubblicazione può quindi
richiedere un retry anche su un diverso Percorso. Nessun retry automatico con
base modificata. Per nuovi tee il lock della griglia impedisce phantom.

## Verifica UX minima dopo SQL

Su un Percorso pubblicato con griglia completa: `Gestisci tee` → `+ Nuovo tee`
→ nome/colore/categoria/ordine/CR/Slope → salva → torna e riprendi → `Pubblica`
→ verifica il Prima/Dopo **senza confermare un tee fittizio** → annulla e
abbandona. Per una pubblicazione reale autorizzata, il tee compare con il suo
ambito/Par server-side, la bozza si chiude e la versione conserva il diff.
Verificare inoltre che un nome già presente nello stesso ambito blocchi la
conferma, senza rinomine. Il rollback di errore e la concorrenza sono coperti
da fixture PostgreSQL, non da pubblicazioni reali.

Su Mare di Roma, una modifica tee 9 deve mostrare il potenziale impatto sulle
fotografie tee delle configurazioni verificate 9 e 18, non una propagazione dei
metadati. I discendenti vengono individuati soltanto da riferimenti verificati
padre/componenti. Collegamenti mancanti restano copertura incompleta. Annullare
l'anteprima durante il test: nessuna baseline viene aggiornata automaticamente.

Nel player, passare da 9 a 18 deve selezionare soltanto i tee dell'ambito esatto,
anche se era memorizzato un ID dell'altro ambito. In assenza di tee corrispondenti
compare uno stato esplicito senza rating sostitutivi. CR/Slope mancanti restano
mancanti, non diventano zero; formule Stableford/Par/SI e giri/snapshot salvati
non vengono modificati.

## Test isolati

`STABLR_PGLITE_MODULE=/path/to/pglite/dist/index.js node --test
scripts/tests/admin-course-tee-crud.test.mjs`.
Con PostgreSQL nativo e driver pg temporanei:
`STABLR_PG_BIN=/path/to/native/bin STABLR_PG_MODULE=/path/to/pg/lib/index.js
node --test scripts/tests/admin-course-tee-crud-concurrency.test.mjs`.
Senza entrambe le variabili il test nativo è esplicitamente skipped.

Rollback del rilascio: non rimuovere versioni o record pubblicati; se necessario
ritirare la UI e preparare una migration compensativa esplicita dopo verifica
di bozze/versioni nuove. Non rimuovere la colonna se già usata. Un errore durante
l'applicazione dello SQL interrompe e annulla l'intera migration.
