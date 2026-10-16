# Task 6 — Metadati editoriali Percorsi/combinazioni

## Applicazione

Applicare **una sola volta**, per intero, `supabase/admin-catalog-editor-metadata.sql`
nel SQL Editor del progetto, prima di usare il nuovo frontend. Non applicato da Codex.
Prerequisiti già utilizzati dagli editor: workflow catalogo, editor Club/Percorso/Route,
abbandono bozze, fondazione fisica con collegamenti Percorso e configurazioni giocabili.
Non rieseguire gli script storici. L'intera migration è transazionale; una dipendenza
mancante interrompe l'applicazione senza installazione parziale.

## Contratto

- `course_routes.name` / `route_combinations.name`: denominazione curata; nome FIG/GesGolf,
  payload, identificativi, associazioni, origini e struttura non vengono riscritti.
- `catalog_editor_metadata`: proiezione pubblicata separata, per tipo/UUID esatti,
  con alias (max 20 distinti, 200 caratteri), note editoriali pubbliche (max 5000),
  ordine di visualizzazione delle combinazioni. Nessuna nota privata o dato personale.
  L'ordine dei Percorsi usa il campo esistente; ordine int32 opzionale, zero valido.
- Nessuna nuova colonna sulle entità live: aggiungerle invaliderebbe le baseline
  fisiche che conservano snapshot dell'intera riga. Nessun backfill.
- L'ordine curato delle combinazioni ha precedenza sul vecchio ordine sorgente;
  se assente, il consumer conserva il fallback esistente. Nessun calcolo giocatore cambia.
- Struttura, ordine delle sezioni, origini, Par/SI, tee, rating, distanze, giri
  e storico sono fuori perimetro. Per cambiare una combinazione strutturalmente,
  crearne una nuova tramite il workflow dedicato.

## Workflow e autorizzazioni

`admin_catalog_metadata` è l'unica nuova RPC pubblica, solo Admin autenticati con UID:
`detail`, `history`, `open`, `save`, `preview`, `publish`, `restore`.
I vecchi publisher diretti Percorso/Route non sono più invocabili dall'API:
anteprima server-side, hash, revisione e motivazione sono obbligatori.
Bozze e versioni riusano tipi/identità esistenti. Una bozza legacy allineata si riprende;
una base cambiata blocca senza rebase o archiviazione automatica.

La pubblicazione usa lock NOWAIT su target/dipendenze, revisione e fingerprint;
live autorizzato, proiezione, versione/diff/autore/data e chiusura bozza sono atomici.
Le versioni sono anche l'audit immutabile della decisione con motivazione.
Modifiche soltanto a alias/note/ordine combinazione non toccano live o baseline.
Nome/stato/ordine Percorso possono invalidare baseline: l'anteprima mostra i
collegamenti/configurazioni interessati e un avviso esplicito. Nessun rebase automatico.

Distinzione verificata con pubblicazioni PostgreSQL isolate:
- La denominazione curata è ancora `name` sul record live, non nella proiezione
  separata. Il publisher e il trigger live aggiornano `updated_at`. Le fotografie
  sorgente in `admin_catalog_physical_course_links.source_snapshot` e
  `admin_catalog_playable_configurations.registration_snapshot` includono nome/data:
  il loro confronto passa a `source_state=changed`. Le classificazioni tee derivate
  possono diventare obsolete tramite `configuration_valid=false`, senza variazioni
  a Par/SI o rating. Il warning resta quindi necessario per Percorsi e combinazioni.
- Alias, note e ordine di visualizzazione delle combinazioni aggiornano soltanto
  la proiezione: timestamp live e baseline fisiche restano invariati. L'anteprima
  usa informazione neutra e indica le configurazioni collegate come non modificate.
- Ogni pubblicazione crea comunque una nuova versione immutabile e può invalidare
  basi di altre bozze metadati. I relativi warning server non vengono nascosti.
  Il diff comprende tutte le modifiche salvate, anche una rinomina precedente.
Questa distinzione non rende innocue modifiche a stato, struttura o origini e non
modifica alcun contratto/baseline del publisher Par.

RLS e grant consentono ai giocatori solo le cinque colonne editoriali pubblicate,
per record attivi in Club attivo e giocabile. Nessun DML API, autore/revisione o bozza.
Anon e service API non invocano la RPC. Helper privati con search path fisso.

## Compatibilità con il correttivo CPU già applicato

Il frontend usa sempre `admin_catalog_metadata`, mai l'implementazione privata
`admin_catalog_metadata_before_conflict_errors`. Il correttivo
`admin-catalog-metadata-conflict-errors.sql`, applicato dopo questa migration,
mantiene firma/risposte e traduce i conflitti in `PT409`/HTTP 409; entrambi gli
editor mostrano il conflitto senza retry, rebase o archiviazione automatica.
**Non rieseguire né questa migration né il correttivo se già applicati.**

Le richieste metadati disabilitano anche i retry automatici dell'SDK per errori
di rete/503/520. Il limite client resta 15 secondi; le risposte tardive sono ignorate.
Un timeout di salvataggio/pubblicazione non prova un rollback: prima di altre
mutazioni è richiesta la verifica read-only dell'esatta bozza e dell'eventuale
versione. Nessun nuovo invio automatico; i valori nell'editor restano disponibili.

Verifica read-only del 16 ottobre 2026, Mare di Roma: la bozza «Percorso TEST UX»
è legacy e ancora `draft`; base live del 5 maggio, record live aggiornato il
12 ottobre. Campi base, contesto sorgente e riferimento versione coincidono, ma
`base_live_updated_at` è obsoleto: il conflitto è atteso, non un errore del publisher.
Nessun rebase, pubblicazione o abbandono automatico; la bozza TEST va conservata.

## Storico, ripristino e rollback

Il dettaglio mostra versioni e diff di questo livello, senza payload sorgente.
Ripristino soltanto in **nuova bozza** basata sul live corrente; una bozza personale
aperta richiede abbandono esplicito. Campi assenti in vecchie versioni non cancellano
metadati più recenti; la struttura non è mai ripristinata da questo editor.
Rollback editoriale: nuova bozza/ripristino, anteprima e nuova pubblicazione compensativa.
Non eliminare versioni o proiezioni, non ripristinare direttamente tabelle live.
In caso di sospensione della feature, disabilitare l'accesso al nuovo flusso mantenendo
lo storico; non riabilitare i vecchi publisher come scorciatoia senza conferma.

## Test UX minimo dopo SQL

Su un Percorso e una combinazione esistenti: modificare alias/note/ordine, salvare,
uscire/riprendere, aprire Pubblica e controllare Prima/Dopo e impatto. Senza motivazione
la conferma resta disabilitata; Annulla non pubblica. Verificare i nomi FIG/origini
in sola lettura. Dopo una pubblicazione autorizzata, verificare storico/diff e
ripristino in nuova bozza senza cambiamenti al live fino a nuova conferma.
