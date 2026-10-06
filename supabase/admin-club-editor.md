# Editor Club esistente

Migration incrementale: `supabase/admin-club-editor.sql`.
Applicare manualmente nel SQL Editor **dopo** `admin-catalog-workflow.sql`.
È transazionale e one-shot; nessuno script storico viene sostituito. Non è
stata applicata al database remoto.

## Campi e snapshot

Lo snapshot Club v1 contiene esattamente `name` (stringa non vuota, massimo
200 caratteri) e `city` (stringa fino a 200 caratteri oppure null). Le RPC
eliminano spazi esterni e convertono città vuota in null. Altre chiavi vengono
rifiutate. `name_normalized` è conservato: questo editor cambia il nome
visualizzato e non interviene sui campi di matching o sulle identità importate.

Il codice FIG resta in lettura: viene da `fig_clubs.source_external_id` o
dal payload import. `clubs.fig_club_id` è una foreign key e non viene esposta
come campo editabile. Non esiste un campo indipendente di codice FIG sui club
nel contratto attuale. Stati, fonti, giocabilità e relazioni restano invariati.

## RPC e sicurezza

`admin_club_get_draft(club_id)` legge solo la bozza editor dell'Admin corrente.
`admin_club_open_draft(club_id)` apre o riprende una bozza per un Club attivo
esistente, catturando dal server snapshot e timestamp del live. Un indice
consente una bozza aperta per Club e autore; il lock del Club serializza
aperture concorrenti. Nessuna versione è creata quando si apre una bozza.

`admin_club_save_draft(draft_id, snapshot, expected_revision)` valida proprietà,
campi e revisione. Un trigger impedisce anche a un salvataggio generico workflow
di cambiare base, identità o autore, introdurre campi extra o modificare una
bozza editor di un altro Admin.

`admin_club_publish_draft(draft_id, expected_revision)` verifica sessione Admin,
proprietà, tipo/schema, Club attivo, snapshot, revisione confermata, base live
(valori e timestamp) e ultima versione. Una base diversa produce `40001`.
Bozze generiche prive di base server non sono pubblicabili da questa RPC.

Nella stessa transazione vengono aggiornati solo `clubs.name`, `clubs.city` e
il timestamp di attività, inserita una versione immutabile con snapshot/diff,
autore/data e chiusa la bozza (`workflow_status = published`). Qualunque errore
annulla tutti e tre i passaggi. Nessun aggiornamento generico JSON su tabelle
live e nessuna nuova policy su catalogo/player.

Le quattro RPC sono `SECURITY DEFINER` con `search_path = pg_catalog` e nomi
qualificati. Hanno EXECUTE per `authenticated`, con controllo obbligatorio
Admin dentro ogni chiamata. Player, anon e service API sono bloccati; helper
senza EXECUTE per i client. I permessi/RLS workflow della fondazione restano
in vigore, così come l'immutabilità delle versioni.

## Flusso UI e limiti

Dal riepilogo Club, “Modifica dati” apre l'editor; “Bozza in corso” segnala una
bozza reale del proprio Admin. “Pubblica” salva prima le modifiche in bozza e
mostra diff e conferma finale. Il successo aggiorna il riepilogo e i valori
catalogo già caricati. Gli errori tecnici restano in console, con messaggio
comprensibile in UI.

La navigazione interna, sidebar ed uscita dall'Admin con modifiche non salvate
offrono Salva bozza / Scarta / Resta. Scarta abbandona solo le modifiche locali,
conservando la bozza già persistita. Per reload/chiusura del browser si usa il
dialogo nativo `beforeunload`, imposto dal browser.

Rimandati: Nuovo club, editor di altre entità, aggiornamento del matching,
rebase/risoluzione assistita dei conflitti, pubblicazione di bozze ripristinate
dal workflow generico, archiviazione e azioni Revisioni. Una bozza con base
obsoleta resta conservata e bloccata; riaprire l'editor non ribasa automaticamente.

## Test

App: `CI=true npm test -- --runInBand`.
SQL: `node --test scripts/tests/admin-club-editor.test.mjs` con PGlite
disponibile oppure `STABLR_PGLITE_MODULE` impostato al suo entrypoint assoluto.
Si verificano permessi, allowlist, basi obsolete, salvataggi concorrenti,
pubblicazione/versione/diff/chiusura e rollback su errore dopo l'update live.
I record dei test esistono solo nel database locale in memoria.
