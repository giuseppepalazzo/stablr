# Tee di Route/combinazioni pubblicate

## Applicazione manuale

Applicare **una sola volta l'intero** `admin-combination-tee-crud.sql` nel SQL
Editor, dopo `admin-course-tee-crud.sql`, `admin-course-tee-foundation-impact.sql`,
l'editor Route e la fondazione/classificazione tee già esistenti. Non rieseguire
migration storiche. Lo script verifica i prerequisiti prima di qualsiasi DDL;
un errore annulla tutta la transazione. Nessuna applicazione remota automatica.

## Perimetro e riuso

Stesso componente/service editor, normalizzazione/allowlist, bozze personali,
versioni e abbandono dei tee Percorso. Entità workflow `combination_tee` già
prevista, senza nuove tabelle/policy o grant DML. Una sola colonna nuova:
`combination_tees.display_order` nullable, senza backfill né cambi di indici.

Nome, colore, categoria (`men`, `women`, NULL), ordine intero nullable, stato,
CR finito nullable e Slope intero 55–155 nullable sono editabili. Categorie
storiche diverse possono restare invariate. CR accetta virgola decimale nella
UI, senza arrotondamenti o nuovi intervalli server. Tee storici incompleti
possono essere disattivati senza aggiungere rating. Nuovi tee attivi richiedono
entrambi i rating; il nome deve essere non vuoto e univoco nell'ambito effettivo
della combinazione, anche tra categorie diverse o tee disattivati.

I nuovi tee prendono **soltanto** ambito e Par dalla griglia pubblicata della
combinazione: nell'attuale schema è 18 buche. Richieste combinazione/origini
attive, 18 righe complete, numerazione/riferimenti coerenti, SI univoci 1–18 e
totale Par coerente. Non vengono creati nuovi ambiti 9 o rating stimati. I tee
storici mantengono il loro ambito/Par, anche NULL/9 dove già persistiti: mai
convertiti automaticamente. Par, SI, distanze, fonti/matching e relazioni sono
read-only; nessuna propagazione verso tee Percorso o altre combinazioni.

## RPC

`admin_combination_tee_list/get_draft/open_draft/open_new_draft/resume_new_draft/
save_draft/archive_draft/preview_draft/publish_draft`.
List/open-new usano `p_combination_id`, gli editor esistenti `p_tee_id`, le
operazioni su bozza `p_draft_id` e (se mutanti) `p_expected_revision`.
Preview e letture non scrivono. Solo UID/JWT authenticated/Admin, con proprietà
e tipo della bozza ricontrollati. Anon, player e service role sono respinti;
helper privati con `search_path=pg_catalog`. Nessun proxy SQL/JSON generico.

Preview server-side Prima/Dopo e conferma finale obbligatoria nel flusso UI.
Il server riusa le validazioni durante pubblicazione sotto lock NOWAIT su tee,
genitori e griglie, verifica baseline completa/revisione/ultima versione e
duplicati. In una transazione modifica **solo** il tee scelto, registra versione
immutabile con snapshot/diff/autore/data e chiude la bozza. Ogni errore, incluso
inserimento versione/chiusura, annulla tutto. Lock di tabella proteggono anche
writer legacy/phantom, quindi conflitti temporanei possono richiedere un retry.
Nessun rebase o archiviazione automatica; bozze preesistenti senza base valida
non vengono convertite o sovrascritte.

## Fondazione e Par

Un unico helper read-only d'impatto è condiviso con i tee Percorso. Usa soltanto
FK live e parent/componenti verificati della fondazione; nessun match da nome,
colore, Par o posizione. Mostra configurazioni, revisioni/stati, classificazioni
potenzialmente obsolete e copertura incompleta. Una creazione non classifica
il nuovo tee; una modifica può rendere obsolete le classificazioni CR/Slope/
categoria/stato. Se non esiste una fotografia tee nelle configurazioni, una
sola modifica di nome/colore/ordine non viene trattata come invalidazione
automatica del Par. Baseline, fondazione e classificazioni non sono aggiornate.

L'unico adattamento al publisher Par è la comparazione delle bozze tee:
una bozza combinazione identica alla base/live è innocua, una modifica reale
sovrapposta resta bloccante. Nessuna modifica alle regole o ai valori Par.

## Test UX minimo

Parco De' Medici → una combinazione ufficiale (es. Championship Bianco/Blu) →
`Gestisci tee` → `+ Nuovo tee` → salva nome/colore/categoria/ordine/CR/Slope →
torna e riprendi → `Pubblica` → verifica Prima/Dopo, ambito/Par read-only e
impatto fondazione → **annulla e abbandona, senza pubblicare tee fittizi**.
Provare anche un nome già presente nello stesso ambito: conferma bloccata,
nessuna rinomina. L'ingresso dall'editor Route protegge modifiche non salvate
con Salva/Scarta/Resta; il ritorno porta alla stessa combinazione/editor.

Test isolati: `STABLR_PGLITE_MODULE=/path/to/pglite/dist/index.js node --test
scripts/tests/admin-combination-tee-crud.test.mjs`. Con due sessioni native:
`STABLR_PG_BIN=/path/to/native/bin STABLR_PG_MODULE=/path/to/pg/lib/index.js
node --test scripts/tests/admin-combination-tee-concurrency.test.mjs`.
Sono fixture automatiche, nessun batch o pubblicazione reale.

Rollback operativo: ritirare la UI se necessario; non cancellare versioni,
bozze o tee già pubblicati. Ogni correzione successiva richiede una migration
compensativa esplicita. Non rimuovere la colonna d'ordine se già utilizzata.
